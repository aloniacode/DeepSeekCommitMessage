# Deepseek Commit Message

使用 DeepSeek 根据当前工作区的 git 变更（staged / unstaged）自动生成符合
[Conventional Commits](https://www.conventionalcommits.org/) 规范的 commit message，
摆脱对 Copilot 内置 commit 功能不稳定、经常失效的依赖。

## 预览

![Deepseek Commit Message 预览](https://raw.githubusercontent.com/aloniacode/DeepSeekCommitMessage/main/src/assets/screenshot.png)

## 功能特性

- 🎯 一键生成：在 SCM（源代码管理）面板点击 **✨ Generate Commit Message** 按钮，
  自动读取 git 变更并调用 DeepSeek 生成 commit message，填充到输入框。
- ⚙️ 可视化配置：模型、提示词模板均可在 VSCode 设置面板中配置。
- 🔐 安全存储：API Key 通过命令保存到系统凭据库（SecretStorage），不落盘到 `settings.json`。
- 🧩 预设模板：内置英文 / 中文两套 Conventional Commits 提示词，也支持自定义。
- 🧠 双模型：支持 `pro`（deepseek-v4-pro）与 `flash`（deepseek-v4-flash）。

## 快速开始

1. 设置 API Key：`Ctrl+Shift+P` → `DeepSeek Commit Message: Set API Key`。
   （API Key 可在 <https://platform.deepseek.com> 申请）
   API Key 安全保存在系统凭据库（SecretStorage）中，不写入 `settings.json`。
2. （可选）选择模型：`DeepSeek Commit Message: Select Model`。
3. 打开任意 git 仓库，修改文件后点击 SCM 面板的 **✨ Generate Commit Message** 按钮，
   或执行 `DeepSeek Commit Message: Generate Commit Message`。

## 命令列表

| 命令 | 说明 |
| --- | --- |
| `DeepSeek Commit Message: Set API Key` | 设置 DeepSeek API Key |
| `DeepSeek Commit Message: Clear API Key` | 清除已保存的 API Key |
| `DeepSeek Commit Message: Select Model` | 选择 pro / flash 模型 |
| `DeepSeek Commit Message: Set Prompt` | 选择/自定义提示词模板 |
| `DeepSeek Commit Message: Generate Commit Message` | 生成 commit message 并填充到 SCM 输入框 |

## 配置项

| 配置键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `deepseekCommitMessage.model` | enum | `flash` | `pro` / `flash` |
| `deepseekCommitMessage.promptTemplate` | enum | `conventional` | `conventional` / `conventional-zh` / `custom` |
| `deepseekCommitMessage.prompt` | string | `""` | 自定义提示词（`custom` 模板时生效） |

> API Key 不通过配置面板暴露，而是通过 `Set API Key` 命令安全存储于系统凭据库（SecretStorage）。

## 开发

> 本项目默认使用 [pnpm](https://pnpm.io/) 作为包管理器：`package.json` 的
> `packageManager` 字段已声明，锁文件为 `pnpm-lock.yaml`。

```bash
pnpm install         # 安装依赖
pnpm compile         # 编译（tsc）
pnpm watch           # 监听编译
```

在 VSCode 中按 `F5` 启动扩展调试窗口（Extension Development Host）。

> 说明：`@vscode/vsce` 已作为 devDependency 引入。pnpm 11 默认拦截依赖的构建脚本，
> 审批结果已写入 `pnpm-workspace.yaml` 的 `allowBuilds`（`keytar` 不构建、`@vscode/vsce-sign` 构建），
> 首次安装无需手动 `pnpm approve-builds`。

## 打包

打包为 `.vsix` 文件（用于本地安装或分享，无需登录）：

```bash
pnpm package         # 等价于 pnpm exec vsce package
# 生成 deepseek-commit-message-0.0.1.vsix
```

> 也可全局安装 `@vscode/vsce` 后直接用 `vsce package`。

本地安装测试：

```bash
code --install-extension deepseek-commit-message-0.0.1.vsix
```

打包前请确认以下事项：

- `package.json` 中已存在 `LICENSE`（本仓库已提供 MIT）、`README.md`。
- `engines.vscode` 与你实际支持的最低 VSCode 版本一致。
- （可选）在 `package.json` 的 `icon` 字段指向一张 128×128 的 PNG 图标；
  不使用图标不影响打包，但上架后展示效果会差一些。
- 图标与 README 中的图片**不能是 SVG**（`vsce` 出于安全会拒绝）。

## 发布（上架到 Marketplace）

> ⚠️ 上架前，把 `package.json` 里的 `publisher` 与 `repository.url` 改成你自己的真实值。
> `publisher` 一旦在 Marketplace 创建就不可更改，且必须与 `package.json` 完全一致。

整体流程分三步：**创建 Publisher → 获取 PAT → `vsce publish`**。

1. **创建 Publisher（发布者）**
   - 用 Microsoft 账号登录 <https://marketplace.visualstudio.com/manage>。
   - 点击 **Create publisher**，填写 ID（英文，用于扩展 URL，不可改）和显示名称。
   - 把 `package.json` 的 `publisher` 字段改成这个 ID。

2. **获取 Personal Access Token（PAT）**
   - 登录 <https://dev.azure.com>（Azure DevOps），进入组织 → **User settings → Personal Access Tokens → New Token**。
   - 名称随意；Expiration 建议选 90 天以上；Scopes 选 **Marketplace → Manage**（展开 "Show all scopes" 后勾选）。
   - 复制生成的 Token（只会显示一次，妥善保存）。

3. **登录并发布**

   ```bash
   vsce login <你的 publisher ID>   # 粘贴上面的 PAT
   vsce publish                     # 发布当前版本
   ```

   也可以发布时顺带递增版本号（SemVer）：

   ```bash
   vsce publish patch   # 0.0.1 -> 0.0.2
   vsce publish minor   # 0.0.1 -> 0.1.0
   vsce publish major   # 0.0.1 -> 1.0.0
   ```

   发布成功后约几分钟内可在
   <https://marketplace.visualstudio.com/items?itemName=<publisher>.deepseek-commit-message>
   看到并搜索到。

补充说明：

- `vsce publish` 会自动执行 `npm run vscode:prepublish`（即 `npm run compile`），保证发布的是最新编译产物。
- 也可以先 `vsce package` 生成 `.vsix`，再到 Marketplace 管理页手动上传 `.vsix`（网页版 **New extension** 上传），适合不便于命令行登录的场景。
- **国内网络**：Azure DevOps 与 Marketplace 在国内访问可能不稳定，若 `vsce login`/`vsce publish` 超时，可配置代理后重试。
- **备选分发渠道**：也可发布到开源 registry <https://open-vsx.org>（用 `ovsx publish`，网络更友好），Cursor、VSCodium 等从 Open VSX 拉取扩展。

## 说明

- 生成的 commit message 只会填充到 SCM 输入框，不会自动提交，可手动确认/修改后再提交。
- API Key 通过 `Set API Key` 命令安全存储于系统凭据库（SecretStorage），不写入 `settings.json`。若从旧版本升级，首次读取时会自动将明文迁移到凭据库并清除 `settings.json` 中的残留。
