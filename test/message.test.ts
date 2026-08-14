import { describe, it, expect } from "vitest";
import { sanitizeCommitMessage, isConventionalSubject } from "../src/message";

describe("sanitizeCommitMessage", () => {
  it("去除无语言标识的 markdown 代码围栏", () => {
    expect(sanitizeCommitMessage("```\nfeat: add login\n```")).toBe(
      "feat: add login"
    );
  });

  it("去除带语言标识的代码围栏", () => {
    expect(sanitizeCommitMessage("```markdown\nfix: typo\n```")).toBe(
      "fix: typo"
    );
  });

  it("剥离中文前言客套", () => {
    expect(
      sanitizeCommitMessage(
        "好的，以下是为您生成的 commit message：\nfeat(api): add user endpoint"
      )
    ).toBe("feat(api): add user endpoint");
  });

  it("剥离英文前言", () => {
    expect(
      sanitizeCommitMessage("Here is the commit message:\nfeat: add thing")
    ).toBe("feat: add thing");
  });

  it("剥离前置空行与冒号", () => {
    expect(sanitizeCommitMessage("\n\n：\nfeat: do work")).toBe("feat: do work");
  });

  it("保留合法主题行及其 body", () => {
    const input = "feat(core): add retry\n\nadd exponential backoff";
    expect(sanitizeCommitMessage(input)).toBe(input);
  });

  it("空输入与纯空白返回空串", () => {
    expect(sanitizeCommitMessage("")).toBe("");
    expect(sanitizeCommitMessage("   \n  ")).toBe("");
  });

  it("非客套词的首行不误删", () => {
    expect(sanitizeCommitMessage("BREAKING CHANGE: drop node 16")).toBe(
      "BREAKING CHANGE: drop node 16"
    );
  });
});

describe("isConventionalSubject", () => {
  it("识别合法 type 与带 scope 的主题行", () => {
    expect(isConventionalSubject("feat: x")).toBe(true);
    expect(isConventionalSubject("fix(scope): x")).toBe(true);
    expect(isConventionalSubject("chore(deps): bump")).toBe(true);
  });

  it("拒绝非规范行", () => {
    expect(isConventionalSubject("hello world")).toBe(false);
    expect(isConventionalSubject("FEAT: x")).toBe(false); // 大写不匹配
    expect(isConventionalSubject("feat x")).toBe(false); // 缺冒号
  });
});
