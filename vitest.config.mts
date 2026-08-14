import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // 将 VSCode 内置模块指向测试 stub，使不依赖 vscode 运行时也能测纯函数
      vscode: resolve(process.cwd(), "test/__mocks__/vscode.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
