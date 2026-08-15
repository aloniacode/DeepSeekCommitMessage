import { createHash } from "node:crypto";

/** 单次成功响应的 token 用量（来自 DeepSeek API 的 usage 字段）。 */
export interface TokenUsage {
  /** 输入 token。 */
  promptTokens: number;
  /** 输出 token（含 reasoning）。 */
  completionTokens: number;
  /** 输出中属于推理的部分（pro 模型），计入 completionTokens。 */
  reasoningTokens: number;
  /** 总计。API 未返回 total_tokens 时按 prompt + completion 计算。 */
  totalTokens: number;
}

/** 累计统计（持久化到 globalState）。 */
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** 成功调用次数。 */
  generations: number;
  /** 最近一次计入的时间戳（ms）。 */
  lastUsedAt: number;
}

/** globalState 中累计用量数据的键名。 */
export const USAGE_STATE_KEY = "deepseekCommitMessage.tokenUsage";

/** 极简键值存储抽象：运行时由 vscode.Memento 实现，测试中用内存实现替换。 */
export interface KeyValueStore {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** 新建空统计。每次返回新对象，避免共享可变状态。 */
export function emptyUsageStats(): UsageStats {
  return {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    generations: 0,
    lastUsedAt: 0,
  };
}

function isNonNegNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 从 API 原始 usage 对象解析 token 用量。
 * 缺少必要字段或数值非法时返回 undefined（该次不计数，而不是记脏数据）。
 */
export function parseTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  if (!isNonNegNumber(r.prompt_tokens) || !isNonNegNumber(r.completion_tokens)) {
    return undefined;
  }
  const details = r.completion_tokens_details;
  const reasoning =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>).reasoning_tokens
      : undefined;
  const promptTokens = r.prompt_tokens;
  const completionTokens = r.completion_tokens;
  return {
    promptTokens,
    completionTokens,
    reasoningTokens: isNonNegNumber(reasoning) ? reasoning : 0,
    totalTokens: isNonNegNumber(r.total_tokens)
      ? r.total_tokens
      : promptTokens + completionTokens,
  };
}

/** 校验持久化数据是否合法；损坏/非法条目在读取时丢弃。 */
export function isUsageStats(value: unknown): value is UsageStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    isNonNegNumber(v.promptTokens) &&
    isNonNegNumber(v.completionTokens) &&
    isNonNegNumber(v.reasoningTokens) &&
    isNonNegNumber(v.totalTokens) &&
    isNonNegNumber(v.generations) &&
    isNonNegNumber(v.lastUsedAt)
  );
}

/** 把一次用量累加进统计。不可变更新；now 可注入以便测试。 */
export function accumulateUsage(
  stats: UsageStats,
  usage: TokenUsage,
  now: number = Date.now()
): UsageStats {
  return {
    promptTokens: stats.promptTokens + usage.promptTokens,
    completionTokens: stats.completionTokens + usage.completionTokens,
    reasoningTokens: stats.reasoningTokens + usage.reasoningTokens,
    totalTokens: stats.totalTokens + usage.totalTokens,
    generations: stats.generations + 1,
    lastUsedAt: now,
  };
}

/** API Key -> 存储键的哈希，避免把明文密钥写进 globalState。 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** 千分位格式化（如 1234567 -> "1,234,567"）。 */
export function formatTokenCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** 紧凑格式化（状态栏用，如 12300 -> "12.3k"）。 */
export function formatCompactTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return String(count);
}

/** 将累计统计格式化为命令展示的摘要文本。 */
export function formatUsageSummary(
  stats: UsageStats,
  modelLabel?: string
): string {
  const lines = [
    modelLabel ? `累计 token 用量（${modelLabel}）` : "累计 token 用量",
    `总 token：${formatTokenCount(stats.totalTokens)}`,
    `  prompt：${formatTokenCount(stats.promptTokens)}`,
    `  completion：${formatTokenCount(stats.completionTokens)}`,
  ];
  if (stats.reasoningTokens > 0) {
    lines.push(
      `    （其中 reasoning：${formatTokenCount(stats.reasoningTokens)}）`
    );
  }
  lines.push(`成功调用次数：${stats.generations}`);
  lines.push(
    `最近使用：${stats.lastUsedAt ? new Date(stats.lastUsedAt).toLocaleString("zh-CN") : "—"}`
  );
  lines.push("（仅统计成功响应的用量，不含重试/取消的消耗）");
  return lines.join("\n");
}

/**
 * 按 API Key 哈希分组持久化累计用量。
 * add 通过内部队列串行化「读-改-写」，避免并发生成时丢更新。
 */
export class UsageStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: KeyValueStore) {}

  /** 读取指定 API Key 的累计用量；无数据时返回空统计。 */
  async get(apiKey: string): Promise<UsageStats> {
    const entry = this.readAll()[hashApiKey(apiKey)];
    return entry ? { ...entry } : emptyUsageStats();
  }

  /** 累加一次用量并持久化。返回累加后的统计。 */
  add(apiKey: string, usage: TokenUsage): Promise<UsageStats> {
    const task = this.queue.then(async () => {
      const all = this.readAll();
      const hash = hashApiKey(apiKey);
      const current = all[hash] ?? emptyUsageStats();
      all[hash] = accumulateUsage(current, usage);
      await this.store.update(USAGE_STATE_KEY, all);
      return { ...all[hash] };
    });
    // 队列失败不阻断后续任务
    this.queue = task.catch(() => undefined);
    return task;
  }

  /** 清除指定 API Key 的累计统计；无数据时为空操作。与 add 同队列串行化。 */
  clear(apiKey: string): Promise<void> {
    const task = this.queue.then(async () => {
      const all = this.readAll();
      const hash = hashApiKey(apiKey);
      if (!(hash in all)) {
        return;
      }
      delete all[hash];
      await this.store.update(USAGE_STATE_KEY, all);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  /** 读取整份数据并丢弃非法条目，防御旧版本/损坏数据。 */
  private readAll(): Record<string, UsageStats> {
    const raw = this.store.get(USAGE_STATE_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const all: Record<string, UsageStats> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (isUsageStats(value)) {
        all[key] = value;
      }
    }
    return all;
  }
}
