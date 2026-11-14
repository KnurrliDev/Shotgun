import type { MemberSitesFacts, OutlineMemberFacts, RippleFacts } from '../dataflow/dataflow-api';
import type { StepState } from './build';
import { FILE_VERSION } from './files';
import type { PlanStep } from './plan';
import type { Lines } from './survey';

// Stage 5: the loose ends (phase 9). A loose end is a place that a change of a step can also need. At the gate of a step,
// Shotgun gets them from the facts of DataFlow. A function that uses most data members of a type but not its new member,
// and a switch statement that does not handle a new enumerator, are mechanical: Claude can do them. The ripple of the
// changes gives the places that the user decides. Claude gives its own loose ends with the receipt of an errand. A click
// of the user hands a loose end to Claude as the next step of the plan (decision 21). loose.json keeps the loose ends of
// the task. These functions use no VS Code API.

export const LOOSE_FILE = 'loose.json';

// mechanical: Claude can do it. decision: the user decides it
export type LooseKind = 'mechanical' | 'decision';
// members: a new data member. switch: a new enumerator. ripple: the changes of the step reach the place. claude: a loose
// end of Claude in a receipt
export type LooseSource = 'members' | 'switch' | 'ripple' | 'claude';
export type LooseState = 'open' | 'handed' | 'closed';

// The maximum numbers of the loose ends of 1 step
export const MAX_MEMBER_ENDS = 8; // for each new data member or enumerator
export const MAX_RIPPLE_ENDS = 5;
// A function that uses this part of the data members of a type, or more, often loads, saves or copies the type
export const MIN_PART = 0.5;
// The text of a step of a loose end
const MAX_STEP_TITLE = 200;
const MAX_STEP_TEXT = 1500;
export const MAX_LOOSE_REASON = 500;

// A loose end before Shotgun gives it its id, its state and its time
export interface LooseFind {
	readonly kind: LooseKind;
	readonly source: LooseSource;
	readonly title: string;
	readonly proof: readonly string[]; // the facts of the engine with their places, or the words of Claude
	readonly file?: string; // relative to the first folder of the project, with /
	readonly lines?: Lines;
	readonly code?: string; // the text of the first line, so that the place moves with its code
}

export interface LooseEndItem extends LooseFind {
	readonly id: string; // E1, E2 and so on
	readonly step: string; // the step that made the loose end
	readonly state: LooseState;
	readonly time: string;
	readonly handed?: string; // the step of Claude for the loose end, for example L1
	readonly reason?: string; // the reason of the user for a closed loose end
}

export interface LooseFile {
	readonly version: 1;
	readonly ends: readonly LooseEndItem[];
	readonly checked: readonly string[]; // the steps that Shotgun checked at their gates
	readonly nextId: number;
}

export const EMPTY_LOOSE: LooseFile = { version: FILE_VERSION, ends: [], checked: [], nextId: 1 };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

//-------------------
// The facts of DataFlow

// The new data members and the new enumerators of a type: its members from the outline of DataFlow with a declaration on
// an added line. A static data member does not count. A type with only new members is a new type, and a new type has no
// loose ends
export function newMembers(members: readonly OutlineMemberFacts[], added: readonly number[]): { fields: string[]; enumerators: string[] } {
	const lines = new Set(added);
	const own = members.filter((m) => !m.file);
	const fields = own.filter((m) => m.kind === 'field' && !(m.marks ?? []).includes('static'));
	const enumerators = own.filter((m) => m.kind === 'enumerator');
	const fresh = (list: OutlineMemberFacts[]) => (list.every((m) => lines.has(m.line)) ? [] : list.filter((m) => lines.has(m.line)).map((m) => m.name));
	return { fields: fresh(fields), enumerators: fresh(enumerators) };
}

// The name of a function with no namespaces and no class, for a short title. The proof keeps the qualified name
export function shortName(name: string): string {
	const i = name.lastIndexOf('::');
	return i < 0 ? name : name.slice(i + 2);
}

// The loose ends of a new data member: each function that uses most data members of the type, but not the new member.
// rel: the path of a file of DataFlow, relative to the first folder of the project
export function memberEnds(sites: MemberSitesFacts, member: string, rel: (file: string) => string): LooseFind[] {
	const count = sites.members?.length ?? 0;
	return (sites.functions ?? [])
		.filter((f) => f.part >= MIN_PART && !f.uses.includes(member))
		.slice(0, MAX_MEMBER_ENDS)
		.map((f) => ({
			kind: 'mechanical' as const,
			source: 'members' as const,
			title: `${shortName(f.function)} does not use ${member}`,
			proof: [`${f.function} uses ${f.uses.length} of ${count} data members of ${sites.type}, but not the new member ${member}. `
				+ 'A function that uses most members often loads, saves or copies the type.'],
			file: rel(f.file),
			lines: [f.lines[0], f.lines[1]] as const,
		}));
}

// The loose ends of a new enumerator: each switch statement on the enum that does not handle it
export function switchEnds(sites: MemberSitesFacts, enumerator: string, rel: (file: string) => string): LooseFind[] {
	return (sites.switches ?? [])
		.filter((s) => s.missing.includes(enumerator))
		.slice(0, MAX_MEMBER_ENDS)
		.map((s) => ({
			kind: 'mechanical' as const,
			source: 'switch' as const,
			title: `The switch in ${shortName(s.function)} does not handle ${enumerator}`,
			proof: [`The switch statement on ${sites.type} in ${s.function} has no case for the new enumerator ${enumerator}. `
				+ (s.hasDefault ? 'Its default case runs for it.' : 'It has no default case.')],
			file: rel(s.file),
			lines: [s.line, s.line] as const,
		}));
}

// The loose ends of the ripple of the changes of a step: each caller that gets the result of a changed function. The user
// decides if the caller needs a change. isChanged: the line is a changed line of the step
export function rippleEnds(ripple: RippleFacts, rel: (file: string) => string, isChanged: (file: string, line: number) => boolean): LooseFind[] {
	const out: LooseFind[] = [];
	const seen = new Set<string>();
	for (const change of ripple.changes ?? []) {
		for (const body of change.bodies) {
			const file = rel(body.call?.file ?? body.file);
			const line = body.call?.line ?? body.lines[0];
			const key = `${change.function}|${body.function}`;
			if (body.depth < 1 || line === undefined || isChanged(file, line) || seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push({
				kind: 'decision',
				source: 'ripple',
				title: `The change of ${shortName(change.function)} reaches ${shortName(body.function)}`,
				proof: [
					`${body.function} gets the result of ${change.function}${body.depth > 1 ? ' through a different caller' : ''}, on line ${line}.`,
					...body.steps.slice(0, 3).map((s) => `Line ${s.line}: ${s.text}`),
				],
				file,
				lines: [line, line],
			});
		}
	}
	return out.slice(0, MAX_RIPPLE_ENDS);
}

// The loose ends of Claude in a receipt. Claude can do them, so they are mechanical. Their words have the badge Model
export function claudeEnds(ends: readonly { readonly text: string; readonly file?: string; readonly lines?: Lines }[]): LooseFind[] {
	return ends.map((e) => {
		const first = e.text.split(/(?<=[.!?])\s/)[0];
		return {
			kind: 'mechanical' as const,
			source: 'claude' as const,
			title: first.length > 120 ? `${first.slice(0, 117)}...` : first,
			proof: [e.text],
			...(e.file ? { file: e.file } : {}),
			...(e.file && e.lines ? { lines: e.lines } : {}),
		};
	});
}

//-------------------
// The loose ends of a task

// Adds the loose ends of a step. A loose end that is open or handed with the same source, title and file comes only 1
// time. Each new loose end gets the next id
export function addLooseEnds(file: LooseFile, step: string, finds: readonly LooseFind[], time: string): LooseFile {
	const keyOf = (f: LooseFind) => `${f.source}|${f.title}|${f.file ?? ''}`;
	const known = new Set(file.ends.filter((e) => e.state !== 'closed').map(keyOf));
	let nextId = file.nextId;
	const added: LooseEndItem[] = [];
	for (const find of finds) {
		const key = keyOf(find);
		if (known.has(key)) {
			continue;
		}
		known.add(key);
		added.push({ ...find, id: `E${nextId++}`, step, state: 'open', time });
	}
	return { version: FILE_VERSION, ends: [...file.ends, ...added], checked: [...new Set([...file.checked, step])], nextId };
}

// The id of the next step of a loose end: L1, L2 and so on
export function nextLooseStepId(steps: readonly PlanStep[]): string {
	const numbers = steps.map((s) => /^L(\d+)$/.exec(s.id)?.[1]).filter((n): n is string => !!n).map(Number);
	return `L${Math.max(0, ...numbers) + 1}`;
}

// The place of the step of a loose end in the plan (decision 21): after the step that is open, or before the next step
// that nobody started. A new step goes after the steps of loose ends that wait there already
export function looseIndex(steps: readonly PlanStep[], stateOf: (id: string) => StepState): number {
	let i = steps.findIndex((s) => stateOf(s.id) !== 'done');
	if (i < 0) {
		return steps.length;
	}
	if (stateOf(steps[i].id) !== 'todo') {
		i++;
	}
	while (i < steps.length && steps[i].looseEnd && stateOf(steps[i].id) === 'todo') {
		i++;
	}
	return i;
}

// The step of Claude for a loose end that the user hands to Claude. task: the task of the step that made the loose end
export function looseStep(end: LooseEndItem, id: string, task: string): PlanStep {
	if (!end.file || !end.lines) {
		throw new Error(`The loose end ${end.id} has no place, so Claude cannot do it as a step. Close it, or tell Claude what to do.`);
	}
	const title = end.title.length > MAX_STEP_TITLE ? `${end.title.slice(0, MAX_STEP_TITLE - 3)}...` : end.title;
	const text = `A loose end of step ${end.step}: ${end.title}. ${end.proof.join(' ')}`;
	return {
		id,
		title,
		task,
		hooks: [],
		places: [{ file: end.file, lines: end.lines, ...(end.code ? { code: end.code, codeLine: end.lines[0] } : {}) }],
		text: text.length > MAX_STEP_TEXT ? `${text.slice(0, MAX_STEP_TEXT - 3)}...` : text,
		checks: ['The project builds.', `The loose end is closed: ${title}.`],
		looseEnd: end.id,
	};
}

export function parseLoose(text: string, id: string): LooseFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${LOOSE_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > FILE_VERSION) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version ${FILE_VERSION}. Install a newer version of Shotgun.`);
	}
	const isEnd = (e: unknown) => isObject(e) && typeof e.id === 'string' && typeof e.step === 'string' && typeof e.title === 'string'
		&& (e.kind === 'mechanical' || e.kind === 'decision') && ['members', 'switch', 'ripple', 'claude'].includes(String(e.source))
		&& ['open', 'handed', 'closed'].includes(String(e.state)) && Array.isArray(e.proof) && typeof e.time === 'string';
	if (value.version !== FILE_VERSION || !Array.isArray(value.ends) || !value.ends.every(isEnd) || !Array.isArray(value.checked)
		|| typeof value.nextId !== 'number') {
		throw new Error(`${name} needs the fields version, ends, checked and nextId, and each loose end needs its fields.`);
	}
	return value as unknown as LooseFile;
}
