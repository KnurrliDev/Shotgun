import * as assert from 'assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jsonText, parseActive, parseDecisions, parseQuestions, parseTask, TASK_ID, taskIdOf, writeTextAtomic } from '../../session/files';

// The formats of the stage files
suite('Stage files', () => {
	const none = new Set<string>();

	test('The id of a task comes from its title', () => {
		assert.strictEqual(taskIdOf('A cycle limit for the solver', none), 'a-cycle-limit-for-the-solver');
		assert.strictEqual(taskIdOf('  Crème brûlée!  ', none), 'creme-brulee');
		assert.strictEqual(taskIdOf('!!!', none), 'task');
		// Windows does not permit these names for a folder
		assert.strictEqual(taskIdOf('CON', none), 'con-task');
		assert.strictEqual(taskIdOf('Fix', new Set(['fix', 'fix-2'])), 'fix-3');
		// a maximum of 40 characters, with no - at the end
		assert.strictEqual(taskIdOf(`${'a'.repeat(39)} b`, none), 'a'.repeat(39));
		const long = taskIdOf(`${'a'.repeat(30)} ${'b'.repeat(30)}`, none);
		assert.ok(long.length === 40 && TASK_ID.test(long), long);
	});

	test('active.json: a correct file, and the errors of a wrong file', () => {
		assert.deepStrictEqual(parseActive('{ "version": 1, "task": "fix", "isPaused": true }'), { version: 1, task: 'fix', isPaused: true });
		assert.deepStrictEqual(parseActive('{ "version": 1, "task": null, "isPaused": false }'), { version: 1, task: null, isPaused: false });
		assert.throws(() => parseActive('{ "version": 2, "task": null, "isPaused": false }'), /version 2\. This version of Shotgun reads only version 1/);
		// a task id must be the name of a folder in .shotgun, not a path
		assert.throws(() => parseActive('{ "version": 1, "task": "../x", "isPaused": false }'), /not the id of a task/);
		assert.throws(() => parseActive('{ "version": 1, "task": null }'), /isPaused/);
		assert.throws(() => parseActive('[1]'), /not a JSON object/);
		assert.throws(() => parseActive('{ "version": 1, '), SyntaxError);
	});

	test('task.json: the text of a task goes back to the same task', () => {
		const task = {
			version: 1 as const, id: 'fix', title: 'Fix', created: '2026-11-14T10:00:00.000Z', stage: 'survey' as const, isDone: false,
			gates: [{ gate: 'brief-ready' as const, stage: 'brief' as const, time: '2026-11-14T11:00:00.000Z' }],
		};
		assert.deepStrictEqual(parseTask(jsonText(task), 'fix'), task);
		assert.throws(() => parseTask(jsonText(task), 'other'), /not the name of its folder/);
		assert.throws(() => parseTask(jsonText({ ...task, stage: 'done' }), 'fix'), /needs the fields/);
		assert.throws(() => parseTask(jsonText({ ...task, gates: [{ gate: 'x' }] }), 'fix'), /A gate of fix\/task\.json/);
	});

	test('decisions.jsonl: the correct lines, and the count of the wrong lines', () => {
		const text = [
			'{"version":1,"time":"t1","kind":"task","by":"user","title":"Fix"}',
			'',
			'{"version":1,"time":"t2","kind":"gate","by":"user","gate":"brief-ready","stage":"brief"}',
			'not JSON',
			'{"version":1,"time":"t3","kind":"deny","by":"guard","tool":"Edit","file":"a.cpp","reason":"no"}',
			'{"version":1,"time":"t4","kind":"pause","by":"claude"}',
			'{"version":1,"time":"t5","kind":"continue","by":"user"}',
			'{"version":1,"time":"t6","kind":"brief","by":"claude","lines":5}',
			'{"version":1,"time":"t7","kind":"questions","by":"claude","count":2}',
			'{"version":1,"time":"t8","kind":"question","by":"user","id":"q1","text":"Why?"}',
			'{"version":1,"time":"t9","kind":"brief","by":"user","lines":5}',
		].join('\r\n');
		const { decisions, invalid } = parseDecisions(text);
		assert.deepStrictEqual(decisions.map((d) => d.kind), ['task', 'gate', 'deny', 'continue', 'brief', 'questions', 'question']);
		assert.strictEqual(invalid, 3);
	});

	test('questions.json: the questions of Claude, and the errors of a wrong file', () => {
		const file = {
			version: 1,
			questions: [
				{ id: 'q1', text: 'Why?', part: 'goal', state: 'closed', created: 't1', closed: 't2' },
				{ id: 'q2', text: 'How?', quote: 'A goal.', state: 'open', created: 't1' },
			],
		};
		assert.deepStrictEqual(parseQuestions(jsonText(file), 'fix'), file);
		assert.throws(() => parseQuestions(jsonText({ ...file, questions: [{ id: 'q1', text: 'Why?', state: 'done', created: 't' }] }), 'fix'),
			/A question of fix\/questions\.json needs the fields/);
		assert.throws(() => parseQuestions(jsonText({ ...file, questions: [{ ...file.questions[0], part: 'other' }] }), 'fix'), /A question of/);
		assert.throws(() => parseQuestions(jsonText({ version: 1 }), 'fix'), /needs the field questions/);
	});

	test('writeTextAtomic makes the folders and leaves no temporary file', () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-files-'));
		try {
			const file = path.join(dir, 'a', 'b', 'c.json');
			writeTextAtomic(file, 'one');
			writeTextAtomic(file, 'two');
			assert.strictEqual(readFileSync(file, 'utf8'), 'two');
			assert.deepStrictEqual(readdirSync(path.dirname(file)), ['c.json']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		assert.ok(!existsSync(dir));
	});
});
