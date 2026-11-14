import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import { isPartId, PartId } from './brief';
import { Gate, GateRecord, isGate, isStage, Stage } from './stages';

// The stage files of Shotgun, in the folder .shotgun of the first workspace folder:
// - active.json: the active task, and the pause of the guard. A workspace has 1 active task.
// - <task>/task.json: the title of the task, its stage and its gates.
// - <task>/brief.md: the brief of the user.
// - <task>/questions.json: the questions of Claude about the brief.
// - <task>/decisions.jsonl: 1 line for each decision of the user, for each deny of the guard, and for each result of
//   Claude that Shotgun records.
// Each JSON file and each line has the field version. Shotgun writes each JSON file in 1 step. These functions use no
// VS Code API, so the unit tests can call them directly.

export const FILE_VERSION = 1;
export const SHOTGUN_DIR = '.shotgun';
export const ACTIVE_FILE = 'active.json';
export const TASK_FILE = 'task.json';
export const QUESTIONS_FILE = 'questions.json';
export const DECISIONS_FILE = 'decisions.jsonl';

export interface ActiveFile {
	readonly version: 1;
	readonly task: string | null; // the id of the active task, or null
	readonly isPaused: boolean; // the user stopped the guard for work outside of the task
}

export interface TaskFile {
	readonly version: 1;
	readonly id: string; // the name of the folder of the task
	readonly title: string;
	readonly created: string; // ISO 8601
	readonly stage: Stage;
	readonly isDone: boolean;
	readonly gates: readonly GateRecord[];
}

// A question of Claude about the brief. The user answers in the brief, and then closes the question
export interface Question {
	readonly id: string; // q1, q2 and so on
	readonly text: string;
	readonly part?: PartId; // the part of the brief that the question is about
	readonly quote?: string; // a short text of the brief that the question is about
	readonly state: 'open' | 'closed';
	readonly created: string;
	readonly closed?: string;
}

export interface QuestionsFile {
	readonly version: 1;
	readonly questions: readonly Question[];
}

// A line of decisions.jsonl. by: the user, Claude, or the guard of Shotgun
// - brief: Claude gave the brief from the chat, with the number of the lines of the user
// - questions: Claude asked questions about the brief
// - question: the user closed a question
export type Decision =
	| { readonly version: 1; readonly time: string; readonly kind: 'task'; readonly by: 'user' | 'claude'; readonly title: string }
	| { readonly version: 1; readonly time: string; readonly kind: 'gate'; readonly by: 'user'; readonly gate: Gate; readonly stage: Stage }
	| { readonly version: 1; readonly time: string; readonly kind: 'pause' | 'continue'; readonly by: 'user' }
	| { readonly version: 1; readonly time: string; readonly kind: 'deny'; readonly by: 'guard'; readonly tool: string; readonly file: string; readonly reason: string }
	| { readonly version: 1; readonly time: string; readonly kind: 'brief'; readonly by: 'claude'; readonly lines: number }
	| { readonly version: 1; readonly time: string; readonly kind: 'questions'; readonly by: 'claude'; readonly count: number }
	| { readonly version: 1; readonly time: string; readonly kind: 'question'; readonly by: 'user'; readonly id: string; readonly text: string };

// A decision before Shotgun adds the version and the time
type WithoutStamp<T> = T extends unknown ? Omit<T, 'version' | 'time'> : never;
export type DecisionInput = WithoutStamp<Decision>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// The id of a task is the name of its folder: lowercase letters, digits and -, with a letter or a digit at the 2 ends
export const TASK_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// The names that Windows does not permit for a folder
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

// The id of a new task from its title. taken: the ids of the tasks that are there, in lowercase
export function taskIdOf(title: string, taken: ReadonlySet<string>): string {
	let base = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	base = base.slice(0, 40).replace(/-+$/, '');
	if (!base) {
		base = 'task';
	}
	if (RESERVED.test(base)) {
		base = `${base}-task`;
	}
	let id = base;
	for (let n = 2; taken.has(id); n++) {
		id = `${base}-${n}`;
	}
	return id;
}

// The version of a file. A newer version is an error, because this version of Shotgun cannot read it
function checkVersion(value: Json, name: string): void {
	if (typeof value.version === 'number' && value.version > FILE_VERSION) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version ${FILE_VERSION}. Install a newer version of Shotgun.`);
	}
	if (value.version !== FILE_VERSION) {
		throw new Error(`${name} has no correct version field.`);
	}
}

export function parseActive(text: string): ActiveFile {
	const value: unknown = JSON.parse(text);
	if (!isObject(value)) {
		throw new Error(`${ACTIVE_FILE} is not a JSON object.`);
	}
	checkVersion(value, ACTIVE_FILE);
	const task = value.task;
	if (task !== null && !(typeof task === 'string' && TASK_ID.test(task))) {
		throw new Error(`The field task of ${ACTIVE_FILE} is not null and not the id of a task.`);
	}
	if (typeof value.isPaused !== 'boolean') {
		throw new Error(`The field isPaused of ${ACTIVE_FILE} is not true or false.`);
	}
	return { version: FILE_VERSION, task, isPaused: value.isPaused };
}

function parseGate(value: unknown): GateRecord | undefined {
	if (!isObject(value) || !isGate(value.gate) || !isStage(value.stage) || !isText(value.time)) {
		return undefined;
	}
	return { gate: value.gate, stage: value.stage, time: value.time };
}

// id: the name of the folder of the task. The file must have the same id
export function parseTask(text: string, id: string): TaskFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${TASK_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name);
	if (value.id !== id) {
		throw new Error(`The field id of ${name} is not the name of its folder.`);
	}
	if (!isText(value.title) || !isText(value.created) || !isStage(value.stage) || typeof value.isDone !== 'boolean' || !Array.isArray(value.gates)) {
		throw new Error(`${name} needs the fields title, created, stage, isDone and gates.`);
	}
	const gates = value.gates.map(parseGate);
	if (gates.some((g) => g === undefined)) {
		throw new Error(`A gate of ${name} needs the fields gate, stage and time.`);
	}
	return {
		version: FILE_VERSION, id, title: value.title, created: value.created, stage: value.stage, isDone: value.isDone,
		gates: gates as GateRecord[],
	};
}

function parseDecision(value: unknown): Decision | undefined {
	if (!isObject(value) || value.version !== FILE_VERSION || !isText(value.time)) {
		return undefined;
	}
	const { time } = value;
	switch (value.kind) {
		case 'task':
			return (value.by === 'user' || value.by === 'claude') && isText(value.title)
				? { version: FILE_VERSION, time, kind: 'task', by: value.by, title: value.title } : undefined;
		case 'gate':
			return value.by === 'user' && isGate(value.gate) && isStage(value.stage)
				? { version: FILE_VERSION, time, kind: 'gate', by: 'user', gate: value.gate, stage: value.stage } : undefined;
		case 'pause':
		case 'continue':
			return value.by === 'user' ? { version: FILE_VERSION, time, kind: value.kind, by: 'user' } : undefined;
		case 'deny':
			return value.by === 'guard' && typeof value.tool === 'string' && typeof value.file === 'string' && typeof value.reason === 'string'
				? { version: FILE_VERSION, time, kind: 'deny', by: 'guard', tool: value.tool, file: value.file, reason: value.reason } : undefined;
		case 'brief':
			return value.by === 'claude' && typeof value.lines === 'number'
				? { version: FILE_VERSION, time, kind: 'brief', by: 'claude', lines: value.lines } : undefined;
		case 'questions':
			return value.by === 'claude' && typeof value.count === 'number'
				? { version: FILE_VERSION, time, kind: 'questions', by: 'claude', count: value.count } : undefined;
		case 'question':
			return value.by === 'user' && isText(value.id) && typeof value.text === 'string'
				? { version: FILE_VERSION, time, kind: 'question', by: 'user', id: value.id, text: value.text } : undefined;
		default:
			return undefined;
	}
}

function parseQuestion(value: unknown): Question | undefined {
	if (!isObject(value) || !isText(value.id) || !isText(value.text) || !isText(value.created)
		|| (value.state !== 'open' && value.state !== 'closed')) {
		return undefined;
	}
	if ((value.part !== undefined && !isPartId(value.part)) || (value.quote !== undefined && typeof value.quote !== 'string')
		|| (value.closed !== undefined && typeof value.closed !== 'string')) {
		return undefined;
	}
	return {
		id: value.id, text: value.text, state: value.state, created: value.created,
		...(value.part !== undefined ? { part: value.part } : {}),
		...(value.quote !== undefined ? { quote: value.quote as string } : {}),
		...(value.closed !== undefined ? { closed: value.closed as string } : {}),
	};
}

// id: the name of the folder of the task
export function parseQuestions(text: string, id: string): QuestionsFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${QUESTIONS_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name);
	if (!Array.isArray(value.questions)) {
		throw new Error(`${name} needs the field questions.`);
	}
	const questions = value.questions.map(parseQuestion);
	if (questions.some((q) => q === undefined)) {
		throw new Error(`A question of ${name} needs the fields id, text, state and created.`);
	}
	return { version: FILE_VERSION, questions: questions as Question[] };
}

// The lines of decisions.jsonl. A line that is not correct goes into the count of invalid lines
export function parseDecisions(text: string): { decisions: Decision[]; invalid: number } {
	const decisions: Decision[] = [];
	let invalid = 0;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		let decision: Decision | undefined;
		try {
			decision = parseDecision(JSON.parse(line));
		} catch {
			decision = undefined;
		}
		if (decision) {
			decisions.push(decision);
		} else {
			invalid += 1;
		}
	}
	return { decisions, invalid };
}

// The text of a JSON file
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// The text of a line of decisions.jsonl
export const decisionLine = (decision: Decision): string => `${JSON.stringify(decision)}\n`;

export function readText(file: string): string | undefined {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
}

// Writes a file in 1 step: a different program that reads it sees the old text or the new text, never a part
export function writeTextAtomic(file: string, text: string): void {
	mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.shotgun-${process.pid}.tmp`;
	writeFileSync(temp, text);
	renameSync(temp, file);
}
