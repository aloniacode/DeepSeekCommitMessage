import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import {
  isBinaryFile,
  collectUntrackedContents,
  stripDiffMetadata,
  isExcludedPath,
  splitDiffIntoSections,
  sampleSection,
  collectChanges,
} from "../src/git";

/** git 是否可用（collectChanges 集成用例依赖真实 git 命令）。 */
const gitAvailable = (() => {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dcm-test-"));
}

async function clean(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

function git(dir: string, ...args: string[]): string {
  return execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8" });
}

/** 创建真实 git 仓库（隔离目录）。 */
async function makeGitRepo(): Promise<string> {
  const dir = await makeTmp();
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "dcm-test@example.com");
  git(dir, "config", "user.name", "dcm-test");
  git(dir, "config", "core.autocrlf", "false");
  return dir;
}

describe("isBinaryFile", () => {
  it("文本文件返回 false", async () => {
    const dir = await makeTmp();
    const f = path.join(dir, "a.txt");
    await fs.writeFile(f, "hello world\n");
    expect(await isBinaryFile(f)).toBe(false);
    await clean(dir);
  });

  it("含 NUL 字节返回 true", async () => {
    const dir = await makeTmp();
    const f = path.join(dir, "b.bin");
    await fs.writeFile(f, Buffer.from([0x00, 0x01, 0x02]));
    expect(await isBinaryFile(f)).toBe(true);
    await clean(dir);
  });

  it("不存在文件按二进制处理返回 true", async () => {
    expect(await isBinaryFile(path.join(os.tmpdir(), "no-such-file-xyz"))).toBe(
      true
    );
  });
});

describe("collectUntrackedContents", () => {
  it("读取文本文件并加 + 前缀", async () => {
    const dir = await makeTmp();
    await fs.writeFile(path.join(dir, "new.ts"), "export const x = 1;\n");
    const out = await collectUntrackedContents(dir, ["new.ts"]);
    expect(out).toContain("===== NEW FILE (untracked): new.ts =====");
    expect(out).toContain("+export const x = 1;");
    await clean(dir);
  });

  it("跳过二进制文件", async () => {
    const dir = await makeTmp();
    await fs.writeFile(path.join(dir, "img.bin"), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(path.join(dir, "ok.txt"), "text\n");
    const out = await collectUntrackedContents(dir, ["img.bin", "ok.txt"]);
    expect(out).toContain("ok.txt");
    expect(out).not.toContain("img.bin");
    await clean(dir);
  });

  it("多行文件按行加前缀", async () => {
    const dir = await makeTmp();
    await fs.writeFile(path.join(dir, "m.ts"), "a\nb\nc");
    const out = await collectUntrackedContents(dir, ["m.ts"]);
    expect(out).toContain("+a\n+b\n+c");
    await clean(dir);
  });

  it("空列表返回空串", async () => {
    const dir = await makeTmp();
    expect(await collectUntrackedContents(dir, [])).toBe("");
    await clean(dir);
  });
});

describe("stripDiffMetadata", () => {
  it("去除 diff --git / index / mode / similarity 元数据行", () => {
    const input = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1234567..abcdef0 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "new file mode 100644",
      "index 0000000..1111111 100644",
      "--- /dev/null",
      "+++ b/src/b.ts",
    ].join("\n");

    const out = stripDiffMetadata(input);
    expect(out).not.toContain("diff --git");
    expect(out).not.toContain("index ");
    expect(out).not.toContain("new file mode");
    // 保留 hunk 头与增删行
    expect(out).toContain("@@ -1,3 +1,3 @@");
    expect(out).toContain("-old");
    expect(out).toContain("+new");
  });

  it("无元数据行时原样保留", () => {
    const input = "@@ -1 +1 @@\n-foo\n+bar";
    expect(stripDiffMetadata(input)).toBe(input);
  });
});

describe("isExcludedPath", () => {
  it("识别锁文件与压缩产物", () => {
    expect(isExcludedPath("package-lock.json")).toBe(true);
    expect(isExcludedPath("pnpm-lock.yaml")).toBe(true);
    expect(isExcludedPath("dist/app.min.js")).toBe(true);
    expect(isExcludedPath("assets/style.min.css")).toBe(true);
    expect(isExcludedPath("src/lib.js.map")).toBe(true);
  });

  it("普通源码不排除", () => {
    expect(isExcludedPath("src/index.ts")).toBe(false);
    expect(isExcludedPath("README.md")).toBe(false);
    expect(isExcludedPath("foo.lock.ts")).toBe(false);
  });
});

describe("splitDiffIntoSections", () => {
  it("按 diff --git 边界切分多文件", () => {
    const input = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    const sections = splitDiffIntoSections(input);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain("src/a.ts");
    expect(sections[1]).toContain("src/b.ts");
    expect(sections[1]).not.toContain("src/a.ts");
  });

  it("单文件返回单段", () => {
    const input = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b";
    expect(splitDiffIntoSections(input)).toHaveLength(1);
  });

  it("无 diff --git 行时不切分", () => {
    const input = "@@ -1 +1 @@\n-foo\n+bar";
    expect(splitDiffIntoSections(input)).toHaveLength(1);
  });

  it("空串返回空数组", () => {
    expect(splitDiffIntoSections("")).toEqual([]);
  });
});

describe("sampleSection", () => {
  const section = [
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,3 +1,3 @@",
    " a",
    "-b",
    "+B",
    " c",
    "@@ -10,3 +10,3 @@",
    " x",
    "-y",
    "+Y",
    " z",
  ].join("\n");

  it("配额足够时原样返回", () => {
    expect(sampleSection(section, section.length)).toBe(section);
  });

  it("超配额时保留文件头与首个 hunk，且 hunk 完整", () => {
    // 配额 = 文件头 + 第一个 hunk：第二个 hunk 必然被舍去
    const headerLen = "--- a/x.ts\n+++ b/x.ts".length;
    const firstHunkLen = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c".length;
    const out = sampleSection(section, headerLen + firstHunkLen);
    expect(out).toContain("--- a/x.ts");
    expect(out).toContain("+++ b/x.ts");
    expect(out).toContain("@@ -1,3 +1,3 @@");
    expect(out).not.toContain("@@ -10,3 +10,3 @@");
    // 首个 hunk 完整收尾，没有被从中间切断
    const hunkStart = out.indexOf("@@ -1,3 +1,3 @@");
    const tail = out.slice(hunkStart).split("\n");
    expect(tail[tail.length - 1]).toBe(" c");
  });

  it("采样结果确定（同一输入同一配额输出一致）", () => {
    const a = sampleSection(section, 40);
    const b = sampleSection(section, 40);
    expect(a).toBe(b);
  });

  it("无 hunk 段落按行边界截断，不切行", () => {
    const blob = "===== NEW FILE (untracked): f.ts =====\n+f1\n+f2\n+f3\n+f4";
    const out = sampleSection(blob, 12);
    const lines = out.split("\n");
    for (const line of lines) {
      expect(line).toMatch(/^(===== NEW FILE|\+)/);
    }
    expect(out.length).toBeLessThanOrEqual(blob.length);
  });

  it("配额小于文件头时只返回文件头", () => {
    const out = sampleSection(section, 10);
    expect(out).toContain("--- a/x.ts");
    expect(out).not.toContain("@@");
  });
});

describe.skipIf(!gitAvailable)("collectChanges 集成（真实 git 仓库）", () => {
  it("默认仅采集暂存区变更", async () => {
    const dir = await makeGitRepo();
    try {
      await fs.writeFile(path.join(dir, "a.ts"), "const a = 1;\n");
      await fs.writeFile(path.join(dir, "b.ts"), "const b = 2;\n");
      await fs.writeFile(path.join(dir, "c.ts"), "const c = 3;\n");
      git(dir, "add", ".");
      git(dir, "commit", "-m", "init");
      // staged：a.ts / b.ts
      await fs.writeFile(path.join(dir, "a.ts"), "const a = 10;\n");
      await fs.writeFile(path.join(dir, "b.ts"), "const b = 20;\n");
      git(dir, "add", "a.ts", "b.ts");
      // unstaged：c.ts；untracked：e.ts
      await fs.writeFile(path.join(dir, "c.ts"), "const c = 30;\n");
      await fs.writeFile(path.join(dir, "e.ts"), "const e = 5;\n");

      const { diff, hasChanges, sampled } = await collectChanges(dir, 100_000);
      expect(hasChanges).toBe(true);
      expect(sampled).toBe(false);
      expect(diff).toContain("STAGED CHANGES");
      expect(diff).toContain("+++ b/a.ts");
      expect(diff).toContain("+++ b/b.ts");
      expect(diff).not.toContain("c.ts");
      expect(diff).not.toContain("e.ts");
      expect(diff).not.toContain("UNSTAGED");
      expect(diff).not.toContain("UNTRACKED");
    } finally {
      await clean(dir);
    }
  });

  it("scope=all 包含未暂存与未跟踪变更", async () => {
    const dir = await makeGitRepo();
    try {
      await fs.writeFile(path.join(dir, "a.ts"), "const a = 1;\n");
      await fs.writeFile(path.join(dir, "c.ts"), "const c = 3;\n");
      git(dir, "add", ".");
      git(dir, "commit", "-m", "init");
      await fs.writeFile(path.join(dir, "a.ts"), "const a = 10;\n");
      git(dir, "add", "a.ts");
      await fs.writeFile(path.join(dir, "c.ts"), "const c = 30;\n");
      await fs.writeFile(path.join(dir, "e.ts"), "const e = 5;\n");

      const { diff } = await collectChanges(dir, 100_000, "all");
      expect(diff).toContain("UNSTAGED CHANGES");
      expect(diff).toContain("+++ b/c.ts");
      expect(diff).toContain("UNTRACKED FILES");
      expect(diff).toContain("e.ts");
    } finally {
      await clean(dir);
    }
  });

  it("无任何变更时 hasChanges=false", async () => {
    const dir = await makeGitRepo();
    try {
      await fs.writeFile(path.join(dir, "a.ts"), "const a = 1;\n");
      git(dir, "add", ".");
      git(dir, "commit", "-m", "init");
      const { diff, hasChanges } = await collectChanges(dir, 100_000);
      expect(hasChanges).toBe(false);
      expect(diff).toBe("");
    } finally {
      await clean(dir);
    }
  });

  it("超预算时按比例采样：全部文件保留 + 附统计，且不整体截断", async () => {
    const dir = await makeGitRepo();
    try {
      const big = Array.from({ length: 120 }, (_, i) => `line${i} = ${i};`);
      await fs.writeFile(path.join(dir, "big.ts"), big.join("\n") + "\n");
      await fs.writeFile(path.join(dir, "small.ts"), "const s = 1;\n");
      git(dir, "add", ".");
      git(dir, "commit", "-m", "init");
      const big2 = big.map((l, i) =>
        i % 2 === 0 ? l.replace(";", " + 1;") : l
      );
      await fs.writeFile(path.join(dir, "big.ts"), big2.join("\n") + "\n");
      await fs.writeFile(path.join(dir, "small.ts"), "const s = 2;\n");
      git(dir, "add", ".");

      const { diff, hasChanges, sampled } = await collectChanges(dir, 2000);
      expect(hasChanges).toBe(true);
      expect(sampled).toBe(true);
      expect(diff).toContain("big.ts");
      expect(diff).toContain("small.ts"); // 下限保证小文件不被大文件挤掉
      expect(diff).toContain("注意：变更内容过大");
      expect(diff).toContain("Staged:");
      // 输出 ≈ 采样预算 + 注记 + 统计，远小于原始 diff
      expect(diff.length).toBeGreaterThan(0);
      expect(diff.length).toBeLessThan(3000);
    } finally {
      await clean(dir);
    }
  });
});
