import type { DiffFacts } from '../dataflow/dataflow-api';
import {
	addedLines, buildWriterOf, checkChoices, checkErrand, CurrentStep, FileHunk, findStep, hunkKey, keepMarks, markName, Receipt, receiptChanges,
	receiptCounts, scopeOf, stateOf, walkText,
} from '../session/build';
import { checkFrame, findMarkers, Hole, holeNow } from '../session/frame';
import type { LineStore } from '../session/lines';
import { hashLines } from '../session/lines';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile, isInside, projectPath } from '../session/paths';
import { decisionsOf, levelOf, LevelsFile, openDecisions, placeName, PlanStep } from '../session/plan';
import { STAGE_INFO, stageText } from '../session/stages';
import { Snapshot, stepNext, workPlan } from '../session/store';
import { decisionsData, placeNow } from './plan';
import type { SurveyDeps } from './survey';

// The tools of stage 5. start_step opens the current step for an errand or a frame of Claude: Shotgun saves the files of
// its scope, makes the base of the step with markBase of DataFlow, and opens the scope for the guard. submit_errand
// closes the scope, and makes the receipt from getDiff since the base, with a note of Claude for each change.
// submit_frame closes the scope, and gives the holes of the frame with their hints. get_step gives the step, the marks
// and the notes of the user on its receipt, and the state of its holes.

// The full names of the tools in Claude Code, for the texts for Claude
export const START_STEP_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_start_step';
const SUBMIT_ERRAND_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_submit_errand';
const SUBMIT_FRAME_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_submit_frame';

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

const NOT_BUILD = 'Steps open only in stage 5, the build, after the gate "Accept the plan" of the user, and for the issues of the review in stage 6.';
// The maximum number of the lines of the diff of a new file in a receipt
const MAX_NEW_DIFF = 400;
// The maximum number of the names in scope at the line of a hole
const MAX_HOLE_NAMES = 12;
const MAX_OUTSIDE = 50;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const linesOfText = (text: string): string[] => text.split(/\r?\n/);

// The active task in stage 5, or in stage 6 for the steps of the issues, else an error for Claude
function requireBuild(snapshot: Snapshot): { root: string } {
	const { task, root, isPaused } = snapshot;
	if (!task || !root) {
		throw new Error(`No task is active. ${NOT_BUILD}`);
	}
	if (task.isDone) {
		throw new Error('The task is done. It has no open steps.');
	}
	if (task.stage !== 'build' && task.stage !== 'review') {
		throw new Error(`The active task is in ${stageText(task.stage)}. ${NOT_BUILD}`);
	}
	if (isPaused) {
		throw new Error('The user paused the task, so the guard is off. Ask the user to select "Shotgun: Continue" first.');
	}
	return { root };
}

const writerText = (current: Pick<CurrentStep, 'writer' | 'level'>): string => (current.writer === 'claude' ? 'Claude writes it'
	: current.writer === 'frame' ? 'Claude writes the frame, and the user fills its holes' : 'the user writes it');

// The holes of a frame with their state in the text now
function holesData(holes: readonly Hole[], root: string, readLines: (file: string) => readonly string[] | undefined): Record<string, unknown>[] {
	return holes.map((h) => {
		const lines = readLines(absolutePath(h.file, root)) ?? [];
		const now = holeNow(lines, h, findMarkers(lines.join('\n')));
		return {
			n: h.n, question: h.question, place: `${h.file}:${now.line}`, state: now.state, hintsShown: h.shown,
			...(h.shown >= 4 ? { filledBy: 'the answer of Claude' } : {}), ...(now.content ? { content: now.content } : {}),
		};
	});
}

// A step for the result of a tool: its place in the plan, its text, its places now, its level and writer, its state,
// and its receipt with the marks and the notes of the user
export function stepData(snapshot: Snapshot, ref: { step: PlanStep; n: number }, current: CurrentStep | undefined,
	readLines: (file: string) => readonly string[] | undefined): Record<string, unknown> {
	const { risk, levels, build, root } = snapshot;
	const plan = workPlan(snapshot);
	const { step, n } = ref;
	const b = build?.steps[step.id];
	const level = b?.level ?? levelOf(step, risk, levels).level;
	const writer = b?.writer ?? buildWriterOf(level);
	const receipt = b?.receipt;
	const marked = (mark: string) => (receipt?.changes ?? []).filter((c) => c.mark === mark).map((c) => ({
		change: c.id, title: c.title, place: placeName({ file: c.file, lines: c.lines }), ...(c.userNote ? { userNote: c.userNote } : {}),
	}));
	const decisions = decisionsData(step, levels);
	return {
		n,
		total: plan?.steps.length ?? 0,
		id: step.id,
		...(step.issue ? { issue: step.issue } : {}),
		title: step.title,
		task: step.task,
		text: step.text,
		checks: step.checks,
		// the open decisions are the holes of a frame, or the choices of an errand. A decision with an answer of the user is
		// no hole: write the code of the answer (decisions 31 and 32)
		...(decisions ? { decisions } : {}),
		places: step.places.map((p) => placeName(root ? placeNow(p, root, readLines) : p)),
		scope: b?.scope ?? scopeOf(step),
		level,
		writer: writerText({ writer, level }),
		state: stateOf(build, step.id),
		isCurrent: current?.step.id === step.id,
		...(b?.round ? { round: b.round } : {}),
		...(b?.holes && root ? { frame: { ...(b.frameNote ? { note: b.frameNote } : {}), holes: holesData(b.holes, root, readLines) } } : {}),
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
				...(receipt.choices && receipt.choices.length > 0 ? { choices: receipt.choices } : {}),
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
	const { task } = snapshot;
	const plan = workPlan(snapshot);
	if (!task || !plan) {
		throw new Error(`The active task has no plan. ${NOT_BUILD}`);
	}
	const current = deps.store.current;
	const ref = args.step === undefined || args.step === '' ? (current ? { step: current.step, n: current.n } : undefined) : findStep(plan, args.step);
	if (!ref) {
		throw new Error(args.step === undefined ? 'Each step is done.'
			: `The plan has no step ${String(args.step)}. Give the id of a step, for example S5 or I3 for the step of an issue, or its number.`);
	}
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	const next = stepNext(snapshot, current)?.next ?? STAGE_INFO[task.stage].next;
	return { ...stepData(snapshot, ref, current, readLines), next };
}

// Opens the current step for an errand of Claude. A step with a receipt opens again, for example to fix an issue. Then
// it keeps its base, so the next receipt has all changes since the first start
export async function startStep(deps: BuildDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { root } = requireBuild(store.snapshot);
	const { task } = store.snapshot;
	const plan = workPlan(store.snapshot);
	const kind = args.kind === undefined || args.kind === '' ? undefined : String(args.kind);
	if (kind !== undefined && kind !== 'errand' && kind !== 'frame') {
		throw new Error('Give "kind": "errand" for an errand, "frame" for a frame, or no kind.');
	}
	const found = findStep(plan, args.step);
	if (!found) {
		throw new Error(`The plan has no step ${String(args.step ?? '')}. Give the id of a step, for example S5 or I3 for the step of an issue, or its number. `
			+ 'Call shotgun_get_plan for the steps.');
	}
	const current = store.current;
	if (!current) {
		throw new Error('Each step is done.');
	}
	if (current.step.id !== found.step.id) {
		throw new Error(`Step ${found.ref} is not the current step. The steps go in sequence. The current step is step ${current.ref}, "${current.step.title}", `
			+ `and ${writerText(current)}. Tell the user.`);
	}
	if (current.writer === 'user') {
		const frame = current.level === 4 ? ' For a frame of Claude, the user selects "I want a frame" in the panel of Shotgun first, and then asks you.' : '';
		throw new Error(`Step ${current.ref} has risk level ${current.level ?? '?'}, so the user writes it.${frame} Do not change its files. Tell the user, and `
			+ 'answer the questions of the user in the chat.');
	}
	const isFrame = current.writer === 'frame';
	if (kind && kind !== (isFrame ? 'frame' : 'errand')) {
		throw new Error(isFrame
			? `Step ${current.ref} is a frame: write only the lines with no decision, and a hole for each decision of the user. Give "kind": "frame".`
			: `Step ${current.ref} has risk level ${current.level ?? '?'}, so it is an errand with no holes. Give "kind": "errand".`);
	}
	// each open decision is a hole of the frame (decision 32), so a frame needs an open decision
	const levels = store.snapshot.levels;
	const open = openDecisions(found.step, levels);
	if (isFrame && decisionsOf(found.step, levels) && open.length === 0) {
		throw new Error(`Step ${current.ref} has no open decision, so a frame has no hole. Do not change its files. Tell the user: the user can add a `
			+ 'decision on the plan page, or change the level of the step.');
	}
	const submitTool = isFrame ? SUBMIT_FRAME_TOOL : SUBMIT_ERRAND_TOOL;
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	if (current.state === 'open') {
		return {
			...stepData(store.snapshot, found, current, readLines),
			next: `The step is open already. Change only the files of its scope. Then call ${submitTool}.`,
		};
	}
	const scope = current.build?.scope ?? scopeOf(found.step);
	const absolute = scope.map((f) => absolutePath(f, root));
	await deps.saveFiles(absolute);
	let base: string | undefined;
	if (current.state === 'todo') {
		const api = deps.base();
		if (!api) {
			throw new Error('Shotgun has no link to DataFlow, so it cannot make the base of the step. Tell the user: Shotgun needs DataFlow for the receipt.');
		}
		try {
			base = await markScope(api, markName(task!.id, found.step.id), absolute);
		} catch (error) {
			throw new Error(`DataFlow did not make the base of the step: ${messageOf(error)} Tell the user.`);
		}
	}
	deps.changes.start();
	store.startStep(found.step.id, { writer: current.writer, level: current.level, scope, ...(base ? { base } : {}) });
	// the lines of the writers in the scope move to the text now, before Claude changes it
	scope.forEach((f, i) => {
		const text = deps.readText(absolute[i]);
		if (text !== undefined) {
			deps.lines.sync(f, linesOfText(text));
		}
	});
	const again = store.current?.build?.receipt;
	if (isFrame) {
		const isAgain = !!store.current?.build?.holes;
		const holes = open.length > 0
			? `Each open decision of the step is exactly 1 hole: ${open.map((d) => `${d.id} "${d.question}"`).join(', ')}. The hole holds the whole code of `
				+ 'its decision, for example a condition with its branch. Write all other lines, also the code of each decision with an answer of the user. '
			: 'Write only the lines with no decision. ';
		return {
			...stepData(store.snapshot, found, store.current, readLines),
			next: `The step is open${isAgain ? ' again for a different frame' : ''}. Change only the files of its scope, with the file tools, not with Bash. `
				+ `${holes}In the place of each hole, write a marker /*@hole N: question */. Then call ${SUBMIT_FRAME_TOOL} with the decision and the 4 hints `
				+ 'of each hole: the nudge, the pointer, the example and 1 possible answer.',
		};
	}
	const choices = open.length > 0
		? ` The step has open decisions: ${open.map((d) => `${d.id} "${d.question}"`).join(', ')}. Decide each one, and give your choice in "choices". `
			+ 'The user checks each choice in the receipt.'
		: '';
	return {
		...stepData(store.snapshot, found, store.current, readLines),
		next: (again
			? `The step is open again. Fix the issues and answer the questions of the user in the notes of the changes. Change only the files of the scope. `
				+ `Then call ${SUBMIT_ERRAND_TOOL} with a change for each change since the first start of the step.`
			: `The step is open. Change only the files of its scope, with the file tools, not with Bash. Then call ${SUBMIT_ERRAND_TOOL} with a change for each `
				+ 'change: its file, its lines in the text now, a title, a check for the user, and a note for a change that the user did not ask for.') + choices,
	};
}

// The text of a step for the check of the answers of its holes: its text, its checks and the answers of the user (P32)
const stepTextOf = (step: PlanStep, levels: LevelsFile | undefined): string => [step.text, ...step.checks,
	...(decisionsOf(step, levels) ?? []).flatMap((d) => (d.answer ? [d.answer] : []))].join('\n');

// The base of a step: a mark of DataFlow with the files of its scope. DataFlow keeps a file that is not there as a file
// with no text, so the diff since the base gives a new file of the step with its functions and its heat. A step with no
// file in its scope has no base. The files of the new steps are in the mark, so no new step has newFiles. A step from an
// older version of Shotgun can have newFiles, and Shotgun reads these files itself
export async function markScope(api: BaseApi, name: string, absolute: readonly string[]): Promise<string | undefined> {
	if (absolute.length === 0) {
		return undefined;
	}
	await api.mark(name, absolute);
	return name;
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
				// a new file in the mark of the base (item 44 of dataflow-gaps-2.md)
				hunks.push({
					file, id: h.id, lines: [h.lines[0], h.lines[1]], added: h.added, removed: h.removed, ...(f.isNew ? { isNewFile: true } : {}),
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

// Closes the open frame step of Claude, and gives its holes with their hints to the user
export async function submitFrame(deps: BuildDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { root } = requireBuild(store.snapshot);
	const found = findStep(workPlan(store.snapshot), args.step);
	const current = store.current;
	if (!found || !current || current.step.id !== found.step.id || current.state !== 'open' || current.writer !== 'frame' || !current.build) {
		const open = current && current.state === 'open' && current.writer === 'frame' ? ` The open frame step is step ${current.ref}.` : ' No frame step is open.';
		throw new Error(`Step ${String(args.step ?? '')} is not open for a frame.${open} Open the current step with ${START_STEP_TOOL} and the kind frame first.`);
	}
	const step = current.build;
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	const levels = store.snapshot.levels;
	const decisions = decisionsOf(found.step, levels) ? openDecisions(found.step, levels).map((d) => ({ id: d.id, question: d.question })) : undefined;
	const checked = checkFrame(args, {
		root, scope: step.scope, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE, readLines,
		...(decisions ? { decisions } : {}), stepText: stepTextOf(found.step, levels),
	});
	const { hunks } = await hunksOf(deps, root, step);
	const problems = [...checked.problems];
	if (hunks.length === 0) {
		problems.push('The files of the scope have no change since the base of the step. Write the frame with its hole markers first.');
	}
	if (problems.length > 0) {
		throw new Error(`Shotgun did not take the frame. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
	}
	// the facts of DataFlow at the line of each hole. A frame with open holes can stop the parse, so a hole can have no facts
	const engine = deps.engine();
	const holes = await Promise.all(checked.holes.map(async (h) => {
		if (!engine || !isCppFile(h.file)) {
			return h;
		}
		const facts = await engine.place(absolutePath(h.file, root), h.line).catch(() => undefined);
		// the names in scope at the line (item 45 of dataflow-gaps-2.md). DataFlow 0.6.0 does not give them
		const names = (facts?.inScope ?? []).slice(0, MAX_HOLE_NAMES).map((n) => `${n.name}: ${n.type}`);
		return facts ? {
			...h, facts: {
				...(facts.function ? { function: facts.function.name } : {}), threads: facts.threads.map((t) => t.label), locks: [...facts.locks],
				...(names.length > 0 ? { names } : {}),
			},
		} : h;
	}));
	store.writeFrame(found.step.id, holes, checked.note);
	// the added lines since the base are the lines of the frame of Claude, also the lines of the markers
	for (const file of step.scope) {
		const text = deps.readText(absolutePath(file, root));
		if (text === undefined) {
			continue;
		}
		const lines = hunks.filter((h) => h.file === file).flatMap((h) => addedLines(h));
		deps.lines.replaceStep(file, linesOfText(text), 'claude', found.step.id, lines.length > 0 ? [{ lines, change: 'frame' }] : []);
	}
	deps.lines.flush();
	return {
		step: { n: found.n, id: found.step.id, title: found.step.title },
		holes: holes.map((h) => ({ n: h.n, question: h.question, place: `${h.file}:${h.line}` })),
		frameLines: hunks.reduce((n, h) => n + h.added, 0),
		next: 'The panel of Shotgun shows the holes with their hints. The scope is closed now. Tell the user: the user fills each hole, and can open the '
			+ 'hints in the panel. Then the user selects "The step is done". Do not give the answers in the chat.',
	};
}

// Closes the open step of Claude, and makes its receipt
export async function submitErrand(deps: BuildDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { root } = requireBuild(store.snapshot);
	const found = findStep(workPlan(store.snapshot), args.step);
	const current = store.current;
	if (!found || !current || current.step.id !== found.step.id || current.state !== 'open' || current.writer !== 'claude' || !current.build) {
		const open = current && current.state === 'open' && current.writer === 'claude' ? ` The open step is step ${current.ref}.` : ' No step of Claude is open.';
		throw new Error(`Step ${String(args.step ?? '')} is not open for Claude.${open} Open the current step with ${START_STEP_TOOL} first.`);
	}
	const step = current.build;
	const checked = checkErrand(args, { root, scope: step.scope, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE });
	const { hunks, deleted, notice } = await hunksOf(deps, root, step);
	const matched = receiptChanges(checked.changes, hunks);
	const problems = [...checked.problems, ...matched.problems];
	// the choices of Claude for the open decisions of the step (P31)
	const choices = checkChoices(args.choices, openDecisions(found.step, store.snapshot.levels), problems);
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
		...(choices.length > 0 ? { choices } : {}),
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
