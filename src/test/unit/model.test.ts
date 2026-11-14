import * as assert from 'assert';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import { compareVersions } from '../../dataflow/version';
import type { Decision, Question, TaskFile } from '../../session/files';
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
		root, task: undefined, isPaused: false, tasks: [], decisions: [], questions: [], survey: undefined, engine: undefined, answers: {},
		order: undefined, plan: undefined, risk: undefined, levels: undefined, build: undefined, problems: [], ...over,
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
		// the gate of stage 2 waits for the survey of Claude
		assert.deepStrictEqual(m.task?.gate, {
			label: 'Order the tasks',
			note: 'Your gate. After it, you put the tasks in sequence. You can rewrite a task, and you can add a task.',
			isEnabled: false,
			reason: 'Ask Claude for the survey first.',
		});
		assert.strictEqual(m.task?.survey, undefined);
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
		assert.strictEqual(decisionText({ version: 1, time: 't', kind: 'brief', by: 'claude', lines: 5 }), 'Claude gave your brief from the chat: 5 lines of your words.');
		assert.strictEqual(decisionText({ version: 1, time: 't', kind: 'questions', by: 'claude', count: 1 }), 'Claude asked 1 question about the brief.');
		assert.strictEqual(decisionText({ version: 1, time: 't', kind: 'question', by: 'user', id: 'q1', text: 'Why?' }), 'You closed the question "Why?".');
	});

	test('Stage 1: the parts of the brief, the open questions and the gate', () => {
		const brief = { file: path.join(root, 'brief.md'), text: '# Brief: Fix\n\n## Goal\nA goal.\n\n## Facts\n- One.\n- Two.\n', isDirty: true };
		const questions: Question[] = [
			{ id: 'q1', text: 'Why?', part: 'facts', quote: 'Two.', state: 'open', created: 't' },
			{ id: 'q2', text: 'Old?', state: 'closed', created: 't', closed: 't2' },
		];
		const m = buildModel({ version: '0.1.0', snapshot: snapshot({ task: task({ stage: 'brief' }), questions }), dataflow: ready, claude: connected, brief });
		const view = m.task!.brief!;
		assert.deepStrictEqual(view.parts.map((p) => [p.name, p.hasText, p.summary, p.line]), [
			['Goal', true, '1 sentence', 3], ['Facts', true, '2 items', 6], ['Specs', false, 'no heading', undefined],
			['Not in scope', false, 'no heading', undefined], ['Done when', false, 'no heading', undefined],
		]);
		assert.deepStrictEqual([view.complete, view.isComplete, view.isDirty, view.closed], [2, false, true, 1]);
		assert.deepStrictEqual(view.questions, [{ id: 'q1', text: 'Why?', partName: 'Facts', line: 8 }]);
		assert.deepStrictEqual(m.task!.gate, {
			label: 'The brief is ready',
			note: 'Your gate. It starts the scan of the call graph.',
			isEnabled: false,
			reason: 'Write Specs, Not in scope, Done when in brief.md first.',
			warning: '1 question of Claude is open.',
			after: 'Survey my brief.',
		});
		// a complete brief with no open question enables the gate
		const done = buildModel({
			version: '0.1.0', snapshot: snapshot({ task: task({ stage: 'brief' }) }), dataflow: ready, claude: connected,
			brief: { ...brief, text: `${brief.text}## Specs\nS.\n## Not in scope\nN.\n## Done when\nD.\n` },
		});
		assert.deepStrictEqual([done.task!.gate!.isEnabled, done.task!.gate!.reason, done.task!.gate!.warning], [true, undefined, undefined]);
		// after stage 1, the task has no view of the brief, and the gate is the gate of the new stage
		const survey = buildModel({ version: '0.1.0', snapshot: snapshot({ task: task({ stage: 'survey' }) }), dataflow: ready, claude: connected, brief });
		assert.strictEqual(survey.task!.brief, undefined);
		assert.strictEqual(survey.task!.gate?.label, 'Order the tasks');
		// this version has no gate for the stages 3 to 5
		const order = buildModel({ version: '0.1.0', snapshot: snapshot({ task: task({ stage: 'order' }) }), dataflow: ready, claude: connected });
		assert.strictEqual(order.task!.gate, undefined);
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
		assert.ok(isFromView({ type: 'openPlace', path: path.join(root, 'a.cpp'), line: 3 }));
		assert.ok(isFromView({ type: 'saveAnswer', id: 'Q1', text: '' }));
		assert.ok(isFromView({ type: 'checkHooks' }));
		assert.ok(!isFromView({ type: 'command', command: 'deleteAll' }));
		assert.ok(!isFromView({ type: 'copy', text: 'x'.repeat(2001) }));
		assert.ok(!isFromView({ type: 'openPlace', path: 'a.cpp', line: 0 }));
		assert.ok(!isFromView({ type: 'openPlace', path: 3, line: 1 }));
		assert.ok(!isFromView({ type: 'saveAnswer', id: 'Q1', text: 'x'.repeat(4001) }));
		assert.ok(!isFromView({ type: 'other' }));
		assert.ok(!isFromView(null));
	});
});
