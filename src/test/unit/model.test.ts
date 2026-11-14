import * as assert from 'assert';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import { compareVersions } from '../../dataflow/version';
import type { Decision, TaskFile } from '../../session/files';
import type { Snapshot } from '../../session/store';
import { buildModel, DataFlowView, decisionText, statusOf } from '../../views/model';
import { isFromView } from '../../views/views';

// The view model of the page and of the panel, and the messages of the webviews
suite('View model', () => {
	const root = path.resolve('/work/project');
	const ready: DataFlowView = { state: 'ready', version: '0.6.0', engine: 'ready' };
	const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
	const task = (over: Partial<TaskFile> = {}): TaskFile => ({
		version: 1, id: 'fix', title: 'Fix', created: '2026-11-14T10:00:00.000Z', stage: 'survey', isDone: false, gates: [], ...over,
	});
	const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
		root, task: undefined, isPaused: false, tasks: [], decisions: [], problems: [], ...over,
	});
	const model = (s: Snapshot, claude = connected, dataflow = ready) => buildModel({ version: '0.1.0', snapshot: s, dataflow, claude });

	test('No task: the stages are to do, and the setup asks for each missing part', () => {
		const m = model(snapshot(), { dataflow: 'none', marketplace: 'none', plugin: 'off' }, { state: 'old', version: '0.5.0' });
		assert.strictEqual(m.task, null);
		assert.deepStrictEqual(m.stages.map((s) => s.state), ['todo', 'todo', 'todo', 'todo', 'todo']);
		assert.deepStrictEqual(m.setup.map((r) => [r.id, r.isOk, r.action?.command]), [
			['folder', true, undefined],
			['dataflow', false, undefined],
			['claude-dataflow', false, 'connectDataFlow'],
			['claude-shotgun', false, 'connectClaude'],
		]);
		assert.match(m.setup[1].text, /DataFlow 0\.5\.0 is too old\. Install DataFlow 0\.6\.0/);
		assert.strictEqual(m.isReady, false);
		assert.strictEqual(model(snapshot()).isReady, true);
		assert.strictEqual(model(snapshot({ root: undefined })).setup[0].isOk, false);
	});

	test('A task in stage 2: stage 1 is done, stage 2 is current, with its request and its gate', () => {
		const m = model(snapshot({ task: task(), tasks: [{ id: 'fix', title: 'Fix', stage: 'survey', isDone: false, created: '' }] }));
		assert.deepStrictEqual(m.stages.map((s) => s.state), ['done', 'current', 'todo', 'todo', 'todo']);
		assert.deepStrictEqual(m.stages.map((s) => s.writer), ['user', 'claude', 'user', 'claude', 'both']);
		assert.strictEqual(m.task?.stageName, 'Survey');
		assert.strictEqual(m.task?.request, 'Survey my brief.');
		assert.strictEqual(m.task?.gate, 'Order the tasks');
		assert.strictEqual(m.tasks[0].isActive, true);
		// with a task, the plugin must be on in the folder
		const off = model(snapshot({ task: task(), tasks: [{ id: 'fix', title: 'Fix', stage: 'survey', isDone: false, created: '' }] }),
			{ ...connected, plugin: 'off' });
		assert.deepStrictEqual(off.setup[3].action, { command: 'connectClaude', label: 'Turn it on' });
	});

	test('A paused task has no request, and a done task has all stages done', () => {
		const paused = model(snapshot({ task: task(), isPaused: true }));
		assert.strictEqual(paused.task?.request, undefined);
		assert.match(paused.task?.guard ?? '', /no decision in a pause/);
		const done = model(snapshot({ task: task({ stage: 'build', isDone: true }) }));
		assert.deepStrictEqual(done.stages.map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
		assert.strictEqual(done.task?.gate, undefined);
	});

	test('The decisions: the newest first, with a text for each kind', () => {
		const decisions: Decision[] = [
			{ version: 1, time: 't1', kind: 'task', by: 'claude', title: 'Fix' },
			{ version: 1, time: 't2', kind: 'gate', by: 'user', gate: 'brief-ready', stage: 'brief' },
			{ version: 1, time: 't3', kind: 'deny', by: 'guard', tool: 'Edit', file: 'src/a.cpp', reason: 'No.' },
		];
		const m = model(snapshot({ task: task(), decisions }));
		assert.deepStrictEqual(m.decisions.map((d) => d.text), [
			'The guard stopped Edit of src/a.cpp.',
			'You passed the gate "The brief is ready" of stage 1.',
			'Claude started the task "Fix".',
		]);
		assert.strictEqual(decisionText({ version: 1, time: 't', kind: 'pause', by: 'user' }), 'You paused the guard for work outside of the task.');
	});

	test('The status bar', () => {
		assert.strictEqual(statusOf(snapshot()).text, 'Shotgun');
		assert.strictEqual(statusOf(snapshot({ task: task() })).text, 'Shotgun: stage 2 of 5, the survey');
		assert.strictEqual(statusOf(snapshot({ task: task(), isPaused: true })).text, 'Shotgun: paused');
		assert.strictEqual(statusOf(snapshot({ task: task({ isDone: true }) })).text, 'Shotgun: the task is done');
	});

	test('The versions of DataFlow', () => {
		assert.strictEqual(compareVersions('0.6.0', '0.6.0'), 0);
		assert.strictEqual(compareVersions('0.10.0', '0.6.0'), 1);
		assert.strictEqual(compareVersions('0.5.9', '0.6.0'), -1);
		assert.strictEqual(compareVersions('0.6', '0.6.0'), 0);
		assert.strictEqual(compareVersions('0.6.0-beta.1', '0.6.0'), 0);
	});

	test('A webview message must have a correct form', () => {
		assert.ok(isFromView({ type: 'ready' }));
		assert.ok(isFromView({ type: 'command', command: 'pause' }));
		assert.ok(isFromView({ type: 'selectTask', id: 'fix' }));
		assert.ok(isFromView({ type: 'copy', text: 'Survey my brief.' }));
		assert.ok(!isFromView({ type: 'command', command: 'deleteAll' }));
		assert.ok(!isFromView({ type: 'copy', text: 'x'.repeat(2001) }));
		assert.ok(!isFromView({ type: 'other' }));
		assert.ok(!isFromView(null));
	});
});
