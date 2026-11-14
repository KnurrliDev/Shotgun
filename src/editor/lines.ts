import * as vscode from 'vscode';
import type { ChangeMark } from '../session/build';
import type { LineRun, LineStore } from '../session/lines';
import { isInside, projectPath } from '../session/paths';
import type { Snapshot } from '../session/store';

// The lines of Claude in the text editor, in stage 5 (section 6.7 of the plan and the board of the receipts of the
// design canvas). Each line of Claude gets a mark in the gutter: dashed until the user walks its change, then solid with
// the color of the mark of the user. The first line of each run gets a short tag, for example "Claude · not walked".

const TAGS: Readonly<Record<ChangeMark, string>> = {
	todo: 'Claude · not walked',
	ok: 'Claude · walked',
	issue: 'Claude · issue',
	question: 'Claude · question',
};

// [dark theme, light theme]
const COLORS: Readonly<Record<ChangeMark, readonly [string, string]>> = {
	todo: ['#f07fc9', '#b0297e'],
	ok: ['#f07fc9', '#b0297e'],
	issue: ['#ff5c6c', '#c0182c'],
	question: ['#d7b600', '#8a6d00'],
};

const MARK_WORDS: Readonly<Record<ChangeMark, string>> = { todo: 'not walked', ok: 'OK', issue: 'issue', question: 'question' };

// A narrow bar for the gutter: solid, or dashed for a change that the user did not walk
function bar(color: string, isDashed: boolean): vscode.Uri {
	const rects = isDashed ? '<rect x="1" y="1" width="3" height="6"/><rect x="1" y="10" width="3" height="6"/>' : '<rect x="1" y="0" width="3" height="18"/>';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="5" height="18" viewBox="0 0 5 18" fill="${color}">${rects}</svg>`;
	return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export class ClaudeLines implements vscode.Disposable {
	private readonly types = Object.fromEntries((Object.keys(TAGS) as ChangeMark[]).map((mark) => {
		const [dark, light] = COLORS[mark];
		const isDashed = mark === 'todo';
		return [mark, vscode.window.createTextEditorDecorationType({
			dark: { gutterIconPath: bar(dark, isDashed), after: { color: dark } },
			light: { gutterIconPath: bar(light, isDashed), after: { color: light } },
			gutterIconSize: 'contain',
			overviewRulerColor: dark,
			overviewRulerLane: vscode.OverviewRulerLane.Right,
			after: { margin: '0 0 0 2em', fontStyle: 'italic' },
		})];
	})) as Record<ChangeMark, vscode.TextEditorDecorationType>;
	private readonly disposables: vscode.Disposable[] = [];
	private snapshot: Snapshot | undefined;
	private lines: LineStore | undefined;
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(
			...Object.values(this.types),
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
			new vscode.Disposable(() => clearTimeout(this.timer)),
		);
	}

	update(snapshot: Snapshot, lines: LineStore): void {
		this.snapshot = snapshot;
		this.lines = lines;
		this.render();
	}

	// A render a short time after the last change of the lines
	renderSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.render(), 100);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}

	render(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const ranges = this.optionsOf(editor.document);
			(Object.keys(this.types) as ChangeMark[]).forEach((mark) => editor.setDecorations(this.types[mark], ranges[mark]));
		}
	}

	// The lines of Claude in a document, by the mark of their change. The text editor shows them only in stage 5
	private optionsOf(doc: vscode.TextDocument): Record<ChangeMark, vscode.DecorationOptions[]> {
		const out: Record<ChangeMark, vscode.DecorationOptions[]> = { todo: [], ok: [], issue: [], question: [] };
		const s = this.snapshot;
		const root = s?.root;
		if (!s?.task || !root || !this.lines || s.task.isDone || s.task.stage !== 'build' || doc.uri.scheme !== 'file' || !isInside(doc.uri.fsPath, root)) {
			return out;
		}
		const runs = this.lines.runs(projectPath(doc.uri.fsPath, root)).filter((r) => r.writer === 'claude');
		const steps = s.plan?.steps ?? [];
		for (const run of runs) {
			const change = s.build?.steps[run.step]?.receipt?.changes.find((c) => c.id === run.change);
			const mark = change?.mark ?? 'todo';
			const first = Math.min(run.lines[0], doc.lineCount) - 1;
			const last = Math.min(run.lines[1], doc.lineCount) - 1;
			const n = steps.findIndex((p) => p.id === run.step) + 1;
			const hover = new vscode.MarkdownString(hoverText(run, n, change?.title, mark));
			for (let line = first; line <= last; line++) {
				// the range goes to the end of the line, so the tag comes after the code
				out[mark].push({
					range: doc.lineAt(line).range,
					hoverMessage: hover,
					...(line === first ? { renderOptions: { after: { contentText: TAGS[mark] } } } : {}),
				});
			}
		}
		return out;
	}
}

function hoverText(run: LineRun, n: number, title: string | undefined, mark: ChangeMark): string {
	const count = run.lines[1] - run.lines[0] + 1;
	const step = n > 0 ? `step ${n}` : `step ${run.step}`;
	return `**Shotgun:** Claude wrote ${count === 1 ? 'this line' : `these ${count} lines`} in ${step}`
		+ `${run.change ? `, change ${run.change}${title ? `: ${title}` : ''}` : ''}. Your mark: ${MARK_WORDS[mark]}.`;
}
