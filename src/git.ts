import * as vscode from "vscode";
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

/** 执行一条 git 命令，返回 stdout；命令不存在或失败时返回空串。 */
async function runGit(
  cwd: string,
  ...args: string[]
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `git ${args.join(" ")}`,
      { cwd, maxBuffer: 16 * 1024 * 1024 }
    );
    return stdout;
  } catch {
    return "";
  }
}

/** 判断指定目录是否为 git 仓库。 */
export async function isGitRepository(cwd: string): Promise<boolean> {
  const out = await runGit(cwd, "rev-parse", "--is-inside-work-tree");
  return out.trim() === "true";
}

/** 获取 git 仓库根目录；失败返回空串。 */
export async function getRepoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, "rev-parse", "--show-toplevel");
  return out.trim();
}

/** 收集 staged / unstaged 变更及未跟踪文件列表，拼接成一段 diff 文本。 */
export async function collectChanges(cwd: string): Promise<{
  diff: string;
  hasChanges: boolean;
}> {
  const staged = await runGit(cwd, "diff", "--cached");
  const unstaged = await runGit(cwd, "diff");
  const untracked = await runGit(
    cwd,
    "ls-files",
    "--others",
    "--exclude-standard"
  );

  const parts: string[] = [];
  if (staged.trim()) {
    parts.push(`===== STAGED CHANGES (git diff --cached) =====\n${staged.trim()}`);
  }
  if (unstaged.trim()) {
    parts.push(`===== UNSTAGED CHANGES (git diff) =====\n${unstaged.trim()}`);
  }
  if (untracked.trim()) {
    parts.push(`===== UNTRACKED FILES =====\n${untracked.trim()}`);
  }

  return {
    diff: parts.join("\n\n"),
    hasChanges: parts.length > 0,
  };
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
