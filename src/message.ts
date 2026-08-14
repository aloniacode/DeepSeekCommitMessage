/** 常见 AI 生成时的前言/客套话，用于剥离开头非 commit message 的内容。 */
const PREAMBLE_RE = /^(好的|当然|以下|这是|为你|为您|为你生成|为你生成了|为您生成了|Sure|Okay|Ok|Certainly|Here is|Here's)/i;

/** 判断一行文本是否为合法的 Conventional Commits 主题行。 */
export function isConventionalSubject(line: string): boolean {
  return /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?:/.test(
    line.trim()
  );
}

/**
 * 清理模型返回的文本：去掉 markdown 代码围栏、前言客套、前后空白。
 * 会从首行开始剥离前言，直到遇到首个合法的 Conventional Commits 主题行。
 */
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim();
  // 去除包裹的 ``` 或 ```markdown 围栏
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*/g, "");
  text = text.replace(/```\s*$/g, "");
  text = text.trim();

  // 剥离开头的前言客套行，直到遇到首个合法主题行
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && !isConventionalSubject(lines[0])) {
    const first = lines[0].trim();
    if (PREAMBLE_RE.test(first) || first === "" || /^[:：]/.test(first)) {
      lines.shift();
    } else {
      break;
    }
  }
  return lines.join("\n").trim();
}
