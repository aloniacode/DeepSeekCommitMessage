# 开发与发布指南

本文档面向维护者与贡献者，说明如何开发、打包与发布本扩展。
普通用户请参阅 [README.md](README.md)。

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
- （可选）在 `package.json` 的 `icon` 字段指向一张 128×128 的 PNG 图标。
- 图标与 README 中的图片**不能是 SVG**（`vsce` 出于安全会拒绝）。

## 发布（上架到 Marketplace）

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
