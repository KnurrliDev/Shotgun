import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { BRIEF_FILE, briefTemplate, PartId } from './brief';
import {
	BUILD_FILE, BuildFile, BuildStep, BuildWriter, ChangeMark, currentStep, CurrentStep, MAX_CHANGE_NOTE, parseBuild, Receipt, receiptCounts, scopeOf, stateOf,
} from './build';
import { CALLOUTS_FILE, CalloutsFile, EMPTY_CALLOUTS, LineAnswer, parseCallouts, StepCallouts } from './callouts';
import type { Hole } from './frame';
import {
	ACTIVE_FILE, ActiveFile, ANSWERS_FILE, Decision, DECISIONS_FILE, decisionLine, DecisionInput, ENGINE_FILE, FILE_VERSION, jsonText, LEVELS_FILE,
	ORDER_FILE, parseActive, parseDecisions, parseQuestions, parseTask, PLAN_FILE, Question, QUESTIONS_FILE, readText, RISK_FILE, SHOTGUN_DIR,
	StepGate, SURVEY_FILE, TASK_FILE, TASK_ID, TaskFile, taskIdOf, writeTextAtomic,
} from './files';
import { MESSAGE_FILE, MessageCheck, parseMessageCheck } from './ledger';
import {
	addLooseEnds, EMPTY_LOOSE, LOOSE_FILE, LooseEndItem, LooseFile, LooseFind, looseIndex, looseStep, MAX_LOOSE_REASON, nextLooseStepId, parseLoose,
} from './loose';
import { applyEdit, Order, OrderEdit, OrderFile, orderOf, OrderTask, parseOrder, surveyIds, TaskSurvey } from './order';
import {
	decisionsOf, levelOf, LevelsFile, MAX_DECISION_ANSWER, MAX_DECISION_QUESTION, MAX_LEVEL_NOTE, MAX_USER_DECISIONS, openDecisions, parseLevels, parsePlan,
	parseRisk, Plan, PlanFile, PlanStep, RiskFile, UserLevel, writerOf,
} from './plan';
import type { Level } from './risk';
import { Gate, passGate, returnTo, Stage, START } from './stages';
import { Answer, AnswersFile, checkAnswer, EngineFile, parseAnswers, parseEngine, parseSurvey, Survey, SurveyFile, SurveyHook } from './survey';

// The session of Shotgun in a workspace: the tasks, the active task and its decisions. The store keeps the state in
// memory, so the guard decides with no file access. Each change goes to the stage files first, and then into memory.
// The store uses no VS Code API, so the unit tests can use it with a temporary folder.

export interface TaskSummary {
	readonly id: string;
	readonly title: string;
	readonly stage: Stage;
	readonly isDone: boolean;
	readonly created: string;
}

export interface Snapshot {
	readonly root: string | undefined; // the first workspace folder
	readonly task: TaskFile | undefined; // the active task
	readonly isPaused: boolean;
	readonly tasks: readonly TaskSummary[]; // all tasks, the newest first
	readonly decisions: readonly Decision[]; // the last decisions of the active task, the newest last
	readonly questions: readonly Question[]; // the questions of Claude about the brief of the active task
	readonly survey: SurveyFile | undefined; // the survey of Claude for the active task
	readonly engine: EngineFile | undefined; // the facts of DataFlow for the hooks of the survey
	readonly answers: Readonly<Record<string, Answer>>; // the answers of the user to the questions of the survey
	readonly order: OrderFile | undefined; // the order of the user in stage 3. undefined: the order of the survey
	readonly plan: PlanFile | undefined; // the plan of Claude in stage 4
	readonly risk: RiskFile | undefined; // the facts of DataFlow and the levels of the rules for the steps of the plan
	readonly levels: LevelsFile | undefined; // the levels and the notes of the user for the steps
	readonly build: BuildFile | undefined; // the state of the steps of the build in stage 5, and their receipts
	readonly callouts: CalloutsFile | undefined; // the callouts of the steps, and the answers of Claude about lines
	readonly loose: LooseFile | undefined; // the loose ends of the steps
	readonly message: MessageCheck | undefined; // the check of Claude of the commit message
	readonly problems: readonly string[]; // the stage files that Shotgun cannot read
}

// The start of a step of the build. base: the name of the mark of DataFlow. baseError: why the step has no base
export interface StepStart {
	readonly writer: BuildWriter;
	readonly level: Level | null;
	readonly scope: readonly string[];
	readonly newFiles?: readonly string[];
	readonly base?: string;
	readonly baseError?: string;
}

// A question of Claude before Shotgun gives it an id
export interface QuestionInput {
	readonly text: string;
	readonly part?: PartId;
	readonly quote?: string;
}

// The maximum number of decisions in memory. The file keeps all decisions
const MAX_DECISIONS = 500;
const MAX_TITLE = 200;

export class SessionStore {
	private state: Snapshot;
	private readonly events = new EventEmitter();

	constructor(private readonly root: string | undefined, private readonly now: () => Date = () => new Date()) {
		this.state = {
			root, task: undefined, isPaused: false, tasks: [], decisions: [], questions: [], survey: undefined, engine: undefined, answers: {},
			order: undefined, plan: undefined, risk: undefined, levels: undefined, build: undefined, callouts: undefined, loose: undefined, message: undefined,
			problems: [],
		};
	}

	// The file brief.md of a task, by default of the active task. undefined: no folder, or no active task
	briefFile(id = this.state.task?.id): string | undefined {
		return this.dir && id ? path.join(this.dir, id, BRIEF_FILE) : undefined;
	}

	get snapshot(): Snapshot {
		return this.state;
	}

	// The folder .shotgun, or undefined with no workspace folder
	get dir(): string | undefined {
		return this.root ? path.join(this.root, SHOTGUN_DIR) : undefined;
	}

	onDidChange(listener: (snapshot: Snapshot) => void): { dispose(): void } {
		this.events.on('change', listener);
		return { dispose: () => this.events.off('change', listener) };
	}

	// Reads the stage files again, for example after a change by a different window
	load(): void {
		const dir = this.dir;
		const problems: string[] = [];
		const tasks: TaskFile[] = [];
		if (dir && existsSync(dir)) {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (!entry.isDirectory() || !TASK_ID.test(entry.name)) {
					continue;
				}
				const text = readText(path.join(dir, entry.name, TASK_FILE));
				if (text === undefined) {
					continue;
				}
				try {
					tasks.push(parseTask(text, entry.name));
				} catch (error) {
					problems.push(messageOf(error));
				}
			}
		}
		tasks.sort((a, b) => b.created.localeCompare(a.created));

		let active: ActiveFile = { version: FILE_VERSION, task: null, isPaused: false };
		const activeText = dir ? readText(path.join(dir, ACTIVE_FILE)) : undefined;
		if (activeText !== undefined) {
			try {
				active = parseActive(activeText);
			} catch (error) {
				problems.push(messageOf(error));
			}
		}
		const task = active.task ? tasks.find((t) => t.id === active.task) : undefined;
		if (active.task && !task) {
			problems.push(`${ACTIVE_FILE} names the task ${active.task}, but its folder has no correct ${TASK_FILE}.`);
		}
		let decisions: Decision[] = [];
		let questions: readonly Question[] = [];
		let survey: SurveyFile | undefined;
		let engine: EngineFile | undefined;
		let answers: Readonly<Record<string, Answer>> = {};
		let order: OrderFile | undefined;
		let plan: PlanFile | undefined;
		let risk: RiskFile | undefined;
		let levels: LevelsFile | undefined;
		let build: BuildFile | undefined;
		let callouts: CalloutsFile | undefined;
		let loose: LooseFile | undefined;
		let message: MessageCheck | undefined;
		// a stage file that is there, but that Shotgun cannot read, is a problem
		const readFile = <T>(name: string, parse: (text: string, id: string) => T): T | undefined => {
			const text = task && dir ? readText(path.join(dir, task.id, name)) : undefined;
			if (text === undefined) {
				return undefined;
			}
			try {
				return parse(text, task!.id);
			} catch (error) {
				problems.push(messageOf(error));
				return undefined;
			}
		};
		if (task && dir) {
			survey = readFile(SURVEY_FILE, parseSurvey);
			engine = readFile(ENGINE_FILE, parseEngine);
			answers = readFile(ANSWERS_FILE, parseAnswers)?.answers ?? {};
			order = readFile(ORDER_FILE, parseOrder);
			plan = readFile(PLAN_FILE, parsePlan);
			risk = readFile(RISK_FILE, parseRisk);
			levels = readFile(LEVELS_FILE, parseLevels);
			build = readFile(BUILD_FILE, parseBuild);
			callouts = readFile(CALLOUTS_FILE, parseCallouts);
			loose = readFile(LOOSE_FILE, parseLoose);
			message = readFile(MESSAGE_FILE, parseMessageCheck);
			const parsed = parseDecisions(readText(path.join(dir, task.id, DECISIONS_FILE)) ?? '');
			decisions = parsed.decisions.slice(-MAX_DECISIONS);
			if (parsed.invalid > 0) {
				problems.push(`${task.id}/${DECISIONS_FILE} has ${parsed.invalid} lines that are not correct. Shotgun ignores them.`);
			}
			const questionsText = readText(path.join(dir, task.id, QUESTIONS_FILE));
			if (questionsText !== undefined) {
				try {
					questions = parseQuestions(questionsText, task.id).questions;
				} catch (error) {
					problems.push(messageOf(error));
				}
			}
		}
		this.set({
			root: this.root,
			task,
			isPaused: task ? active.isPaused : false,
			tasks: tasks.map(({ id, title, stage, isDone, created }) => ({ id, title, stage, isDone, created })),
			decisions,
			questions,
			survey,
			engine,
			answers,
			order,
			plan,
			risk,
			levels,
			build,
			callouts,
			loose,
			message,
			problems,
		});
	}

	// The current step of the build: the first step of the plan that is not done
	get current(): CurrentStep | undefined {
		const { plan, risk, levels, build } = this.state;
		return currentStep(plan, risk, levels, build);
	}

	// The order of the active task: order.json, else the tasks of the survey in their sequence
	get order(): Order {
		return orderOf(this.state.order, this.state.survey);
	}

	// Makes a new task in stage 1 and makes it the active task, with brief.md from the template. by: the user with the
	// command, or Claude with a tool. brief: the brief that Claude gives from the chat, with the number of the lines of
	// the user, in the place of the template
	newTask(title: string, by: 'user' | 'claude' = 'user', brief?: { text: string; lines: number }): TaskFile {
		const dir = this.requireDir();
		const text = title.trim().replace(/\s+/g, ' ');
		if (!text) {
			throw new Error('Give a title for the task.');
		}
		if (text.length > MAX_TITLE) {
			throw new Error(`The title has more than ${MAX_TITLE} characters. Give a shorter title.`);
		}
		const taken = new Set(existsSync(dir) ? readdirSync(dir).map((n) => n.toLowerCase()) : []);
		const id = taskIdOf(text, taken);
		const task: TaskFile = { version: FILE_VERSION, id, title: text, created: this.time(), ...START };
		writeTextAtomic(path.join(dir, id, TASK_FILE), jsonText(task));
		writeTextAtomic(path.join(dir, id, BRIEF_FILE), brief?.text ?? briefTemplate(text));
		this.append(id, { kind: 'task', by, title: text });
		if (brief) {
			this.append(id, { kind: 'brief', by: 'claude', lines: brief.lines });
		}
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: id, isPaused: false } satisfies ActiveFile));
		this.load();
		return task;
	}

	// Writes the brief that Claude gives from the chat into the active task. lines: the number of the lines of the user
	writeBrief(text: string, lines: number): void {
		const task = this.requireTask();
		writeTextAtomic(this.briefFile(task.id)!, text);
		this.append(task.id, { kind: 'brief', by: 'claude', lines });
		this.load();
	}

	// Gives the questions of Claude about the brief to the active task. The new questions replace the open questions.
	// The closed questions stay. The result: the new questions with their ids
	setQuestions(inputs: readonly QuestionInput[]): Question[] {
		const dir = this.requireDir();
		const task = this.requireTask();
		const old = this.state.questions;
		let next = old.reduce((max, q) => Math.max(max, Number.parseInt(q.id.slice(1), 10) || 0), 0) + 1;
		const created = this.time();
		const added: Question[] = inputs.map((q) => ({
			id: `q${next++}`, text: q.text, ...(q.part ? { part: q.part } : {}), ...(q.quote ? { quote: q.quote } : {}), state: 'open', created,
		}));
		const questions = [...old.filter((q) => q.state === 'closed'), ...added];
		writeTextAtomic(path.join(dir, task.id, QUESTIONS_FILE), jsonText({ version: FILE_VERSION, questions }));
		this.append(task.id, { kind: 'questions', by: 'claude', count: added.length });
		this.load();
		return added;
	}

	// Writes the survey of Claude for the active task. A new survey replaces the old survey. The answers of the user
	// stay with the ids of their questions
	writeSurvey(survey: Survey): SurveyFile {
		const dir = this.requireDir();
		const task = this.requireTask();
		const file: SurveyFile = { version: FILE_VERSION, time: this.time(), ...survey };
		writeTextAtomic(path.join(dir, task.id, SURVEY_FILE), jsonText(file));
		this.append(task.id, {
			kind: 'survey', by: 'claude', tasks: survey.tasks.length, hooks: survey.hooks.length, facts: survey.facts.length, questions: survey.questions.length,
		});
		this.load();
		return file;
	}

	// Writes the facts of DataFlow for the hooks of the survey of the active task
	writeEngine(engine: Omit<EngineFile, 'version' | 'time'>): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		writeTextAtomic(path.join(dir, task.id, ENGINE_FILE), jsonText({ version: FILE_VERSION, time: this.time(), ...engine } satisfies EngineFile));
		this.load();
	}

	// The answer of the user to a question of the survey. An empty answer removes the answer
	setAnswer(id: string, text: string): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		if (!this.state.survey?.questions.some((q) => q.id === id)) {
			throw new Error(`The survey of the active task has no question ${id}.`);
		}
		const answer = checkAnswer(text);
		const answers: Record<string, Answer> = { ...this.state.answers };
		if (answer) {
			answers[id] = { text: answer, time: this.time() };
		} else {
			delete answers[id];
		}
		writeTextAtomic(path.join(dir, task.id, ANSWERS_FILE), jsonText({ version: FILE_VERSION, answers } satisfies AnswersFile));
		this.append(task.id, { kind: 'answer', by: 'user', id, text: answer });
		this.load();
	}

	// 1 edit of the user in stage 3. The ledger records each edit. The result: the task of the edit, after the edit
	editOrder(edit: OrderEdit): OrderTask {
		const task = this.requireStage('order', 'You can change the order only in stage 3, the order.');
		const before = edit.action === 'add' ? undefined : this.order.tasks.find((t) => t.id === edit.id);
		const { order, task: changed, position } = applyEdit(this.order, edit, surveyIds(this.state.survey));
		// an edit with no change is not a decision
		if (before && ((edit.action === 'text' && before.text === changed.text) || (edit.action === 'later' && before.isLater === edit.isLater))) {
			return before;
		}
		this.writeOrder(task.id, order);
		const action = edit.action === 'later' ? (edit.isLater ? 'later' : 'now') : edit.action;
		this.append(task.id, { kind: 'order', by: 'user', action, task: changed.id, text: changed.text, ...(edit.action === 'move' ? { position } : {}) });
		this.load();
		return changed;
	}

	// The survey of Claude for 1 task of the order in stage 3. The new hooks go into survey.json, after the hooks of stage 2
	// In stage 4, Claude surveys a task with no survey before the plan
	writeTaskSurvey(id: string, survey: Omit<TaskSurvey, 'time'>, newHooks: readonly SurveyHook[]): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		if (task.isDone || (task.stage !== 'order' && task.stage !== 'plan')) {
			throw new Error('Claude surveys a task of the order only in the stages 3 and 4.');
		}
		const current = this.state.survey;
		if (!current) {
			throw new Error('The active task has no survey.');
		}
		const order = this.order;
		if (!order.tasks.some((t) => t.id === id)) {
			throw new Error(`The order has no task ${id}.`);
		}
		if (newHooks.length > 0) {
			writeTextAtomic(path.join(dir, task.id, SURVEY_FILE), jsonText({ ...current, hooks: [...current.hooks, ...newHooks] } satisfies SurveyFile));
		}
		const time = this.time();
		this.writeOrder(task.id, { ...order, tasks: order.tasks.map((t) => (t.id === id ? { ...t, survey: { ...survey, time } } : t)) });
		this.append(task.id, { kind: 'task-survey', by: 'claude', task: id, hooks: survey.hooks.length, needs: survey.needs.length });
		this.load();
	}

	// The gate of stage 3, "Accept the order". order.json keeps the order that the user accepted
	acceptOrder(): TaskFile {
		const task = this.requireStage('order', 'The active task is not in stage 3, the order.');
		this.writeOrder(task.id, this.order);
		return this.passGate('accept-order');
	}

	// The plan of Claude for the active task in stage 4. A new plan replaces the old plan. The levels of the user stay
	// with the ids of their steps. After a return from the build (decision 24), the build keeps the state of each step
	// with the same id and the same title in the new plan. The result: the plan, and the other steps of the build with
	// their bases, so that the caller deletes the marks of the bases
	writePlan(plan: Plan): { file: PlanFile; removed: { id: string; step: BuildStep }[] } {
		const dir = this.requireDir();
		const task = this.requireStage('plan', 'Claude gives the plan only in stage 4, the plan.');
		const old = this.state.plan?.steps ?? [];
		const isKept = (id: string) => {
			const before = old.find((s) => s.id === id);
			return !!before && plan.steps.some((s) => s.id === id && s.title === before.title);
		};
		const removed = Object.entries(this.state.build?.steps ?? {}).filter(([id]) => !isKept(id)).map(([id, step]) => ({ id, step }));
		const file: PlanFile = { version: FILE_VERSION, time: this.time(), steps: plan.steps };
		writeTextAtomic(path.join(dir, task.id, PLAN_FILE), jsonText(file));
		if (removed.length > 0) {
			const steps: Record<string, BuildStep> = { ...(this.state.build?.steps ?? {}) };
			removed.forEach((r) => delete steps[r.id]);
			writeTextAtomic(path.join(dir, task.id, BUILD_FILE), jsonText({ version: FILE_VERSION, steps } satisfies BuildFile));
		}
		this.append(task.id, { kind: 'plan', by: 'claude', steps: plan.steps.length });
		this.load();
		return { file, removed };
	}

	// The facts of DataFlow and the levels of the rules for the steps of the plan of the active task
	writeRisk(risk: Omit<RiskFile, 'version' | 'time'>): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		writeTextAtomic(path.join(dir, task.id, RISK_FILE), jsonText({ version: FILE_VERSION, time: this.time(), ...risk } satisfies RiskFile));
		this.load();
	}

	// The level of the user for a step. undefined: the level of the rules again. The ledger records each change with the
	// level of the rules at that time. In stage 5, the user changes the level of a step that Claude did not start, also of
	// the current step of the user (decision 17). Then the step starts again with the writer of its new level. The result:
	// the old state of the step in the build, for example with its base, or undefined
	setLevel(step: string, level: Level | undefined): BuildStep | undefined {
		const task = this.requireLevelStage(step);
		const old = this.state.levels?.levels[step];
		if (old?.level === level) {
			return undefined;
		}
		const removed = task.stage === 'build' ? this.state.build?.steps[step] : undefined;
		const rule = levelOf(this.requireStep(step), this.state.risk, this.state.levels).rule;
		this.writeLevel(task.id, step, level, old?.note);
		if (removed) {
			this.removeStep(task.id, step);
		}
		this.append(task.id, { kind: 'level', by: 'user', step, level: level ?? null, rule });
		this.load();
		return removed;
	}

	// The answer of the user to a decision of a step (P29). An empty text opens the decision again. With no open decision,
	// the level of the rules is at most 2 (decision 31), so an answer can change the writer. In stage 5, the user answers
	// only for a step that Claude did not start, and a new writer starts the step again (decision 17). The result: the old
	// state of the step in the build, or undefined
	answerDecision(step: string, decision: string, text: string): BuildStep | undefined {
		const task = this.requireLevelStage(step);
		const planStep = this.requireStep(step);
		const found = decisionsOf(planStep, this.state.levels)?.find((d) => d.id === decision);
		if (!found) {
			throw new Error(`Step ${step} has no decision ${decision}.`);
		}
		const answer = text.trim().replace(/\s+/g, ' ');
		if (answer.length > MAX_DECISION_ANSWER) {
			throw new Error(`An answer has a maximum of ${MAX_DECISION_ANSWER} characters.`);
		}
		if ((found.answer ?? '') === answer) {
			return undefined;
		}
		const old = this.state.levels?.levels[step];
		const answers = { ...(old?.answers ?? {}) };
		if (answer) {
			answers[decision] = { question: found.question, text: answer, time: this.time() };
		} else {
			delete answers[decision];
		}
		return this.changeDecisions(task, planStep, { ...old, answers }, {
			kind: 'decision', by: 'user', step, decision, action: answer ? 'answer' : 'open', question: found.question, ...(answer ? { text: answer } : {}),
		});
	}

	// A decision that the user adds to a step (P29). It is open, so the step keeps the level of the heat
	addDecision(step: string, question: string): BuildStep | undefined {
		const task = this.requireLevelStage(step);
		const planStep = this.requireStep(step);
		if (!planStep.decisions) {
			throw new Error(`Step ${step} comes from a plan with no decisions. Ask Claude for a new plan first.`);
		}
		const text = question.trim().replace(/\s+/g, ' ');
		if (!text || text.length > MAX_DECISION_QUESTION) {
			throw new Error(`A decision needs a question of 1 to ${MAX_DECISION_QUESTION} characters.`);
		}
		const old = this.state.levels?.levels[step];
		const added = old?.added ?? [];
		if (added.length >= MAX_USER_DECISIONS) {
			throw new Error(`A step has a maximum of ${MAX_USER_DECISIONS} decisions of yours.`);
		}
		if ((decisionsOf(planStep, this.state.levels) ?? []).some((d) => d.question.toLowerCase() === text.toLowerCase())) {
			throw new Error(`Step ${step} has the decision "${text}" already.`);
		}
		const id = `U${Math.max(0, ...added.map((d) => Number.parseInt(d.id.slice(1), 10) || 0)) + 1}`;
		return this.changeDecisions(task, planStep, { ...old, added: [...added, { id, question: text, time: this.time() }] }, {
			kind: 'decision', by: 'user', step, decision: id, action: 'add', question: text,
		});
	}

	// Removes a decision that the user added, with its answer
	removeDecision(step: string, decision: string): BuildStep | undefined {
		const task = this.requireLevelStage(step);
		const planStep = this.requireStep(step);
		const old = this.state.levels?.levels[step];
		const found = old?.added?.find((d) => d.id === decision);
		if (!found) {
			throw new Error(`Step ${step} has no decision ${decision} of yours. Only a decision that you added can go.`);
		}
		const answers = { ...(old?.answers ?? {}) };
		delete answers[decision];
		return this.changeDecisions(task, planStep, { ...old, answers, added: old!.added!.filter((d) => d.id !== decision) }, {
			kind: 'decision', by: 'user', step, decision, action: 'remove', question: found.question,
		});
	}

	// Writes the decisions of the user for a step, and records the change. In stage 5, a step with a new writer starts again
	private changeDecisions(task: TaskFile, step: PlanStep, value: Partial<UserLevel>, decision: DecisionInput): BuildStep | undefined {
		const before = writerOf(levelOf(step, this.state.risk, this.state.levels).level);
		const next = this.userLevel(step.id, value);
		const levels: LevelsFile = { version: FILE_VERSION, levels: next };
		const after = writerOf(levelOf(step, this.state.risk, levels).level);
		const removed = task.stage === 'build' && before !== after ? this.state.build?.steps[step.id] : undefined;
		writeTextAtomic(path.join(this.requireDir(), task.id, LEVELS_FILE), jsonText(levels));
		if (removed) {
			this.removeStep(task.id, step.id);
		}
		this.append(task.id, decision);
		this.load();
		return removed;
	}

	// The note of the user for a step, for example the reason of a different level. An empty note removes the note
	setLevelNote(step: string, note: string): void {
		const task = this.requireTask();
		if (task.isDone || (task.stage !== 'plan' && task.stage !== 'build')) {
			throw new Error('You can change a note only in stage 4, the plan, and in stage 5, the build.');
		}
		this.requireStep(step);
		const text = note.trim().replace(/\s+/g, ' ');
		if (text.length > MAX_LEVEL_NOTE) {
			throw new Error(`A note has a maximum of ${MAX_LEVEL_NOTE} characters.`);
		}
		const old = this.state.levels?.levels[step];
		if ((old?.note ?? '') === text) {
			return;
		}
		this.writeLevel(task.id, step, old?.level, text || undefined);
		this.append(task.id, { kind: 'level-note', by: 'user', step, text });
		this.load();
	}

	// The gate of stage 4, "Accept the plan". The levels and the notes of the user are in the ledger already
	acceptPlan(): TaskFile {
		this.requireStage('plan', 'The active task is not in stage 4, the plan.');
		if (!this.state.plan) {
			throw new Error('The active task has no plan. Ask Claude for the plan first.');
		}
		return this.passGate('accept-plan');
	}

	// Opens the current step of the build: Claude opens an errand, or Shotgun opens a step of the user. Claude can open its
	// step again after the receipt, for example to fix an issue. Then the step keeps its base and the old receipt until
	// the new receipt
	startStep(id: string, start: StepStart): BuildStep {
		const task = this.requireStage('build', 'A step opens only in stage 5, the build.');
		const current = this.requireCurrent(id);
		const old = current.build;
		if (current.state === 'open') {
			throw new Error(`Step ${current.n} is open already.`);
		}
		if ((current.state === 'receipt' && start.writer !== 'claude') || (current.state === 'holes' && start.writer !== 'frame')) {
			throw new Error(`Step ${current.n} has ${current.state === 'receipt' ? 'a receipt' : 'a frame'} of Claude.`);
		}
		// the writer can change while a step opens, for example after "I want a frame" or a different level
		if (start.writer !== current.writer) {
			throw new Error(`Step ${current.n} changed while it opened. Its writer is ${current.writer} now, not ${start.writer}.`);
		}
		// Claude opens a step again after its receipt, or for a different frame
		const isAgain = current.state === 'receipt' || current.state === 'holes';
		const base = isAgain ? old?.base : start.base;
		const baseError = isAgain ? old?.baseError : start.baseError;
		const newFiles = isAgain ? old?.newFiles : start.newFiles;
		const step: BuildStep = {
			state: 'open',
			writer: start.writer,
			level: start.level,
			scope: [...start.scope],
			...(newFiles && newFiles.length > 0 ? { newFiles: [...newFiles] } : {}),
			...(base ? { base } : {}),
			...(baseError ? { baseError } : {}),
			round: start.writer === 'user' ? 0 : (old?.round ?? 0) + 1,
			opened: this.time(),
			...(old?.receipt ? { receipt: old.receipt } : {}),
			...(old?.holes ? { holes: old.holes } : {}),
			...(old?.frameNote ? { frameNote: old.frameNote } : {}),
			// only a frame keeps the request of the user
			...(old?.isFrameRequested && start.writer === 'frame' ? { isFrameRequested: true } : {}),
		};
		this.writeStep(task.id, id, step);
		if (start.writer !== 'user') {
			this.append(task.id, { kind: 'step', by: 'claude', step: id, round: step.round });
		}
		this.load();
		return step;
	}

	// The receipt of an errand of Claude. The scope of the step closes, and the user walks the receipt
	writeReceipt(id: string, receipt: Receipt): void {
		const task = this.requireStage('build', 'A receipt comes only in stage 5, the build.');
		const current = this.requireCurrent(id);
		if (current.state !== 'open' || current.writer !== 'claude') {
			throw new Error(`Step ${current.n} is not open for Claude.`);
		}
		this.writeStep(task.id, id, { ...current.build!, state: 'receipt', receipt });
		const counts = receiptCounts(receipt);
		this.append(task.id, {
			kind: 'errand', by: 'claude', step: id, round: receipt.round, changes: counts.changes, added: counts.added, removed: counts.removed,
			looseEnds: receipt.looseEnds.length,
		});
		this.load();
	}

	// The user selects "I want a frame" for the current step of level 4 (decision 16). The step of the user starts again as a
	// frame of Claude. The result: the old state of the step, for example with the base of the step of the user
	requestFrame(id: string): BuildStep | undefined {
		const task = this.requireStage('build', 'A frame is only for stage 5, the build.');
		const current = this.requireCurrent(id);
		if (current.level !== 4) {
			throw new Error(`Step ${current.n} has risk level ${current.level ?? '?'}. A frame on request is only for a step of level 4. Level 3 has a frame always.`);
		}
		if (current.writer !== 'user' || (current.state !== 'todo' && current.state !== 'open')) {
			throw new Error(`Step ${current.n} is not a step of the user that Claude can frame now.`);
		}
		// each open decision is a hole of the frame (decision 32)
		if (decisionsOf(current.step, this.state.levels) && openDecisions(current.step, this.state.levels).length === 0) {
			throw new Error(`Step ${current.n} has no open decision, so a frame has no hole. Add a decision on the plan page first.`);
		}
		const old = current.build;
		this.writeStep(task.id, id, { state: 'todo', writer: 'frame', level: current.level, scope: [...(old?.scope ?? scopeOf(current.step))], round: 0, isFrameRequested: true });
		this.append(task.id, { kind: 'frame-request', by: 'user', step: id });
		this.load();
		return old;
	}

	// The frame of Claude for the open step: the holes with their hints. The scope closes, and the user fills the holes
	writeFrame(id: string, holes: readonly Omit<Hole, 'shown'>[], note: string | undefined): void {
		const task = this.requireStage('build', 'A frame comes only in stage 5, the build.');
		const current = this.requireCurrent(id);
		if (current.state !== 'open' || current.writer !== 'frame' || !current.build) {
			throw new Error(`Step ${current.n} is not open for a frame of Claude.`);
		}
		const { frameNote: _old, ...rest } = current.build;
		this.writeStep(task.id, id, { ...rest, state: 'holes', holes: holes.map((h) => ({ ...h, shown: 0 })), ...(note ? { frameNote: note } : {}) });
		this.append(task.id, { kind: 'frame', by: 'claude', step: id, round: current.build.round, holes: holes.length });
		this.load();
	}

	// The user opens the hints of a hole up to a level, from 1 to 4. Level 4 is the answer of Claude
	setHint(id: string, hole: number, level: number): Hole {
		const task = this.requireStage('build', 'A hint is only in stage 5, the build.');
		const current = this.requireCurrent(id);
		const found = current.build?.holes?.find((h) => h.n === hole);
		if (current.state !== 'holes' || !current.build || !found) {
			throw new Error(`Step ${current.n} has no hole ${hole} to fill now.`);
		}
		if (!Number.isInteger(level) || level < 1 || level > 4) {
			throw new Error('A hint level is from 1 to 4.');
		}
		if (level <= found.shown) {
			return found;
		}
		const next = { ...found, shown: level };
		this.writeStep(task.id, id, { ...current.build, holes: current.build.holes!.map((h) => (h === found ? next : h)) });
		this.append(task.id, { kind: 'hint', by: 'user', step: id, hole, level });
		this.load();
		return next;
	}

	// The facts of DataFlow at the start of a step of the user or of the holes of a frame. A callout needs a fact that
	// is not in these keys
	startCallouts(step: string, keys: readonly string[]): void {
		const task = this.requireStage('build', 'Callouts are only for stage 5, the build.');
		const file = this.state.callouts ?? EMPTY_CALLOUTS;
		const value: StepCallouts = { started: this.time(), startKeys: [...new Set(keys)], callouts: [], nextId: 1 };
		this.writeCalloutsFile(task.id, { ...file, steps: { ...file.steps, [step]: value } });
		this.load();
	}

	// The callouts of a step after a check of the facts. The ledger does not record a check: it is no decision
	writeStepCallouts(step: string, value: StepCallouts): void {
		const task = this.requireStage('build', 'Callouts are only for stage 5, the build.');
		const file = this.state.callouts ?? EMPTY_CALLOUTS;
		this.writeCalloutsFile(task.id, { ...file, steps: { ...file.steps, [step]: value } });
		this.load();
	}

	// "Not a problem": the user closes a callout with a reason, or opens it again with no reason
	closeCallout(step: string, id: string, reason: string | undefined): void {
		const task = this.requireStage('build', 'Callouts are only for stage 5, the build.');
		const { file, value, callout } = this.requireCallout(step, id);
		const text = (reason ?? '').trim().replace(/\s+/g, ' ');
		if (reason !== undefined && (!text || text.length > MAX_CHANGE_NOTE)) {
			throw new Error(`Give a reason of 1 to ${MAX_CHANGE_NOTE} characters. The ledger keeps it.`);
		}
		const callouts = value.callouts.map((c) => {
			if (c !== callout) {
				return c;
			}
			const { closed: _old, ...rest } = c;
			return reason !== undefined ? { ...rest, closed: { reason: text, time: this.time() } } : rest;
		});
		this.writeCalloutsFile(task.id, { ...file, steps: { ...file.steps, [step]: { ...value, callouts } } });
		this.append(task.id, reason !== undefined
			? { kind: 'callout-close', by: 'user', step, callout: id, title: callout.title, reason: text }
			: { kind: 'callout-open', by: 'user', step, callout: id });
		this.load();
	}

	// The words of Claude for a callout
	setExplanation(step: string, id: string, text: string): void {
		const task = this.requireStage('build', 'Callouts are only for stage 5, the build.');
		const { file, value, callout } = this.requireCallout(step, id);
		const callouts = value.callouts.map((c) => (c === callout ? { ...c, explanation: { text, time: this.time() } } : c));
		this.writeCalloutsFile(task.id, { ...file, steps: { ...file.steps, [step]: { ...value, callouts } } });
		this.append(task.id, { kind: 'explanation', by: 'claude', step, callout: id });
		this.load();
	}

	// The answer of Claude to a question of the user about a line. The result: the answer with its id
	addLineAnswer(answer: Omit<LineAnswer, 'id' | 'time'>): LineAnswer {
		const task = this.requireStage('build', 'The answers on a line are only for stage 5, the build.');
		const file = this.state.callouts ?? EMPTY_CALLOUTS;
		const next = file.answers.reduce((max, a) => Math.max(max, Number.parseInt(a.id.slice(1), 10) || 0), 0) + 1;
		const value: LineAnswer = { id: `A${next}`, ...answer, time: this.time() };
		this.writeCalloutsFile(task.id, { ...file, answers: [...file.answers, value] });
		this.append(task.id, { kind: 'line-answer', by: 'claude', answer: value.id, file: value.file, line: value.line, question: value.question });
		this.load();
		return value;
	}

	// The user resolves a question about a line
	resolveAnswer(id: string): void {
		const task = this.requireStage('build', 'The answers on a line are only for stage 5, the build.');
		const file = this.state.callouts ?? EMPTY_CALLOUTS;
		const found = file.answers.find((a) => a.id === id);
		if (!found) {
			throw new Error(`The task has no answer ${id}.`);
		}
		if (found.resolved) {
			return;
		}
		this.writeCalloutsFile(task.id, { ...file, answers: file.answers.map((a) => (a === found ? { ...a, resolved: this.time() } : a)) });
		this.append(task.id, { kind: 'line-resolve', by: 'user', answer: id });
		this.load();
	}

	// The loose ends of a step at its gate (phase 9). The engine finds them, so the ledger records no decision
	addLooseEnds(step: string, finds: readonly LooseFind[]): void {
		const task = this.requireStage('build', 'The loose ends are only for stage 5, the build.');
		this.writeLooseFile(task.id, addLooseEnds(this.state.loose ?? EMPTY_LOOSE, step, finds, this.time()));
		this.load();
	}

	// The user hands a loose end to Claude (decision 21): it becomes the next step of the plan, with risk level 2. The
	// result: the new step
	handLooseEnd(id: string): PlanStep {
		const task = this.requireStage('build', 'The loose ends are only for stage 5, the build.');
		const plan = this.state.plan;
		if (!plan) {
			throw new Error('The active task has no plan.');
		}
		const end = this.requireLooseEnd(id);
		if (end.state !== 'open') {
			throw new Error(end.state === 'handed' ? `The loose end ${id} is step ${end.handed} of Claude already.` : `The loose end ${id} is closed. Open it again first.`);
		}
		if (end.kind !== 'mechanical') {
			throw new Error(`The loose end ${id} is a decision for you, not a step for Claude. Close it with your reason.`);
		}
		const source = plan.steps.find((s) => s.id === end.step);
		const step = looseStep(end, nextLooseStepId(plan.steps), source?.task ?? plan.steps[0]?.task ?? '');
		const steps = [...plan.steps];
		steps.splice(looseIndex(steps, (s) => stateOf(this.state.build, s)), 0, step);
		writeTextAtomic(path.join(this.requireDir(), task.id, PLAN_FILE), jsonText({ version: FILE_VERSION, time: this.time(), steps } satisfies PlanFile));
		this.writeLevel(task.id, step.id, 2, `A loose end of step ${end.step}.`);
		const file = this.state.loose ?? EMPTY_LOOSE;
		this.writeLooseFile(task.id, { ...file, ends: file.ends.map((e) => (e.id === id ? { ...e, state: 'handed' as const, handed: step.id } : e)) });
		this.append(task.id, { kind: 'loose-hand', by: 'user', end: id, step: step.id, title: end.title });
		this.load();
		return step;
	}

	// The user closes a loose end with a reason, or opens it again with no reason
	closeLooseEnd(id: string, reason: string | undefined): void {
		const task = this.requireStage('build', 'The loose ends are only for stage 5, the build.');
		const end = this.requireLooseEnd(id);
		const file = this.state.loose ?? EMPTY_LOOSE;
		if (reason === undefined) {
			if (end.state !== 'closed') {
				return;
			}
			const { reason: _reason, ...open } = end;
			this.writeLooseFile(task.id, { ...file, ends: file.ends.map((e) => (e.id === id ? { ...open, state: 'open' as const } : e)) });
			this.append(task.id, { kind: 'loose-open', by: 'user', end: id });
		} else {
			const text = reason.trim().replace(/\s+/g, ' ');
			if (!text || text.length > MAX_LOOSE_REASON) {
				throw new Error(`Give a reason of 1 to ${MAX_LOOSE_REASON} characters.`);
			}
			if (end.state === 'handed') {
				throw new Error(`The loose end ${id} is step ${end.handed} of Claude.`);
			}
			this.writeLooseFile(task.id, { ...file, ends: file.ends.map((e) => (e.id === id ? { ...e, state: 'closed' as const, reason: text } : e)) });
			this.append(task.id, { kind: 'loose-close', by: 'user', end: id, title: end.title, reason: text });
		}
		this.load();
	}

	// The check of Claude of the commit message, in stage 5 or after the gate "The task is done". A new check replaces the
	// old check
	writeMessageCheck(check: Omit<MessageCheck, 'version' | 'time'>): MessageCheck {
		const task = this.requireTask();
		if (task.stage !== 'build') {
			throw new Error('Claude checks the commit message only in stage 5, the build, or after the end of the task.');
		}
		const value: MessageCheck = { version: FILE_VERSION, ...check, time: this.time() };
		writeTextAtomic(path.join(this.requireDir(), task.id, MESSAGE_FILE), jsonText(value));
		this.append(task.id, { kind: 'message-check', by: 'claude', agrees: value.agrees, points: value.points.length });
		this.load();
		return value;
	}

	// The mark of the user on a change of the receipt of the current step
	setMark(id: string, change: string, mark: ChangeMark): void {
		const { task, step, receipt, found } = this.requireChange(id, change);
		if (found.mark === mark) {
			return;
		}
		const changes = receipt.changes.map((c) => (c === found ? { ...c, mark, markTime: this.time() } : c));
		this.writeStep(task.id, id, { ...step, receipt: { ...receipt, changes } });
		this.append(task.id, { kind: 'mark', by: 'user', step: id, change, mark });
		this.load();
	}

	// The note of the user for a change of the receipt of the current step. An empty note removes the note
	setChangeNote(id: string, change: string, note: string): void {
		const { task, step, receipt, found } = this.requireChange(id, change);
		const text = note.trim().replace(/\s+/g, ' ');
		if (text.length > MAX_CHANGE_NOTE) {
			throw new Error(`A note has a maximum of ${MAX_CHANGE_NOTE} characters.`);
		}
		if ((found.userNote ?? '') === text) {
			return;
		}
		const changes = receipt.changes.map((c) => {
			if (c !== found) {
				return c;
			}
			const { userNote: _old, ...rest } = c;
			return text ? { ...rest, userNote: text } : rest;
		});
		this.writeStep(task.id, id, { ...step, receipt: { ...receipt, changes } });
		this.append(task.id, { kind: 'change-note', by: 'user', step: id, change, text });
		this.load();
	}

	// The gate of a step: the user accepts the receipt of Claude, or the user ends a step of the user. The next step of
	// the plan is then the current step
	finishStep(id: string, gate: StepGate): BuildStep {
		const task = this.requireStage('build', 'A step ends only in stage 5, the build.');
		const current = this.requireCurrent(id);
		if (gate === 'accept-receipt' && current.state !== 'receipt') {
			throw new Error(`Step ${current.n} has no receipt to accept.`);
		}
		if (gate === 'step-done' && !((current.writer === 'user' && current.state === 'open') || (current.writer === 'frame' && current.state === 'holes'))) {
			throw new Error(`Step ${current.n} is not an open step of the user, and it has no frame to fill.`);
		}
		const step: BuildStep = { ...current.build!, state: 'done', done: this.time() };
		this.writeStep(task.id, id, step);
		const counts = receiptCounts(current.build?.receipt);
		this.append(task.id, { kind: 'step-gate', by: 'user', step: id, gate, notWalked: counts.changes - counts.walked });
		this.load();
		return step;
	}

	// The user closes a question of Claude, for example after the answer in the brief
	closeQuestion(id: string): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		const question = this.state.questions.find((q) => q.id === id && q.state === 'open');
		if (!question) {
			throw new Error(`The active task has no open question ${id}.`);
		}
		const closed = this.time();
		const questions = this.state.questions.map((q) => (q === question ? { ...q, state: 'closed' as const, closed } : q));
		writeTextAtomic(path.join(dir, task.id, QUESTIONS_FILE), jsonText({ version: FILE_VERSION, questions }));
		this.append(task.id, { kind: 'question', by: 'user', id, text: question.text });
		this.load();
	}

	// Makes a task of the workspace the active task. The guard is on for it
	openTask(id: string): TaskFile {
		const dir = this.requireDir();
		const task = this.state.tasks.find((t) => t.id === id);
		if (!task) {
			throw new Error(`The workspace has no task ${id}.`);
		}
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: id, isPaused: false } satisfies ActiveFile));
		this.load();
		return this.requireTask();
	}

	// Stops the guard for work outside of the task, or starts it again. The ledger records each change
	setPaused(isPaused: boolean): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		if (this.state.isPaused === isPaused) {
			return;
		}
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: task.id, isPaused } satisfies ActiveFile));
		this.append(task.id, { kind: isPaused ? 'pause' : 'continue', by: 'user' });
		this.load();
	}

	// The user returns the active task to an earlier stage, also a done task (decision 24). The work of the later stages
	// stays. An open step of the build goes back to todo, and its changes stay in the files (decision 25). The result: the
	// task, and the removed step with its base, so that the extension deletes the mark of the base
	returnToStage(stage: Stage): { task: TaskFile; removed?: { id: string; step: BuildStep } } {
		const dir = this.requireDir();
		const task = this.requireTask();
		const progress = returnTo(task, stage);
		const open = Object.entries(this.state.build?.steps ?? {}).find(([, s]) => s.state === 'open');
		if (open) {
			this.removeStep(task.id, open[0]);
		}
		const next: TaskFile = { ...task, ...progress, returned: this.time() };
		writeTextAtomic(path.join(dir, task.id, TASK_FILE), jsonText(next));
		this.append(task.id, { kind: 'return', by: 'user', from: task.stage, to: stage, ...(open ? { step: open[0] } : {}) });
		this.load();
		return { task: next, ...(open ? { removed: { id: open[0], step: open[1] } } : {}) };
	}

	// Records a gate of the user: the active task goes to the next stage, or it is done after the last gate
	passGate(gate: Gate): TaskFile {
		const dir = this.requireDir();
		const task = this.requireTask();
		const progress = passGate(task, gate, this.time());
		const next: TaskFile = { ...task, ...progress };
		writeTextAtomic(path.join(dir, task.id, TASK_FILE), jsonText(next));
		this.append(task.id, { kind: 'gate', by: 'user', gate, stage: task.stage });
		this.load();
		return next;
	}

	// Records a deny of the guard in the ledger of the active task. This is the fast path of the guard: it reads no file
	recordDeny(tool: string, file: string, reason: string): void {
		const task = this.state.task;
		if (!task) {
			return;
		}
		const decision = this.append(task.id, { kind: 'deny', by: 'guard', tool, file, reason });
		this.set({ ...this.state, decisions: [...this.state.decisions, decision].slice(-MAX_DECISIONS) });
	}

	private append(id: string, input: DecisionInput): Decision {
		const decision = { version: FILE_VERSION, time: this.time(), ...input } as Decision;
		const file = path.join(this.requireDir(), id, DECISIONS_FILE);
		mkdirSync(path.dirname(file), { recursive: true });
		appendFileSync(file, decisionLine(decision));
		return decision;
	}

	private set(next: Snapshot): void {
		const isChanged = JSON.stringify(next) !== JSON.stringify(this.state);
		this.state = next;
		if (isChanged) {
			this.events.emit('change', next);
		}
	}

	private requireDir(): string {
		const dir = this.dir;
		if (!dir) {
			throw new Error('Open a folder in VS Code first. Shotgun keeps its files in the folder .shotgun of the first workspace folder.');
		}
		return dir;
	}

	private requireTask(): TaskFile {
		const task = this.state.task;
		if (!task) {
			throw new Error('No task is active. Make a task with "Shotgun: New Task", or select one with "Shotgun: Open Task".');
		}
		return task;
	}

	// The active task in this stage, else an error with the message
	private requireStage(stage: Stage, message: string): TaskFile {
		const task = this.requireTask();
		if (task.isDone || task.stage !== stage) {
			throw new Error(message);
		}
		return task;
	}

	private requireStep(step: string): PlanStep {
		const found = this.state.plan?.steps.find((s) => s.id === step);
		if (!found) {
			throw new Error(`The plan has no step ${step}.`);
		}
		return found;
	}

	// The active task in a stage where the user changes the level of the step: stage 4, or stage 5 for a step that Claude
	// did not start (decision 17)
	private requireLevelStage(step: string): TaskFile {
		const task = this.requireTask();
		this.requireStep(step);
		if (!task.isDone && task.stage === 'plan') {
			return task;
		}
		if (task.isDone || task.stage !== 'build') {
			throw new Error('You can change a level only in stage 4, the plan, and in stage 5, the build.');
		}
		const state = stateOf(this.state.build, step);
		const b = this.state.build?.steps[step];
		const isUserOpen = state === 'open' && b?.writer === 'user';
		if (state !== 'todo' && !isUserOpen) {
			throw new Error(state === 'done' ? 'The step is done, so its level stays.'
				: 'Claude started the step, so its level stays. Accept the receipt, or fill the holes of the frame, first.');
		}
		return task;
	}

	// A callout of a step
	private requireCallout(step: string, id: string): { file: CalloutsFile; value: StepCallouts; callout: StepCallouts['callouts'][number] } {
		const file = this.state.callouts ?? EMPTY_CALLOUTS;
		const value = file.steps[step];
		const callout = value?.callouts.find((c) => c.id === id);
		if (!value || !callout) {
			throw new Error(`Step ${step} has no callout ${id}.`);
		}
		return { file, value, callout };
	}

	private requireLooseEnd(id: string): LooseEndItem {
		const end = this.state.loose?.ends.find((e) => e.id === id);
		if (!end) {
			throw new Error(`The task has no loose end ${id}.`);
		}
		return end;
	}

	private writeLooseFile(id: string, value: LooseFile): void {
		writeTextAtomic(path.join(this.requireDir(), id, LOOSE_FILE), jsonText(value));
	}

	private writeCalloutsFile(id: string, value: CalloutsFile): void {
		writeTextAtomic(path.join(this.requireDir(), id, CALLOUTS_FILE), jsonText(value));
	}

	// Removes the state of a step from the build: the step starts again with the writer of its level
	private removeStep(id: string, step: string): void {
		const steps: Record<string, BuildStep> = { ...(this.state.build?.steps ?? {}) };
		delete steps[step];
		writeTextAtomic(path.join(this.requireDir(), id, BUILD_FILE), jsonText({ version: FILE_VERSION, steps } satisfies BuildFile));
	}

	// The step of the build with the id, if it is the current step
	private requireCurrent(id: string): CurrentStep {
		const current = this.current;
		const n = this.state.plan?.steps.findIndex((s) => s.id === id) ?? -1;
		if (n < 0) {
			throw new Error(`The plan has no step ${id}.`);
		}
		if (!current) {
			throw new Error('Each step of the plan is done.');
		}
		if (current.step.id !== id) {
			throw new Error(`Step ${n + 1} is not the current step. The steps go in sequence, and the current step is step ${current.n}, "${current.step.title}".`);
		}
		return current;
	}

	// A change of the receipt of the current step, while the user walks the receipt
	private requireChange(id: string, change: string): { task: TaskFile; step: BuildStep; receipt: Receipt; found: Receipt['changes'][number] } {
		const task = this.requireStage('build', 'A receipt is only in stage 5, the build.');
		const current = this.requireCurrent(id);
		const step = current.build;
		const receipt = step?.receipt;
		if (current.state !== 'receipt' || !step || !receipt) {
			throw new Error(`Step ${current.n} has no receipt to walk now.`);
		}
		const found = receipt.changes.find((c) => c.id === change);
		if (!found) {
			throw new Error(`The receipt of step ${current.n} has no change ${change}.`);
		}
		return { task, step, receipt, found };
	}

	private writeStep(id: string, step: string, value: BuildStep): void {
		const steps: Record<string, BuildStep> = { ...(this.state.build?.steps ?? {}), [step]: value };
		writeTextAtomic(path.join(this.requireDir(), id, BUILD_FILE), jsonText({ version: FILE_VERSION, steps } satisfies BuildFile));
	}

	// The level and the note of the user for a step. The answers and the decisions of the user for the step stay
	private writeLevel(id: string, step: string, level: Level | undefined, note: string | undefined): void {
		const levels = this.userLevel(step, { ...this.state.levels?.levels[step], level, note });
		writeTextAtomic(path.join(this.requireDir(), id, LEVELS_FILE), jsonText({ version: FILE_VERSION, levels } satisfies LevelsFile));
	}

	// The levels of the user with a new value for a step. A step with no level, no note, no answer and no decision of the
	// user has no entry
	private userLevel(step: string, value: Partial<UserLevel>): Record<string, UserLevel> {
		const levels: Record<string, UserLevel> = { ...(this.state.levels?.levels ?? {}) };
		const answers = value.answers && Object.keys(value.answers).length > 0 ? value.answers : undefined;
		const added = value.added && value.added.length > 0 ? value.added : undefined;
		if (!value.level && !value.note && !answers && !added) {
			delete levels[step];
		} else {
			levels[step] = {
				...(value.level ? { level: value.level } : {}), ...(value.note ? { note: value.note } : {}), time: this.time(),
				...(answers ? { answers } : {}), ...(added ? { added } : {}),
			};
		}
		return levels;
	}

	private writeOrder(id: string, order: Order): void {
		const file: OrderFile = { version: FILE_VERSION, time: this.time(), tasks: order.tasks, nextId: order.nextId };
		writeTextAtomic(path.join(this.requireDir(), id, ORDER_FILE), jsonText(file));
	}

	private time(): string {
		return this.now().toISOString();
	}
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
