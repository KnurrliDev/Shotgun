import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeConnection, ClaudeState } from './claude/connection';
import { isSamePath } from './claude/settings';
import type { DataFlowApi } from './dataflow/dataflow-api';
import { linkDataFlow } from './dataflow/dataflow';
import { HookDecorations } from './editor/hooks';
import { ClaudeLines } from './editor/lines';
import { StepDecorations } from './editor/steps';
import { parseBrief } from './session/brief';
import { addedLines, ChangeMark, CurrentStep, markName, receiptCounts, scopeOf } from './session/build';
import { readText } from './session/files';
import { LINES_FILE, LineStore } from './session/lines';
import { orderWarnings } from './session/order';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile, isInside, projectPath } from './session/paths';
import { levelOf } from './session/plan';
import { Level, LEVEL_INFO, LEVELS } from './session/risk';
import { GATE_LABEL, stageText } from './session/stages';
import { messageOf, SessionStore, Snapshot } from './session/store';
import { findHook, MAX_ANSWER, movedHook } from './session/survey';
import { BaseApi } from './tools/build';
import { PromptLog } from './tools/prompts';
import { planRisk } from './tools/plan';
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
const ACCEPT_RECEIPT = 'Accept the Receipt';

// The folders that the watcher of the files outside of the scope ignores: the folders of tools and of builds
const IGNORED_FOLDERS = /(^|[\\/])(\.git|\.shotgun|\.claude|\.vs|\.vscode|\.cache|node_modules|out|build|bin|obj|dist|target|cmake-build-[^\\/]*)([\\/]|$)/i;

// The kind of the change of a file while a step of Claude is open. transient: a file that came and went again, for
// example a temporary file of a tool
type FileChange = 'created' | 'changed' | 'deleted' | 'transient';

class Shotgun implements vscode.Disposable {
	private readonly log = vscode.window.createOutputChannel('Shotgun', { log: true });
	private readonly status = vscode.window.createStatusBarItem('shotgun.status', vscode.StatusBarAlignment.Left, 0);
	private readonly store: SessionStore;
	private readonly claude: ClaudeConnection;
	private readonly views: Views;
	// the last prompts of the user, only in memory, for the check of a brief from the chat (decision 12)
	private readonly prompts = new PromptLog();
	// the hooks of the survey in the text editor, in the stages 2 and 3, and the steps of the plan in the stages 4 and 5
	private readonly hooks = new HookDecorations();
	private readonly steps = new StepDecorations();
	// the writer of each changed line in stage 5, and the lines of Claude in the text editor
	private readonly lines = new LineStore();
	private readonly claudeLines = new ClaudeLines();
	private linesTask: string | undefined = undefined;
	// the files of the project that changed while a step of Claude was open
	private readonly stepChanges = new Map<string, FileChange>();
	// the files of the scope with a warning about an edit of the user, while a step of Claude is open
	private readonly warned = new Set<string>();
	private isOpeningStep = false;
	private readonly disposables: vscode.Disposable[] = [];
	private dataflow: DataFlowView = { state: 'linking' };
	private api: DataFlowApi | undefined;
	private updateTimer: NodeJS.Timeout | undefined;
	private isCheckingHooks = false;
	private isCheckingRisk = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		// Shotgun keeps its files in the first workspace folder (proposal P5)
		this.store = new SessionStore(this.folders()[0]);
		this.claude = new ClaudeConnection(context, this.log);
		this.views = new Views(context.extensionUri, (message) => void this.onViewMessage(message));
		this.status.name = 'Shotgun';
		this.status.command = `${PANEL_ID}.focus`;
		this.disposables.push(
			this.log, this.status, this.views, this.hooks, this.steps, this.claudeLines,
			new vscode.Disposable(() => this.lines.dispose()),
			this.store.onDidChange(() => this.update()),
			...this.commands(),
			this.watchFiles(),
			this.watchProject(),
			// a different program can change the settings of Claude Code, for example the command of DataFlow
			vscode.window.onDidChangeWindowState((state) => state.focused && this.update()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				if (this.folders()[0] !== this.store.snapshot.root) {
					void vscode.window.showInformationMessage('Shotgun uses the first folder of the workspace. Reload the window to use the new first folder.');
				}
			}),
			// the panel checks the parts of the brief while the user writes, and the survey page follows the code of the hooks
			vscode.workspace.onDidChangeTextDocument((e) => {
				this.trackLines(e);
				if (this.isWatched(e.document)) {
					this.updateSoon();
				}
			}),
			// a file with lines of a writer can change while it is closed
			vscode.workspace.onDidOpenTextDocument((doc) => doc.uri.scheme === 'file' && this.syncLines(doc.uri.fsPath, doc.getText())),
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
				base: () => this.baseApi(),
				saveFiles: (files) => this.saveFiles(files),
				lines: this.lines,
				changes: {
					start: () => {
						this.stepChanges.clear();
						this.warned.clear();
					},
					files: () => [...this.stepChanges].filter(([, kind]) => kind !== 'transient').map(([file]) => file),
				},
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
					this.checkFacts();
				}
			}),
			// at the end of the scan of the call graph, the heat of the hooks and the levels of the steps can change
			api.onDidChangeCallGraph((e) => {
				if (e.state === 'ready' || e.state === 'stopped' || e.state === 'failed') {
					this.checkFacts();
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
			functionHeat: (file, name) => api.getHeat({ file, function: name }),
			callGraph: () => api.getCallGraph(),
			scan: () => this.startScan(),
		};
	}

	// The bases and the diffs of DataFlow for the build. undefined: no link to DataFlow
	private baseApi(): BaseApi | undefined {
		const api = this.api;
		if (!api) {
			return undefined;
		}
		return {
			mark: (name, paths) => api.markBase({ name, paths: [...paths] }),
			diff: (base, paths) => api.getDiff({ base, paths: [...paths], allFiles: true }),
			deleteMark: (name) => api.deleteMark({ name }),
		};
	}

	// Saves the open text editors of the files that have changes, because Claude Code writes the files on the disk
	private async saveFiles(files: readonly string[]): Promise<void> {
		for (const file of files) {
			const doc = this.documentOf(file);
			if (doc?.isDirty) {
				await doc.save();
			}
		}
	}

	// Opens the current step of the build if the user writes it: Shotgun saves the files of its places, and makes the base
	// of the step. At "The step is done", the diff since the base gives the lines of the user
	private async openUserStep(): Promise<void> {
		const { task, root } = this.store.snapshot;
		const current = this.store.current;
		if (this.isOpeningStep || this.dataflow.state === 'linking' || !task || !root || task.isDone || task.stage !== 'build'
			|| !current || current.writer !== 'user' || current.state !== 'todo') {
			return;
		}
		this.isOpeningStep = true;
		try {
			const scope = scopeOf(current.step);
			const absolute = scope.map((f) => absolutePath(f, root));
			await this.saveFiles(absolute);
			const newFiles = scope.filter((_f, i) => this.textOf(absolute[i]) === undefined);
			const existing = absolute.filter((_f, i) => !newFiles.includes(scope[i]));
			let base: string | undefined;
			let baseError: string | undefined;
			if (existing.length > 0) {
				const api = this.baseApi();
				if (!api) {
					baseError = 'Shotgun has no link to DataFlow.';
				} else {
					const name = markName(task.id, current.step.id);
					try {
						await api.mark(name, existing);
						base = name;
					} catch (error) {
						baseError = `DataFlow did not make the base: ${messageOf(error)}`;
					}
				}
			}
			// the user can open a different task while DataFlow works
			if (this.store.snapshot.task?.id !== task.id || this.store.current?.step.id !== current.step.id || this.store.current.state !== 'todo') {
				return;
			}
			this.store.startStep(current.step.id, {
				writer: 'user', level: current.level, scope, ...(newFiles.length > 0 ? { newFiles } : {}), ...(base ? { base } : {}), ...(baseError ? { baseError } : {}),
			});
			this.log.info(`Step ${current.n} of the task ${task.id} is open for the user.${baseError ? ` It has no base: ${baseError}` : ''}`);
		} catch (error) {
			this.log.warn(`Shotgun did not open step ${current.n} for the user: ${messageOf(error)}`);
		} finally {
			this.isOpeningStep = false;
		}
	}

	// The lines of the user in a step of the user: the added lines since the base of the step, and each new file
	private async recordUserLines(current: CurrentStep, root: string): Promise<void> {
		const step = current.build;
		if (!step) {
			return;
		}
		const newFiles = step.newFiles ?? [];
		const parts = new Map<string, number[]>();
		if (step.base) {
			const api = this.baseApi();
			if (!api) {
				this.log.warn(`Shotgun has no link to DataFlow, so it did not record the lines of step ${current.n}.`);
			} else {
				const marked = step.scope.filter((f) => !newFiles.includes(f)).map((f) => absolutePath(f, root));
				const facts = await api.diff(`mark:${step.base}`, marked);
				for (const f of facts.files) {
					const file = projectPath(absolutePath(f.file, facts.root), root, IS_CASE_SENSITIVE);
					const lines = f.hunks.flatMap((h) => addedLines({ ...h, lines: [h.lines[0], h.lines[1]], key: '' }));
					parts.set(file, [...(parts.get(file) ?? []), ...lines]);
				}
			}
		}
		for (const file of newFiles) {
			const text = this.textOf(absolutePath(file, root));
			if (text) {
				const lines = text.split(/\r?\n/);
				const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
				parts.set(file, Array.from({ length: count }, (_v, i) => i + 1));
			}
		}
		for (const [file, lines] of parts) {
			const text = this.textOf(absolutePath(file, root));
			if (text !== undefined) {
				this.lines.replaceStep(file, text.split(/\r?\n/), 'user', current.step.id, [{ lines }]);
			}
		}
		this.lines.flush();
	}

	// The writer of the changed lines after an edit in the text editor. An edit of the user in the scope of an open step
	// of Claude gets a warning, because Claude Code writes the file on the disk
	private trackLines(e: vscode.TextDocumentChangeEvent): void {
		const { task, root } = this.store.snapshot;
		const doc = e.document;
		if (!task || !root || task.isDone || task.stage !== 'build' || doc.uri.scheme !== 'file' || e.contentChanges.length === 0 || !isInside(doc.uri.fsPath, root)) {
			return;
		}
		const file = projectPath(doc.uri.fsPath, root, IS_CASE_SENSITIVE);
		const current = this.store.current;
		const isScope = current?.writer === 'claude' && current.state === 'open'
			&& (current.build?.scope ?? []).some((f) => f.toLowerCase() === file.toLowerCase());
		if (isScope && doc.isDirty && !this.warned.has(file)) {
			this.warned.add(file);
			void vscode.window.showWarningMessage(`Shotgun: Claude writes step ${current!.n} in ${file} now. Your edit can conflict with the changes of Claude. `
				+ 'Undo your edit, or wait for the receipt.');
		}
		// a change from the disk, for example by Claude, gives the new lines no writer. The receipt gives them their writer
		const owner = doc.isDirty ? { writer: 'user' as const, step: current?.writer === 'user' && current.state === 'open' ? current.step.id : '' } : undefined;
		if (this.lines.sync(file, doc.getText().split(/\r?\n/), owner)) {
			this.claudeLines.renderSoon();
		}
	}

	// The lines of a file with lines of a writer after a change of the file, for example while the file was closed
	private syncLines(fsPath: string, text: string | undefined): void {
		const root = this.store.snapshot.root;
		if (!root || text === undefined || !isInside(fsPath, root)) {
			return;
		}
		if (this.lines.sync(projectPath(fsPath, root, IS_CASE_SENSITIVE), text.split(/\r?\n/))) {
			this.claudeLines.renderSoon();
		}
	}

	// lines.json of the active task. After a change of the active task, Shotgun reads its lines, and moves them to the text
	// of the files now
	private loadLines(): void {
		const { task, root } = this.store.snapshot;
		const id = task?.id;
		if (id === this.linesTask) {
			return;
		}
		this.linesTask = id;
		const dir = this.store.dir;
		this.lines.load(id && dir ? path.join(dir, id, LINES_FILE) : undefined);
		if (this.lines.loadProblem) {
			this.log.warn(`Shotgun did not read the lines of the writers: ${this.lines.loadProblem}`);
		}
		if (root) {
			for (const file of this.lines.paths) {
				const full = absolutePath(file, root);
				this.syncLines(full, this.textOf(full));
			}
		}
	}

	// The files of the project that change while a step of Claude is open, and the files with lines of a writer that
	// change on the disk
	private watchProject(): vscode.Disposable {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		const record = (uri: vscode.Uri, kind: 'created' | 'changed' | 'deleted') => {
			const { task, root } = this.store.snapshot;
			if (!task || !root || task.stage !== 'build' || uri.scheme !== 'file' || !this.folders().some((f) => isInside(uri.fsPath, f))) {
				return;
			}
			const rel = path.relative(this.folders().find((f) => isInside(uri.fsPath, f))!, uri.fsPath);
			if (IGNORED_FOLDERS.test(rel)) {
				return;
			}
			const current = this.store.current;
			if (current?.writer === 'claude' && current.state === 'open') {
				const old = this.stepChanges.get(uri.fsPath);
				let next: FileChange = kind;
				if (kind === 'deleted' && old === 'created') {
					next = 'transient';
				} else if (kind === 'created' && (old === 'deleted' || old === 'transient')) {
					next = 'changed';
				} else if (kind === 'changed' && old) {
					next = old === 'transient' ? 'changed' : old;
				}
				this.stepChanges.set(uri.fsPath, next);
			}
			// a closed file with lines of a writer: its lines move to the text on the disk
			if (kind !== 'deleted' && !this.documentOf(uri.fsPath)) {
				this.syncLines(uri.fsPath, readText(uri.fsPath));
			}
		};
		return vscode.Disposable.from(
			watcher,
			watcher.onDidCreate((uri) => record(uri, 'created')),
			watcher.onDidChange((uri) => record(uri, 'changed')),
			watcher.onDidDelete((uri) => record(uri, 'deleted')),
		);
	}

	// The facts of DataFlow again where they are missing: the hooks in the stages 2 and 3, the levels in stage 4
	private checkFacts(): void {
		void this.checkHooks(false).catch((error: unknown) => this.log.warn(`Shotgun did not check the hooks: ${messageOf(error)}`));
		void this.checkRisk(false).catch((error: unknown) => this.log.warn(`Shotgun did not check the levels: ${messageOf(error)}`));
	}

	// Gets the levels of the rules for the steps of the plan again, at the lines of their places now. isForced false: only
	// if a level is missing, or if the scan of the call graph was not complete at the last check
	private async checkRisk(isForced: boolean): Promise<void> {
		const { task, plan, risk, root } = this.store.snapshot;
		if (!task || !plan || !root || task.isDone || task.stage !== 'plan') {
			if (isForced) {
				throw new Error('The active task has no plan in stage 4, so it has no levels to check.');
			}
			return;
		}
		const isMissing = !risk || risk.scan !== 'ready' || plan.steps.some((s) => !risk.steps[s.id] || risk.steps[s.id].level === null);
		if ((!isForced && !isMissing) || this.isCheckingRisk) {
			return;
		}
		this.isCheckingRisk = true;
		try {
			const next = await planRisk(this.engineApi(), root, plan, (f) => this.textOf(f)?.split(/\r?\n/));
			// the user can open a different task, or Claude can give a new plan, while DataFlow works
			const now = this.store.snapshot;
			if (now.task?.id !== task.id || now.plan?.time !== plan.time) {
				return;
			}
			this.store.writeRisk(next);
			const waiting = Object.values(next.steps).filter((s) => s.level === null).length;
			this.log.info(`Shotgun checked the levels of ${plan.steps.length} steps with DataFlow. `
				+ (waiting > 0 ? `${waiting} steps have no level yet.` : 'Each step has a level of the rules.'));
		} finally {
			this.isCheckingRisk = false;
		}
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

	// The brief of the active task, or a file with a hook of its survey or a place of its plan: a change of the text changes
	// the views
	private isWatched(doc: vscode.TextDocument): boolean {
		if (this.isBrief(doc)) {
			return true;
		}
		const { survey, plan, root } = this.store.snapshot;
		if (!root || doc.uri.scheme !== 'file') {
			return false;
		}
		const isFile = (file: string) => isSamePath(absolutePath(file, root), doc.uri.fsPath);
		return !!survey?.hooks.some((h) => isFile(h.file)) || !!plan?.steps.some((s) => s.places.some((p) => isFile(p.file)));
	}

	private commands(): vscode.Disposable[] {
		// a command shows its error to the user
		const run = (fn: (arg?: unknown) => unknown) => async (arg?: unknown) => {
			try {
				await fn(arg);
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
			vscode.commands.registerCommand('shotgun.checkLevels', run(() => this.checkRisk(true))),
			vscode.commands.registerCommand('shotgun.setLevel', run(() => this.setLevel())),
			vscode.commands.registerCommand('shotgun.showStep', run((id?: unknown) => (typeof id === 'string' ? this.views.showStep(id) : this.views.showPage()))),
			vscode.commands.registerCommand('shotgun.markChange', run(() => this.markChange())),
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

	// The level of the user for a step, with the keyboard. The page has the same buttons
	private async setLevel(): Promise<void> {
		const { task, plan, risk, levels } = this.store.snapshot;
		if (!task || task.isDone || task.stage !== 'plan' || !plan) {
			void vscode.window.showInformationMessage('Shotgun: the active task has no plan in stage 4.');
			return;
		}
		const step = await vscode.window.showQuickPick(plan.steps.map((s, i) => {
			const l = levelOf(s.id, risk, levels);
			return {
				label: `${i + 1}. ${s.title}`,
				description: l.level ? `level ${l.level}${l.user ? `, the rules gave ${l.rule ?? 'no level'}` : ''}` : 'no level yet',
				id: s.id,
			};
		}), { title: 'Shotgun: Set Risk Level', placeHolder: 'Select the step' });
		if (!step) {
			return;
		}
		const choice = await vscode.window.showQuickPick<vscode.QuickPickItem & { level: Level | undefined }>([
			...LEVELS.map((n) => ({ label: `Level ${n}: ${LEVEL_INFO[n].name}`, detail: LEVEL_INFO[n].text, level: n as Level | undefined })),
			{ label: 'The level of the rules', detail: 'Removes your level. The step gets the level of the rules again.', level: undefined },
		], { title: `Shotgun: Set Risk Level of ${step.label}`, placeHolder: 'Select the level' });
		if (choice) {
			this.store.setLevel(step.id, choice.level);
		}
	}

	// The mark of the user on a change of the receipt, with the keyboard. The panel has the same buttons
	private async markChange(): Promise<void> {
		const current = this.store.current;
		const receipt = current?.build?.receipt;
		if (!current || current.state !== 'receipt' || !receipt || receipt.changes.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: the current step has no receipt to walk.');
			return;
		}
		const words: Record<ChangeMark, string> = { todo: 'no mark', ok: 'OK', issue: 'issue', question: 'question' };
		const change = await vscode.window.showQuickPick(receipt.changes.map((c) => ({
			label: `${c.id}: ${c.title}`,
			description: `${c.file}:${c.lines[0]} · +${c.added} −${c.removed} · ${words[c.mark]}`,
			detail: `Check: ${c.check}`,
			id: c.id,
		})), { title: `Shotgun: Mark a Change of Step ${current.n}`, placeHolder: 'Select the change' });
		if (!change) {
			return;
		}
		const mark = await vscode.window.showQuickPick<vscode.QuickPickItem & { mark: ChangeMark }>([
			{ label: 'OK', detail: 'The change is correct.', mark: 'ok' },
			{ label: 'Issue', detail: 'The change has a problem. Claude fixes it when you ask.', mark: 'issue' },
			{ label: 'Question', detail: 'You have a question for Claude about the change.', mark: 'question' },
			{ label: 'No mark', detail: 'You did not walk the change yet.', mark: 'todo' },
		], { title: `Shotgun: Mark ${change.id}`, placeHolder: 'Select your mark' });
		if (!mark) {
			return;
		}
		this.store.setMark(current.step.id, change.id, mark.mark);
		const old = receipt.changes.find((c) => c.id === change.id)?.userNote ?? '';
		const note = await vscode.window.showInputBox({
			title: `Shotgun: Your Note for ${change.id}`,
			prompt: 'Optional: a note for Claude, for example what is wrong, or your question. An empty note removes the note.',
			value: old,
			ignoreFocusOut: true,
		});
		if (note !== undefined && note.trim() !== old) {
			this.store.setChangeNote(current.step.id, change.id, note);
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

	// The gate of the current stage. In stage 5, the gate of the current step, or "The task is done"
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
			case 'plan':
				return this.passPlanGate(task);
			case 'build':
				return this.passBuildGate(task);
			default:
				throw new Error(`This version of Shotgun does not have the gate of ${stageText(task.stage)} yet.`);
		}
	}

	// The gates of stage 5: "Accept the receipt" for a step of Claude, "The step is done" for a step of the user, and "The
	// task is done" after the last step
	private async passBuildGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const root = this.store.snapshot.root!;
		const current = this.store.current;
		if (!current) {
			this.store.passGate('task-done');
			this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['task-done']}".`);
			return;
		}
		const step = current.build;
		if (current.writer === 'user') {
			if (current.state !== 'open' || !step) {
				throw new Error(`Shotgun opens step ${current.n} first. Try again in a moment.`);
			}
			await this.saveFiles(step.scope.map((f) => absolutePath(f, root)));
			try {
				await this.recordUserLines(current, root);
			} catch (error) {
				this.log.warn(`Shotgun did not record the lines of step ${current.n}: ${messageOf(error)}`);
			}
		} else {
			const receipt = step?.receipt;
			if (current.state !== 'receipt' || !receipt) {
				throw new Error(current.state === 'open' ? `Claude writes step ${current.n}. Wait for its receipt.`
					: `Claude writes step ${current.n}. Tell Claude "Do step ${current.n}." first.`);
			}
			const counts = receiptCounts(receipt);
			if (counts.issues > 0) {
				throw new Error(`${counts.issues === 1 ? '1 change has' : `${counts.issues} changes have`} an issue. Tell Claude "Fix the issues of step ${current.n}.", `
					+ 'or change the mark.');
			}
			const notWalked = counts.changes - counts.walked;
			if (notWalked > 0 || counts.questions > 0) {
				const parts = [
					...(notWalked > 0 ? [`${notWalked === 1 ? '1 change has' : `${notWalked} changes have`} no mark`] : []),
					...(counts.questions > 0 ? [`${counts.questions === 1 ? '1 question is' : `${counts.questions} questions are`} open`] : []),
				];
				const pick = await vscode.window.showWarningMessage(`${parts.join(', and ')}. Do you want to accept the receipt of step ${current.n}?`, {
					modal: true, detail: 'The ledger keeps each change with no mark as not walked. Claude answers a question only when you ask.',
				}, ACCEPT_RECEIPT);
				if (pick !== ACCEPT_RECEIPT) {
					return;
				}
			}
		}
		// the gate deletes the base of the step
		const base = step?.base;
		const api = this.baseApi();
		if (base && api) {
			await api.deleteMark(base).catch((error: unknown) => this.log.warn(`DataFlow did not delete the base ${base}: ${messageOf(error)}`));
		}
		this.store.finishStep(current.step.id, current.writer === 'user' ? 'step-done' : 'accept-receipt');
		this.log.info(`Step ${current.n} of the task ${task.id} is done.`);
		await this.openUserStep();
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

	// The gate of stage 4, "Accept the plan". Each step needs a level: the level of the rules, or a level of the user
	private passPlanGate(task: NonNullable<Snapshot['task']>): void {
		const { plan, risk, levels } = this.store.snapshot;
		if (!plan) {
			throw new Error('The active task has no plan. Ask Claude for the plan first, for example with "Make the plan."');
		}
		const waiting = plan.steps.filter((s) => levelOf(s.id, risk, levels).level === null).map((s) => s.id);
		if (waiting.length > 0) {
			throw new Error(`The steps ${waiting.join(', ')} have no level yet. Wait for the end of the scan of the call graph, or set their levels.`);
		}
		this.store.acceptPlan();
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['accept-plan']}" with ${plan.steps.length} steps.`);
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
				case 'setLevel':
					this.store.setLevel(message.step, message.level === null ? undefined : message.level as Level);
					break;
				case 'setLevelNote':
					this.store.setLevelNote(message.step, message.note);
					break;
				case 'checkLevels':
					await this.checkRisk(true);
					break;
				case 'setMark':
					this.store.setMark(message.step, message.change, message.mark);
					break;
				case 'setChangeNote':
					this.store.setChangeNote(message.step, message.change, message.note);
					vscode.window.setStatusBarMessage(`Shotgun: the note for ${message.change} is saved.`, 3000);
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
		const reload = (uri: vscode.Uri) => {
			// Shotgun writes lines.json after the edits of the user. The session does not need it
			if (path.basename(uri.fsPath) === LINES_FILE) {
				return;
			}
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
		this.loadLines();
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
		this.steps.update(snapshot);
		this.claudeLines.update(snapshot, this.lines);
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
		void vscode.commands.executeCommand('setContext', 'shotgun.hasPlan', !!task && !task.isDone && task.stage === 'plan' && !!snapshot.plan);
		const current = task && !task.isDone && task.stage === 'build' ? this.store.current : undefined;
		void vscode.commands.executeCommand('setContext', 'shotgun.hasReceipt', current?.state === 'receipt');
		void this.openUserStep();
	}
}
