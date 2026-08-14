import { describe, it, expect } from "vitest";
import {
  DeepSeekError,
  isRetryable,
  isRetryableStatus,
  isContextOverflow,
  extractError,
  backoffMs,
} from "../src/deepseek";

describe("isRetryable", () => {
  it("网络错误（无 statusCode）可重试", () => {
    expect(isRetryable(new DeepSeekError("网络请求失败：xxx"))).toBe(true);
  });

  it("限流 429 可重试", () => {
    expect(
      isRetryable(new DeepSeekError("rate limit", { statusCode: 429 }))
    ).toBe(true);
  });

  it("服务端 5xx 可重试", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(
        isRetryable(new DeepSeekError("x", { statusCode: code }))
      ).toBe(true);
    }
  });

  it("客户端 4xx（400/401/402/403）不可重试", () => {
    for (const code of [400, 401, 402, 403]) {
      expect(
        isRetryable(new DeepSeekError("x", { statusCode: code }))
      ).toBe(false);
    }
  });

  it("非 DeepSeekError 不可重试", () => {
    expect(isRetryable(new Error("x"))).toBe(false);
  });

  it("显式 retryable=true 时即使有 statusCode 也可重试", () => {
    expect(
      isRetryable(new DeepSeekError("空返回", { statusCode: 200, retryable: true }))
    ).toBe(true);
  });
});

describe("isRetryableStatus", () => {
  it("识别可重试状态码", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
  });

  it("undefined 与不可重试码返回 false", () => {
    expect(isRetryableStatus(undefined)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
  });
});

describe("isContextOverflow", () => {
  it("400 + 上下文关键词返回 true", () => {
    expect(isContextOverflow(400, "maximum context length exceeded")).toBe(true);
    expect(isContextOverflow(400, "输入过长")).toBe(true);
    expect(isContextOverflow(400, "exceed token limit")).toBe(true);
  });

  it("非 400 返回 false", () => {
    expect(isContextOverflow(429, "maximum context length")).toBe(false);
    expect(isContextOverflow(undefined, "maximum context length")).toBe(false);
  });

  it("400 但非上下文错误返回 false", () => {
    expect(isContextOverflow(400, "invalid model")).toBe(false);
  });
});

describe("extractError", () => {
  it("解析 JSON error 对象并提取 code", () => {
    expect(
      extractError('{"error":{"message":"bad key","code":"invalid_api_key"}}')
    ).toEqual({ message: "bad key", code: "invalid_api_key" });
  });

  it("无 code 时只返回 message", () => {
    expect(extractError('{"error":{"message":"oops"}}')).toEqual({
      message: "oops",
    });
  });

  it("非 JSON 时返回原文", () => {
    expect(extractError("plain text")).toEqual({ message: "plain text" });
  });

  it("空串返回未知错误", () => {
    expect(extractError("")).toEqual({ message: "未知错误" });
  });
});

describe("backoffMs", () => {
  it("退避随次数增长且封顶 5000 + 抖动", () => {
    const b0 = backoffMs(0);
    expect(b0).toBeGreaterThanOrEqual(1000);
    expect(b0).toBeLessThan(1500);

    const b10 = backoffMs(10);
    expect(b10).toBeGreaterThanOrEqual(5000);
    expect(b10).toBeLessThan(5500);
  });
});
