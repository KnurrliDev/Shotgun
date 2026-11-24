import { absolutePath, isInside, projectPath } from './paths';
import type { Lines } from './survey';

// Stage 5: a frame of Claude (phase 7). Claude writes the lines of a step with no decision, and a hole marker for each
// decision of the user: /*@hole N: question */. Each hole has 4 hints: a nudge, a pointer with places, an example with
// a place and its code, and the answer. The user fills each hole. A format can break a long marker into more lines with
// " * " at the start of each line (spike S5). These functions use no VS Code API, so the unit tests can call them.

export const MAX_HOLES = 10;
// A frame for a step with no open decision, by the choice of the user (decision 44), has 1 to 3 holes in the logic of the step
export const MAX_FREE_HOLES = 3;
const MAX_QUESTION = 200;
const MAX_HINT = 600;
const MAX_ANSWER = 2000;
const MAX_CODE = 600;
const MAX_FRAME_NOTE = 1000;
const MAX_POINTER_PLACES = 4;
// The lines that the search for a filled hole examines above and below its last line
const WINDOW = 200;
// The maximum number of the lines of a filled hole that is alone on its lines
const MAX_SPAN = 60;

// A hole marker in the text of a file. Lines from 1, columns from 0
export interface Marker {
	readonly n: number;
	readonly question: string;
	readonly start: { readonly line: number; readonly col: number };
	readonly end: { readonly line: number; readonly col: number }; // the position after the marker
}

// The text around a marker, to find the hole again after the user filled it. before and after: the text of the line
// before and after the marker. A marker alone on its lines has no such text: then prev and next give the lines around it
export interface HoleAnchor {
	readonly before: string;
	readonly after: string;
	readonly prev?: string;
	readonly next?: string;
}

export interface HoleHints {
	readonly nudge: string; // a question that shows the way, with no code
	readonly pointer: { readonly text: string; readonly places: readonly { readonly file: string; readonly lines: Lines }[] };
	readonly example: { readonly text: string; readonly file: string; readonly lines: Lines; readonly code: string };
	readonly answer: string; // the code in the place of the marker
}

// The facts of DataFlow at the line of a hole
export interface HoleFacts {
	readonly function?: string;
	readonly threads: readonly string[];
	readonly locks: readonly string[];
	readonly names?: readonly string[]; // the names in scope at the line with their types, for example "limit: int" (item 45)
}

export interface Hole {
	readonly n: number;
	readonly question: string;
	readonly decision?: string; // the open decision of the step that the hole decides, for example D1 (decision 32)
	readonly file: string; // relative to the first folder of the project, with /
	readonly line: number; // the first line of the marker at the time of the frame
	readonly anchor: HoleAnchor;
	readonly hints: HoleHints;
	readonly shown: number; // the hints that the user opened, from 0 to 4. 4: the answer of Claude filled the hole
	readonly facts?: HoleFacts;
}

// open: the marker is there. done: code is in the place of the marker. empty: the marker is not there, but no code is in
// its place. changed: Shotgun cannot find the place of the hole, because the lines around it changed
export type HoleState = 'open' | 'done' | 'empty' | 'changed';

export interface HoleNow {
	readonly state: HoleState;
	readonly line: number; // the first line now
	readonly lastLine: number;
	readonly marker?: Marker;
	readonly content?: string; // the code in the place of the marker
}

// The question of a marker on 1 line, with no " * " of a format
const questionOf = (text: string): string => text.replace(/\r?\n[ \t]*\*?[ \t]?/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The hole markers of a text
export function findMarkers(text: string): Marker[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\n') {
			starts.push(i + 1);
		}
	}
	const position = (offset: number) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= offset) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return { line: lo + 1, col: offset - starts[lo] };
	};
	const out: Marker[] = [];
	for (const m of text.matchAll(MARKER)) {
		const offset = m.index ?? 0;
		out.push({ n: Number(m[1]), question: questionOf(m[2]), start: position(offset), end: position(offset + m[0].length) });
	}
	return out;
}

const MARKER = /\/\*[ \t]*@hole[ \t]+(\d+)[ \t]*:?([\s\S]*?)\*\//g;
// In an anchor, this character is in the place of the marker of a different hole: that hole can get code later
const WILD = '\u0001';
const anchorText = (text: string): string => text.replace(MARKER, WILD).trim();
// A line with only markers of holes, or with no text
const isEmptyLine = (text: string): boolean => !anchorText(text).replace(new RegExp(WILD, 'g'), '').trim();
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The regular expression of an anchor text: a marker of a different hole agrees with each text
const pattern = (text: string): string => escape(text).split(WILD).join('.*?');

export function anchorOf(lines: readonly string[], marker: Marker): HoleAnchor {
	const before = anchorText((lines[marker.start.line - 1] ?? '').slice(0, marker.start.col));
	const after = anchorText((lines[marker.end.line - 1] ?? '').slice(marker.end.col));
	if (before || after) {
		return { before, after };
	}
	let p = marker.start.line - 2;
	while (p >= 0 && isEmptyLine(lines[p])) {
		p--;
	}
	let q = marker.end.line;
	while (q < lines.length && isEmptyLine(lines[q])) {
		q++;
	}
	return { before, after, ...(p >= 0 ? { prev: anchorText(lines[p]) } : {}), ...(q < lines.length ? { next: anchorText(lines[q]) } : {}) };
}

// The state of a hole in the text now. markers: the markers of the file of the hole now
export function holeNow(lines: readonly string[], hole: Pick<Hole, 'n' | 'line' | 'anchor'>, markers: readonly Marker[]): HoleNow {
	const distance = (line: number) => Math.abs(line - hole.line);
	const marker = markers.filter((m) => m.n === hole.n).sort((a, b) => distance(a.start.line) - distance(b.start.line))[0];
	if (marker) {
		return { state: 'open', line: marker.start.line, lastLine: marker.end.line, marker };
	}
	const from = Math.max(0, hole.line - 1 - WINDOW);
	const to = Math.min(lines.length, hole.line + WINDOW);
	const { before, after, prev, next } = hole.anchor;
	if (before || after) {
		// the line with the text before and after the hole, the nearest to the old line
		const re = new RegExp(`^${pattern(before)}(.*)${pattern(after)}$`);
		let best = -1;
		let content = '';
		for (let i = from; i < to; i++) {
			const m = re.exec(lines[i].trim());
			if (m && (best < 0 || distance(i + 1) < distance(best + 1))) {
				best = i;
				content = m[1].trim();
			}
		}
		if (best < 0) {
			return { state: 'changed', line: hole.line, lastLine: hole.line };
		}
		return { state: content ? 'done' : 'empty', line: best + 1, lastLine: best + 1, ...(content ? { content } : {}) };
	}
	// a hole alone on its lines: the lines between the line before it and the line after it
	const prevRe = prev === undefined ? undefined : new RegExp(`^${pattern(prev)}$`);
	const nextRe = next === undefined ? undefined : new RegExp(`^${pattern(next)}$`);
	let best: { p: number; q: number } | undefined;
	const ps = !prevRe ? [-1] : [...Array(to - from).keys()].map((k) => from + k).filter((i) => prevRe.test(lines[i].trim()));
	for (const p of ps) {
		let q = p + 1;
		while (q < lines.length && q - p <= MAX_SPAN && !(nextRe && !isEmptyLine(lines[q]) && nextRe.test(lines[q].trim()))) {
			q++;
		}
		if ((nextRe && (q >= lines.length || q - p > MAX_SPAN)) || (best && distance(p + 2) >= distance(best.p + 2))) {
			continue;
		}
		best = { p, q };
	}
	if (!best) {
		return { state: 'changed', line: hole.line, lastLine: hole.line };
	}
	// the code in the place of the hole, with no line of a marker of a different hole
	const body = lines.slice(best.p + 1, best.q).filter((l) => !isEmptyLine(l));
	const content = body.join('\n').trim();
	return {
		state: content ? 'done' : 'empty', line: best.p + 2, lastLine: Math.max(best.p + 2, best.q),
		...(content ? { content: body.map((l) => l.trim()).join('\n') } : {}),
	};
}

// A hole that counts as done for the gate: code is in its place, or its place changed so much that Shotgun cannot find it
export const isHoleDone = (state: HoleState): boolean => state === 'done' || state === 'changed';

export interface FrameContext {
	readonly root: string;
	readonly scope: readonly string[]; // relative to the root
	readonly folders: readonly string[];
	readonly isCaseSensitive: boolean;
	readonly readLines: (file: string) => readonly string[] | undefined; // the lines of a file now, from an open text editor first
	// the open decisions of the step: each one needs 1 hole (decision 32). undefined: a plan of version 0.1.0 (P34)
	readonly decisions?: readonly { readonly id: string; readonly question: string }[];
	readonly stepText?: string; // the text, the checks and the answers of the step. An answer of a hole cannot be in it (P32)
}

//-------------------
// An obvious hole (P32): an answer that is only a type, a name, a literal or a list of parameters. Such code has no
// decision, so it is a line of the frame

const QNAME = String.raw`(?:::)?[A-Za-z_]\w*(?:\s?::\s?[A-Za-z_]\w*)*`;
const LITERAL = /^(?:[-+]?(?:\d|\.\d)[\w.']*|"S"|'C'|true|false|nullptr|NULL)$/;
const NAME = new RegExp(String.raw`^${QNAME}(?:\s?(?:\.|->)\s?[A-Za-z_]\w*)*$`);
const TYPE = new RegExp(String.raw`^(?:(?:const|volatile|unsigned|signed|long|short|struct|class|enum|typename|constexpr|static|inline)\s)*`
	+ String.raw`${QNAME}(?:\s?<[^;{}()=]*>)?(?:\s?::\s?[A-Za-z_]\w*)*(?:\s?(?:\*|&&|&|const\b|volatile\b))*$`);
// a type and a name, with an optional default value: the type ends with a space, *, & or >
const DECLARATION = /^(.+?[\s*&>])\s*([A-Za-z_]\w*)(?:\s?=\s?(.+))?$/;
// the words that start a statement or an expression, not a type
const KEYWORDS = new Set(['return', 'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'throw', 'try',
	'catch', 'new', 'delete', 'co_return', 'co_await', 'co_yield', 'sizeof', 'alignof', 'decltype', 'static_assert', 'using', 'typedef', 'operator', 'not']);

const startsWithKeyword = (code: string): boolean => KEYWORDS.has(/^[A-Za-z_]\w*/.exec(code)?.[0] ?? '');
const isLiteral = (code: string): boolean => LITERAL.test(code);
const isName = (code: string): boolean => NAME.test(code) && !startsWithKeyword(code);
const isType = (code: string): boolean => TYPE.test(code) && !startsWithKeyword(code);

// The code of an answer with no comments, no text in quotes and no last semicolon, on 1 line
function codeOf(answer: string): string {
	return answer.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
		.replace(/"(?:[^"\\\n]|\\.)*"/g, '"S"').replace(/'(?:[^'\\\n]|\\.)*'/g, "'C'")
		.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
}

// The parts of a list at its top level: the commas in <>, () and [] do not split
function topLevelParts(code: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < code.length; i++) {
		const c = code[i];
		if (c === '<' || c === '(' || c === '[') {
			depth++;
		} else if (c === '>' || c === ')' || c === ']') {
			depth--;
		} else if (c === ',' && depth === 0) {
			parts.push(code.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(code.slice(start).trim());
	return parts;
}

// A part of a list of parameters or arguments: a name, a literal, a type, or a type with a name and a default value
function isParameter(part: string): boolean {
	if (isName(part) || isLiteral(part) || isType(part)) {
		return true;
	}
	const m = DECLARATION.exec(part);
	if (!m) {
		return false;
	}
	const init = m[3]?.trim();
	return isType(m[1].trim()) && (init === undefined || isLiteral(init) || isName(init));
}

// True if the answer of a hole is only a type, a name, a literal, a declaration or a list of parameters (P32). An answer
// with more than 1 statement, a block, an operator or a call is not obvious
export function isObviousAnswer(answer: string): boolean {
	const code = codeOf(answer);
	if (!code || /[;{}]/.test(code)) {
		return false;
	}
	// a list of parameters in parentheses, also an empty list
	if (code.startsWith('(') && code.endsWith(')') && topLevelParts(code.slice(1, -1)).every((p) => p === '' || isParameter(p))) {
		return true;
	}
	return topLevelParts(code).every((p) => p !== '' && isParameter(p));
}

// Checks the holes of Claude in submit_frame against the markers in the files of the scope. Each marker needs a hole
// with its 4 hints, and each hole needs its marker. The result has all problems in 1 list (proposal P7)
export function checkFrame(raw: Record<string, unknown>, ctx: FrameContext): { holes: Omit<Hole, 'shown' | 'facts'>[]; note?: string; problems: string[] } {
	const problems: string[] = [];
	const text = (value: unknown) => (typeof value === 'string' ? norm(value) : '');
	const linesOf = (value: unknown): Lines | undefined => (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1)
		&& value[0] <= value[1] ? [value[0], value[1]] : undefined);
	// the markers in the files of the scope
	const markers: { file: string; lines: readonly string[]; marker: Marker }[] = [];
	for (const file of ctx.scope) {
		const lines = ctx.readLines(absolutePath(file, ctx.root));
		if (lines) {
			findMarkers(lines.join('\n')).forEach((marker) => markers.push({ file, lines, marker }));
		}
	}
	const counts = new Map<number, number>();
	markers.forEach((m) => counts.set(m.marker.n, (counts.get(m.marker.n) ?? 0) + 1));
	[...counts].filter(([, c]) => c > 1).forEach(([n]) => problems.push(`The marker of hole ${n} is in the files of the scope ${counts.get(n)} times. Give each hole its own number.`));
	// a step with no open decision: the holes are in the logic of the step, and they decide no decision (decision 44)
	const isFree = !!ctx.decisions && ctx.decisions.length === 0;
	if (markers.length === 0) {
		problems.push(`The files of the scope have no hole marker. Write a marker /*@hole N: question */ in the place of each hole: ${ctx.scope.join(', ')}.`);
	} else if (isFree && markers.length > MAX_FREE_HOLES) {
		problems.push(`The step has no open decision, so its frame has 1 to ${MAX_FREE_HOLES} holes in the logic of the step. The frame has ${markers.length} holes.`);
	} else if (markers.length > MAX_HOLES) {
		problems.push(`The frame has ${markers.length} holes. Give a maximum of ${MAX_HOLES} holes.`);
	}
	// a place of a hint: a file of the project with its lines
	const placeOf = (fileValue: unknown, linesValue: unknown, label: string): { file: string; lines: Lines; text: readonly string[] } | undefined => {
		const name = typeof fileValue === 'string' ? fileValue.trim() : '';
		const lines = linesOf(linesValue);
		if (!name || !lines) {
			problems.push(`${label}: give the "file" and the "lines" [first, last], from 1.`);
			return undefined;
		}
		const full = absolutePath(name, ctx.root);
		if (!ctx.folders.some((f) => isInside(full, f, ctx.isCaseSensitive))) {
			problems.push(`${label}: ${name} is not in a folder of the project.`);
			return undefined;
		}
		const fileLines = ctx.readLines(full);
		if (!fileLines) {
			problems.push(`${label}: the file ${name} is not there.`);
			return undefined;
		}
		if (lines[1] > fileLines.length) {
			problems.push(`${label}: ${name} has ${fileLines.length} lines, so the lines ${lines[0]}-${lines[1]} are not there.`);
			return undefined;
		}
		return { file: projectPath(full, ctx.root, ctx.isCaseSensitive), lines, text: fileLines };
	};
	const holes: Omit<Hole, 'shown' | 'facts'>[] = [];
	const given = new Set<number>();
	const decided = new Set<string>(); // the open decisions with a hole
	const raws = Array.isArray(raw.holes) ? raw.holes : [];
	if (!Array.isArray(raw.holes) || raws.length === 0) {
		problems.push('Give 1 hole or more in "holes", with the number of the marker of each hole.');
	}
	raws.slice(0, MAX_HOLES).forEach((h, i) => {
		const item = (typeof h === 'object' && h !== null && !Array.isArray(h) ? h : {}) as Record<string, unknown>;
		const n = Number.isInteger(item.n) && (item.n as number) >= 1 ? (item.n as number) : 0;
		const label = n ? `Hole ${n}` : `Hole ${i + 1} of the list`;
		if (!n) {
			problems.push(`${label}: give "n", the number of its marker /*@hole N: question */.`);
			return;
		}
		if (given.has(n)) {
			problems.push(`${label} is in "holes" 2 times.`);
			return;
		}
		given.add(n);
		const found = markers.find((m) => m.marker.n === n);
		const question = text(item.question);
		const nudge = text(item.nudge);
		const answer = typeof item.answer === 'string' ? item.answer.replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '') : '';
		const pointer = (typeof item.pointer === 'object' && item.pointer !== null ? item.pointer : {}) as Record<string, unknown>;
		const example = (typeof item.example === 'object' && item.example !== null ? item.example : {}) as Record<string, unknown>;
		if (!found) {
			problems.push(`${label} has no marker /*@hole ${n}: question */ in the files of the scope. Write the marker in the place of the decision.`);
		} else if (norm(found.marker.question).toLowerCase() !== question.toLowerCase()) {
			problems.push(`${label}: the question "${question}" is not the question of its marker: "${found.marker.question}". Give the same question.`);
		}
		if (!question || question.length > MAX_QUESTION) {
			problems.push(`${label}: give a "question" of 1 to ${MAX_QUESTION} characters.`);
		}
		if (!nudge || nudge.length > MAX_HINT) {
			problems.push(`${label}: give a "nudge" of 1 to ${MAX_HINT} characters: a question that shows the way, with no code.`);
		}
		const pointerText = text(pointer.text);
		if (!pointerText || pointerText.length > MAX_HINT) {
			problems.push(`${label}: give "pointer.text" of 1 to ${MAX_HINT} characters: where the facts for the decision are.`);
		}
		const rawPlaces = Array.isArray(pointer.places) ? pointer.places : [];
		if (rawPlaces.length === 0 || rawPlaces.length > MAX_POINTER_PLACES) {
			problems.push(`${label}: give 1 to ${MAX_POINTER_PLACES} "pointer.places" with the file and the lines of each fact.`);
		}
		const places = rawPlaces.slice(0, MAX_POINTER_PLACES).map((p, j) => {
			const place = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
			return placeOf(place.file, place.lines, `${label}, pointer place ${j + 1}`);
		}).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ file: p.file, lines: p.lines }));
		const exampleText = text(example.text);
		const code = typeof example.code === 'string' ? example.code.trim() : '';
		if (!exampleText || exampleText.length > MAX_HINT) {
			problems.push(`${label}: give "example.text" of 1 to ${MAX_HINT} characters: why the example helps.`);
		}
		const examplePlace = placeOf(example.file, example.lines, `${label}, example`);
		if (!code || code.length > MAX_CODE) {
			problems.push(`${label}: give "example.code" of 1 to ${MAX_CODE} characters, copied exactly from its lines.`);
		} else if (examplePlace && !norm(examplePlace.text.slice(examplePlace.lines[0] - 1, examplePlace.lines[1]).join('\n')).includes(norm(code))) {
			problems.push(`${label}: the example code is not in ${examplePlace.file}:${examplePlace.lines[0]}-${examplePlace.lines[1]}. Copy the code exactly from these lines.`);
		}
		if (!answer || answer.length > MAX_ANSWER) {
			problems.push(`${label}: give the "answer" of 1 to ${MAX_ANSWER} characters: the code in the place of the marker.`);
		} else if (/\/\*\s*@hole/.test(answer)) {
			problems.push(`${label}: the answer has a hole marker. Give the code of the decision.`);
		} else if (isObviousAnswer(answer)) {
			problems.push(`${label}: the answer "${norm(answer)}" is only a type, a name, a literal or a list of parameters. Such code is no decision: `
				+ 'write it in the frame. A hole holds the whole code of its decision, for example a condition with its branch.');
		} else if (ctx.stepText && norm(codeOf(answer)).length >= 8 && norm(ctx.stepText).includes(norm(codeOf(answer)))) {
			problems.push(`${label}: the text of the step already gives the answer "${norm(answer)}", so the hole is no open decision. Write it in the frame.`);
		}
		// the open decision of the hole (decision 32)
		const decision = typeof item.decision === 'string' ? item.decision.trim() : '';
		if (ctx.decisions && !isFree) {
			const ids = ctx.decisions.map((d) => d.id).join(', ');
			if (!decision) {
				problems.push(`${label}: give "decision": the id of the open decision of the step that the hole decides (${ids}).`);
			} else if (!ctx.decisions.some((d) => d.id === decision)) {
				problems.push(`${label}: ${decision} is not an open decision of the step. The open decisions are ${ids}. A decision with an answer of the user `
					+ 'is no hole: write the code of the answer in the frame.');
			} else if (decided.has(decision)) {
				problems.push(`${label}: the decision ${decision} has a hole already. Give each open decision exactly 1 hole.`);
			}
			decided.add(decision);
		}
		if (found && question && nudge && pointerText && places.length > 0 && exampleText && examplePlace && code && answer) {
			holes.push({
				n, question: found.marker.question, ...(ctx.decisions && !isFree && decision ? { decision } : {}), file: found.file, line: found.marker.start.line,
				anchor: anchorOf(found.lines, found.marker),
				hints: {
					nudge,
					pointer: { text: pointerText, places },
					example: { text: exampleText, file: examplePlace.file, lines: examplePlace.lines, code },
					answer,
				},
			});
		}
	});
	markers.filter((m) => !given.has(m.marker.n)).forEach((m) => problems.push(`The marker of hole ${m.marker.n} in ${m.file}:${m.marker.start.line} has no hints. Give hole ${m.marker.n} in "holes".`));
	(ctx.decisions ?? []).filter((d) => !decided.has(d.id)).forEach((d) => problems.push(`The open decision ${d.id} "${d.question}" has no hole. `
		+ 'Give each open decision of the step 1 hole with the whole code of the decision.'));
	const note = text(raw.note);
	if (note.length > MAX_FRAME_NOTE) {
		problems.push(`The "note" has more than ${MAX_FRAME_NOTE} characters.`);
	}
	return { holes: holes.sort((a, b) => a.n - b.n), ...(note ? { note } : {}), problems };
}

// The text in the place of a marker for the answer of Claude. The lines after the first get the indent of the line of
// the marker, so a statement of more lines keeps its form
export function answerText(answer: string, markerLine: string): string {
	const indent = /^[ \t]*/.exec(markerLine)?.[0] ?? '';
	return answer.split('\n').map((l, i) => (i === 0 ? l : `${indent}${l}`)).join('\n');
}
