import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import { BRIEF_FILE, briefTemplate, PartId } from './brief';
import {
	ACTIVE_FILE, ActiveFile, ANSWERS_FILE, Decision, DECISIONS_FILE, decisionLine, DecisionInput, ENGINE_FILE, FILE_VERSION, jsonText, parseActive,
	parseDecisions, parseQuestions, parseTask, Question, QUESTIONS_FILE, readText, SHOTGUN_DIR, SURVEY_FILE, TASK_FILE, TASK_ID, TaskFile, taskIdOf,
	writeTextAtomic,
} from './files';
import { Gate, passGate, Stage, START } from './stages';
import { Answer, AnswersFile, checkAnswer, EngineFile, parseAnswers, parseEngine, parseSurvey, Survey, SurveyFile } from './survey';

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
	readonly problems: readonly string[]; // the stage files that Shotgun cannot read
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
			root, task: undefined, isPaused: false, tasks: [], decisions: [], questions: [], survey: undefined, engine: undefined, answers: {}, problems: [],
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
			problems,
		});
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

	private time(): string {
		return this.now().toISOString();
	}
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
