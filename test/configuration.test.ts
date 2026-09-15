import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vscode from "vscode";
import {
  getRequestTimeoutMs,
  getMaxRetries,
  getMaxDiffChars,
  getChangeScope,
  getModel,
  setModel,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_DIFF_CHARS,
  DEFAULT_CHANGE_SCOPE,
  DEFAULT_MODEL,
  FALLBACK_MODELS,
} from "../src/configuration";

function mockConfig(values: Record<string, unknown>): void {
  const get = vi.fn(
    (key: string, def: unknown) => (key in values ? values[key] : def)
  );
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as never);
}

describe("模型配置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未配置时返回默认模型 ID", () => {
    mockConfig({});
    expect(getModel()).toBe(DEFAULT_MODEL);
  });

  it("读取自定义模型 ID", () => {
    mockConfig({ model: "deepseek-reasoner" });
    expect(getModel()).toBe("deepseek-reasoner");
  });

  it("旧版本 pro / flash 迁移到完整模型 ID", () => {
    mockConfig({ model: "pro" });
    expect(getModel()).toBe("deepseek-v4-pro");
    mockConfig({ model: "flash" });
    expect(getModel()).toBe("deepseek-v4-flash");
  });

  it("空白模型值回退默认", () => {
    mockConfig({ model: "   " });
    expect(getModel()).toBe(DEFAULT_MODEL);
  });

  it("FALLBACK_MODELS 提供内置默认列表，供接口不可用时兜底", () => {
    expect(FALLBACK_MODELS).toContain("deepseek-v4-pro");
    expect(FALLBACK_MODELS).toContain("deepseek-v4-flash");
  });

  it("setModel 去空白写入", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(),
      update,
    } as never);
    await setModel("  deepseek-v4-pro  ");
    expect(update).toHaveBeenCalledWith(
      "model",
      "deepseek-v4-pro",
      vscode.ConfigurationTarget.Global
    );
  });

  it("setModel 空值抛错", async () => {
    const update = vi.fn();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(),
      update,
    } as never);
    await expect(setModel("   ")).rejects.toThrow("模型 ID 不能为空");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("配置读取", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未配置时返回默认值", () => {
    mockConfig({});
    expect(getRequestTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    expect(getMaxRetries()).toBe(DEFAULT_MAX_RETRIES);
    expect(getMaxDiffChars()).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(getChangeScope()).toBe(DEFAULT_CHANGE_SCOPE);
  });

  it("读取自定义值", () => {
    mockConfig({
      requestTimeout: 60000,
      maxRetries: 5,
      maxDiffChars: 10000,
      changeScope: "all",
    });
    expect(getRequestTimeoutMs()).toBe(60000);
    expect(getMaxRetries()).toBe(5);
    expect(getMaxDiffChars()).toBe(10000);
    expect(getChangeScope()).toBe("all");
  });

  it("非法值回退默认", () => {
    mockConfig({
      requestTimeout: 0,
      maxRetries: -1,
      maxDiffChars: 0,
      changeScope: "everything",
    });
    expect(getRequestTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    expect(getMaxRetries()).toBe(DEFAULT_MAX_RETRIES);
    expect(getMaxDiffChars()).toBe(DEFAULT_MAX_DIFF_CHARS);
    expect(getChangeScope()).toBe(DEFAULT_CHANGE_SCOPE);
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

  it("package.json 注册 deepseekCommitMessage.changeScope（枚举 staged/all，默认 staged）", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      contributes: {
        configuration: {
          properties: Record<string, { type?: string; enum?: string[]; default?: string }>;
        };
      };
    };
    const prop =
      pkg.contributes.configuration.properties["deepseekCommitMessage.changeScope"];
    expect(prop?.type).toBe("string");
    expect(prop?.enum).toEqual(["staged", "all"]);
    expect(prop?.default).toBe("staged");
  });
});
