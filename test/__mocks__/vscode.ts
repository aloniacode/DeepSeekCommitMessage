import { vi } from "vitest";

/** 测试用 VSCode API stub，仅覆盖被测模块用到的最小面。 */
export const window = {
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  activeTextEditor: undefined,
  withProgress: vi.fn(),
  createStatusBarItem: vi.fn(),
  createOutputChannel: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn(),
  workspaceFolders: undefined,
  getWorkspaceFolder: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const extensions = {
  getExtension: vi.fn(),
};

export const env = {
  clipboard: { writeText: vi.fn() },
};

export const Uri = {
  file: (p: string) => ({ fsPath: p }),
  parse: (p: string) => ({ fsPath: p }),
};

export const ProgressLocation = {
  Notification: 15,
  SourceControl: 10,
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

export const EventEmitter = class {
  fire(): void {}
  dispose(): void {}
};

export default {
  window,
  workspace,
  commands,
  extensions,
  env,
  Uri,
  ProgressLocation,
  ConfigurationTarget,
  EventEmitter,
};
