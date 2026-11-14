import type { HeatFacts, HeatTypeFacts, PlaceFacts, PlaceStatement } from '../dataflow/dataflow-api';
import { normalizeWords } from './brief';
import { absolutePath, isInside, projectPath } from './paths';

// The survey of Claude in stage 2: the tasks in no sequence, the hooks (the places where new code goes into the code
// that is there), the facts that Claude found, and the questions for the user. Three files keep it apart (decision 13):
// - survey.json: the words of Claude
// - engine.json: the facts that Shotgun gets from DataFlow for each hook
// - answers.json: the answers of the user to the questions
// These functions use no VS Code API, so the unit tests can call them directly.

export const MAX_TASKS = 30;
export const MAX_HOOKS = 40;
export const MAX_FACTS = 20;
export const MAX_QUESTIONS = 10;
const MAX_TITLE = 200;
const MAX_TEXT = 2000;
const MAX_FACT = 500;
const MAX_QUESTION = 500;
const MAX_CODE = 300;
export const MAX_ANSWER = 4000;
// The maximum number of the lines of a hook or a fact
const MAX_RANGE = 300;
// The id of a task, a hook or a question, for example T1, H3 or Q2
export const ITEM_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export type Lines = readonly [number, number];

// The estimate of Claude for the work of a task
export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export interface SurveyTask {
	readonly id: string;
	readonly title: string;
	readonly text?: string;
	readonly hooks: readonly string[]; // the ids of the hooks of the task. A task with only new files has no hook
	readonly needs: readonly string[]; // the ids of the tasks that this task needs first
	readonly size?: Size;
}

export interface SurveyHook {
	readonly id: string;
	readonly title: string;
	readonly kind: string; // the new code at the place, in the words of Claude, for example "new check in solve_power_plan()"
	readonly file: string; // relative to the first folder of the project, with /
	readonly lines: Lines;
	readonly code: string; // a short text of the code in the lines, copied exactly
	// the line where the code starts, at the time of the survey. Shotgun finds the hook again with it. A survey file of
	// an earlier version of Shotgun can have no codeLine
	readonly codeLine?: number;
}

export interface SurveyFact {
	readonly text: string;
	readonly file: string;
	readonly lines: Lines;
	readonly tool: string; // the read tool of DataFlow that shows the fact
}

export interface SurveyQuestion {
	readonly id: string;
	readonly text: string;
}

export interface Survey {
	readonly tasks: readonly SurveyTask[];
	readonly hooks: readonly SurveyHook[];
	readonly facts: readonly SurveyFact[];
	readonly questions: readonly SurveyQuestion[];
}

export interface SurveyFile extends Survey {
	readonly version: 1;
	readonly time: string;
}

export type Band = 'cool' | 'warm' | 'hot' | 'very hot';

export interface HookHeat {
	readonly function: string;
	readonly score: number; // 0 to 100
	readonly band: Band;
	readonly isReachComplete: boolean;
	readonly reachUnknown?: string;
}

// The facts of DataFlow for a hook. text: the facts in 1 to 3 sentences
export interface HookEngine {
	readonly text: string;
	readonly hasFacts: boolean;
	readonly function?: string;
	readonly type?: string;
	readonly heat?: HookHeat;
}

export interface EngineFile {
	readonly version: 1;
	readonly time: string;
	readonly isReachComplete: boolean;
	readonly hooks: Readonly<Record<string, HookEngine>>;
}

export interface Answer {
	readonly text: string;
	readonly time: string;
}

export interface AnswersFile {
	readonly version: 1;
	readonly answers: Readonly<Record<string, Answer>>;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const isLines = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2
	&& value.every((n) => Number.isInteger(n) && n >= 1) && value[0] <= value[1];

//-------------------
// The check of a survey of Claude

export interface SurveyContext {
	readonly root: string; // the first folder of the project: the base of a relative path
	readonly folders: readonly string[]; // the folders of the project
	readonly isCaseSensitive: boolean;
	readonly readLines: (file: string) => readonly string[] | undefined; // the lines of a file, or undefined if no file
	readonly tools: readonly string[]; // the read tools of DataFlow. Empty: Shotgun does not check the names
	// the tools of DataFlow that Claude called in this stage (decision 13). undefined: Shotgun does not check the calls,
	// because DataFlow 0.6.0 does not tell the calls of the tools (item 43 of dataflow-gaps-2.md)
	readonly called?: ReadonlySet<string>;
}

// The checks of the items of a survey. Each check adds its problems to the list. ids: the ids that are in use, in lower
// case, because each id of a survey must be different. The survey of a task in stage 3 uses the same checks
export function itemChecks(ctx: SurveyContext, problems: string[], ids: Set<string>) {
	const listOf = (raw: Json, key: string, max: number, what: string): unknown[] => {
		const value = raw[key];
		if (value === undefined) {
			return [];
		}
		if (!Array.isArray(value)) {
			problems.push(`"${key}" must be a list.`);
			return [];
		}
		if (value.length > max) {
			problems.push(`Give a maximum of ${max} ${what}.`);
		}
		return value.slice(0, max);
	};
	const idOf = (value: unknown, label: string, example: string): string | undefined => {
		const id = textOf(value).trim();
		if (!ITEM_ID.test(id)) {
			problems.push(`${label}: give an "id" of letters and digits, for example ${example}.`);
			return undefined;
		}
		if (ids.has(id.toLowerCase())) {
			problems.push(`${label}: the id ${id} is there already. Each id must be different.`);
			return undefined;
		}
		ids.add(id.toLowerCase());
		return id;
	};
	const textField = (item: Json, key: string, label: string, max: number, isOptional = false): string | undefined => {
		const value = textOf(item[key]).trim();
		if (!value) {
			if (!isOptional) {
				problems.push(`${label}: give the "${key}".`);
			}
			return undefined;
		}
		if (value.length > max) {
			problems.push(`${label}: the "${key}" has more than ${max} characters.`);
			return undefined;
		}
		return value;
	};
	// a place: the file and the lines, and for a hook its code in the lines and the line where the code starts
	const placeOf = (item: Json, label: string, isHook: boolean): { file: string; lines: Lines; code: string; codeLine: number } | undefined => {
		const name = textOf(item.file).trim();
		if (!name) {
			problems.push(`${label}: give the "file".`);
			return undefined;
		}
		const file = absolutePath(name, ctx.root);
		if (!ctx.folders.some((f) => isInside(file, f, ctx.isCaseSensitive))) {
			problems.push(`${label}: ${name} is not in a folder of the project.`);
			return undefined;
		}
		const fileLines = ctx.readLines(file);
		if (!fileLines) {
			problems.push(`${label}: the file ${name} is not there. A hook is a place in a file that is there now.`);
			return undefined;
		}
		const lines: Lines | undefined = isLines(item.lines) ? [item.lines[0], item.lines[1]]
			: Number.isInteger(item.line) && (item.line as number) >= 1 ? [item.line as number, item.line as number] : undefined;
		if (!lines) {
			problems.push(`${label}: give "lines" as [first, last], or "line", from 1.`);
			return undefined;
		}
		if (lines[1] - lines[0] >= MAX_RANGE) {
			problems.push(`${label}: give a maximum of ${MAX_RANGE} lines.`);
			return undefined;
		}
		if (lines[1] > fileLines.length) {
			problems.push(`${label}: ${name} has ${fileLines.length} lines, so the lines ${lines[0]} to ${lines[1]} are not in it.`);
			return undefined;
		}
		let code = '';
		let codeLine = lines[0];
		if (isHook) {
			code = textOf(item.code).trim();
			if (code.length < 3) {
				problems.push(`${label}: give "code", a short text of the code in its lines, copied exactly.`);
				return undefined;
			}
			if (code.length > MAX_CODE) {
				problems.push(`${label}: the "code" has more than ${MAX_CODE} characters. Give a short text of 1 line.`);
				return undefined;
			}
			const found = codeLineOf(fileLines, lines, code);
			if (found === undefined) {
				problems.push(`${label}: the code "${code}" is not in the lines ${lines[0]} to ${lines[1]} of ${name}. Read the file again, and give `
					+ 'the correct lines.');
				return undefined;
			}
			codeLine = found;
		}
		return { file: projectPath(file, ctx.root, ctx.isCaseSensitive), lines, code, codeLine };
	};
	const idList = (value: unknown, label: string, key: string): string[] => {
		if (value === undefined) {
			return [];
		}
		if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
			problems.push(`${label}: "${key}" must be a list of ids.`);
			return [];
		}
		return (value as string[]).map((v) => v.trim());
	};
	const sizeOf = (value: unknown, label: string): Size | undefined => {
		if (value === undefined) {
			return undefined;
		}
		if (typeof value === 'string' && (SIZES as readonly string[]).includes(value)) {
			return value as Size;
		}
		problems.push(`${label}: "size" must be small, medium or large.`);
		return undefined;
	};
	// a hook: its id, its title, its kind, and its place with its code
	const hookOf = (h: unknown, label: string): SurveyHook | undefined => {
		if (!isObject(h)) {
			problems.push(`${label} is not an object.`);
			return undefined;
		}
		const id = idOf(h.id, label, 'H1');
		const title = textField(h, 'title', label, MAX_TITLE);
		const kind = textField(h, 'kind', label, MAX_TITLE);
		const place = placeOf(h, label, true);
		return id && title && kind && place ? { id, title, kind, ...place } : undefined;
	};
	return { listOf, idOf, textField, placeOf, idList, sizeOf, hookOf };
}

// Checks a survey of Claude. The result has all problems in 1 list (proposal P7). A survey with a problem goes into
// no file
export function checkSurvey(raw: Json, ctx: SurveyContext): { survey: Survey; problems: string[] } {
	const problems: string[] = [];
	const { listOf, idOf, textField, placeOf, idList, sizeOf, hookOf } = itemChecks(ctx, problems, new Set<string>());

	const hooks: SurveyHook[] = [];
	listOf(raw, 'hooks', MAX_HOOKS, 'hooks').forEach((h, i) => {
		const hook = hookOf(h, `Hook ${i + 1}`);
		if (hook) {
			hooks.push(hook);
		}
	});

	const tasks: SurveyTask[] = [];
	const tasksRaw = listOf(raw, 'tasks', MAX_TASKS, 'tasks');
	if (tasksRaw.length === 0) {
		problems.push('Give 1 task or more in "tasks".');
	}
	tasksRaw.forEach((t, i) => {
		const label = `Task ${i + 1}`;
		if (!isObject(t)) {
			problems.push(`${label} is not an object.`);
			return;
		}
		const id = idOf(t.id, label, 'T1');
		const title = textField(t, 'title', label, MAX_TITLE);
		const text = textField(t, 'text', label, MAX_TEXT, true);
		const hookIds = idList(t.hooks, label, 'hooks');
		const needs = idList(t.needs, label, 'needs');
		const size = sizeOf(t.size, label);
		if (id && title) {
			tasks.push({ id, title, ...(text ? { text } : {}), hooks: hookIds, needs, ...(size ? { size } : {}) });
		}
	});

	const facts: SurveyFact[] = [];
	listOf(raw, 'facts', MAX_FACTS, 'facts').forEach((f, i) => {
		const label = `Fact ${i + 1}`;
		if (!isObject(f)) {
			problems.push(`${label} is not an object.`);
			return;
		}
		const text = textField(f, 'text', label, MAX_FACT);
		const tool = textOf(f.tool).trim().replace(/^mcp__plugin_dataflow_dataflow__/, '');
		if (!tool) {
			problems.push(`${label}: give the "tool": the read tool of DataFlow that shows the fact, for example get_threads.`);
		} else if (ctx.tools.length > 0 && !ctx.tools.includes(tool)) {
			problems.push(`${label}: "${tool}" is not a read tool of DataFlow. Give the tool that shows the fact, for example get_threads.`);
		} else if (ctx.called && !ctx.called.has(tool)) {
			problems.push(`${label}: you did not call ${tool} in this stage. Call it, and give only a fact that it shows.`);
		}
		const place = placeOf(f, label, false);
		if (text && tool && place) {
			facts.push({ text, file: place.file, lines: place.lines, tool });
		}
	});

	const questions: SurveyQuestion[] = [];
	listOf(raw, 'questions', MAX_QUESTIONS, 'questions').forEach((q, i) => {
		const label = `Question ${i + 1}`;
		if (!isObject(q)) {
			problems.push(`${label} is not an object.`);
			return;
		}
		const id = idOf(q.id, label, 'Q1');
		const text = textField(q, 'text', label, MAX_QUESTION);
		if (id && text) {
			questions.push({ id, text });
		}
	});

	// the ids that the tasks name
	const taskIds = new Set(tasks.map((t) => t.id));
	const hookIds = new Set(hooks.map((h) => h.id));
	for (const t of tasks) {
		t.hooks.filter((h) => !hookIds.has(h)).forEach((h) => problems.push(`Task ${t.id}: the hook ${h} is not in "hooks".`));
		t.needs.filter((n) => n === t.id).forEach(() => problems.push(`Task ${t.id}: a task cannot need itself.`));
		t.needs.filter((n) => n !== t.id && !taskIds.has(n)).forEach((n) => problems.push(`Task ${t.id}: the task ${n} in "needs" is not in "tasks".`));
	}
	for (const h of hooks) {
		if (!tasks.some((t) => t.hooks.includes(h.id))) {
			problems.push(`Hook ${h.id}: no task names it. Give it to the task that changes the code there, or remove it.`);
		}
	}
	const circle = circleOf(tasks);
	if (circle) {
		problems.push(`The "needs" of the tasks ${circle.join(', ')} make a circle. A task cannot need itself through other tasks.`);
	}
	return { survey: { tasks, hooks, facts, questions }, problems };
}

// The tasks of a circle of needs, or undefined. A task that needs itself has its own problem, so it is not a circle here
export function circleOf(tasks: readonly { readonly id: string; readonly needs: readonly string[] }[]): string[] | undefined {
	const needs = new Map(tasks.map((t) => [t.id, t.needs.filter((n) => n !== t.id)]));
	const state = new Map<string, 'open' | 'done'>();
	const stack: string[] = [];
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === 'done') {
			return undefined;
		}
		if (state.get(id) === 'open') {
			return stack.slice(stack.indexOf(id));
		}
		state.set(id, 'open');
		stack.push(id);
		for (const next of needs.get(id) ?? []) {
			const found = needs.has(next) ? visit(next) : undefined;
			if (found) {
				return found;
			}
		}
		stack.pop();
		state.set(id, 'done');
		return undefined;
	};
	for (const t of tasks) {
		const found = visit(t.id);
		if (found) {
			return found;
		}
	}
	return undefined;
}

//-------------------
// The facts of DataFlow for a hook

const AROUND: Readonly<Record<PlaceStatement['kind'], string>> = {
	for: 'a for loop', while: 'a while loop', do: 'a do loop', if: 'an if statement', switch: 'a switch statement',
	conditional: 'a condition', try: 'a try block', catch: 'a catch block', lambda: 'a lambda',
};

const listText = (items: readonly string[]): string => (items.length <= 1 ? items.join('')
	: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// The facts of a line in 1 to 3 sentences, for example "In process(), in an if statement. The caller thread runs the
// line, with no lock."
export function placeText(place: PlaceFacts): string {
	if (!place.function) {
		return 'The line is in no function.';
	}
	const inner = place.around[place.around.length - 1];
	const sentences = [`In ${place.function.name}()${inner ? `, in ${AROUND[inner.kind]}` : ''}.`];
	const threads = place.threads.map((t) => `the thread ${t.label}`);
	const who = threads.length === 0 ? 'The thread of the caller runs the line'
		: place.isOnCallerThread ? `The thread of the caller and ${listText(threads)} run the line`
			: `${listText(threads).replace(/^the/, 'The')} ${threads.length === 1 ? 'runs' : 'run'} the line`;
	sentences.push(`${who}, ${place.locks.length > 0 ? `with the lock ${listText(place.locks)}` : 'with no lock'}.`);
	if (place.framePath) {
		sentences.push(`It runs in each frame: ${place.framePath.reason}.`);
	}
	if (place.reachUnknown) {
		sentences.push(place.reachUnknown.text.endsWith('.') ? place.reachUnknown.text : `${place.reachUnknown.text}.`);
	}
	return sentences.join(' ');
}

// The facts of a type in 1 or 2 sentences. A type has no score
export function typeText(type: HeatTypeFacts): string {
	const shared = type.members.filter((m) => m.shared);
	const sentences = [`In the type ${type.name}. A type has facts, and no score.`];
	const unprotected = shared.filter((m) => m.shared === 'unprotected').map((m) => m.name);
	const locked = shared.filter((m) => m.shared === 'locked').map((m) => m.name);
	if (unprotected.length > 0) {
		sentences.push(`2 or more threads use ${listText(unprotected)}, with no protection.`);
	}
	if (locked.length > 0) {
		sentences.push(`2 or more threads use ${listText(locked)}, with a lock.`);
	}
	return sentences.join(' ');
}

// The heat of a hook: the function with the highest score in the lines of the hook
export function heatOf(heat: HeatFacts): HookHeat | undefined {
	const hottest = [...heat.functions].sort((a, b) => b.score - a.score)[0];
	if (!hottest) {
		return undefined;
	}
	return {
		function: hottest.name, score: hottest.score, band: hottest.band, isReachComplete: hottest.isReachComplete,
		...(hottest.reachUnknown ? { reachUnknown: hottest.reachUnknown.text } : {}),
	};
}

// The facts of a hook from the facts of its first line and the heat of its lines
export function hookEngineOf(place: PlaceFacts | undefined, heat: HeatFacts | undefined): HookEngine {
	const hot = heat ? heatOf(heat) : undefined;
	if (place?.function) {
		return { text: placeText(place), hasFacts: true, function: place.function.name, ...(hot ? { heat: hot } : {}) };
	}
	const type = heat?.types?.[0];
	if (type) {
		return { text: typeText(type), hasFacts: true, type: type.name };
	}
	if (place) {
		return { text: placeText(place), hasFacts: true, ...(hot ? { heat: hot } : {}) };
	}
	return { text: 'DataFlow gave no facts for the place.', hasFacts: false };
}

//-------------------
// The hooks in the text now

// The maximum distance in lines from the old place of a hook to its new place
const MAX_MOVE = 500;

// The words of the lines first to last, from 1. Empty if first is after last
const wordsOf = (lines: readonly string[], first: number, last: number): string => (first > last ? ''
	: normalizeWords(lines.slice(first - 1, last).join(' ')));

// The line where the code of a hook starts: the last line of the hook from which the lines to the end of the hook have
// the code. undefined: the code is not in the lines
export function codeLineOf(lines: readonly string[], range: Lines, code: string): number | undefined {
	const words = normalizeWords(code);
	for (let line = range[1]; line >= range[0]; line--) {
		if (wordsOf(lines, line, range[1]).includes(words)) {
			return line;
		}
	}
	return undefined;
}

// The lines of a hook in the text now. The hook moves with its code: Shotgun finds the nearest line where the code
// starts, and keeps the lines of the hook around the code. undefined: the code of the hook is not in the file
export function findHook(lines: readonly string[], hook: { readonly lines: Lines; readonly code: string; readonly codeLine?: number }): Lines | undefined {
	const code = normalizeWords(hook.code);
	const [first, last] = hook.lines;
	// a hook of an earlier version of Shotgun has no codeLine: its code starts at the line where it starts now
	const codeLine = hook.codeLine ?? codeLineOf(lines, hook.lines, hook.code) ?? first;
	const tail = last - codeLine; // the lines of the hook after the line of the code
	const startsAt = (line: number) => line >= 1 && line + tail <= lines.length
		&& wordsOf(lines, line, line + tail).includes(code) && !wordsOf(lines, line + 1, line + tail).includes(code);
	for (let distance = 0; distance <= MAX_MOVE; distance++) {
		for (const line of distance === 0 ? [codeLine] : [codeLine - distance, codeLine + distance]) {
			if (startsAt(line)) {
				return [Math.max(1, line - (codeLine - first)), line + tail];
			}
		}
	}
	return undefined;
}

// A hook at its lines now, from findHook. Its code line moves with it
export function movedHook<T extends SurveyHook>(hook: T, lines: Lines): T {
	return { ...hook, lines, ...(hook.codeLine !== undefined ? { codeLine: lines[1] - (hook.lines[1] - hook.codeLine) } : {}) };
}

export interface ExcerptLine {
	readonly line: number;
	readonly text: string;
	readonly isHook: boolean;
}

// The lines of a hook with lines of context, for the page. A long hook shows its first lines
export function excerptOf(lines: readonly string[], range: Lines, context = 3, max = 30): { lines: ExcerptLine[]; isCut: boolean } {
	const first = Math.max(1, range[0] - context);
	const last = Math.min(lines.length, range[1] + context, first + max - 1);
	const out: ExcerptLine[] = [];
	for (let n = first; n <= last; n++) {
		out.push({ line: n, text: lines[n - 1] ?? '', isHook: n >= range[0] && n <= range[1] });
	}
	return { lines: out, isCut: last < Math.min(lines.length, range[1] + context) };
}

//-------------------
// The files

function checkVersion(value: Json, name: string): void {
	if (typeof value.version === 'number' && value.version > 1) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version 1. Install a newer version of Shotgun.`);
	}
	if (value.version !== 1) {
		throw new Error(`${name} has no correct version field.`);
	}
}

const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isPlace = (value: Json): boolean => typeof value.file === 'string' && isLines(value.lines);

// id: the name of the folder of the task
export function parseSurvey(text: string, id: string): SurveyFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/survey.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name);
	const { tasks, hooks, facts, questions } = value;
	if (typeof value.time !== 'string' || !Array.isArray(tasks) || !Array.isArray(hooks) || !Array.isArray(facts) || !Array.isArray(questions)) {
		throw new Error(`${name} needs the fields time, tasks, hooks, facts and questions.`);
	}
	const isTask = (t: unknown) => isObject(t) && typeof t.id === 'string' && typeof t.title === 'string' && isIdList(t.hooks) && isIdList(t.needs)
		&& (t.size === undefined || (SIZES as readonly unknown[]).includes(t.size));
	const isHook = (h: unknown) => isObject(h) && typeof h.id === 'string' && typeof h.title === 'string' && typeof h.kind === 'string'
		&& typeof h.code === 'string' && isPlace(h) && (h.codeLine === undefined || (Number.isInteger(h.codeLine) && (h.codeLine as number) >= 1));
	const isFact = (f: unknown) => isObject(f) && typeof f.text === 'string' && typeof f.tool === 'string' && isPlace(f);
	const isQuestion = (q: unknown) => isObject(q) && typeof q.id === 'string' && typeof q.text === 'string';
	if (!tasks.every(isTask) || !hooks.every(isHook) || !facts.every(isFact) || !questions.every(isQuestion)) {
		throw new Error(`${name} has a task, a hook, a fact or a question with no correct fields.`);
	}
	return value as unknown as SurveyFile;
}

export function parseEngine(text: string, id: string): EngineFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/engine.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name);
	if (typeof value.time !== 'string' || typeof value.isReachComplete !== 'boolean' || !isObject(value.hooks)
		|| !Object.values(value.hooks).every((h) => isObject(h) && typeof h.text === 'string' && typeof h.hasFacts === 'boolean')) {
		throw new Error(`${name} needs the fields time, isReachComplete and hooks.`);
	}
	return value as unknown as EngineFile;
}

export function parseAnswers(text: string, id: string): AnswersFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/answers.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name);
	if (!isObject(value.answers) || !Object.values(value.answers).every((a) => isObject(a) && typeof a.text === 'string' && typeof a.time === 'string')) {
		throw new Error(`${name} needs the field answers.`);
	}
	return value as unknown as AnswersFile;
}

// The answer of the user, with a check of its length
export function checkAnswer(text: string): string {
	const answer = text.trim();
	if (answer.length > MAX_ANSWER) {
		throw new Error(`The answer has more than ${MAX_ANSWER} characters.`);
	}
	return answer;
}
