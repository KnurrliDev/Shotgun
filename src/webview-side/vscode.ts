import type { FromView } from '../views/protocol';

// The API that VS Code gives to the script of a webview
interface VsCodeApi {
	postMessage(message: FromView): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

// The script can call acquireVsCodeApi only one time
const vscode = acquireVsCodeApi();

export const post = (message: FromView): void => vscode.postMessage(message);
