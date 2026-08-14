import * as https from "https";

/** DeepSeek OpenAI 兼容接口地址。 */
const BASE_URL = "https://api.deepseek.com";

/** 默认请求超时时间（毫秒），可被配置项覆盖。 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 默认最大重试次数（不含首次请求）。 */
export const DEFAULT_MAX_RETRIES = 2;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string; code?: string };
}

/** 生成结果：content 为文本，truncated 表示模型因 max_tokens 被截断。 */
export interface GenerateResult {
  content: string;
  truncated: boolean;
}

/** 生成调用选项。 */
export interface GenerateOptions {
  /** 请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 最大重试次数（不含首次）。 */
  maxRetries?: number;
  /** 取消信号，用于在用户取消时中断请求。 */
  signal?: AbortSignal;
}

/** DeepSeek 请求错误，携带 HTTP 状态码（网络/超时错误无 statusCode）。 */
export class DeepSeekError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts?: { statusCode?: number; code?: string; retryable?: boolean }
  ) {
    super(message);
    this.name = "DeepSeekError";
    if (opts?.statusCode !== undefined) {
      this.statusCode = opts.statusCode;
    }
    if (opts?.code !== undefined) {
      this.code = opts.code;
    }
    this.retryable = opts?.retryable ?? false;
  }
}

/** 判断错误是否可重试（瞬时错误：网络、超时、限流、服务端 5xx）。 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof DeepSeekError)) {
    return false;
  }
  if (err.retryable) {
    return true;
  }
  // 无 statusCode 说明是网络层/超时错误，可重试
  if (err.statusCode === undefined) {
    return true;
  }
  return [408, 429, 500, 502, 503, 504].includes(err.statusCode);
}

/** 从错误响应体中提取可读的错误信息与错误码。 */
export function extractError(raw: string): { message: string; code?: string } {
  try {
    const parsed = JSON.parse(raw);
    const err = parsed?.error;
    if (err && typeof err === "object") {
      const message = err.message ? String(err.message) : "";
      const code = err.code ? String(err.code) : undefined;
      if (message) {
        return { message, code };
      }
    }
  } catch {
    // 响应体不是 JSON，直接使用原始文本
  }
  return { message: raw || "未知错误" };
}

/** 检测 400 错误是否为「上下文/输入超长」，给出更有针对性的提示。 */
export function isContextOverflow(statusCode: number | undefined, message: string): boolean {
  if (statusCode !== 400) {
    return false;
  }
  return /context|maximum|too long|token|exceed|过长|超出|上下文/i.test(message);
}

/** 极简的 HTTPS JSON POST 封装，避免引入第三方依赖。 */
function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(
                new DeepSeekError(`解析 DeepSeek 响应失败：${raw.slice(0, 200)}`)
              );
            }
          } else {
            const { message, code } = extractError(raw);
            const friendly = isContextOverflow(res.statusCode, message)
              ? `变更内容过大，超出模型上下文长度限制（${message}）。请缩小改动范围或分批提交。`
              : message;
            reject(
              new DeepSeekError(friendly, {
                statusCode: res.statusCode,
                code,
                retryable: isRetryableStatus(res.statusCode),
              })
            );
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new DeepSeekError("请求超时，请稍后重试。", { retryable: true }));
    });

    req.on("error", (err) => {
      // 用户主动取消
      if (signal?.aborted) {
        reject(new DeepSeekError("已取消。"));
        return;
      }
      if (err instanceof DeepSeekError) {
        reject(err);
      } else {
        reject(new DeepSeekError(`网络请求失败：${err.message}`, { retryable: true }));
      }
    });

    req.write(payload);
    req.end();
  });
}

export function isRetryableStatus(statusCode?: number): boolean {
  return statusCode !== undefined && [408, 429, 500, 502, 503, 504].includes(statusCode);
}

/** 指数退避 + 抖动。 */
export function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 5000);
  return base + Math.floor(Math.random() * 500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调用 DeepSeek 生成 commit message。
 * @param apiKey DeepSeek API Key
 * @param model 模型名（deepseek-v4-pro / deepseek-v4-flash）
 * @param systemPrompt 系统提示词
 * @param changes 待总结的代码变更（diff 文本）
 * @param options 超时、重试、取消等选项
 * @returns 生成的 commit message 文本及是否被截断
 */
export async function generateCommitMessage(
  apiKey: string,
  model: string,
  systemPrompt: string,
  changes: string,
  options?: GenerateOptions
): Promise<GenerateResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const signal = options?.signal;

  const userPrompt = `以下是当前工作区的代码变更（git diff）：\n\n${changes}\n\n请生成 commit message。`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const requestBody = {
    model,
    messages,
    stream: false,
    temperature: 0.2,
    max_tokens: 1024,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DeepSeekError("已取消。");
    }
    try {
      const data = await postJson<ChatCompletionResponse>(
        `${BASE_URL}/chat/completions`,
        { Authorization: `Bearer ${apiKey}` },
        requestBody,
        timeoutMs,
        signal
      );

      const choice = data.choices?.[0];
      const content = choice?.message?.content;

      if (!content || content.trim().length === 0) {
        if (data.error?.message) {
          throw new DeepSeekError(data.error.message, { code: data.error.code });
        }
        // HTTP 成功但内容为空：模型偶发返回空，标记为可重试
        throw new DeepSeekError("DeepSeek 未返回任何内容。", { retryable: true });
      }

      return {
        content: content.trim(),
        truncated: choice?.finish_reason === "length",
      };
    } catch (err) {
      if (signal?.aborted) {
        throw new DeepSeekError("已取消。");
      }
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        throw err;
      }
      await delay(backoffMs(attempt));
    }
  }

  throw lastError;
}
