# Changelog

本项目的所有重要变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 生成范围默认仅限**暂存区**（staged）变更，避免未暂存/未跟踪内容污染 message；新增配置 `deepseekCommitMessage.changeScope`（`staged` 默认 / `all`）可恢复包含全部变更。
- 变更内容超过 `maxDiffChars` 上限时，由「整体截断」改为**按文件比例采样**：每个变更文件至少保留一段、diff hunk 保持完整、采样结果确定，并附全量文件统计摘要，不再丢失尾部变更。

### Added

- 累计 token 用量统计：每次成功生成后自动记录 prompt / completion（含 reasoning）/ total token 数，按 API Key 隔离、跨工作区持久化到 `globalState`。
- 新命令 `DeepSeek Commit Message: Show Token Usage`：查看累计用量明细（仅统计成功响应的用量，不含重试/取消的消耗）。
- 新命令 `DeepSeek Commit Message: Reset Token Usage`：确认后重置当前 API Key 的累计用量。
- 状态栏常驻累计 token 总数（紧凑格式，如 `12.3k tokens`），点击可查看明细。

### Fixed

- 修复 Set API Key / Clear API Key 报错「apiKey 不是一个注册的配置」：`package.json` 未注册 `deepseekCommitMessage.apiKey` 导致 `update("apiKey", …)` 被 VSCode 拒绝。已在 `contributes.configuration` 注册该键（仅用于旧版本明文密钥迁移清理，密钥本体仍存于 SecretStorage）。

## [0.0.1] - 2026-08-13

### Added

- 核心功能：读取当前 git 仓库的 staged / unstaged 变更，调用 DeepSeek 生成符合 Conventional Commits 规范的 commit message，并填充到 SCM 输入框。
- SCM 标题栏一键生成按钮（DeepSeek logo 图标）。
- 配置项：
  - `deepseekCommitMessage.model`：模型选择（`pro` / `flash`）。
  - `deepseekCommitMessage.promptTemplate`：预设提示词模板（英文 / 中文 / 自定义）。
  - `deepseekCommitMessage.prompt`：自定义提示词。
- API Key 通过 SecretStorage 安全存储（不写入 `settings.json`），支持从旧版本明文配置自动迁移。
- 命令：
  - `DeepSeek Commit Message: Set API Key`
  - `DeepSeek Commit Message: Clear API Key`
  - `DeepSeek Commit Message: Select Model`
  - `DeepSeek Commit Message: Set Prompt`
  - `DeepSeek Commit Message: Generate Commit Message`
- 内置英文 / 中文两套 Conventional Commits 提示词模板。
- DeepSeek 调用错误处理：按 HTTP 状态码给出中文错误提示（401 无效密钥、402 余额不足、429 限流、5xx 服务异常、网络/超时）。
