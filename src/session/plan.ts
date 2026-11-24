import { factsOf, Order } from './order';
import { absolutePath, isInside, projectPath } from './paths';
import { isLevel, Level, LEVEL_INFO, PlaceHeat, PlaceRisk, ScanState, StepWriter } from './risk';
import { itemChecks, Lines, Survey, SurveyContext } from './survey';

// Stage 4: the plan of Claude (decision 4). Each step has a title, a task of the order, hooks, places, a text, checks and
// its open decisions. Three files keep the writers apart, as in stage 2:
// - plan.json: the steps of Claude
// - risk.json: the facts of DataFlow and the level of the heat for each step (decisions 8 and 14)
// - levels.json: the levels, the notes, the answers and the decisions of the user. They stay with the id of their step,
//   also in a new plan
// The level of the rules comes from the heat and from the open decisions (decision 31). These functions use no VS Code
// API, so the unit tests can call them directly.

export const MAX_STEPS = 40;
const MAX_PLACES = 8;
const MAX_CHECKS = 5;
const MAX_TITLE = 200;
const MAX_TEXT = 2000;
const MAX_CHECK = 300;
const MAX_NOTE = 500;
export const MAX_LEVEL_NOTE = 500; // the note of the user for a step
export const MAX_DECISIONS = 3; // the open decisions of Claude in a step (P27)
export const MAX_USER_DECISIONS = 3; // the decisions that the user adds to a step (P29)
export const MAX_DECISION_QUESTION = 200;
export const MAX_DECISION_ANSWER = 500;
export const ISSUE_LEVEL = 4; // the level of the step of an issue of the review (decision 37)
const MAX_OPTIONS = 4;
const MAX_OPTION = 120;

// A place of a step: lines of a file that is there, with a short text of their code, or a new file. insert: the new lines
// go next to the lines, and the lines do not change, for example a new data member next to the other members (P26)
export interface PlanPlace {
	readonly file: string; // relative to the first folder of the project, with /
	readonly lines?: Lines; // undefined: a new file
	readonly code?: string; // a short text of the code in the lines. Shotgun finds the place again with it
	readonly codeLine?: number;
	readonly insert?: true;
}

// An open decision of a step (decision 31): a choice that the brief, the answers of the user and the order do not
// settle. Claude gives the decisions D1 to D3, and the user can add the decisions U1 to U3. options: the options that
// Claude sees, with no choice of Claude (P27)
export interface PlanDecision {
	readonly id: string;
	readonly question: string;
	readonly options?: readonly string[];
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
	readonly looseEnd?: string; // a step of a loose end that the user handed to Claude, for example E3 (decision 21)
	readonly issue?: string; // a step that fixes an issue of the review in stage 6, in Shotgun 0.4.0 and earlier (P22)
	readonly fixes?: readonly string[]; // a step of the plan of the fixes in stage 6: the ids of the issues that it fixes (decision 43)
	// the open decisions of Claude. undefined: a plan of version 0.1.0 or a loose end, with the level of the heat only (P34)
	readonly decisions?: readonly PlanDecision[];
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

// The answer of the user to a decision. It applies only while the decision has the same question
export interface DecisionAnswer {
	readonly question: string;
	readonly text: string;
	readonly time: string;
}

// A decision that the user added to a step
export interface UserDecision {
	readonly id: string; // U1, U2 and so on
	readonly question: string;
	readonly time: string;
}

// The level, the note, the answers and the decisions of the user for 1 step. With no level, the step has the level of
// the rules
export interface UserLevel {
	readonly level?: Level;
	readonly writer?: StepWriter; // the writer that the user selected at the level of the step (decision 44)
	readonly note?: string;
	readonly time: string;
	readonly answers?: Readonly<Record<string, DecisionAnswer>>; // by the id of the decision
	readonly added?: readonly UserDecision[];
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

// A decision of a step with its writer, and the answer of the user
export interface StepDecision extends PlanDecision {
	readonly by: 'claude' | 'user';
	readonly answer?: string;
}

// The decisions of a step: the decisions of Claude, then the decisions of the user, each with the answer of the user.
// undefined: a step with no field decisions, for example of a plan of version 0.1.0 (P34)
export function decisionsOf(step: PlanStep, levels: LevelsFile | undefined): StepDecision[] | undefined {
	if (!step.decisions) {
		return undefined;
	}
	const user = levels?.levels[step.id];
	const all: StepDecision[] = [
		...step.decisions.map((d) => ({ ...d, by: 'claude' as const })),
		...(user?.added ?? []).map((d) => ({ id: d.id, question: d.question, by: 'user' as const })),
	];
	return all.map((d) => {
		const answer = user?.answers?.[d.id];
		return answer && answer.question === d.question ? { ...d, answer: answer.text } : d;
	});
}

// The decisions of a step with no answer of the user
export const openDecisions = (step: PlanStep, levels: LevelsFile | undefined): StepDecision[] => (decisionsOf(step, levels) ?? [])
	.filter((d) => d.answer === undefined);

export interface StepLevel {
	readonly level: Level | null; // the level now: the level of the user, else the level of the rules
	readonly rule: Level | null; // the level of the rules
	readonly heat: Level | null; // the level of the heat, from risk.json
	readonly isCapped: boolean; // the step has no open decision, so the level of the rules is 2
	readonly user?: Level;
}

// The level of a step now (P30). The level of the rules is the level of the heat if the step has an open decision. With
// no open decision, it is at most 2: Claude writes the step, and the user walks the receipt (decision 31). Level 5 stays
// a step of the user (decision 33). A step with no field decisions has the level of the heat only (P34)
export function levelOf(step: PlanStep, risk: RiskFile | undefined, levels: LevelsFile | undefined): StepLevel {
	const user = levels?.levels[step.id]?.level;
	// the step of an issue is a step of the user by default, also with no open decision (decision 37)
	if (step.issue) {
		return { level: user ?? ISSUE_LEVEL, rule: ISSUE_LEVEL, heat: null, isCapped: false, ...(user ? { user } : {}) };
	}
	const heat = risk?.steps[step.id]?.level ?? null;
	const decisions = decisionsOf(step, levels);
	const isCapped = !!decisions && heat !== null && heat > 2 && heat < 5 && !decisions.some((d) => d.answer === undefined);
	const rule: Level | null = isCapped ? 2 : heat;
	return { level: user ?? rule, rule, heat, isCapped, ...(user ? { user } : {}) };
}

// The reason of the level of the rules for a step with no open decision (P30)
export const cappedReason = (heat: Level): string =>
	`The step has no open decision, so its level is at most 2. The heat gave level ${heat}.`;

// The reasons of the level of the rules for a step: the rules of the heat, and the rule of the open decisions
export function levelReasons(step: PlanStep, risk: RiskFile | undefined, levels: LevelsFile | undefined): string[] {
	const reasons = [...(risk?.steps[step.id]?.reasons ?? [])];
	const l = levelOf(step, risk, levels);
	return l.isCapped && l.heat ? [...reasons, cappedReason(l.heat)] : reasons;
}

export const writerOf = (level: Level | null): StepWriter | undefined => (level ? LEVEL_INFO[level].writer : undefined);

export const STEP_WRITERS: readonly StepWriter[] = ['user', 'frame', 'claude'];
export const isStepWriter = (value: unknown): value is StepWriter => typeof value === 'string' && (STEP_WRITERS as readonly string[]).includes(value);

// The writer of a step now: the writer that the user selected, else the writer of the level (decision 44)
export const stepWriterOf = (step: PlanStep, risk: RiskFile | undefined, levels: LevelsFile | undefined): StepWriter | undefined =>
	levels?.levels[step.id]?.writer ?? writerOf(levelOf(step, risk, levels).level);

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
		// the ids of the issues of the review and of the steps of the fixes (decision 43)
		if (id && /^[IF]\d+$/i.test(id)) {
			problems.push(`${label}: the ids I1 and F1 and so on are for the issues and the steps of the fixes of the review. Give a different id, for example S1.`);
		}
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
		const places = placesOf(item.places, label, ctx, problems, placeOf);
		const decisions = decisionList(item.decisions, label, problems);
		if (id && title && text && task) {
			steps.push({ id, title, task, hooks, places, text, checks: checks.slice(0, MAX_CHECKS), ...(note ? { note } : {}), decisions });
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

// The places of a step of a plan: 1 to 10 places, each with the lines and the code of a file that is there, or a new file
function placesOf(value: unknown, label: string, ctx: SurveyContext, problems: string[], placeOf: ReturnType<typeof itemChecks>['placeOf']): PlanPlace[] {
	const places: PlanPlace[] = [];
	const placesRaw = Array.isArray(value) ? value : [];
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
		if (place.insert !== undefined && typeof place.insert !== 'boolean') {
			problems.push(`${placeLabel}: "insert" is true or false.`);
		}
		if (place.new === true) {
			if (place.insert === true) {
				problems.push(`${placeLabel}: a new file has no "insert". Give "insert": true only for lines of a file that is there.`);
			}
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
			places.push({ file: found.file, lines: found.lines, code: found.code, codeLine: found.codeLine, ...(place.insert === true ? { insert: true as const } : {}) });
		}
	});
	return places;
}

// Checks a plan of the fixes of Claude in stage 6 (decision 43). The result has all problems in 1 list (proposal P7). Each
// step names the issues that it fixes, and each issue to fix needs a step. The steps follow the sequence of the issues of
// the user. Their places, checks and decisions get the checks of a plan. Shotgun gives the steps the ids F<first>, F<first
// + 1> and so on. issues: the ids of the issues to fix, in the sequence of the user
export function checkFixPlan(raw: Record<string, unknown>, ctx: SurveyContext, issues: readonly string[], first: number, maxSteps: number)
	: { steps: PlanStep[]; problems: string[] } {
	const problems: string[] = [];
	const { listOf, textField, placeOf } = itemChecks(ctx, problems, new Set<string>());
	const steps: PlanStep[] = [];
	const raws = listOf(raw, 'steps', maxSteps, 'steps');
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
		const title = textField(item, 'title', label, MAX_TITLE);
		const text = textField(item, 'text', label, MAX_TEXT);
		const note = textField(item, 'note', label, MAX_NOTE, true);
		const fixes = Array.isArray(item.fixes) ? [...new Set(item.fixes.filter((f): f is string => typeof f === 'string').map((f) => f.trim().toUpperCase()))] : [];
		if (fixes.length === 0) {
			problems.push(`${label}: give "fixes": the ids of the issues to fix that the step fixes, for example ["I1"]. The issues to fix are ${issues.join(', ')}.`);
		}
		fixes.filter((f) => !issues.includes(f)).forEach((f) => problems.push(`${label}: ${f} is not an issue to fix of this round. The issues to fix are `
			+ `${issues.join(', ')}.`));
		const checks = Array.isArray(item.checks) ? item.checks.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean) : [];
		if (checks.length === 0) {
			problems.push(`${label}: give 1 to ${MAX_CHECKS} "checks": what the user checks after the step.`);
		} else if (checks.length > MAX_CHECKS || checks.some((c) => c.length > MAX_CHECK)) {
			problems.push(`${label}: give a maximum of ${MAX_CHECKS} checks, each with a maximum of ${MAX_CHECK} characters.`);
		}
		const places = placesOf(item.places, label, ctx, problems, placeOf);
		const decisions = decisionList(item.decisions, label, problems);
		if (title && text && fixes.length > 0) {
			steps.push({
				id: `F${first + i}`, title, task: 'review', hooks: [], places, text, checks: checks.slice(0, MAX_CHECKS), ...(note ? { note } : {}), decisions,
				fixes: fixes.filter((f) => issues.includes(f)),
			});
		}
	});
	// each issue to fix needs a step, and the steps follow the sequence of the user
	issues.filter((id) => !steps.some((s) => s.fixes?.includes(id))).forEach((id) => problems.push(`The issue ${id} has no step. Each issue to fix needs `
		+ '1 step or more.'));
	let last = 0;
	for (const step of steps) {
		const n = Math.min(...(step.fixes ?? []).map((f) => issues.indexOf(f) + 1).filter((x) => x > 0));
		if (n < last) {
			problems.push(`The step for ${step.fixes?.join(', ')} comes after a step for a later issue. Give the steps in the sequence of the issues: ${issues.join(', ')}.`);
		}
		last = Math.max(last, n === Infinity ? 0 : n);
	}
	return { steps, problems };
}

// The open decisions of a step of Claude (P27), or of the fix of an issue of the review (P19): 0 to 3, each with a
// question and the options that Claude sees. Shotgun gives them the ids D1 to D3 in their sequence
export function decisionList(value: unknown, label: string, problems: string[], kind: 'step' | 'issue' = 'step'): PlanDecision[] {
	if (!Array.isArray(value)) {
		problems.push(kind === 'step'
			? `${label}: give "decisions": the open decisions of the step, 0 to ${MAX_DECISIONS}. An open decision is a choice that the brief, `
				+ 'the answers of the user and the order do not settle. Give an empty list for a step with no open decision.'
			: `${label}: "decisions" must be a list of 0 to ${MAX_DECISIONS} open decisions of the fix.`);
		return [];
	}
	if (value.length > MAX_DECISIONS) {
		problems.push(kind === 'step' ? `${label}: give a maximum of ${MAX_DECISIONS} "decisions". Split a step with more decisions into 2 steps.`
			: `${label}: give a maximum of ${MAX_DECISIONS} "decisions" for the fix.`);
	}
	const decisions: PlanDecision[] = [];
	value.slice(0, MAX_DECISIONS).forEach((d, k) => {
		const decisionLabel = `${label}, decision ${k + 1}`;
		const item = (typeof d === 'object' && d !== null && !Array.isArray(d) ? d : {}) as Record<string, unknown>;
		const question = typeof item.question === 'string' ? item.question.trim().replace(/\s+/g, ' ') : '';
		if (!question || question.length > MAX_DECISION_QUESTION) {
			problems.push(`${decisionLabel}: give a "question" of 1 to ${MAX_DECISION_QUESTION} characters.`);
			return;
		}
		if (decisions.some((x) => x.question.toLowerCase() === question.toLowerCase())) {
			problems.push(`${decisionLabel}: the step has the question "${question}" 2 times.`);
			return;
		}
		const raw = item.options === undefined ? [] : item.options;
		const options = Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string').map((o) => o.trim().replace(/\s+/g, ' ')).filter(Boolean) : undefined;
		if (!options || options.length > MAX_OPTIONS || options.some((o) => o.length > MAX_OPTION)) {
			problems.push(`${decisionLabel}: give 0 to ${MAX_OPTIONS} "options", each with a maximum of ${MAX_OPTION} characters.`);
			return;
		}
		decisions.push({ id: `D${k + 1}`, question, ...(options.length > 0 ? { options } : {}) });
	});
	return decisions;
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
// True if the value has the fields of a step of a plan, also of a step of the plan of the fixes
export function isPlanStep(s: unknown): s is PlanStep {
	const isPlace = (p: unknown) => isObject(p) && typeof p.file === 'string' && (p.lines === undefined || isLines(p.lines));
	const isDecision = (d: unknown) => isObject(d) && typeof d.id === 'string' && typeof d.question === 'string' && (d.options === undefined || isStrings(d.options));
	return isObject(s) && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.task === 'string'
		&& isStrings(s.hooks) && Array.isArray(s.places) && s.places.every(isPlace) && typeof s.text === 'string' && isStrings(s.checks)
		&& (s.decisions === undefined || (Array.isArray(s.decisions) && s.decisions.every(isDecision)))
		&& (s.fixes === undefined || isStrings(s.fixes));
}

export function parsePlan(text: string, id: string): PlanFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/plan.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	checkVersion(value, name, 'version, time and steps');
	if (typeof value.time !== 'string' || !Array.isArray(value.steps) || !value.steps.every(isPlanStep)) {
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
	const isAnswer = (a: unknown) => isObject(a) && typeof a.question === 'string' && typeof a.text === 'string' && typeof a.time === 'string';
	const isAdded = (d: unknown) => isObject(d) && typeof d.id === 'string' && typeof d.question === 'string' && typeof d.time === 'string';
	const isUser = (l: unknown) => isObject(l) && (l.level === undefined || isLevel(l.level)) && (l.note === undefined || typeof l.note === 'string')
		&& (l.writer === undefined || isStepWriter(l.writer))
		&& typeof l.time === 'string' && (l.answers === undefined || (isObject(l.answers) && Object.values(l.answers).every(isAnswer)))
		&& (l.added === undefined || (Array.isArray(l.added) && l.added.every(isAdded)));
	if (!isObject(value.levels) || !Object.values(value.levels).every(isUser)) {
		throw new Error(`${name} needs the fields version and levels.`);
	}
	return value as unknown as LevelsFile;
}
