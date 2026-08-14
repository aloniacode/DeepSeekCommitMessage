import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** 内置 Git 扩展暴露的 API（仅用到我们需要的字段）。 */
interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

/** git 命令执行结果（不再吞掉错误，便于区分失败原因）。 */
export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** 收集到的变更信息。 */
export interface ChangeCollection {
  diff: string;
  hasChanges: boolean;
  truncated: boolean;
}

/** 未跟踪文件内容采集上限，防止超大仓库拖垮生成。 */
const MAX_UNTRACKED_FILES = 30;
const MAX_UNTRACKED_TOTAL_BYTES = 200 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 64 * 1024;

/**
 * diff 采集时排除的文件模式（对 commit message 价值低且体积大）：
 * 各类锁文件、压缩产物、sourcemap。用于节省 token。
 */
const EXCLUDED_DIFF_PATHS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "*.min.js",
  "*.min.css",
  "*.map",
];

/** 执行一条 git 命令，返回结构化结果（stdout + 是否成功）。 */
async function runGit(cwd: string, ...args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args.join(" ")}`, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
    };
  }
}

/** 判断当前环境是否安装了 git。 */
export async function isGitAvailable(cwd: string): Promise<boolean> {
  const out = await runGit(cwd, "--version");
  return out.ok;
}

/** 判断指定目录是否为 git 仓库。 */
export async function isGitRepository(cwd: string): Promise<boolean> {
  const out = await runGit(cwd, "rev-parse", "--is-inside-work-tree");
  return out.ok && out.stdout.trim() === "true";
}

/** 获取 git 仓库根目录；失败返回空串。 */
export async function getRepoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, "rev-parse", "--show-toplevel");
  return out.ok ? out.stdout.trim() : "";
}

/** 判断文件是否为二进制（读取首部 8KB，若含 NUL 字节则视为二进制）。 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) {
          return true;
        }
      }
      return false;
    } finally {
      await handle.close();
    }
  } catch {
    // 读取失败（无权限等）时按二进制跳过，避免拖垮流程
    return true;
  }
}

/** 读取未跟踪的文本文件内容，以「新增文件」形式拼接进 diff，提升新文件场景的生成质量。 */
export async function collectUntrackedContents(
  cwd: string,
  untracked: string[]
): Promise<string> {
  const parts: string[] = [];
  let totalBytes = 0;

  for (const rel of untracked) {
    if (parts.length >= MAX_UNTRACKED_FILES || totalBytes >= MAX_UNTRACKED_TOTAL_BYTES) {
      break;
    }
    const abs = path.resolve(cwd, rel);
    if (await isBinaryFile(abs)) {
      continue;
    }
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) {
      continue;
    }
    try {
      const content = await fs.readFile(abs, "utf8");
      const prefixed = content
        .split(/\r?\n/)
        .map((line) => `+${line}`)
        .join("\n");
      parts.push(`===== NEW FILE (untracked): ${rel} =====\n${prefixed}`);
      totalBytes += stat.size;
    } catch {
      // 忽略单个文件读取失败
    }
  }

  return parts.join("\n\n");
}

/** 将排除模式转为 git pathspec 的 exclude 写法。 */
function buildExcludeSpecs(): string[] {
  return EXCLUDED_DIFF_PATHS.map((p) => `:(exclude)${p}`);
}

/** 判断相对路径是否命中排除模式（支持 `*` 通配）。 */
export function isExcludedPath(rel: string): boolean {
  return EXCLUDED_DIFF_PATHS.some((pattern) => {
    const re = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    return re.test(rel);
  });
}

/** 去除 diff 中对生成 commit message 无用的元数据行，进一步节省 token。 */
export function stripDiffMetadata(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => {
      if (/^diff --git /.test(line)) return false;
      if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)) return false;
      if (/^(new file mode|deleted file mode|old mode|new mode) /.test(line)) {
        return false;
      }
      if (/^similarity index /.test(line)) return false;
      return true;
    })
    .join("\n");
}

/** 收集 staged / unstaged 变更及未跟踪文件内容，拼接成一段 diff 文本。 */
export async function collectChanges(
  cwd: string,
  maxChars: number
): Promise<ChangeCollection> {
  const excludeSpecs = buildExcludeSpecs();
  // -U1 将默认 3 行上下文降为 1 行；--minimal 让 git 生成更精简的 diff
  const diffArgs = ["-U1", "--minimal", "--", ...excludeSpecs];

  const staged = await runGit(cwd, "diff", "--cached", ...diffArgs);
  const unstaged = await runGit(cwd, "diff", ...diffArgs);
  const untracked = await runGit(cwd, "ls-files", "--others", "--exclude-standard");

  const parts: string[] = [];
  const push = (header: string, body: string) => {
    if (body.trim()) {
      parts.push(`${header}\n${body.trim()}`);
    }
  };

  push(
    "===== STAGED CHANGES =====",
    staged.ok ? stripDiffMetadata(staged.stdout) : ""
  );
  push(
    "===== UNSTAGED CHANGES =====",
    unstaged.ok ? stripDiffMetadata(unstaged.stdout) : ""
  );

  const untrackedList = untracked.ok
    ? untracked.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((rel) => !isExcludedPath(rel))
    : [];
  if (untrackedList.length > 0) {
    push("===== UNTRACKED FILES =====", untrackedList.join("\n"));
    const contents = await collectUntrackedContents(cwd, untrackedList);
    if (contents) {
      parts.push(contents);
    }
  }

  let diff = parts.join("\n\n");
  let truncated = false;
  if (diff.length > maxChars) {
    truncated = true;
    // 超预算时：截断正文 + 附加全量变更统计，让模型既有细节又有全貌
    const stat = await collectStatSummary(cwd, excludeSpecs);
    diff =
      diff.slice(0, maxChars) +
      `\n\n[注意：变更内容过大，已截断。以下为全部变更的文件统计：]\n${stat}`;
  }

  return {
    diff,
    hasChanges: parts.length > 0,
    truncated,
  };
}

/** 用 `git diff --stat` 生成简短的文件级变更统计，作为超大 diff 的兜底摘要。 */
async function collectStatSummary(
  cwd: string,
  excludeSpecs: string[]
): Promise<string> {
  const stagedStat = await runGit(
    cwd,
    "diff",
    "--cached",
    "--stat",
    "--",
    ...excludeSpecs
  );
  const unstagedStat = await runGit(cwd, "diff", "--stat", "--", ...excludeSpecs);

  const parts: string[] = [];
  if (stagedStat.ok && stagedStat.stdout.trim()) {
    parts.push(`Staged:\n${stagedStat.stdout.trim()}`);
  }
  if (unstagedStat.ok && unstagedStat.stdout.trim()) {
    parts.push(`Unstaged:\n${unstagedStat.stdout.trim()}`);
  }
  return parts.join("\n\n") || "(无法获取变更统计)";
}

/** 解析当前要操作的工作区目录（优先活动编辑器所在目录，其次首个工作区目录）。 */
export function resolveWorkspaceFolder(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** 获取内置 Git 扩展 API（必要时先激活）。 */
async function getGitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) {
    return undefined;
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports?.getAPI(1);
}

/**
 * 将 commit message 填充到 SCM 输入框。
 * @param message 生成的 commit message
 * @param repoRoot 仓库根目录（用于在多个仓库间精确定位）
 */
export async function fillScmInputBox(
  message: string,
  repoRoot?: string
): Promise<boolean> {
  const git = await getGitApi();
  if (!git || git.repositories.length === 0) {
    return false;
  }

  let repo = git.repositories[0];
  if (repoRoot) {
    const matched = git.repositories.find(
      (r) => r.rootUri.fsPath.toLowerCase() === repoRoot.toLowerCase()
    );
    if (matched) {
      repo = matched;
    }
  }

  repo.inputBox.value = message;
  return true;
}
