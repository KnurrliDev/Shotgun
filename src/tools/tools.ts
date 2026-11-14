import * as path from 'path';
import type { ExtensionTool } from '../dataflow/dataflow-api';
import { parseBrief, partSummary, questionLine } from '../session/brief';
import { changedTasks, Order, orderWarnings } from '../session/order';
import { IS_CASE_SENSITIVE } from '../session/paths';
import { GATE_LABEL, GATE_OF, STAGE_INFO, STAGES } from '../session/stages';
import type { Snapshot, SessionStore } from '../session/store';
import { SIZES } from '../session/survey';
import { submitBrief, submitQuestions } from './brief';
import { contextOutput, contextText } from './context';
import { decide, GuardInput, hookOutput, isInside, targetOf } from './guard';
import { orderData, submitTaskSurvey } from './order';
import type { PromptLog } from './prompts';
import { EngineApi, submitSurvey } from './survey';

export { IS_CASE_SENSITIVE };

// The tools of Shotgun for the MCP server of DataFlow. DataFlow puts "shotgun_" before each name, so Claude Code sees
// for example mcp__plugin_dataflow_dataflow__shotgun_get_session. Phase 1 has the read tool get_session and the 2 tools
// of the hooks. Phase 2 adds submit_brief and submit_questions, phase 3 submit_survey, and phase 4 get_order and
// submit_task_survey.

// A hook in the survey of stage 2 and in the survey of a task in stage 3
const HOOK_SCHEMA = {
	type: 'object',
	properties: {
		id: { type: 'string', description: 'For example H1.' },
		title: { type: 'string' },
		kind: { type: 'string', description: 'The new code at the place, for example "new check in solve()".' },
		file: { type: 'string', description: 'The file, relative to the first folder of the project, or absolute.' },
		lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[first, last], from 1.' },
		code: { type: 'string', description: 'A short text of the code in the lines, copied exactly.' },
	},
	required: ['id', 'title', 'kind', 'file', 'lines', 'code'],
};

const SIZE_SCHEMA = { type: 'string', enum: [...SIZES], description: 'Your estimate of the work of the task.' };

export interface ToolDeps {
	readonly store: SessionStore;
	readonly folders: () => readonly string[]; // the workspace folders
	readonly log: (message: string) => void;
	readonly prompts: PromptLog; // the last prompts of the user, from the context hook
	readonly readText: (file: string) => string | undefined; // the text of a file, from an open text editor first
	readonly openFile: (file: string) => void; // shows a file in the text editor
	readonly engine: () => EngineApi | undefined; // the facts of DataFlow for the survey. undefined: no link to DataFlow
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The result of get_session: the active task, its stage and gates, the brief, the survey, the order, the rule of the guard
// and the next work. brief: the file brief.md of the active task and its text. surveyFile: the file survey.json. order:
// the order of the user, for stage 3 and later
export function sessionData(snapshot: Snapshot, brief?: { file: string; text: string }, surveyFile?: string, order?: Order): Record<string, unknown> {
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
		...(snapshot.survey && surveyFile ? {
			survey: {
				file: surveyFile,
				tasks: snapshot.survey.tasks.length,
				hooks: snapshot.survey.hooks.length,
				facts: snapshot.survey.facts.length,
				questions: snapshot.survey.questions.map((q) => ({
					id: q.id, text: q.text, ...(snapshot.answers[q.id] ? { answer: snapshot.answers[q.id].text } : {}),
				})),
			},
		} : {}),
		...(task && order && snapshot.survey && task.stage !== 'brief' && task.stage !== 'survey' ? {
			order: {
				inPlan: order.tasks.filter((t) => !t.isLater).length,
				later: order.tasks.filter((t) => t.isLater).length,
				changed: changedTasks(order, snapshot.survey).map((t) => t.id),
				warnings: orderWarnings(order, snapshot.survey).length,
				tool: 'Call shotgun_get_order for the tasks in sequence.',
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
				+ 'questions, the survey with the answers of the user, the rule of the guard and the next work. Call it first for each request '
				+ 'about Shotgun.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => {
				const file = deps.store.briefFile();
				const text = file ? deps.readText(file) : undefined;
				const task = deps.store.snapshot.task;
				const surveyFile = task && deps.store.dir ? path.join(deps.store.dir, task.id, 'survey.json') : undefined;
				return sessionData(deps.store.snapshot, file && text !== undefined ? { file, text } : undefined, surveyFile, deps.store.order);
			},
		},
		{
			name: 'get_order',
			title: 'Shotgun order',
			description: 'Gives the order of the user, in stage 3 and later: the tasks in sequence, with their text, their hooks and the tasks '
				+ 'that they need. "changed" gives the tasks of the plan with no survey for their text: a new task of the user, or a task '
				+ 'with a new text. Survey each of them with submit_task_survey.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => orderData(deps.store.snapshot, deps.store.order),
		},
		{
			name: 'submit_task_survey',
			title: 'Shotgun: give the survey of a task',
			description: 'Gives your survey of 1 task of the order to Shotgun, in stage 3: its hooks and the tasks that it needs first. Give '
				+ 'the text of the task exactly as get_order gives it. Do not change the text or the place of a task: the order is the '
				+ 'decision of the user. Give a hook of the survey by its id in "hooks", and a new hook in "newHooks".',
			inputSchema: {
				type: 'object',
				properties: {
					task: { type: 'string', description: 'The id of the task, from get_order.' },
					text: { type: 'string', description: 'The text of the task now, copied from get_order.' },
					hooks: { type: 'array', items: { type: 'string' }, description: 'The ids of the hooks of the survey that the task changes.' },
					newHooks: { type: 'array', items: HOOK_SCHEMA, description: 'The new hooks of the task, with ids that the survey does not have.' },
					needs: { type: 'array', items: { type: 'string' }, description: 'The ids of the tasks of the order that this task needs first.' },
					size: SIZE_SCHEMA,
					note: { type: 'string', description: 'A short note for the user, for example the hooks that changed. A maximum of 500 characters.' },
				},
				required: ['task', 'text', 'hooks', 'needs'],
			},
			call: (args) => submitTaskSurvey(deps, args),
		},
		{
			name: 'submit_survey',
			title: 'Shotgun: give the survey',
			description: 'Gives your survey of the brief to Shotgun, in stage 2: the tasks in no sequence, the hooks (the places where new code '
				+ 'goes into the code that is there), the facts from the read tools of DataFlow that you called, and the questions for the user. '
				+ 'Each hook gives "code": a short text of the code in its lines, copied exactly. A new survey replaces the old survey.',
			inputSchema: {
				type: 'object',
				properties: {
					tasks: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								id: { type: 'string', description: 'For example T1.' },
								title: { type: 'string' },
								text: { type: 'string' },
								hooks: { type: 'array', items: { type: 'string' }, description: 'The ids of the hooks of the task. Empty for only new files.' },
								needs: { type: 'array', items: { type: 'string' }, description: 'The ids of the tasks that this task needs first.' },
								size: SIZE_SCHEMA,
							},
							required: ['id', 'title', 'hooks'],
						},
					},
					hooks: { type: 'array', items: HOOK_SCHEMA },
					facts: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								text: { type: 'string' },
								file: { type: 'string' },
								lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
								tool: { type: 'string', description: 'The read tool of DataFlow that you called, and that gave the fact, for example get_threads.' },
							},
							required: ['text', 'file', 'lines', 'tool'],
						},
					},
					questions: {
						type: 'array',
						items: {
							type: 'object',
							properties: { id: { type: 'string', description: 'For example Q1.' }, text: { type: 'string' } },
							required: ['id', 'text'],
						},
					},
				},
				required: ['tasks', 'hooks'],
			},
			call: (args) => submitSurvey(deps, args),
		},
		{
			name: 'submit_brief',
			title: 'Shotgun: give the brief',
			description: 'Gives a brief that the user wrote in the chat to Shotgun. Shotgun makes a new task in stage 1 for it, or fills the '
				+ 'empty brief of the active task in stage 1. It never changes a brief with text. Thus do not ask the user about the task '
				+ 'before the call. Copy the words of the user exactly. You can add only the headings of the 5 parts (## Goal, ## Facts, ## Specs, ## Not in scope, '
				+ '## Done when) and the list mark "- ". Shotgun refuses each line that is not in the recent prompts of the user.',
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
