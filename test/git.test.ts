import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { isBinaryFile, collectUntrackedContents } from "../src/git";

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dcm-test-"));
}

async function clean(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
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
