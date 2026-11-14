import * as vscode from 'vscode';
import { isSamePath } from '../claude/settings';
import { findMarkers, Hole, holeNow, HoleNow, Marker } from '../session/frame';
import type { LineStore } from '../session/lines';
import { absolutePath, isInside, projectPath } from '../session/paths';
import type { Snapshot } from '../session/store';

// The holes of a frame of Claude in the text editor, in stage 5 (section 6.7 of the plan). An open hole gets a dashed
// box with the color of the user, and a hover with its question, the hints that the user opened, and a link to the next
// hint. A filled hole gets a line at the left side: the color of the user, or the color of Claude for the answer of
// Claude. Tab and Shift+Tab go to the next open hole and to the hole before it, while the cursor is in the frame.

// [dark theme, light theme]
const YOU = ['#f2b544', '#9a6700'] as const;
const CLAUDE = ['#f07fc9', '#b0297e'] as const;

const HINT_NAMES = ['the nudge', 'the pointer', 'the example', 'the answer'];

// The hole of the current frame in a document, with its state now
export interface DocumentHole {
	readonly step: string;
	readonly hole: Hole;
	readonly now: HoleNow;
}

export class HoleDecorations implements vscode.Disposable {
	private readonly open = vscode.window.createTextEditorDecorationType({
		dark: { border: `1px dashed ${YOU[0]}`, backgroundColor: 'rgba(242, 181, 68, 0.10)' },
		light: { border: `1px dashed ${YOU[1]}`, backgroundColor: 'rgba(154, 103, 0, 0.08)' },
		borderRadius: '3px',
		overviewRulerColor: YOU[0],
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});
	private readonly byUser = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 2px',
		borderStyle: 'solid',
		dark: { borderColor: YOU[0] },
		light: { borderColor: YOU[1] },
	});
	private readonly byClaude = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 2px',
		borderStyle: 'solid',
		dark: { borderColor: CLAUDE[0] },
		light: { borderColor: CLAUDE[1] },
	});
	private readonly disposables: vscode.Disposable[] = [];
	private snapshot: Snapshot | undefined;
	private lines: LineStore | undefined;
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(
			this.open, this.byUser, this.byClaude,
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
			vscode.workspace.onDidChangeTextDocument((e) => this.isFrameFile(e.document) && this.renderSoon()),
			vscode.window.onDidChangeTextEditorSelection(() => this.updateContext()),
			vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
			vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (doc, position) => this.hover(doc, position) }),
			new vscode.Disposable(() => clearTimeout(this.timer)),
		);
	}

	update(snapshot: Snapshot, lines: LineStore): void {
		this.snapshot = snapshot;
		this.lines = lines;
		this.render();
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}

	// The current step with a frame to fill, or undefined
	private frame(): { step: string; holes: readonly Hole[]; root: string } | undefined {
		const s = this.snapshot;
		if (!s?.task || !s.root || s.task.isDone || s.task.stage !== 'build' || !s.plan || !s.build) {
			return undefined;
		}
		const step = s.plan.steps.find((p) => s.build?.steps[p.id]?.state !== 'done');
		const b = step ? s.build.steps[step.id] : undefined;
		return step && b?.state === 'holes' && b.holes ? { step: step.id, holes: b.holes, root: s.root } : undefined;
	}

	private isFrameFile(doc: vscode.TextDocument): boolean {
		const f = this.frame();
		return !!f && doc.uri.scheme === 'file' && f.holes.some((h) => isSamePath(absolutePath(h.file, f.root), doc.uri.fsPath));
	}

	// The holes of the current frame in a document, with their state now
	holesIn(doc: vscode.TextDocument): DocumentHole[] {
		const f = this.frame();
		if (!f || doc.uri.scheme !== 'file') {
			return [];
		}
		const holes = f.holes.filter((h) => isSamePath(absolutePath(h.file, f.root), doc.uri.fsPath));
		if (holes.length === 0) {
			return [];
		}
		const lines = doc.getText().split(/\r?\n/);
		const markers = findMarkers(lines.join('\n'));
		return holes.map((hole) => ({ step: f.step, hole, now: holeNow(lines, hole, markers) }));
	}

	// The open hole after the cursor, or before it with direction -1. After the last hole comes the first hole again
	nextHole(editor: vscode.TextEditor, direction: 1 | -1): Marker | undefined {
		const open = this.holesIn(editor.document).map((h) => h.now.marker).filter((m): m is Marker => !!m)
			.sort((a, b) => a.start.line - b.start.line || a.start.col - b.start.col);
		if (open.length === 0) {
			return undefined;
		}
		const at = editor.selection.active;
		const key = (m: Marker) => (m.start.line - 1) * 100000 + m.start.col;
		const cursor = at.line * 100000 + at.character;
		// a selected marker counts as the cursor at its start
		if (direction === 1) {
			return open.find((m) => key(m) > cursor) ?? open[0];
		}
		return [...open].reverse().find((m) => key(m) < cursor - (editor.selection.isEmpty ? 0 : 1)) ?? open[open.length - 1];
	}

	// True if the cursor is in the frame of the active text editor and the frame has an open hole there
	isInFrame(editor: vscode.TextEditor | undefined): boolean {
		if (!editor) {
			return false;
		}
		const holes = this.holesIn(editor.document);
		if (!holes.some((h) => h.now.state === 'open')) {
			return false;
		}
		const root = this.snapshot!.root!;
		const file = isInside(editor.document.uri.fsPath, root) ? projectPath(editor.document.uri.fsPath, root) : '';
		const runs = (this.lines?.runs(file) ?? []).filter((r) => r.step === holes[0].step);
		const first = Math.min(...holes.map((h) => h.now.line), ...runs.map((r) => r.lines[0]));
		const last = Math.max(...holes.map((h) => h.now.lastLine), ...runs.map((r) => r.lines[1]));
		const line = editor.selection.active.line + 1;
		return line >= first - 1 && line <= last + 1;
	}

	private updateContext(): void {
		void vscode.commands.executeCommand('setContext', 'shotgun.inFrame', this.isInFrame(vscode.window.activeTextEditor));
	}

	private renderSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.render(), 150);
	}

	private render(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const holes = this.holesIn(editor.document);
			const open: vscode.DecorationOptions[] = [];
			const byUser: vscode.Range[] = [];
			const byClaude: vscode.Range[] = [];
			for (const { hole, now } of holes) {
				if (now.marker) {
					const m = now.marker;
					open.push({ range: new vscode.Range(m.start.line - 1, m.start.col, m.end.line - 1, m.end.col) });
				} else if (now.state === 'done') {
					const range = new vscode.Range(now.line - 1, 0, Math.max(now.line, now.lastLine) - 1, 0);
					(hole.shown >= 4 ? byClaude : byUser).push(range);
				}
			}
			editor.setDecorations(this.open, open);
			editor.setDecorations(this.byUser, byUser);
			editor.setDecorations(this.byClaude, byClaude);
		}
		this.updateContext();
	}

	// The question of an open hole, the hints that the user opened, and a link to the next hint
	private hover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const found = this.holesIn(doc).find(({ now }) => {
			const m = now.marker;
			return m && new vscode.Range(m.start.line - 1, m.start.col, m.end.line - 1, m.end.col).contains(position);
		});
		if (!found) {
			return undefined;
		}
		const { step, hole } = found;
		const text = new vscode.MarkdownString(undefined, true);
		text.isTrusted = { enabledCommands: ['shotgun.nextHint'] };
		text.appendMarkdown(`**Shotgun: hole ${hole.n}.** `);
		text.appendText(hole.question);
		const hints = [hole.hints.nudge, `${hole.hints.pointer.text} ${hole.hints.pointer.places.map((p) => `${p.file}:${p.lines[0]}-${p.lines[1]}`).join(', ')}`,
			`${hole.hints.example.text} ${hole.hints.example.file}:${hole.hints.example.lines[0]}`];
		hints.slice(0, Math.min(hole.shown, 3)).forEach((h, i) => {
			text.appendMarkdown(`\n\n*Hint ${i + 1}, model:* `);
			text.appendText(h);
		});
		if (hole.shown >= 3) {
			text.appendCodeblock(hole.hints.example.code, doc.languageId);
		}
		if (hole.shown < 4) {
			const args = encodeURIComponent(JSON.stringify([step, hole.n]));
			text.appendMarkdown(`\n\n[Show ${HINT_NAMES[hole.shown]}](command:shotgun.nextHint?${args})`);
			text.appendMarkdown(hole.shown === 3 ? ' (it fills the hole with the answer of Claude)' : ' (the hints came with the frame: no request to Claude)');
		}
		return new vscode.Hover(text);
	}
}
