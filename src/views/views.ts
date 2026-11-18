import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { isChangeMark } from '../session/build';
import { isVoice } from '../session/callouts';
import { isStage } from '../session/stages';
import type { FromView, ToView, ViewCommand, ViewModel } from './protocol';

// The 2 webviews of Shotgun: the panel beside the text editor (a webview view in the secondary side bar) and the page
// in the editor area. Both get the same view model. A webview sends the actions of the user, and the extension runs the
// commands of Shotgun for them. A button never starts Claude: the user types each request in Claude Code.

export const PANEL_ID = 'shotgun.panel';
export const PAGE_ID = 'shotgun.page';

const COMMANDS: readonly ViewCommand[] = ['newTask', 'openTask', 'pause', 'continue', 'showPage', 'connectClaude', 'connectDataFlow'];

// A message of a webview, with a check of its form. A webview runs scripts, so the extension trusts no message
export function isFromView(value: unknown): value is FromView {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const m = value as Record<string, unknown>;
	switch (m.type) {
		case 'ready':
			return true;
		case 'command':
			return typeof m.command === 'string' && (COMMANDS as readonly string[]).includes(m.command);
		case 'selectTask':
			return typeof m.id === 'string';
		case 'copy':
			return typeof m.text === 'string' && m.text.length <= 2000;
		case 'openBrief':
			return m.line === undefined || (Number.isInteger(m.line) && (m.line as number) > 0);
		case 'closeQuestion':
			return typeof m.id === 'string';
		case 'gate':
		case 'checkHooks':
			return true;
		case 'openPlace':
			return typeof m.path === 'string' && Number.isInteger(m.line) && (m.line as number) > 0;
		case 'showPlace':
			return typeof m.path === 'string' && Array.isArray(m.lines) && m.lines.length === 2 && m.lines.every((l) => Number.isInteger(l) && l > 0)
				&& (m.lines[0] as number) <= (m.lines[1] as number) && typeof m.note === 'string' && m.note.length <= 2000;
		case 'returnToStage':
			return isStage(m.stage);
		case 'saveAnswer':
			return typeof m.id === 'string' && typeof m.text === 'string' && m.text.length <= 4000;
		case 'editOrder':
			return isOrderEdit(m.edit);
		case 'setLevel':
			return typeof m.step === 'string' && m.step.length <= 64 && (m.level === null || (Number.isInteger(m.level) && (m.level as number) >= 1
				&& (m.level as number) <= 5));
		case 'setLevelNote':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.note === 'string' && m.note.length <= 2000;
		case 'answerDecision':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.decision === 'string' && m.decision.length <= 16
				&& typeof m.text === 'string' && m.text.length <= 2000;
		case 'addDecision':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.question === 'string' && m.question.length <= 2000;
		case 'removeDecision':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.decision === 'string' && m.decision.length <= 16;
		case 'checkLevels':
			return true;
		case 'setMark':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.change === 'string' && m.change.length <= 16 && isChangeMark(m.mark);
		case 'setChangeNote':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.change === 'string' && m.change.length <= 16 && typeof m.note === 'string'
				&& m.note.length <= 2000;
		case 'requestFrame':
			return typeof m.step === 'string' && m.step.length <= 64;
		case 'setVoice':
			return isVoice(m.voice);
		case 'closeCallout':
		case 'reopenCallout':
			return typeof m.step === 'string' && m.step.length <= 64 && typeof m.id === 'string' && m.id.length <= 16;
		case 'showInDataFlow':
			return typeof m.path === 'string' && Number.isInteger(m.line) && (m.line as number) > 0 && (m.source === 'threads' || m.source === 'logic'
				|| m.source === 'hidden');
		case 'resolveAnswer':
		case 'handLooseEnd':
		case 'closeLooseEnd':
		case 'reopenLooseEnd':
			return typeof m.id === 'string' && m.id.length <= 16;
		case 'showLedger':
		case 'copyLedger':
		case 'copyReviewPrompt':
		case 'stepGate':
			return true;
		case 'setReviewOptions':
			return typeof m.effort === 'string' && m.effort.length <= 16 && Array.isArray(m.areas) && m.areas.length <= 16
				&& m.areas.every((a) => typeof a === 'string' && a.length <= 16) && typeof m.text === 'string' && m.text.length <= 2000;
		case 'closeIssue':
		case 'reopenIssue':
			return typeof m.id === 'string' && m.id.length <= 16;
		case 'setIssueStep':
			return typeof m.id === 'string' && m.id.length <= 16 && typeof m.isStep === 'boolean';
		case 'showHint':
			return typeof m.step === 'string' && m.step.length <= 64 && Number.isInteger(m.hole) && (m.hole as number) >= 1 && Number.isInteger(m.level)
				&& (m.level as number) >= 1 && (m.level as number) <= 4;
		default:
			return false;
	}
}

// An edit of the order. The store checks the length of a text, so a long text gets a message for the user
function isOrderEdit(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const e = value as Record<string, unknown>;
	const isId = typeof e.id === 'string' && e.id.length <= 64;
	const isText = typeof e.text === 'string' && e.text.length <= 2000;
	switch (e.action) {
		case 'move':
			return isId && (e.step === -1 || e.step === 1);
		case 'text':
			return isId && isText;
		case 'add':
			return isText;
		case 'later':
			return isId && typeof e.isLater === 'boolean';
		case 'remove':
			return isId;
		default:
			return false;
	}
}

// The HTML of a webview. The policy allows only the script of the bundle, and the styles that the script adds with
// constructable stylesheets
function html(webview: vscode.Webview, extensionUri: vscode.Uri, script: 'panel' | 'page'): string {
	const nonce = randomBytes(16).toString('base64');
	const src = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', `${script}.js`));
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${src}"></script>
</body>
</html>`;
}

export class Views implements vscode.Disposable {
	private model: ViewModel | undefined;
	private panel: vscode.WebviewView | undefined;
	private page: vscode.WebviewPanel | undefined;
	private step: string | undefined; // the step of the last click on a CodeLens line
	private isLedgerDue = false; // a new page shows the ledger
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly extensionUri: vscode.Uri, private readonly onMessage: (message: FromView) => void) {
		this.disposables.push(
			vscode.window.registerWebviewViewProvider(PANEL_ID, { resolveWebviewView: (view) => this.attachPanel(view) }),
			vscode.window.registerWebviewPanelSerializer(PAGE_ID, { deserializeWebviewPanel: async (panel) => this.attachPage(panel) }),
		);
	}

	update(model: ViewModel): void {
		this.model = model;
		this.post(this.panel?.webview);
		this.post(this.page?.webview);
	}

	// Opens the page at a step of the plan, for example after a click on a CodeLens line in the text editor
	showStep(id: string): void {
		this.step = id;
		this.isLedgerDue = false;
		this.showPage();
		this.postStep();
	}

	// Opens the page at the ledger of the task (phase 9)
	showLedger(): void {
		this.step = undefined;
		this.isLedgerDue = true;
		this.showPage();
		this.postLedger();
	}

	// Opens the page in the editor area, or shows it
	showPage(): void {
		if (this.page) {
			this.page.reveal();
			return;
		}
		this.attachPage(vscode.window.createWebviewPanel(PAGE_ID, 'Shotgun', vscode.ViewColumn.Active, this.options()));
	}

	dispose(): void {
		this.page?.dispose();
		this.disposables.forEach((d) => d.dispose());
	}

	private options(): vscode.WebviewOptions {
		return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')] };
	}

	private attachPanel(view: vscode.WebviewView): void {
		this.panel = view;
		view.webview.options = this.options();
		view.webview.html = html(view.webview, this.extensionUri, 'panel');
		const listener = this.listen(view.webview);
		view.onDidDispose(() => {
			listener.dispose();
			if (this.panel === view) {
				this.panel = undefined;
			}
		});
	}

	private attachPage(panel: vscode.WebviewPanel): void {
		this.page = panel;
		panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'shotgun.svg');
		panel.webview.options = this.options();
		panel.webview.html = html(panel.webview, this.extensionUri, 'page');
		const listener = this.listen(panel.webview);
		panel.onDidDispose(() => {
			listener.dispose();
			if (this.page === panel) {
				this.page = undefined;
			}
		});
	}

	private listen(webview: vscode.Webview): vscode.Disposable {
		return webview.onDidReceiveMessage((message: unknown) => {
			if (!isFromView(message)) {
				return;
			}
			if (message.type === 'ready') {
				this.post(webview);
				// a new page gets the step of the last click on a CodeLens line, or the ledger, after its model
				if (webview === this.page?.webview) {
					this.postStep();
					this.postLedger();
				}
			} else {
				this.onMessage(message);
			}
		});
	}

	private post(webview: vscode.Webview | undefined): void {
		if (webview && this.model) {
			void webview.postMessage({ type: 'model', model: this.model } satisfies ToView);
		}
	}

	private postStep(): void {
		if (this.page && this.step) {
			void this.page.webview.postMessage({ type: 'selectStep', id: this.step } satisfies ToView);
		}
	}

	private postLedger(): void {
		if (this.page && this.isLedgerDue) {
			void this.page.webview.postMessage({ type: 'showLedger' } satisfies ToView);
		}
	}
}
