import * as vscode from 'vscode';
import { isSamePath } from '../claude/settings';
import type { Callout, CalloutKind, LineAnswer } from '../session/callouts';
import { hashLine } from '../session/lines';
import { absolutePath } from '../session/paths';
import type { Snapshot } from '../session/store';

// The callouts and the answers on lines in the text editor, in stage 5 (section 6.7 of the plan and the board of the
// callouts of the design canvas). An open callout gets a short tag after its line, for example "PROBLEM · ...", and a
// hover with the facts of the engine, the words of Claude, and 2 links: "Show in DataFlow" and "Not a problem". An answer
// of Claude to a question of the user gets a tag after its line, and a hover with the question, the facts and the answer.

type Tag = CalloutKind | 'answer';

// [dark theme, light theme]
const COLORS: Readonly<Record<Tag, readonly [string, string]>> = {
	problem: ['#ff5c6c', '#c0182c'],
	warning: ['#f0835a', '#b8410e'],
	info: ['#f07fc9', '#b0297e'],
	answer: ['#f07fc9', '#b0297e'],
};
const LABELS: Readonly<Record<CalloutKind, string>> = { problem: 'PROBLEM', warning: 'WARNING', info: 'INFO' };
// The lines that the search for a moved line examines above and below its old line
const WINDOW = 200;

// The line of a callout now: the line with the text of the key of the callout, the nearest to the line of the last check
function calloutLine(lines: readonly string[], c: Callout): number | undefined {
	const hash = c.key.slice(c.key.lastIndexOf('|') + 1);
	return nearest(lines, c.line, (text) => hashLine(text) === hash);
}

function answerLine(lines: readonly string[], a: LineAnswer): number | undefined {
	return nearest(lines, a.line, (text) => text.trim() === a.code);
}

function nearest(lines: readonly string[], line: number, isIt: (text: string) => boolean): number | undefined {
	for (let d = 0; d <= WINDOW; d++) {
		for (const l of d === 0 ? [line] : [line - d, line + d]) {
			if (l >= 1 && l <= lines.length && isIt(lines[l - 1])) {
				return l;
			}
		}
	}
	return undefined;
}

export class CalloutDecorations implements vscode.Disposable {
	private readonly types = Object.fromEntries((Object.keys(COLORS) as Tag[]).map((tag) => {
		const [dark, light] = COLORS[tag];
		return [tag, vscode.window.createTextEditorDecorationType({
			dark: { after: { color: dark }, ...(tag === 'problem' ? { backgroundColor: 'rgba(255, 92, 108, 0.10)' } : {}) },
			light: { after: { color: light }, ...(tag === 'problem' ? { backgroundColor: 'rgba(192, 24, 44, 0.08)' } : {}) },
			isWholeLine: tag === 'problem',
			overviewRulerColor: dark,
			overviewRulerLane: vscode.OverviewRulerLane.Right,
			after: { margin: '0 0 0 2em', fontStyle: 'italic' },
		})];
	})) as Record<Tag, vscode.TextEditorDecorationType>;
	private readonly disposables: vscode.Disposable[] = [];
	private snapshot: Snapshot | undefined;
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(
			...Object.values(this.types),
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
			vscode.workspace.onDidChangeTextDocument(() => this.renderSoon()),
			new vscode.Disposable(() => clearTimeout(this.timer)),
		);
	}

	update(snapshot: Snapshot): void {
		this.snapshot = snapshot;
		this.render();
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
	}

	private renderSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.render(), 200);
	}

	// The open callouts of the current step, and the answers that the user did not resolve
	private items(): { step: string; callouts: readonly Callout[]; answers: readonly LineAnswer[]; root: string } | undefined {
		const s = this.snapshot;
		if (!s?.task || !s.root || s.task.isDone || s.task.stage !== 'build') {
			return undefined;
		}
		const step = (s.plan?.steps ?? []).find((p) => s.build?.steps[p.id]?.state !== 'done');
		const callouts = step ? (s.callouts?.steps[step.id]?.callouts ?? []).filter((c) => c.shown && !c.closed && !c.isGone) : [];
		return { step: step?.id ?? '', callouts, answers: (s.callouts?.answers ?? []).filter((a) => !a.resolved), root: s.root };
	}

	private render(): void {
		const items = this.items();
		for (const editor of vscode.window.visibleTextEditors) {
			const out: Record<Tag, vscode.DecorationOptions[]> = { problem: [], warning: [], info: [], answer: [] };
			const doc = editor.document;
			if (items && doc.uri.scheme === 'file') {
				const isFile = (file: string) => isSamePath(absolutePath(file, items.root), doc.uri.fsPath);
				const lines = doc.getText().split(/\r?\n/);
				for (const c of items.callouts.filter((x) => isFile(x.file))) {
					const line = calloutLine(lines, c);
					if (line !== undefined) {
						out[c.kind].push({
							range: doc.lineAt(line - 1).range, hoverMessage: calloutHover(items.step, c, doc.uri.fsPath, line),
							renderOptions: { after: { contentText: `${LABELS[c.kind]} · ${c.title}` } },
						});
					}
				}
				for (const a of items.answers.filter((x) => isFile(x.file))) {
					const line = answerLine(lines, a);
					if (line !== undefined) {
						out.answer.push({
							range: doc.lineAt(line - 1).range, hoverMessage: answerHover(a),
							renderOptions: { after: { contentText: 'Claude · answer to your question' } },
						});
					}
				}
			}
			(Object.keys(this.types) as Tag[]).forEach((tag) => editor.setDecorations(this.types[tag], out[tag]));
		}
	}
}

function calloutHover(step: string, c: Callout, file: string, line: number): vscode.MarkdownString {
	const text = new vscode.MarkdownString(undefined, true);
	text.isTrusted = { enabledCommands: ['shotgun.showInDataFlow', 'shotgun.closeCallout'] };
	text.appendMarkdown(`**Shotgun: ${c.kind}.** `);
	text.appendText(c.title);
	text.appendMarkdown('\n\n*Engine:* ');
	text.appendText(c.proof.join(' '));
	if (c.explanation) {
		text.appendMarkdown('\n\n*Model:* ');
		text.appendText(c.explanation.text);
	}
	const show = encodeURIComponent(JSON.stringify([file, line, c.source]));
	const close = encodeURIComponent(JSON.stringify([step, c.id]));
	text.appendMarkdown(`\n\n[Show in DataFlow](command:shotgun.showInDataFlow?${show}) · [Not a problem](command:shotgun.closeCallout?${close})`);
	return text;
}

function answerHover(a: LineAnswer): vscode.MarkdownString {
	const text = new vscode.MarkdownString(undefined, true);
	text.isTrusted = { enabledCommands: ['shotgun.resolveAnswer'] };
	text.appendMarkdown('**Shotgun:** *You:* ');
	text.appendText(a.question);
	if (a.facts.length > 0) {
		text.appendMarkdown('\n\n*Engine:* ');
		text.appendText(a.facts.join(' '));
	}
	text.appendMarkdown('\n\n*Model:* ');
	text.appendText(a.answer);
	text.appendMarkdown(`\n\n[Resolve](command:shotgun.resolveAnswer?${encodeURIComponent(JSON.stringify([a.id]))})`);
	return text;
}
