import type { BuildFile } from './build';
import { FILE_VERSION } from './files';
import type { LineRun } from './lines';

// Stage 5: the ledger of a task (phase 9). The ledger page shows the decisions of the user and of Claude, the lines of
// each writer in each file, and the lines of Claude that the user did not walk. The user writes the commit message in the
// input box of Source Control (P11). On a request of the user, Claude checks the message against the diff, and Shotgun
// keeps the points of the check in message.json. Shotgun makes no commit. These functions use no VS Code API.

export const MESSAGE_FILE = 'message.json';

// ok: the message agrees with the diff. missing: the diff has a change that the message does not tell. wrong: the
// message tells a change that the diff does not have. question: Claude is not sure, and the user decides
export const POINT_KINDS = ['ok', 'missing', 'wrong', 'question'] as const;
export type PointKind = (typeof POINT_KINDS)[number];

export const MAX_POINTS = 12;
export const MAX_POINT = 300;
export const MAX_CHECK_NOTE = 600;

export interface MessagePoint {
	readonly kind: PointKind;
	readonly text: string;
	readonly file?: string; // relative to the first folder of the project, with /
	readonly line?: number;
}

// The check of Claude for 1 text of the commit message
export interface MessageCheck {
	readonly version: 1;
	readonly message: string; // the text that Claude checked
	readonly agrees: boolean; // Claude found no point of the kind missing or wrong
	readonly points: readonly MessagePoint[];
	readonly note?: string; // a note of Claude
	readonly time: string;
}

// The lines of each writer in a file. walked: lines of Claude with a mark of the user on their change, also the frame
// lines and the answers of the hints, because the user read them in the holes (decision 18)
export interface LedgerRow {
	readonly file: string;
	readonly user: number;
	readonly walked: number;
	readonly notWalked: number;
	readonly firstNotWalked?: number; // the first line of Claude that the user did not walk
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// True for the same commit message, with the line ends of each system and with no spaces at the start and at the end
export const sameMessage = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();

// True if the user walked the lines of Claude of this run: the change has a mark in the receipt of its step
export function isWalked(run: LineRun, build: BuildFile | undefined): boolean {
	if (run.writer !== 'claude') {
		return false;
	}
	if (run.change === 'frame' || /^H\d+$/.test(run.change ?? '')) {
		return true;
	}
	const change = build?.steps[run.step]?.receipt?.changes.find((c) => c.id === run.change);
	return !!change && change.mark !== 'todo';
}

// The rows of the ledger: the files with lines of a writer, the files with lines of Claude that are not walked first
export function ledgerRows(files: readonly { readonly file: string; readonly runs: readonly LineRun[] }[], build: BuildFile | undefined): LedgerRow[] {
	const rows = files.map(({ file, runs }) => {
		const size = (r: LineRun) => r.lines[1] - r.lines[0] + 1;
		const notWalkedRuns = runs.filter((r) => r.writer === 'claude' && !isWalked(r, build));
		return {
			file,
			user: runs.filter((r) => r.writer === 'user').reduce((n, r) => n + size(r), 0),
			walked: runs.filter((r) => r.writer === 'claude' && isWalked(r, build)).reduce((n, r) => n + size(r), 0),
			notWalked: notWalkedRuns.reduce((n, r) => n + size(r), 0),
			...(notWalkedRuns.length > 0 ? { firstNotWalked: Math.min(...notWalkedRuns.map((r) => r.lines[0])) } : {}),
		};
	}).filter((r) => r.user + r.walked + r.notWalked > 0);
	return rows.sort((a, b) => b.notWalked - a.notWalked || a.file.localeCompare(b.file));
}

// The text for a pull request: the decisions of the user, and the lines of each writer
export function ledgerMarkdown(title: string, decisions: readonly string[], rows: readonly LedgerRow[]): string {
	const sum = (key: 'user' | 'walked' | 'notWalked') => rows.reduce((n, r) => n + r[key], 0);
	const linesText = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;
	const lines = [
		`## ${title}`,
		'',
		'### Decisions of the user',
		'',
		...(decisions.length > 0 ? decisions.map((d) => `- ${d}`) : ['- No decision.']),
		'',
		'### Lines of each writer',
		'',
		`The user wrote ${linesText(sum('user'))}. Claude wrote ${linesText(sum('walked') + sum('notWalked'))}, and the user walked ${sum('walked')} of them.`,
		'',
		'| File | User | Claude, walked | Claude, not walked |',
		'| --- | --- | --- | --- |',
		...rows.map((r) => `| \`${r.file}\` | ${r.user} | ${r.walked} | ${r.notWalked} |`),
		'',
		'Shotgun recorded these decisions and lines while the user and Claude Code worked on the task.',
	];
	return lines.join('\n');
}

export function parseMessageCheck(text: string, id: string): MessageCheck {
	const value: unknown = JSON.parse(text);
	const name = `${id}/${MESSAGE_FILE}`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > FILE_VERSION) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version ${FILE_VERSION}. Install a newer version of Shotgun.`);
	}
	const isPoint = (p: unknown) => isObject(p) && (POINT_KINDS as readonly unknown[]).includes(p.kind) && typeof p.text === 'string';
	if (value.version !== FILE_VERSION || typeof value.message !== 'string' || typeof value.agrees !== 'boolean' || !Array.isArray(value.points)
		|| !value.points.every(isPoint) || typeof value.time !== 'string') {
		throw new Error(`${name} needs the fields version, message, agrees, points and time.`);
	}
	return value as unknown as MessageCheck;
}
