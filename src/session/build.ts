import type { Hole } from './frame';
import { absolutePath, isInside, projectPath } from './paths';
import { levelOf, LevelsFile, Plan, PlanStep, RiskFile } from './plan';
import type { Level } from './risk';
import type { Band, Lines } from './survey';

// Stage 5: the build. The steps of the plan go in sequence, and the risk level of a step selects its writer. Claude
// writes a step of level 1 or 2 as an errand: it opens the step, changes only the files of its scope, and gives a
// receipt with a note for each change. The user walks the receipt and puts a mark on each change. At level 3, Claude
// writes a frame with a hole for each decision of the user (frame.ts). The user writes a step of level 4 or 5, and can
// ask for a frame at level 4 (decision 16). build.json keeps the state of each step, its receipt and its holes. These
// functions use no VS Code API, so the unit tests can call them directly.

export const BUILD_FILE = 'build.json';

// todo: not started. open: Claude writes the step or its frame, or the user writes it. receipt: the user walks the receipt
// of Claude. holes: the user fills the holes of the frame. done: the user accepted the receipt, or the user selected "The
// step is done"
export const STEP_STATES = ['todo', 'open', 'receipt', 'holes', 'done'] as const;
export type StepState = (typeof STEP_STATES)[number];

// The mark of the user on a change of a receipt. todo: the user did not walk the change yet
export const CHANGE_MARKS = ['todo', 'ok', 'issue', 'question'] as const;
export type ChangeMark = (typeof CHANGE_MARKS)[number];
export const isChangeMark = (value: unknown): value is ChangeMark => typeof value === 'string' && (CHANGE_MARKS as readonly string[]).includes(value);

// claude: an errand of Claude. frame: Claude writes the frame, and the user fills its holes. user: the user writes the step
export type BuildWriter = 'claude' | 'user' | 'frame';

// The writer of a step in the build. isFrameRequested: the user selected "I want a frame" for a step of level 4
export function buildWriterOf(level: Level | null, isFrameRequested = false): BuildWriter {
	if (level === null) {
		return 'user';
	}
	if (level <= 2) {
		return 'claude';
	}
	return level === 3 || (level === 4 && isFrameRequested) ? 'frame' : 'user';
}

const MAX_CHANGES = 50;
const MAX_LOOSE_ENDS = 20;
const MAX_TITLE = 200;
const MAX_CHECK = 300;
const MAX_NOTE = 1000;
const MAX_LOOSE_END = 500;
export const MAX_CHANGE_NOTE = 500; // the note of the user for a change

// A hunk of the diff since the base of the step, from getDiff of DataFlow. A new file of the scope is 1 hunk with all
// its lines
export interface ReceiptHunk {
	readonly id: string; // the id of DataFlow, or "new" for a new file
	readonly lines: Lines; // the first and the last changed line in the text at the time of the receipt
	readonly added: number;
	readonly removed: number;
	readonly functions?: readonly string[];
	readonly heat?: readonly { readonly function: string; readonly score: number; readonly band: Band; readonly isReachComplete: boolean }[];
	readonly diff?: string; // the lines of the diff in the format of DataFlow. undefined: the diff was too long
	readonly key: string; // the diff with no line numbers: the same hunk in a later round has the same key
}

// A change of a receipt: the hunks of 1 note of Claude, and the mark of the user
export interface ReceiptChange {
	readonly id: string; // C1, C2 and so on
	readonly file: string; // relative to the first folder of the project, with /
	readonly lines: Lines;
	readonly title: string;
	readonly check: string; // what the user checks
	readonly note?: string; // a note of Claude, for example a change that the user did not ask for
	readonly isNewFile?: boolean;
	readonly added: number;
	readonly removed: number;
	readonly hunks: readonly ReceiptHunk[];
	readonly mark: ChangeMark;
	readonly userNote?: string;
	readonly markTime?: string;
}

// A place that the step can also need, from Claude. Phase 9 makes them into steps on a click of the user
export interface LooseEnd {
	readonly text: string;
	readonly file?: string;
	readonly lines?: Lines;
}

export interface Receipt {
	readonly time: string;
	readonly round: number;
	readonly changes: readonly ReceiptChange[];
	readonly denies: readonly { readonly tool: string; readonly file: string }[]; // the edits that the guard denied in the round
	readonly outside: readonly string[]; // the files outside of the scope that changed while the step was open
	readonly deleted: readonly string[]; // the files of the scope that are not there now
	readonly looseEnds: readonly LooseEnd[];
	readonly notice?: string; // a note of DataFlow, for example why the hunks have no heat
	readonly choices?: readonly DecisionChoice[]; // the choices of Claude for the open decisions of a step of level 1 or 2 (P31)
}

// The choice of Claude for an open decision of its step (P31). The receipt shows it with the badge Model
export interface DecisionChoice {
	readonly decision: string; // for example D1
	readonly question: string;
	readonly choice: string;
}

export const MAX_CHOICE = 300;

// The choices of Claude in submit_errand: 1 choice for each open decision of the step (P31). The result has all problems
// in the list of the caller
export function checkChoices(raw: unknown, open: readonly { readonly id: string; readonly question: string }[], problems: string[]): DecisionChoice[] {
	const items = Array.isArray(raw) ? raw : [];
	if (open.length === 0) {
		if (items.length > 0) {
			problems.push('The step has no open decision, so give no "choices".');
		}
		return [];
	}
	const choices: DecisionChoice[] = [];
	items.forEach((c, i) => {
		const item = (typeof c === 'object' && c !== null && !Array.isArray(c) ? c : {}) as Record<string, unknown>;
		const id = typeof item.decision === 'string' ? item.decision.trim() : '';
		const choice = typeof item.choice === 'string' ? item.choice.trim().replace(/\s+/g, ' ') : '';
		const decision = open.find((d) => d.id === id);
		if (!decision) {
			problems.push(`Choice ${i + 1}: "${id}" is not an open decision of the step. The open decisions are ${open.map((d) => d.id).join(', ')}.`);
		} else if (!choice || choice.length > MAX_CHOICE) {
			problems.push(`Choice ${i + 1}: give a "choice" of 1 to ${MAX_CHOICE} characters for ${id}.`);
		} else if (choices.some((x) => x.decision === id)) {
			problems.push(`Choice ${i + 1}: the decision ${id} has a choice already.`);
		} else {
			choices.push({ decision: id, question: decision.question, choice });
		}
	});
	open.filter((d) => !choices.some((c) => c.decision === d.id) && !items.some((c) => isObject(c) && c.decision === d.id))
		.forEach((d) => problems.push(`Give your choice for the open decision ${d.id} "${d.question}" in "choices". The user checks it in the receipt.`));
	return choices;
}

export interface BuildStep {
	readonly state: StepState;
	readonly writer: BuildWriter;
	readonly level: Level | null; // the level at the start of the step
	readonly scope: readonly string[]; // the files of the places, relative to the first folder of the project
	readonly newFiles?: readonly string[]; // the files of the scope that were not there at the start of the step
	readonly base?: string; // the name of the mark of DataFlow with the text of the scope at the start of the step
	readonly baseError?: string; // why the step has no base
	readonly round: number; // the number of the times that Claude opened the step. 0 for a step of the user
	readonly opened?: string; // the time of the last start
	readonly receipt?: Receipt;
	readonly holes?: readonly Hole[]; // the holes of the frame of Claude
	readonly frameNote?: string; // the note of Claude for the frame
	readonly isFrameRequested?: boolean; // the user selected "I want a frame" for a step of level 4
	readonly done?: string;
}

export interface BuildFile {
	readonly version: 1;
	readonly steps: Readonly<Record<string, BuildStep>>;
}

// The current step: the step that is started, else the first step of the plan that is not done (strict sequence)
export interface CurrentStep {
	readonly step: PlanStep;
	readonly n: number; // the place of the step in the plan, from 1
	readonly ref: string; // the step in a text: its number, or the id of the issue for the step of an issue, for example I3
	readonly total: number;
	readonly level: Level | null;
	readonly writer: BuildWriter;
	readonly state: StepState;
	readonly build?: BuildStep;
}

export const stateOf = (build: BuildFile | undefined, id: string): StepState => build?.steps[id]?.state ?? 'todo';

export function currentStep(plan: Plan | undefined, risk: RiskFile | undefined, levels: LevelsFile | undefined, build: BuildFile | undefined)
	: CurrentStep | undefined {
	const steps = plan?.steps ?? [];
	// a started step stays the current step. In stage 6, a new step of an issue can come before it (P22)
	const started = steps.findIndex((s) => !['todo', 'done'].includes(stateOf(build, s.id)));
	const n = started >= 0 ? started : steps.findIndex((s) => stateOf(build, s.id) !== 'done');
	if (n < 0) {
		return undefined;
	}
	const step = steps[n];
	const b = build?.steps[step.id];
	const level = b?.level ?? levelOf(step, risk, levels).level;
	return { step, n: n + 1, ref: refOf(step, n + 1), total: steps.length, level, writer: b?.writer ?? buildWriterOf(level), state: b?.state ?? 'todo', ...(b ? { build: b } : {}) };
}

// The step in a text: its number in the plan, or the id of the issue for the step of an issue (P22)
export const refOf = (step: PlanStep, n: number): string => (step.issue ? step.id : String(n));

// The step of a reference of Claude or of the user: the id of a step, or its number in the plan, from 1
export function findStep(plan: Plan | undefined, ref: unknown): { step: PlanStep; n: number; ref: string } | undefined {
	const steps = plan?.steps ?? [];
	const text = typeof ref === 'number' ? String(ref) : typeof ref === 'string' ? ref.trim().replace(/^step\s+/i, '') : '';
	const byId = steps.findIndex((s) => s.id.toLowerCase() === text.toLowerCase());
	if (byId >= 0) {
		return { step: steps[byId], n: byId + 1, ref: refOf(steps[byId], byId + 1) };
	}
	const n = /^\d+$/.test(text) ? Number(text) : 0;
	return n >= 1 && n <= steps.length ? { step: steps[n - 1], n, ref: refOf(steps[n - 1], n) } : undefined;
}

// The files of the places of a step, in their sequence and with no copy
export function scopeOf(step: PlanStep): string[] {
	const out: string[] = [];
	for (const p of step.places) {
		if (!out.some((f) => f.toLowerCase() === p.file.toLowerCase())) {
			out.push(p.file);
		}
	}
	return out;
}

// The name of the mark of DataFlow for a step: 1 to 64 letters, digits, "_", "-" or "."
export function markName(task: string, step: string): string {
	let h = 0;
	for (let i = 0; i < task.length; i++) {
		h = (Math.imul(h, 31) + task.charCodeAt(i)) >>> 0;
	}
	return `sg.${task.slice(0, 16)}-${h.toString(36).padStart(7, '0').slice(0, 7)}.${step}`.slice(0, 64);
}

//-------------------
// The receipt

// A line of a diff of DataFlow: "+   44 | text", "-      | text" or "    45 | text"
export function diffLines(diff: string): { mark: '+' | '-' | ' '; line?: number; text: string }[] {
	return diff.split(/\r?\n/).flatMap((l) => {
		const m = /^([+\- ])\s*(\d*) \| ?(.*)$/.exec(l);
		return m ? [{ mark: m[1] as '+' | '-' | ' ', ...(m[2] ? { line: Number(m[2]) } : {}), text: m[3] }] : [];
	});
}

// The key of a hunk: its diff with no line numbers
export function hunkKey(file: string, diff: string | undefined, added: number, removed: number): string {
	const body = diff ? diffLines(diff).map((l) => `${l.mark}${l.text.trim()}`).join('\n') : `+${added}-${removed}`;
	return `${file.toLowerCase()}\n${body}`;
}

// The added lines of a hunk. With no diff, all lines of the hunk
export function addedLines(hunk: ReceiptHunk): number[] {
	if (hunk.diff) {
		return diffLines(hunk.diff).filter((l) => l.mark === '+' && l.line !== undefined).map((l) => l.line!);
	}
	const out: number[] = [];
	for (let line = hunk.lines[0]; hunk.added > 0 && line <= hunk.lines[1]; line++) {
		out.push(line);
	}
	return out;
}

// A hunk of the diff since the base, with its file
export interface FileHunk extends ReceiptHunk {
	readonly file: string; // relative to the first folder of the project, with /
	readonly isNewFile?: boolean;
}

// A change in the words of Claude, before Shotgun gives it its hunks
export interface ClaudeChange {
	readonly file: string;
	readonly lines: Lines;
	readonly title: string;
	readonly check: string;
	readonly note?: string;
}

export interface ErrandContext {
	readonly root: string;
	readonly scope: readonly string[]; // relative to the root
	readonly folders: readonly string[];
	readonly isCaseSensitive: boolean;
}

// Checks the changes and the loose ends of Claude in submit_errand. The result has all problems in 1 list (P7)
export function checkErrand(raw: Record<string, unknown>, ctx: ErrandContext): { changes: ClaudeChange[]; looseEnds: LooseEnd[]; problems: string[] } {
	const problems: string[] = [];
	const key = (file: string) => (ctx.isCaseSensitive ? absolutePath(file, ctx.root) : absolutePath(file, ctx.root).toLowerCase());
	const inScope = (file: string) => ctx.scope.some((s) => key(s) === key(file));
	const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
	const linesOf = (value: unknown): Lines | undefined => (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1)
		&& value[0] <= value[1] ? [value[0], value[1]] : undefined);
	const changes: ClaudeChange[] = [];
	const raws = raw.changes === undefined ? [] : raw.changes;
	if (!Array.isArray(raws)) {
		problems.push('"changes" must be a list.');
	} else if (raws.length > MAX_CHANGES) {
		problems.push(`Give a maximum of ${MAX_CHANGES} changes. Put more hunks into 1 change.`);
	} else {
		raws.forEach((c, i) => {
			const label = `Change ${i + 1}`;
			if (typeof c !== 'object' || c === null || Array.isArray(c)) {
				problems.push(`${label} is not an object.`);
				return;
			}
			const item = c as Record<string, unknown>;
			const name = typeof item.file === 'string' ? item.file.trim() : '';
			const file = name ? projectPath(absolutePath(name, ctx.root), ctx.root, ctx.isCaseSensitive) : '';
			const lines = linesOf(item.lines);
			const title = text(item.title);
			const check = text(item.check);
			const note = text(item.note);
			if (!name) {
				problems.push(`${label}: give the "file".`);
			} else if (!inScope(file)) {
				problems.push(`${label}: ${name} is not in the scope of the step: ${ctx.scope.join(', ')}.`);
			}
			if (!lines) {
				problems.push(`${label}: give "lines": [first, last] of the change in the text now, from 1.`);
			}
			if (!title || title.length > MAX_TITLE) {
				problems.push(`${label}: give a "title" of 1 to ${MAX_TITLE} characters.`);
			}
			if (!check || check.length > MAX_CHECK) {
				problems.push(`${label}: give a "check" of 1 to ${MAX_CHECK} characters: what the user checks in the change.`);
			}
			if (note.length > MAX_NOTE) {
				problems.push(`${label}: the "note" has more than ${MAX_NOTE} characters.`);
			}
			if (name && lines && title && check) {
				const scoped = ctx.scope.find((s) => key(s) === key(file)) ?? file;
				changes.push({ file: scoped, lines, title, check, ...(note ? { note } : {}) });
			}
		});
	}
	const looseEnds: LooseEnd[] = [];
	const rawEnds = raw.looseEnds === undefined ? [] : raw.looseEnds;
	if (!Array.isArray(rawEnds) || rawEnds.length > MAX_LOOSE_ENDS) {
		problems.push(`"looseEnds" must be a list of ${MAX_LOOSE_ENDS} items or less.`);
	} else {
		rawEnds.forEach((e, i) => {
			const item = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
			const t = text(typeof e === 'string' ? e : item.text);
			if (!t || t.length > MAX_LOOSE_END) {
				problems.push(`Loose end ${i + 1}: give a "text" of 1 to ${MAX_LOOSE_END} characters.`);
				return;
			}
			const name = typeof item.file === 'string' ? item.file.trim() : '';
			const file = name ? projectPath(absolutePath(name, ctx.root), ctx.root, ctx.isCaseSensitive) : undefined;
			if (file && !ctx.folders.some((f) => isInside(absolutePath(file, ctx.root), f, ctx.isCaseSensitive))) {
				problems.push(`Loose end ${i + 1}: ${name} is not in a folder of the project.`);
				return;
			}
			const lines = linesOf(item.lines);
			looseEnds.push({ text: t, ...(file ? { file } : {}), ...(file && lines ? { lines } : {}) });
		});
	}
	return { changes, looseEnds, problems };
}

const overlaps = (a: Lines, b: Lines): boolean => a[0] <= b[1] + 1 && a[1] >= b[0] - 1;
const sameFile = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

// The changes of a receipt: each hunk goes to the first change of Claude in the same file with lines at the hunk. Each
// hunk needs a change, and each change needs a hunk
export function receiptChanges(claude: readonly ClaudeChange[], hunks: readonly FileHunk[]): { changes: ReceiptChange[]; problems: string[] } {
	const problems: string[] = [];
	const groups = claude.map(() => [] as FileHunk[]);
	for (const h of hunks) {
		const i = claude.findIndex((c) => sameFile(c.file, h.file) && (h.isNewFile || overlaps(c.lines, h.lines)));
		if (i < 0) {
			const at = h.isNewFile ? `the new file ${h.file}` : `${h.file}:${h.lines[0] === h.lines[1] ? h.lines[0] : `${h.lines[0]}-${h.lines[1]}`}`;
			problems.push(`The change at ${at} (+${h.added} −${h.removed}) has no note. Give a change with its lines, a title and a check.`);
		} else {
			groups[i].push(h);
		}
	}
	claude.forEach((c, i) => {
		if (groups[i].length === 0) {
			problems.push(`Change ${i + 1} (${c.file}:${c.lines[0]}-${c.lines[1]}) has no change since the base of the step. Give the lines of the change in the text now.`);
		}
	});
	const changes = claude.map((c, i) => ({ c, hunks: groups[i] })).filter((g) => g.hunks.length > 0)
		.map(({ c, hunks: hs }): Omit<ReceiptChange, 'id'> => {
			const isNewFile = hs.some((h) => h.isNewFile);
			return {
				file: c.file,
				lines: [Math.min(...hs.map((h) => h.lines[0])), Math.max(...hs.map((h) => h.lines[1]))],
				title: c.title,
				check: c.check,
				...(c.note ? { note: c.note } : {}),
				...(isNewFile ? { isNewFile } : {}),
				added: hs.reduce((n, h) => n + h.added, 0),
				removed: hs.reduce((n, h) => n + h.removed, 0),
				hunks: hs.map(({ file: _file, isNewFile: _isNew, ...h }) => h),
				mark: 'todo',
			};
		})
		.sort((a, b) => a.file.localeCompare(b.file) || a.lines[0] - b.lines[0])
		.map((c, i) => ({ id: `C${i + 1}`, ...c }));
	return { changes, problems };
}

// The marks of a new round. A change with the same hunks as a change with the mark OK keeps that mark and the note of
// the user. Each other change starts with no mark, so the user walks it again
export function keepMarks(changes: readonly ReceiptChange[], old: Receipt | undefined): ReceiptChange[] {
	const keyOf = (c: ReceiptChange) => c.hunks.map((h) => h.key).sort().join('\n\n');
	const ok = new Map((old?.changes ?? []).filter((c) => c.mark === 'ok').map((c) => [keyOf(c), c]));
	return changes.map((c) => {
		const before = ok.get(keyOf(c));
		return before ? { ...c, mark: 'ok', ...(before.userNote ? { userNote: before.userNote } : {}), ...(before.markTime ? { markTime: before.markTime } : {}) } : c;
	});
}

export interface ReceiptCounts {
	readonly changes: number;
	readonly walked: number; // the changes with a mark
	readonly ok: number;
	readonly issues: number;
	readonly questions: number;
	readonly added: number;
	readonly removed: number;
}

export function receiptCounts(receipt: Receipt | undefined): ReceiptCounts {
	const changes = receipt?.changes ?? [];
	const count = (mark: ChangeMark) => changes.filter((c) => c.mark === mark).length;
	return {
		changes: changes.length,
		walked: changes.length - count('todo'),
		ok: count('ok'),
		issues: count('issue'),
		questions: count('question'),
		added: changes.reduce((n, c) => n + c.added, 0),
		removed: changes.reduce((n, c) => n + c.removed, 0),
	};
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// The marks of a receipt in words, for example "2 of 3 changes walked: 1 issue"
export function walkText(receipt: Receipt | undefined): string {
	const c = receiptCounts(receipt);
	const extras = [...(c.issues > 0 ? [plural(c.issues, 'issue')] : []), ...(c.questions > 0 ? [plural(c.questions, 'question')] : [])];
	return `${c.walked} of ${plural(c.changes, 'change')} walked${extras.length > 0 ? `: ${extras.join(', ')}` : ''}`;
}

//-------------------
// The next work, and the rule of the guard

// the name of the current step. The step of an issue of the review has the id of its issue
const stepName = (current: CurrentStep): string => (current.step.issue ? `the fix of issue ${current.step.id}, "${current.step.title}"`
	: `step ${current.n} of ${current.total}, "${current.step.title}"`);
// the step in a request of the user, for example "step 5", or "step I3" for the step of an issue
const stepRef = (current: CurrentStep): string => `step ${current.ref}`;

// The next work in stage 5, or in stage 6 for the steps of the issues, and the request in words for Claude Code
export function buildNext(current: CurrentStep | undefined, isReview = false): { next: string; request?: string } {
	if (!current) {
		return {
			next: isReview ? 'Each step of the issues is done. The user selects "The task is done", or copies the review prompt for the next round.'
				: 'Each step of the plan is done. The user selects "The build is done".',
		};
	}
	const name = stepName(current);
	if (current.writer === 'user') {
		const frame = current.level === 4 ? ' For a frame of Claude, the user selects "I want a frame" first.' : '';
		return {
			next: `The user writes ${name}, at risk level ${current.level ?? '?'}, and then selects "The step is done". Claude changes no file in a step `
				+ `of the user.${frame} Claude can answer questions in the chat.`,
		};
	}
	if (current.writer === 'frame') {
		switch (current.state) {
			case 'todo':
				return {
					next: `Claude writes the frame of ${name}, at risk level ${current.level ?? '?'}: the lines with no decision, and a hole for each decision `
						+ 'of the user. The user asks Claude for it. Claude opens the step with shotgun_start_step and the kind frame first.',
					request: `Give me a frame for ${stepRef(current)}.`,
				};
			case 'open':
				return { next: `Claude writes the frame of ${name}. Then Claude gives the holes with their hints with shotgun_submit_frame.` };
			default: {
				const n = current.build?.holes?.length ?? 0;
				return {
					next: `The user fills the ${n === 1 ? 'hole' : `${n} holes`} of the frame of ${name}, and then selects "The step is done". The hints came `
						+ 'with the frame. For a different frame, the user asks Claude, and Claude opens the step again with shotgun_start_step.',
				};
			}
		}
	}
	switch (current.state) {
		case 'todo':
			// a loose end that the user handed to Claude (decision 21)
			if (current.step.looseEnd) {
				return {
					next: `Claude does ${name}: a loose end that the user handed to Claude. The user asks Claude for it. Claude opens the step with `
						+ 'shotgun_start_step first, as an errand.',
					request: 'Do the loose ends.',
				};
			}
			return {
				next: `Claude writes ${name}, at risk level ${current.level ?? '?'}. The user asks Claude for it. Claude opens the step with shotgun_start_step first.`,
				request: `Do ${stepRef(current)}.`,
			};
		case 'open':
			return { next: `Claude writes ${name}. Claude changes only the files of its scope, and then gives the receipt with shotgun_submit_errand.` };
		default: {
			const c = receiptCounts(current.build?.receipt);
			if (c.issues + c.questions > 0) {
				return {
					next: `The user walks the receipt of ${name}: ${walkText(current.build?.receipt)}. The user can ask Claude to fix the issues and to answer `
						+ 'the questions. Then Claude opens the step again with shotgun_start_step.',
					request: `Fix the issues of ${stepRef(current)}.`,
				};
			}
			return { next: `The user walks the receipt of ${name}: ${walkText(current.build?.receipt)}. Then the user selects "Accept the receipt".` };
		}
	}
}

// The rule of the guard in stage 5. scope: the files of the open step of Claude. closed: the reason of a deny with no
// open step of Claude
export interface BuildGuard {
	readonly scope?: readonly string[]; // relative to the first folder of the project
	readonly step: string;
	readonly closed: string;
}

export function buildGuard(current: CurrentStep | undefined, startTool: string): BuildGuard {
	if (!current) {
		return { step: 'no step', closed: 'Each step of the plan is done, so Claude changes no file.' };
	}
	const name = stepName(current);
	if (current.writer === 'user') {
		return { step: name, closed: `The current step is ${name}, and the user writes it. Claude changes no file in a step of the user.` };
	}
	if (current.writer === 'frame' && current.state !== 'open') {
		return {
			step: name,
			closed: current.state === 'holes'
				? `The user fills the holes of the frame of ${name}. For a different frame, the user asks, and Claude opens the step again with ${startTool}.`
				: `The current step is ${name}, a frame of Claude. Open it with ${startTool} and the kind frame first: then the guard opens its scope.`,
		};
	}
	switch (current.state) {
		case 'open':
			return { scope: current.build?.scope ?? scopeOf(current.step), step: name, closed: '' };
		case 'receipt':
			return {
				step: name,
				closed: `The user walks the receipt of ${name}. To fix an issue of the receipt, open the step again with ${startTool}.`,
			};
		default:
			return { step: name, closed: `The current step is ${name}, a step of Claude. Open it with ${startTool} first: then the guard opens its scope.` };
	}
}

//-------------------
// The file

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLines = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1);
const isStrings = (value: unknown): boolean => Array.isArray(value) && value.every((v) => typeof v === 'string');

function isReceipt(value: unknown): boolean {
	if (!isObject(value) || typeof value.time !== 'string' || typeof value.round !== 'number' || !Array.isArray(value.changes)) {
		return false;
	}
	const isHunk = (h: unknown) => isObject(h) && typeof h.id === 'string' && isLines(h.lines) && typeof h.added === 'number' && typeof h.removed === 'number'
		&& typeof h.key === 'string';
	const isChange = (c: unknown) => isObject(c) && typeof c.id === 'string' && typeof c.file === 'string' && isLines(c.lines) && typeof c.title === 'string'
		&& typeof c.check === 'string' && isChangeMark(c.mark) && Array.isArray(c.hunks) && c.hunks.every(isHunk);
	return value.changes.every(isChange) && Array.isArray(value.denies) && isStrings(value.outside) && isStrings(value.deleted) && Array.isArray(value.looseEnds);
}

export function parseBuild(text: string, id: string): BuildFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${BUILD_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > 1) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version 1. Install a newer version of Shotgun.`);
	}
	const isHole = (h: unknown) => isObject(h) && typeof h.n === 'number' && typeof h.question === 'string' && typeof h.file === 'string'
		&& typeof h.line === 'number' && isObject(h.anchor) && isObject(h.hints) && typeof h.shown === 'number';
	const isStep = (s: unknown) => isObject(s) && (STEP_STATES as readonly unknown[]).includes(s.state)
		&& (s.writer === 'claude' || s.writer === 'user' || s.writer === 'frame') && isStrings(s.scope) && typeof s.round === 'number'
		&& (s.receipt === undefined || isReceipt(s.receipt)) && (s.holes === undefined || (Array.isArray(s.holes) && s.holes.every(isHole)));
	if (value.version !== 1 || !isObject(value.steps) || !Object.values(value.steps).every(isStep)) {
		throw new Error(`${name} needs the fields version and steps, and each step needs its fields.`);
	}
	return value as unknown as BuildFile;
}
