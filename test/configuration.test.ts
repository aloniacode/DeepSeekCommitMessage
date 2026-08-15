import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vscode from "vscode";
import {
  getRequestTimeoutMs,
  getMaxRetries,
  getMaxDiffChars,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_DIFF_CHARS,
} from "../src/configuration";

function mockConfig(values: Record<string, unknown>): void {
  const get = vi.fn(
    (key: string, def: unknown) => (key in values ? values[key] : def)
  );
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as never);
}

describe("配置读取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未配置时返回默认值", () => {
    mockConfig({});
    expect(getRequestTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    expect(getMaxRetries()).toBe(DEFAULT_MAX_RETRIES);
    expect(getMaxDiffChars()).toBe(DEFAULT_MAX_DIFF_CHARS);
  });

  it("读取自定义值", () => {
    mockConfig({ requestTimeout: 60000, maxRetries: 5, maxDiffChars: 10000 });
    expect(getRequestTimeoutMs()).toBe(60000);
    expect(getMaxRetries()).toBe(5);
    expect(getMaxDiffChars()).toBe(10000);
  });

  it("非法值回退默认", () => {
    mockConfig({ requestTimeout: 0, maxRetries: -1, maxDiffChars: 0 });
    expect(getRequestTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    expect(getMaxRetries()).toBe(DEFAULT_MAX_RETRIES);
    expect(getMaxDiffChars()).toBe(DEFAULT_MAX_DIFF_CHARS);
  });

  it("maxRetries 向下取整", () => {
    mockConfig({ maxRetries: 2.9 });
    expect(getMaxRetries()).toBe(2);
  });
});

describe("配置注册契约", () => {
  it("package.json 注册 deepseekCommitMessage.apiKey（setApiKey/deleteApiKey 的 update 依赖注册，未注册时 VSCode 拒绝写入）", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; scope?: string }>;
        };
      };
    };
    const prop =
      pkg.contributes.configuration.properties["deepseekCommitMessage.apiKey"];
    expect(prop?.type).toBe("string");
    expect(prop?.scope).toBe("application");
  });
});
