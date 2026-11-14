import * as path from 'path';
import type { ExtensionTool } from '../dataflow/dataflow-api';
import { parseBrief, partSummary, questionLine } from '../session/brief';
import { GATE_LABEL, GATE_OF, STAGE_INFO, STAGES } from '../session/stages';
import type { Snapshot, SessionStore } from '../session/store';
import { submitBrief, submitQuestions } from './brief';
import { contextOutput, contextText } from './context';
import { decide, GuardInput, hookOutput, isInside, targetOf } from './guard';
import type { PromptLog } from './prompts';

// The tools of Shotgun for the MCP server of DataFlow. DataFlow puts "shotgun_" before each name, so Claude Code sees
// for example mcp__plugin_dataflow_dataflow__shotgun_get_session. Phase 1 has the read tool get_session and the 2 tools
// of the hooks. Phase 2 adds submit_brief and submit_questions.

export interface ToolDeps {
	readonly store: SessionStore;
	readonly folders: () => readonly string[]; // the workspace folders
	readonly log: (message: string) => void;
	readonly prompts: PromptLog; // the last prompts of the user, from the context hook
	readonly readText: (file: string) => string | undefined; // the text of a file, from an open text editor first
	readonly openFile: (file: string) => void; // shows a file in the text editor
}

// File systems of Windows and macOS do not tell the case of letters apart
export const IS_CASE_SENSITIVE = process.platform !== 'win32' && process.platform !== 'darwin';

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The result of get_session: the active task, its stage and gates, the brief, the rule of the guard and the next work.
// brief: the file brief.md of the active task and its text
export function sessionData(snapshot: Snapshot, brief?: { file: string; text: string }): Record<string, unknown> {
	const task = snapshot.task;
	let guard: string;
	let next: string;
	if (!task) {
		guard = 'No task is active. The guard makes no decision.';
		next = 'The user makes a task with "Shotgun: New Task", or selects a task with "Shotgun: Open Task".';
	} else if (task.isDone) {
		guard = 'The task is done. The guard makes no decision.';
		next = 'The task is done.';
	} else if (snapshot.isPaused) {
		guard = 'The user paused the task. The guard makes no decision.';
		next = 'The user selects "Shotgun: Continue" to continue the task.';
	} else {
		guard = STAGE_INFO[task.stage].guard;
		next = STAGE_INFO[task.stage].next;
	}
	const parsed = brief ? parseBrief(brief.text) : undefined;
	return {
		folder: snapshot.root ?? null,
		task: task ? {
			id: task.id,
			title: task.title,
			created: task.created,
			stage: STAGE_INFO[task.stage].number,
			stageName: STAGE_INFO[task.stage].name,
			writer: STAGE_INFO[task.stage].writer,
			isDone: task.isDone,
			gates: task.gates.map((g) => ({ gate: GATE_LABEL[g.gate], stage: STAGE_INFO[g.stage].number, time: g.time })),
			nextGate: task.isDone ? null : GATE_LABEL[GATE_OF[task.stage]],
		} : null,
		...(brief && parsed ? {
			brief: {
				file: brief.file,
				parts: parsed.parts.map((p) => ({ name: p.name, hasText: p.hasText, summary: partSummary(p) })),
				isComplete: parsed.isComplete,
				openQuestions: snapshot.questions.filter((q) => q.state === 'open')
					.map((q) => ({ id: q.id, text: q.text, line: questionLine(brief.text, parsed.parts, q) })),
			},
		} : {}),
		isPaused: snapshot.isPaused,
		guard,
		next,
		stages: STAGES.map((s) => ({ number: STAGE_INFO[s].number, name: STAGE_INFO[s].name, writer: STAGE_INFO[s].writer })),
		otherTasks: snapshot.tasks.filter((t) => t.id !== task?.id)
			.map((t) => ({ id: t.id, title: t.title, stage: STAGE_INFO[t.stage].number, isDone: t.isDone })),
		...(snapshot.problems.length > 0 ? { problems: snapshot.problems } : {}),
	};
}

export function shotgunTools(deps: ToolDeps): ExtensionTool[] {
	return [
		{
			name: 'get_session',
			title: 'Shotgun session',
			description: 'Gives the active Shotgun task: its title, its stage of 5, the gates of the user, the brief with its parts and the open '
				+ 'questions, the rule of the guard and the next work. Call it first for each request about Shotgun.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => {
				const file = deps.store.briefFile();
				const text = file ? deps.readText(file) : undefined;
				return sessionData(deps.store.snapshot, file && text !== undefined ? { file, text } : undefined);
			},
		},
		{
			name: 'submit_brief',
			title: 'Shotgun: give the brief',
			description: 'Gives a brief that the user wrote in the chat to Shotgun, in stage 1. Copy the words of the user exactly. You can add '
				+ 'only the headings of the 5 parts (## Goal, ## Facts, ## Specs, ## Not in scope, ## Done when) and the list mark "- ". '
				+ 'Shotgun refuses each line that is not in the recent prompts of the user.',
			inputSchema: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'A short title of the task, a maximum of 200 characters.' },
					text: { type: 'string', description: 'The brief in the words of the user, with no title line.' },
					isNewTask: { type: 'boolean', description: 'True if the user wants a new task for this brief.' },
				},
				required: ['title', 'text'],
			},
			call: (args) => submitBrief(deps, args),
		},
		{
			name: 'submit_questions',
			title: 'Shotgun: ask about the brief',
			description: 'Gives your questions about the brief of the active task to Shotgun, in stage 1. The panel of Shotgun shows them to the '
				+ 'user. Give 1 to 10 questions. A new list replaces the open questions.',
			inputSchema: {
				type: 'object',
				properties: {
					questions: {
						type: 'array',
						minItems: 1,
						maxItems: 10,
						items: {
							type: 'object',
							properties: {
								text: { type: 'string', description: 'The question, a maximum of 500 characters.' },
								part: { type: 'string', enum: ['goal', 'facts', 'specs', 'scope', 'done'], description: 'The part of the brief.' },
								quote: { type: 'string', description: 'A short text of the brief that the question is about, copied exactly.' },
							},
							required: ['text'],
						},
					},
				},
				required: ['questions'],
			},
			call: (args) => submitQuestions(deps, args),
		},
		{
			name: 'guard',
			title: 'Shotgun guard',
			description: 'The PreToolUse hook of the Shotgun plugin calls this tool before each file change. Do not call it.',
			inputSchema: {
				type: 'object',
				properties: { tool: { type: 'string' }, file: { type: 'string' }, cwd: { type: 'string' } },
			},
			// the tool records a deny in the ledger, but it changes no file of the project
			isReadOnly: true,
			call: (args) => {
				const input: GuardInput = { tool: textOf(args.tool), file: textOf(args.file), cwd: textOf(args.cwd) };
				const folders = deps.folders();
				const snapshot = deps.store.snapshot;
				const decision = decide(input, {
					folders, shotgunDir: deps.store.dir, task: snapshot.task, isPaused: snapshot.isPaused, isCaseSensitive: IS_CASE_SENSITIVE,
				});
				if (decision.decision === 'deny') {
					const target = targetOf(input, folders) ?? input.file;
					const root = folders.find((f) => isInside(target, f, IS_CASE_SENSITIVE));
					const file = root ? path.relative(root, target) : target;
					deps.store.recordDeny(input.tool || 'unknown', file, decision.reason);
					deps.log(`The guard denied ${input.tool || 'a change'} of ${file}.`);
				}
				return hookOutput(decision);
			},
		},
		{
			name: 'session_context',
			title: 'Shotgun context',
			description: 'The UserPromptSubmit hook of the Shotgun plugin calls this tool before each prompt. Do not call it.',
			inputSchema: {
				type: 'object',
				properties: { event: { type: 'string' }, cwd: { type: 'string' }, prompt: { type: 'string' } },
			},
			// the tool keeps the prompt in memory for the check of a brief from the chat (decision 12)
			isReadOnly: true,
			call: (args) => {
				deps.prompts.add(textOf(args.prompt));
				const snapshot = deps.store.snapshot;
				return contextOutput(contextText(snapshot.task, snapshot.isPaused), textOf(args.event));
			},
		},
	];
}
