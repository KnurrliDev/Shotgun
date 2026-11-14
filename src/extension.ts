import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeConnection, ClaudeState } from './claude/connection';
import { isSamePath } from './claude/settings';
import type { DataFlowApi } from './dataflow/dataflow-api';
import { linkDataFlow } from './dataflow/dataflow';
import { HookDecorations } from './editor/hooks';
import { parseBrief } from './session/brief';
import { readText } from './session/files';
import { orderWarnings } from './session/order';
import { absolutePath, isCppFile, isInside } from './session/paths';
import { GATE_LABEL, stageText } from './session/stages';
import { messageOf, SessionStore, Snapshot } from './session/store';
import { findHook, MAX_ANSWER, movedHook } from './session/survey';
import { PromptLog } from './tools/prompts';
import { EngineApi, engineFacts } from './tools/survey';
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
	// the hooks of the survey in the text editor, in the stages 2 and 3
	private readonly hooks = new HookDecorations();
	private readonly disposables: vscode.Disposable[] = [];
	private dataflow: DataFlowView = { state: 'linking' };
	private api: DataFlowApi | undefined;
	private updateTimer: NodeJS.Timeout | undefined;
	private isCheckingHooks = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		// Shotgun keeps its files in the first workspace folder (proposal P5)
		this.store = new SessionStore(this.folders()[0]);
		this.claude = new ClaudeConnection(context, this.log);
		this.views = new Views(context.extensionUri, (message) => void this.onViewMessage(message));
		this.status.name = 'Shotgun';
		this.status.command = `${PANEL_ID}.focus`;
		this.disposables.push(
			this.log, this.status, this.views, this.hooks,
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
			// the panel checks the parts of the brief while the user writes, and the survey page follows the code of the hooks
			vscode.workspace.onDidChangeTextDocument((e) => this.isWatched(e.document) && this.updateSoon()),
			vscode.workspace.onDidSaveTextDocument((doc) => this.isWatched(doc) && this.update()),
			vscode.workspace.onDidCloseTextDocument((doc) => this.isWatched(doc) && this.update()),
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
				engine: () => this.engineApi(),
			});
			this.disposables.push(api.registerTools(tools));
			this.log.info(`DataFlow ${link.version} has the tools of Shotgun: ${tools.map((t) => `shotgun_${t.name}`).join(', ')}.`);
		} catch (error) {
			toolsError = messageOf(error);
			this.log.error(`DataFlow did not add the tools of Shotgun: ${toolsError}`);
		}
		this.dataflow = { state: 'ready', version: link.version, engine: api.engineState, engineError: api.engineError, toolsError };
		this.disposables.push(
			api.onDidChangeEngineState((e) => {
				this.dataflow = { ...this.dataflow, engine: e.state, engineError: e.error };
				this.update();
				if (e.state === 'ready') {
					void this.checkHooks(false).catch((error: unknown) => this.log.warn(`Shotgun did not check the hooks: ${messageOf(error)}`));
				}
			}),
			// at the end of the scan of the call graph, the heat of the hooks can change
			api.onDidChangeCallGraph((e) => {
				if (e.state === 'ready') {
					void this.checkHooks(false).catch((error: unknown) => this.log.warn(`Shotgun did not check the hooks: ${messageOf(error)}`));
				}
			}),
		);
		this.update();
	}

	// The facts of DataFlow for the hooks of the survey. undefined: no link to DataFlow
	private engineApi(): EngineApi | undefined {
		const api = this.api;
		if (!api) {
			return undefined;
		}
		return {
			// the read tools of DataFlow. The tools of Shotgun are in the same list, but a fact cites a tool of DataFlow
			tools: () => api.tools.filter((t) => t.isReadOnly && !t.name.startsWith('shotgun_')).map((t) => t.name),
			place: (file, line) => api.getPlace({ file, line }),
			heat: (file, lines) => api.getHeat({ file, lines: [lines[0], lines[1]] }),
		};
	}

	// Gets the facts of DataFlow for the hooks of the survey again, at their lines now. isForced false: only if facts are
	// missing, or if the scan of the call graph was not complete at the last check
	private async checkHooks(isForced: boolean): Promise<void> {
		const { task, survey, engine, root } = this.store.snapshot;
		if (!task || !survey || !root || task.isDone || (task.stage !== 'survey' && task.stage !== 'order')) {
			if (isForced) {
				throw new Error('The active task has no survey in stage 2 or 3, so it has no hooks to check.');
			}
			return;
		}
		const isMissing = !engine || !engine.isReachComplete
			|| survey.hooks.some((h) => !engine.hooks[h.id] || (!engine.hooks[h.id].hasFacts && isCppFile(h.file)));
		if ((!isForced && !isMissing) || this.isCheckingHooks) {
			return;
		}
		this.isCheckingHooks = true;
		try {
			const hooks = survey.hooks.map((h) => {
				const text = this.textOf(absolutePath(h.file, root))?.split(/\r?\n/);
				const lines = text ? findHook(text, h) : undefined;
				return lines ? movedHook(h, lines) : h;
			});
			const facts = await engineFacts(this.engineApi(), root, hooks);
			// the user can open a different task, or Claude can give a new survey, while DataFlow works
			const now = this.store.snapshot;
			if (now.task?.id !== task.id || now.survey?.time !== survey.time) {
				return;
			}
			this.store.writeEngine(facts);
			this.log.info(`Shotgun checked ${hooks.length === 1 ? '1 hook' : `${hooks.length} hooks`} with DataFlow. `
				+ (facts.isReachComplete ? 'The heat is complete.' : 'The scan of the call graph is not complete, so the heat can change.'));
		} finally {
			this.isCheckingHooks = false;
		}
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

	// The brief of the active task, or a file with a hook of its survey: a change of the text changes the views
	private isWatched(doc: vscode.TextDocument): boolean {
		if (this.isBrief(doc)) {
			return true;
		}
		const { survey, root } = this.store.snapshot;
		return !!survey && !!root && doc.uri.scheme === 'file' && survey.hooks.some((h) => isSamePath(absolutePath(h.file, root), doc.uri.fsPath));
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
			vscode.commands.registerCommand('shotgun.answerQuestion', run(() => this.answerQuestion())),
			vscode.commands.registerCommand('shotgun.checkHooks', run(() => this.checkHooks(true))),
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

	// The answer of the user to a question of the survey. The page has a text field for each question too
	private async answerQuestion(): Promise<void> {
		const { task, survey, answers } = this.store.snapshot;
		if (!task || task.isDone || task.stage !== 'survey' || !survey || survey.questions.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: the survey of the active task has no question to answer.');
			return;
		}
		const pick = await vscode.window.showQuickPick(survey.questions.map((q) => ({
			label: q.text,
			description: q.id,
			detail: answers[q.id] ? `Your answer: ${answers[q.id].text}` : 'No answer',
			id: q.id,
		})), { title: 'Shotgun: Answer Question', placeHolder: 'Select the question of the survey', matchOnDescription: true });
		if (!pick) {
			return;
		}
		const text = await vscode.window.showInputBox({
			title: `Shotgun: Answer ${pick.id}`,
			prompt: `${pick.label} An empty answer removes the answer.`,
			value: answers[pick.id]?.text ?? '',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length > MAX_ANSWER ? `Give an answer of ${MAX_ANSWER} characters or less.` : undefined),
		});
		if (text !== undefined) {
			this.store.setAnswer(pick.id, text);
		}
	}

	// Opens a file of the project at a line, for example the place of a hook from the survey page
	private async openPlace(file: string, line: number): Promise<void> {
		// the message comes from a webview, so Shotgun opens only files in the workspace folders
		if (!path.isAbsolute(file) || !this.folders().some((f) => isInside(file, f))) {
			throw new Error(`Shotgun opens only files in the workspace folders: ${file}`);
		}
		const position = new vscode.Position(Math.max(0, line - 1), 0);
		await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, selection: new vscode.Range(position, position) });
	}

	// The gate of the current stage. This version of Shotgun has the gates of the stages 1 to 3
	private async passGate(): Promise<void> {
		const task = this.store.snapshot.task;
		if (!task) {
			throw new Error('No task is active.');
		}
		if (task.isDone) {
			throw new Error('The task is done. It has no more gates.');
		}
		switch (task.stage) {
			case 'brief':
				return this.passBriefGate(task);
			case 'survey':
				return this.passSurveyGate(task);
			case 'order':
				return this.passOrderGate(task);
			default:
				throw new Error(`This version of Shotgun does not have the gate of ${stageText(task.stage)} yet.`);
		}
	}

	// The gate of stage 2, "Order the tasks". The order of the tasks starts from the survey of Claude
	private async passSurveyGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const { survey, answers } = this.store.snapshot;
		if (!survey) {
			throw new Error('The active task has no survey. Ask Claude for the survey first, for example with "Survey my brief."');
		}
		const open = survey.questions.filter((q) => !answers[q.id]).length;
		if (open > 0) {
			const pick = await vscode.window.showWarningMessage(
				`${open === 1 ? '1 question' : `${open} questions`} of the survey ${open === 1 ? 'has' : 'have'} no answer. Do you want to pass the gate "${GATE_LABEL['order-tasks']}"?`,
				{ modal: true, detail: 'The questions with no answer stay in the survey. You put the tasks in sequence with the survey as it is.' }, PASS_GATE);
			if (pick !== PASS_GATE) {
				return;
			}
		}
		this.store.passGate('order-tasks');
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['order-tasks']}".`);
	}

	// The gate of stage 3, "Accept the order". The warnings of the order check do not stop the gate, but the user sees them
	// first. A task with no survey gets its survey at the start of the plan
	private async passOrderGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const { survey } = this.store.snapshot;
		const order = this.store.order;
		const plan = order.tasks.filter((t) => !t.isLater);
		if (plan.length === 0) {
			throw new Error('Put 1 task or more into the plan first. Each task is for later now.');
		}
		const empty = plan.findIndex((t) => !t.text.trim());
		if (empty >= 0) {
			throw new Error(`Write the text of task ${empty + 1} first.`);
		}
		const warnings = orderWarnings(order, survey);
		if (warnings.length > 0) {
			const pick = await vscode.window.showWarningMessage(
				`The order check has ${warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`}. Do you want to pass the gate "${GATE_LABEL['accept-order']}"?`,
				{ modal: true, detail: `${warnings.map((w) => w.text).join('\n')}\n\nThe needs are words of Claude. Shotgun does not move a task.` }, PASS_GATE);
			if (pick !== PASS_GATE) {
				return;
			}
		}
		this.store.acceptOrder();
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['accept-order']}" with ${plan.length} tasks in the plan.`);
	}

	// The gate of stage 1, "The brief is ready"
	private async passBriefGate(task: NonNullable<Snapshot['task']>): Promise<void> {
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
				case 'openPlace':
					await this.openPlace(message.path, message.line);
					break;
				case 'saveAnswer':
					this.store.setAnswer(message.id, message.text);
					vscode.window.setStatusBarMessage(`Shotgun: the answer to ${message.id} is saved.`, 3000);
					break;
				case 'checkHooks':
					await this.checkHooks(true);
					break;
				case 'editOrder':
					this.store.editOrder(message.edit);
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
			readLines: (f) => this.textOf(f)?.split(/\r?\n/),
		}));
		this.hooks.update(snapshot);
		const status = statusOf(snapshot);
		this.status.text = `$(send) ${status.text}`;
		this.status.tooltip = status.tooltip;
		this.status.show();
		const { task, survey } = snapshot;
		const isSurvey = !!task && !task.isDone && task.stage === 'survey' && !!survey;
		void vscode.commands.executeCommand('setContext', 'shotgun.hasTask', !!task);
		void vscode.commands.executeCommand('setContext', 'shotgun.isPaused', snapshot.isPaused);
		void vscode.commands.executeCommand('setContext', 'shotgun.hasQuestions', snapshot.questions.some((q) => q.state === 'open'));
		void vscode.commands.executeCommand('setContext', 'shotgun.hasSurveyQuestions', isSurvey && survey.questions.length > 0);
		void vscode.commands.executeCommand('setContext', 'shotgun.hasHooks',
			!!task && !task.isDone && (task.stage === 'survey' || task.stage === 'order') && !!survey && survey.hooks.length > 0);
	}
}
