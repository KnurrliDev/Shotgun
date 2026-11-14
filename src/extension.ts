import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeConnection, ClaudeState } from './claude/connection';
import { isSamePath } from './claude/settings';
import type { DataFlowApi } from './dataflow/dataflow-api';
import { linkDataFlow } from './dataflow/dataflow';
import { parseBrief } from './session/brief';
import { readText } from './session/files';
import { GATE_LABEL, stageText } from './session/stages';
import { messageOf, SessionStore } from './session/store';
import { PromptLog } from './tools/prompts';
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

// The button of a modal message that passes a gate with open questions
const PASS_GATE = 'Pass the Gate';

class Shotgun implements vscode.Disposable {
	private readonly log = vscode.window.createOutputChannel('Shotgun', { log: true });
	private readonly status = vscode.window.createStatusBarItem('shotgun.status', vscode.StatusBarAlignment.Left, 0);
	private readonly store: SessionStore;
	private readonly claude: ClaudeConnection;
	private readonly views: Views;
	// the last prompts of the user, only in memory, for the check of a brief from the chat (decision 12)
	private readonly prompts = new PromptLog();
	private readonly disposables: vscode.Disposable[] = [];
	private dataflow: DataFlowView = { state: 'linking' };
	private api: DataFlowApi | undefined;
	private updateTimer: NodeJS.Timeout | undefined;

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
			// the panel checks the parts of the brief while the user writes
			vscode.workspace.onDidChangeTextDocument((e) => this.isBrief(e.document) && this.updateSoon()),
			vscode.workspace.onDidSaveTextDocument((doc) => this.isBrief(doc) && this.update()),
			vscode.workspace.onDidCloseTextDocument((doc) => this.isBrief(doc) && this.update()),
			new vscode.Disposable(() => clearTimeout(this.updateTimer)),
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
		this.api = api;
		let toolsError: string | undefined;
		try {
			const tools = shotgunTools({
				store: this.store,
				folders: () => this.folders(),
				log: (m) => this.log.info(m),
				prompts: this.prompts,
				readText: (file) => this.textOf(file),
				openFile: (file) => void vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, preserveFocus: true }),
			});
			this.disposables.push(api.registerTools(tools));
			this.log.info(`DataFlow ${link.version} has the tools of Shotgun: ${tools.map((t) => `shotgun_${t.name}`).join(', ')}.`);
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

	// The open text editor of a file, if VS Code has one
	private documentOf(file: string): vscode.TextDocument | undefined {
		return vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && isSamePath(d.uri.fsPath, file));
	}

	// The text of a file: the text of the open text editor first, also with no save
	private textOf(file: string): string | undefined {
		return this.documentOf(file)?.getText() ?? readText(file);
	}

	private isBrief(doc: vscode.TextDocument): boolean {
		const file = this.store.briefFile();
		return !!file && doc.uri.scheme === 'file' && isSamePath(doc.uri.fsPath, file);
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
			vscode.commands.registerCommand('shotgun.openBrief', run(() => this.openBrief())),
			vscode.commands.registerCommand('shotgun.closeQuestion', run(() => this.closeQuestion())),
			vscode.commands.registerCommand('shotgun.passGate', run(() => this.passGate())),
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
		// the panel shows the parts of the brief, and the text editor gets the focus for the brief
		await vscode.commands.executeCommand(`${PANEL_ID}.focus`);
		await this.openBrief();
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

	// Opens brief.md of the active task, at a line from 1 if the panel gives one
	private async openBrief(line?: number): Promise<void> {
		const file = this.store.briefFile();
		if (!file) {
			throw new Error('No task is active. Make a task with "Shotgun: New Task".');
		}
		const position = line ? new vscode.Position(line - 1, 0) : undefined;
		await vscode.window.showTextDocument(vscode.Uri.file(file), {
			preview: false, ...(position ? { selection: new vscode.Range(position, position) } : {}),
		});
	}

	private async closeQuestion(id?: string): Promise<void> {
		const open = this.store.snapshot.questions.filter((q) => q.state === 'open');
		if (open.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: the active task has no open question of Claude.');
			return;
		}
		let target = id;
		if (!target) {
			const pick = await vscode.window.showQuickPick(open.map((q) => ({ label: q.text, id: q.id })), {
				title: 'Shotgun: Close Question', placeHolder: 'Select the question that the brief answers now',
			});
			target = pick?.id;
		}
		if (target) {
			this.store.closeQuestion(target);
		}
	}

	// The gate of the current stage. This version of Shotgun has only the gate of stage 1, "The brief is ready"
	private async passGate(): Promise<void> {
		const task = this.store.snapshot.task;
		if (!task) {
			throw new Error('No task is active.');
		}
		if (task.isDone) {
			throw new Error('The task is done. It has no more gates.');
		}
		if (task.stage !== 'brief') {
			throw new Error(`This version of Shotgun does not have the gate of ${stageText(task.stage)} yet.`);
		}
		const file = this.store.briefFile(task.id)!;
		// the gate uses the text on the disk, so the text editor saves it first
		const doc = this.documentOf(file);
		if (doc?.isDirty) {
			await doc.save();
		}
		const brief = parseBrief(readText(file) ?? '');
		const missing = brief.parts.filter((p) => !p.hasText).map((p) => p.name);
		if (missing.length > 0) {
			throw new Error(`These parts of the brief have no text: ${missing.join(', ')}. Write them in brief.md, and then select the gate again.`);
		}
		const open = this.store.snapshot.questions.filter((q) => q.state === 'open').length;
		if (open > 0) {
			const pick = await vscode.window.showWarningMessage(
				`Claude has ${open === 1 ? '1 open question' : `${open} open questions`} about the brief. Do you want to pass the gate "${GATE_LABEL['brief-ready']}"?`,
				{ modal: true, detail: 'The open questions stay in the ledger. The survey of Claude starts from the brief as it is.' }, PASS_GATE);
			if (pick !== PASS_GATE) {
				return;
			}
		}
		this.store.passGate('brief-ready');
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['brief-ready']}".`);
		this.startScan();
	}

	// The gate of the brief starts the scan of the call graph of DataFlow. The survey needs the heat of the functions
	private startScan(): void {
		if (!this.api) {
			this.log.warn('Shotgun has no link to DataFlow, so the scan of the call graph did not start.');
			return;
		}
		this.api.scanCallGraph().then(
			(result) => this.log.info(`The scan of the call graph started: ${JSON.stringify(result).slice(0, 300)}`),
			(error) => this.log.warn(`The scan of the call graph did not start: ${messageOf(error)}`),
		);
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
				case 'openBrief':
					await this.openBrief(message.line);
					break;
				case 'closeQuestion':
					await this.closeQuestion(message.id);
					break;
				case 'gate':
					await this.passGate();
					break;
				default:
					break;
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`Shotgun: ${messageOf(error)}`);
		}
	}

	// A change of the stage files by a different window, by Claude through a tool, or by the user, reloads the session
	private watchFiles(): vscode.Disposable {
		const root = this.folders()[0];
		if (!root) {
			return new vscode.Disposable(() => undefined);
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '.shotgun/**/*.{json,md}'));
		let timer: NodeJS.Timeout | undefined;
		const reload = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				this.store.load();
				this.update();
			}, 200);
		};
		return vscode.Disposable.from(
			watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload),
			new vscode.Disposable(() => clearTimeout(timer)),
		);
	}

	// An update a short time after the last key in the text editor
	private updateSoon(): void {
		clearTimeout(this.updateTimer);
		this.updateTimer = setTimeout(() => this.update(), 150);
	}

	private update(): void {
		const snapshot = this.store.snapshot;
		const claude: ClaudeState = this.claude.state(snapshot.root);
		const file = this.store.briefFile();
		const doc = file ? this.documentOf(file) : undefined;
		const text = doc?.getText() ?? (file ? readText(file) : undefined);
		this.views.update(buildModel({
			version: String(this.context.extension.packageJSON.version),
			snapshot,
			dataflow: this.dataflow,
			claude,
			...(file && text !== undefined ? { brief: { file, text, isDirty: !!doc?.isDirty } } : {}),
		}));
		const status = statusOf(snapshot);
		this.status.text = `$(send) ${status.text}`;
		this.status.tooltip = status.tooltip;
		this.status.show();
		void vscode.commands.executeCommand('setContext', 'shotgun.hasTask', !!snapshot.task);
		void vscode.commands.executeCommand('setContext', 'shotgun.isPaused', snapshot.isPaused);
		void vscode.commands.executeCommand('setContext', 'shotgun.hasQuestions', snapshot.questions.some((q) => q.state === 'open'));
	}
}
