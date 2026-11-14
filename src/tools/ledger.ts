import type { CommitMessage } from '../git/message';
import { currentStep, stateOf } from '../session/build';
import { ledgerRows, MAX_CHECK_NOTE, MAX_POINT, MAX_POINTS, MessagePoint, POINT_KINDS, PointKind, sameMessage } from '../session/ledger';
import type { LineStore } from '../session/lines';
import { levelOf } from '../session/plan';
import type { SessionStore } from '../session/store';
import { decisionText } from '../views/model';

// The tools of the ledger (phase 9). get_commit_message gives the commit message of the user from Source Control, with the
// summary of the ledger. submit_message_check keeps the points of the check of Claude. Claude changes no message and
// makes no commit: the user commits in Source Control.

export const SUBMIT_MESSAGE_CHECK_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_submit_message_check';
const GET_COMMIT_MESSAGE_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_get_commit_message';

export interface LedgerDeps {
	readonly store: SessionStore;
	readonly lines: LineStore;
	readonly message?: () => CommitMessage | undefined; // undefined: no repository of git, or the Git extension is off
}

// The maximum number of the decisions of the user in the result of get_commit_message
const MAX_DECISIONS = 40;

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The active task in stage 5 or after its end, and the commit message of the user, else an error for Claude
function requireMessage(deps: LedgerDeps): { message: CommitMessage } {
	const task = deps.store.snapshot.task;
	if (!task || task.stage !== 'build') {
		throw new Error('The check of the commit message is only for a task in stage 5, the build, or after its end. Tell the user.');
	}
	const message = deps.message?.();
	if (!message) {
		throw new Error('Shotgun found no repository of git for the project in Source Control. Tell the user.');
	}
	if (!message.message.trim()) {
		throw new Error('The input box of Source Control has no commit message. Tell the user to write the message there first, and then to ask you again.');
	}
	return { message };
}

export function commitMessageData(deps: LedgerDeps): Record<string, unknown> {
	const { message } = requireMessage(deps);
	const { task, plan, risk, levels, build, decisions, loose } = deps.store.snapshot;
	const current = currentStep(plan, risk, levels, build);
	const rows = ledgerRows(deps.lines.paths.map((file) => ({ file, runs: deps.lines.runs(file) })), build);
	const ends = loose?.ends ?? [];
	return {
		message: message.message,
		repository: message.repository,
		changedFiles: message.files,
		task: task!.title,
		steps: (plan?.steps ?? []).map((s) => ({
			id: s.id, title: s.title, level: levelOf(s.id, risk, levels).level, state: stateOf(build, s.id), ...(s.looseEnd ? { looseEnd: s.looseEnd } : {}),
		})),
		...(current ? { openSteps: `Step ${current.n} and later are not done. The message can tell only the work that is done.` } : {}),
		decisionsOfTheUser: decisions.filter((d) => d.by === 'user').slice(-MAX_DECISIONS).map(decisionText),
		lines: rows.map((r) => ({ file: r.file, user: r.user, claudeWalked: r.walked, claudeNotWalked: r.notWalked })),
		looseEnds: {
			open: ends.filter((e) => e.state === 'open').map((e) => `${e.id}: ${e.title}`),
			handed: ends.filter((e) => e.state === 'handed').length,
			closed: ends.filter((e) => e.state === 'closed').length,
		},
		next: 'Read the diff of the changes that the commit takes, for example with "git diff HEAD", and compare it with the message. Change no '
			+ `message, and make no commit. Then call ${SUBMIT_MESSAGE_CHECK_TOOL} with the message as you read it, agrees, and 1 to ${MAX_POINTS} points.`,
	};
}

export function submitMessageCheck(deps: LedgerDeps, args: Record<string, unknown>): Record<string, unknown> {
	const { message } = requireMessage(deps);
	const problems: string[] = [];
	if (!sameMessage(textOf(args.message), message.message)) {
		throw new Error(`The commit message in Source Control is not the message that you checked. Call ${GET_COMMIT_MESSAGE_TOOL} again, and check the message now.`);
	}
	if (typeof args.agrees !== 'boolean') {
		problems.push('Give "agrees": true if the message agrees with the diff, else false.');
	}
	const raw = Array.isArray(args.points) ? args.points : [];
	if (raw.length < 1 || raw.length > MAX_POINTS) {
		problems.push(`Give 1 to ${MAX_POINTS} points in "points".`);
	}
	const points: MessagePoint[] = [];
	raw.slice(0, MAX_POINTS).forEach((p, i) => {
		const label = `Point ${i + 1}`;
		const value = typeof p === 'object' && p !== null ? p as Record<string, unknown> : {};
		const kind = value.kind as PointKind;
		const text = textOf(value.text).trim().replace(/\s+/g, ' ');
		if (!(POINT_KINDS as readonly unknown[]).includes(kind)) {
			problems.push(`${label}: give "kind": ${POINT_KINDS.join(', ')}.`);
		}
		if (!text || text.length > MAX_POINT) {
			problems.push(`${label}: give "text" of 1 to ${MAX_POINT} characters.`);
		}
		const file = textOf(value.file).trim().replace(/\\/g, '/');
		const line = value.line;
		if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) {
			problems.push(`${label}: "line" must be a line number from 1.`);
		}
		if (line !== undefined && !file) {
			problems.push(`${label}: give the "file" of the line.`);
		}
		points.push({ kind, text, ...(file ? { file } : {}), ...(file && Number.isInteger(line) ? { line: line as number } : {}) });
	});
	if (args.agrees === true && points.some((p) => p.kind === 'missing' || p.kind === 'wrong')) {
		problems.push('"agrees" must be false when a point has the kind missing or wrong.');
	}
	const note = textOf(args.note).trim();
	if (note.length > MAX_CHECK_NOTE) {
		problems.push(`"note" has a maximum of ${MAX_CHECK_NOTE} characters.`);
	}
	if (problems.length > 0) {
		throw new Error(`Shotgun did not take the check. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
	}
	const check = deps.store.writeMessageCheck({ message: message.message, agrees: args.agrees as boolean, points, ...(note ? { note } : {}) });
	return {
		agrees: check.agrees,
		points: check.points.length,
		next: 'The panel of Shotgun shows your points with the badge Model. Tell the user the points in short. The user changes the message and commits in '
			+ 'Source Control.',
	};
}
