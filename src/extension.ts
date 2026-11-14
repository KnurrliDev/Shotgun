import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeConnection, ClaudeState } from './claude/connection';
import { linkDataFlow } from './dataflow/dataflow';
import { stageText } from './session/stages';
import { messageOf, SessionStore } from './session/store';
import { shotgunTools } from './tools/tools';
import { buildModel, DataFlowView, statusOf } from './views/model';
import type { FromView, ViewCommand } from './views/protocol';
import { PANEL_ID, Views } from './views/views';

// The start of Shotgun. activate returns at once, because VS Code shows a view of an extension only after activate
// returns (phase 0, S1). The link to DataFlow and the tools of Shotgun start after it.

export function activate(context: vscode.ExtensionContext): void {
	const shotgun = new Shotgun(context);
	context.subscriptions.push(shotgun);
	void shotgun.start();
}

export function deactivate(): void {
	// The items in context.subscriptions stop all parts of Shotgun, so this function is empty
}

// The command of each button of the webviews. The button "Connect DataFlow" runs the command of DataFlow
const VIEW_COMMANDS: Readonly<Record<ViewCommand, string>> = {
	newTask: 'shotgun.newTask',
	openTask: 'shotgun.openTask',
	pause: 'shotgun.pause',
	continue: 'shotgun.continue',
	showPage: 'shotgun.showPage',
	connectClaude: 'shotgun.connectClaude',
	connectDataFlow: 'dataflow.claude.connect',
};

class Shotgun implements vscode.Disposable {
	private readonly log = vscode.window.createOutputChannel('Shotgun', { log: true });
	private readonly status = vscode.window.createStatusBarItem('shotgun.status', vscode.StatusBarAlignment.Left, 0);
	private readonly store: SessionStore;
	private readonly claude: ClaudeConnection;
	private readonly views: Views;
	private readonly disposables: vscode.Disposable[] = [];
	private dataflow: DataFlowView = { state: 'linking' };

	constructor(private readonly context: vscode.ExtensionContext) {
		// Shotgun keeps its files in the first workspace folder (proposal P5)
		this.store = new SessionStore(this.folders()[0]);
		this.claude = new ClaudeConnection(context, this.log);
		this.views = new Views(context.extensionUri, (message) => void this.onViewMessage(message));
		this.status.name = 'Shotgun';
		this.status.command = `${PANEL_ID}.focus`;
		this.disposables.push(
			this.log, this.status, this.views,
			this.store.onDidChange(() => this.update()),
			...this.commands(),
			this.watchFiles(),
			// a different program can change the settings of Claude Code, for example the command of DataFlow
			vscode.window.onDidChangeWindowState((state) => state.focused && this.update()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				if (this.folders()[0] !== this.store.snapshot.root) {
					void vscode.window.showInformationMessage('Shotgun uses the first folder of the workspace. Reload the window to use the new first folder.');
				}
			}),
		);
		this.store.load();
		this.update();
	}

	async start(): Promise<void> {
		try {
			this.claude.refresh();
		} catch (error) {
			this.log.warn(`Shotgun did not write the files of its plugin: ${messageOf(error)}`);
		}
		const link = await linkDataFlow();
		if (link.state !== 'ready') {
			this.dataflow = link.state === 'missing' ? { state: 'missing' }
				: link.state === 'old' ? { state: 'old', version: link.version }
					: { state: 'failed', version: link.version, reason: link.reason };
			this.log.warn(`Shotgun has no link to DataFlow: ${link.state}.`);
			this.update();
			return;
		}
		const { api } = link;
		let toolsError: string | undefined;
		try {
			this.disposables.push(api.registerTools(shotgunTools({ store: this.store, folders: () => this.folders(), log: (m) => this.log.info(m) })));
			this.log.info(`DataFlow ${link.version} has the tools of Shotgun: shotgun_get_session, shotgun_guard and shotgun_session_context.`);
		} catch (error) {
			toolsError = messageOf(error);
			this.log.error(`DataFlow did not add the tools of Shotgun: ${toolsError}`);
		}
		this.dataflow = { state: 'ready', version: link.version, engine: api.engineState, engineError: api.engineError, toolsError };
		this.disposables.push(api.onDidChangeEngineState((e) => {
			this.dataflow = { ...this.dataflow, engine: e.state, engineError: e.error };
			this.update();
		}));
		this.update();
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}

	// The workspace folders on the disk
	private folders(): string[] {
		return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
	}

	private commands(): vscode.Disposable[] {
		// a command shows its error to the user
		const run = (fn: () => unknown) => async () => {
			try {
				await fn();
			} catch (error) {
				void vscode.window.showErrorMessage(`Shotgun: ${messageOf(error)}`);
			}
		};
		return [
			vscode.commands.registerCommand('shotgun.newTask', run(() => this.newTask())),
			vscode.commands.registerCommand('shotgun.openTask', run(() => this.openTask())),
			vscode.commands.registerCommand('shotgun.pause', run(() => this.pause(true))),
			vscode.commands.registerCommand('shotgun.continue', run(() => this.pause(false))),
			vscode.commands.registerCommand('shotgun.showPage', run(() => this.views.showPage())),
			vscode.commands.registerCommand('shotgun.connectClaude', run(() => this.connectClaude())),
			vscode.commands.registerCommand('shotgun.disconnectClaude', run(() => this.disconnectClaude())),
		];
	}

	private async newTask(): Promise<void> {
		const title = await vscode.window.showInputBox({
			title: 'Shotgun: New Task',
			prompt: 'Give the title of the task. The title is also the name of the folder of the task in .shotgun.',
			placeHolder: 'A cycle limit for the solver',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Give a title.'),
		});
		if (title === undefined) {
			return;
		}
		const task = this.store.newTask(title);
		this.log.info(`New task ${task.id}: ${task.title}`);
		const root = this.store.snapshot.root;
		// a connected Shotgun turns its plugin on in the folder of the first task (proposal P15)
		if (root && this.claude.state(root).marketplace === 'ok') {
			this.claude.turnOn(root);
		}
		await vscode.commands.executeCommand(`${PANEL_ID}.focus`);
	}

	private async openTask(): Promise<void> {
		const snapshot = this.store.snapshot;
		const items = snapshot.tasks.map((t) => ({
			label: t.title,
			description: t.isDone ? 'done' : stageText(t.stage),
			detail: t.id === snapshot.task?.id ? 'The active task' : undefined,
			id: t.id,
		}));
		if (items.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: this folder has no tasks. Make a task with "Shotgun: New Task".');
			return;
		}
		const pick = await vscode.window.showQuickPick(items, { title: 'Shotgun: Open Task', placeHolder: 'Select the task' });
		if (pick) {
			this.store.openTask(pick.id);
		}
	}

	private pause(isPaused: boolean): void {
		this.store.setPaused(isPaused);
		vscode.window.setStatusBarMessage(isPaused
			? 'Shotgun: the guard is off. Select "Shotgun: Continue" after the work outside of the task.'
			: 'Shotgun: the guard is on again.', 5000);
	}

	private async connectClaude(): Promise<void> {
		const root = this.store.snapshot.root;
		const on = this.claude.connect(this.folders());
		const parts = ['Shotgun is connected to Claude Code.'];
		parts.push(on.length > 0
			? `Its plugin is on in ${on.map((f) => path.basename(f)).join(', ')}.`
			: 'Its plugin goes on in a folder with the first task.');
		parts.push('A new session of Claude Code gets the guard and the context.');
		this.update();
		if (this.claude.state(root).dataflow !== 'connected') {
			const choice = await vscode.window.showWarningMessage(
				`${parts.join(' ')} Connect DataFlow to Claude Code too: the tools of Shotgun are in the MCP server of DataFlow.`, 'Connect DataFlow');
			if (choice) {
				await vscode.commands.executeCommand(VIEW_COMMANDS.connectDataFlow);
				this.update();
			}
		} else {
			void vscode.window.showInformationMessage(parts.join(' '));
		}
	}

	private disconnectClaude(): void {
		const count = this.claude.disconnect(this.folders());
		this.update();
		void vscode.window.showInformationMessage(`Shotgun is not connected to Claude Code now. Its plugin is off in ${count === 1 ? '1 folder' : `${count} folders`}. `
			+ 'A new session of Claude Code has no guard and no context of Shotgun.');
	}

	private async onViewMessage(message: FromView): Promise<void> {
		try {
			switch (message.type) {
				case 'command':
					await vscode.commands.executeCommand(VIEW_COMMANDS[message.command]);
					if (message.command === 'connectDataFlow') {
						this.update();
					}
					break;
				case 'selectTask':
					this.store.openTask(message.id);
					break;
				case 'copy':
					await vscode.env.clipboard.writeText(message.text);
					vscode.window.setStatusBarMessage('Shotgun: the request is in the clipboard. Paste it in Claude Code.', 5000);
					break;
				default:
					break;
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`Shotgun: ${messageOf(error)}`);
		}
	}

	// A change of the stage files by a different window, or by the user, reloads the session
	private watchFiles(): vscode.Disposable {
		const root = this.folders()[0];
		if (!root) {
			return new vscode.Disposable(() => undefined);
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '.shotgun/**/*.json'));
		let timer: NodeJS.Timeout | undefined;
		const reload = () => {
			clearTimeout(timer);
			timer = setTimeout(() => this.store.load(), 200);
		};
		return vscode.Disposable.from(
			watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload),
			new vscode.Disposable(() => clearTimeout(timer)),
		);
	}

	private update(): void {
		const snapshot = this.store.snapshot;
		const claude: ClaudeState = this.claude.state(snapshot.root);
		this.views.update(buildModel({ version: String(this.context.extension.packageJSON.version), snapshot, dataflow: this.dataflow, claude }));
		const status = statusOf(snapshot);
		this.status.text = `$(send) ${status.text}`;
		this.status.tooltip = status.tooltip;
		this.status.show();
		void vscode.commands.executeCommand('setContext', 'shotgun.hasTask', !!snapshot.task);
		void vscode.commands.executeCommand('setContext', 'shotgun.isPaused', snapshot.isPaused);
	}
}
