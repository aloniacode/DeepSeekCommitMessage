# Commit Message 自动生成功能：失败排查与优化报告

> 项目：deepseek-commit-message（VSCode 扩展，v0.0.2）
> 分析日期：2026-08-14
> 结论：已完成代码级修复，`tsc -p ./` 编译通过。

---

## 一、结论摘要

原实现把「git 命令失败」「网络失败」「超时」「服务端瞬时错误」「模型返回空」「返回格式不合规」等多种失败**全部揉成一句话**，且**没有任何重试与回退机制**，导致「经常失败」且失败原因不可见。本次优化从四条链路（输入解析、模板匹配、异常处理、超时/空返回）逐层加固，补齐了：

- 瞬时错误自动重试（指数退避）
- 可配置超时 + 用户可取消
- diff 超长自动截断（适配上下文窗口）
- 未跟踪文件内容纳入（新文件场景质量）
- 错误分类友好提示 + 返回内容清洗/校验 + 截断检测

---

## 二、失败的具体场景与触发条件

| # | 失败场景 | 触发条件 | 原实现表现 | 根因 |
|---|---|---|---|---|
| 1 | **git 命令不可用** | 机器未装 git 或不在 PATH | 误报「当前工作区不是 git 仓库」 | `runGit` 吞掉所有错误返回 `""`，无法区分「未安装/非仓库/命令失败」 |
| 2 | **diff 超过模型上下文** | 大改动、大文件、提交体积大 | HTTP 400（`maximum context length` 之类）被当作通用错误 | 无 diff 截断，直接把全量 diff 塞给模型 |
| 3 | **服务端瞬时错误** | DeepSeek 限流(429)/服务端抖动(5xx) | 直接失败，无重试 | 单次请求，无退避重试 |
| 4 | **网络抖动/超时** | 弱网、代理、pro 模型推理慢 >60s | 固定 60s 超时，`pro` 大改动经常超时 | 超时写死且不可配，无重试 |
| 5 | **模型返回空内容** | 模型偶发返回空 `choices` | 抛「未返回任何内容」后直接终止 | 无「空返回重试」，无二次兜底 |
| 6 | **返回格式不合规** | 模型带 `\`\`\`markdown` 围栏、前言客套、解释性文字 | 结果被污染填充进输入框 | 清洗只去围栏，未剥离前言/客套话，无格式校验 |
| 7 | **新文件无 diff 可看** | 变更全是未跟踪新文件 | 只列出文件名，模型无内容可总结，质量差 | `ls-files --others` 只取文件名，不读内容 |
| 8 | **API Key/权限类错误** | 401/402/403 | 401/402 有提示，403/400 落到通用兜底 | 错误码覆盖不全 |
| 9 | **用户无法中断** | 生成卡住想取消 | 进度条 `cancellable: false`，只能干等 | 无取消信号贯穿到底层请求 |

---

## 三、薄弱环节定位（分层）

### 1. 输入解析层（`git.ts`）
- `runGit` 用 `try/catch` 吞掉所有异常并返回 `""`，导致三种完全不同的失败（未装 git / 非仓库 / diff 过大 ENOBUFS）都被统一成了「无变更」或「非仓库」。
- `collectChanges` 无大小上限，超大 diff 直接突破模型上下文窗口。
- 未跟踪文件只取文件名，不含内容，新增文件场景生成质量差。

### 2. 模板匹配层（`configuration.ts` / `commands.ts`）
- 内置提示词已要求「只返回 message 本身」，但**结果端没有做格式校验与二次清洗**，模型「不听话」时（带围栏、带前言、带解释）会原样污染输入框。
- `sanitizeCommitMessage` 只删首尾代码围栏，未处理 `好的，以下是为您生成的…` 之类前言。

### 3. 异常处理层（`deepseek.ts` / `commands.ts`）
- `friendlyError` 只覆盖 401/402/429/5xx，**缺 400（参数/token 超限）、403、408**。
- 无重试/退避，429 与 5xx 这类「重试即好」的错误被一次性判死。

### 4. 超时与空返回（`deepseek.ts`）
- `REQUEST_TIMEOUT_MS` 写死 60s，`pro` 推理模型在大改动下极易超时。
- 空返回只抛错，不重试；`finish_reason: "length"`（输出被 `max_tokens=1024` 截断）完全未检测，可能产生半截 message。

### 5. 交互层（`commands.ts`）
- 进度条 `cancellable: false`，无法中断；SCM 输入框定位失败时才兜底到剪贴板（该兜底保留）。

---

## 四、针对性改进措施（已落地）

### 1. 增强鲁棒性

**`deepseek.ts`**
- 新增 `GenerateOptions`：`timeoutMs` / `maxRetries` / `signal`。
- `postJson` 支持 `AbortSignal`，`req.setTimeout` 保留超时，网络错误统一标记 `retryable`。
- `extractError` 同时提取 `error.code`，新增 `isContextOverflow` 识别 400「上下文超长」并给出「缩小改动/分批提交」的明确提示。
- 新增 `isRetryable`：网络/超时（无 statusCode）、408/429/5xx 判定为可重试；401/402/403/400 不重试。
- `generateCommitMessage` 改为循环 `maxRetries` 次 + 指数退避（`min(1000·2^n, 5000) + jitter`），**空返回也纳入重试**；返回 `{ content, truncated }`，`truncated` 由 `finish_reason === "length"` 判定。

**`git.ts`**
- `runGit` 返回结构化 `GitResult { ok, stdout, stderr }`，不再吞错。
- 新增 `isGitAvailable`（`git --version`）与 `isGitRepository` 分离，把「未装 git」和「非仓库」分开提示。
- `collectChanges` 增加 `maxChars` 上限，超出自动截断并打 `truncated` 标记。
- 新增 `collectUntrackedContents`：读取未跟踪文本文件内容并以 `NEW FILE` 形式拼入 diff（跳过二进制/超大文件，上限 30 个文件 / 200KB）。

### 2. 完善回退机制
- 瞬时错误自动重试（退避）→ 仍失败再抛错。
- SCM 输入框定位失败时保留「复制到剪贴板」兜底。
- 清洗后为空 → 明确提示并建议「重试或切换 pro 模型」，避免把脏内容塞进输入框。

### 3. 提升生成质量
- `sanitizeCommitMessage` 增加**前言客套剥离**（`好的/以下/这是/为您生成/Here is…` 等）与空行清理，直到命中首个合法 `type(scope):` 主题行。
- 新增 `isConventionalSubject` 正则校验（11 种 type）。
- 未跟踪文件内容纳入 → 新文件场景也能生成有意义的 message。
- 截断与输出截断均有显式提示，用户可感知质量问题。

### 4. 可配置化（`package.json` + `configuration.ts`）
新增三个配置项：

| 配置键 | 默认 | 说明 |
| --- | --- | --- |
| `deepseekCommitMessage.requestTimeout` | `120000` | 请求超时（ms），pro 模型建议 ≥60000 |
| `deepseekCommitMessage.maxRetries` | `2` | 瞬时错误重试次数（0–5） |
| `deepseekCommitMessage.maxDiffChars` | `40000` | diff 截断上限（字符） |

`commands.ts` 生成流程改为：`isGitAvailable → isGitRepository → collectChanges(带截断) → withProgress(cancellable=true, AbortController) → callDeepSeek(带 options) → sanitize → 空/格式校验 → fillScmInputBox → 剪贴板兜底`。

---

## 五、优化后的预期效果

| 场景 | 优化前 | 优化后 |
| --- | --- | --- |
| DeepSeek 限流/5xx | 直接失败 | 自动退避重试，多数情况下一次成功 |
| 网络抖动/弱网 | 一次失败 | 重试后大概率成功 |
| pro 大改动超时 | 60s 硬超时失败 | 120s 可配 + 重试 + 可取消 |
| 超大 diff | 400 上下文超限报错 | 自动截断后正常生成（带提示） |
| 模型返回空 | 报错终止 | 空返回自动重试 |
| 返回带围栏/前言 | 污染输入框 | 清洗剥离后填充 |
| 全是新文件 | 质量差 | 读取内容生成有意义的 message |
| 未装 git | 误报「非仓库」 | 明确提示「未检测到 git」 |

---

## 六、验证方式

1. **编译验证**：`pnpm compile`（`tsc -p ./`）已通过，无类型错误。
2. **单元测试（已引入 vitest）**：`pnpm test` 运行 37 个用例，全部通过。详见下方「附：vitest 测试」。
3. **手动冒烟**（建议按场景逐一验证）：
   - 无 git 环境 → 应提示「未检测到 git 命令」。
   - 非 git 目录 → 应提示「不是 git 仓库」。
   - 构造 >40k 字符 diff → 应提示「已自动截断」且生成成功。
   - 断网/弱网点击生成 → 观察重试进度与最终「网络请求失败」提示。
   - 取消生成 → 立即中断并提示「已取消生成」。
   - 新文件场景 → 生成的 message 应包含新文件的实际内容语义。
4. **发布前打包**：`pnpm package` 验证 `.vsix` 可正常安装加载。

---

## 附：vitest 测试（本次已落地）

- **测试框架**：vitest 4.1.10（`devDependencies`），配置见 `vitest.config.mts`（node 环境 + `vscode` alias 到测试 stub）。
- **运行方式**：`pnpm test`（单次）/ `pnpm test:watch`（监听）。
- **为可测性做的重构**：
  - `sanitizeCommitMessage` / `isConventionalSubject` 抽到 `src/message.ts`（纯函数，无 vscode 依赖）。
  - `deepseek.ts` 导出 `isRetryable` / `isRetryableStatus` / `isContextOverflow` / `extractError` / `backoffMs`。
  - `git.ts` 导出 `isBinaryFile` / `collectUntrackedContents`。
- **测试覆盖（37 用例）**：

| 文件 | 覆盖点 |
| --- | --- |
| `test/message.test.ts`（10） | 围栏去除、中英文前言剥离、body 保留、空输入、主题行校验 |
| `test/deepseek.test.ts`（16） | 重试判定、状态码分类、上下文超限识别、错误体解析、退避封顶 |
| `test/git.test.ts`（7） | 二进制识别（NUL）、未跟踪文件内容采集、按行加前缀、跳过二进制 |
| `test/configuration.test.ts`（4） | 配置 getter 默认值/自定义值/非法值回退/取整 |

- **结果**：`pnpm test` 37/37 通过，`pnpm compile` 通过。

---

## 七、遗留与后续建议（未在本次改动内）

1. **多根工作区**：`resolveWorkspaceFolder` 优先活动编辑器所在目录、其次首个目录；当用户在非首个仓库的 SCM 面板触发时，可能取错 diff。建议后续从 SCM 上下文精确解析仓库根。
2. **模型名硬编码**：`deepseek-v4-pro` / `deepseek-v4-flash` 若被 API 拒绝（400 invalid model），现已能被 400 友好提示捕获，但无「回退到另一模型」的自动切换，可作为后续增强。
3. **`max_tokens=1024`**：pro 推理模型的 reasoning 可能占用较多 token 导致正文截断，现已通过 `truncated` 检测提示，后续可考虑对 pro 调大或做成配置。
4. **未跟踪文件内容采集有上限**（30 文件/200KB），超大新增文件仍会退化为只列文件名，属合理取舍。
