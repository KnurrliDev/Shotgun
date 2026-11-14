import {
	BriefPart, briefFromChat, foreignLines, isEmptyBrief, isPartId, normalizeWords, parseBrief, partName, partSummary, questionLine, wordLines,
} from '../session/brief';
import { readText as readDisk } from '../session/files';
import { STAGE_INFO, stageText } from '../session/stages';
import type { QuestionInput, SessionStore } from '../session/store';
import type { PromptLog } from './prompts';

// The submit tools of stage 1: submit_brief gives a brief from the chat, and submit_questions gives the questions of
// Claude about the brief. Each tool checks all data, and gives all problems in 1 list (proposal P7). A tool with a
// problem changes no file.

export interface BriefDeps {
	readonly store: SessionStore;
	readonly prompts: PromptLog;
	readonly readText: (file: string) => string | undefined; // the text of a file, from an open text editor first
	readonly openFile: (file: string) => void; // shows a file in the text editor
}

const MAX_TITLE = 200;
const MAX_QUESTIONS = 10;
const MAX_QUESTION = 500;
const MAX_QUOTE = 300;
// The maximum number of the lines that a refusal quotes
const MAX_QUOTED = 10;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The error of a tool with all its problems. DataFlow gives the message to Claude as the result of the tool
function refuse(what: string, problems: readonly string[]): never {
	throw new Error(`Shotgun did not take ${what}. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
}

const partData = (parts: readonly BriefPart[]) => parts.map((p) => ({ name: p.name, hasText: p.hasText, summary: partSummary(p) }));

export function submitBrief(deps: BriefDeps, args: Record<string, unknown>): Record<string, unknown> {
	const title = textOf(args.title).trim().replace(/\s+/g, ' ');
	const text = textOf(args.text).replace(/\r\n/g, '\n').trim();
	const isNewTask = args.isNewTask === true;
	const problems: string[] = [];
	if (!title) {
		problems.push('Give a short title of the task in "title".');
	} else if (title.length > MAX_TITLE) {
		problems.push(`The title has more than ${MAX_TITLE} characters.`);
	}
	const lines = wordLines(text);
	if (lines.length === 0) {
		problems.push('Give the brief in the words of the user in "text".');
	} else if (deps.prompts.prompts.length === 0) {
		problems.push('Shotgun has no prompt of the user in this VS Code window. Ask the user to give the brief again in a prompt.');
	} else {
		const foreign = foreignLines(text, deps.prompts.prompts);
		if (foreign.length > 0) {
			const quoted = foreign.slice(0, MAX_QUOTED).map((l) => `"${l}"`).join(', ');
			const more = foreign.length > MAX_QUOTED ? `, and ${foreign.length - MAX_QUOTED} more` : '';
			problems.push(`${foreign.length === 1 ? '1 line is' : `${foreign.length} lines are`} not in the words of the user: ${quoted}${more}. `
				+ 'Copy the words of the user exactly. Add only the headings of the 5 parts and the list mark "- ". If a part is not in the words of '
				+ 'the user, leave it out: Shotgun adds its heading, and the part stays empty. Each part is optional.');
		}
	}
	// the task of the brief: a new task, or the active task in stage 1 if its brief has no text
	const store = deps.store;
	const active = store.snapshot.task;
	const activeBrief = active ? store.briefFile(active.id) : undefined;
	const isNew = isNewTask || !active || active.isDone || active.stage !== 'brief';
	// the text of an open text editor counts, also with no save, so the brief of the user does not get lost
	if (!isNew && activeBrief && !isEmptyBrief(deps.readText(activeBrief) ?? '')) {
		problems.push(`The brief of the active task "${active!.title}" has text. Shotgun does not change the text of a brief. `
			+ 'Ask the user if this brief is for a new task. If yes, call submit_brief again with "isNewTask": true.');
	}
	if (problems.length > 0) {
		refuse('the brief', problems);
	}
	let task = active;
	if (isNew) {
		task = store.newTask(title, 'claude', { text: briefFromChat(title, text), lines: lines.length });
	} else {
		store.writeBrief(briefFromChat(active!.title, text), lines.length);
	}
	const file = store.briefFile(task!.id)!;
	deps.openFile(file);
	// the file on the disk: a text editor gets the new text a moment later
	const brief = parseBrief(readDisk(file) ?? '');
	const missing = brief.parts.filter((p) => !p.hasText).map((p) => p.name);
	return {
		task: { id: task!.id, title: task!.title },
		isNewTask: isNew,
		...(isNew && active && active.id !== task!.id ? { previousTask: { id: active.id, title: active.title, stage: STAGE_INFO[active.stage].number } } : {}),
		file,
		parts: partData(brief.parts),
		isComplete: brief.isComplete,
		next: 'Tell the user that brief.md is open. The user checks it, and then selects "The brief is ready" in the panel of Shotgun.'
			+ (missing.length > 0 ? ` These parts have no text: ${missing.join(', ')}. Each part is optional, so do not ask the user to write them, `
				+ 'and do not write them yourself.' : ''),
	};
}

export function submitQuestions(deps: BriefDeps, args: Record<string, unknown>): Record<string, unknown> {
	const problems: string[] = [];
	const task = deps.store.snapshot.task;
	if (!task) {
		problems.push('No task is active. Questions about a brief need the active task in stage 1.');
	} else if (task.isDone || task.stage !== 'brief') {
		problems.push(`The active task is in ${stageText(task.stage)}. Questions about the brief are only for stage 1.`);
	}
	const file = task ? deps.store.briefFile(task.id) : undefined;
	const brief = file ? deps.readText(file) ?? '' : '';
	const briefWords = normalizeWords(brief);
	const list = Array.isArray(args.questions) ? args.questions : [];
	if (list.length === 0) {
		problems.push('Give 1 question or more in "questions".');
	} else if (list.length > MAX_QUESTIONS) {
		problems.push(`Give a maximum of ${MAX_QUESTIONS} questions.`);
	}
	const inputs: QuestionInput[] = [];
	list.slice(0, MAX_QUESTIONS).forEach((raw, i) => {
		const n = i + 1;
		if (!isObject(raw)) {
			problems.push(`Question ${n} is not an object.`);
			return;
		}
		const text = textOf(raw.text).trim();
		if (!text) {
			problems.push(`Question ${n}: give the "text".`);
		} else if (text.length > MAX_QUESTION) {
			problems.push(`Question ${n}: the text has more than ${MAX_QUESTION} characters.`);
		}
		if (raw.part !== undefined && !isPartId(raw.part)) {
			problems.push(`Question ${n}: "part" must be goal, facts, specs, scope or done.`);
		}
		const quote = textOf(raw.quote).trim();
		if (quote.length > MAX_QUOTE) {
			problems.push(`Question ${n}: the quote has more than ${MAX_QUOTE} characters.`);
		} else if (quote && !briefWords.includes(normalizeWords(quote))) {
			problems.push(`Question ${n}: the quote is not in brief.md. Copy a short text of the brief exactly, or give no quote.`);
		}
		inputs.push({ text, ...(isPartId(raw.part) ? { part: raw.part } : {}), ...(quote ? { quote } : {}) });
	});
	if (problems.length > 0) {
		refuse('the questions', problems);
	}
	const parsed = parseBrief(brief);
	const saved = deps.store.setQuestions(inputs);
	return {
		questions: saved.map((q) => ({
			id: q.id,
			text: q.text,
			...(q.part ? { part: partName(q.part) } : {}),
			line: questionLine(brief, parsed.parts, q),
		})),
		next: 'The panel of Shotgun shows the questions. Tell the user. Do not answer the questions, and do not write in the brief.',
	};
}
