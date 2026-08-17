import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { ChangeScope } from "./configuration";

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
  /** 变更内容超出预算时是否按比例采样（而非整体截断）。 */
  sampled: boolean;
}

/** 未跟踪文件内容采集上限，防止超大仓库拖垮生成。 */
const MAX_UNTRACKED_FILES = 30;
const MAX_UNTRACKED_TOTAL_BYTES = 200 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 64 * 1024;

/** 采样时单个文件的最低下限（字符数）：保证每个变更文件都至少保留一小段。 */
const MIN_SAMPLE_CHARS_PER_SECTION = 200;

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

/** 将一份原始 git diff 按 `diff --git` 边界切分为按文件划分的段落。 */
export function splitDiffIntoSections(raw: string): string[] {
  if (raw.trim().length === 0) {
    return [];
  }
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^diff --git /.test(line)) {
      if (current.length > 0) {
        sections.push(current.join("\n"));
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections;
}

/** 稳定字符串哈希（djb2），用于确定性采样排序：同一 diff 每次采样结果一致。 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 对单个文件的 diff 段落按配额采样：
 * - 文件头（路径等）始终保留；
 * - 变更 hunk 按稳定哈希排序后整块选取，尽量覆盖文件各处且不切断 hunk；
 * - 第一个 hunk（文件头部的变更上下文）尽可能保留。
 */
export function sampleSection(text: string, quota: number): string {
  if (text.length <= quota) {
    return text;
  }
  const lines = text.split("\n");
  const header: string[] = [];
  const hunks: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@@")) {
    header.push(lines[i]);
    i++;
  }
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      hunks.push(current.join("\n"));
      current = [];
    }
  };
  for (; i < lines.length; i++) {
    if (lines[i].startsWith("@@")) {
      flush();
    }
    current.push(lines[i]);
  }
  flush();

  const headerText = header.join("\n");
  if (hunks.length === 0) {
    // 无 hunk（重命名/二进制/未跟踪内容）：按行边界截断，不切行
    if (headerText.length <= quota) {
      return headerText;
    }
    const slice = headerText.slice(0, quota);
    const lastNl = slice.lastIndexOf("\n");
    if (lastNl > 0) {
      return slice.slice(0, lastNl);
    }
    // 首行本身超配额：保留整行（文件头信息比空输出更有价值）
    return headerText.split("\n", 1)[0];
  }
  if (headerText.length >= quota) {
    return headerText;
  }

  const order = hunks
    .map((h, idx) => ({ idx, size: h.length, key: hashString(h) }))
    .sort((a, b) => a.key - b.key || a.idx - b.idx);

  const picked: boolean[] = new Array(hunks.length).fill(false);
  let pickedCount = 0;
  let used = headerText.length;
  for (const o of order) {
    if (used + o.size <= quota) {
      picked[o.idx] = true;
      pickedCount++;
      used += o.size;
    }
  }

  // 无论哈希分布如何，尽量保留第一个 hunk
  if (!picked[0]) {
    if (used + hunks[0].length <= quota) {
      picked[0] = true;
      pickedCount++;
      used += hunks[0].length;
    } else if (pickedCount > 0) {
      // 移除最大的已选 hunk，为第一个 hunk 腾出空间
      const largestIdx = order
        .filter((o) => picked[o.idx] && o.idx !== 0)
        .sort((a, b) => b.size - a.size)[0];
      if (largestIdx && used - largestIdx.size + hunks[0].length <= quota) {
        picked[largestIdx.idx] = false;
        picked[0] = true;
      }
    }
  }

  const parts = [headerText];
  for (let idx = 0; idx < hunks.length; idx++) {
    if (picked[idx]) {
      parts.push(hunks[idx]);
    }
  }
  return parts.join("\n");
}

/** 按文件大小占比分配预算；每个文件至少保留 MIN_SAMPLE_CHARS_PER_SECTION 字符。 */
function allocateQuotas(sizes: number[], budget: number): number[] {
  const n = sizes.length;
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= budget) {
    return sizes.slice();
  }
  const floor = Math.min(MIN_SAMPLE_CHARS_PER_SECTION, Math.floor(budget / n));
  const quotas = sizes.map((s) => Math.min(s, floor));
  let remaining = budget - quotas.reduce((a, b) => a + b, 0);
  const remainingSizes = sizes.map((s, i) => Math.max(0, s - quotas[i]));
  const remTotal = remainingSizes.reduce((a, b) => a + b, 0);
  if (remTotal > 0 && remaining > 0) {
    const adds = remainingSizes.map((s) => Math.floor((s / remTotal) * remaining));
    for (let i = 0; i < n; i++) {
      quotas[i] += adds[i];
    }
  }
  // 取整零头分给最大的文件
  const leftover = budget - quotas.reduce((a, b) => a + b, 0);
  if (leftover > 0) {
    const maxIdx = quotas.indexOf(Math.max(...quotas));
    quotas[maxIdx] += leftover;
  }
  return quotas;
}

/** 将各文件段落渲染为最终文本；超预算时按文件比例采样。 */
function renderSections(
  sections: Array<{ label: string; text: string }>,
  budget: number
): string {
  const quotas = allocateQuotas(
    sections.map((s) => s.text.length),
    budget
  );
  const parts: string[] = [];
  let currentLabel = "";
  for (let i = 0; i < sections.length; i++) {
    const { label, text } = sections[i];
    if (label !== currentLabel) {
      currentLabel = label;
      parts.push(`===== ${label} CHANGES =====`);
    }
    parts.push(sampleSection(text, quotas[i]));
  }
  return parts.join("\n\n");
}

/**
 * 收集变更并拼接成一段 diff 文本。
 * 默认仅采集暂存区（staged）变更；`scope === "all"` 时额外包含未暂存修改与未跟踪文件。
 * 超出 `maxChars` 预算时不整体截断，而是按文件比例采样（每个文件至少保留一小段，
 * hunk 保持完整），并附全量文件统计，让模型既有细节又有全貌。
 */
export async function collectChanges(
  cwd: string,
  maxChars: number,
  scope: ChangeScope = "staged"
): Promise<ChangeCollection> {
  const excludeSpecs = buildExcludeSpecs();
  // -U1 将默认 3 行上下文降为 1 行；--minimal 让 git 生成更精简的 diff
  const diffArgs = ["-U1", "--minimal", "--", ...excludeSpecs];

  const sections: Array<{ label: string; text: string }> = [];
  const pushDiff = (label: string, raw: string): void => {
    for (const section of splitDiffIntoSections(raw)) {
      const text = stripDiffMetadata(section).trim();
      if (text) {
        sections.push({ label, text });
      }
    }
  };

  const staged = await runGit(cwd, "diff", "--cached", ...diffArgs);
  pushDiff("STAGED", staged.ok ? staged.stdout : "");

  if (scope === "all") {
    const unstaged = await runGit(cwd, "diff", ...diffArgs);
    pushDiff("UNSTAGED", unstaged.ok ? unstaged.stdout : "");

    const untracked = await runGit(
      cwd,
      "ls-files",
      "--others",
      "--exclude-standard"
    );
    const untrackedList = untracked.ok
      ? untracked.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((rel) => !isExcludedPath(rel))
      : [];
    if (untrackedList.length > 0) {
      const contents = await collectUntrackedContents(cwd, untrackedList);
      const blob = [
        `===== UNTRACKED FILES =====\n${untrackedList.join("\n")}`,
        contents,
      ]
        .filter(Boolean)
        .join("\n\n");
      if (blob.trim()) {
        sections.push({ label: "UNTRACKED", text: blob });
      }
    }
  }

  if (sections.length === 0) {
    return { diff: "", hasChanges: false, sampled: false };
  }

  const totalChars = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars <= maxChars) {
    return {
      diff: renderSections(sections, totalChars),
      hasChanges: true,
      sampled: false,
    };
  }

  // 超预算：预留统计摘要空间后按文件比例采样，避免简单截断丢失尾部变更
  const stat = await collectStatSummary(cwd, excludeSpecs, scope);
  const budget = Math.max(1, maxChars - stat.length - 128);
  const sampledDiff = renderSections(sections, budget);
  return {
    diff:
      sampledDiff +
      `\n\n[注意：变更内容过大（约 ${totalChars} 字符），以上为按文件比例采样的变更，未展示的变更见下方文件统计。]\n${stat}`,
    hasChanges: true,
    sampled: true,
  };
}

/** 用 `git diff --stat` 生成简短的文件级变更统计，作为超大 diff 的兜底摘要。 */
async function collectStatSummary(
  cwd: string,
  excludeSpecs: string[],
  scope: ChangeScope
): Promise<string> {
  const parts: string[] = [];
  const stagedStat = await runGit(
    cwd,
    "diff",
    "--cached",
    "--stat",
    "--",
    ...excludeSpecs
  );
  if (stagedStat.ok && stagedStat.stdout.trim()) {
    parts.push(`Staged:\n${stagedStat.stdout.trim()}`);
  }
  if (scope === "all") {
    const unstagedStat = await runGit(
      cwd,
      "diff",
      "--stat",
      "--",
      ...excludeSpecs
    );
    if (unstagedStat.ok && unstagedStat.stdout.trim()) {
      parts.push(`Unstaged:\n${unstagedStat.stdout.trim()}`);
    }
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
