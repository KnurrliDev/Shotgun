import * as path from 'path';
import type { ClaudeState } from '../claude/connection';
import { MIN_DATAFLOW } from '../dataflow/version';
import { parseBrief, partName, partSummary, questionLine } from '../session/brief';
import type { Decision, TaskFile } from '../session/files';
import { absolutePath } from '../session/paths';
import { GATE_LABEL, STAGE_INFO, STAGES, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import { excerptOf, findHook, Lines } from '../session/survey';
import type { BriefView, DecisionView, GateView, HookView, SetupRow, StageView, SurveyView, TaskView, ViewModel } from './protocol';

// The view model of the page and of the panel, from the session, the state of DataFlow and the connection to Claude
// Code. These functions use no VS Code API, so the unit tests can call them directly.

// The state of DataFlow for the views, with no API object
export interface DataFlowView {
	readonly state: 'linking' | 'missing' | 'old' | 'failed' | 'ready';
	readonly version?: string;
	readonly reason?: string; // the reason of the state failed
	readonly engine?: 'stopped' | 'starting' | 'ready' | 'failed';
	readonly engineError?: string;
	readonly toolsError?: string; // the reason why DataFlow did not add the tools of Shotgun
}

export interface ModelInput {
	readonly version: string; // the version of Shotgun
	readonly snapshot: Snapshot;
	readonly dataflow: DataFlowView;
	readonly claude: ClaudeState;
	// the brief of the active task: the text of the open text editor, else of the file
	readonly brief?: { readonly file: string; readonly text: string; readonly isDirty: boolean };
	// the lines of a file of the project now, for the hooks of the survey. undefined: no file
	readonly readLines?: (file: string) => readonly string[] | undefined;
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const placeText = (file: string, lines: Lines): string => (lines[0] === lines[1] ? `${file}:${lines[0]}` : `${file}:${lines[0]}-${lines[1]}`);

// The maximum number of decisions in the views
const MAX_DECISIONS = 30;

export function decisionText(decision: Decision): string {
	switch (decision.kind) {
		case 'task':
			return `${decision.by === 'claude' ? 'Claude' : 'You'} started the task "${decision.title}".`;
		case 'gate':
			return `You passed the gate "${GATE_LABEL[decision.gate]}" of stage ${STAGE_INFO[decision.stage].number}.`;
		case 'pause':
			return 'You paused the guard for work outside of the task.';
		case 'continue':
			return 'You continued the task. The guard is on.';
		case 'deny':
			return `The guard stopped ${decision.tool} of ${decision.file}.`;
		case 'brief':
			return `Claude gave your brief from the chat: ${decision.lines === 1 ? '1 line' : `${decision.lines} lines`} of your words.`;
		case 'questions':
			return `Claude asked ${decision.count === 1 ? '1 question' : `${decision.count} questions`} about the brief.`;
		case 'question':
			return `You closed the question "${decision.text}".`;
		case 'survey':
			return `Claude gave the survey: ${count(decision.tasks, 'task')}, ${count(decision.hooks, 'hook')}, ${count(decision.facts, 'fact')} `
				+ `and ${count(decision.questions, 'question')}.`;
		case 'answer':
			return decision.text ? `You answered the question ${decision.id}: "${decision.text}".` : `You removed the answer to the question ${decision.id}.`;
	}
}

// Stage 2 and later: the survey of Claude with the facts of DataFlow. The hooks are in the text as it is now
function surveyView(snapshot: Snapshot, readLines: ModelInput['readLines']): SurveyView | undefined {
	const { survey, root, task } = snapshot;
	if (!survey || !root || !task) {
		return undefined;
	}
	const files = new Map<string, readonly string[] | undefined>();
	const linesOf = (file: string) => {
		if (!files.has(file)) {
			files.set(file, readLines?.(file));
		}
		return files.get(file);
	};
	const hooks: HookView[] = survey.hooks.map((h) => {
		const file = absolutePath(h.file, root);
		const text = linesOf(file);
		const found = text ? findHook(text, h) : undefined;
		const lines = found ?? h.lines;
		const engine = snapshot.engine?.hooks[h.id];
		return {
			id: h.id,
			title: h.title,
			kind: h.kind,
			place: placeText(h.file, h.lines),
			path: file,
			lines: [lines[0], lines[1]],
			isMoved: !!found && found[0] !== h.lines[0],
			isLost: !!text && !found,
			tasks: survey.tasks.filter((t) => t.hooks.includes(h.id)).map((t) => t.id),
			...(engine ? { engine: { ...engine } } : {}),
			...(text ? { excerpt: excerptOf(text, lines) } : {}),
		};
	});
	return {
		time: survey.time,
		tasks: survey.tasks.map((t) => ({ id: t.id, title: t.title, ...(t.text ? { text: t.text } : {}), hooks: [...t.hooks], needs: [...t.needs] })),
		hooks,
		facts: survey.facts.map((f) => ({ text: f.text, place: placeText(f.file, f.lines), path: absolutePath(f.file, root), line: f.lines[0], tool: f.tool })),
		questions: survey.questions.map((q) => ({ id: q.id, text: q.text, ...(snapshot.answers[q.id] ? { answer: snapshot.answers[q.id].text } : {}) })),
		isReachComplete: snapshot.engine?.isReachComplete ?? false,
		...(snapshot.engine ? { engineTime: snapshot.engine.time } : {}),
		isEditable: task.stage === 'survey' && !task.isDone,
	};
}

// Stage 1: the parts of the brief and the open questions of Claude
function briefView(snapshot: Snapshot, brief: NonNullable<ModelInput['brief']>): BriefView {
	const parsed = parseBrief(brief.text);
	const open = snapshot.questions.filter((q) => q.state === 'open');
	return {
		file: brief.file,
		parts: parsed.parts.map((p) => ({ id: p.id, name: p.name, hasText: p.hasText, summary: partSummary(p), ...(p.line ? { line: p.line } : {}) })),
		complete: parsed.parts.filter((p) => p.hasText).length,
		isComplete: parsed.isComplete,
		isDirty: brief.isDirty,
		questions: open.map((q) => {
			const line = questionLine(brief.text, parsed.parts, q);
			return { id: q.id, text: q.text, ...(q.part ? { partName: partName(q.part) } : {}), ...(line ? { line } : {}) };
		}),
		closed: snapshot.questions.length - open.length,
	};
}

// The gate of the stage. This version of Shotgun has the gates of the stages 1 and 2
function gateView(task: TaskFile, brief: BriefView | undefined, survey: SurveyView | undefined): GateView | undefined {
	if (task.isDone) {
		return undefined;
	}
	if (task.stage === 'survey') {
		const open = survey ? survey.questions.filter((q) => !q.answer).length : 0;
		return {
			label: GATE_LABEL['order-tasks'],
			note: 'Your gate. After it, you put the tasks in sequence. You can rewrite a task, and you can add a task.',
			isEnabled: !!survey,
			...(survey ? {} : { reason: 'Ask Claude for the survey first.' }),
			...(open > 0 ? { warning: `${open === 1 ? '1 question' : `${open} questions`} of the survey ${open === 1 ? 'has' : 'have'} no answer.` } : {}),
		};
	}
	if (task.stage !== 'brief' || !brief) {
		return undefined;
	}
	const missing = brief.parts.filter((p) => !p.hasText).map((p) => p.name);
	const open = brief.questions.length;
	return {
		label: GATE_LABEL['brief-ready'],
		note: 'Your gate. It starts the scan of the call graph.',
		isEnabled: missing.length === 0,
		...(missing.length > 0 ? { reason: `Write ${missing.join(', ')} in brief.md first.` } : {}),
		...(open > 0 ? { warning: `${open === 1 ? '1 question' : `${open} questions`} of Claude ${open === 1 ? 'is' : 'are'} open.` } : {}),
		...(STAGE_INFO.survey.request ? { after: STAGE_INFO.survey.request } : {}),
	};
}

function dataflowRow(dataflow: DataFlowView): SetupRow {
	const id = 'dataflow';
	const name = `DataFlow ${dataflow.version ?? ''}`.trim();
	switch (dataflow.state) {
		case 'linking':
			return { id, isOk: false, text: 'Shotgun looks for DataFlow.' };
		case 'missing':
			return { id, isOk: false, text: `Install DataFlow ${MIN_DATAFLOW} or a later version. Shotgun uses its engine and its MCP server.` };
		case 'old':
			return { id, isOk: false, text: `${name} is too old. Install DataFlow ${MIN_DATAFLOW} or a later version.` };
		case 'failed':
			return { id, isOk: false, text: `${name} did not start: ${dataflow.reason ?? 'no reason'}` };
		case 'ready':
			if (dataflow.toolsError) {
				return { id, isOk: false, text: `${name} did not add the tools of Shotgun: ${dataflow.toolsError}` };
			}
			if (dataflow.engine === 'failed') {
				return { id, isOk: false, text: `${name}: the engine failed. ${dataflow.engineError ?? ''}`.trim() };
			}
			return {
				id, isOk: true,
				text: dataflow.engine === 'ready' ? `${name}: the engine is ready.`
					: dataflow.engine === 'starting' ? `${name}: the engine starts.`
						: `${name}: the engine is stopped. ${dataflow.engineError ?? ''}`.trim(),
			};
	}
}

function shotgunRow(claude: ClaudeState, hasTask: boolean): SetupRow {
	const id = 'claude-shotgun';
	if (claude.marketplace === 'none') {
		return {
			id, isOk: false, text: 'Connect Shotgun to Claude Code for the guard and the context of the task.',
			action: { command: 'connectClaude', label: 'Connect Shotgun' },
		};
	}
	if (claude.marketplace === 'other') {
		return {
			id, isOk: false, text: 'The settings of Claude Code have a different folder for the plugin of Shotgun.',
			action: { command: 'connectClaude', label: 'Connect again' },
		};
	}
	if (!hasTask) {
		return { id, isOk: true, text: 'Shotgun is connected to Claude Code. The plugin goes on in this folder with the first task.' };
	}
	return claude.plugin === 'on'
		? { id, isOk: true, text: 'Shotgun is connected to Claude Code. Its plugin is on in this folder.' }
		: {
			id, isOk: false, text: 'The plugin of Shotgun is off in this folder.',
			action: { command: 'connectClaude', label: 'Turn it on' },
		};
}

export function setupRows(input: ModelInput): SetupRow[] {
	const { snapshot, claude } = input;
	return [
		snapshot.root
			? { id: 'folder', isOk: true, text: `Folder: ${path.basename(snapshot.root)}` }
			: { id: 'folder', isOk: false, text: 'Open a folder. Shotgun keeps its files in the folder .shotgun of the first workspace folder.' },
		dataflowRow(input.dataflow),
		claude.dataflow === 'connected'
			? { id: 'claude-dataflow', isOk: true, text: 'DataFlow is connected to Claude Code.' }
			: {
				id: 'claude-dataflow', isOk: false,
				text: 'Connect DataFlow to Claude Code. The tools of Shotgun are in the MCP server of DataFlow.',
				action: { command: 'connectDataFlow', label: 'Connect DataFlow' },
			},
		shotgunRow(claude, snapshot.tasks.length > 0),
	];
}

function stageViews(snapshot: Snapshot): StageView[] {
	const task = snapshot.task;
	const current = task ? STAGES.indexOf(task.stage) : -1;
	return STAGES.map((stage, i) => {
		const info = STAGE_INFO[stage];
		let state: StageView['state'] = 'todo';
		if (task && (task.isDone || i < current)) {
			state = 'done';
		} else if (i === current) {
			state = 'current';
		}
		return { stage, number: info.number, name: info.name, writer: info.writer, state };
	});
}

function taskView(snapshot: Snapshot, briefInput: ModelInput['brief'], readLines: ModelInput['readLines']): TaskView | null {
	const task = snapshot.task;
	if (!task) {
		return null;
	}
	const brief = task.stage === 'brief' && !task.isDone && briefInput ? briefView(snapshot, briefInput) : undefined;
	const survey = task.stage !== 'brief' ? surveyView(snapshot, readLines) : undefined;
	const gate = gateView(task, brief, survey);
	const info = STAGE_INFO[task.stage];
	const isActive = !task.isDone && !snapshot.isPaused;
	let next = info.next;
	let guard = info.guard;
	if (task.isDone) {
		next = 'The task is done.';
		guard = 'The task is done. The guard makes no decision.';
	} else if (snapshot.isPaused) {
		next = 'Select Continue when the work outside of the task is done.';
		guard = 'The guard makes no decision in a pause.';
	}
	return {
		id: task.id,
		title: task.title,
		created: task.created,
		stage: task.stage,
		stageNumber: info.number,
		stageName: info.name,
		writer: info.writer,
		text: info.text,
		next,
		guard,
		...(isActive && info.request ? { request: info.request } : {}),
		...(brief ? { brief } : {}),
		...(survey ? { survey } : {}),
		...(gate ? { gate } : {}),
		isDone: task.isDone,
		isPaused: snapshot.isPaused,
	};
}

export function buildModel(input: ModelInput): ViewModel {
	const { snapshot } = input;
	const setup = setupRows(input);
	const decisions: DecisionView[] = [...snapshot.decisions].reverse().slice(0, MAX_DECISIONS)
		.map((d) => ({ time: d.time, by: d.by, text: decisionText(d) }));
	return {
		version: input.version,
		stages: stageViews(snapshot),
		task: taskView(snapshot, input.brief, input.readLines),
		tasks: snapshot.tasks.map((t) => ({
			id: t.id, title: t.title, stageNumber: STAGE_INFO[t.stage].number, stageName: STAGE_INFO[t.stage].name, isDone: t.isDone,
			isActive: t.id === snapshot.task?.id,
		})),
		decisions,
		setup,
		isReady: setup.every((r) => r.isOk),
		problems: [...snapshot.problems],
	};
}

// The text of the status bar item and its tooltip
export function statusOf(snapshot: Snapshot): { text: string; tooltip: string } {
	const task = snapshot.task;
	if (!task) {
		return { text: 'Shotgun', tooltip: 'Shotgun: no active task. Select to show the panel.' };
	}
	if (task.isDone) {
		return { text: 'Shotgun: the task is done', tooltip: `Shotgun: the task "${task.title}" is done.` };
	}
	if (snapshot.isPaused) {
		return { text: 'Shotgun: paused', tooltip: `Shotgun: the guard is off for "${task.title}". Select "Shotgun: Continue" to continue.` };
	}
	return { text: `Shotgun: ${stageText(task.stage)}`, tooltip: `Shotgun: "${task.title}". Next: ${STAGE_INFO[task.stage].next}` };
}
