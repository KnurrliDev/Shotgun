import * as vscode from 'vscode';
import { isSamePath } from '../claude/settings';
import { absolutePath } from '../session/paths';
import type { Snapshot } from '../session/store';
import { findHook, Lines, SurveyHook } from '../session/survey';

// The hooks of the survey in the text editor, in the stages 2 and 3 (section 6.7 of the plan). Each hook gets a line at
// the left side of its lines, and its id and title after its first line. The hover shows the words of Claude (Model)
// and the facts of DataFlow (Engine, decision 13). A hook follows its code when the text changes.

export class HookDecorations implements vscode.Disposable {
	private readonly lineType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 2px',
		borderStyle: 'solid',
		borderColor: new vscode.ThemeColor('focusBorder'),
		overviewRulerColor: new vscode.ThemeColor('focusBorder'),
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});
	private readonly labelType = vscode.window.createTextEditorDecorationType({
		after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic', margin: '0 0 0 2em' },
	});
	private readonly disposables: vscode.Disposable[] = [];
	private snapshot: Snapshot | undefined;
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(
			this.lineType,
			this.labelType,
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
			// a change of a file with hooks can move the hooks. The check of the path is fast, so it runs for each change
			vscode.workspace.onDidChangeTextDocument((e) => this.surveyHooksOf(e.document).length > 0 && this.renderSoon()),
			vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (doc, position) => this.hover(doc, position) }),
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

	// The hooks of a document with their lines now. The text editor shows hooks only in the stages 2 and 3
	hooksOf(doc: vscode.TextDocument): { hook: SurveyHook; lines: Lines }[] {
		const hooks = this.surveyHooksOf(doc);
		if (hooks.length === 0) {
			return [];
		}
		const text = doc.getText().split(/\r?\n/);
		return hooks.flatMap((hook) => {
			const lines = findHook(text, hook);
			return lines ? [{ hook, lines }] : [];
		});
	}

	// The hooks of the survey in the file of a document, at their lines at the time of the survey
	private surveyHooksOf(doc: vscode.TextDocument): readonly SurveyHook[] {
		const s = this.snapshot;
		if (!s?.task || !s.survey || !s.root || s.task.isDone || (s.task.stage !== 'survey' && s.task.stage !== 'order') || doc.uri.scheme !== 'file') {
			return [];
		}
		const root = s.root;
		return s.survey.hooks.filter((h) => isSamePath(absolutePath(h.file, root), doc.uri.fsPath));
	}

	private renderSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.render(), 200);
	}

	private render(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const hooks = this.hooksOf(editor.document);
			editor.setDecorations(this.lineType, hooks.map(({ lines }) => new vscode.Range(lines[0] - 1, 0, lines[1] - 1, 0)));
			editor.setDecorations(this.labelType, hooks.map(({ hook, lines }) => {
				const end = editor.document.lineAt(lines[0] - 1).range.end;
				return { range: new vscode.Range(end, end), renderOptions: { after: { contentText: `${hook.id} · ${hook.title}` } } };
			}));
		}
	}

	private hover(doc: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const line = position.line + 1;
		const found = this.hooksOf(doc).filter(({ lines }) => line >= lines[0] && line <= lines[1]);
		const s = this.snapshot;
		if (found.length === 0 || !s?.survey) {
			return undefined;
		}
		const md = new vscode.MarkdownString();
		found.forEach(({ hook }, i) => {
			if (i > 0) {
				md.appendMarkdown('\n\n---\n\n');
			}
			const tasks = s.survey!.tasks.filter((t) => t.hooks.includes(hook.id)).map((t) => `${t.id} ${t.title}`);
			const engine = s.engine?.hooks[hook.id];
			md.appendMarkdown(`**Shotgun hook ${hook.id}:** `);
			md.appendText(hook.title);
			md.appendMarkdown('\n\n*Model:* ');
			md.appendText(`${hook.kind}${tasks.length > 0 ? `. For ${tasks.join(', ')}.` : ''}`);
			if (engine) {
				md.appendMarkdown('\n\n*Engine:* ');
				const heat = engine.heat
					? ` Heat ${engine.heat.score}, ${engine.heat.band}${engine.heat.isReachComplete ? '' : ', before the end of the scan of the call graph'}.` : '';
				md.appendText(`${engine.text}${heat}`);
			}
		});
		return new vscode.Hover(md);
	}
}
