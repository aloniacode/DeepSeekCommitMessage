import * as vscode from "vscode";

/** 配置命名空间，对应 package.json 中 contributes.configuration 的键前缀。 */
export const CONFIG_SECTION = "deepseekCommitMessage";

/** SecretStorage 中保存 API Key 的键名。 */
const API_KEY_SECRET = "deepseekCommitMessage.apiKey";

/** 由 extension.activate 注入的 SecretStorage 实例。 */
let secretStorage: vscode.SecretStorage | undefined;

/** 可选模型标识。 */
export type ModelId = "pro" | "flash";

/** 模型标识 -> DeepSeek API 实际模型名映射。 */
export const MODEL_IDS: Record<ModelId, string> = {
  pro: "deepseek-v4-pro",
  flash: "deepseek-v4-flash",
};

/** 模型选择下拉框的展示文案。 */
export const MODEL_LABELS: Record<ModelId, string> = {
  pro: "Pro（deepseek-v4-pro · 推理更强）",
  flash: "Flash（deepseek-v4-flash · 更快更省）",
};

/** 预设提示词模板标识。 */
export type PromptTemplateId = "conventional" | "conventional-zh" | "custom";

/** 内置的 Conventional Commits（英文）提示词模板。 */
export const CONVENTIONAL_COMMITS_PROMPT = `You are an expert software engineer who writes concise, high-quality git commit messages.

Follow the Conventional Commits specification strictly:

<type>(<scope>): <description>

Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.

Rules:
- Write the description in imperative mood, present tense, lowercase.
- Keep the subject line under 72 characters.
- Do not end the subject line with a period.
- If the change is non-trivial, add a body explaining what changed and why, wrapped at 72 characters.
- Return ONLY the commit message itself: no markdown code fences, no surrounding explanation, no preamble.`;

/** 内置的 Conventional Commits（中文）提示词模板。 */
export const CONVENTIONAL_COMMITS_PROMPT_ZH = `你是一名资深软件工程师，擅长编写简洁、规范的 git commit message。

请严格遵循 Conventional Commits 规范：

<type>(<scope>): <description>

type 可选：feat、fix、docs、style、refactor、perf、test、build、ci、chore、revert。

规则：
- description 和 body 必须使用中文撰写（type 与 scope 保持英文小写，如 feat、fix）。
- description 使用祈使语气、现在时。
- subject 行不超过 72 个字符。
- subject 行结尾不加句号。
- 若改动较复杂，可补充 body，说明"做了什么"与"为什么"。
- 只返回 commit message 本身：不要包含 markdown 代码块、前后缀解释或任何多余内容。`;

/** 预设模板映射。custom 的取值会在运行时从配置项 prompt 动态读取。 */
export const PROMPT_TEMPLATES: Record<PromptTemplateId, string> = {
  conventional: CONVENTIONAL_COMMITS_PROMPT,
  "conventional-zh": CONVENTIONAL_COMMITS_PROMPT_ZH,
  custom: "",
};

/** 获取扩展的配置对象。 */
export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** 初始化 SecretStorage（由 extension.activate 调用）。 */
export function initSecrets(storage: vscode.SecretStorage): void {
  secretStorage = storage;
}

/**
 * 读取 API Key。
 * 优先从 SecretStorage 读取；若为空，回退到 settings 中的明文（兼容旧版本），
 * 并自动迁移到 SecretStorage 后清除明文。
 */
export async function getApiKey(): Promise<string> {
  if (secretStorage) {
    const secret = await secretStorage.get(API_KEY_SECRET);
    if (secret) {
      return secret.trim();
    }
  }

  // 兼容旧版本：从 settings 读取明文并迁移到 SecretStorage
  const legacy = getConfig().get<string>("apiKey", "").trim();
  if (legacy && secretStorage) {
    await secretStorage.store(API_KEY_SECRET, legacy);
    await getConfig().update("apiKey", "", vscode.ConfigurationTarget.Global);
  }
  return legacy;
}

/** 读取当前选择的模型标识。 */
export function getModel(): ModelId {
  const value = getConfig().get<string>("model", "flash");
  return value === "pro" ? "pro" : "flash";
}

/** 读取当前选择的提示词模板标识。 */
export function getPromptTemplate(): PromptTemplateId {
  return getConfig().get<PromptTemplateId>("promptTemplate", "conventional");
}

/** 读取最终生效的提示词（优先预设模板，custom 时回退到自定义 prompt）。 */
export function getPrompt(): string {
  const template = getPromptTemplate();
  if (template === "custom") {
    const custom = getConfig().get<string>("prompt", "").trim();
    return custom.length > 0 ? custom : CONVENTIONAL_COMMITS_PROMPT;
  }
  return PROMPT_TEMPLATES[template] ?? CONVENTIONAL_COMMITS_PROMPT;
}

/** 将 API Key 写入 SecretStorage，并清除 settings 中的明文。 */
export async function setApiKey(apiKey: string): Promise<void> {
  if (!secretStorage) {
    throw new Error("SecretStorage 尚未初始化。");
  }
  await secretStorage.store(API_KEY_SECRET, apiKey);
  await getConfig().update("apiKey", "", vscode.ConfigurationTarget.Global);
}

/** 删除已保存的 API Key（SecretStorage 与 settings 明文一并清除）。 */
export async function deleteApiKey(): Promise<void> {
  if (secretStorage) {
    await secretStorage.delete(API_KEY_SECRET);
  }
  await getConfig().update("apiKey", "", vscode.ConfigurationTarget.Global);
}

/** 将模型写入配置。 */
export async function setModel(model: ModelId): Promise<void> {
  await getConfig().update("model", model, vscode.ConfigurationTarget.Global);
}

/** 将提示词模板写入配置。 */
export async function setPromptTemplate(
  template: PromptTemplateId
): Promise<void> {
  await getConfig().update(
    "promptTemplate",
    template,
    vscode.ConfigurationTarget.Global
  );
}

/** 将自定义提示词写入配置。 */
export async function setPrompt(prompt: string): Promise<void> {
  await getConfig().update("prompt", prompt, vscode.ConfigurationTarget.Global);
}
