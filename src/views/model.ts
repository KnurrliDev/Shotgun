import * as path from 'path';
import type { ClaudeState } from '../claude/connection';
import { MIN_DATAFLOW } from '../dataflow/version';
import { parseBrief, partName, partSummary, questionLine } from '../session/brief';
import type { Decision, TaskFile } from '../session/files';
import { GATE_LABEL, STAGE_INFO, STAGES, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import type { BriefView, DecisionView, GateView, SetupRow, StageView, TaskView, ViewModel } from './protocol';

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
}

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
	}
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

// The gate of the stage. This version of Shotgun has only the gate of stage 1
function gateView(task: TaskFile, brief: BriefView | undefined): GateView | undefined {
	if (task.isDone || task.stage !== 'brief' || !brief) {
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

function taskView(snapshot: Snapshot, briefInput: ModelInput['brief']): TaskView | null {
	const task = snapshot.task;
	if (!task) {
		return null;
	}
	const brief = task.stage === 'brief' && !task.isDone && briefInput ? briefView(snapshot, briefInput) : undefined;
	const gate = gateView(task, brief);
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
		task: taskView(snapshot, input.brief),
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
