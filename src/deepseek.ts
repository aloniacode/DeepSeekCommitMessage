import * as https from "https";

/** DeepSeek OpenAI 兼容接口地址。 */
const BASE_URL = "https://api.deepseek.com";

/** 请求超时时间（毫秒）。 */
const REQUEST_TIMEOUT_MS = 60_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/** DeepSeek 请求错误，携带 HTTP 状态码（网络/超时错误无 statusCode）。 */
export class DeepSeekError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "DeepSeekError";
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

/** 从错误响应体中提取可读的错误信息。 */
function extractErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      return String(parsed.error.message);
    }
  } catch {
    // 响应体不是 JSON，直接使用原始文本
  }
  return raw || "未知错误";
}

/** 极简的 HTTPS JSON POST 封装，避免引入第三方依赖。 */
function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown
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
              reject(new DeepSeekError(`解析 DeepSeek 响应失败：${raw}`));
            }
          } else {
            reject(
              new DeepSeekError(extractErrorMessage(raw), res.statusCode)
            );
          }
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new DeepSeekError("请求超时，请稍后重试。"));
    });
    req.on("error", (err) => {
      if (err instanceof DeepSeekError) {
        reject(err);
      } else {
        reject(new DeepSeekError(`网络请求失败：${err.message}`));
      }
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 调用 DeepSeek 生成 commit message。
 * @param apiKey DeepSeek API Key
 * @param model 模型名（deepseek-v4-pro / deepseek-v4-flash）
 * @param systemPrompt 系统提示词
 * @param changes 待总结的代码变更（diff 文本）
 * @returns 生成的 commit message 文本
 */
export async function generateCommitMessage(
  apiKey: string,
  model: string,
  systemPrompt: string,
  changes: string
): Promise<string> {
  const userPrompt = `以下是当前工作区的代码变更（git diff）：\n\n${changes}\n\n请生成 commit message。`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const data = await postJson<ChatCompletionResponse>(
    `${BASE_URL}/chat/completions`,
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: 1024,
    }
  );

  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    if (data.error?.message) {
      throw new DeepSeekError(data.error.message);
    }
    throw new DeepSeekError("DeepSeek 未返回任何内容。");
  }

  return content.trim();
}
