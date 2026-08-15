import { describe, it, expect } from "vitest";
import {
  UsageStore,
  accumulateUsage,
  emptyUsageStats,
  formatCompactTokenCount,
  formatTokenCount,
  formatUsageSummary,
  hashApiKey,
  isUsageStats,
  parseTokenUsage,
  USAGE_STATE_KEY,
  type KeyValueStore,
  type TokenUsage,
  type UsageStats,
} from "../src/usage";

/** 内存版键值存储，模拟 vscode.Memento 的异步 update。 */
class FakeMemento implements KeyValueStore {
  private readonly map = new Map<string, unknown>();
  get(key: string): unknown {
    return this.map.get(key);
  }
  async update(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
}

const SAMPLE_USAGE: TokenUsage = {
  promptTokens: 100,
  completionTokens: 200,
  reasoningTokens: 150,
  totalTokens: 300,
};

describe("parseTokenUsage", () => {
  it("完整 usage 解析为 TokenUsage", () => {
    expect(
      parseTokenUsage({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 15 },
      })
    ).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      reasoningTokens: 15,
      totalTokens: 30,
    });
  });

  it("无 completion_tokens_details 时 reasoningTokens 为 0", () => {
    expect(
      parseTokenUsage({ prompt_tokens: 1, completion_tokens: 2 })
    ).toEqual({
      promptTokens: 1,
      completionTokens: 2,
      reasoningTokens: 0,
      totalTokens: 3,
    });
  });

  it("缺 total_tokens 时按 prompt + completion 计算", () => {
    expect(parseTokenUsage({ prompt_tokens: 7, completion_tokens: 3 }))
      .toMatchObject({ totalTokens: 10 });
  });

  it("非对象/数组返回 undefined", () => {
    expect(parseTokenUsage(null)).toBeUndefined();
    expect(parseTokenUsage(undefined)).toBeUndefined();
    expect(parseTokenUsage([1, 2])).toBeUndefined();
    expect(parseTokenUsage("usage")).toBeUndefined();
  });

  it("缺必要字段返回 undefined", () => {
    expect(parseTokenUsage({ prompt_tokens: 1 })).toBeUndefined();
    expect(parseTokenUsage({ completion_tokens: 1 })).toBeUndefined();
    expect(parseTokenUsage({})).toBeUndefined();
  });

  it("负数/NaN 视为非法", () => {
    expect(
      parseTokenUsage({ prompt_tokens: -1, completion_tokens: 2 })
    ).toBeUndefined();
    expect(
      parseTokenUsage({ prompt_tokens: 1, completion_tokens: NaN })
    ).toBeUndefined();
  });

  it("reasoning 非数字时按 0 处理", () => {
    expect(
      parseTokenUsage({
        prompt_tokens: 1,
        completion_tokens: 2,
        completion_tokens_details: { reasoning_tokens: "x" },
      })
    ).toMatchObject({ reasoningTokens: 0 });
  });
});

describe("emptyUsageStats", () => {
  it("每次返回全新对象且全为零", () => {
    const a = emptyUsageStats();
    const b = emptyUsageStats();
    expect(a).not.toBe(b);
    expect(a).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      generations: 0,
      lastUsedAt: 0,
    });
  });
});

describe("accumulateUsage", () => {
  it("累加各项并递增生成次数", () => {
    const result = accumulateUsage(emptyUsageStats(), SAMPLE_USAGE, 1000);
    expect(result).toEqual({
      promptTokens: 100,
      completionTokens: 200,
      reasoningTokens: 150,
      totalTokens: 300,
      generations: 1,
      lastUsedAt: 1000,
    });
    const second = accumulateUsage(result, SAMPLE_USAGE, 2000);
    expect(second.totalTokens).toBe(600);
    expect(second.generations).toBe(2);
    expect(second.lastUsedAt).toBe(2000);
  });

  it("不可变更新，不修改入参", () => {
    const base = emptyUsageStats();
    accumulateUsage(base, SAMPLE_USAGE, 1000);
    expect(base.totalTokens).toBe(0);
  });
});

describe("isUsageStats", () => {
  const valid: UsageStats = {
    promptTokens: 1,
    completionTokens: 2,
    reasoningTokens: 3,
    totalTokens: 4,
    generations: 1,
    lastUsedAt: 1000,
  };

  it("合法对象通过校验", () => {
    expect(isUsageStats(valid)).toBe(true);
  });

  it("非法类型/字段被拒绝", () => {
    expect(isUsageStats(null)).toBe(false);
    expect(isUsageStats("x")).toBe(false);
    expect(isUsageStats({ ...valid, promptTokens: -1 })).toBe(false);
    expect(isUsageStats({ ...valid, promptTokens: NaN })).toBe(false);
    expect(isUsageStats({ ...valid, generations: "1" })).toBe(false);
    expect(isUsageStats({ ...valid, lastUsedAt: undefined })).toBe(false);
    expect(isUsageStats({ promptTokens: 1 })).toBe(false);
  });
});

describe("hashApiKey", () => {
  it("确定性且不同 key 哈希不同", () => {
    expect(hashApiKey("sk-abc")).toBe(hashApiKey("sk-abc"));
    expect(hashApiKey("sk-abc")).not.toBe(hashApiKey("sk-abd"));
  });

  it("不包含明文密钥", () => {
    expect(hashApiKey("sk-secret-key")).not.toContain("secret");
  });
});

describe("formatTokenCount", () => {
  it("千分位格式化", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(1234)).toBe("1,234");
    expect(formatTokenCount(1234567)).toBe("1,234,567");
  });
});

describe("formatCompactTokenCount", () => {
  it("按量级缩写", () => {
    expect(formatCompactTokenCount(0)).toBe("0");
    expect(formatCompactTokenCount(999)).toBe("999");
    expect(formatCompactTokenCount(1000)).toBe("1.0k");
    expect(formatCompactTokenCount(12300)).toBe("12.3k");
    expect(formatCompactTokenCount(2500000)).toBe("2.5M");
  });
});

describe("formatUsageSummary", () => {
  const stats: UsageStats = {
    promptTokens: 1000,
    completionTokens: 2000,
    reasoningTokens: 1500,
    totalTokens: 3000,
    generations: 2,
    lastUsedAt: 1700000000000,
  };

  it("包含各项明细与累计说明", () => {
    const text = formatUsageSummary(stats, "Pro");
    expect(text).toContain("累计 token 用量（Pro）");
    expect(text).toContain("总 token：3,000");
    expect(text).toContain("prompt：1,000");
    expect(text).toContain("completion：2,000");
    expect(text).toContain("其中 reasoning：1,500");
    expect(text).toContain("成功调用次数：2");
    expect(text).toContain("不含重试/取消的消耗");
  });

  it("reasoning 为零时不展示该行", () => {
    const text = formatUsageSummary({ ...stats, reasoningTokens: 0 });
    expect(text).not.toContain("reasoning");
  });
});

describe("UsageStore", () => {
  it("add 后 get 返回累计结果", async () => {
    const store = new UsageStore(new FakeMemento());
    const first = await store.add("sk-a", SAMPLE_USAGE);
    expect(first.totalTokens).toBe(300);
    expect(first.generations).toBe(1);
    const stats = await store.get("sk-a");
    expect(stats.totalTokens).toBe(300);
    expect(stats.promptTokens).toBe(100);
  });

  it("按 API Key 隔离统计", async () => {
    const store = new UsageStore(new FakeMemento());
    await store.add("sk-a", SAMPLE_USAGE);
    expect((await store.get("sk-b")).totalTokens).toBe(0);
  });

  it("无数据时返回空统计", async () => {
    const store = new UsageStore(new FakeMemento());
    expect(await store.get("sk-a")).toEqual(emptyUsageStats());
  });

  it("并发的 add 不丢更新（串行化读-改-写）", async () => {
    const memento = new FakeMemento();
    const store = new UsageStore(memento);
    await Promise.all([
      store.add("sk-a", SAMPLE_USAGE),
      store.add("sk-a", SAMPLE_USAGE),
      store.add("sk-a", SAMPLE_USAGE),
      store.add("sk-a", SAMPLE_USAGE),
      store.add("sk-a", SAMPLE_USAGE),
    ]);
    const stats = await store.get("sk-a");
    expect(stats.totalTokens).toBe(1500);
    expect(stats.generations).toBe(5);
  });

  it("持久化数据损坏时丢弃非法条目", async () => {
    const memento = new FakeMemento();
    const store = new UsageStore(memento);
    await store.add("sk-a", SAMPLE_USAGE);
    memento.update(USAGE_STATE_KEY, {
      [hashApiKey("sk-a")]: { promptTokens: "oops" },
      [hashApiKey("sk-b")]: { promptTokens: 1, generations: "x" },
    });
    expect((await store.get("sk-a")).totalTokens).toBe(0);
  });

  it("add 写入的持久化结构按 key 哈希分组", async () => {
    const memento = new FakeMemento();
    const store = new UsageStore(memento);
    await store.add("sk-a", SAMPLE_USAGE);
    const all = memento.get(USAGE_STATE_KEY) as Record<string, UsageStats>;
    expect(Object.keys(all)).toEqual([hashApiKey("sk-a")]);
    expect(all[hashApiKey("sk-a")].totalTokens).toBe(300);
  });

  it("clear 后 get 返回空统计", async () => {
    const store = new UsageStore(new FakeMemento());
    await store.add("sk-a", SAMPLE_USAGE);
    await store.clear("sk-a");
    expect(await store.get("sk-a")).toEqual(emptyUsageStats());
  });

  it("clear 只影响目标 API Key", async () => {
    const store = new UsageStore(new FakeMemento());
    await store.add("sk-a", SAMPLE_USAGE);
    await store.add("sk-b", SAMPLE_USAGE);
    await store.clear("sk-a");
    expect((await store.get("sk-a")).totalTokens).toBe(0);
    expect((await store.get("sk-b")).totalTokens).toBe(300);
  });

  it("clear 无数据 key 是空操作", async () => {
    const store = new UsageStore(new FakeMemento());
    await expect(store.clear("sk-a")).resolves.toBeUndefined();
    expect(await store.get("sk-a")).toEqual(emptyUsageStats());
  });

  it("clear 后继续 add 正常累计", async () => {
    const store = new UsageStore(new FakeMemento());
    await store.add("sk-a", SAMPLE_USAGE);
    await store.clear("sk-a");
    await store.add("sk-a", SAMPLE_USAGE);
    expect((await store.get("sk-a")).totalTokens).toBe(300);
    expect((await store.get("sk-a")).generations).toBe(1);
  });

  it("clear 与并发的 add 串行化，最终状态一致", async () => {
    const store = new UsageStore(new FakeMemento());
    await Promise.all([
      store.add("sk-a", SAMPLE_USAGE),
      store.add("sk-a", SAMPLE_USAGE),
      store.clear("sk-a"),
      store.add("sk-a", SAMPLE_USAGE),
    ]);
    // 队列按入队顺序串行执行：add(300) → add(600) → clear(0) → add(300)
    const stats = await store.get("sk-a");
    expect(stats.totalTokens).toBe(300);
    expect(stats.generations).toBe(1);
  });
});
