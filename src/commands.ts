import * as vscode from "vscode";
import {
  getApiKey,
  getModel,
  getPrompt,
  getPromptTemplate,
  getMaxDiffChars,
  getMaxRetries,
  getRequestTimeoutMs,
  MODEL_IDS,
  MODEL_LABELS,
  deleteApiKey,
  setApiKey as saveApiKey,
  setModel as saveModel,
  setPrompt as savePrompt,
  setPromptTemplate as savePromptTemplate,
  type ModelId,
  type PromptTemplateId,
} from "./configuration";
import {
  generateCommitMessage as callDeepSeek,
  DeepSeekError,
} from "./deepseek";
import {
  collectChanges,
  fillScmInputBox,
  getRepoRoot,
  isGitAvailable,
  isGitRepository,
  resolveWorkspaceFolder,
} from "./git";
import { sanitizeCommitMessage } from "./message";

/** 将 DeepSeek 调用异常转换为友好的中文提示。 */
function friendlyError(err: unknown): string {
  if (err instanceof DeepSeekError) {
    if (err.message === "已取消。") {
      return "已取消生成。";
    }
    switch (err.statusCode) {
      case 400:
        return err.message.includes("上下文")
          ? err.message
          : `请求参数有误（HTTP 400）：${err.message}`;
      case 401:
        return "DeepSeek API Key 无效或未授权，请重新设置 API Key。";
      case 402:
        return "DeepSeek 账户余额不足，请充值后重试。";
      case 403:
        return "请求被拒绝（HTTP 403），请检查账号权限或所在地区是否可用。";
      case 408:
        return "请求超时，请稍后重试或调大超时时间。";
      case 429:
        return "请求过于频繁或并发超限，已自动重试，若仍失败请稍后重试。";
      case 500:
      case 502:
      case 503:
      case 504:
        return "DeepSeek 服务暂时不可用，已自动重试，若仍失败请稍后重试。";
      default:
        return err.statusCode
          ? `生成失败（HTTP ${err.statusCode}）：${err.message}`
          : `生成失败：${err.message}`;
    }
  }
  return `生成失败：${err instanceof Error ? err.message : String(err)}`;
}

/** 命令：设置 API Key。 */
async function setApiKey(): Promise<void> {
  const current = await getApiKey();
  const value = await vscode.window.showInputBox({
    title: "DeepSeek Commit Message: Set API Key",
    prompt: "请输入 DeepSeek 接口密钥（可在 https://platform.deepseek.com 申请）",
    placeHolder: "sk-...",
    value: current,
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return; // 用户取消
  }
  const trimmed = value.trim();
  if (!trimmed) {
    vscode.window.showWarningMessage("API Key 不能为空。");
    return;
  }
  await saveApiKey(trimmed);
  vscode.window.showInformationMessage("DeepSeek API Key 已保存。");
}

/** 命令：选择模型。 */
async function selectModel(): Promise<void> {
  const current = getModel();
  const items: Array<{
    label: string;
    id: ModelId;
    description: string;
    picked: boolean;
  }> = [
    {
      label: `${current === "pro" ? "$(check)" : "$(circle-outline)"} ${MODEL_LABELS.pro}`,
      id: "pro",
      description: "deepseek-v4-pro",
      picked: current === "pro",
    },
    {
      label: `${current === "flash" ? "$(check)" : "$(circle-outline)"} ${MODEL_LABELS.flash}`,
      id: "flash",
      description: "deepseek-v4-flash",
      picked: current === "flash",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: "DeepSeek Commit Message: Select Model",
    placeHolder: "选择用于生成 commit message 的模型",
    ignoreFocusOut: true,
  });
  if (!picked) {
    return;
  }
  await saveModel(picked.id);
  vscode.window.showInformationMessage(
    `已选择模型：${picked.id === "pro" ? "Pro" : "Flash"}（${picked.description}）`
  );
}

/** 命令：设置提示词。 */
async function setPrompt(): Promise<void> {
  const currentTemplate = getPromptTemplate();
  const template = await vscode.window.showQuickPick(
    [
      {
        label: `${currentTemplate === "conventional" ? "$(check)" : "$(circle-outline)"} Conventional Commits（英文）`,
        id: "conventional" as PromptTemplateId,
        description: "内置英文模板",
        picked: currentTemplate === "conventional",
      },
      {
        label: `${currentTemplate === "conventional-zh" ? "$(check)" : "$(circle-outline)"} Conventional Commits（中文）`,
        id: "conventional-zh" as PromptTemplateId,
        description: "内置中文模板",
        picked: currentTemplate === "conventional-zh",
      },
      {
        label: `${currentTemplate === "custom" ? "$(check)" : "$(circle-outline)"} 自定义提示词`,
        id: "custom" as PromptTemplateId,
        description: "输入你自己的提示词",
        picked: currentTemplate === "custom",
      },
    ],
    {
      title: "DeepSeek Commit Message: Set Prompt",
      placeHolder: "选择提示词模板",
      ignoreFocusOut: true,
    }
  );
  if (!template) {
    return;
  }

  if (template.id === "custom") {
    const value = await vscode.window.showInputBox({
      title: "DeepSeek Commit Message: Set Prompt",
      prompt:
        "输入自定义提示词（建议包含 Conventional Commits 规范说明与输出约束）",
      value: getPrompt(),
      placeHolder: "你是一名资深软件工程师……",
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return;
    }
    await savePrompt(value.trim());
  }

  await savePromptTemplate(template.id);
  vscode.window.showInformationMessage(
    template.id === "custom"
      ? "自定义提示词已保存。"
      : `已切换到提示词模板：${template.label}`
  );
}

/** 命令：清除已保存的 API Key。 */
async function clearApiKey(): Promise<void> {
  const current = await getApiKey();
  if (!current) {
    vscode.window.showInformationMessage("当前未保存 API Key。");
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    "确定要清除已保存的 DeepSeek API Key 吗？",
    { modal: true },
    "清除"
  );
  if (answer === "清除") {
    await deleteApiKey();
    vscode.window.showInformationMessage("API Key 已清除。");
  }
}

/** 命令：生成 commit message 并填充到 SCM 输入框。 */
async function generateCommitMessage(): Promise<void> {
  // 1. 校验 API Key
  let apiKey = await getApiKey();
  if (!apiKey) {
    const answer = await vscode.window.showWarningMessage(
      "尚未配置 DeepSeek API Key，是否现在设置？",
      "设置 API Key"
    );
    if (answer === "设置 API Key") {
      await vscode.commands.executeCommand("deepseekCommitMessage.setApiKey");
      apiKey = await getApiKey();
    }
    if (!apiKey) {
      return;
    }
  }

  // 2. 定位工作区目录
  const cwd = resolveWorkspaceFolder();
  if (!cwd) {
    vscode.window.showErrorMessage("当前没有打开任何工作区。");
    return;
  }

  // 3. 校验 git 环境与仓库
  if (!(await isGitAvailable(cwd))) {
    vscode.window.showErrorMessage(
      "未检测到 git 命令，请先安装 git 并确保其已加入 PATH。"
    );
    return;
  }
  if (!(await isGitRepository(cwd))) {
    vscode.window.showErrorMessage("当前工作区不是 git 仓库。");
    return;
  }

  // 4. 收集变更（带截断上限，避免超出模型上下文）
  const { diff, hasChanges, truncated } = await collectChanges(
    cwd,
    getMaxDiffChars()
  );
  if (!hasChanges) {
    vscode.window.showInformationMessage(
      "当前没有 staged 或 unstaged 的变更。"
    );
    return;
  }
  if (truncated) {
    vscode.window.showWarningMessage(
      "变更内容过大，已自动截断后生成，commit message 可能不够精确，建议分批提交。"
    );
  }

  // 5. 调用 DeepSeek 生成（可取消 + 自动重试）
  const model = MODEL_IDS[getModel()];
  const prompt = getPrompt();
  const controller = new AbortController();

  let result: { content: string; truncated: boolean };
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在生成 commit message…（点击可取消）",
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return await callDeepSeek(apiKey, model, prompt, diff, {
          timeoutMs: getRequestTimeoutMs(),
          maxRetries: getMaxRetries(),
          signal: controller.signal,
        });
      }
    );
  } catch (err) {
    vscode.window.showErrorMessage(friendlyError(err));
    return;
  }

  const clean = sanitizeCommitMessage(result.content);

  // 6. 结果兜底校验：清洗后为空或不符合规范时给出提示
  if (!clean) {
    vscode.window.showErrorMessage(
      "模型返回内容无法解析为 commit message，请重试或切换到 pro 模型。"
    );
    return;
  }

  // 7. 填充到 SCM 输入框
  const repoRoot = await getRepoRoot(cwd);
  const filled = await fillScmInputBox(clean, repoRoot);
  if (filled) {
    const extra = result.truncated ? "（模型输出可能因长度被截断）" : "";
    vscode.window.showInformationMessage(
      `Commit message 已生成并填充到输入框。${extra}`
    );
  } else {
    // 兜底：复制到剪贴板，方便手动粘贴
    await vscode.env.clipboard.writeText(clean);
    vscode.window.showWarningMessage(
      "无法定位 SCM 输入框，生成的 message 已复制到剪贴板。"
    );
  }
}

/** 注册所有命令。 */
export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("deepseekCommitMessage.setApiKey", setApiKey),
    vscode.commands.registerCommand(
      "deepseekCommitMessage.clearApiKey",
      clearApiKey
    ),
    vscode.commands.registerCommand(
      "deepseekCommitMessage.selectModel",
      selectModel
    ),
    vscode.commands.registerCommand("deepseekCommitMessage.setPrompt", setPrompt),
    vscode.commands.registerCommand(
      "deepseekCommitMessage.generateCommitMessage",
      generateCommitMessage
    )
  );
}
