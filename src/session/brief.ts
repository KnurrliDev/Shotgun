// The brief of a task: the file brief.md with 5 parts. The user writes it in the text editor, or Claude gives the words
// of the user from the chat (decision 12). These functions use no VS Code API, so the unit tests can call them directly.

export const BRIEF_FILE = 'brief.md';

// The note at the top of a new brief. Each part of the brief is optional (decision 22)
export const BRIEF_NOTE = 'All parts are optional. Claude works with the text that you write here, and it can ask you about the rest.';

export const PARTS = [
	{ id: 'goal', name: 'Goal', hint: 'Optional. The purpose of the change.' },
	{ id: 'facts', name: 'Facts', hint: 'Optional. What is true in the code or in the product now, for example a limit, a thread or a known fault.' },
	{ id: 'specs', name: 'Specs', hint: 'Optional. What the new code must do.' },
	{ id: 'scope', name: 'Not in scope', hint: 'Optional. The work that is not a part of this task.' },
	{ id: 'done', name: 'Done when', hint: 'Optional. The tests or the checks that show that the task is done.' },
] as const;

export type PartId = (typeof PARTS)[number]['id'];
export const PART_IDS: readonly PartId[] = PARTS.map((p) => p.id);
export const isPartId = (value: unknown): value is PartId => typeof value === 'string' && (PART_IDS as readonly string[]).includes(value);
export const partName = (id: PartId): string => PARTS.find((p) => p.id === id)!.name;

export interface BriefPart {
	readonly id: PartId;
	readonly name: string;
	readonly line: number | undefined; // the line of the heading, from 1. undefined: the brief has no heading for the part
	readonly hasText: boolean;
	readonly items: number; // the lines with a list mark
	readonly sentences: number; // the sentences in the other lines
	readonly lines: readonly string[]; // the lines of the text of the part, with no comment and no empty line
}

export interface Brief {
	readonly title: string | undefined; // the text of the heading "# Brief: ..."
	readonly parts: readonly BriefPart[];
	readonly isComplete: boolean; // each part has text. Only a fact: each part is optional (decision 22)
}

// A heading of Markdown, and a line with a list mark
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+/;

// The part of the text of a heading, for example "Not in scope:" is the part scope
export function partOfHeading(text: string): PartId | undefined {
	const key = text.trim().replace(/:$/, '').trim().toLowerCase();
	return PARTS.find((p) => p.name.toLowerCase() === key)?.id;
}

// The text with no HTML comments. Each line of a comment stays as an empty line, so the numbers of the lines stay
export function withoutComments(text: string): string {
	return text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, ''));
}

// The title, the note, and each part with its hint. The note and the hints are comments, so they are no text of the user
export function briefTemplate(title: string): string {
	return [`# Brief: ${title}`, '', `<!-- ${BRIEF_NOTE} -->`, '', ...PARTS.flatMap((p) => [`## ${p.name}`, '', `<!-- ${p.hint} -->`, ''])].join('\n');
}

export function parseBrief(text: string): Brief {
	let title: string | undefined;
	const found = new Map<PartId, { line: number; body: string[] }>();
	let current: { line: number; body: string[] } | undefined;
	let level = 0;
	withoutComments(text).split(/\r?\n/).forEach((raw, i) => {
		const heading = HEADING.exec(raw);
		if (heading) {
			const headingLevel = heading[1].length;
			if (headingLevel === 1 && title === undefined) {
				title = heading[2].replace(/^Brief:\s*/i, '').trim();
				current = undefined;
				return;
			}
			const part = headingLevel >= 2 ? partOfHeading(heading[2]) : undefined;
			if (part && !found.has(part)) {
				current = { line: i + 1, body: [] };
				level = headingLevel;
				found.set(part, current);
				return;
			}
			// a heading of the same level or higher ends the part. A lower heading is a part of its text
			if (current && (part || headingLevel <= level)) {
				current = undefined;
				return;
			}
		}
		current?.body.push(raw);
	});
	const parts = PARTS.map((p) => {
		const part = found.get(p.id);
		const body = (part?.body ?? []).map((l) => l.trim()).filter(Boolean);
		const items = body.filter((l) => LIST_MARK.test(l)).length;
		const prose = body.filter((l) => !LIST_MARK.test(l)).join(' ');
		const sentences = prose ? Math.max(1, (prose.match(/[.!?](\s|$)/g) ?? []).length) : 0;
		return { id: p.id, name: p.name, line: part?.line, hasText: body.length > 0, items, sentences, lines: body };
	});
	return { title, parts, isComplete: parts.every((p) => p.hasText) };
}

// The text of the state of a part for the panel, for example "4 items" or "no text"
export function partSummary(part: BriefPart): string {
	if (part.line === undefined) {
		return 'no heading';
	}
	if (!part.hasText) {
		return 'no text';
	}
	const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	if (part.items > 0 && part.sentences > 0) {
		return `${count(part.items, 'item')}, ${count(part.sentences, 'sentence')}`;
	}
	return part.items > 0 ? count(part.items, 'item') : count(part.sentences, 'sentence');
}

// True if the brief has no text of the user: only headings, comments and empty lines
export function isEmptyBrief(text: string): boolean {
	return withoutComments(text).split(/\r?\n/).every((l) => !l.trim() || HEADING.test(l));
}

//-------------------
// The words of the user (decision 12)

// The lines of a brief from the chat that must be in the words of the user: each line with text, with no list mark at
// its start. Only the headings of the 5 parts do not count. A comment counts, so Claude cannot hide its own words in it
export function wordLines(text: string): string[] {
	const lines: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const heading = HEADING.exec(raw);
		if (heading && heading[1].length >= 2 && partOfHeading(heading[2])) {
			continue;
		}
		const line = raw.replace(LIST_MARK, '').trim();
		if (line) {
			lines.push(line);
		}
	}
	return lines;
}

export const normalizeWords = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The lines of a brief that are not in a prompt of the user
export function foreignLines(text: string, prompts: readonly string[]): string[] {
	const words = prompts.map(normalizeWords);
	return wordLines(text).filter((line) => !words.some((prompt) => prompt.includes(normalizeWords(line))));
}

// The text of brief.md for a brief from the chat: the title, the text of the user, and the headings of the parts that
// the text does not have, with their hints. With such parts, the note comes after the title. Shotgun fills no part
export function briefFromChat(title: string, text: string): string {
	const brief = parseBrief(text);
	const missing = PARTS.filter((p) => brief.parts.find((x) => x.id === p.id)?.line === undefined);
	return [
		`# Brief: ${title}`, '', ...(missing.length > 0 ? [`<!-- ${BRIEF_NOTE} -->`, ''] : []), text.replace(/\r\n/g, '\n').trim(), '',
		...missing.flatMap((p) => [`## ${p.name}`, '', `<!-- ${p.hint} -->`, '']),
	].join('\n');
}

// The line of a question in the brief: the line of its quote, else the heading of its part
export function questionLine(brief: string, parts: readonly BriefPart[], question: { part?: string; quote?: string }): number | undefined {
	return (question.quote ? lineOfText(brief, question.quote) : undefined) ?? parts.find((p) => p.id === question.part)?.line;
}

// The line of a text of the brief, from 1, for example the quote of a question. undefined: the brief does not have it
export function lineOfText(brief: string, quote: string): number | undefined {
	const target = normalizeWords(quote);
	if (!target) {
		return undefined;
	}
	const index = brief.indexOf(quote);
	if (index >= 0) {
		return brief.slice(0, index).split('\n').length;
	}
	const lines = brief.split(/\r?\n/);
	const line = lines.findIndex((l) => normalizeWords(l).includes(target));
	return line >= 0 ? line + 1 : undefined;
}
