import * as assert from 'assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseActive, parseDecisions, parseTask } from '../../session/files';
import { SessionStore } from '../../session/store';

// The session store with the stage files in a temporary folder
suite('Session store', () => {
	let root: string;
	// a clock that adds 1 second for each call
	const clock = () => {
		let n = 0;
		return () => new Date(Date.UTC(2026, 10, 14, 10, 0, n++));
	};
	const file = (...parts: string[]) => readFileSync(path.join(root, '.shotgun', ...parts), 'utf8');

	setup(() => {
		root = mkdtempSync(path.join(os.tmpdir(), 'shotgun-store-'));
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('A new task is the active task in stage 1, with its files', () => {
		const store = new SessionStore(root, clock());
		let changes = 0;
		store.onDidChange(() => changes++);
		const task = store.newTask('  A cycle   limit ');
		assert.strictEqual(task.id, 'a-cycle-limit');
		assert.strictEqual(task.title, 'A cycle limit');
		assert.strictEqual(store.snapshot.task?.id, 'a-cycle-limit');
		assert.strictEqual(store.snapshot.task?.stage, 'brief');
		assert.ok(changes > 0);
		assert.deepStrictEqual(parseActive(file('active.json')), { version: 1, task: 'a-cycle-limit', isPaused: false });
		assert.strictEqual(parseTask(file('a-cycle-limit', 'task.json'), 'a-cycle-limit').created, '2026-11-14T10:00:00.000Z');
		const { decisions } = parseDecisions(file('a-cycle-limit', 'decisions.jsonl'));
		assert.deepStrictEqual(decisions.map((d) => d.kind), ['task']);
		// a second store reads the same state from the files
		const other = new SessionStore(root);
		other.load();
		assert.strictEqual(other.snapshot.task?.title, 'A cycle limit');
		assert.deepStrictEqual(other.snapshot.tasks.map((t) => t.id), ['a-cycle-limit']);
	});

	test('Gates, a pause, a continue and a deny go into the ledger', () => {
		const store = new SessionStore(root, clock());
		store.newTask('Fix');
		assert.throws(() => store.passGate('accept-order'), /is not the gate of stage 1 of 5/);
		const next = store.passGate('brief-ready');
		assert.strictEqual(next.stage, 'survey');
		store.setPaused(true);
		store.setPaused(true); // no change, no line
		assert.strictEqual(store.snapshot.isPaused, true);
		store.setPaused(false);
		store.recordDeny('Edit', 'src/a.cpp', 'No.');
		const kinds = parseDecisions(file('fix', 'decisions.jsonl')).decisions.map((d) => d.kind);
		assert.deepStrictEqual(kinds, ['task', 'gate', 'pause', 'continue', 'deny']);
		assert.deepStrictEqual(store.snapshot.decisions.map((d) => d.kind), kinds);
		assert.strictEqual(parseTask(file('fix', 'task.json'), 'fix').stage, 'survey');
	});

	test('Open task changes the active task, and the same title gets a new id', () => {
		const store = new SessionStore(root, clock());
		store.newTask('Fix');
		store.setPaused(true);
		const second = store.newTask('fix');
		assert.strictEqual(second.id, 'fix-2');
		// the newest first
		assert.deepStrictEqual(store.snapshot.tasks.map((t) => t.id), ['fix-2', 'fix']);
		store.openTask('fix');
		assert.strictEqual(store.snapshot.task?.id, 'fix');
		// a task that is open again has the guard on
		assert.strictEqual(store.snapshot.isPaused, false);
		assert.throws(() => store.openTask('none'), /no task none/);
	});

	test('With no folder, no title or no active task, the store gives an error', () => {
		const empty = new SessionStore(undefined);
		empty.load();
		assert.strictEqual(empty.snapshot.task, undefined);
		assert.throws(() => empty.newTask('Fix'), /Open a folder in VS Code first/);
		const store = new SessionStore(root);
		assert.throws(() => store.newTask('   '), /Give a title/);
		assert.throws(() => store.newTask('x'.repeat(201)), /more than 200 characters/);
		assert.throws(() => store.setPaused(true), /No task is active/);
		// a deny with no active task changes nothing
		store.recordDeny('Edit', 'a.cpp', 'No.');
		assert.deepStrictEqual(store.snapshot.decisions, []);
	});

	test('A wrong stage file is a problem, and no task is active', () => {
		mkdirSync(path.join(root, '.shotgun', 'fix'), { recursive: true });
		writeFileSync(path.join(root, '.shotgun', 'active.json'), '{ "version": 1, "task": "fix", "isPaused": false }');
		writeFileSync(path.join(root, '.shotgun', 'fix', 'task.json'), '{ "version": 1 }');
		const store = new SessionStore(root);
		store.load();
		assert.strictEqual(store.snapshot.task, undefined);
		assert.strictEqual(store.snapshot.problems.length, 2, store.snapshot.problems.join('\n'));
		assert.match(store.snapshot.problems[1], /active\.json names the task fix/);
	});
});
