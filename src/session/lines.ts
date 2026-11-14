import { mkdirSync, rmSync } from 'fs';
import * as path from 'path';
import { FILE_VERSION, jsonText, readText, writeTextAtomic } from './files';
import type { Lines } from './survey';

// The writer of each changed line in the build (section 6.9 of the plan). lines.json keeps a short hash of each line of
// a file with lines of a writer, and the runs of the lines of each writer. After a change of the file, Shotgun compares
// the hashes with the text now. A line that is there again keeps its writer, and a line that changed loses it. A new
// line gets the writer of the change: the user for an edit in the text editor, Claude for an added line of a receipt.
// The pure functions use no VS Code API, so the unit tests can call them directly.

export const LINES_FILE = 'lines.json';

export type LineWriter = 'claude' | 'user';

// The writer of 1 line. step: the id of the step of the plan. change: the id of the change of a receipt
export interface LineOwner {
	readonly writer: LineWriter;
	readonly step: string;
	readonly change?: string;
}

export interface LineRun extends LineOwner {
	readonly lines: Lines; // [first, last], from 1
}

export interface FileLines {
	readonly hashes: string; // HASH_SIZE characters for each line of the file at the last check
	readonly runs: readonly LineRun[];
}

export interface LinesFile {
	readonly version: 1;
	readonly files: Readonly<Record<string, FileLines>>; // by the path of the file, relative to the first folder of the project
}

export const HASH_SIZE = 6;

// The hash of a line. A change of the spaces only, for example a new indent, keeps the hash
export function hashLine(text: string): string {
	const norm = text.trim().replace(/\s+/g, ' ');
	let h = 0x811c9dc5;
	for (let i = 0; i < norm.length; i++) {
		h ^= norm.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 2) & 0x3fffffff).toString(36).padStart(HASH_SIZE, '0');
}

export const hashLines = (lines: readonly string[]): string[] => lines.map(hashLine);

const splitHashes = (hashes: string): string[] => {
	const out: string[] = [];
	for (let i = 0; i + HASH_SIZE <= hashes.length; i += HASH_SIZE) {
		out.push(hashes.slice(i, i + HASH_SIZE));
	}
	return out;
};

// The maximum number of edits in the diff of the middle part. After it, the lines of the middle part are all new
const MAX_EDITS = 1000;

// The lines of the old text in the new text. The result has, for each line of the new text, the index of the old line,
// or -1 for a new line. The lines at the start and at the end that did not change come first, then the shortest list of
// edits of the middle part (the diff of Myers)
export function mapLines(old: readonly string[], next: readonly string[]): number[] {
	const out = new Array<number>(next.length).fill(-1);
	let start = 0;
	while (start < old.length && start < next.length && old[start] === next[start]) {
		out[start] = start;
		start++;
	}
	let oldEnd = old.length;
	let nextEnd = next.length;
	while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) {
		oldEnd--;
		nextEnd--;
		out[nextEnd] = oldEnd;
	}
	const pairs = myers(old.slice(start, oldEnd), next.slice(start, nextEnd), MAX_EDITS) ?? [];
	for (const [a, b] of pairs) {
		out[start + b] = start + a;
	}
	return out;
}

// The pairs of equal lines [index in a, index in b] of the shortest edit script, or undefined after maxEdits edits
function myers(a: readonly string[], b: readonly string[], maxEdits: number): [number, number][] | undefined {
	const n = a.length;
	const m = b.length;
	if (n === 0 || m === 0) {
		return [];
	}
	const limit = Math.min(n + m, maxEdits);
	const offset = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	// trace[d]: the values of v for k from -d to d after round d
	const trace: Int32Array[] = [];
	for (let d = 0; d <= limit; d++) {
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				trace.push(v.slice(offset - d, offset + d + 1));
				return backtrack(trace, n, m);
			}
		}
		trace.push(v.slice(offset - d, offset + d + 1));
	}
	return undefined;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): [number, number][] {
	const pairs: [number, number][] = [];
	const at = (d: number, k: number) => trace[d][k + d];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d > 0; d--) {
		const k = x - y;
		const prevK = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1)) ? k + 1 : k - 1;
		const prevX = at(d - 1, prevK);
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			pairs.push([x, y]);
		}
		x = prevX;
		y = prevY;
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		pairs.push([x, y]);
	}
	return pairs.reverse();
}

// The writer of each line, from the runs. count: the number of the lines of the file
function ownersOf(runs: readonly LineRun[], count: number): (LineOwner | undefined)[] {
	const owners = new Array<LineOwner | undefined>(count).fill(undefined);
	for (const r of runs) {
		const owner: LineOwner = { writer: r.writer, step: r.step, ...(r.change ? { change: r.change } : {}) };
		for (let line = r.lines[0]; line <= Math.min(r.lines[1], count); line++) {
			owners[line - 1] = owner;
		}
	}
	return owners;
}

const isSameOwner = (a: LineOwner, b: LineOwner): boolean => a.writer === b.writer && a.step === b.step && a.change === b.change;

// The runs of the lines with the same writer, step and change
export function runsOf(owners: readonly (LineOwner | undefined)[]): LineRun[] {
	const runs: LineRun[] = [];
	owners.forEach((owner, i) => {
		if (!owner) {
			return;
		}
		const last = runs[runs.length - 1];
		if (last && last.lines[1] === i && isSameOwner(last, owner)) {
			runs[runs.length - 1] = { ...last, lines: [last.lines[0], i + 1] };
		} else {
			runs.push({ ...owner, lines: [i + 1, i + 1] });
		}
	});
	return runs;
}

// The lines of a file after a change of its text. writer: the writer of the new lines, else they have no writer
export function moveLines(file: FileLines | undefined, next: readonly string[], writer?: LineOwner): FileLines {
	const nextHashes = hashLines(next);
	const oldHashes = file ? splitHashes(file.hashes) : [];
	const owners = ownersOf(file?.runs ?? [], oldHashes.length);
	const map = mapLines(oldHashes, nextHashes);
	const moved = map.map((i) => (i >= 0 ? owners[i] : writer));
	return { hashes: nextHashes.join(''), runs: runsOf(moved) };
}

// Gives lines of a file a writer. lines: the numbers of the lines, from 1. The file must have the text now
export function setOwner(file: FileLines, lines: readonly number[], owner: LineOwner): FileLines {
	const count = file.hashes.length / HASH_SIZE;
	const owners = ownersOf(file.runs, count);
	for (const line of lines) {
		if (line >= 1 && line <= count) {
			owners[line - 1] = owner;
		}
	}
	return { hashes: file.hashes, runs: runsOf(owners) };
}

// The number of the lines of each writer in the runs
export function lineCounts(runs: readonly LineRun[]): Record<LineWriter, number> {
	const counts: Record<LineWriter, number> = { claude: 0, user: 0 };
	runs.forEach((r) => (counts[r.writer] += r.lines[1] - r.lines[0] + 1));
	return counts;
}

export function parseLines(text: string, id: string): LinesFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${LINES_FILE}`;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	const v = value as Record<string, unknown>;
	if (typeof v.version === 'number' && v.version > FILE_VERSION) {
		throw new Error(`${name} has the version ${v.version}. This version of Shotgun reads only version ${FILE_VERSION}. Install a newer version of Shotgun.`);
	}
	const isRun = (r: unknown) => {
		const run = r as Record<string, unknown>;
		return typeof r === 'object' && r !== null && Array.isArray(run.lines) && run.lines.length === 2
			&& run.lines.every((n) => Number.isInteger(n) && (n as number) >= 1) && (run.writer === 'claude' || run.writer === 'user')
			&& typeof run.step === 'string' && (run.change === undefined || typeof run.change === 'string');
	};
	const isFile = (f: unknown) => {
		const file = f as Record<string, unknown>;
		return typeof f === 'object' && f !== null && typeof file.hashes === 'string' && file.hashes.length % HASH_SIZE === 0
			&& Array.isArray(file.runs) && file.runs.every(isRun);
	};
	if (v.version !== FILE_VERSION || typeof v.files !== 'object' || v.files === null || !Object.values(v.files).every(isFile)) {
		throw new Error(`${name} needs the fields version and files, and each file needs its hashes and runs.`);
	}
	return value as LinesFile;
}

//-------------------
// The lines of the active task in memory

// The time from the last change to the write of lines.json
const SAVE_DELAY_MS = 1000;

// The lines of each writer for the files of the active task. Each change goes into memory at once. lines.json gets the
// changes a short time after the last change, so a key in the text editor does not write the file
export class LineStore {
	private file: string | undefined;
	private files = new Map<string, FileLines>();
	private timer: NodeJS.Timeout | undefined;
	private problem: string | undefined;

	// file: lines.json of the active task. undefined: no active task
	load(file: string | undefined): void {
		this.flush();
		this.file = file;
		this.files = new Map();
		this.problem = undefined;
		const text = file ? readText(file) : undefined;
		if (!file || text === undefined) {
			return;
		}
		try {
			this.files = new Map(Object.entries(parseLines(text, path.basename(path.dirname(file))).files));
		} catch (error) {
			this.problem = error instanceof Error ? error.message : String(error);
		}
	}

	// The reason why lines.json of the active task is not correct
	get loadProblem(): string | undefined {
		return this.problem;
	}

	get paths(): string[] {
		return [...this.files.keys()];
	}

	has(file: string): boolean {
		return this.files.has(file);
	}

	runs(file: string): readonly LineRun[] {
		return this.files.get(file)?.runs ?? [];
	}

	// The lines of a file with lines of a writer, after a change of its text. writer: the writer of the new lines. A file
	// with no lines of a writer stays out, because Shotgun does not know its old text. The result: true if the lines of a
	// writer changed
	sync(file: string, text: readonly string[], writer?: LineOwner): boolean {
		const old = this.files.get(file);
		if (!old) {
			return false;
		}
		const next = moveLines(old, text, writer);
		if (old.hashes === next.hashes) {
			return false;
		}
		this.files.set(file, next);
		this.saveSoon();
		return JSON.stringify(old.runs) !== JSON.stringify(next.runs);
	}

	// Gives lines of a file a writer, after a sync with its text now
	setOwner(file: string, text: readonly string[], lines: readonly number[], owner: LineOwner): void {
		const now = moveLines(this.files.get(file), text);
		this.files.set(file, setOwner(now, lines, owner));
		this.saveSoon();
	}

	// The lines of a writer in a step of a file, after a sync with its text now. The old lines of the writer in the step
	// lose the writer first, for example the lines of an earlier receipt of the step
	replaceStep(file: string, text: readonly string[], writer: LineWriter, step: string, parts: readonly { lines: readonly number[]; change?: string }[]): void {
		const now = moveLines(this.files.get(file), text);
		let next: FileLines = { hashes: now.hashes, runs: now.runs.filter((r) => r.writer !== writer || r.step !== step) };
		for (const part of parts) {
			next = setOwner(next, part.lines, { writer, step, ...(part.change ? { change: part.change } : {}) });
		}
		if (next.runs.length === 0 && !this.files.has(file)) {
			return;
		}
		this.files.set(file, next);
		this.saveSoon();
	}

	// Gives the lines with no writer the writer of a step, after a sync with the text now. A line of a different writer
	// keeps its writer, for example a line of the frame of Claude in a step of the user
	fillStep(file: string, text: readonly string[], writer: LineWriter, step: string, lines: readonly number[]): void {
		const old = this.files.get(file);
		const now = moveLines(old, text);
		const owners = ownersOf(now.runs, now.hashes.length / HASH_SIZE);
		for (const line of lines) {
			if (line >= 1 && line <= owners.length && !owners[line - 1]) {
				owners[line - 1] = { writer, step };
			}
		}
		const next: FileLines = { hashes: now.hashes, runs: runsOf(owners) };
		if (next.runs.length === 0 && !old) {
			return;
		}
		this.files.set(file, next);
		this.saveSoon();
	}

	// Writes lines.json now
	flush(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		if (!this.file || this.problem) {
			return;
		}
		const files = Object.fromEntries([...this.files].filter(([, f]) => f.runs.length > 0).sort(([a], [b]) => a.localeCompare(b)));
		if (Object.keys(files).length === 0) {
			rmSync(this.file, { force: true });
			return;
		}
		mkdirSync(path.dirname(this.file), { recursive: true });
		writeTextAtomic(this.file, jsonText({ version: FILE_VERSION, files } satisfies LinesFile));
	}

	dispose(): void {
		this.flush();
	}

	private saveSoon(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
	}
}
