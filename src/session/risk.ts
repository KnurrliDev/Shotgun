import type { Band } from './survey';

// The risk level of a step of the plan, from the facts of DataFlow (decisions 8, 9 and 14 of the plan). The heat band
// of the hottest function gives the basic level. More rules make the level only higher. 3 rules are for a place with no
// function. Only the user changes a level. These functions use no VS Code API, so the unit tests give them tables of
// facts and levels.

export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: readonly Level[] = [1, 2, 3, 4, 5];
export const isLevel = (value: unknown): value is Level => typeof value === 'number' && (LEVELS as readonly number[]).includes(value);

export const LEVEL_OF_BAND: Readonly<Record<Band, Level>> = { cool: 2, warm: 3, hot: 4, 'very hot': 5 };

// The writer of a step at a level: Claude, a frame of Claude with holes for the user, or the user
export type StepWriter = 'claude' | 'frame' | 'user';

export const LEVEL_INFO: Readonly<Record<Level, { readonly name: string; readonly writer: StepWriter; readonly text: string }>> = {
	1: { name: 'Very low', writer: 'claude', text: 'Claude writes. The step changes no code that is there. You check 1 receipt.' },
	2: { name: 'Low', writer: 'claude', text: 'Claude writes in the scope of the step. You check the receipt.' },
	3: { name: 'Medium', writer: 'frame', text: 'Claude writes the frame. Each open decision is a hole for you.' },
	4: { name: 'High', writer: 'user', text: 'You write. A frame is possible on request. Tests run before and after the step.' },
	5: { name: 'Very high', writer: 'user', text: 'You write each line. Claude gives facts and callouts only. The step gets its own commit.' },
};

// The state of the scan of the call graph of DataFlow
export type ScanState = 'none' | 'scanning' | 'stopped' | 'ready' | 'failed';

// The heat of the hottest function at a place, with the parts of its score for the page
export interface PlaceHeat {
	readonly function: string;
	readonly score: number;
	readonly band: Band;
	readonly isReachComplete: boolean;
	readonly reachUnknown?: string;
	readonly flames?: number;
	readonly reach?: number;
	readonly risk?: number;
	readonly history?: number;
	readonly isSiloed?: boolean;
	readonly signals?: readonly { readonly points: number; readonly text: string }[]; // the reasons of the score, the most points first
}

// The facts of DataFlow for 1 place of a step. kind: new, a new file. other: a file that is not C or C++. function: lines
// in a function. type: lines in a type and in no function. none: lines in no function and in no type. unknown: DataFlow
// gave no facts, for example before the start of its engine. Then reason tells why
export interface PlaceRisk {
	readonly kind: 'new' | 'other' | 'function' | 'type' | 'none' | 'unknown';
	readonly reason?: string;
	readonly heat?: PlaceHeat;
	readonly workerThreads?: readonly string[]; // the labels of the worker threads that run the line
	readonly locks?: readonly string[]; // the locks that the code holds at the line
	readonly framePath?: { readonly reason: string; readonly isPastLimit: boolean };
	readonly mainLoop?: string; // the function with the main loop, if the line is in an open loop of that function
	readonly type?: {
		readonly name: string;
		readonly isHot: boolean; // a data member is on a frame path, or 2 or more threads use it
		readonly isNew?: boolean; // the step adds a data member next to the lines, and changes no member (P26)
		readonly changed: readonly string[]; // the data members in the lines that the step changes
		readonly hottestUser?: { readonly function: string; readonly score: number; readonly band: Band };
	};
}

export interface RuleResult {
	readonly level: Level | null; // null: no level before the end of the scan of the call graph
	readonly reasons: readonly string[]; // the rules that gave the level, in words
}

const list = (items: readonly string[]): string => (items.length <= 1 ? items.join('')
	: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// The level of 1 place from its facts. scan: the state of the scan of the call graph
export function placeLevel(place: PlaceRisk, scan: ScanState): RuleResult {
	switch (place.kind) {
		case 'new':
			return { level: 1, reasons: ['A new file with no caller: level 1.'] };
		case 'other':
			return { level: 2, reasons: ['The file is not a C or C++ file. DataFlow has no facts for it: level 2, no facts.'] };
		case 'none':
			return { level: 2, reasons: ['The lines are in no function and in no type, so they have no heat: level 2.'] };
		case 'unknown':
			return { level: null, reasons: [place.reason ?? 'DataFlow gave no facts for the place. The level comes when DataFlow gives them.'] };
		case 'type':
			return typeLevel(place);
		case 'function':
			return functionLevel(place, scan);
	}
}

// A place in a type. A new data member gets level 2. It gets level 3 if a data member of the type is on a frame path, or
// if threads share it. A change of a data member gets the level of its hottest user. A place with insert changes no
// member, so the hottest user does not apply (P26)
function typeLevel(place: PlaceRisk): RuleResult {
	const type = place.type!;
	let level: Level = type.isHot ? 3 : 2;
	let reason: string;
	if (type.isNew) {
		reason = type.isHot
			? `The step adds a data member to the type ${type.name}. A data member of this type is on a frame path, or threads share it: level 3.`
			: `The step adds a data member to the type ${type.name}, with no frame path and no shared data: level 2.`;
	} else {
		reason = type.isHot
			? `A data member of the type ${type.name} is on a frame path, or threads share it: level 3.`
			: `A data member of the type ${type.name}, with no frame path and no shared data: level 2.`;
	}
	const reasons = [reason];
	const user = type.hottestUser;
	if (user && LEVEL_OF_BAND[user.band] > level) {
		level = LEVEL_OF_BAND[user.band];
		reasons.push(`The step changes ${list(type.changed)}. The hottest function that uses ${type.changed.length === 1 ? 'it' : 'them'}, ${user.function}, `
			+ `is ${user.band}: level ${level}.`);
	}
	return { level, reasons };
}

function functionLevel(place: PlaceRisk, scan: ScanState): RuleResult {
	const heat = place.heat!;
	let level: number = LEVEL_OF_BAND[heat.band];
	const reasons = [`A change of a ${heat.band} function, ${heat.function}: level ${level}.`];
	const atLeast = (min: number, reason: string) => {
		if (level < min) {
			level = min;
			reasons.push(reason);
		}
	};
	const oneMore = (reason: string) => {
		if (level < 5) {
			level++;
			reasons.push(reason);
		}
	};
	if (!heat.isReachComplete) {
		if (scan === 'none' || scan === 'scanning') {
			return { level: null, reasons: ['The scan of the call graph is not complete. The level comes at the end of the scan.'] };
		}
		atLeast(3, scan === 'ready' ? 'The reach of the function is not complete: level 3 or higher.'
			: `The scan of the call graph ${scan === 'failed' ? 'failed' : 'stopped'}, so the reach is not complete: level 3 or higher.`);
	}
	if (heat.reachUnknown) {
		atLeast(3, 'The call graph cannot see all callers of the function: level 3 or higher.');
	}
	if (place.framePath?.isPastLimit) {
		atLeast(4, 'The line runs in each frame, on a frame path with more than 8 calls: level 4 or higher.');
	}
	if (place.mainLoop) {
		atLeast(4, `The line is in the main loop of ${place.mainLoop}: level 4 or higher.`);
	}
	if (place.workerThreads && place.workerThreads.length > 0) {
		oneMore(`The worker thread ${list(place.workerThreads)} runs the line: 1 level more.`);
	}
	if (place.locks && place.locks.length > 0) {
		oneMore(`The line holds the lock ${list(place.locks)}: 1 level more.`);
	}
	return { level: level as Level, reasons };
}

// The level of a step: the highest level of its places. With no level for a place, the step has no level yet
export function stepLevel(places: readonly RuleResult[]): RuleResult {
	const waiting = places.find((p) => p.level === null);
	if (waiting) {
		return { level: null, reasons: waiting.reasons };
	}
	const highest = places.reduce<RuleResult | undefined>((best, p) => (!best || (p.level ?? 0) > (best.level ?? 0) ? p : best), undefined);
	return highest ?? { level: null, reasons: ['The step has no place.'] };
}

// The main loop of a line: a loop around the line is a main loop of the call graph. DataFlow gives isMainLoop for each
// loop only when the call graph is complete, and a step gets no level before that. The result: the function of the line
export function mainLoopAt(fn: string | undefined, around: readonly { readonly kind: string; readonly isMainLoop?: boolean }[]): string | undefined {
	return fn && around.some((s) => (s.kind === 'for' || s.kind === 'while' || s.kind === 'do') && s.isMainLoop === true) ? fn : undefined;
}
