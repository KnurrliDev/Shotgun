import * as vscode from 'vscode';
import { isSamePath } from '../claude/settings';
import { buildWriterOf, stateOf } from '../session/build';
import { absolutePath } from '../session/paths';
import { levelOf, PlanStep } from '../session/plan';
import { currentFixPlan, reviewPhase } from '../session/review';
import { Level, LEVEL_INFO } from '../session/risk';
import type { Snapshot } from '../session/store';
import { findHook, Lines } from '../session/survey';

// The steps of the plan in the text editor, in the stages 4 and 5 (section 6.7 of the plan), and the steps of the plan of
// the fixes in stage 6 (decision 43). Each place of a step gets a line at the left side with the color of its level. It
// also gets a CodeLens line, for example "Step 4 of 8 · risk 4 of 5, high · you write". A click on the CodeLens line opens
// the step on the page. A place follows its code.

// The colors of the risk levels of the design canvas. Index 0: a step with no level yet
const COLORS = ['#7f8794', '#8a97a8', '#a3adba', '#d9a36a', '#f0835a', '#ff5c6c'];

const WRITER_TEXT = { claude: 'Claude writes', frame: 'frame of Claude, you write each decision', user: 'you write' } as const;
// The state of a step in stage 5, and of a step of the fixes in stage 6
const STATE_TEXT = { todo: 'to do', open: 'open', receipt: 'receipt to walk', holes: 'holes to fill', done: 'done' } as const;

export interface StepPlace {
	readonly step: PlanStep;
	readonly n: number; // the place of the step in the plan, from 1
	readonly total: number;
	readonly ref: string; // the step in a text: its number, or the id of a step of the fixes, for example F2
	readonly level: Level | null;
	readonly lines: Lines; // the lines now
}

export class StepDecorations implements vscode.Disposable {
	private readonly types = COLORS.map((color) => vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 3px',
		borderStyle: 'solid',
		borderColor: color,
		overviewRulerColor: color,
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	}));
	private readonly lensChanges = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [];
	private snapshot: Snapshot | undefined;
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(
			...this.types,
			this.lensChanges,
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
			// a change of a file with a step can move the places. The check of the path is fast, so it runs for each change
			vscode.workspace.onDidChangeTextDocument((e) => this.stepsIn(e.document).length > 0 && this.renderSoon()),
			vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
				onDidChangeCodeLenses: this.lensChanges.event,
				provideCodeLenses: (doc) => this.lenses(doc),
			}),
			new vscode.Disposable(() => clearTimeout(this.timer)),
		);
	}

	update(snapshot: Snapshot): void {
		this.snapshot = snapshot;
		this.render();
		this.lensChanges.fire();
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}

	// The places of the steps in a document, at their lines now. The text editor shows the steps of the plan in the stages 4
	// and 5, and the steps of the plan of the fixes of the round in stage 6
	placesOf(doc: vscode.TextDocument): StepPlace[] {
		const steps = this.stepsIn(doc);
		if (steps.length === 0) {
			return [];
		}
		const s = this.snapshot!;
		const root = s.root!;
		const total = this.steps().length;
		const text = doc.getText().split(/\r?\n/);
		return steps.flatMap(({ step, n }) => step.places
			.filter((p) => p.lines && isSamePath(absolutePath(p.file, root), doc.uri.fsPath))
			.flatMap((p) => {
				const lines = p.code ? findHook(text, { lines: p.lines!, code: p.code, codeLine: p.codeLine }) : p.lines;
				return lines ? [{ step, n, total, ref: step.fixes ? step.id : String(n), level: levelOf(step, s.risk, s.levels).level, lines }] : [];
			}));
	}

	// The steps that the text editor shows: the plan in the stages 4 and 5, and the plan of the fixes of the round in stage 6
	private steps(): readonly PlanStep[] {
		const s = this.snapshot;
		if (!s?.task || !s.plan || !s.root || s.task.isDone) {
			return [];
		}
		if (s.task.stage === 'review') {
			const { phase } = reviewPhase(s.review);
			return phase === 'plan' || phase === 'fixes' ? currentFixPlan(s.review)?.steps ?? [] : [];
		}
		return s.task.stage === 'plan' || s.task.stage === 'build' ? s.plan.steps : [];
	}

	// The steps with a place in the file of a document
	private stepsIn(doc: vscode.TextDocument): { step: PlanStep; n: number }[] {
		const root = this.snapshot?.root;
		if (!root || doc.uri.scheme !== 'file') {
			return [];
		}
		return this.steps().map((step, i) => ({ step, n: i + 1 }))
			.filter(({ step }) => step.places.some((p) => p.lines && isSamePath(absolutePath(p.file, root), doc.uri.fsPath)));
	}

	private renderSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.render();
			this.lensChanges.fire();
		}, 200);
	}

	private render(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const places = this.placesOf(editor.document);
			this.types.forEach((type, level) => editor.setDecorations(type, places.filter((p) => (p.level ?? 0) === level)
				.map((p) => new vscode.Range(p.lines[0] - 1, 0, p.lines[1] - 1, 0))));
		}
	}

	private lenses(doc: vscode.TextDocument): vscode.CodeLens[] {
		const s = this.snapshot;
		// the steps of the build in stage 5, and the steps of the fixes after the gate "Accept the fix plan"
		const isBuild = s?.task?.stage === 'build' || (s?.task?.stage === 'review' && reviewPhase(s.review).phase === 'fixes');
		return this.placesOf(doc).map((p) => {
			// the writer that the user selected comes before the writer of the level (decision 44)
			const chosen = s?.levels?.levels[p.step.id]?.writer;
			const writer = !p.level ? '' : WRITER_TEXT[(isBuild ? s?.build?.steps[p.step.id]?.writer : undefined) ?? buildWriterOf(p.level, chosen)];
			const state = isBuild ? ` · ${STATE_TEXT[stateOf(s?.build, p.step.id)]}` : '';
			const level = p.level ? `risk ${p.level} of 5, ${LEVEL_INFO[p.level].name.toLowerCase()} · ${writer}${state}` : 'no level yet';
			const range = new vscode.Range(p.lines[0] - 1, 0, p.lines[0] - 1, 0);
			return new vscode.CodeLens(range, {
				title: `${p.step.fixes ? `Step ${p.ref}` : `Step ${p.n} of ${p.total}`} · ${p.step.title} · ${level}`,
				tooltip: 'Show the step on the page of Shotgun',
				command: 'shotgun.showStep',
				arguments: [p.step.id],
			});
		});
	}
}
