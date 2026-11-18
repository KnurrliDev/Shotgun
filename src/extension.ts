import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeConnection, ClaudeState } from './claude/connection';
import { isSamePath } from './claude/settings';
import type { DataFlowApi } from './dataflow/dataflow-api';
import { linkDataFlow } from './dataflow/dataflow';
import { CalloutDecorations } from './editor/callouts';
import { HoleDecorations } from './editor/holes';
import { HookDecorations } from './editor/hooks';
import { ClaudeLines } from './editor/lines';
import { StepDecorations } from './editor/steps';
import { commitMessage, headOf } from './git/message';
import { addedLines, buildNext, ChangeMark, CurrentStep, markName, receiptCounts, refOf, scopeOf, stateOf } from './session/build';
import {
	CALLOUTS_FILE, DEFAULT_PAUSE_SECONDS, DEFAULT_VOICE, factKeys, isVoice, keepUserState, LENS_OF, revealCallouts, updateCallouts, Voice, VOICE_TEXT, VOICES,
} from './session/callouts';
import { readText } from './session/files';
import { answerText, findMarkers, holeNow, isHoleDone } from './session/frame';
import { LINES_FILE, LineStore } from './session/lines';
import { claudeEnds, LooseFind } from './session/loose';
import { orderWarnings } from './session/order';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile, isInside, projectPath } from './session/paths';
import { levelOf, openDecisions, PlanPlace, PlanStep, writerOf } from './session/plan';
import { Level, LEVEL_INFO, LEVELS } from './session/risk';
import { Area, DEFAULT_OPTIONS, Effort, issueSteps, MAX_ISSUE_REASON, MAX_ROUNDS, reviewPrompt, roundOf } from './session/review';
import { GATE_LABEL, isStage, returnStages, STAGE_INFO, stageText } from './session/stages';
import { isStepStage, messageOf, SessionStore, Snapshot, workPlan } from './session/store';
import { findHook, MAX_ANSWER, movedHook } from './session/survey';
import { BaseApi, markScope } from './tools/build';
import { ToolCallLog } from './tools/calls';
import { fileFacts } from './tools/callouts';
import { findLooseEnds, LooseApi } from './tools/loose';
import { PromptLog } from './tools/prompts';
import { planRisk } from './tools/plan';
import { EngineApi, engineFacts } from './tools/survey';
import type { ReviewApi } from './tools/review';
import { shotgunTools } from './tools/tools';
import { claudeText, HOME_ID, HomeState, HomeView, parseRecent, Project, RECENT_KEY, withRecent } from './views/home';
import { buildModel, DataFlowView, statusOf } from './views/model';
import type { FromView, ViewCommand, ViewModel } from './views/protocol';
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
// The time between 2 reads of the commit message in Source Control
const COMMIT_POLL_MS = 2000;
// At the gate of a step, the maximum wait for the end of the scan of the call graph, and the time between 2 reads of
// its state
const SCAN_WAIT_MS = 30000;
const SCAN_POLL_MS = 250;
// The maximum length of a note of Shotgun in the side view of DataFlow
const MAX_NOTE = 300;
// The button of the modal message before a return to an earlier stage (decision 24)
const RETURN = 'Return';
const ACCEPT_RECEIPT = 'Accept the Receipt';
// The button of the modal message before a review after 3 rounds (P23)
const COPY_PROMPT = 'Copy the Prompt';
const FILL_HOLE = 'Fill the Hole';

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
	// the sidebar in the activity bar (decision 23)
	private readonly home = new HomeView();
	// the file with the notes of Shotgun in the side view of DataFlow (decision 26)
	private highlighted: string | undefined;
	// the last prompts of the user, only in memory, for the check of a brief from the chat (decision 12)
	private readonly prompts = new PromptLog();
	// the hooks of the survey in the text editor, in the stages 2 and 3, and the steps of the plan in the stages 4 and 5
	private readonly hooks = new HookDecorations();
	private readonly steps = new StepDecorations();
	// the writer of each changed line in stage 5, and the lines of Claude in the text editor
	private readonly lines = new LineStore();
	private readonly claudeLines = new ClaudeLines();
	// the holes of a frame of Claude in the text editor, and Tab between them
	private readonly frameHoles = new HoleDecorations();
	// the callouts on the lines of the user, and the answers of Claude on lines (phase 8)
	private readonly calloutMarks = new CalloutDecorations();
	private pauseTimer: NodeJS.Timeout | undefined;
	private isCheckingCallouts = false;
	private isCalloutCheckDue = false;
	private isStartingCallouts = false;
	private linesTask: string | undefined = undefined;
	// the files of the project that changed while a step of Claude was open
	private readonly stepChanges = new Map<string, FileChange>();
	// the files of the scope with a warning about an edit of the user, while a step of Claude is open
	private readonly warned = new Set<string>();
	private isOpeningStep = false;
	private readonly toolCalls = new ToolCallLog();
	private lastModel: ViewModel | undefined;
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
			this.log, this.status, this.views, this.hooks, this.steps, this.claudeLines, this.frameHoles, this.calloutMarks,
			this.home, vscode.window.registerTreeDataProvider(HOME_ID, this.home),
			new vscode.Disposable(() => clearTimeout(this.pauseTimer)),
			// the voice of the callouts: a new voice shows the callouts that it allows at once
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('shotgun')) {
					this.update();
					void this.checkCallouts();
				}
			}),
			new vscode.Disposable(() => this.lines.dispose()),
			this.store.onDidChange(() => this.update()),
			...this.commands(),
			this.watchFiles(),
			this.watchProject(),
			this.watchCommitMessage(),
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
				if (e.contentChanges.length > 0) {
					this.onEditForCallouts(e.document);
				}
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
		// decision 13: the calls of the tools of DataFlow by Claude
		this.disposables.push(api.onDidCallTool((e) => this.toolCalls.record(e)));
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
				review: () => this.reviewApi(),
				saveFiles: (files) => this.saveFiles(files),
				lines: this.lines,
				voice: () => this.voice(),
				isSteOutput: () => this.isSteOutput(),
				calls: (since) => this.toolCalls.since(since),
				message: () => {
					const root = this.store.snapshot.root;
					return root ? commitMessage(root) : undefined;
				},
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
			threads: (file) => api.getThreads({ file }),
			logic: (file, line) => api.getLogic({ file, line }),
			hidden: (file, line) => api.getHidden({ file, line }),
		};
	}

// The voice of the callouts and the time with no edit that makes a pause, from the settings (decision 19)
	private voice(): Voice {
		const value = vscode.workspace.getConfiguration('shotgun').get<string>('voice');
		return isVoice(value) ? value : DEFAULT_VOICE;
	}

	private pauseSeconds(): number {
		const value = vscode.workspace.getConfiguration('shotgun').get<number>('pauseSeconds', DEFAULT_PAUSE_SECONDS);
		return typeof value === 'number' && Number.isFinite(value) ? Math.min(60, Math.max(0.5, value)) : DEFAULT_PAUSE_SECONDS;
	}

	// The option of the page: while a task is active, Claude writes all text in STE (decision 41)
	private isSteOutput(): boolean {
		return vscode.workspace.getConfiguration('shotgun').get<boolean>('steOutput', false) === true;
	}

	// The current step with callouts: a step of the user, or a frame with its holes
	private calloutStep(): { id: string; scope: readonly string[]; places: readonly PlanPlace[] } | undefined {
		const current = this.store.current;
		const b = current?.build;
		if (!current || !b || !((b.writer === 'user' && b.state === 'open') || (b.writer === 'frame' && b.state === 'holes'))) {
			return undefined;
		}
		return { id: current.step.id, scope: b.scope, places: current.step.places };
	}

	// The facts of DataFlow at the start of the step: a fact with one of these keys is no callout. The start waits for the
	// engine of DataFlow
	private async ensureCalloutStart(): Promise<void> {
		const step = this.calloutStep();
		const root = this.store.snapshot.root;
		const engine = this.engineApi();
		if (!step || !root || !engine || this.isStartingCallouts || this.dataflow.engine !== 'ready' || this.store.snapshot.callouts?.steps[step.id]) {
			return;
		}
		this.isStartingCallouts = true;
		try {
			const keys: string[] = [];
			for (const file of step.scope.filter((f) => isCppFile(f))) {
				const full = absolutePath(file, root);
				const text = this.textOf(full);
				if (text === undefined) {
					continue;
				}
				const placeLines = step.places.filter((p) => p.lines && isSamePath(absolutePath(p.file, root), full)).map((p) => p.lines![0]);
				keys.push(...factKeys(await fileFacts(engine, full, placeLines.length > 0 ? placeLines : [1]), text.split(/\r?\n/)));
			}
			// the user can end the step while DataFlow works
			if (this.calloutStep()?.id === step.id && !this.store.snapshot.callouts?.steps[step.id]) {
				this.store.startCallouts(step.id, keys);
				this.log.info(`Shotgun keeps ${keys.length} facts of DataFlow at the start of step ${step.id}. Only a new fact on a line of the user is a callout.`);
			}
		} catch (error) {
			this.log.warn(`Shotgun did not get the facts at the start of step ${step.id}: ${messageOf(error)}`);
		} finally {
			this.isStartingCallouts = false;
		}
	}

	// An edit in a C or C++ file of the project starts the time of a pause again. Callouts come only at a pause
	private onEditForCallouts(doc: vscode.TextDocument): void {
		const root = this.store.snapshot.root;
		if (!root || doc.uri.scheme !== 'file' || !isCppFile(doc.uri.fsPath) || !isInside(doc.uri.fsPath, root) || !this.calloutStep()) {
			return;
		}
		clearTimeout(this.pauseTimer);
		this.pauseTimer = setTimeout(() => void this.checkCallouts(), this.pauseSeconds() * 1000);
	}

	// The check at a pause: the facts of DataFlow for the files with lines of the user in the step, the new callouts, and a
	// maximum of 3 of them for this pause
	private async checkCallouts(): Promise<void> {
		if (this.isCheckingCallouts) {
			this.isCalloutCheckDue = true;
			return;
		}
		const step = this.calloutStep();
		const root = this.store.snapshot.root;
		const start = step ? this.store.snapshot.callouts?.steps[step.id] : undefined;
		if (!step || !root) {
			return;
		}
		if (!start) {
			await this.ensureCalloutStart();
			return;
		}
		this.isCheckingCallouts = true;
		try {
			const engine = this.engineApi();
			let next = start;
			const userFiles = this.lines.paths.filter((f) => isCppFile(f) && this.lines.runs(f).some((r) => r.writer === 'user' && r.step === step.id));
			for (const file of [...new Set([...userFiles, ...start.callouts.map((c) => c.file)])]) {
				const full = absolutePath(file, root);
				const text = this.textOf(full);
				if (text === undefined) {
					continue;
				}
				const runs = this.lines.runs(file).filter((r) => r.writer === 'user' && r.step === step.id);
				const userLines = new Set(runs.flatMap((r) => Array.from({ length: r.lines[1] - r.lines[0] + 1 }, (_v, i) => r.lines[0] + i)));
				const facts = runs.length > 0 ? await fileFacts(engine, full, runs.map((r) => r.lines[0])) : [];
				next = updateCallouts(next, file, facts, text.split(/\r?\n/), userLines);
			}
			const revealed = revealCallouts(next, this.voice(), new Date().toISOString());
			// the user can end the step, or close a callout, while DataFlow works
			const latest = this.store.snapshot.callouts?.steps[step.id];
			if (this.calloutStep()?.id === step.id && latest) {
				const merged = keepUserState(revealed.step, latest);
				if (JSON.stringify(merged) !== JSON.stringify(latest)) {
					this.store.writeStepCallouts(step.id, merged);
				}
				if (revealed.shown > 0) {
					this.log.info(`A pause showed ${revealed.shown} ${revealed.shown === 1 ? 'callout' : 'callouts'} of step ${step.id}.`);
				}
			}
		} catch (error) {
			this.log.warn(`Shotgun did not check the callouts: ${messageOf(error)}`);
		} finally {
			this.isCheckingCallouts = false;
			if (this.isCalloutCheckDue) {
				this.isCalloutCheckDue = false;
				void this.checkCallouts();
			}
		}
	}

	// The prompt of the review of stage 6 into the clipboard. The review runs in a new session of Claude Code, which did not
	// write the code of the task (decision 35)
	private async copyReviewPrompt(): Promise<void> {
		const { task, review } = this.store.snapshot;
		if (!task || task.isDone || task.stage !== 'review') {
			throw new Error('The review prompt is only for a task in stage 6, the review.');
		}
		// after 3 rounds, the user thinks about the approach again first (P23)
		const round = roundOf(review);
		if (round > MAX_ROUNDS) {
			const pick = await vscode.window.showWarningMessage(`The next review is round ${round}. Do you want to copy its prompt?`, {
				modal: true,
				detail: `After ${MAX_ROUNDS} rounds, the issues did not end. Think about the approach of the task again, for example with a different plan. `
					+ 'To change the plan, return the task to stage 4.',
			}, COPY_PROMPT);
			if (pick !== COPY_PROMPT) {
				return;
			}
		}
		await vscode.env.clipboard.writeText(reviewPrompt(task.title, review?.options ?? DEFAULT_OPTIONS, round));
		void vscode.window.showInformationMessage('Shotgun: the review prompt is in the clipboard. Start a new session of Claude Code in the folder of the '
			+ 'project, and paste the prompt. A new session did not write the code, so it reviews with a fresh view.');
	}

	// "Not a problem" for an issue of the review: the reason of the user goes into the ledger, and the next review gets it
	private async closeIssue(id: string): Promise<void> {
		const issue = this.store.snapshot.review?.issues.find((i) => i.id === id);
		if (!issue) {
			return;
		}
		const reason = await vscode.window.showInputBox({
			title: `Shotgun: Not a Problem: ${issue.id}, ${issue.title}`,
			prompt: 'Why is this issue not a problem? The ledger keeps your reason, and the next review gets it.',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? (value.trim().length > MAX_ISSUE_REASON ? `A reason has a maximum of ${MAX_ISSUE_REASON} characters.` : undefined)
				: 'Give your reason.'),
		});
		if (reason !== undefined) {
			const removed = this.store.setIssueClosed(id, reason);
			await this.deleteBase(removed?.step.base);
		}
	}

	// "Make it a step" for an issue of the second list, or "Back to the second list" (P22)
	private async setIssueStep(id: string, isStep: boolean): Promise<void> {
		const isBlocked = this.isOpeningStep;
		this.isOpeningStep = true;
		try {
			const removed = this.store.setIssueStep(id, isStep);
			await this.deleteBase(removed?.step.base);
		} finally {
			this.isOpeningStep = isBlocked;
		}
		await this.openUserStep();
	}

	// "Not a problem": the reason of the user goes into the ledger
	private async closeCallout(stepArg?: unknown, idArg?: unknown): Promise<void> {
		const stepId = typeof stepArg === 'string' ? stepArg : this.calloutStep()?.id;
		const callouts = stepId ? (this.store.snapshot.callouts?.steps[stepId]?.callouts ?? []).filter((c) => c.shown && !c.closed && !c.isGone) : [];
		let id = typeof idArg === 'string' ? idArg : undefined;
		if (!stepId || (id === undefined && callouts.length === 0)) {
			void vscode.window.showInformationMessage('Shotgun: the current step has no open callout.');
			return;
		}
		if (id === undefined) {
			const pick = await vscode.window.showQuickPick(callouts.map((c) => ({ label: `${c.kind}: ${c.title}`, description: `${c.file}:${c.line}`, id: c.id })), {
				title: 'Shotgun: Not a Problem', placeHolder: 'Select the callout',
			});
			id = pick?.id;
		}
		const callout = callouts.find((c) => c.id === id) ?? this.store.snapshot.callouts?.steps[stepId]?.callouts.find((c) => c.id === id);
		if (!id || !callout) {
			return;
		}
		const reason = await vscode.window.showInputBox({
			title: `Shotgun: Not a Problem: ${callout.title}`,
			prompt: 'Why is this callout not a problem? The ledger keeps your reason.',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Give your reason.'),
		});
		if (reason !== undefined) {
			this.store.closeCallout(stepId, id, reason);
		}
	}

	// Shows a place of a hook or of a step in the side view of DataFlow, with its lines highlighted and a note, after a click
	// of the user (decision 26). Only the 1 side view shows the place, and no text editor opens, also with a C++ text editor
	// on the screen (decision 34). With no side view, DataFlow opens 1 new side view. The side view shows only C and C++
	// files, so a different file, or no link to DataFlow, opens the text editor. The notes of Shotgun stay in 1 file: a
	// place in a different file removes the notes of the last file
	private async showPlace(file: string, lines: readonly [number, number], note: string): Promise<void> {
		if (!path.isAbsolute(file) || !this.folders().some((f) => isInside(file, f))) {
			throw new Error(`Shotgun shows only places in the workspace folders: ${file}`);
		}
		const api = this.api;
		if (!api || !isCppFile(file) || !fs.existsSync(file)) {
			await this.openPlace(file, lines[0]);
			return;
		}
		const text = note.trim().replace(/\s+/g, ' ');
		const last = this.highlighted;
		if (last && !isSamePath(last, file)) {
			await api.clear({ file: last }).catch((error: unknown) => this.log.warn(`DataFlow did not remove the notes of Shotgun in ${last}: ${messageOf(error)}`));
		}
		const result = await api.highlight({
			file, ranges: [{ lines: [lines[0], lines[1]], kind: 'info', note: text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE - 1)}…` : text }], reveal: 'side',
		});
		this.highlighted = file;
		this.log.info(`DataFlow shows ${result.shown === 1 ? '1 note' : `${result.shown} notes`} of Shotgun in ${path.basename(file)}, lines ${lines[0]} to ${lines[1]}: ${text}`);
	}

	// Shows the line in the side view of DataFlow with the lens of the fact, after a click of the user. Only the side view
	// shows the line, and no text editor opens (decision 34)
	private async showInDataFlow(fileArg: unknown, lineArg: unknown, sourceArg: unknown): Promise<void> {
		const api = this.api;
		if (!api) {
			throw new Error('Shotgun has no link to DataFlow.');
		}
		const file = typeof fileArg === 'string' ? fileArg : '';
		const line = typeof lineArg === 'number' ? lineArg : 0;
		if (!path.isAbsolute(file) || !this.folders().some((f) => isInside(file, f)) || line < 1) {
			throw new Error('Shotgun shows only a line of a file in the workspace folders.');
		}
		await api.showLine({ file, line, reveal: 'side' });
		if (sourceArg === 'threads' || sourceArg === 'logic' || sourceArg === 'hidden') {
			await api.setLens({ lens: LENS_OF[sourceArg], on: true });
		}
	}

	private async setVoice(value?: unknown): Promise<void> {
		let voice = isVoice(value) ? value : undefined;
		if (!voice) {
			const pick = await vscode.window.showQuickPick(VOICES.map((v) => ({ label: v, detail: VOICE_TEXT[v], voice: v })), {
				title: 'Shotgun: Set the Voice of the Callouts', placeHolder: `Now: ${this.voice()}`,
			});
			voice = pick?.voice;
		}
		if (voice) {
			await vscode.workspace.getConfiguration('shotgun').update('voice', voice, vscode.ConfigurationTarget.Global);
		}
	}

	private async resolveAnswer(idArg?: unknown): Promise<void> {
		let id = typeof idArg === 'string' ? idArg : undefined;
		if (!id) {
			const open = (this.store.snapshot.callouts?.answers ?? []).filter((a) => !a.resolved);
			if (open.length === 0) {
				void vscode.window.showInformationMessage('Shotgun: no question on a line is open.');
				return;
			}
			const pick = await vscode.window.showQuickPick(open.map((a) => ({ label: a.question, description: `${a.file}:${a.line}`, id: a.id })), {
				title: 'Shotgun: Resolve a Question on a Line', placeHolder: 'Select the question',
			});
			id = pick?.id;
		}
		if (id) {
			this.store.resolveAnswer(id);
		}
	}

	// The bases and the diffs of DataFlow for the build. undefined: no link to DataFlow
	// The diff and the ripple of DataFlow since the base commit of the task, for the review of stage 6
	private reviewApi(): ReviewApi | undefined {
		const api = this.api;
		if (!api) {
			return undefined;
		}
		return {
			diff: (base, paths) => api.getDiff({ base, paths: [...paths], allFiles: true }),
			ripple: (base, paths) => api.getRipple({ base, paths: [...paths] }),
		};
	}

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
		if (this.isOpeningStep || this.dataflow.state === 'linking' || !task || !root || !isStepStage(task)
			|| !current || current.writer !== 'user' || current.state !== 'todo') {
			return;
		}
		this.isOpeningStep = true;
		try {
			const scope = scopeOf(current.step);
			const absolute = scope.map((f) => absolutePath(f, root));
			await this.saveFiles(absolute);
			let base: string | undefined;
			let baseError: string | undefined;
			const api = this.baseApi();
			if (!api) {
				baseError = 'Shotgun has no link to DataFlow.';
			} else {
				try {
					base = await markScope(api, markName(task.id, current.step.id), absolute);
				} catch (error) {
					baseError = `DataFlow did not make the base: ${messageOf(error)}`;
				}
			}
			// the user can open a different task while DataFlow works, or select "I want a frame", or change the level
			const now = this.store.current;
			if (this.store.snapshot.task?.id !== task.id || now?.step.id !== current.step.id || now.state !== 'todo' || now.writer !== 'user') {
				// no step uses the new base
				if (base && now?.build?.base !== base) {
					await this.deleteBase(base);
				}
				return;
			}
			this.store.startStep(current.step.id, {
				writer: 'user', level: current.level, scope, ...(base ? { base } : {}), ...(baseError ? { baseError } : {}),
			});
			this.log.info(`Step ${current.ref} of the task ${task.id} is open for the user.${baseError ? ` It has no base: ${baseError}` : ''}`);
		} catch (error) {
			this.log.warn(`Shotgun did not open step ${current.ref} for the user: ${messageOf(error)}`);
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
				this.log.warn(`Shotgun has no link to DataFlow, so it did not record the lines of step ${current.ref}.`);
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
				// a line of the frame of Claude keeps its writer
				this.lines.fillStep(file, text.split(/\r?\n/), 'user', current.step.id, lines);
			}
		}
		this.lines.flush();
	}

	// The writer of the changed lines after an edit in the text editor. An edit of the user in the scope of an open step
	// of Claude gets a warning, because Claude Code writes the file on the disk
	private trackLines(e: vscode.TextDocumentChangeEvent): void {
		const { task, root } = this.store.snapshot;
		const doc = e.document;
		if (!task || !root || !isStepStage(task) || doc.uri.scheme !== 'file' || e.contentChanges.length === 0 || !isInside(doc.uri.fsPath, root)) {
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
		const isUserStep = (current?.writer === 'user' && current.state === 'open') || (current?.writer === 'frame' && current.state === 'holes');
		const owner = doc.isDirty ? { writer: 'user' as const, step: isUserStep ? current!.step.id : '' } : undefined;
		if (this.lines.sync(file, doc.getText().split(/\r?\n/), owner)) {
			this.claudeLines.renderSoon();
		}
	}

	// The files of the scope of an open step of the user, or of a frame with holes. Shotgun follows their lines from the
	// start of the step. Thus a line that the user types is a line of the user at once, also in a file with no lines of a
	// writer. The callouts need these lines before "The step is done"
	private trackStepFiles(): void {
		const step = this.calloutStep();
		const root = this.store.snapshot.root;
		if (!step || !root) {
			return;
		}
		for (const file of step.scope) {
			// a new file of the step has no text yet, so each line in it is a new line
			if (!this.lines.has(file) && this.lines.track(file, (this.textOf(absolutePath(file, root)) ?? '').split(/\r?\n/))) {
				this.log.info(`Shotgun follows the lines of ${file} for step ${step.id}.`);
			}
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
			if (!task || !root || (task.stage !== 'build' && task.stage !== 'review') || uri.scheme !== 'file' || !this.folders().some((f) => isInside(uri.fsPath, f))) {
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
			vscode.commands.registerCommand('shotgun.openTask', run((id?: unknown) => this.openTask(id))),
			vscode.commands.registerCommand('shotgun.returnToStage', run((stage?: unknown) => this.returnToStage(stage))),
			vscode.commands.registerCommand('shotgun.showPanel', run(() => vscode.commands.executeCommand(`${PANEL_ID}.focus`))),
			vscode.commands.registerCommand('shotgun.showLog', run(() => this.log.show())),
			vscode.commands.registerCommand('shotgun.openProjectFolder', run(() => this.openProjectFolder())),
			vscode.commands.registerCommand('shotgun.openRecentProject', run((root?: unknown) => this.openRecentProject(root))),
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
			vscode.commands.registerCommand('shotgun.nextHole', run(() => this.goToHole(1))),
			vscode.commands.registerCommand('shotgun.previousHole', run(() => this.goToHole(-1))),
			vscode.commands.registerCommand('shotgun.nextHint', run((step?: unknown, hole?: unknown) => this.nextHint(step, hole))),
			vscode.commands.registerCommand('shotgun.requestFrame', run(() => this.requestFrame())),
			vscode.commands.registerCommand('shotgun.closeCallout', run((step?: unknown, id?: unknown) => this.closeCallout(step, id))),
			vscode.commands.registerCommand('shotgun.showInDataFlow', run((file?: unknown, line?: unknown, source?: unknown) => this.showInDataFlow(file, line, source))),
			vscode.commands.registerCommand('shotgun.setVoice', run((voice?: unknown) => this.setVoice(voice))),
			vscode.commands.registerCommand('shotgun.resolveAnswer', run((id?: unknown) => this.resolveAnswer(id))),
			vscode.commands.registerCommand('shotgun.handLooseEnd', run((id?: unknown) => this.handLooseEnd(id))),
			vscode.commands.registerCommand('shotgun.closeLooseEnd', run((id?: unknown) => this.closeLooseEnd(id))),
			vscode.commands.registerCommand('shotgun.showLedger', run(() => this.views.showLedger())),
			vscode.commands.registerCommand('shotgun.copyLedger', run(() => this.copyLedger())),
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

	// With the id of a task, for example from the sidebar, the task becomes the active task, and the panel shows it. With no
	// id, the user selects the task
	private async openTask(idArg?: unknown): Promise<void> {
		const snapshot = this.store.snapshot;
		if (typeof idArg === 'string') {
			if (idArg !== snapshot.task?.id) {
				this.store.openTask(idArg);
			}
			await vscode.commands.executeCommand(`${PANEL_ID}.focus`);
			return;
		}
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

	// The user returns the active task to an earlier stage, also a done task (decision 24). With no stage, the user selects
	// it. The work of the later stages stays, and an open step of the build goes back to todo (decision 25)
	private async returnToStage(stageArg?: unknown): Promise<void> {
		const { task, build, plan } = this.store.snapshot;
		if (!task) {
			throw new Error('No task is active. Select a task with "Shotgun: Open Task".');
		}
		const stages = returnStages(task);
		if (stages.length === 0) {
			void vscode.window.showInformationMessage(`Shotgun: the task "${task.title}" is in stage 1, the brief. It has no earlier stage.`);
			return;
		}
		let stage = isStage(stageArg) ? stageArg : undefined;
		if (stage === undefined) {
			const pick = await vscode.window.showQuickPick([...stages].reverse().map((s) => ({ label: `${STAGE_INFO[s].number} ${STAGE_INFO[s].name}`, stage: s })), {
				title: 'Shotgun: Return to a Stage', placeHolder: task.isDone ? `The task "${task.title}" is done` : `The task "${task.title}" is in ${stageText(task.stage)}`,
			});
			if (!pick) {
				return;
			}
			stage = pick.stage;
		}
		const open = Object.entries(build?.steps ?? {}).find(([, s]) => s.state === 'open')?.[0];
		const n = open ? (plan?.steps.findIndex((s) => s.id === open) ?? -1) + 1 : 0;
		const detail = ['The work of the later stages stays. To come back, pass the gates again.',
			...(open ? [`Step ${n > 0 ? n : open} is open. It goes back to todo, and its changes stay in the files.`] : [])].join(' ');
		const choice = await vscode.window.showWarningMessage(`Return the task "${task.title}" to ${stageText(stage)}?`, { modal: true, detail }, RETURN);
		if (choice !== RETURN) {
			return;
		}
		const { removed } = this.store.returnToStage(stage);
		await this.deleteBase(removed?.step.base);
		this.log.info(`The task ${task.id} returned to ${stageText(stage)}.${removed ? ` Step ${removed.id} went back to todo.` : ''}`);
		await this.openUserStep();
	}

	// Opens the folder of a project in this window, as "File: Open Folder" does
	private async openProjectFolder(): Promise<void> {
		const pick = await vscode.window.showOpenDialog({
			canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Shotgun: Open Project Folder', openLabel: 'Open',
		});
		if (pick?.[0]) {
			await vscode.commands.executeCommand('vscode.openFolder', pick[0]);
		}
	}

	// Opens a recent project in this window. With no folder, the user selects the project
	private async openRecentProject(rootArg?: unknown): Promise<void> {
		let root = typeof rootArg === 'string' ? rootArg : undefined;
		if (root === undefined) {
			const recent = this.recentProjects();
			if (recent.length === 0) {
				void vscode.window.showInformationMessage('Shotgun: no recent project yet. A folder with a task of Shotgun becomes a recent project.');
				return;
			}
			const pick = await vscode.window.showQuickPick(recent.map((p) => ({ label: p.name, description: p.root, root: p.root })), {
				title: 'Shotgun: Open Recent Project', placeHolder: 'Select the project',
			});
			root = pick?.root;
		}
		if (!root) {
			return;
		}
		if (!fs.existsSync(root)) {
			const gone = root;
			await this.context.globalState.update(RECENT_KEY, parseRecent(this.context.globalState.get(RECENT_KEY)).filter((p) => !isSamePath(p.root, gone)));
			this.update();
			throw new Error(`The folder ${root} is not there. Shotgun removed it from the recent projects.`);
		}
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root));
	}

	// The recent projects of all windows that are still on the disk
	private recentProjects(): Project[] {
		return parseRecent(this.context.globalState.get(RECENT_KEY)).filter((p) => fs.existsSync(p.root));
	}

	// A folder with a task of Shotgun goes to the top of the recent projects
	private rememberProject(root: string | undefined, hasTasks: boolean): void {
		if (!root || !hasTasks) {
			return;
		}
		const recent = parseRecent(this.context.globalState.get(RECENT_KEY));
		if (recent[0] && isSamePath(recent[0].root, root)) {
			return;
		}
		void this.context.globalState.update(RECENT_KEY, withRecent(recent, { name: path.basename(root), root }));
	}

	// The state of the sidebar: the tasks of the project, the guard, the connection to Claude Code and the recent projects
	private homeState(snapshot: Snapshot, claude: ClaudeState): HomeState {
		const { root, task } = snapshot;
		return {
			...(root ? { project: { name: path.basename(root), root } } : {}),
			tasks: snapshot.tasks.map((t) => ({
				id: t.id, title: t.title, isActive: t.id === task?.id, isDone: t.isDone,
				stage: t.isDone ? 'done' : `${STAGE_INFO[t.stage].number} ${STAGE_INFO[t.stage].name}`,
				stageText: t.isDone ? 'done' : stageText(t.stage),
			})),
			hasLedger: !!task && (task.isDone || task.stage === 'build' || task.stage === 'review'),
			canReturn: !!task && returnStages(task).length > 0,
			isPaused: snapshot.isPaused,
			claude: claudeText(claude, snapshot.tasks.length > 0),
			recent: this.recentProjects(),
		};
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

	// The level of the user for a step, with the keyboard. The page has the same buttons. In the stages 5 and 6, only the
	// steps that Claude did not start (decision 17). In stage 6, only the steps of the issues
	private async setLevel(): Promise<void> {
		const snapshot = this.store.snapshot;
		const { task, risk, levels, build } = snapshot;
		const plan = workPlan(snapshot);
		if (!task || task.isDone || (task.stage !== 'plan' && task.stage !== 'build' && task.stage !== 'review') || !plan) {
			void vscode.window.showInformationMessage('Shotgun: the active task has no plan in stage 4 or 5, and no step of an issue in stage 6.');
			return;
		}
		const isEditable = (s: PlanStep) => task.stage === 'plan' || ((task.stage === 'build' || !!s.issue) && (stateOf(build, s.id) === 'todo'
			|| (stateOf(build, s.id) === 'open' && build?.steps[s.id]?.writer === 'user')));
		const items = plan.steps.filter(isEditable).map((s) => {
			const l = levelOf(s, risk, levels);
			return {
				label: `${refOf(s, plan.steps.indexOf(s) + 1)}. ${s.title}`,
				description: l.level ? `level ${l.level}${l.user ? `, the rules gave ${l.rule ?? 'no level'}` : ''}` : 'no level yet',
				id: s.id,
			};
		});
		if (items.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: Claude started each step that is not done, so no level can change.');
			return;
		}
		const step = await vscode.window.showQuickPick(items, { title: 'Shotgun: Set Risk Level', placeHolder: 'Select the step' });
		if (!step) {
			return;
		}
		const choice = await vscode.window.showQuickPick<vscode.QuickPickItem & { level: Level | undefined }>([
			...LEVELS.map((n) => ({ label: `Level ${n}: ${LEVEL_INFO[n].name}`, detail: LEVEL_INFO[n].text, level: n as Level | undefined })),
			{ label: 'The level of the rules', detail: 'Removes your level. The step gets the level of the rules again.', level: undefined },
		], { title: `Shotgun: Set Risk Level of ${step.label}`, placeHolder: 'Select the level' });
		if (choice) {
			await this.changeLevel(step.id, choice.level);
		}
	}

	// A new level of the user. In stage 5, the step starts again with the writer of its new level, so the base of a step of
	// the user goes away first. Shotgun opens a step of the user again with a new base
	private async changeLevel(id: string, level: Level | undefined): Promise<void> {
		const isBlocked = this.isOpeningStep;
		this.isOpeningStep = true;
		try {
			const removed = this.store.setLevel(id, level);
			await this.deleteBase(removed?.base);
		} finally {
			this.isOpeningStep = isBlocked;
		}
		await this.openUserStep();
	}

	// A change of the decisions of a step (P29). An answer can change the writer of the step (decision 31). In stage 5, a step
	// with a new writer starts again, as after a new level
	private async changeDecision(change: () => { readonly base?: string } | undefined): Promise<void> {
		const isBlocked = this.isOpeningStep;
		this.isOpeningStep = true;
		try {
			const removed = change();
			await this.deleteBase(removed?.base);
		} finally {
			this.isOpeningStep = isBlocked;
		}
		await this.openUserStep();
	}

	private async deleteBase(base: string | undefined): Promise<void> {
		const api = this.baseApi();
		if (base && api) {
			await api.deleteMark(base).catch((error: unknown) => this.log.warn(`DataFlow did not delete the base ${base}: ${messageOf(error)}`));
		}
	}

	// The button "I want a frame" of a step of level 4 of the user (decision 16)
	private async requestFrame(id?: string): Promise<void> {
		const current = this.store.current;
		if (!current) {
			throw new Error('Each step of the plan is done.');
		}
		const old = this.store.requestFrame(id ?? current.step.id);
		await this.deleteBase(old?.base);
		vscode.window.setStatusBarMessage(`Shotgun: tell Claude "Give me a frame for step ${current.ref}."`, 8000);
	}

	// Tab and Shift+Tab in a frame: the next open hole, or the hole before it. With no open hole, the keys indent as usual
	private async goToHole(direction: 1 | -1): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const marker = editor ? this.frameHoles.nextHole(editor, direction) : undefined;
		if (!editor || !marker) {
			await vscode.commands.executeCommand(direction === 1 ? 'tab' : 'outdent');
			return;
		}
		const range = new vscode.Range(marker.start.line - 1, marker.start.col, marker.end.line - 1, marker.end.col);
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	// The next hint of a hole: the hole of the arguments, else the hole at the cursor, else the first open hole
	private async nextHint(stepArg?: unknown, holeArg?: unknown): Promise<void> {
		const current = this.store.current;
		const holes = current?.state === 'holes' ? current.build?.holes ?? [] : [];
		if (!current || holes.length === 0) {
			void vscode.window.showInformationMessage('Shotgun: the current step has no frame with holes.');
			return;
		}
		let n = typeof holeArg === 'number' && (typeof stepArg !== 'string' || stepArg === current.step.id) ? holeArg : undefined;
		const editor = vscode.window.activeTextEditor;
		if (n === undefined && editor) {
			const at = this.frameHoles.holesIn(editor.document).find(({ now }) => now.line - 1 <= editor.selection.active.line
				&& editor.selection.active.line <= now.lastLine - 1);
			n = at?.hole.n;
		}
		const root = this.store.snapshot.root!;
		const hole = holes.find((h) => h.n === n) ?? holes.find((h) => {
			const lines = this.textOf(absolutePath(h.file, root))?.split(/\r?\n/) ?? [];
			return holeNow(lines, h, findMarkers(lines.join('\n'))).state === 'open';
		});
		if (!hole) {
			void vscode.window.showInformationMessage('Shotgun: each hole of the frame has code.');
			return;
		}
		if (hole.shown >= 4) {
			void vscode.window.showInformationMessage(`Shotgun: hole ${hole.n} has each hint open already.`);
			return;
		}
		const level = hole.shown + 1;
		const shown = await this.showHint(current.step.id, hole.n, level);
		if (shown && level < 4) {
			const texts = [shown.hints.nudge, `${shown.hints.pointer.text} ${shown.hints.pointer.places.map((p) => `${p.file}:${p.lines[0]}-${p.lines[1]}`).join(', ')}`,
				`${shown.hints.example.text} ${shown.hints.example.file}:${shown.hints.example.lines[0]}: ${shown.hints.example.code}`];
			void vscode.window.showInformationMessage(`Shotgun: hint ${level} of hole ${hole.n}, by Claude: ${texts[level - 1]}`);
		}
	}

	// The user opens the hints of a hole up to a level. Level 4 fills the hole with the answer of Claude, after a modal
	// message. The result: the hole after the change, or undefined if the user did not confirm
	private async showHint(step: string, n: number, level: number) {
		if (level >= 4) {
			const pick = await vscode.window.showWarningMessage(`Do you want the answer of Claude in hole ${n}?`, {
				modal: true, detail: 'The answer goes into the place of the marker. Its lines are lines of Claude, and the ledger records it.',
			}, FILL_HOLE);
			if (pick !== FILL_HOLE) {
				return undefined;
			}
			await this.fillAnswer(step, n);
		}
		return this.store.setHint(step, n, level);
	}

	// Puts the answer of Claude into the place of the marker of a hole. The lines of the answer are lines of Claude
	private async fillAnswer(step: string, n: number): Promise<void> {
		const root = this.store.snapshot.root;
		const current = this.store.current;
		const hole = current?.build?.holes?.find((h) => h.n === n);
		if (!root || !current || current.step.id !== step || current.state !== 'holes' || !hole) {
			throw new Error(`The current step has no hole ${n} to fill.`);
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath(hole.file, root)));
		const lines = doc.getText().split(/\r?\n/);
		const marker = holeNow(lines, hole, findMarkers(lines.join('\n'))).marker;
		if (!marker) {
			throw new Error(`The marker of hole ${n} is not in ${hole.file} now, so the answer has no place.`);
		}
		const range = new vscode.Range(marker.start.line - 1, marker.start.col, marker.end.line - 1, marker.end.col);
		const text = answerText(hole.hints.answer, lines[marker.start.line - 1]);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, range, text);
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error(`VS Code did not put the answer into ${hole.file}.`);
		}
		const count = text.split('\n').length;
		this.lines.setOwner(hole.file, doc.getText().split(/\r?\n/), Array.from({ length: count }, (_v, i) => marker.start.line + i),
			{ writer: 'claude', step, change: `H${n}` });
		this.lines.flush();
		this.claudeLines.render();
		const at = new vscode.Position(marker.start.line - 1, marker.start.col);
		await vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(at, at) });
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
		})), { title: `Shotgun: Mark a Change of Step ${current.ref}`, placeHolder: 'Select the change' });
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

	// The gate of the current stage. In stage 5, the gate of the current step, or "The build is done"
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
			case 'review':
				return this.passReviewGate(task);
		}
	}

	// The gate of stage 6, "The task is done" (P16). It never waits: with no review or with open issues in the list of steps,
	// a modal message asks first, and the ledger keeps the issues as open
	private async passReviewGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const review = this.store.snapshot.review;
		const open = (review?.issues ?? []).filter((i) => i.list === 'steps' && i.state === 'open');
		const warning = !review || review.rounds.length === 0 ? 'Claude did not review the task.'
			: open.length > 0 ? `${open.length === 1 ? '1 issue' : `${open.length} issues`} of the list of steps ${open.length === 1 ? 'is' : 'are'} open.` : undefined;
		if (warning) {
			const pick = await vscode.window.showWarningMessage(`${warning} Do you want to pass the gate "${GATE_LABEL['task-done']}"?`, {
				modal: true,
				detail: open.length > 0 ? `${open.slice(0, 10).map((i) => `${i.id}: ${i.title}`).join('\n')}\n\nThe ledger keeps them as open.`
					: `Tell Claude "${STAGE_INFO.review.request}" for a review with your effort and focus.`,
			}, PASS_GATE);
			if (pick !== PASS_GATE) {
				return;
			}
		}
		this.store.passGate('task-done');
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['task-done']}"${open.length > 0 ? ` with ${open.length} open issues` : ''}.`);
	}

	// The gates of stage 5: the gate of the current step, and "The build is done" after the last step. The task then goes to
	// stage 6, the review
	private async passBuildGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const current = this.store.current;
		if (!current) {
			this.store.passGate('build-done');
			this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['build-done']}".`);
			return;
		}
		await this.passStepGate(task, current);
	}

	// The gate of the current step, from its own button: in stage 5, and in stage 6 for the step of an issue (P22)
	private async passCurrentStepGate(): Promise<void> {
		const task = this.store.snapshot.task;
		const current = this.store.current;
		if (!task || !isStepStage(task) || !current) {
			throw new Error('The active task has no current step.');
		}
		await this.passStepGate(task, current);
	}

	// The gate of the current step: "Accept the receipt" for a step of Claude, and "The step is done" for the user or a frame
	private async passStepGate(task: NonNullable<Snapshot['task']>, current: CurrentStep): Promise<void> {
		const root = this.store.snapshot.root!;
		const step = current.build;
		if (current.writer === 'frame') {
			if (current.state !== 'holes' || !step?.holes) {
				throw new Error(current.state === 'open' ? `Claude writes the frame of step ${current.ref}. Wait for its holes.`
					: `Claude writes the frame of step ${current.ref} first. Tell Claude "Give me a frame for step ${current.ref}."`);
			}
			const open = step.holes.filter((h) => {
				const lines = this.textOf(absolutePath(h.file, root))?.split(/\r?\n/) ?? [];
				return !isHoleDone(holeNow(lines, h, findMarkers(lines.join('\n'))).state);
			});
			if (open.length > 0) {
				throw new Error(`Fill the holes first: hole ${open.map((h) => h.n).join(', ')} ${open.length === 1 ? 'has' : 'have'} no code.`);
			}
		}
		if (current.writer === 'user' || current.writer === 'frame') {
			if (current.writer === 'user' && (current.state !== 'open' || !step)) {
				throw new Error(`Shotgun opens step ${current.ref} first. Try again in a moment.`);
			}
			await this.saveFiles(step!.scope.map((f) => absolutePath(f, root)));
			try {
				await this.recordUserLines(current, root);
			} catch (error) {
				this.log.warn(`Shotgun did not record the lines of step ${current.ref}: ${messageOf(error)}`);
			}
		} else {
			const receipt = step?.receipt;
			if (current.state !== 'receipt' || !receipt) {
				throw new Error(current.state === 'open' ? `Claude writes step ${current.ref}. Wait for its receipt.`
					: `Claude writes step ${current.ref}. Tell Claude "${buildNext(current, task.stage === 'review').request ?? `Do step ${current.ref}.`}" first.`);
			}
			const counts = receiptCounts(receipt);
			if (counts.issues > 0) {
				throw new Error(`${counts.issues === 1 ? '1 change has' : `${counts.issues} changes have`} an issue. Tell Claude "Fix the issues of step ${current.ref}.", `
					+ 'or change the mark.');
			}
			const notWalked = counts.changes - counts.walked;
			if (notWalked > 0 || counts.questions > 0) {
				const parts = [
					...(notWalked > 0 ? [`${notWalked === 1 ? '1 change has' : `${notWalked} changes have`} no mark`] : []),
					...(counts.questions > 0 ? [`${counts.questions === 1 ? '1 question is' : `${counts.questions} questions are`} open`] : []),
				];
				const pick = await vscode.window.showWarningMessage(`${parts.join(', and ')}. Do you want to accept the receipt of step ${current.ref}?`, {
					modal: true, detail: 'The ledger keeps each change with no mark as not walked. Claude answers a question only when you ask.',
				}, ACCEPT_RECEIPT);
				if (pick !== ACCEPT_RECEIPT) {
					return;
				}
			}
		}
		// the loose ends of the step need its base, so they come before the gate deletes the base
		await this.findLooseEnds(current, root);
		const base = step?.base;
		const api = this.baseApi();
		if (base && api) {
			await api.deleteMark(base).catch((error: unknown) => this.log.warn(`DataFlow did not delete the base ${base}: ${messageOf(error)}`));
		}
		this.store.finishStep(current.step.id, current.writer === 'claude' ? 'accept-receipt' : 'step-done');
		this.log.info(`Step ${current.ref} of the task ${task.id} is done.`);
		await this.openUserStep();
	}

	// "Hand to Claude": a mechanical loose end becomes the next step of the plan for Claude (decision 21). With no id, the
	// user selects a loose end that Claude can do
	private async handLooseEnd(idArg?: unknown): Promise<void> {
		let id = typeof idArg === 'string' ? idArg : undefined;
		if (id === undefined) {
			const open = (this.store.snapshot.loose?.ends ?? []).filter((e) => e.state === 'open' && e.kind === 'mechanical' && e.file && e.lines);
			if (open.length === 0) {
				void vscode.window.showInformationMessage('Shotgun: the task has no open mechanical loose end with a place.');
				return;
			}
			const pick = await vscode.window.showQuickPick(open.map((e) => ({ label: e.title, description: `${e.id} · ${e.kind}`, id: e.id })), {
				title: 'Shotgun: Hand a Loose End to Claude', placeHolder: 'Select the loose end',
			});
			id = pick?.id;
		}
		if (!id) {
			return;
		}
		const step = this.store.handLooseEnd(id);
		const n = (this.store.snapshot.plan?.steps ?? []).findIndex((s) => s.id === step.id) + 1;
		vscode.window.setStatusBarMessage(`Shotgun: the loose end is step ${n} for Claude. Tell Claude "Do the loose ends."`, 8000);
	}

	// "Close": the reason of the user goes into the ledger
	private async closeLooseEnd(idArg?: unknown): Promise<void> {
		const ends = (this.store.snapshot.loose?.ends ?? []).filter((e) => e.state === 'open');
		let id = typeof idArg === 'string' ? idArg : undefined;
		if (id === undefined) {
			if (ends.length === 0) {
				void vscode.window.showInformationMessage('Shotgun: the task has no open loose end.');
				return;
			}
			const pick = await vscode.window.showQuickPick(ends.map((e) => ({ label: e.title, description: `${e.id} · ${e.kind}`, id: e.id })), {
				title: 'Shotgun: Close a Loose End', placeHolder: 'Select the loose end',
			});
			id = pick?.id;
		}
		const end = this.store.snapshot.loose?.ends.find((e) => e.id === id);
		if (!id || !end) {
			return;
		}
		const reason = await vscode.window.showInputBox({
			title: `Shotgun: Close the Loose End: ${end.title}`,
			prompt: 'Why does the loose end need no step? The ledger keeps your reason.',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Give your reason.'),
		});
		if (reason !== undefined) {
			this.store.closeLooseEnd(id, reason);
		}
	}

	// The decisions and the lines of each writer as Markdown for a pull request, in the clipboard
	private async copyLedger(): Promise<void> {
		const markdown = this.lastModel?.task?.ledger?.markdown;
		if (!markdown) {
			throw new Error('The ledger is only for a task in the stages 5 and 6.');
		}
		await vscode.env.clipboard.writeText(markdown);
		vscode.window.setStatusBarMessage('Shotgun: the ledger is in the clipboard as Markdown. Paste it into the pull request.', 6000);
	}

	// The commit message in the input box of Source Control. The Git extension has no event for a change of the text, so
	// Shotgun reads it again each COMMIT_POLL_MS while a task is in stage 5
	private commitText(): { readonly text: string } | undefined {
		const root = this.store.snapshot.root;
		const message = root ? commitMessage(root) : undefined;
		return message ? { text: message.message } : undefined;
	}

	private watchCommitMessage(): vscode.Disposable {
		let last: string | undefined;
		const timer = setInterval(() => {
			if (this.store.snapshot.task?.stage !== 'build' && this.store.snapshot.task?.stage !== 'review') {
				return;
			}
			const text = this.commitText()?.text;
			if (text !== last) {
				last = text;
				this.update();
			}
		}, COMMIT_POLL_MS);
		return new vscode.Disposable(() => clearInterval(timer));
	}

	// The loose ends of a step at its gate (phase 9): the loose ends of Claude in the receipt, and the loose ends of the
	// facts of DataFlow since the base of the step. A failure of DataFlow does not stop the gate
	private async findLooseEnds(current: CurrentStep, root: string): Promise<void> {
		const step = current.build;
		if (!step || this.store.snapshot.loose?.checked.includes(current.step.id)) {
			return;
		}
		const finds: LooseFind[] = claudeEnds(step.receipt?.looseEnds ?? []);
		const api = this.api;
		const baseApi = this.baseApi();
		if (api && baseApi && step.base) {
			const base = step.base;
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Shotgun: the loose ends of step ${current.ref}` }, async () => {
				try {
					const diff = await baseApi.diff(`mark:${base}`, step.scope.map((f) => absolutePath(f, root)));
					const looseApi: LooseApi = {
						// the engine parses only the changed files, so the scan is short
						scan: async () => {
							let graph = await api.scanCallGraph();
							for (const end = Date.now() + SCAN_WAIT_MS; graph.state === 'scanning' && Date.now() < end;) {
								await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
								graph = await api.getCallGraph();
							}
							return graph.state === 'ready';
						},
						outline: (file, line) => api.getOutline({ file, line }),
						memberSites: (file, line) => api.getMemberSites({ file, line }),
						ripple: (b, paths) => api.getRipple({ base: b, paths: [...paths] }),
					};
					finds.push(...await findLooseEnds(looseApi, root, base, step.scope, diff, (f) => this.textOf(f)?.split(/\r?\n/), (m) => this.log.info(m)));
				} catch (error) {
					this.log.warn(`Shotgun did not find the loose ends of step ${current.ref}: ${messageOf(error)}`);
				}
			});
		}
		this.store.addLooseEnds(current.step.id, finds);
		const count = finds.length;
		this.log.info(`Step ${current.ref} has ${count} new ${count === 1 ? 'loose end' : 'loose ends'}.`);
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

	// The gate of stage 4, "Accept the plan". Each step needs a level: the level of the rules, or a level of the user. An open
	// decision in a step of Claude is a decision of Claude in its errand, so a modal message names these decisions first (P31)
	private async passPlanGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const { plan, risk, levels } = this.store.snapshot;
		if (!plan) {
			throw new Error('The active task has no plan. Ask Claude for the plan first, for example with "Make the plan."');
		}
		const waiting = plan.steps.filter((s) => levelOf(s, risk, levels).level === null).map((s) => s.id);
		if (waiting.length > 0) {
			throw new Error(`The steps ${waiting.join(', ')} have no level yet. Wait for the end of the scan of the call graph, or set their levels.`);
		}
		const ofClaude = plan.steps.flatMap((s, i) => (writerOf(levelOf(s, risk, levels).level) === 'claude'
			? openDecisions(s, levels).map((d) => `Step ${i + 1}, ${s.title}: ${d.question}`) : []));
		if (ofClaude.length > 0) {
			const count = ofClaude.length === 1 ? '1 open decision is' : `${ofClaude.length} open decisions are`;
			const pick = await vscode.window.showWarningMessage(
				`${count} in steps of Claude. Claude decides ${ofClaude.length === 1 ? 'it' : 'them'} in its errands. Do you want to pass the gate "${GATE_LABEL['accept-plan']}"?`,
				{ modal: true, detail: `${ofClaude.join('\n')}\n\nYou can answer a decision on the plan page first, or raise the level of its step. The receipt shows each choice of Claude.` },
				PASS_GATE);
			if (pick !== PASS_GATE) {
				return;
			}
		}
		// the base of the task for the review of stage 6 (P17). Only the first gate records it
		let base: { commit?: string; dirty: readonly string[]; error?: string } | undefined;
		if (!this.store.snapshot.review?.base) {
			const head = headOf(this.store.snapshot.root!);
			base = head?.commit ? { commit: head.commit, dirty: head.dirty }
				: { dirty: head?.dirty ?? [], error: head ? 'The repository has no commit yet.' : 'The folder has no repository of git, or the Git extension of VS Code is off.' };
			if (base.dirty.length > 0) {
				const shown = base.dirty.slice(0, 10).join('\n') + (base.dirty.length > 10 ? `\n${base.dirty.length - 10} more` : '');
				const pick = await vscode.window.showWarningMessage(
					`${base.dirty.length === 1 ? '1 file has changes' : `${base.dirty.length} files have changes`} that are not committed. Do you want to pass the gate "${GATE_LABEL['accept-plan']}"?`,
					{ modal: true, detail: `${shown}\n\nThe review of stage 6 starts from the commit of HEAD, so it also reviews these changes, and it marks them. Commit them first for a review of the task alone.` },
					PASS_GATE);
				if (pick !== PASS_GATE) {
					return;
				}
			}
			if (base.error) {
				this.log.warn(`The task ${task.id} has no base commit for the review of stage 6: ${base.error}`);
			}
		}
		this.store.acceptPlan(base);
		this.log.info(`The task ${task.id} passed the gate "${GATE_LABEL['accept-plan']}" with ${plan.steps.length} steps`
			+ `${base?.commit ? `, from the commit ${base.commit.slice(0, 7)}` : ''}.`);
	}

	// The gate of stage 1, "The brief is ready". Each part of the brief and each question of Claude is optional, so the
	// gate never waits (decision 22). The open questions stay in the ledger
	private async passBriefGate(task: NonNullable<Snapshot['task']>): Promise<void> {
		const file = this.store.briefFile(task.id)!;
		// the survey uses the text on the disk, so the text editor saves it first
		const doc = this.documentOf(file);
		if (doc?.isDirty) {
			await doc.save();
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
				case 'showPlace':
					await this.showPlace(message.path, message.lines, message.note);
					break;
				case 'returnToStage':
					await this.returnToStage(message.stage);
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
					await this.changeLevel(message.step, message.level === null ? undefined : message.level as Level);
					break;
				case 'setLevelNote':
					this.store.setLevelNote(message.step, message.note);
					break;
				case 'answerDecision':
					await this.changeDecision(() => this.store.answerDecision(message.step, message.decision, message.text));
					break;
				case 'addDecision':
					await this.changeDecision(() => this.store.addDecision(message.step, message.question));
					break;
				case 'removeDecision':
					await this.changeDecision(() => this.store.removeDecision(message.step, message.decision));
					break;
				case 'checkLevels':
					await this.checkRisk(true);
					break;
				case 'setMark':
					this.store.setMark(message.step, message.change, message.mark);
					break;
				case 'requestFrame':
					await this.requestFrame(message.step);
					break;
				case 'setVoice':
					await this.setVoice(message.voice);
					break;
				case 'setSteOutput':
					await vscode.workspace.getConfiguration('shotgun').update('steOutput', message.isOn, vscode.ConfigurationTarget.Global);
					break;
				case 'closeCallout':
					await this.closeCallout(message.step, message.id);
					break;
				case 'reopenCallout':
					this.store.closeCallout(message.step, message.id, undefined);
					break;
				case 'showInDataFlow':
					await this.showInDataFlow(message.path, message.line, message.source);
					break;
				case 'resolveAnswer':
					this.store.resolveAnswer(message.id);
					break;
				case 'showHint':
					await this.showHint(message.step, message.hole, message.level);
					break;
				case 'setChangeNote':
					this.store.setChangeNote(message.step, message.change, message.note);
					vscode.window.setStatusBarMessage(`Shotgun: the note for ${message.change} is saved.`, 3000);
					break;
				case 'handLooseEnd':
					await this.handLooseEnd(message.id);
					break;
				case 'closeLooseEnd':
					await this.closeLooseEnd(message.id);
					break;
				case 'reopenLooseEnd':
					this.store.closeLooseEnd(message.id, undefined);
					break;
				case 'showLedger':
					this.views.showLedger();
					break;
				case 'copyLedger':
					await this.copyLedger();
					break;
				case 'setReviewOptions':
					this.store.setReviewOptions({ effort: message.effort as Effort, areas: message.areas as Area[], text: message.text });
					break;
				case 'copyReviewPrompt':
					await this.copyReviewPrompt();
					break;
				case 'closeIssue':
					await this.closeIssue(message.id);
					break;
				case 'reopenIssue':
					this.store.setIssueClosed(message.id, undefined);
					break;
				case 'setIssueStep':
					await this.setIssueStep(message.id, message.isStep);
					break;
				case 'stepGate':
					await this.passCurrentStepGate();
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
			// Shotgun writes lines.json after the edits of the user, and callouts.json at a pause. It reloads them itself
			if (path.basename(uri.fsPath) === LINES_FILE || path.basename(uri.fsPath) === CALLOUTS_FILE) {
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
		this.trackStepFiles();
		const snapshot = this.store.snapshot;
		const claude: ClaudeState = this.claude.state(snapshot.root);
		const file = this.store.briefFile();
		const doc = file ? this.documentOf(file) : undefined;
		const text = doc?.getText() ?? (file ? readText(file) : undefined);
		const commit = snapshot.task?.stage === 'build' || snapshot.task?.stage === 'review' ? this.commitText() : undefined;
		this.lastModel = buildModel({
			version: String(this.context.extension.packageJSON.version),
			snapshot,
			dataflow: this.dataflow,
			claude,
			...(file && text !== undefined ? { brief: { file, text, isDirty: !!doc?.isDirty } } : {}),
			readLines: (f) => this.textOf(f)?.split(/\r?\n/),
			voice: this.voice(),
			pauseSeconds: this.pauseSeconds(),
			isSteOutput: this.isSteOutput(),
			ledgerLines: this.lines.paths.map((f) => ({ file: f, runs: this.lines.runs(f) })),
			...(commit ? { commit } : {}),
		});
		this.views.update(this.lastModel);
		this.rememberProject(snapshot.root, snapshot.tasks.length > 0);
		this.home.update(this.homeState(snapshot, claude));
		this.hooks.update(snapshot);
		this.steps.update(snapshot);
		this.claudeLines.update(snapshot, this.lines);
		this.frameHoles.update(snapshot, this.lines);
		this.calloutMarks.update(snapshot);
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
		const current = isStepStage(task) ? this.store.current : undefined;
		void vscode.commands.executeCommand('setContext', 'shotgun.hasReceipt', current?.state === 'receipt');
		void vscode.commands.executeCommand('setContext', 'shotgun.hasHoles', current?.state === 'holes');
		const stepCallouts = current ? snapshot.callouts?.steps[current.step.id]?.callouts ?? [] : [];
		void vscode.commands.executeCommand('setContext', 'shotgun.hasCallouts', stepCallouts.some((c) => c.shown && !c.closed && !c.isGone));
		void vscode.commands.executeCommand('setContext', 'shotgun.hasAnswers', (snapshot.callouts?.answers ?? []).some((a) => !a.resolved));
		void vscode.commands.executeCommand('setContext', 'shotgun.hasLooseEnds', isStepStage(task) && (snapshot.loose?.ends ?? []).some((e) => e.state === 'open'));
		void vscode.commands.executeCommand('setContext', 'shotgun.hasLedger', !!task && (task.stage === 'build' || task.stage === 'review'));
		void this.ensureCalloutStart();
		// decision 17: in the stages 5 and 6, the user changes the level of a step that Claude did not start
		void vscode.commands.executeCommand('setContext', 'shotgun.canSetLevel', !!task && !task.isDone && !!snapshot.plan
			&& (task.stage === 'plan' || task.stage === 'build' || (task.stage === 'review' && issueSteps(snapshot.review).length > 0)));
		void vscode.commands.executeCommand('setContext', 'shotgun.canRequestFrame', current?.writer === 'user' && current.level === 4
			&& (current.state === 'todo' || current.state === 'open'));
		void this.openUserStep();
	}
}
