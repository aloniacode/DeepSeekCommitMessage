import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { initSecrets } from "./configuration";

export function activate(context: vscode.ExtensionContext): void {
  initSecrets(context.secrets);
  registerCommands(context);
}

export function deactivate(): void {
  // 无需清理资源
}
