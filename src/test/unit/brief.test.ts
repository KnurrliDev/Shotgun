import * as assert from 'assert';
import {
	briefFromChat, briefTemplate, foreignLines, isEmptyBrief, lineOfText, parseBrief, PartId, partSummary, questionLine, wordLines,
} from '../../session/brief';
import { PromptLog } from '../../tools/prompts';

// The brief: the template, the parts, the words of the user (decision 12) and the lines of the questions
suite('Brief', () => {
	test('The template has the title and the 5 parts with their hints, and no part has text', () => {
		const text = briefTemplate('Cycle limit');
		assert.ok(text.startsWith('# Brief: Cycle limit\n\n## Goal\n\n<!-- What must the change do?'), text);
		const brief = parseBrief(text);
		assert.strictEqual(brief.title, 'Cycle limit');
		assert.deepStrictEqual(brief.parts.map((p) => [p.name, p.hasText, p.line]),
			[['Goal', false, 3], ['Facts', false, 7], ['Specs', false, 11], ['Not in scope', false, 15], ['Done when', false, 19]]);
		assert.strictEqual(brief.isComplete, false);
		assert.ok(isEmptyBrief(text));
	});

	test('The parts: text, items and sentences, with comments and headings in the text', () => {
		const text = [
			'# Brief: Fix',
			'## goal:',
			'The controller must stop. It must not wait.',
			'<!-- a comment is no text -->',
			'## Facts',
			'- One.',
			'* Two.',
			'1. Three.',
			'### Details',
			'More text.',
			'## Other',
			'Not in a part.',
			'## Specs',
			'<!-- only a comment',
			'over 2 lines -->',
			'## Not in scope',
			'## Done when',
			'A test passes',
		].join('\n');
		const brief = parseBrief(text);
		const of = (id: PartId) => brief.parts.find((p) => p.id === id)!;
		assert.deepStrictEqual([of('goal').line, of('goal').sentences, of('goal').items], [2, 2, 0]);
		// a lower heading is a part of the text, and a heading of the same level ends the part
		assert.strictEqual(partSummary(of('facts')), '3 items, 1 sentence');
		assert.strictEqual(partSummary(of('specs')), 'no text');
		assert.strictEqual(partSummary(of('scope')), 'no text');
		assert.strictEqual(partSummary(of('done')), '1 sentence');
		assert.strictEqual(brief.isComplete, false);
		assert.ok(!isEmptyBrief(text));
		assert.strictEqual(partSummary(parseBrief('# Brief: x').parts[0]), 'no heading');
	});

	test('The words of the user: only the headings of the parts and the list marks do not count', () => {
		const text = ['## Goal', 'The controller must stop.', '- process() runs one time.', '## Goal of the change', '# Brief: x',
			'<!-- hidden -->', '   ', '## Not in scope:'].join('\n');
		assert.deepStrictEqual(wordLines(text),
			['The controller must stop.', 'process() runs one time.', '## Goal of the change', '# Brief: x', '<!-- hidden -->']);
		// the whitespace of the user does not count
		const prompts = ['Goal: The controller   must stop.\nFacts:\n- process() runs one time.'];
		assert.deepStrictEqual(foreignLines(text, prompts), ['## Goal of the change', '# Brief: x', '<!-- hidden -->']);
		assert.deepStrictEqual(foreignLines('The controller must stop.', []), ['The controller must stop.']);
		// a line of the brief must be in 1 prompt
		assert.deepStrictEqual(foreignLines('Stop now. Go on.', ['Stop now.', 'Go on.']), ['Stop now. Go on.']);
	});

	test('A brief from the chat: the text of the user, and the headings of the missing parts', () => {
		const text = briefFromChat('Fix', '## Goal\r\nStop the wait.\r\n## Done when\r\n- A test passes.');
		assert.ok(text.startsWith('# Brief: Fix\n\n## Goal\nStop the wait.\n## Done when\n- A test passes.\n\n## Facts\n\n<!-- '), text);
		const brief = parseBrief(text);
		assert.deepStrictEqual(brief.parts.map((p) => [p.id, p.hasText, p.line !== undefined]),
			[['goal', true, true], ['facts', false, true], ['specs', false, true], ['scope', false, true], ['done', true, true]]);
		// a text with no headings stays as it is, and the 5 parts come after it
		const prose = parseBrief(briefFromChat('Fix', 'Stop the wait.'));
		assert.ok(prose.parts.every((p) => !p.hasText && p.line !== undefined));
	});

	test('The line of a quote, and the line of a question', () => {
		const brief = '# Brief: Fix\n\n## Goal\nThe   controller must stop.\n\n## Facts\n- The solver runs.\n';
		assert.strictEqual(lineOfText(brief, 'The solver runs.'), 7);
		assert.strictEqual(lineOfText(brief, 'The controller must stop.'), 4);
		assert.strictEqual(lineOfText(brief, 'not there'), undefined);
		const parts = parseBrief(brief).parts;
		assert.strictEqual(questionLine(brief, parts, { part: 'facts' }), 6);
		assert.strictEqual(questionLine(brief, parts, { part: 'facts', quote: 'The solver runs.' }), 7);
		assert.strictEqual(questionLine(brief, parts, { part: 'specs' }), undefined);
	});

	test('The prompt log keeps the last prompts in memory, and ignores a value that Claude Code did not fill', () => {
		const log = new PromptLog(3, 20);
		log.add('${prompt}');
		log.add('   ');
		assert.deepStrictEqual(log.prompts, []);
		['a', 'b', 'c', 'd'].forEach((p) => log.add(p));
		assert.deepStrictEqual(log.prompts, ['b', 'c', 'd']);
		log.add('x'.repeat(19));
		assert.deepStrictEqual(log.prompts, ['d', 'x'.repeat(19)]);
		// the newest prompt stays, also if it is longer than the maximum
		log.add('y'.repeat(50));
		assert.deepStrictEqual(log.prompts, ['y'.repeat(50)]);
	});
});
