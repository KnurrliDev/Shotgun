import type { DiffFacts, RippleFacts } from '../dataflow/dataflow-api';
import { withoutComments } from '../session/brief';
import { hunkKey } from '../session/build';
import { calloutLine } from '../session/callouts';
import type { TaskFile } from '../session/files';
import { isWalked } from '../session/ledger';
import { hashLine, LineStore } from '../session/lines';
import { absolutePath, IS_CASE_SENSITIVE, projectPath } from '../session/paths';
import { checkFixPlan, levelOf, placeName } from '../session/plan';
import {
	AREA_INFO, capOf, checkReview, currentFixPlan, DEFAULT_OPTIONS, EFFORT_INFO, firstFixNumber, FixItem, issuesOf, issuesToCheck, MAX_FIX_STEPS, MAX_ISSUES,
	ReviewFile, ReviewIssue, reviewPhase, roundOf, toFix,
} from '../session/review';
import { STAGE_INFO, stageText } from '../session/stages';
import { Snapshot, workPlan } from '../session/store';
import type { Lines } from '../session/survey';
import { stageStart } from './calls';
import { planRisk, stepsData } from './plan';
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
	readonly hashOf: Map<string, string>; // the short hash of each hunk, by "file#id"
	readonly rel: (file: string) => string;
}

async function taskDiff(api: ReviewApi, root: string, base: string, files: readonly string[]): Promise<TaskDiff> {
	const facts = await api.diff(base, files.map((f) => absolutePath(f, root)));
	const rel = (file: string) => projectPath(absolutePath(file, facts.root), root, IS_CASE_SENSITIVE);
	const hunks = new Map<string, Lines[]>();
	let changedLines = 0;
	const hashes: string[] = [];
	const hashOf = new Map<string, string>();
	for (const f of facts.files) {
		const file = rel(f.file);
		const list = hunks.get(file) ?? [];
		for (const h of f.hunks) {
			// a hunk of removed lines only has no new lines: it is at its first line
			list.push([h.lines[0], Math.max(h.lines[0], h.lines[1])]);
			changedLines += h.added + h.removed;
			const hash = hashLine(hunkKey(file, h.diff, h.added, h.removed));
			hashes.push(hash);
			hashOf.set(`${file}#${h.id}`, hash);
		}
		hunks.set(file, list);
	}
	return { facts, hunks, changedLines, hashes, hashOf, rel };
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

// The callouts of the build that the user closed, with their lines now. A callout with no line now is gone (P35)
function closedCalloutsOf(snapshot: Snapshot, root: string, readText: (file: string) => string | undefined) {
	return Object.entries(snapshot.callouts?.steps ?? {}).flatMap(([step, value]) => value.callouts.filter((c) => c.closed).map((c) => {
		const lines = c.isGone ? undefined : readText(absolutePath(c.file, root))?.split(/\r?\n/);
		return { step, callout: c, line: lines ? calloutLine(lines, c) : undefined };
	}));
}

// An issue for the result of a tool
function issueData(issue: ReviewIssue): Record<string, unknown> {
	return {
		id: issue.id, title: issue.title, category: issue.category, severity: issue.severity, origin: issue.origin, verdict: issue.verdict,
		place: `${issue.place.file}:${issue.place.lines[0]}`, list: issue.list, ...(issue.secondReason ? { secondReason: issue.secondReason } : {}),
		state: issue.state, ...(issue.closed ? { reason: issue.closed.reason } : {}), round: issue.lastRound,
	};
}

// An issue to fix for the plan of the fixes (decision 43): the issue of the review with its scenario and the hints of the
// review, or the issue of the user. userNote: the note of the user for the plan
function fixItemData(item: FixItem, notes: Readonly<Record<string, string>> | undefined): Record<string, unknown> {
	const note = notes?.[item.issue.id];
	if (item.kind === 'user') {
		return { id: item.issue.id, byUser: true, text: item.issue.text, ...(note ? { userNote: note } : {}) };
	}
	const i = item.issue;
	return {
		id: i.id, title: i.title, summary: i.summary, scenario: i.scenario, severity: i.severity, category: i.category,
		place: `${i.place.file}:${i.place.lines[0]}-${i.place.lines[1]}`,
		...(i.fixPlaces ? { fixPlacesOfTheReview: i.fixPlaces.map((p) => `${p.file}:${p.lines[0]}-${p.lines[1]}`) } : {}),
		...(i.decisions.length > 0 ? { decisionsOfTheReview: i.decisions.map((d) => d.question) } : {}),
		...(note ? { userNote: note } : {}),
	};
}

// The next work for Claude in each part of the round (decision 43)
const REVIEW_NEXT = {
	review: 'Follow the skill shotgun-review: find the candidates for each area of the focus, check each candidate in a verify pass, and give the '
		+ 'issues with submit_review. Change no file.',
	issues: 'The user puts the issues to fix in sequence on the issues page of Shotgun now, and then selects "Accept the issues". Then the user asks '
		+ 'for the plan of the fixes. A new review of this round replaces its issues: follow the skill shotgun-review only on the request of the user. '
		+ 'Change no file.',
	plan: 'Plan the fixes, as the plan of stage 4. Read the code of each issue of "issuesToFix" with the read tools of DataFlow. Then give the steps '
		+ 'with submit_fix_plan, in the sequence of "issuesToFix". Each step names the issues that it fixes in "fixes". Its places are all places that '
		+ 'its fix changes, also a file that the issue does not name. Give the open decisions of each fix, and keep to the note of the user. Change no '
		+ 'file.',
	fixes: 'The steps of the fixes go in sequence, as the steps of the build. Call get_step for the current step. Change files only in an open step '
		+ 'of Claude.',
} as const;

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
	// the levels of the steps of the plan and of the issues, for the lines of the user
	const levelOfStep = new Map((workPlan(snapshot)?.steps ?? []).map((s) => [s.id, levelOf(s, snapshot.risk, snapshot.levels).level as number | null]));
	const briefFile = deps.store.briefFile();
	const brief = briefFile ? deps.readText(briefFile) : undefined;
	const closedCallouts = closedCalloutsOf(snapshot, root, deps.readText).map(({ step, callout: c, line }) => ({
		step, title: c.title, place: `${c.file}:${line ?? c.line}`, reason: c.closed!.reason,
	}));
	const { phase, round } = reviewPhase(review);
	// a new round (P23): the hunks that the last round did not have, and the fixed issues to check
	const last = review!.rounds[review!.rounds.length - 1];
	const lastHunks = last && round > last.n ? new Set(last.hunks) : undefined;
	const toCheck = lastHunks ? issuesToCheck(review) : [];
	const fixPlan = currentFixPlan(review);
	return {
		task: { id: task.id, title: task.title, stage: STAGE_INFO[task.stage].number },
		round,
		phase,
		// the issues to fix in the sequence of the user, for the plan of the fixes (decision 43)
		...(phase !== 'review' ? { issuesToFix: toFix(review).map((x) => fixItemData(x, review?.notes)) } : {}),
		...(fixPlan ? {
			fixPlan: { steps: fixPlan.steps.map((s) => ({ id: s.id, title: s.title, fixes: s.fixes, places: s.places.map(placeName) })) },
		} : {}),
		...(phase === 'plan' ? { firstStepId: `F${firstFixNumber(review, round)}` } : {}),
		...(lastHunks ? {
			roundNote: `Round ${round} reviews the fixes. Review the hunks with "isChangedSinceLastRound": true and their ripple, and check each `
				+ 'issue of "fixedIssues". If a fix is not correct, give its issue again with "repeats" and a summary of the problem that stays. '
				+ 'Give no issue for a correct fix.',
		} : {}),
		effort: { level: options.effort, ...EFFORT_INFO[options.effort] },
		focus: {
			areas: options.areas.map((a) => ({ area: a, name: AREA_INFO[a].name, categories: AREA_INFO[a].categories, looksFor: AREA_INFO[a].looksFor })),
			...(options.text ? { text: options.text } : {}),
		},
		base: { commit: base.commit, time: base.time, ...(base.dirty.length > 0 ? { notCommittedBefore: base.dirty } : {}) },
		changedLines: diff.changedLines,
		capOnSteps: Math.min(capOf(diff.changedLines), snapshot.feedback?.cap ?? Number.MAX_SAFE_INTEGER),
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
					...(lastHunks && !lastHunks.has(diff.hashOf.get(`${file}#${h.id}`) ?? '') ? { isChangedSinceLastRound: true } : {}),
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
		...(toCheck.length > 0 ? {
			fixedIssues: toCheck.map((i) => ({
				id: i.id, title: i.title, summary: i.summary, scenario: i.scenario, place: `${i.place.file}:${i.place.lines[0]}`,
				...(i.fixPlaces ? { fixPlaces: i.fixPlaces.map((p) => `${p.file}:${p.lines[0]}`) } : {}),
			})),
		} : {}),
		tools: `For the text of the diff, call get_diff of DataFlow with "base": "${base.commit}" and "paths". For the ripple, call get_ripple `
			+ `with the same base.`,
		next: REVIEW_NEXT[phase],
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
		closedCallouts: closedCalloutsOf(snapshot, root, deps.readText).flatMap(({ callout: c, line }) => (line
			? [{ file: c.file, line, source: c.source, title: c.title, reason: c.closed!.reason }] : [])),
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
		cap: result.review.rounds.find((r) => r.n === round)?.cap ?? capOf(diff.changedLines),
		toFix: steps.map(issueData),
		forLater: second.map(issueData),
		...(result.repeated > 0 ? { repeated: result.repeated } : {}),
		next: checked.issues.length === 0
			? 'The review has no issue. Tell the user. The user can select "The task is done", or ask for a review with a different effort or focus.'
			: 'The issues page of Shotgun shows the issues to fix and the issues for later. Tell the user in a short summary. The user puts the issues '
				+ 'to fix in sequence, can close an issue with "Not a problem", and then selects "Accept the issues". Then the user asks for the plan of '
				+ 'the fixes. Do not plan the fixes in this session, and change no file.',
	};
}

// The result of submit_fix_plan (decision 43): the steps of the fixes of the round. Each step names the issues that it
// fixes, and each issue to fix needs a step. The rules of stage 4 give the levels from the heat of DataFlow
export async function submitFixPlan(deps: ReviewDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const snapshot = store.snapshot;
	const { root } = requireReview(snapshot);
	const review = snapshot.review;
	const { phase, round } = reviewPhase(review);
	if (phase !== 'plan') {
		throw new Error(phase === 'review' ? 'The round has no review yet. Tell the user: a new session of Claude Code reviews the task first.'
			: phase === 'issues' ? 'The user did not accept the issues of this round yet. Tell the user: put the issues to fix in sequence, and select '
				+ '"Accept the issues" first.'
				: 'The user accepted the plan of the fixes of this round, so the plan stays. Tell the user.');
	}
	const items = toFix(review);
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	const checked = checkFixPlan(args, { root, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE, readLines, tools: [] },
		items.map((x) => x.issue.id), firstFixNumber(review, round), MAX_FIX_STEPS);
	if (checked.problems.length > 0) {
		throw new Error(`Shotgun did not take the plan of the fixes. Correct these problems, and call the tool again:\n${checked.problems.map((p) => `- ${p}`).join('\n')}`);
	}
	const plan = store.writeFixPlan(checked.steps);
	// the levels of the rules from the heat of DataFlow, as in stage 4
	try {
		const risk = await planRisk(deps.engine(), root, { steps: plan.steps }, readLines);
		store.writeRisk({ scan: risk.scan, steps: { ...(store.snapshot.risk?.steps ?? {}), ...risk.steps } });
	} catch (error) {
		deps.log?.(`Shotgun did not get the heat of the steps of the fixes: ${messageOf(error)}`);
	}
	const after = store.snapshot;
	return {
		round,
		steps: plan.steps.map((s) => ({
			id: s.id, title: s.title, fixes: s.fixes, places: s.places.map(placeName), level: levelOf(s, after.risk, after.levels).level,
			decisions: (s.decisions ?? []).map((d) => d.question),
		})),
		next: 'The page of Shotgun shows the plan of the fixes with the level of each step. Tell the user in a short summary. The user checks the plan, '
			+ 'can answer a decision or change a level or a writer, and then selects "Accept the fix plan". Change no file.',
	};
}
