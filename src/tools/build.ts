import type { DiffFacts } from '../dataflow/dataflow-api';
import {
	addedLines, buildNext, buildWriterOf, checkErrand, CurrentStep, FileHunk, findStep, hunkKey, keepMarks, markName, Receipt, receiptChanges, receiptCounts, scopeOf,
	stateOf, walkText,
} from '../session/build';
import type { LineStore } from '../session/lines';
import { hashLines } from '../session/lines';
import { absolutePath, IS_CASE_SENSITIVE, isInside, projectPath } from '../session/paths';
import { levelOf, placeName, PlanStep } from '../session/plan';
import { STAGE_INFO, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import { placeNow } from './plan';
import type { SurveyDeps } from './survey';

// The tools of stage 5. start_step opens the current step for an errand of Claude: Shotgun saves the files of its scope,
// makes the base of the step with markBase of DataFlow, and opens the scope for the guard. submit_errand closes the
// scope, and makes the receipt from getDiff since the base, with a note of Claude for each change. get_step gives the
// step, and the marks and the notes of the user on its receipt.

// The full names of the tools in Claude Code, for the texts for Claude
export const START_STEP_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_start_step';
const SUBMIT_ERRAND_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_submit_errand';

// The base and the diff of DataFlow
export interface BaseApi {
	readonly mark: (name: string, paths: readonly string[]) => Promise<unknown>;
	readonly diff: (base: string, paths: readonly string[]) => Promise<DiffFacts>;
	readonly deleteMark: (name: string) => Promise<unknown>;
}

// The files of the project that changed while a step was open, from a watcher of the file system
export interface StepChanges {
	start(): void;
	files(): readonly string[]; // absolute paths
}

export interface BuildDeps extends SurveyDeps {
	readonly base: () => BaseApi | undefined; // undefined: no link to DataFlow
	readonly saveFiles: (files: readonly string[]) => Promise<void>; // saves the open text editors of the files
	readonly lines: LineStore;
	readonly changes: StepChanges;
}

const NOT_BUILD = 'Steps open only in stage 5, the build, after the gate "Accept the plan" of the user.';
// The maximum number of the lines of the diff of a new file in a receipt
const MAX_NEW_DIFF = 400;
const MAX_OUTSIDE = 50;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const linesOfText = (text: string): string[] => text.split(/\r?\n/);

// The active task in stage 5, else an error for Claude
function requireBuild(snapshot: Snapshot): { root: string } {
	const { task, root, isPaused } = snapshot;
	if (!task || !root) {
		throw new Error(`No task is active. ${NOT_BUILD}`);
	}
	if (task.isDone) {
		throw new Error('The task is done. It has no open steps.');
	}
	if (task.stage !== 'build') {
		throw new Error(`The active task is in ${stageText(task.stage)}. ${NOT_BUILD}`);
	}
	if (isPaused) {
		throw new Error('The user paused the task, so the guard is off. Ask the user to select "Shotgun: Continue" first.');
	}
	return { root };
}

const writerText = (current: Pick<CurrentStep, 'writer' | 'level'>): string => (current.writer === 'claude' ? 'Claude writes it'
	: current.level === 3 ? 'the user writes it (risk level 3: a frame of Claude comes in a later version of Shotgun)' : 'the user writes it');

// A step for the result of a tool: its place in the plan, its text, its places now, its level and writer, its state,
// and its receipt with the marks and the notes of the user
export function stepData(snapshot: Snapshot, ref: { step: PlanStep; n: number }, current: CurrentStep | undefined,
	readLines: (file: string) => readonly string[] | undefined): Record<string, unknown> {
	const { plan, risk, levels, build, root } = snapshot;
	const { step, n } = ref;
	const b = build?.steps[step.id];
	const level = b?.level ?? levelOf(step.id, risk, levels).level;
	const writer = b?.writer ?? buildWriterOf(level);
	const receipt = b?.receipt;
	const marked = (mark: string) => (receipt?.changes ?? []).filter((c) => c.mark === mark).map((c) => ({
		change: c.id, title: c.title, place: placeName({ file: c.file, lines: c.lines }), ...(c.userNote ? { userNote: c.userNote } : {}),
	}));
	return {
		n,
		total: plan?.steps.length ?? 0,
		id: step.id,
		title: step.title,
		task: step.task,
		text: step.text,
		checks: step.checks,
		places: step.places.map((p) => placeName(root ? placeNow(p, root, readLines) : p)),
		scope: b?.scope ?? scopeOf(step),
		level,
		writer: writerText({ writer, level }),
		state: stateOf(build, step.id),
		isCurrent: current?.step.id === step.id,
		...(b?.round ? { round: b.round } : {}),
		...(receipt ? {
			receipt: {
				round: receipt.round,
				walked: walkText(receipt),
				changes: receipt.changes.map((c) => ({
					id: c.id, place: c.isNewFile ? `${c.file} (new)` : placeName({ file: c.file, lines: c.lines }), title: c.title, check: c.check,
					...(c.note ? { note: c.note } : {}), added: c.added, removed: c.removed, mark: c.mark, ...(c.userNote ? { userNote: c.userNote } : {}),
				})),
				issues: marked('issue'),
				questions: marked('question'),
				...(receipt.looseEnds.length > 0 ? { looseEnds: receipt.looseEnds } : {}),
				...(receipt.denies.length > 0 ? { denies: receipt.denies } : {}),
				...(receipt.outside.length > 0 ? { outside: receipt.outside } : {}),
			},
		} : {}),
	};
}

// The result of get_step: the current step, or a step by its id or number
export function getStep(deps: BuildDeps, args: Record<string, unknown>): Record<string, unknown> {
	const snapshot = deps.store.snapshot;
	const { task, plan } = snapshot;
	if (!task || !plan) {
		throw new Error(`The active task has no plan. ${NOT_BUILD}`);
	}
	const current = deps.store.current;
	const ref = args.step === undefined || args.step === '' ? (current ? { step: current.step, n: current.n } : undefined) : findStep(plan, args.step);
	if (!ref) {
		throw new Error(args.step === undefined ? 'Each step of the plan is done.' : `The plan has no step ${String(args.step)}. Give the id of a step, for example S5, or its number.`);
	}
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	const next = task.stage === 'build' && !task.isDone ? buildNext(current).next : STAGE_INFO[task.stage].next;
	return { ...stepData(snapshot, ref, current, readLines), next };
}

// Opens the current step for an errand of Claude. A step with a receipt opens again, for example to fix an issue. Then
// it keeps its base, so the next receipt has all changes since the first start
export async function startStep(deps: BuildDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { root } = requireBuild(store.snapshot);
	const { task, plan } = store.snapshot;
	if (args.kind !== undefined && args.kind !== 'errand') {
		throw new Error('Frames come in a later version of Shotgun. Give "kind": "errand", or no kind.');
	}
	const found = findStep(plan, args.step);
	if (!found) {
		throw new Error(`The plan has no step ${String(args.step ?? '')}. Give the id of a step, for example S5, or its number. Call shotgun_get_plan for the steps.`);
	}
	const current = store.current;
	if (!current) {
		throw new Error('Each step of the plan is done.');
	}
	if (current.step.id !== found.step.id) {
		throw new Error(`Step ${found.n} is not the current step. The steps go in sequence. The current step is step ${current.n}, "${current.step.title}", `
			+ `and ${writerText(current)}. Tell the user.`);
	}
	if (current.writer !== 'claude') {
		throw new Error(`Step ${current.n} has risk level ${current.level ?? '?'}, so the user writes it. Claude writes only the steps of risk level 1 and 2. `
			+ 'Do not change its files. Tell the user, and answer the questions of the user in the chat.');
	}
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	if (current.state === 'open') {
		return {
			...stepData(store.snapshot, found, current, readLines),
			next: `The step is open already. Change only the files of its scope. Then call ${SUBMIT_ERRAND_TOOL} with a change for each change.`,
		};
	}
	const scope = current.build?.scope ?? scopeOf(found.step);
	const absolute = scope.map((f) => absolutePath(f, root));
	await deps.saveFiles(absolute);
	let base: string | undefined;
	const newFiles = current.state === 'todo' ? scope.filter((_f, i) => deps.readText(absolute[i]) === undefined) : undefined;
	if (current.state === 'todo') {
		const existing = absolute.filter((_f, i) => !newFiles!.includes(scope[i]));
		if (existing.length > 0) {
			const api = deps.base();
			if (!api) {
				throw new Error('Shotgun has no link to DataFlow, so it cannot make the base of the step. Tell the user: Shotgun needs DataFlow for the receipt.');
			}
			const name = markName(task!.id, found.step.id);
			try {
				await api.mark(name, existing);
			} catch (error) {
				throw new Error(`DataFlow did not make the base of the step: ${messageOf(error)} Tell the user.`);
			}
			base = name;
		}
	}
	deps.changes.start();
	store.startStep(found.step.id, { writer: 'claude', level: current.level, scope, ...(newFiles ? { newFiles } : {}), ...(base ? { base } : {}) });
	// the lines of the writers in the scope move to the text now, before Claude changes it
	scope.forEach((f, i) => {
		const text = deps.readText(absolute[i]);
		if (text !== undefined) {
			deps.lines.sync(f, linesOfText(text));
		}
	});
	const again = store.current?.build?.receipt;
	return {
		...stepData(store.snapshot, found, store.current, readLines),
		next: again
			? `The step is open again. Fix the issues and answer the questions of the user in the notes of the changes. Change only the files of the scope. `
				+ `Then call ${SUBMIT_ERRAND_TOOL} with a change for each change since the first start of the step.`
			: `The step is open. Change only the files of its scope, with the file tools, not with Bash. Then call ${SUBMIT_ERRAND_TOOL} with a change for each `
				+ 'change: its file, its lines in the text now, a title, a check for the user, and a note for a change that the user did not ask for.',
	};
}

// The hunks since the base of the step: the diff of DataFlow for the files of the base, and each new file of the scope
async function hunksOf(deps: BuildDeps, root: string, step: NonNullable<CurrentStep['build']>)
	: Promise<{ hunks: FileHunk[]; deleted: string[]; notice?: string }> {
	const hunks: FileHunk[] = [];
	let deleted: string[] = [];
	let notice: string | undefined;
	const newFiles = step.newFiles ?? [];
	if (step.base) {
		const api = deps.base();
		if (!api) {
			throw new Error('Shotgun has no link to DataFlow, so it cannot make the receipt. Tell the user.');
		}
		const marked = step.scope.filter((f) => !newFiles.includes(f)).map((f) => absolutePath(f, root));
		let facts: DiffFacts;
		try {
			facts = await api.diff(`mark:${step.base}`, marked);
		} catch (error) {
			throw new Error(`DataFlow did not give the diff since the base of the step: ${messageOf(error)} Try again, or tell the user.`);
		}
		const rel = (file: string) => projectPath(absolutePath(file, facts.root), root, IS_CASE_SENSITIVE);
		for (const f of facts.files) {
			const file = rel(f.file);
			for (const h of f.hunks) {
				hunks.push({
					file, id: h.id, lines: [h.lines[0], h.lines[1]], added: h.added, removed: h.removed,
					...(h.functions ? { functions: [...h.functions] } : {}),
					...(h.heat ? { heat: h.heat.map((x) => ({ function: x.function, score: x.score, band: x.band, isReachComplete: x.isReachComplete })) } : {}),
					...(h.diff ? { diff: h.diff } : {}),
					key: hunkKey(file, h.diff, h.added, h.removed),
				});
			}
		}
		deleted = (facts.deletedFiles ?? []).map(rel);
		notice = facts.noHeat ?? facts.notice;
	}
	for (const file of newFiles) {
		const text = deps.readText(absolutePath(file, root));
		if (text === undefined || text === '') {
			continue;
		}
		const lines = linesOfText(text);
		const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
		const diff = count <= MAX_NEW_DIFF ? lines.slice(0, count).map((t, i) => `+${String(i + 1).padStart(5)} | ${t}`).join('\n') : undefined;
		hunks.push({
			file, id: 'new', lines: [1, Math.max(1, count)], added: count, removed: 0, isNewFile: true, ...(diff ? { diff } : {}),
			key: `${file.toLowerCase()}\n+new ${hashLines(lines.slice(0, count)).join('')}`,
		});
	}
	return { hunks, deleted, ...(notice ? { notice } : {}) };
}

// Closes the open step of Claude, and makes its receipt
export async function submitErrand(deps: BuildDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { root } = requireBuild(store.snapshot);
	const { plan } = store.snapshot;
	const found = findStep(plan, args.step);
	const current = store.current;
	if (!found || !current || current.step.id !== found.step.id || current.state !== 'open' || current.writer !== 'claude' || !current.build) {
		const open = current && current.state === 'open' && current.writer === 'claude' ? ` The open step is step ${current.n}.` : ' No step of Claude is open.';
		throw new Error(`Step ${String(args.step ?? '')} is not open for Claude.${open} Open the current step with ${START_STEP_TOOL} first.`);
	}
	const step = current.build;
	const checked = checkErrand(args, { root, scope: step.scope, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE });
	const { hunks, deleted, notice } = await hunksOf(deps, root, step);
	const matched = receiptChanges(checked.changes, hunks);
	const problems = [...checked.problems, ...matched.problems];
	if (problems.length > 0) {
		throw new Error(`Shotgun did not take the receipt. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
	}
	// the edits that the guard denied, and the other files that changed, while the step was open
	// the ledger keeps the decisions in sequence: the denies after the last start of the step are the denies of the round
	const decisions = store.snapshot.decisions;
	const start = decisions.reduce((last, d, i) => (d.kind === 'step' && d.step === found.step.id ? i : last), -1);
	const denies = decisions.slice(start + 1).flatMap((d) => (d.kind === 'deny' ? [{ tool: d.tool, file: d.file }] : []));
	const shotgunDir = store.dir;
	const scopeKeys = new Set(step.scope.map((f) => f.toLowerCase()));
	const outside = [...new Set(deps.changes.files()
		.filter((f) => !(shotgunDir && isInside(f, shotgunDir, IS_CASE_SENSITIVE)))
		.map((f) => projectPath(f, root, IS_CASE_SENSITIVE))
		.filter((f) => !scopeKeys.has(f.toLowerCase())))].sort().slice(0, MAX_OUTSIDE);
	const receipt: Receipt = {
		time: new Date().toISOString(),
		round: step.round,
		changes: keepMarks(matched.changes, step.receipt),
		denies,
		outside,
		deleted,
		looseEnds: checked.looseEnds,
		...(notice ? { notice } : {}),
	};
	store.writeReceipt(found.step.id, receipt);
	// the added lines of the receipt are lines of Claude
	for (const file of step.scope) {
		const text = deps.readText(absolutePath(file, root));
		if (text === undefined) {
			continue;
		}
		const parts = receipt.changes.filter((c) => c.file === file).map((c) => ({ lines: c.hunks.flatMap((h) => addedLines(h)), change: c.id }));
		deps.lines.replaceStep(file, linesOfText(text), 'claude', found.step.id, parts);
	}
	deps.lines.flush();
	const counts = receiptCounts(receipt);
	const warnings = [
		...(denies.length > 0 ? [`The guard denied ${denies.length === 1 ? '1 edit' : `${denies.length} edits`} outside of the scope.`] : []),
		...(outside.length > 0 ? [`These files outside of the scope changed while the step was open: ${outside.join(', ')}.`] : []),
		...(deleted.length > 0 ? [`These files of the scope are not there now: ${deleted.join(', ')}.`] : []),
	];
	return {
		step: { n: found.n, id: found.step.id, title: found.step.title },
		receipt: {
			round: receipt.round,
			changes: receipt.changes.map((c) => ({ id: c.id, place: c.isNewFile ? `${c.file} (new)` : placeName({ file: c.file, lines: c.lines }), title: c.title, added: c.added, removed: c.removed, mark: c.mark })),
			added: counts.added,
			removed: counts.removed,
			...(warnings.length > 0 ? { warnings } : {}),
		},
		next: `The panel of Shotgun shows the receipt. The scope is closed now. Tell the user: the user walks each change, puts a mark on it, `
			+ `and then selects "Accept the receipt".${counts.changes === 0 ? ' The receipt has no change: tell the user why.' : ''}`,
	};
}
