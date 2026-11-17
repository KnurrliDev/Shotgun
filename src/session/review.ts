import { decisionList, PlanDecision } from './plan';
import { itemChecks, Lines, SurveyContext } from './survey';

// The review of stage 6 (the decisions 35 to 38, and the proposals P16 to P25 of the plan). review.json keeps the base of
// the task from the gate "Accept the plan", the effort and the focus of the user, and the issues of each round of the
// review of Claude. Claude gives its issues with submit_review. Shotgun checks them, and puts each issue into the list of
// steps or into the second list. These functions use no VS Code API, so the unit tests can call them directly.

export const REVIEW_FILE = 'review.json';

// The effort levels of /code-review (decision 36). The effort sets the finders, the context and the verify pass, but not
// the number of issues (decision 38)
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'medium';

export interface EffortInfo {
	readonly name: string;
	readonly finders: string;
	readonly context: string;
	readonly verify: string;
}

// The table of the efforts in section 6.10 of the plan. It comes from the research report "Agentic code review design"
export const EFFORT_INFO: Readonly<Record<Effort, EffortInfo>> = {
	low: {
		name: 'Low',
		finders: '1 generalist finder.',
		context: 'The hunks, and the facts of DataFlow for the changed functions.',
		verify: '1 short verdict for each candidate. Low drops the plausible candidates.',
	},
	medium: {
		name: 'Medium',
		finders: '1 finder for each area of the focus, and 1 generalist finder.',
		context: 'Also the ripple of each hunk, and the read tools of DataFlow on demand.',
		verify: '1 verify subagent for each candidate.',
	},
	high: {
		name: 'High',
		finders: 'As medium, and a second pass with a different order of the hunks. The verify pass checks the union of the passes, with no vote.',
		context: 'As medium.',
		verify: 'As medium. For race and lifetime candidates, the verifier reasons first.',
	},
	xhigh: {
		name: 'Extra high',
		finders: 'As high, and 1 more pass for each hot changed function.',
		context: 'Also the callers of each hot changed function.',
		verify: 'As high.',
	},
	max: {
		name: 'Max',
		finders: 'As extra high, with up to 5 passes for the finders of races and lifetime.',
		context: 'As extra high.',
		verify: 'As extra high. A second verifier only with new evidence, for example a sanitizer run that the user agrees to.',
	},
};

// The areas of the focus (decision 36)
export const AREAS = ['correctness', 'threads', 'lifetime', 'brief', 'tests', 'cleanups'] as const;
export type Area = (typeof AREAS)[number];
// The default focus is all areas except cleanups (decision 38)
export const DEFAULT_AREAS: readonly Area[] = ['correctness', 'threads', 'lifetime', 'brief', 'tests'];

// The categories of an issue, and the area of each category
export const CATEGORIES = ['correctness', 'race', 'deadlock', 'lifetime', 'spec', 'scope', 'test', 'cleanup'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface AreaInfo {
	readonly name: string;
	readonly categories: readonly Category[];
	readonly looksFor: string;
}

export const AREA_INFO: Readonly<Record<Area, AreaInfo>> = {
	correctness: {
		name: 'Correctness', categories: ['correctness'],
		looksFor: 'Code that does not do what the step or the brief needs, also a null pointer, a bound or an error path.',
	},
	threads: {
		name: 'Threads and races', categories: ['race', 'deadlock'],
		looksFor: 'Data that 2 threads can use at the same time with no protection. A deadlock only with a cycle in the lock order from DataFlow.',
	},
	lifetime: {
		name: 'Lifetime', categories: ['lifetime'],
		looksFor: 'Data that a thread or a lambda uses after the end of its owner, a leak, or a double free.',
	},
	brief: {
		name: 'The brief', categories: ['spec', 'scope'],
		looksFor: 'A spec or a condition of done that the diff does not give, and a change that the brief puts out of scope.',
	},
	tests: {
		name: 'Tests', categories: ['test'],
		looksFor: 'A condition of done of the brief with no test. No general request for tests.',
	},
	cleanups: {
		name: 'Cleanups', categories: ['cleanup'],
		looksFor: 'Code that works, but repeats code or does more work than necessary. Off by default.',
	},
};

export const areaOf = (category: Category): Area => AREAS.find((a) => AREA_INFO[a].categories.includes(category)) ?? 'correctness';

export const SEVERITIES = ['important', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];
// new: the task added the problem. pre-existing: the problem was in the code before the task
export const ORIGINS = ['new', 'pre-existing'] as const;
export type Origin = (typeof ORIGINS)[number];
// confirmed: the verify pass found the failure scenario in the code. plausible: it did not confirm it, but it found no
// proof against it
export const VERDICTS = ['confirmed', 'plausible'] as const;
export type Verdict = (typeof VERDICTS)[number];
// engine: the candidate came from a fact of DataFlow. model: from Claude alone (decision 13)
export const SOURCES = ['engine', 'model'] as const;
export type Source = (typeof SOURCES)[number];

export const MAX_ISSUES = 32; // in 1 round, as the report of /code-review
export const MAX_FOCUS_TEXT = 300;
export const MAX_ISSUE_REASON = 500;
const MAX_TITLE = 60;
const MAX_SUMMARY = 300;
const MAX_SCENARIO = 400;
const MAX_EVIDENCE = 400;
const MAX_FIX_PLACES = 4;
const MAX_TOOLS = 6;
// a place of an issue in the diff can be this number of lines before or after a hunk, for example a check that is absent
// in the line before a changed line
const HUNK_MARGIN = 3;
// the cap on the steps (P22): 3 steps, plus 1 step for each 100 changed lines of the task, with a maximum of 10
const CAP_BASE = 3;
const CAP_LINES = 100;
const CAP_MAX = 10;

// The base of the task at the first gate "Accept the plan" (P17): the commit of HEAD, and the files with changes that
// were not committed then. error: why the task has no base commit, for example no repository of git
export interface TaskBase {
	readonly commit?: string;
	readonly dirty: readonly string[]; // relative to the first folder of the project
	readonly time: string;
	readonly error?: string;
}

// The effort and the focus of the user for the next review (decision 36)
export interface ReviewOptions {
	readonly effort: Effort;
	readonly areas: readonly Area[];
	readonly text?: string;
}

export const DEFAULT_OPTIONS: ReviewOptions = { effort: DEFAULT_EFFORT, areas: DEFAULT_AREAS };

// The prompt of the review for a new session of Claude Code. A new session did not write the code of the task, so it
// reviews with a fresh view (decision 35). The skill gets the effort and the focus from get_review again
export function reviewPrompt(title: string, options: ReviewOptions): string {
	const areas = options.areas.map((a) => AREA_INFO[a].name.toLowerCase());
	return `Review my Shotgun task "${title}" with the skill shotgun-review, at the effort ${EFFORT_INFO[options.effort].name.toLowerCase()} with the `
		+ `focus ${areas.length > 1 ? `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}` : areas[0]}`
		+ `${options.text ? `. Look also at this point of mine: ${options.text.replace(/[.!?]+$/, '')}` : ''}. Get the data with shotgun_get_review, start the subagents that `
		+ 'the effort needs, and give the issues with shotgun_submit_review. Change no file.';
}

// A place of an issue: the file, the lines, and a short text of the code in the lines. codeLine: the line where the code
// starts, so the place moves with its code
export interface IssuePlace {
	readonly file: string; // relative to the first folder of the project
	readonly lines: Lines;
	readonly code: string;
	readonly codeLine: number;
}

// The failure scenario (P19): the trigger, the path through the changed code and the wrong result. A race also gives the
// 2 accesses and 1 interleave of the 2 threads
export interface IssueScenario {
	readonly trigger: string;
	readonly path: string;
	readonly result: string;
	readonly interleave?: string;
}

// steps: the list of steps. second: the second list, for an issue that is plausible, pre-existing or above the cap
export type IssueList = 'steps' | 'second';
export type SecondReason = 'plausible' | 'pre-existing' | 'cap';
export type IssueState = 'open' | 'fixed' | 'closed';

// An issue of Claude, as Claude gives it, before Shotgun gives it an id and a list
export interface IssueInput {
	readonly title: string;
	readonly summary: string;
	readonly scenario: IssueScenario;
	readonly category: Category;
	readonly severity: Severity;
	readonly origin: Origin;
	readonly verdict: Verdict;
	readonly source: Source;
	readonly place: IssuePlace;
	readonly fixPlaces?: readonly IssuePlace[];
	readonly decisions: readonly PlanDecision[];
	readonly tools: readonly string[];
	readonly repeats?: string; // the id of the earlier issue that this issue repeats
	readonly evidence?: string; // the new evidence for a closed issue that Claude names again
}

export interface ReviewIssue extends IssueInput {
	readonly id: string; // I1, I2 and so on, in the sequence of the task
	readonly round: number; // the round that gave the issue first
	readonly lastRound: number; // the last round that gave the issue
	readonly list: IssueList;
	readonly secondReason?: SecondReason;
	readonly state: IssueState;
	readonly closed?: { readonly reason: string; readonly time: string };
}

// A round of the review: the effort and the focus, the changed lines and the cap on the steps, and the hashes of the
// hunks of the diff (P23)
export interface ReviewRound {
	readonly n: number;
	readonly time: string;
	readonly effort: Effort;
	readonly areas: readonly Area[];
	readonly text?: string;
	readonly changedLines: number;
	readonly cap: number;
	readonly hunks: readonly string[];
	readonly note?: string; // a short note of Claude, for example the parts that it did not review
}

export interface ReviewFile {
	readonly version: 1;
	readonly base?: TaskBase;
	readonly options?: ReviewOptions;
	readonly rounds: readonly ReviewRound[];
	readonly issues: readonly ReviewIssue[];
	readonly nextId: number;
}

export const EMPTY_REVIEW: ReviewFile = { version: 1, rounds: [], issues: [], nextId: 1 };

// The cap on the steps from the size of the diff (P22). Each changed line counts: an added line and a removed line
export const capOf = (changedLines: number): number => Math.min(CAP_MAX, CAP_BASE + Math.floor(Math.max(0, changedLines) / CAP_LINES));

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { important: 0, minor: 1 };

// The round that a new review writes: 1 for the first review. The same round again while no issue of the last round is
// fixed, else the next round (P23)
export function roundOf(review: ReviewFile | undefined): number {
	const last = review?.rounds[review.rounds.length - 1];
	if (!last) {
		return 1;
	}
	const isFixed = review!.issues.some((i) => i.lastRound === last.n && i.state === 'fixed');
	return isFixed ? last.n + 1 : last.n;
}

// The list of each issue (P22). The list of steps has the confirmed new issues that are open, the important issues first,
// up to the cap. The second list has the plausible issues, the pre-existing issues and the issues above the cap. A closed
// or fixed issue keeps its list. The sequence: the important issues first, then the minor issues, each in the sequence
// of Claude
export function assignLists(issues: readonly ReviewIssue[], cap: number): ReviewIssue[] {
	const indexed = issues.map((issue, i) => ({ issue, i }));
	indexed.sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.i - b.i);
	let steps = 0;
	return indexed.map(({ issue }) => {
		if (issue.state !== 'open') {
			return issue;
		}
		const { secondReason: _old, ...rest } = issue;
		if (issue.verdict === 'plausible') {
			return { ...rest, list: 'second', secondReason: 'plausible' };
		}
		if (issue.origin === 'pre-existing') {
			return { ...rest, list: 'second', secondReason: 'pre-existing' };
		}
		if (steps >= cap) {
			return { ...rest, list: 'second', secondReason: 'cap' };
		}
		steps += 1;
		return { ...rest, list: 'steps' };
	});
}

//-------------------
// The check of a review of Claude

export interface ReviewContext extends SurveyContext {
	// the changed lines of the task by file, relative to the first folder of the project, from the diff since the base
	readonly hunks: ReadonlyMap<string, readonly Lines[]>;
	// the lines that the changes reach by file, from the ripple of DataFlow. undefined: no ripple
	readonly ripple?: ReadonlyMap<string, readonly Lines[]>;
	// the issues of the review before this review
	readonly earlier: readonly ReviewIssue[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const overlaps = (a: Lines, b: Lines, margin = 0): boolean => a[0] <= b[1] + margin && b[0] <= a[1] + margin;

// The place is in the diff of the task, or in the lines that the changes reach (P19)
function isInReview(place: { file: string; lines: Lines }, ctx: ReviewContext): boolean {
	return (ctx.hunks.get(place.file) ?? []).some((h) => overlaps(place.lines, h, HUNK_MARGIN))
		|| (ctx.ripple?.get(place.file) ?? []).some((r) => overlaps(place.lines, r));
}

function enumOf<T extends string>(value: unknown, all: readonly T[], label: string, key: string, problems: string[]): T | undefined {
	if (typeof value === 'string' && (all as readonly string[]).includes(value)) {
		return value as T;
	}
	problems.push(`${label}: "${key}" must be ${all.length === 2 ? `${all[0]} or ${all[1]}` : `1 of ${all.join(', ')}`}.`);
	return undefined;
}

// Checks a review of Claude. The result has all problems in 1 list (proposal P7). A review with a problem goes into no
// file
export function checkReview(raw: Json, ctx: ReviewContext): { issues: IssueInput[]; note?: string; problems: string[] } {
	const problems: string[] = [];
	const { listOf, textField, placeOf } = itemChecks(ctx, problems, new Set<string>());
	const note = textOf(raw.note);
	if (note.length > MAX_SUMMARY) {
		problems.push(`The "note" has more than ${MAX_SUMMARY} characters.`);
	}
	if (raw.issues === undefined) {
		problems.push(`Give "issues": a list of 0 to ${MAX_ISSUES} issues, the most severe first. Give an empty list for a review with no issue.`);
	}
	const issues: IssueInput[] = [];
	const earlier = new Map(ctx.earlier.map((i) => [i.id.toLowerCase(), i]));
	const repeated = new Set<string>();
	listOf(raw, 'issues', MAX_ISSUES, 'issues. Keep the issues that matter most').forEach((value, n) => {
		const label = `Issue ${n + 1}`;
		if (!isObject(value)) {
			problems.push(`${label} is not an object.`);
			return;
		}
		const title = textField(value, 'title', label, MAX_TITLE);
		const summary = textField(value, 'summary', label, MAX_SUMMARY);
		const category = enumOf(value.category, CATEGORIES, label, 'category', problems);
		const severity = enumOf(value.severity, SEVERITIES, label, 'severity', problems);
		const origin = enumOf(value.origin, ORIGINS, label, 'origin', problems);
		const verdict = enumOf(value.verdict, VERDICTS, label, 'verdict', problems);
		const source = enumOf(value.source, SOURCES, label, 'source', problems);

		// the failure scenario
		let scenario: IssueScenario | undefined;
		if (!isObject(value.scenario)) {
			problems.push(`${label}: give the "scenario": the "trigger", the "path" through the changed code, and the wrong "result".`);
		} else {
			const s = value.scenario;
			const trigger = textField(s, 'trigger', `${label}, scenario`, MAX_SCENARIO);
			const pathText = textField(s, 'path', `${label}, scenario`, MAX_SCENARIO);
			const result = textField(s, 'result', `${label}, scenario`, MAX_SCENARIO);
			const interleave = textField(s, 'interleave', `${label}, scenario`, MAX_SCENARIO, true);
			if (category === 'race' && !interleave) {
				problems.push(`${label}: a race needs the "interleave" in the scenario: the 2 accesses and 1 interleave of the 2 threads.`);
			}
			if (trigger && pathText && result) {
				scenario = { trigger, path: pathText, result, ...(interleave ? { interleave } : {}) };
			}
		}

		// the place, and the places of the fix
		let place: IssuePlace | undefined;
		if (!isObject(value.place)) {
			problems.push(`${label}: give the "place": the "file", the "lines" and the "code", a short text of the code in the lines.`);
		} else {
			place = placeOf(value.place, `${label}, place`, true);
			if (place && !isInReview(place, ctx)) {
				problems.push(`${label}: ${place.file}:${place.lines[0]} is not in the diff of the task${ctx.ripple ? ' or in its ripple' : ''}. `
					+ 'Give a place on a changed line, or in the code that the changes reach.');
				place = undefined;
			}
		}
		let fixPlaces: IssuePlace[] | undefined;
		if (value.fixPlaces !== undefined) {
			if (!Array.isArray(value.fixPlaces) || value.fixPlaces.length > MAX_FIX_PLACES) {
				problems.push(`${label}: "fixPlaces" must be a list of 0 to ${MAX_FIX_PLACES} places.`);
			} else {
				fixPlaces = [];
				value.fixPlaces.forEach((p, k) => {
					const found = isObject(p) ? placeOf(p, `${label}, fix place ${k + 1}`, true) : undefined;
					if (!isObject(p)) {
						problems.push(`${label}, fix place ${k + 1} is not an object.`);
					}
					if (found) {
						fixPlaces!.push(found);
					}
				});
			}
		}

		// the open decisions of the fix, as the open decisions of a step of the plan
		const decisions = value.decisions === undefined ? [] : decisionList(value.decisions, label, problems, 'issue');

		// the read tools of DataFlow that show the issue (decision 13)
		const tools: string[] = [];
		if (!Array.isArray(value.tools) || value.tools.length === 0 || value.tools.length > MAX_TOOLS) {
			problems.push(`${label}: give "tools": 1 to ${MAX_TOOLS} read tools of DataFlow that show the issue, for example get_threads.`);
		} else {
			for (const t of value.tools) {
				const tool = textOf(t).replace(/^mcp__plugin_dataflow_dataflow__/, '');
				if (!tool) {
					problems.push(`${label}: each item of "tools" must be the name of a read tool of DataFlow.`);
				} else if (ctx.tools.length > 0 && !ctx.tools.includes(tool)) {
					problems.push(`${label}: "${tool}" is not a read tool of DataFlow.`);
				} else if (ctx.called && !ctx.called.has(tool)) {
					problems.push(`${label}: nobody called ${tool} in this stage. Call it, and give only an issue that it shows.`);
				} else if (!tools.includes(tool)) {
					tools.push(tool);
				}
			}
		}

		// an issue that repeats an earlier issue keeps its id and its state. A closed issue needs new evidence (P35)
		let repeats: string | undefined;
		let evidence: string | undefined;
		if (value.repeats !== undefined) {
			const id = textOf(value.repeats);
			const found = earlier.get(id.toLowerCase());
			if (!found) {
				problems.push(`${label}: "repeats" names ${id || 'no issue'}, but the earlier review has no such issue.`);
			} else if (repeated.has(found.id)) {
				problems.push(`${label}: an other issue repeats ${found.id} already. Give each earlier issue 1 time.`);
			} else {
				repeats = found.id;
				repeated.add(found.id);
				evidence = textField(value, 'evidence', label, MAX_EVIDENCE, true);
				if (found.state === 'closed' && !evidence) {
					problems.push(`${label}: the user closed ${found.id} as "Not a problem": ${found.closed?.reason ?? ''} Give it again only with new `
						+ '"evidence", or remove it.');
				}
				if (found.state === 'closed' && verdict === 'confirmed') {
					problems.push(`${label}: an issue that the user closed comes again only with the verdict plausible.`);
				}
			}
		}

		if (title && summary && scenario && category && severity && origin && verdict && source && place && tools.length > 0) {
			issues.push({
				title, summary, scenario, category, severity, origin, verdict, source, place, ...(fixPlaces && fixPlaces.length > 0 ? { fixPlaces } : {}),
				decisions, tools, ...(repeats ? { repeats } : {}), ...(evidence ? { evidence } : {}),
			});
		}
	});

	// 2 issues at the same place with the same title are 1 issue
	const keys = new Set<string>();
	for (const issue of issues) {
		const key = `${issue.place.file}:${issue.place.lines[0]}:${issue.title.toLowerCase()}`;
		if (keys.has(key)) {
			problems.push(`The issue "${issue.title}" at ${issue.place.file}:${issue.place.lines[0]} is there 2 times. Remove the duplicates.`);
		}
		keys.add(key);
	}
	return { issues, ...(note ? { note } : {}), problems };
}

// The review after a new review of Claude. A new review of the same round replaces the open issues of that round. An issue
// that repeats an earlier issue keeps its id and its state, and a repeated closed or fixed issue opens again. The issues
// that the user decided stay. time: the time of the review
export function applyReview(review: ReviewFile, round: Omit<ReviewRound, 'time' | 'cap'>, inputs: readonly IssueInput[], time: string)
	: { review: ReviewFile; added: number; repeated: number } {
	const repeats = new Map(inputs.filter((i) => i.repeats).map((i) => [i.repeats!, i]));
	let nextId = review.nextId;
	const others: ReviewIssue[] = []; // the issues that keep their state and their list
	const current: ReviewIssue[] = []; // the open issues of this round, which get their lists
	for (const old of review.issues) {
		const input = repeats.get(old.id);
		if (input) {
			const { repeats: _r, ...fields } = input;
			const { closed: _c, secondReason: _s, ...rest } = old;
			current.push({ ...rest, ...fields, id: old.id, round: old.round, lastRound: round.n, list: 'steps', state: 'open' });
		} else if (!(old.lastRound === round.n && old.state === 'open')) {
			others.push(old);
		}
		// an open issue of an earlier review of this round goes away: the new review replaces it
	}
	for (const input of inputs.filter((i) => !i.repeats)) {
		current.push({ ...input, id: `I${nextId++}`, round: round.n, lastRound: round.n, list: 'steps', state: 'open' });
	}
	const cap = capOf(round.changedLines);
	const rounds = [...review.rounds.filter((r) => r.n !== round.n), { ...round, cap, time }].sort((a, b) => a.n - b.n);
	return { review: { ...review, rounds, issues: [...others, ...assignLists(current, cap)], nextId }, added: inputs.length - repeats.size, repeated: repeats.size };
}

// The issues of a list
export const issuesOf = (review: ReviewFile | undefined, list: IssueList): ReviewIssue[] => (review?.issues ?? []).filter((i) => i.list === list);

//-------------------
// The file

const isLines = (value: unknown): value is Lines => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isIn = <T extends string>(value: unknown, all: readonly T[]): value is T => typeof value === 'string' && (all as readonly string[]).includes(value);

function parsePlace(value: unknown): IssuePlace | undefined {
	if (!isObject(value) || typeof value.file !== 'string' || !isLines(value.lines) || typeof value.code !== 'string' || !Number.isInteger(value.codeLine)) {
		return undefined;
	}
	return { file: value.file, lines: [value.lines[0], value.lines[1]], code: value.code, codeLine: value.codeLine as number };
}

function parseIssue(value: unknown): ReviewIssue | undefined {
	if (!isObject(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.summary !== 'string'
		|| !Number.isInteger(value.round) || !Number.isInteger(value.lastRound) || !isObject(value.scenario)
		|| !isIn(value.category, CATEGORIES) || !isIn(value.severity, SEVERITIES) || !isIn(value.origin, ORIGINS) || !isIn(value.verdict, VERDICTS)
		|| !isIn(value.source, SOURCES) || !isIn(value.list, ['steps', 'second'] as const) || !isIn(value.state, ['open', 'fixed', 'closed'] as const)
		|| !isStrings(value.tools) || !Array.isArray(value.decisions)) {
		return undefined;
	}
	const place = parsePlace(value.place);
	const s = value.scenario;
	if (!place || typeof s.trigger !== 'string' || typeof s.path !== 'string' || typeof s.result !== 'string') {
		return undefined;
	}
	const fixPlaces = Array.isArray(value.fixPlaces) ? value.fixPlaces.map(parsePlace) : undefined;
	if (fixPlaces?.some((p) => !p)) {
		return undefined;
	}
	const decisions = value.decisions.filter((d): d is PlanDecision => isObject(d) && typeof d.id === 'string' && typeof d.question === 'string'
		&& (d.options === undefined || isStrings(d.options)));
	const closed = isObject(value.closed) && typeof value.closed.reason === 'string' && typeof value.closed.time === 'string'
		? { reason: value.closed.reason, time: value.closed.time } : undefined;
	return {
		id: value.id, round: value.round as number, lastRound: value.lastRound as number, title: value.title, summary: value.summary,
		scenario: { trigger: s.trigger, path: s.path, result: s.result, ...(typeof s.interleave === 'string' ? { interleave: s.interleave } : {}) },
		category: value.category, severity: value.severity, origin: value.origin, verdict: value.verdict, source: value.source, place,
		...(fixPlaces && fixPlaces.length > 0 ? { fixPlaces: fixPlaces as IssuePlace[] } : {}), decisions, tools: value.tools,
		...(typeof value.repeats === 'string' ? { repeats: value.repeats } : {}), ...(typeof value.evidence === 'string' ? { evidence: value.evidence } : {}),
		list: value.list, ...(isIn(value.secondReason, ['plausible', 'pre-existing', 'cap'] as const) ? { secondReason: value.secondReason } : {}),
		state: value.state, ...(closed ? { closed } : {}),
	};
}

function parseOptions(value: unknown): ReviewOptions | undefined {
	if (!isObject(value) || !isIn(value.effort, EFFORTS) || !Array.isArray(value.areas)) {
		return undefined;
	}
	const areas = value.areas.filter((a): a is Area => isIn(a, AREAS));
	return { effort: value.effort, areas, ...(typeof value.text === 'string' && value.text ? { text: value.text } : {}) };
}

function parseRound(value: unknown): ReviewRound | undefined {
	if (!isObject(value) || !Number.isInteger(value.n) || typeof value.time !== 'string' || !isIn(value.effort, EFFORTS) || !Array.isArray(value.areas)
		|| !Number.isInteger(value.changedLines) || !Number.isInteger(value.cap) || !isStrings(value.hunks)) {
		return undefined;
	}
	return {
		n: value.n as number, time: value.time, effort: value.effort, areas: value.areas.filter((a): a is Area => isIn(a, AREAS)),
		...(typeof value.text === 'string' && value.text ? { text: value.text } : {}), changedLines: value.changedLines as number, cap: value.cap as number,
		hunks: value.hunks, ...(typeof value.note === 'string' && value.note ? { note: value.note } : {}),
	};
}

function parseBase(value: unknown): TaskBase | undefined {
	if (!isObject(value) || typeof value.time !== 'string' || !isStrings(value.dirty)) {
		return undefined;
	}
	return {
		...(typeof value.commit === 'string' && value.commit ? { commit: value.commit } : {}), dirty: value.dirty, time: value.time,
		...(typeof value.error === 'string' && value.error ? { error: value.error } : {}),
	};
}

// id: the name of the folder of the task
export function parseReview(text: string, id: string): ReviewFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${REVIEW_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > 1) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version 1. Install a newer version of Shotgun.`);
	}
	if (value.version !== 1 || !Array.isArray(value.rounds) || !Array.isArray(value.issues) || !Number.isInteger(value.nextId)) {
		throw new Error(`${name} needs the fields version, rounds, issues and nextId.`);
	}
	const rounds = value.rounds.map(parseRound);
	const issues = value.issues.map(parseIssue);
	if (rounds.some((r) => !r) || issues.some((i) => !i)) {
		throw new Error(`A round or an issue of ${name} does not have its fields.`);
	}
	const base = value.base === undefined ? undefined : parseBase(value.base);
	const options = value.options === undefined ? undefined : parseOptions(value.options);
	return {
		version: 1, ...(base ? { base } : {}), ...(options ? { options } : {}), rounds: rounds as ReviewRound[], issues: issues as ReviewIssue[],
		nextId: value.nextId as number,
	};
}
