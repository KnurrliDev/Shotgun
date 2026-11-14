import { factsOf, Order } from './order';
import { absolutePath, isInside, projectPath } from './paths';
import { isLevel, Level, LEVEL_INFO, PlaceHeat, PlaceRisk, ScanState, StepWriter } from './risk';
import { itemChecks, Lines, Survey, SurveyContext } from './survey';

// Stage 4: the plan of Claude (decision 4). Each step has a title, a task of the order, hooks, places, a text and checks.
// Three files keep the writers apart, as in stage 2:
// - plan.json: the steps of Claude
// - risk.json: the facts of DataFlow and the level of the rules for each step (decisions 8 and 14)
// - levels.json: the levels and the notes of the user. A level stays with the id of its step, also in a new plan
// These functions use no VS Code API, so the unit tests can call them directly.

export const MAX_STEPS = 40;
const MAX_PLACES = 8;
const MAX_CHECKS = 5;
const MAX_TITLE = 200;
const MAX_TEXT = 2000;
const MAX_CHECK = 300;
const MAX_NOTE = 500;
export const MAX_LEVEL_NOTE = 500; // the note of the user for a step

// A place of a step: lines of a file that is there, with a short text of their code, or a new file
export interface PlanPlace {
	readonly file: string; // relative to the first folder of the project, with /
	readonly lines?: Lines; // undefined: a new file
	readonly code?: string; // a short text of the code in the lines. Shotgun finds the place again with it
	readonly codeLine?: number;
}

export interface PlanStep {
	readonly id: string; // for example S1
	readonly title: string;
	readonly task: string; // the id of the task of the order
	readonly hooks: readonly string[];
	readonly places: readonly PlanPlace[];
	readonly text: string;
	readonly checks: readonly string[];
	readonly note?: string; // a note of Claude for the user
}

export interface Plan {
	readonly steps: readonly PlanStep[];
}

export interface PlanFile extends Plan {
	readonly version: 1;
	readonly time: string;
}

// The level of the rules for 1 place, with the facts that gave it
export interface PlaceRiskResult {
	readonly place: string; // for example "src/battery.cpp:94-96", or "tests/a.cpp (new)"
	readonly kind: PlaceRisk['kind'];
	readonly level: Level | null;
	readonly reasons: readonly string[];
	readonly heat?: PlaceHeat;
}

export interface StepRisk {
	readonly level: Level | null; // the level of the rules. null: no level yet
	readonly reasons: readonly string[];
	readonly places: readonly PlaceRiskResult[];
}

export interface RiskFile {
	readonly version: 1;
	readonly time: string;
	readonly scan: ScanState;
	readonly steps: Readonly<Record<string, StepRisk>>;
}

// The level and the note of the user for 1 step. With no level, the step has the level of the rules
export interface UserLevel {
	readonly level?: Level;
	readonly note?: string;
	readonly time: string;
}

export interface LevelsFile {
	readonly version: 1;
	readonly levels: Readonly<Record<string, UserLevel>>;
}

export const placeName = (place: PlanPlace): string => {
	if (!place.lines) {
		return `${place.file} (new)`;
	}
	return place.lines[0] === place.lines[1] ? `${place.file}:${place.lines[0]}` : `${place.file}:${place.lines[0]}-${place.lines[1]}`;
};

// The level of a step now: the level of the user, else the level of the rules
export function levelOf(step: string, risk: RiskFile | undefined, levels: LevelsFile | undefined): { level: Level | null; rule: Level | null; user?: Level } {
	const rule = risk?.steps[step]?.level ?? null;
	const user = levels?.levels[step]?.level;
	return { level: user ?? rule, rule, ...(user ? { user } : {}) };
}

export const writerOf = (level: Level | null): StepWriter | undefined => (level ? LEVEL_INFO[level].writer : undefined);

//-------------------
// The check of a plan of Claude

// Checks a plan of Claude. The result has all problems in 1 list (proposal P7). The steps must follow the order of the
// user, each task of the plan needs 1 step or more, and each task needs a survey for its text
export function checkPlan(raw: Record<string, unknown>, ctx: SurveyContext, order: Order, survey: Survey): { plan: Plan; problems: string[] } {
	const problems: string[] = [];
	const { listOf, idOf, textField, placeOf, idList } = itemChecks(ctx, problems, new Set<string>());
	const plan = order.tasks.filter((t) => !t.isLater);
	const placeInPlan = (id: string) => plan.findIndex((t) => t.id === id) + 1;
	const hookIds = new Set(survey.hooks.map((h) => h.id));
	const steps: PlanStep[] = [];
	const raws = listOf(raw, 'steps', MAX_STEPS, 'steps');
	if (raws.length === 0) {
		problems.push('Give 1 step or more in "steps".');
	}
	raws.forEach((s, i) => {
		const label = `Step ${i + 1}`;
		if (typeof s !== 'object' || s === null || Array.isArray(s)) {
			problems.push(`${label} is not an object.`);
			return;
		}
		const item = s as Record<string, unknown>;
		const id = idOf(item.id, label, 'S1');
		const title = textField(item, 'title', label, MAX_TITLE);
		const text = textField(item, 'text', label, MAX_TEXT);
		const note = textField(item, 'note', label, MAX_NOTE, true);
		const task = typeof item.task === 'string' ? item.task.trim() : '';
		if (!task) {
			problems.push(`${label}: give the "task": the id of a task of the order.`);
		} else if (!placeInPlan(task)) {
			problems.push(`${label}: the task ${task} is not in the plan of the order. Call get_order for the tasks of the plan.`);
		}
		const hooks = idList(item.hooks, label, 'hooks');
		hooks.filter((h) => !hookIds.has(h)).forEach((h) => problems.push(`${label}: ${h} is not a hook of the survey.`));
		const checks = Array.isArray(item.checks) ? item.checks.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean) : [];
		if (checks.length === 0) {
			problems.push(`${label}: give 1 to ${MAX_CHECKS} "checks": what the user checks after the step.`);
		} else if (checks.length > MAX_CHECKS || checks.some((c) => c.length > MAX_CHECK)) {
			problems.push(`${label}: give a maximum of ${MAX_CHECKS} checks, each with a maximum of ${MAX_CHECK} characters.`);
		}
		const places: PlanPlace[] = [];
		const placesRaw = Array.isArray(item.places) ? item.places : [];
		if (placesRaw.length === 0 || placesRaw.length > MAX_PLACES) {
			problems.push(`${label}: give 1 to ${MAX_PLACES} "places".`);
		}
		placesRaw.slice(0, MAX_PLACES).forEach((p, j) => {
			const placeLabel = `${label}, place ${j + 1}`;
			if (typeof p !== 'object' || p === null || Array.isArray(p)) {
				problems.push(`${placeLabel} is not an object.`);
				return;
			}
			const place = p as Record<string, unknown>;
			const name = typeof place.file === 'string' ? place.file.trim() : '';
			const file = name ? absolutePath(name, ctx.root) : '';
			if (place.new === true) {
				if (!name) {
					problems.push(`${placeLabel}: give the "file".`);
				} else if (!ctx.folders.some((f) => isInside(file, f, ctx.isCaseSensitive))) {
					problems.push(`${placeLabel}: ${name} is not in a folder of the project.`);
				} else if (ctx.readLines(file)) {
					problems.push(`${placeLabel}: the file ${name} is there already. Give its "lines" and "code", or a different name for a new file.`);
				} else {
					places.push({ file: projectPath(file, ctx.root, ctx.isCaseSensitive) });
				}
				return;
			}
			if (name && ctx.folders.some((f) => isInside(file, f, ctx.isCaseSensitive)) && !ctx.readLines(file)) {
				problems.push(`${placeLabel}: the file ${name} is not there. For a new file, give "new": true and no lines.`);
				return;
			}
			const found = placeOf(place, placeLabel, true);
			if (found) {
				places.push({ file: found.file, lines: found.lines, code: found.code, codeLine: found.codeLine });
			}
		});
		if (id && title && text && task) {
			steps.push({ id, title, task, hooks, places, text, checks: checks.slice(0, MAX_CHECKS), ...(note ? { note } : {}) });
		}
	});

	// each task of the plan needs a survey for its text and 1 step or more, and the steps follow the order of the user
	for (const task of plan) {
		if (task.text.trim() && !factsOf(task, survey).hasSurvey) {
			problems.push(`The task ${task.id} "${task.text}" has no survey for its text. Call submit_task_survey for it first.`);
		}
		if (!steps.some((s) => s.task === task.id)) {
			problems.push(`The task ${task.id} "${task.text}" has no step. Each task of the plan needs 1 step or more.`);
		}
	}
	let last = 0;
	for (const step of steps) {
		const n = placeInPlan(step.task);
		if (n > 0 && n < last) {
			problems.push(`The step ${step.id} is for task ${n} of the order, but it comes after a step for task ${last}. Give the steps in the sequence of the order.`);
		}
		last = Math.max(last, n);
	}
	return { plan: { steps }, problems };
}

//-------------------
// The files

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isLines = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1);

function checkVersion(value: Json, name: string, fields: string): void {
	if (typeof value.version === 'number' && value.version > 1) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version 1. Install a newer version of Shotgun.`);
	}
	if (value.version !== 1) {
		throw new Error(`${name} needs the fields ${fields}.`);
	}
}

// id: the name of the folder of the task
export function parsePlan(text: string, id: string): PlanFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/plan.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name, 'version, time and steps');
	const isPlace = (p: unknown) => isObject(p) && typeof p.file === 'string' && (p.lines === undefined || isLines(p.lines));
	const isStep = (s: unknown) => isObject(s) && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.task === 'string'
		&& isStrings(s.hooks) && Array.isArray(s.places) && s.places.every(isPlace) && typeof s.text === 'string' && isStrings(s.checks);
	if (typeof value.time !== 'string' || !Array.isArray(value.steps) || !value.steps.every(isStep)) {
		throw new Error(`${name} needs the fields version, time and steps, and each step needs its fields.`);
	}
	return value as unknown as PlanFile;
}

export function parseRisk(text: string, id: string): RiskFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/risk.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name, 'version, time, scan and steps');
	const isStep = (s: unknown) => isObject(s) && (s.level === null || isLevel(s.level)) && isStrings(s.reasons) && Array.isArray(s.places);
	if (typeof value.time !== 'string' || typeof value.scan !== 'string' || !isObject(value.steps) || !Object.values(value.steps).every(isStep)) {
		throw new Error(`${name} needs the fields version, time, scan and steps.`);
	}
	return value as unknown as RiskFile;
}

export function parseLevels(text: string, id: string): LevelsFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/levels.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name, 'version and levels');
	const isUser = (l: unknown) => isObject(l) && (l.level === undefined || isLevel(l.level)) && (l.note === undefined || typeof l.note === 'string')
		&& typeof l.time === 'string';
	if (!isObject(value.levels) || !Object.values(value.levels).every(isUser)) {
		throw new Error(`${name} needs the fields version and levels.`);
	}
	return value as unknown as LevelsFile;
}
