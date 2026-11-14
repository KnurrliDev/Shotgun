import type { HiddenFacts, LogicFacts, PlaceFacts, ThreadFacts } from '../dataflow/dataflow-api';
import { normalizeWords } from '../session/brief';
import {
	Callout, calloutStatus, DEFAULT_VOICE, EngineFact, hiddenFacts, itemLines, logicFacts, threadFacts, Voice, VOICE_TEXT,
} from '../session/callouts';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile, isInside, projectPath } from '../session/paths';
import { stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import type { PromptLog } from './prompts';
import type { EngineApi, SurveyDeps } from './survey';

// The tools of the callouts (phase 8). get_callouts gives the callouts on the lines of the user in the current step.
// submit_explanation gives the words of Claude for a callout. submit_line_answer gives the answer of Claude to a question
// of the user about a line: Shotgun adds the facts of DataFlow at the line, so the facts of the engine and the words of
// Claude stay apart. Also the function that gets the facts of DataFlow for the callouts of a file.

const MAX_EXPLANATION = 600;
const MAX_ANSWER = 1500;
const MAX_QUESTION = 500;

export interface CalloutDeps extends SurveyDeps {
	readonly prompts: PromptLog; // the last prompts of the user, for the check of a question
	readonly voice?: () => Voice; // the voice of the callouts, from the settings of the user
	readonly log?: (message: string) => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The facts of DataFlow for the callouts of a file: the races of its threads, and the logic and the hidden C++ of the
// functions with the lines. A failure of DataFlow gives fewer facts, and no error: the next pause asks again
export async function fileFacts(engine: EngineApi | undefined, file: string, lines: readonly number[]): Promise<EngineFact[]> {
	if (!engine || !isCppFile(file)) {
		return [];
	}
	const facts: EngineFact[] = [];
	if (engine.threads) {
		const threads = await engine.threads(file).catch(() => undefined);
		facts.push(...(threads ? threadFacts(threads) : []));
	}
	// 1 line in each function of the lines
	const ranges: [number, number][] = [];
	const starts: number[] = [];
	for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
		if (ranges.some(([a, b]) => line >= a && line <= b)) {
			continue;
		}
		const place: PlaceFacts | undefined = await engine.place(file, line).catch(() => undefined);
		if (place?.function) {
			ranges.push([place.function.lines[0], place.function.lines[1]]);
			starts.push(line);
		}
	}
	for (const line of starts) {
		const [logic, hidden] = await Promise.all([
			engine.logic?.(file, line).catch(() => undefined),
			engine.hidden?.(file, line).catch(() => undefined),
		]);
		facts.push(...(logic ? logicFacts(logic) : []), ...(hidden ? hiddenFacts(hidden) : []));
	}
	return facts;
}

// The facts of DataFlow at a line, for an answer of Claude: the function, the threads and the locks of the line, the races
// with an access at the line, and the hidden C++ and the warnings of the logic at the line
export function lineFacts(line: number, place?: PlaceFacts, threads?: ThreadFacts, hidden?: HiddenFacts, logic?: LogicFacts): string[] {
	const out: string[] = [];
	if (place?.function) {
		out.push(`In ${place.function.name}, lines ${place.function.lines[0]}-${place.function.lines[1]}.`);
	}
	if (place && place.threads.length > 0) {
		out.push(`The worker thread ${place.threads.map((t) => t.label).join(', ')} runs the line.`);
	}
	if (place && place.locks.length > 0) {
		out.push(`The line holds the lock ${place.locks.join(', ')}.`);
	}
	for (const item of threads?.items ?? []) {
		if (itemLines(item).includes(line)) {
			out.push(`${item.item} (${item.verdict}): the thread of the caller ${item.caller}, the worker thread ${item.worker}. ${item.protection}.`);
		}
	}
	for (const item of hidden?.items ?? []) {
		if (item.line === line) {
			out.push(`Hidden C++, ${item.kind}: ${item.text}.`);
		}
	}
	for (const w of logic?.warnings ?? []) {
		if (w.line === line) {
			out.push(`Logic: ${w.text}`);
		}
	}
	return out;
}

// The current step with callouts: a step of the user, or a frame with its holes
function currentOf(snapshot: Snapshot): { id: string; n: number } | undefined {
	const { task, plan, build } = snapshot;
	if (!task || task.isDone || task.stage !== 'build' || !plan) {
		return undefined;
	}
	const n = plan.steps.findIndex((s) => build?.steps[s.id]?.state !== 'done');
	const b = n >= 0 ? build?.steps[plan.steps[n].id] : undefined;
	return b && ((b.writer === 'user' && b.state === 'open') || (b.writer === 'frame' && b.state === 'holes')) ? { id: plan.steps[n].id, n: n + 1 } : undefined;
}

const calloutData = (c: Callout, voice: Voice) => ({
	id: c.id, place: `${c.file}:${c.line}`, kind: c.kind, title: c.title, facts: c.proof, status: calloutStatus(c, voice),
	...(c.closed ? { closedReason: c.closed.reason } : {}), ...(c.explanation ? { explanation: c.explanation.text } : {}),
});

// The result of get_callouts
export function calloutsData(snapshot: Snapshot, voice: Voice): Record<string, unknown> {
	const { task } = snapshot;
	if (!task || task.isDone || task.stage !== 'build') {
		throw new Error(`Callouts are only in stage 5, the build. The active task is ${task ? (task.isDone ? 'done' : `in ${stageText(task.stage)}`) : 'not there'}.`);
	}
	const current = currentOf(snapshot);
	const step = current ? snapshot.callouts?.steps[current.id] : undefined;
	const callouts = (step?.callouts ?? []).filter((c) => !c.isGone);
	return {
		step: current ? { n: current.n, id: current.id } : null,
		voice: VOICE_TEXT[voice],
		callouts: callouts.map((c) => calloutData(c, voice)),
		answers: (snapshot.callouts?.answers ?? []).filter((a) => !a.resolved).map((a) => ({ id: a.id, place: `${a.file}:${a.line}`, question: a.question })),
		next: !current ? 'The current step is not a step of the user, so it has no callouts.'
			: callouts.length === 0 ? 'No callout yet. Callouts come at a pause of the user, from the facts of DataFlow on the lines of the user.'
				: 'The callouts are facts of DataFlow on the lines of the user. Explain a callout with submit_explanation only when the user asks.',
	};
}

// Gives the words of Claude for a callout of the current step: a short explanation of the facts of the engine
export function submitExplanation(deps: CalloutDeps, args: Record<string, unknown>): Record<string, unknown> {
	const snapshot = deps.store.snapshot;
	const current = currentOf(snapshot);
	if (!current) {
		throw new Error('The current step has no callouts. Callouts are only for a step of the user or for the holes of a frame, in stage 5.');
	}
	const step = snapshot.callouts?.steps[current.id];
	const callouts = (step?.callouts ?? []).filter((c) => !c.isGone);
	const ref = typeof args.callout === 'string' ? args.callout.trim() : '';
	const line = Number.isInteger(args.line) ? (args.line as number) : 0;
	const found = callouts.find((c) => c.id.toLowerCase() === ref.toLowerCase()) ?? callouts.find((c) => line > 0 && c.line === line && c.shown);
	if (!found) {
		throw new Error(`Step ${current.n} has no callout ${ref || `on line ${line}`}. Call shotgun_get_callouts for the callouts with their ids.`);
	}
	const text = typeof args.text === 'string' ? args.text.trim().replace(/\s+/g, ' ') : '';
	if (!text || text.length > MAX_EXPLANATION) {
		throw new Error(`Give "text": 1 to 3 sentences of 1 to ${MAX_EXPLANATION} characters.`);
	}
	deps.store.setExplanation(current.id, found.id, text);
	return {
		callout: { id: found.id, place: `${found.file}:${found.line}`, title: found.title },
		next: 'The panel and the hover of the callout show your words under the facts of DataFlow, with the badge Model. Tell the user. Change no code.',
	};
}

// Gives the answer of Claude to a question of the user about a line. The question must be in the words of the user
export async function submitLineAnswer(deps: CalloutDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const { task, root } = deps.store.snapshot;
	if (!task || !root || task.isDone || task.stage !== 'build') {
		throw new Error('An answer on a line is only for stage 5, the build. Answer the user in the chat.');
	}
	const name = typeof args.file === 'string' ? args.file.trim() : '';
	const full = name ? absolutePath(name, root) : '';
	const line = Number.isInteger(args.line) ? (args.line as number) : 0;
	const question = typeof args.question === 'string' ? args.question.trim().replace(/\s+/g, ' ') : '';
	const answer = typeof args.answer === 'string' ? args.answer.trim().replace(/\s+/g, ' ') : '';
	const problems: string[] = [];
	const lines = full ? deps.readText(full)?.split(/\r?\n/) : undefined;
	if (!name || !deps.folders().some((f) => isInside(full, f, IS_CASE_SENSITIVE))) {
		problems.push('Give "file": a file of the project.');
	} else if (!lines) {
		problems.push(`The file ${name} is not there.`);
	} else if (line < 1 || line > lines.length) {
		problems.push(`Give "line": a line of ${name}, from 1 to ${lines.length}.`);
	}
	if (!question || question.length > MAX_QUESTION) {
		problems.push(`Give "question": the question of the user, of 1 to ${MAX_QUESTION} characters.`);
	} else if (!deps.prompts.prompts.some((p) => normalizeWords(p).toLowerCase().includes(normalizeWords(question).toLowerCase()))) {
		problems.push('The question is not in the recent prompts of the user. Copy the question of the user exactly.');
	}
	if (!answer || answer.length > MAX_ANSWER) {
		problems.push(`Give "answer": 1 to 4 sentences of 1 to ${MAX_ANSWER} characters.`);
	}
	if (problems.length > 0) {
		throw new Error(`Shotgun did not take the answer. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
	}
	// the facts of DataFlow at the line, from Shotgun: they have the badge Engine
	const engine = deps.engine();
	let facts: string[] = [];
	if (engine && isCppFile(full)) {
		const fail = (error: unknown) => {
			deps.log?.(`DataFlow gave no facts for ${name}:${line}: ${messageOf(error)}`);
			return undefined;
		};
		const [place, threads, hidden, logic] = await Promise.all([
			engine.place(full, line).catch(fail), engine.threads?.(full).catch(fail), engine.hidden?.(full, line).catch(fail), engine.logic?.(full, line).catch(fail),
		]);
		facts = lineFacts(line, place, threads, hidden, logic);
	}
	const saved = deps.store.addLineAnswer({
		file: projectPath(full, root, IS_CASE_SENSITIVE), line, code: lines![line - 1].trim(), question, answer, facts,
	});
	return {
		answer: { id: saved.id, place: `${saved.file}:${saved.line}`, engineFacts: facts.length },
		next: 'The text editor and the panel of Shotgun show your answer at the line, under the facts of DataFlow. Tell the user. Change no code.',
	};
}

export const voiceOf = (deps: CalloutDeps): Voice => deps.voice?.() ?? DEFAULT_VOICE;
