# Changelog

本项目的所有重要变更都会记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
