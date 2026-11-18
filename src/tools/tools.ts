import * as path from 'path';
import type { ExtensionTool } from '../dataflow/dataflow-api';
import type { CommitMessage } from '../git/message';
import { parseBrief, partSummary, questionLine } from '../session/brief';
import { buildGuard, CurrentStep, receiptCounts, stateOf } from '../session/build';
import type { Voice } from '../session/callouts';
import type { LineStore } from '../session/lines';
import { changedTasks, Order, orderWarnings } from '../session/order';
import { levelOf } from '../session/plan';
import { absolutePath, IS_CASE_SENSITIVE } from '../session/paths';
import { CATEGORIES, MAX_ISSUES, ORIGINS, SEVERITIES, SOURCES, VERDICTS } from '../session/review';
import { GATE_LABEL, GATE_OF, STAGE_INFO, STAGES } from '../session/stages';
import { isStepStage, SessionStore, Snapshot, stepNext, workPlan } from '../session/store';
import { SIZES } from '../session/survey';
import { submitBrief, submitQuestions } from './brief';
import { BaseApi, getStep, START_STEP_TOOL, startStep, StepChanges, submitErrand, submitFrame } from './build';
import { calloutsData, submitExplanation, submitLineAnswer, voiceOf } from './callouts';
import { contextOutput, contextText } from './context';
import { decide, GuardInput, hookOutput, isInside, targetOf } from './guard';
import { commitMessageData, submitMessageCheck } from './ledger';
import { orderData, submitTaskSurvey } from './order';
import { planData, submitPlan } from './plan';
import type { PromptLog } from './prompts';
import { ReviewApi, reviewData, submitReview } from './review';
import { EngineApi, submitSurvey } from './survey';

export { IS_CASE_SENSITIVE };

// The tools of Shotgun for the MCP server of DataFlow. DataFlow puts "shotgun_" before each name, so Claude Code sees
// for example mcp__plugin_dataflow_dataflow__shotgun_get_session. Phase 1 has the read tool get_session and the 2 tools
// of the hooks. Phase 2 adds submit_brief and submit_questions, phase 3 submit_survey, phase 4 get_order and
// submit_task_survey, phase 5 get_plan and submit_plan, phase 6 get_step, start_step and submit_errand, phase 7
// submit_frame, and phase 8 get_callouts, submit_explanation and submit_line_answer.

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

// A place of an issue of the review
const PLACE_SCHEMA = {
	type: 'object',
	properties: {
		file: { type: 'string', description: 'The file, relative to the first folder of the project, or absolute.' },
		lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[first, last], from 1.' },
		code: { type: 'string', description: 'A short text of the code in the lines, copied exactly.' },
	},
	required: ['file', 'lines', 'code'],
};

export interface ToolDeps {
	readonly store: SessionStore;
	readonly folders: () => readonly string[]; // the workspace folders
	readonly log: (message: string) => void;
	readonly prompts: PromptLog; // the last prompts of the user, from the context hook
	readonly readText: (file: string) => string | undefined; // the text of a file, from an open text editor first
	readonly openFile: (file: string) => void; // shows a file in the text editor
	readonly engine: () => EngineApi | undefined; // the facts of DataFlow for the survey. undefined: no link to DataFlow
	readonly base: () => BaseApi | undefined; // the bases and the diffs of DataFlow for the build. undefined: no link to DataFlow
	readonly saveFiles: (files: readonly string[]) => Promise<void>; // saves the open text editors of the files
	readonly lines: LineStore; // the writer of each changed line
	readonly changes: StepChanges; // the files that changed while a step was open
	readonly voice?: () => Voice; // the voice of the callouts, from the settings of the user
	// the tools of DataFlow that the MCP clients called since a time (decision 13). undefined: DataFlow does not tell them
	readonly calls?: (since: number) => ReadonlySet<string> | undefined;
	// the commit message of the user from Source Control. undefined: no repository of git
	readonly message?: () => CommitMessage | undefined;
	// the diff and the ripple of DataFlow for the review of stage 6. undefined: no link to DataFlow
	readonly review?: () => ReviewApi | undefined;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The result of get_session: the active task, its stage and gates, the brief, the survey, the order, the rule of the guard
// and the next work. brief: the file brief.md of the active task and its text. surveyFile: the file survey.json. order:
// the order of the user, for stage 3 and later
export function sessionData(snapshot: Snapshot, brief?: { file: string; text: string }, surveyFile?: string, order?: Order,
	current?: CurrentStep): Record<string, unknown> {
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
		next = stepNext(snapshot, current)?.next ?? STAGE_INFO[task.stage].next;
	}
	const parsed = brief ? parseBrief(brief.text) : undefined;
	// stage 6: the steps of the issues of the review
	const steps = (task?.stage === 'review' ? workPlan(snapshot)?.steps.filter((s) => s.issue) : snapshot.plan?.steps) ?? [];
	const done = steps.filter((s) => stateOf(snapshot.build, s.id) === 'done').length;
	const request = stepNext(snapshot, current)?.request;
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
		...(task && snapshot.plan ? {
			plan: {
				steps: snapshot.plan.steps.length,
				waiting: snapshot.plan.steps.filter((s) => levelOf(s, snapshot.risk, snapshot.levels).level === null).map((s) => s.id),
				userLevels: Object.values(snapshot.levels?.levels ?? {}).filter((l) => l.level).length,
				tool: 'Call shotgun_get_plan for the steps with their levels.',
			},
		} : {}),
		...(task && steps.length > 0 && (task.stage === 'build' || task.stage === 'review') ? {
			build: {
				done,
				total: steps.length,
				current: current ? {
					n: current.n, id: current.step.id, ...(current.step.issue ? { issue: current.step.issue } : {}), title: current.step.title, level: current.level, writer: current.writer, state: current.state,
					...(current.build?.receipt ? { receipt: receiptCounts(current.build.receipt) } : {}),
				} : null,
				...(request ? { request } : {}),
				tool: 'Call shotgun_get_step for the current step, its scope and its receipt.',
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
			description: 'Gives the active Shotgun task: its title, its stage of 6, the gates of the user, the brief with its parts and the open '
				+ 'questions, the survey with the answers of the user, the rule of the guard and the next work. Call it first for each request '
				+ 'about Shotgun.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => {
				const file = deps.store.briefFile();
				const text = file ? deps.readText(file) : undefined;
				const task = deps.store.snapshot.task;
				const surveyFile = task && deps.store.dir ? path.join(deps.store.dir, task.id, 'survey.json') : undefined;
				return sessionData(deps.store.snapshot, file && text !== undefined ? { file, text } : undefined, surveyFile, deps.store.order, deps.store.current);
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
			name: 'get_plan',
			title: 'Shotgun plan',
			description: 'Gives the plan of the active task, in stage 4 and later: the steps in sequence, with their places, texts and checks, '
				+ 'and the risk level of each step. The rules give a level from the facts of DataFlow, and only the user changes a level.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => planData(deps.store.snapshot),
		},
		{
			name: 'submit_plan',
			title: 'Shotgun: give the plan',
			description: 'Gives your plan to Shotgun, in stage 4: the steps in the sequence of the order of the user. Each step names its task, '
				+ 'its hooks, its places (lines of a file with a short text of their code, or a new file) and its open decisions. Each task of the '
				+ 'plan needs 1 step or more. Shotgun gives each step a risk level from the facts of DataFlow and its open decisions: a step with '
				+ 'no open decision gets at most level 2. A new plan replaces the old plan.',
			inputSchema: {
				type: 'object',
				properties: {
					steps: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								id: { type: 'string', description: 'For example S1. Keep the id of a step in a new plan.' },
								title: { type: 'string' },
								task: { type: 'string', description: 'The id of the task of the order, from get_order.' },
								hooks: { type: 'array', items: { type: 'string' }, description: 'The ids of the hooks of the survey that the step changes.' },
								places: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											file: { type: 'string', description: 'The file, relative to the first folder of the project.' },
											lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[first, last], from 1.' },
											code: { type: 'string', description: 'A short text of the code in the lines, copied exactly.' },
											new: { type: 'boolean', description: 'True for a new file. Then give no lines and no code.' },
											insert: {
												type: 'boolean',
												description: 'True if the new lines go next to these lines, and these lines do not change. For example a new data member '
													+ 'next to the other members of a type.',
											},
										},
										required: ['file'],
									},
									description: 'The places that the step changes, 1 to 8.',
								},
								text: { type: 'string', description: 'The goal and the result of the step, in 1 to 3 sentences. Give no answer to an open decision.' },
								checks: { type: 'array', items: { type: 'string' }, description: '1 to 5 checks for the user after the step.' },
								note: { type: 'string', description: 'A short note for the user, for example a risk that the facts show.' },
								decisions: {
									type: 'array',
									maxItems: 3,
									items: {
										type: 'object',
										properties: {
											question: { type: 'string', description: 'The decision as a short question, for example "What happens to the solve that still runs at the limit?".' },
											options: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Optional: the options that you see, with no choice.' },
										},
										required: ['question'],
									},
									description: 'The open decisions of the step, 0 to 3: the choices that the brief, the answers of the user and the order do not settle. '
										+ 'A type, a name, a signature or a value that the brief gives is no decision. Give an empty list for a step with no open decision.',
								},
							},
							required: ['id', 'title', 'task', 'places', 'text', 'checks', 'decisions'],
						},
					},
				},
				required: ['steps'],
			},
			call: (args) => submitPlan(deps, args),
		},
		{
			name: 'get_step',
			title: 'Shotgun step',
			description: 'Gives a step of the build, in stage 5: by default the current step. It gives the text, the places, the checks, the level, '
				+ 'the writer, the state and the scope of the step, and its receipt with the marks and the notes of the user: the issues and '
				+ 'the questions. The steps go in sequence. Claude writes only the steps of risk level 1 and 2.',
			inputSchema: {
				type: 'object',
				properties: { step: { type: 'string', description: 'The id of the step, for example S5, or its number. Default: the current step.' } },
			},
			isReadOnly: true,
			call: (args) => getStep(deps, args),
		},
		{
			name: 'start_step',
			title: 'Shotgun: open a step',
			description: 'Opens the current step of the build for your errand or your frame, in stage 5, before you change a file. Shotgun saves '
				+ 'the files of its scope, keeps their text as the base of the step, and the guard opens the scope. An errand is for risk level 1 '
				+ 'and 2. A frame is for level 3, and for level 4 after the user selects "I want a frame". Call it again after the receipt to '
				+ 'fix the issues of the user, or for a different frame: the step keeps its base.',
			inputSchema: {
				type: 'object',
				properties: {
					step: { type: 'string', description: 'The id of the step, for example S5, or its number.' },
					kind: { type: 'string', enum: ['errand', 'frame'], description: 'errand: you write the step. frame: you write the frame with holes for the user.' },
				},
				required: ['step'],
			},
			call: (args) => startStep(deps, args),
		},
		{
			name: 'submit_errand',
			title: 'Shotgun: give the receipt',
			description: 'Closes the open step after your changes, in stage 5. Give a change for each change since the base of the step: its file, '
				+ 'its lines in the text now, a title, a check for the user, and a note for a change that the user did not ask for. Shotgun gets '
				+ 'the diff since the base from DataFlow, and refuses a change with no note. Give the places outside of the scope that the step '
				+ 'can also need as loose ends. For each open decision of the step, give your choice in "choices".',
			inputSchema: {
				type: 'object',
				properties: {
					step: { type: 'string', description: 'The id of the open step, or its number.' },
					changes: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								file: { type: 'string', description: 'A file of the scope, relative to the first folder of the project.' },
								lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[first, last] of the change in the text now, from 1.' },
								title: { type: 'string', description: 'What the change does, for example "Read the new limit".' },
								check: { type: 'string', description: 'What the user checks, for example "Is 8 the correct value when the file has no key?".' },
								note: { type: 'string', description: 'Optional: a change that the user did not ask for, a risk, or an answer to a question of the user.' },
							},
							required: ['file', 'lines', 'title', 'check'],
						},
					},
					looseEnds: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								text: { type: 'string', description: 'What the place can also need, for example "describe() does not name the limit".' },
								file: { type: 'string' },
								lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
							},
							required: ['text'],
						},
						description: 'The places outside of the scope that the step can also need. The user decides about them.',
					},
					choices: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								decision: { type: 'string', description: 'The id of an open decision of the step, for example D1.' },
								choice: { type: 'string', description: 'Your choice and its reason, in 1 or 2 sentences.' },
							},
							required: ['decision', 'choice'],
						},
						description: 'Your choice for each open decision of the step, from get_step. The receipt shows them, and the user checks them.',
					},
				},
				required: ['step', 'changes'],
			},
			call: (args) => submitErrand(deps, args),
		},
		{
			name: 'submit_frame',
			title: 'Shotgun: give the frame',
			description: 'Closes the open frame step after you wrote the frame, in stage 5. Each open decision of the step is exactly 1 hole: a '
				+ 'marker /*@hole N: question */ in the place of the whole code of the decision, for example a condition with its branch. The '
				+ 'frame has all other lines. Give each hole with its number, its decision, its question and 4 hints: a nudge with no code, a '
				+ 'pointer to the facts with places, an example from the project with its place and code, and 1 possible answer. Shotgun refuses '
				+ 'an answer that is only a type, a name, a literal or a list of parameters. Do not give the answers in the chat.',
			inputSchema: {
				type: 'object',
				properties: {
					step: { type: 'string', description: 'The id of the open step, or its number.' },
					holes: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								n: { type: 'integer', description: 'The number of the marker /*@hole N: question */.' },
								decision: { type: 'string', description: 'The id of the open decision of the step that the hole decides, for example D1.' },
								question: { type: 'string', description: 'The question of the marker, the same text.' },
								nudge: { type: 'string', description: 'Hint 1: a question that shows the way, with no code.' },
								pointer: {
									type: 'object',
									properties: {
										text: { type: 'string', description: 'Hint 2: where the facts for the decision are.' },
										places: {
											type: 'array',
											items: {
												type: 'object',
												properties: { file: { type: 'string' }, lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
												required: ['file', 'lines'],
											},
										},
									},
									required: ['text', 'places'],
								},
								example: {
									type: 'object',
									properties: {
										text: { type: 'string', description: 'Hint 3: why this code of the project is a good example.' },
										file: { type: 'string' },
										lines: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
										code: { type: 'string', description: 'The code of the example, copied exactly from its lines.' },
									},
									required: ['text', 'file', 'lines', 'code'],
								},
								answer: { type: 'string', description: 'Hint 4: 1 possible code in the place of the marker. The user can write a different answer.' },
							},
							required: ['n', 'question', 'nudge', 'pointer', 'example', 'answer'],
						},
					},
					note: { type: 'string', description: 'A short note for the user: what the frame has, and the decisions that are holes.' },
				},
				required: ['step', 'holes'],
			},
			call: (args) => submitFrame(deps, args),
		},
		{
			name: 'get_callouts',
			title: 'Shotgun callouts',
			description: 'Gives the callouts of the current step, in stage 5: the new facts of DataFlow on the lines that the user wrote, for '
				+ 'example a race. Each callout has its id, place, kind, title, the facts of the engine, its state, and your explanation. It '
				+ 'also gives the questions of the user about lines with your answers.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => calloutsData(deps.store.snapshot, voiceOf(deps)),
		},
		{
			name: 'submit_explanation',
			title: 'Shotgun: explain a callout',
			description: 'Gives your explanation of a callout to Shotgun, in stage 5, when the user asks, for example "Explain the callout on line '
				+ '129". Give 1 to 3 sentences about the effect of the facts of DataFlow. Shotgun shows them under the facts with the badge '
				+ 'Model. Change no code.',
			inputSchema: {
				type: 'object',
				properties: {
					callout: { type: 'string', description: 'The id of the callout from get_callouts, for example C2.' },
					line: { type: 'integer', description: 'Or the line of the callout.' },
					text: { type: 'string', description: 'Your explanation: 1 to 3 sentences.' },
				},
				required: ['text'],
			},
			call: (args) => submitExplanation(deps, args),
		},
		{
			name: 'submit_line_answer',
			title: 'Shotgun: answer a question about a line',
			description: 'Gives your answer to a question of the user about a line to Shotgun, in stage 5, for example "Does the lambda on line '
				+ '95 copy charge?". Give the question exactly in the words of the user, and an answer of 1 to 4 sentences. Shotgun adds the '
				+ 'facts of DataFlow at the line, and shows the answer at the line. Change no code.',
			inputSchema: {
				type: 'object',
				properties: {
					file: { type: 'string', description: 'The file, relative to the first folder of the project.' },
					line: { type: 'integer', description: 'The line of the question, from 1.' },
					question: { type: 'string', description: 'The question of the user, copied exactly from the prompt.' },
					answer: { type: 'string', description: 'Your answer: 1 to 4 sentences.' },
				},
				required: ['file', 'line', 'question', 'answer'],
			},
			call: (args) => submitLineAnswer(deps, args),
		},
		{
			name: 'get_commit_message',
			title: 'Shotgun commit message',
			description: 'Gives the commit message that the user wrote in the input box of Source Control, in the stages 5 and 6 or after the end of the '
				+ 'task, when the user asks, for example "Check my commit message.". It also gives the changed files, the steps of the plan, the '
				+ 'decisions of the user, the lines of each writer and the loose ends. Then read the diff, and give your check.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => commitMessageData(deps),
		},
		{
			name: 'submit_message_check',
			title: 'Shotgun: check the commit message',
			description: 'Gives your check of the commit message of the user to Shotgun. Compare the message with the diff. Give the message as '
				+ 'you read it with get_commit_message, "agrees", and 1 to 12 points. A point has the kind ok, missing (the diff has a change '
				+ 'that the message does not tell), wrong (the message tells a change that the diff does not have) or question. Change no '
				+ 'message, and make no commit.',
			inputSchema: {
				type: 'object',
				properties: {
					message: { type: 'string', description: 'The commit message, exactly as get_commit_message gave it.' },
					agrees: { type: 'boolean', description: 'True if the message agrees with the diff: no point is missing or wrong.' },
					points: {
						type: 'array',
						description: 'The points of the check, 1 to 12.',
						items: {
							type: 'object',
							properties: {
								kind: { type: 'string', enum: ['ok', 'missing', 'wrong', 'question'] },
								text: { type: 'string', description: 'The point in 1 or 2 sentences, at most 300 characters.' },
								file: { type: 'string', description: 'The file of the point, relative to the first folder of the project. Optional.' },
								line: { type: 'integer', description: 'The line of the point in the file, from 1. Optional.' },
							},
							required: ['kind', 'text'],
						},
					},
					note: { type: 'string', description: 'A note for the user, at most 600 characters. Optional.' },
				},
				required: ['message', 'agrees', 'points'],
			},
			call: (args) => submitMessageCheck(deps, args),
		},
		{
			name: 'get_review',
			title: 'Shotgun review',
			description: 'Gives the review data of stage 6, when the user asks "Review my task.": the effort and the focus of the user, the base '
				+ 'commit of the task, the changed files with their hunks, heat and writers, the ripple, the brief, the steps of the plan, and the '
				+ 'earlier issues with the reasons of the user. Load the skill shotgun-review first. For the text of the diff, call get_diff of '
				+ 'DataFlow with the base commit.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => reviewData({ ...deps, review: deps.review ?? (() => undefined) }),
		},
		{
			name: 'submit_review',
			title: 'Shotgun: give the review',
			description: 'Gives the issues of your review of the task to Shotgun, in stage 6, after the verify pass of the skill shotgun-review. '
				+ 'Give each issue that the verify pass kept, the most severe first, with a maximum of 32. Each issue has a place in the diff of '
				+ 'the task or in its ripple, a failure scenario, a verdict, and the read tools of DataFlow that show it. Shotgun puts each issue '
				+ 'into the list of steps or into the second list. A new review of the same round replaces the open issues of the round. '
				+ 'Change no file.',
			inputSchema: {
				type: 'object',
				properties: {
					issues: {
						type: 'array',
						maxItems: MAX_ISSUES,
						items: {
							type: 'object',
							properties: {
								title: { type: 'string', description: 'A short title, a maximum of 60 characters.' },
								summary: { type: 'string', description: 'The defect in 1 sentence, a maximum of 300 characters.' },
								scenario: {
									type: 'object',
									description: 'The failure scenario. Each part has a maximum of 400 characters.',
									properties: {
										trigger: { type: 'string', description: 'The input or the state that starts the failure.' },
										path: { type: 'string', description: 'The path through the changed code.' },
										result: { type: 'string', description: 'The wrong result, the crash or the hang.' },
										interleave: { type: 'string', description: 'Only for a race, and then necessary: the 2 accesses and 1 interleave of the 2 threads.' },
									},
									required: ['trigger', 'path', 'result'],
								},
								category: { type: 'string', enum: [...CATEGORIES] },
								severity: { type: 'string', enum: [...SEVERITIES], description: 'important: a wrong result, a crash, a race, a leak or a gap in the brief.' },
								origin: { type: 'string', enum: [...ORIGINS], description: 'new: the task added the problem. pre-existing: it was in the code before the task.' },
								verdict: { type: 'string', enum: [...VERDICTS], description: 'confirmed: the verify pass found the failure scenario in the code. plausible: it did not confirm it, but it found no proof against it.' },
								source: { type: 'string', enum: [...SOURCES], description: 'engine: the candidate came from a fact of DataFlow, for example a race of get_threads. model: from you alone.' },
								place: PLACE_SCHEMA,
								fixPlaces: { type: 'array', maxItems: 4, items: PLACE_SCHEMA, description: 'Up to 4 more places of the fix, for example the other places of the same class of bug.' },
								decisions: {
									type: 'array',
									maxItems: 3,
									description: 'The open decisions of the fix: the choices that the user makes. Give no choice of yours.',
									items: {
										type: 'object',
										properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
										required: ['question'],
									},
								},
								tools: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' }, description: 'The read tools of DataFlow that you called and that show the issue, for example get_threads.' },
								repeats: { type: 'string', description: 'The id of the earlier issue that this issue repeats, for example I3.' },
								evidence: { type: 'string', description: 'Necessary for an earlier issue that the user closed: the new evidence.' },
							},
							required: ['title', 'summary', 'scenario', 'category', 'severity', 'origin', 'verdict', 'source', 'place', 'tools'],
						},
					},
					note: { type: 'string', description: 'A short note for the user, a maximum of 300 characters, for example the parts that the review did not read.' },
				},
				required: ['issues'],
			},
			call: (args) => submitReview({ ...deps, review: deps.review ?? (() => undefined) }, args),
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
				const root = snapshot.root;
				// stage 6: only a step of an issue opens a scope
				const current = deps.store.current;
				const isSteps = isStepStage(snapshot.task) && (snapshot.task?.stage === 'build' || !!current);
				const build = isSteps && root && workPlan(snapshot) ? buildGuard(current, START_STEP_TOOL) : undefined;
				const decision = decide(input, {
					folders, shotgunDir: deps.store.dir, task: snapshot.task, isPaused: snapshot.isPaused, isCaseSensitive: IS_CASE_SENSITIVE,
					...(build && root ? {
						build: {
							step: build.step,
							closed: build.closed,
							...(build.scope ? { scope: { files: build.scope.map((f) => absolutePath(f, root)), names: [...build.scope] } } : {}),
						},
					} : {}),
				});
				if (decision.decision === 'deny') {
					const target = targetOf(input, folders) ?? input.file;
					const folder = folders.find((f) => isInside(target, f, IS_CASE_SENSITIVE));
					const file = folder ? path.relative(folder, target).split(path.sep).join('/') : target;
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
				const now = stepNext(snapshot, deps.store.current)?.next;
				return contextOutput(contextText(snapshot.task, snapshot.isPaused, now), textOf(args.event));
			},
		},
	];
}
