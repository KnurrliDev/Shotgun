import type { DiffFacts, RippleFacts } from '../dataflow/dataflow-api';
import { withoutComments } from '../session/brief';
import { hunkKey } from '../session/build';
import type { TaskFile } from '../session/files';
import { isWalked } from '../session/ledger';
import { hashLine, LineStore } from '../session/lines';
import { absolutePath, IS_CASE_SENSITIVE, projectPath } from '../session/paths';
import {
	AREA_INFO, capOf, checkReview, DEFAULT_OPTIONS, EFFORT_INFO, issuesOf, MAX_ISSUES, ReviewFile, ReviewIssue, roundOf,
} from '../session/review';
import { STAGE_INFO, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import type { Lines } from '../session/survey';
import { stageStart } from './calls';
import { stepsData } from './plan';
import type { SurveyDeps } from './survey';

// The tools of stage 6 (phase 12). get_review gives the diff of the task since its base, the effort and the focus of the
// user, the brief, the steps and the earlier issues. submit_review gives the issues of the review of Claude. Shotgun
// checks each issue, and puts it into the list of steps or into the second list (P18, P19, P22).

// The diff and the ripple of DataFlow since the base commit of the task. The extension makes it from the API of DataFlow,
// and a test can fake it
export interface ReviewApi {
	readonly diff: (base: string, paths: readonly string[]) => Promise<DiffFacts>;
	readonly ripple: (base: string, paths: readonly string[]) => Promise<RippleFacts>;
}

export interface ReviewDeps extends SurveyDeps {
	readonly review: () => ReviewApi | undefined; // undefined: no link to DataFlow
	readonly lines: LineStore;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const NOT_REVIEW = 'The review is only for stage 6, after the gate "The build is done" of the user.';
// the maximum number of the bodies of the ripple in the result of get_review
const MAX_RIPPLE_BODIES = 40;

// The active task in stage 6, else an error for Claude
function requireReview(snapshot: Snapshot): { task: TaskFile; root: string } {
	const { task, root } = snapshot;
	if (!task || !root) {
		throw new Error(`No task is active. ${NOT_REVIEW}`);
	}
	if (task.isDone) {
		throw new Error('The task is done. It has no more review.');
	}
	if (task.stage !== 'review') {
		throw new Error(`The active task is in ${stageText(task.stage)}. ${NOT_REVIEW}`);
	}
	return { task, root };
}

// The files that the task changed (P17): the files of lines.json and of the scopes of the steps of the build, relative to
// the first folder of the project
export function taskFiles(snapshot: Snapshot, lines: LineStore): string[] {
	const files = new Set<string>(lines.paths);
	for (const step of Object.values(snapshot.build?.steps ?? {})) {
		step.scope.forEach((f) => files.add(f));
		(step.newFiles ?? []).forEach((f) => files.add(f));
	}
	return [...files].sort();
}

// A short text of lines, for example "12-20, 31"
const rangesText = (lines: readonly Lines[]): string => lines.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');

// The diff of the task with its changed lines by file, its changed lines and the short hashes of its hunks
interface TaskDiff {
	readonly facts: DiffFacts;
	readonly hunks: Map<string, Lines[]>;
	readonly changedLines: number;
	readonly hashes: string[];
	readonly rel: (file: string) => string;
}

async function taskDiff(api: ReviewApi, root: string, base: string, files: readonly string[]): Promise<TaskDiff> {
	const facts = await api.diff(base, files.map((f) => absolutePath(f, root)));
	const rel = (file: string) => projectPath(absolutePath(file, facts.root), root, IS_CASE_SENSITIVE);
	const hunks = new Map<string, Lines[]>();
	let changedLines = 0;
	const hashes: string[] = [];
	for (const f of facts.files) {
		const file = rel(f.file);
		const list = hunks.get(file) ?? [];
		for (const h of f.hunks) {
			// a hunk of removed lines only has no new lines: it is at its first line
			list.push([h.lines[0], Math.max(h.lines[0], h.lines[1])]);
			changedLines += h.added + h.removed;
			hashes.push(hashLine(hunkKey(file, h.diff, h.added, h.removed)));
		}
		hunks.set(file, list);
	}
	return { facts, hunks, changedLines, hashes, rel };
}

// The lines that the changes reach, by file, from the ripple of DataFlow. undefined: no ripple
async function taskRipple(api: ReviewApi, root: string, base: string, files: readonly string[], rel: (file: string) => string, log?: (m: string) => void)
	: Promise<{ facts: RippleFacts; lines: Map<string, Lines[]> } | undefined> {
	try {
		const facts = await api.ripple(base, files.map((f) => absolutePath(f, root)));
		if (facts.state !== 'ready') {
			log?.(`DataFlow gave no ripple of the task: ${facts.message ?? facts.state}`);
			return undefined;
		}
		const lines = new Map<string, Lines[]>();
		for (const change of facts.changes ?? []) {
			for (const body of change.bodies) {
				const file = rel(body.file);
				const list = lines.get(file) ?? [];
				body.lines.forEach((l) => list.push([l, l]));
				lines.set(file, list);
			}
		}
		return { facts, lines };
	} catch (error) {
		log?.(`DataFlow gave no ripple of the task: ${messageOf(error)}`);
		return undefined;
	}
}

// An issue for the result of a tool
function issueData(issue: ReviewIssue): Record<string, unknown> {
	return {
		id: issue.id, title: issue.title, category: issue.category, severity: issue.severity, origin: issue.origin, verdict: issue.verdict,
		place: `${issue.place.file}:${issue.place.lines[0]}`, list: issue.list, ...(issue.secondReason ? { secondReason: issue.secondReason } : {}),
		state: issue.state, ...(issue.closed ? { reason: issue.closed.reason } : {}), round: issue.lastRound,
	};
}

// The result of get_review
export async function reviewData(deps: ReviewDeps): Promise<Record<string, unknown>> {
	const snapshot = deps.store.snapshot;
	const { task, root } = requireReview(snapshot);
	const review: ReviewFile | undefined = snapshot.review;
	const base = review?.base;
	if (!base?.commit) {
		throw new Error(`The task has no base commit, so Shotgun cannot give its diff: ${base?.error ?? 'the gate "Accept the plan" recorded no base.'} `
			+ 'Tell the user. The review needs a repository of git with a commit at the gate "Accept the plan".');
	}
	const api = deps.review();
	if (!api) {
		throw new Error('Shotgun has no link to DataFlow, so it cannot give the diff of the task. Tell the user.');
	}
	const files = taskFiles(snapshot, deps.lines);
	if (files.length === 0) {
		throw new Error('The task changed no file in the build, so the review has no diff.');
	}
	const diff = await taskDiff(api, root, base.commit, files);
	const options = review!.options ?? DEFAULT_OPTIONS;
	const ripple = options.effort === 'low' ? undefined : await taskRipple(api, root, base.commit, files, diff.rel, deps.log);
	const dirty = new Set(base.dirty);
	const levelOfStep = new Map(stepsData(snapshot).map((s) => [s.id as string, s.level as number | null]));
	const briefFile = deps.store.briefFile();
	const brief = briefFile ? deps.readText(briefFile) : undefined;
	const closedCallouts = Object.entries(snapshot.callouts?.steps ?? {}).flatMap(([step, value]) => value.callouts
		.filter((c) => c.closed).map((c) => ({ step, title: c.title, place: `${c.file}:${c.line}`, reason: c.closed!.reason })));
	const round = roundOf(review);
	return {
		task: { id: task.id, title: task.title, stage: STAGE_INFO[task.stage].number },
		round,
		effort: { level: options.effort, ...EFFORT_INFO[options.effort] },
		focus: {
			areas: options.areas.map((a) => ({ area: a, name: AREA_INFO[a].name, categories: AREA_INFO[a].categories, looksFor: AREA_INFO[a].looksFor })),
			...(options.text ? { text: options.text } : {}),
		},
		base: { commit: base.commit, time: base.time, ...(base.dirty.length > 0 ? { notCommittedBefore: base.dirty } : {}) },
		changedLines: diff.changedLines,
		capOnSteps: capOf(diff.changedLines),
		maxIssues: MAX_ISSUES,
		files: diff.facts.files.map((f) => {
			const file = diff.rel(f.file);
			const runs = deps.lines.runs(file).map((r) => ({
				writer: r.writer, step: r.step, lines: rangesText([r.lines]),
				...(r.writer === 'user' ? { level: levelOfStep.get(r.step) ?? null } : { walked: isWalked(r, snapshot.build) }),
			}));
			return {
				file, ...(f.isNew ? { isNew: true } : {}), ...(f.isCpp === false ? { isCpp: false } : {}),
				...(dirty.has(file) ? { notCommittedBefore: true } : {}),
				hunks: f.hunks.map((h) => ({
					id: h.id, lines: h.lines, added: h.added, removed: h.removed, ...(h.functions ? { functions: h.functions } : {}),
					...(h.heat ? { heat: h.heat.map((x) => ({ function: x.function, score: x.score, band: x.band })) } : {}),
				})),
				...(runs.length > 0 ? { writers: runs } : {}),
			};
		}),
		...(diff.facts.deletedFiles?.length ? { deletedFiles: diff.facts.deletedFiles.map(diff.rel) } : {}),
		...(ripple ? {
			ripple: (ripple.facts.changes ?? []).flatMap((c) => c.bodies.map((b) => ({
				file: diff.rel(b.file), function: b.function, depth: b.depth,
				lines: b.lines.length > 0 ? rangesText([[Math.min(...b.lines), Math.max(...b.lines)]]) : '',
			}))).slice(0, MAX_RIPPLE_BODIES),
		} : { ripple: options.effort === 'low' ? 'The effort low has no ripple.' : 'DataFlow gave no ripple, so only places in the diff are possible.' }),
		...(brief ? { brief: withoutComments(brief).trim() } : {}),
		steps: stepsData(snapshot).map((s, i) => ({ ...s, text: snapshot.plan!.steps[i].text, checks: snapshot.plan!.steps[i].checks })),
		...(closedCallouts.length > 0 ? { closedCallouts } : {}),
		...(snapshot.loose?.ends.some((e) => !e.reason && !e.handed) ? {
			openLooseEnds: snapshot.loose.ends.filter((e) => !e.reason && !e.handed).map((e) => ({ id: e.id, title: e.title })),
		} : {}),
		...(review!.issues.length > 0 ? { earlierIssues: review!.issues.map(issueData) } : {}),
		tools: `For the text of the diff, call get_diff of DataFlow with "base": "${base.commit}" and "paths". For the ripple, call get_ripple `
			+ `with the same base.`,
		next: 'Follow the skill shotgun-review: find the candidates for each area of the focus, check each candidate in a verify pass, and give the '
			+ 'issues with submit_review. Change no file.',
	};
}

// The result of submit_review
export async function submitReview(deps: ReviewDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const snapshot = store.snapshot;
	const { task, root } = requireReview(snapshot);
	const review = snapshot.review;
	const base = review?.base;
	if (!base?.commit) {
		throw new Error(`The task has no base commit: ${base?.error ?? 'the gate "Accept the plan" recorded no base.'} Tell the user.`);
	}
	const api = deps.review();
	if (!api) {
		throw new Error('Shotgun has no link to DataFlow, so it cannot check the review. Tell the user.');
	}
	const files = taskFiles(snapshot, deps.lines);
	const diff = await taskDiff(api, root, base.commit, files);
	const options = review!.options ?? DEFAULT_OPTIONS;
	const ripple = await taskRipple(api, root, base.commit, files, diff.rel, deps.log);
	const engine = deps.engine();
	const called = deps.calls?.(stageStart(task));
	const checked = checkReview(args, {
		root,
		folders: deps.folders(),
		isCaseSensitive: IS_CASE_SENSITIVE,
		readLines: (file) => deps.readText(file)?.split(/\r?\n/),
		tools: engine?.tools() ?? [],
		...(called ? { called } : {}),
		hunks: diff.hunks,
		...(ripple ? { ripple: ripple.lines } : {}),
		earlier: review!.issues,
	});
	if (checked.problems.length > 0) {
		throw new Error(`Shotgun did not take the review. Correct these problems, and call the tool again:\n${checked.problems.map((p) => `- ${p}`).join('\n')}`);
	}
	const round = roundOf(review);
	const result = store.writeReview({
		n: round, effort: options.effort, areas: options.areas, ...(options.text ? { text: options.text } : {}), changedLines: diff.changedLines,
		hunks: diff.hashes, ...(checked.note ? { note: checked.note } : {}),
	}, checked.issues);
	const steps = issuesOf(result.review, 'steps').filter((i) => i.lastRound === round && i.state === 'open');
	const second = issuesOf(result.review, 'second').filter((i) => i.lastRound === round && i.state === 'open');
	return {
		round,
		cap: capOf(diff.changedLines),
		steps: steps.map(issueData),
		second: second.map(issueData),
		...(result.repeated > 0 ? { repeated: result.repeated } : {}),
		next: checked.issues.length === 0
			? 'The review has no issue. Tell the user. The user can select "The task is done", or ask for a review with a different effort or focus.'
			: 'The panel and the page of Shotgun show the 2 lists. Tell the user in a short summary. The user works through the list of steps, and '
				+ 'can close an issue with "Not a problem". Change no file.',
	};
}
