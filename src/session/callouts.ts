import type { HiddenFacts, LogicFacts, ThreadFacts } from '../dataflow/dataflow-api';
import { FILE_VERSION } from './files';
import { hashLine } from './lines';

// Stage 5: the callouts (phase 8). While the user writes a step, Shotgun gets the facts of DataFlow for the functions
// with the lines of the user: the races of the threads, the warnings of the logic, and the hidden C++. A new fact on a
// line of the user becomes a callout. A callout never comes while the user types: it comes at a pause, with a maximum of
// 3 for each pause. The voice filters the kinds. callouts.json keeps the callouts, the facts at the start of each step,
// and the answers of Claude to the questions of the user about a line. These functions use no VS Code API.

export const CALLOUTS_FILE = 'callouts.json';

export const VOICES = ['quiet', 'normal', 'talkative'] as const;
export type Voice = (typeof VOICES)[number];
export const isVoice = (value: unknown): value is Voice => typeof value === 'string' && (VOICES as readonly string[]).includes(value);

// Decision 19 (D2): the voice normal, and a pause of 2 seconds with no edit
export const DEFAULT_VOICE: Voice = 'normal';
export const DEFAULT_PAUSE_SECONDS = 2;
export const MAX_PER_PAUSE = 3;

export const VOICE_TEXT: Readonly<Record<Voice, string>> = {
	quiet: 'Quiet: problems only, at each pause.',
	normal: 'Normal: problems and warnings, in 1 batch at each pause.',
	talkative: 'Talkative: each new fact of DataFlow on your lines, also the hidden C++.',
};

// problem: a race, or data that a thread uses after its end. warning: a check of the threads, or a warning of the logic.
// info: the hidden C++, for example a copy or a temporary
export type CalloutKind = 'problem' | 'warning' | 'info';
const KIND_RANK: Readonly<Record<CalloutKind, number>> = { problem: 0, warning: 1, info: 2 };

// The tool of DataFlow that gives the fact, and the lens of the side view that shows it
export type FactSource = 'threads' | 'logic' | 'hidden';
export const LENS_OF: Readonly<Record<FactSource, 'threads' | 'logic' | 'cost'>> = { threads: 'threads', logic: 'logic', hidden: 'cost' };

export const voiceAllows = (voice: Voice, kind: CalloutKind): boolean => kind === 'problem' || (kind === 'warning' && voice !== 'quiet')
	|| voice === 'talkative';

// A fact of DataFlow in a file
export interface EngineFact {
	readonly source: FactSource;
	readonly kind: CalloutKind;
	readonly id: string; // the fact with no line, for example "threads|charge.is_dirty|Race"
	readonly title: string; // for example "charge.is_dirty: race"
	readonly proof: readonly string[]; // the facts of the engine with their places
	readonly lines: readonly number[]; // the lines of the fact in the file, from 1
	readonly function?: string;
}

export interface Callout {
	readonly id: string; // C1, C2 and so on in the step
	readonly key: string; // the fact with the text of its line: a fact that only moves keeps its key
	readonly file: string; // relative to the first folder of the project, with /
	readonly line: number; // the line at the last check
	readonly kind: CalloutKind;
	readonly source: FactSource;
	readonly title: string;
	readonly proof: readonly string[];
	readonly function?: string;
	readonly shown?: string; // the time of the pause that showed it. undefined: held back by the voice or by the limit
	readonly closed?: { readonly reason: string; readonly time: string }; // the user: "Not a problem"
	readonly explanation?: { readonly text: string; readonly time: string }; // the words of Claude
	readonly isGone?: boolean; // the fact is not there now, for example after a fix of the user
}

// The answer of Claude to a question of the user about a line, with the facts of DataFlow at the line
export interface LineAnswer {
	readonly id: string; // A1, A2 and so on
	readonly file: string;
	readonly line: number;
	readonly code: string; // the text of the line at the time of the answer
	readonly question: string; // the words of the user
	readonly answer: string; // the words of Claude
	readonly facts: readonly string[]; // the facts of DataFlow at the line, from Shotgun
	readonly time: string;
	readonly resolved?: string; // the time when the user resolved the question
}

export interface StepCallouts {
	readonly started: string; // the time of the facts at the start of the step
	readonly startKeys: readonly string[];
	readonly callouts: readonly Callout[];
	readonly nextId: number;
}

export interface CalloutsFile {
	readonly version: 1;
	readonly steps: Readonly<Record<string, StepCallouts>>;
	readonly answers: readonly LineAnswer[];
}

export const EMPTY_CALLOUTS: CalloutsFile = { version: FILE_VERSION, steps: {}, answers: [] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

//-------------------
// The facts of DataFlow

// The lines of the accesses in a text of a race item, for example "reads 94, 101 · writes 129". A line of a different
// file has its file name, for example "worker.cpp:12", and is not a line of this file. DataFlow 0.6.0 gives the lines
// only in this text (item 46 of dataflow-gaps-2.md)
export function accessLines(text: string): number[] {
	return [...text.matchAll(/(^|[\s,])(\d+)(?=$|[\s,·])/g)].map((m) => Number(m[2]));
}

// The lines of the accesses of an item in the file of the facts. With the field accesses, only an access that can run at
// the same time as an access of a different thread counts. An item with no such access, for example a reference after
// the end of its function, gives all its accesses
export function itemLines(item: ThreadFacts['items'][number]): number[] {
	if (!item.accesses) {
		return [...new Set([...accessLines(item.caller), ...accessLines(item.worker)])];
	}
	const own = item.accesses.filter((a) => !a.file);
	const paired = own.filter((a) => a.pair);
	return [...new Set((paired.length > 0 ? paired : own).map((a) => a.line))];
}

export function threadFacts(facts: ThreadFacts): EngineFact[] {
	return facts.items.flatMap((item): EngineFact[] => {
		const verdict = item.verdict.toLowerCase();
		const kind: CalloutKind | undefined = verdict === 'race' || verdict === 'dangling' ? 'problem' : verdict === 'check' ? 'warning' : undefined;
		if (!kind) {
			return [];
		}
		const lines = [...new Set([...itemLines(item), ...(item.fix ? [item.fix.line] : [])])];
		return [{
			source: 'threads',
			kind,
			id: `threads|${item.item}|${item.verdict}`,
			title: `${item.item}: ${verdict === 'dangling' ? 'a reference after the end of its function' : verdict}`,
			proof: [
				`The thread of the caller ${item.caller}. The worker thread ${item.worker}.`,
				`Protection: ${item.protection}.`,
				item.summary,
				...(item.fix ? [`A possible fix: ${item.fix.text}`] : []),
			].filter((t) => t.trim()),
			lines,
		}];
	});
}

export function logicFacts(facts: LogicFacts): EngineFact[] {
	const fn = facts.function.name;
	return facts.warnings.map((w) => ({
		source: 'logic' as const, kind: 'warning' as const, id: `logic|${fn}|${w.text}`, title: w.text, proof: [`${w.text} In ${fn}, line ${w.line}.`],
		lines: [w.line], function: fn,
	}));
}

export function hiddenFacts(facts: HiddenFacts): EngineFact[] {
	return facts.items.map((item) => ({
		source: 'hidden' as const, kind: 'info' as const, id: `hidden|${facts.function}|${item.kind}|${item.text}`,
		title: `${item.kind}: ${item.text}`, proof: [`${item.text}${item.detail ? `. ${item.detail}` : ''}${item.estimated ? ' (estimated)' : ''}`],
		lines: [item.line], function: facts.function,
	}));
}

// The key of a fact at a line: the fact with the text of the line, so a fact that only moves keeps its key
export const factKey = (fact: EngineFact, lineText: string): string => `${fact.id}|${hashLine(lineText)}`;

// The keys of all facts of a file, for the start of a step
export function factKeys(facts: readonly EngineFact[], lines: readonly string[]): string[] {
	return facts.flatMap((f) => f.lines.filter((l) => l >= 1 && l <= lines.length).map((l) => factKey(f, lines[l - 1])));
}

//-------------------
// The callouts of a step

// The callouts of a file after a check: each fact with a new key on a line of the user. A callout that stays keeps its
// state. A callout of the file with no fact now is gone. userLines: the lines of the user in the step, from 1
export function updateCallouts(step: StepCallouts, file: string, facts: readonly EngineFact[], lines: readonly string[], userLines: ReadonlySet<number>)
	: StepCallouts {
	const start = new Set(step.startKeys);
	const found = new Map<string, Omit<Callout, 'id'>>();
	for (const fact of facts) {
		const line = fact.lines.find((l) => userLines.has(l) && l <= lines.length && !start.has(factKey(fact, lines[l - 1])));
		if (line === undefined) {
			continue;
		}
		const key = factKey(fact, lines[line - 1]);
		if (!found.has(key)) {
			found.set(key, {
				key, file, line, kind: fact.kind, source: fact.source, title: fact.title, proof: [...fact.proof], ...(fact.function ? { function: fact.function } : {}),
			});
		}
	}
	let nextId = step.nextId;
	const old = new Map(step.callouts.filter((c) => c.file === file).map((c) => [c.key, c]));
	const kept: Callout[] = step.callouts.filter((c) => c.file !== file);
	for (const c of old.values()) {
		const now = found.get(c.key);
		if (now) {
			const { isGone: _gone, ...rest } = c;
			kept.push({ ...rest, line: now.line, proof: now.proof });
		} else {
			kept.push({ ...c, isGone: true });
		}
	}
	for (const [key, c] of found) {
		if (!old.has(key)) {
			kept.push({ id: `C${nextId++}`, ...c });
		}
	}
	return { ...step, callouts: kept, nextId };
}

// The callouts that a pause shows: the callouts that are not shown yet and that the voice allows, the problems first,
// then the warnings, then the other facts. max: the number that the pause can still show
export function revealCallouts(step: StepCallouts, voice: Voice, time: string, max = MAX_PER_PAUSE): { step: StepCallouts; shown: number } {
	const waiting = step.callouts.filter((c) => !c.shown && !c.closed && !c.isGone && voiceAllows(voice, c.kind))
		.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.file.localeCompare(b.file) || a.line - b.line)
		.slice(0, Math.max(0, max));
	const ids = new Set(waiting.map((c) => c.id));
	return { step: { ...step, callouts: step.callouts.map((c) => (ids.has(c.id) ? { ...c, shown: time } : c)) }, shown: ids.size };
}

// The decisions of the user and the words of Claude that came while DataFlow worked for a check: they stay in the new
// callouts. latest: the callouts of the step now
export function keepUserState(next: StepCallouts, latest: StepCallouts): StepCallouts {
	const byId = new Map(latest.callouts.map((c) => [c.id, c]));
	return {
		...next,
		callouts: next.callouts.map((c) => {
			const l = byId.get(c.id);
			if (!l) {
				return c;
			}
			const { closed: _closed, explanation: _explanation, ...rest } = c;
			return { ...rest, ...(l.closed ? { closed: l.closed } : {}), ...(l.explanation ? { explanation: l.explanation } : {}) };
		}),
		nextId: Math.max(next.nextId, latest.nextId),
	};
}

// The state of a callout for the views
export type CalloutStatus = 'open' | 'held' | 'waiting' | 'closed' | 'gone';
export function calloutStatus(c: Callout, voice: Voice): CalloutStatus {
	if (c.isGone) {
		return 'gone';
	}
	if (c.closed) {
		return 'closed';
	}
	if (c.shown) {
		return 'open';
	}
	return voiceAllows(voice, c.kind) ? 'waiting' : 'held';
}

export function parseCallouts(text: string, id: string): CalloutsFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${CALLOUTS_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > FILE_VERSION) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version ${FILE_VERSION}. Install a newer version of Shotgun.`);
	}
	const isCallout = (c: unknown) => isObject(c) && typeof c.id === 'string' && typeof c.key === 'string' && typeof c.file === 'string'
		&& typeof c.line === 'number' && (c.kind === 'problem' || c.kind === 'warning' || c.kind === 'info') && typeof c.title === 'string'
		&& Array.isArray(c.proof);
	const isStep = (s: unknown) => isObject(s) && typeof s.started === 'string' && Array.isArray(s.startKeys) && Array.isArray(s.callouts)
		&& s.callouts.every(isCallout) && typeof s.nextId === 'number';
	const isAnswer = (a: unknown) => isObject(a) && typeof a.id === 'string' && typeof a.file === 'string' && typeof a.line === 'number'
		&& typeof a.question === 'string' && typeof a.answer === 'string' && Array.isArray(a.facts);
	if (value.version !== FILE_VERSION || !isObject(value.steps) || !Object.values(value.steps).every(isStep) || !Array.isArray(value.answers)
		|| !value.answers.every(isAnswer)) {
		throw new Error(`${name} needs the fields version, steps and answers, and each item needs its fields.`);
	}
	return value as unknown as CalloutsFile;
}
