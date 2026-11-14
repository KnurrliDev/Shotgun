import * as assert from 'assert';
import { readFileSync, rmSync } from 'fs';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import { readText } from '../../session/files';
import { applyEdit, changedTasks, checkTaskSurvey, factsOf, Order, orderOf, orderWarnings, parseOrder, surveyIds } from '../../session/order';
import { SessionStore } from '../../session/store';
import { checkSurvey, Survey, SurveyContext } from '../../session/survey';
import { PromptLog } from '../../tools/prompts';
import type { EngineApi } from '../../tools/survey';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, SURVEY } from './fixture';

// A survey with 3 tasks for the functions of the order. T3 needs T1 and T2, and T2 needs T1
const hook = (id: string, lines: [number, number], code: string) => ({ id, title: id, kind: 'check', file: 'src/solver.cpp', lines, code });
const THREE: Survey = {
	tasks: [
		{ id: 'T1', title: 'Add the limit', hooks: ['H1'], needs: [], size: 'small' },
		{ id: 'T2', title: 'Count the cycles', hooks: ['H2'], needs: ['T1'] },
		{ id: 'T3', title: 'Leave the state', hooks: ['H1', 'H2'], needs: ['T1', 'T2'], size: 'medium' },
	],
	hooks: [hook('H1', [5, 7], 'for (int i = 0;'), hook('H2', [6, 6], 'plan.step(i);')],
	facts: [],
	questions: [{ id: 'Q1', text: 'What is the limit?' }],
};

suite('Order', () => {
	let root: string;
	let store: SessionStore;
	const id = 'a-cycle-limit-for-the-solver';
	const solver = () => path.join(root, 'src', 'solver.cpp');
	const context = (): SurveyContext => ({ root, folders: [root], isCaseSensitive: true, readLines: (f) => readText(f)?.split(/\r?\n/), tools: [] });
	const tool = (name: string, engine: EngineApi = fakeEngine()) => shotgunTools({
		store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => engine,
	}).find((t) => t.name === name)!;
	const call = (name: string, args: Record<string, unknown>, engine?: EngineApi) => tool(name, engine).call(args) as Promise<Record<string, unknown>>;
	// the task of the fixture in stage 3, with the survey of the fixture: T1 "A cycle limit", and T2 "A note in the README" that needs T1
	const orderStage = async () => {
		store.newTask('A cycle limit for the solver');
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
	};
	const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
	const model = () => buildModel({
		version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
		readLines: (f) => readText(f)?.split(/\r?\n/),
	});

	setup(() => {
		root = makeProject('shotgun-order-');
		store = new SessionStore(root);
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The order starts with the tasks of the survey, and each task has the facts of its survey', () => {
		const order = orderOf(undefined, THREE);
		assert.deepStrictEqual(order.tasks.map((t) => [t.id, t.text, t.isNew, t.isLater]), [
			['T1', 'Add the limit', false, false], ['T2', 'Count the cycles', false, false], ['T3', 'Leave the state', false, false],
		]);
		assert.strictEqual(order.nextId, 1);
		assert.deepStrictEqual(factsOf(order.tasks[2], THREE), {
			isChanged: false, hasSurvey: true, isSurveyedAgain: false, hooks: ['H1', 'H2'], needs: ['T1', 'T2'], size: 'medium',
		});
		assert.deepStrictEqual(orderWarnings(order, THREE), []);
		assert.deepStrictEqual(changedTasks(order, THREE), []);
	});

	test('A rewritten task and a new task have no survey until Claude surveys their text', () => {
		const used = surveyIds(THREE);
		let order: Order = applyEdit(orderOf(undefined, THREE), { action: 'text', id: 'T2', text: '  Count  the planning cycles ' }, used).order;
		assert.strictEqual(order.tasks[1].text, 'Count the planning cycles');
		assert.deepStrictEqual(factsOf(order.tasks[1], THREE), {
			isChanged: true, hasSurvey: false, isSurveyedAgain: false, hooks: ['H2'], needs: ['T1'], oldText: 'Count the cycles',
		});
		const added = applyEdit(order, { action: 'add', text: 'Write the limit to the log' }, used);
		assert.deepStrictEqual([added.task.id, added.task.isNew, added.position, added.order.nextId], ['N1', true, 4, 2]);
		order = added.order;
		assert.deepStrictEqual(factsOf(order.tasks[3], THREE), { isChanged: true, hasSurvey: false, isSurveyedAgain: false, hooks: [], needs: [] });
		assert.deepStrictEqual(changedTasks(order, THREE).map((t) => t.id), ['T2', 'N1']);
		// Claude surveys the new text
		const surveyed = { ...order.tasks[1], survey: { text: 'Count the planning cycles', hooks: ['H2'], needs: ['T1'], note: 'The same hook.', time: 't' } };
		assert.deepStrictEqual(factsOf(surveyed, THREE), {
			isChanged: true, hasSurvey: true, isSurveyedAgain: true, hooks: ['H2'], needs: ['T1'], note: 'The same hook.',
		});
		// a new text again: the survey is for the old text
		const again = { ...surveyed, text: 'Count each cycle' };
		assert.deepStrictEqual([factsOf(again, THREE).hasSurvey, factsOf(again, THREE).oldText], [false, 'Count the planning cycles']);
		// the text of the survey of stage 2 again: that survey is good again
		assert.strictEqual(factsOf({ ...again, text: 'Count the cycles' }, THREE).hasSurvey, true);
		// a new task never gets an id that the survey or the order uses
		assert.strictEqual(applyEdit(order, { action: 'add', text: 'Another task' }, new Set([...used, 'n2'])).task.id, 'N3');
	});

	test('The user moves a task, keeps a task for later and removes a new task. A wrong edit gives an error', () => {
		const used = surveyIds(THREE);
		const order = orderOf(undefined, THREE);
		const moved = applyEdit(order, { action: 'move', id: 'T3', step: -1 }, used);
		assert.deepStrictEqual([moved.order.tasks.map((t) => t.id), moved.position], [['T1', 'T3', 'T2'], 2]);
		assert.deepStrictEqual(orderWarnings(moved.order, THREE).map((w) => w.text), ['Task 2 needs task 3. Task 3 comes later.']);
		assert.throws(() => applyEdit(order, { action: 'move', id: 'T1', step: -1 }, used), /at the start of the order already/);
		assert.throws(() => applyEdit(order, { action: 'move', id: 'T3', step: 1 }, used), /at the end of the order already/);
		assert.throws(() => applyEdit(order, { action: 'text', id: 'T9', text: 'x' }, used), /The order has no task T9/);
		assert.throws(() => applyEdit(order, { action: 'text', id: 'T1', text: 'x'.repeat(201) }, used), /maximum of 200 characters/);
		assert.throws(() => applyEdit(order, { action: 'add', text: '   ' }, used), /Give the text of the new task/);
		assert.throws(() => applyEdit(order, { action: 'remove', id: 'T1' }, used), /removes only a new task of yours/);
		// T2 and T3 need T1, and T1 is for later
		const later = applyEdit(order, { action: 'later', id: 'T1', isLater: true }, used).order;
		assert.deepStrictEqual(orderWarnings(later, THREE).map((w) => w.text), [
			'Task 1 needs "Add the limit". That task is for later.', 'Task 2 needs "Add the limit". That task is for later.',
		]);
		// a task with no text gets a warning, and Claude does not survey it
		const empty = applyEdit(order, { action: 'text', id: 'T1', text: ' ' }, used).order;
		assert.deepStrictEqual(orderWarnings(empty, THREE).map((w) => w.text), ['Task 1 has no text.']);
		assert.deepStrictEqual(changedTasks(empty, THREE), []);
		const added = applyEdit(order, { action: 'add', text: 'A new task' }, used).order;
		assert.deepStrictEqual(applyEdit(added, { action: 'remove', id: 'N1' }, used).order.tasks.map((t) => t.id), ['T1', 'T2', 'T3']);
	});

	test('checkTaskSurvey gives all problems in 1 list, and takes a correct survey', () => {
		const used = surveyIds(THREE);
		let order = applyEdit(orderOf(undefined, THREE), { action: 'text', id: 'T2', text: 'Count the planning cycles' }, used).order;
		order = applyEdit(order, { action: 'add', text: 'Write the limit to the log' }, used).order;
		const bad = checkTaskSurvey({
			task: 'N1', text: 'Write the limit to the log!', hooks: ['H1', 'H9'],
			newHooks: [
				{ id: 'H1', title: 'Again', kind: 'log', file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' },
				{ id: 'H3', title: 'Log', kind: 'log', file: 'src/solver.cpp', lines: [8, 8], code: 'while (true)' },
			],
			needs: ['N1', 'T7'], size: 'huge', note: 'x'.repeat(501),
		}, order, THREE, context());
		assert.strictEqual(bad.result, undefined);
		assert.deepStrictEqual(bad.problems, [
			'"text" is not the text of task N1 now. The text now is "Write the limit to the log". Survey this text, and give it in "text".',
			'H9 is not a hook of the survey. Give a new hook in "newHooks".',
			'New hook 1: the id H1 is there already. Each id must be different.',
			'New hook 2: the code "while (true)" is not in the lines 8 to 8 of src/solver.cpp. Read the file again, and give the correct lines.',
			'A task cannot need itself.',
			'The task T7 in "needs" is not in the order.',
			'The task: "size" must be small, medium or large.',
			'The task: the "note" has more than 500 characters.',
		]);
		assert.deepStrictEqual(checkTaskSurvey({ task: 'X1', text: 'x', hooks: [], needs: [] }, order, THREE, context()).problems,
			['The order has no task X1. Call get_order, and give the id of a task.']);
		// T1 needs N1 after a survey of T1, and T3 needs T1: N1 cannot need T3
		const circled = { ...order, tasks: order.tasks.map((t) => (t.id === 'T1' ? { ...t, survey: { text: 'Add the limit', hooks: ['H1'], needs: ['N1'], time: 't' } } : t)) };
		assert.deepStrictEqual(checkTaskSurvey({ task: 'N1', text: 'Write the limit to the log', hooks: [], needs: ['T3'] }, circled, THREE, context()).problems,
			['The needs make a circle: T1, N1, T3. A task cannot need itself through other tasks.']);
		const good = checkTaskSurvey({
			task: 'N1', text: 'Write  the limit to the log', hooks: ['H1', 'H1'],
			newHooks: [{ id: 'H3', title: 'The result', kind: 'log line', file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }],
			needs: ['T1'], size: 'small', note: 'A new hook, H3.',
		}, order, THREE, context());
		assert.deepStrictEqual(good.problems, []);
		assert.deepStrictEqual(good.result?.survey, { text: 'Write the limit to the log', hooks: ['H1', 'H3'], needs: ['T1'], size: 'small', note: 'A new hook, H3.' });
		assert.deepStrictEqual(good.result?.newHooks.map((h) => [h.id, h.file, h.lines, h.codeLine]), [['H3', 'src/solver.cpp', [8, 8], 8]]);
	});

	test('The survey of stage 2 can give the size of a task', () => {
		const tasks = [{ ...SURVEY.tasks[0], size: 'small' }, { ...SURVEY.tasks[1], size: 'huge' }];
		const checked = checkSurvey({ ...SURVEY, tasks }, context());
		assert.deepStrictEqual(checked.problems, ['Task 2: "size" must be small, medium or large.']);
		assert.strictEqual(checked.survey.tasks[0].size, 'small');
	});

	test('The edits go into order.json and the ledger, only in stage 3', async () => {
		store.newTask('A cycle limit for the solver');
		assert.throws(() => store.editOrder({ action: 'add', text: 'x' }), /only in stage 3/);
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		// with no edit, the order is the order of the survey, and no file is there
		assert.strictEqual(store.snapshot.order, undefined);
		assert.deepStrictEqual(store.order.tasks.map((t) => t.id), ['T1', 'T2']);
		store.editOrder({ action: 'add', text: 'Write the limit to the log' });
		store.editOrder({ action: 'move', id: 'N1', step: -1 });
		store.editOrder({ action: 'text', id: 'T2', text: 'A note about the limit in the README' });
		store.editOrder({ action: 'text', id: 'T2', text: 'A note about the limit in the README ' }); // no change, so no decision
		store.editOrder({ action: 'later', id: 'T2', isLater: true });
		store.editOrder({ action: 'later', id: 'T2', isLater: true }); // no change, so no decision
		store.editOrder({ action: 'later', id: 'T2', isLater: false });
		store.editOrder({ action: 'add', text: 'A wrong task' });
		store.editOrder({ action: 'remove', id: 'N2' });
		const file = parseOrder(readFileSync(path.join(root, '.shotgun', id, 'order.json'), 'utf8'), id);
		assert.deepStrictEqual(file.tasks.map((t) => [t.id, t.text]), [['T1', 'A cycle limit'], ['N1', 'Write the limit to the log'], ['T2', 'A note about the limit in the README']]);
		assert.strictEqual(file.nextId, 3);
		assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind === 'order').map((d) => decisionText(d)), [
			'You added the task "Write the limit to the log".',
			'You moved "Write the limit to the log" to place 2.',
			'You changed the text of task T2 to "A note about the limit in the README".',
			'You kept "A note about the limit in the README" for later.',
			'You put "A note about the limit in the README" back into the plan.',
			'You added the task "A wrong task".',
			'You removed the task "A wrong task".',
		]);
		assert.throws(() => parseOrder(JSON.stringify({ ...file, version: 2 }), id), /has the version 2/);
		assert.throws(() => parseOrder(JSON.stringify({ version: 1, time: 't', tasks: [] }), id), /needs the fields version, time, tasks and nextId/);
		assert.throws(() => parseOrder(JSON.stringify({ ...file, tasks: [{ id: 'T1' }] }), id), /a task with no correct fields/);
	});

	test('get_order and submit_task_survey: Claude surveys the changed tasks', async () => {
		store.newTask('A cycle limit for the solver');
		await assert.rejects(async () => tool('get_order').call({}), /The active task is in stage 1 of 5, the brief\. The order starts in stage 3/);
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		store.editOrder({ action: 'text', id: 'T2', text: 'A note about the limit in the README' });
		store.editOrder({ action: 'add', text: 'Write the limit to the log' });
		const data = tool('get_order').call({}) as { changed: string[]; tasks: { place: number; id: string; hasSurvey: boolean; oldText?: string; hooks: string[] }[] };
		assert.deepStrictEqual(data.changed, ['T2', 'N1']);
		assert.deepStrictEqual(data.tasks.map((t) => [t.place, t.id, t.hasSurvey]), [[1, 'T1', true], [2, 'T2', false], [3, 'N1', false]]);
		assert.strictEqual(data.tasks[1].oldText, 'A note in the README');
		assert.deepStrictEqual(data.tasks[0].hooks, ['H1 src/solver.cpp:5-7']);
		// the text of the survey is not the text now
		await assert.rejects(call('submit_task_survey', { task: 'T2', text: 'A note in the README', hooks: ['H2'], needs: ['T1'] }),
			/The text now is "A note about the limit in the README"/);
		const first = await call('submit_task_survey', {
			task: 'T2', text: 'A note about the limit in the README', hooks: ['H2'], needs: ['T1'], size: 'small', note: 'The same hook, H2.',
		});
		assert.deepStrictEqual(first.changed, ['N1']);
		// a new hook gets the facts of DataFlow
		const calls: string[] = [];
		const second = await call('submit_task_survey', {
			task: 'N1', text: 'Write the limit to the log', hooks: [],
			newHooks: [{ id: 'H3', title: 'The result', kind: 'log line', file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }],
			needs: ['T1'],
		}, fakeEngine(calls));
		assert.deepStrictEqual(calls.sort(), ['heat solver.cpp:8-8', 'place solver.cpp:8']);
		assert.deepStrictEqual(second.hooks, [{
			id: 'H3', place: 'src/solver.cpp:8', engine: 'In solve(), in a for loop. The thread of the caller runs the line, with no lock.',
			heat: '64 hot, before the end of the scan of the call graph',
		}]);
		assert.deepStrictEqual(second.changed, []);
		assert.match(String(second.next), /Accept the order/);
		assert.deepStrictEqual(store.snapshot.survey?.hooks.map((h) => h.id), ['H1', 'H2', 'H3']);
		assert.deepStrictEqual([store.snapshot.engine?.hooks.H3.hasFacts, store.snapshot.engine?.hooks.H1.hasFacts], [true, true]);
		assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind === 'task-survey').map((d) => decisionText(d)), [
			'Claude surveyed the task T2: 1 hook, and it needs 1 task.', 'Claude surveyed the task N1: 1 hook, and it needs 1 task.',
		]);
		const session = tool('get_session').call({}) as { order: unknown };
		assert.deepStrictEqual(session.order, { inPlan: 3, later: 0, changed: [], warnings: 0, tool: 'Call shotgun_get_order for the tasks in sequence.' });
		// after the gate, the order does not change. Claude can still survey a task in stage 4, before the plan
		store.acceptOrder();
		assert.throws(() => store.editOrder({ action: 'add', text: 'x' }), /only in stage 3/);
	});

	test('The order page: the tasks with their facts, the order check and the gate', async () => {
		await orderStage();
		store.editOrder({ action: 'text', id: 'T2', text: 'A note about the limit in the README' });
		store.editOrder({ action: 'add', text: 'Write the limit to the log' });
		store.editOrder({ action: 'move', id: 'T1', step: 1 });
		const m = model();
		const view = m.task!.order!;
		assert.deepStrictEqual(view.tasks.map((t) => [t.place, t.id, t.needsText, t.isChanged, t.hasSurvey]), [
			[1, 'T2', 'needs 2', true, false],
			[2, 'T1', 'needs no task', false, true],
			[3, 'N1', 'needs not known', true, false],
		]);
		assert.deepStrictEqual(view.tasks[0].note, { by: 'user', text: 'You changed the text. The hooks and the needs are from the old text: "A note in the README".' });
		assert.deepStrictEqual(view.tasks[2].note, { by: 'user', text: 'Your task. It has no survey yet: no hooks and no needs.' });
		assert.deepStrictEqual([view.warnings, view.tasks[0].warnings], [['Task 1 needs task 2. Task 2 comes later.'], ['Task 1 needs task 2. Task 2 comes later.']]);
		assert.deepStrictEqual(view.tasks[1].hooks, [{ id: 'H1', place: 'src/solver.cpp:5-7', path: solver(), line: 5 }]);
		assert.deepStrictEqual([view.inPlan, view.later, view.changed, view.isEditable], [3, 0, 2, true]);
		assert.deepStrictEqual(m.task!.gate, {
			label: 'Accept with 1 warning',
			note: 'Your gate. After it, Claude makes the plan in this sequence.',
			isEnabled: true,
			warning: '2 tasks of the plan have no survey. Claude surveys them at the start of the plan.',
			after: 'Make the plan.',
		});
		// a task with no text stops the gate, and a plan with no task too
		store.editOrder({ action: 'text', id: 'N1', text: '' });
		assert.deepStrictEqual([model().task!.gate!.isEnabled, model().task!.gate!.reason], [false, 'Write the text of task 3.']);
		store.editOrder({ action: 'text', id: 'N1', text: 'Write the limit to the log' });
		// the gate: order.json keeps the order, and the page shows it with no edit
		store.acceptOrder();
		const after = model().task!;
		assert.deepStrictEqual([after.stage, after.order?.isEditable, after.gate?.label, after.gate?.isEnabled], ['plan', false, 'Accept the plan', false]);
		assert.strictEqual(parseOrder(readFileSync(path.join(root, '.shotgun', id, 'order.json'), 'utf8'), id).tasks.length, 3);
		assert.strictEqual(decisionText(store.snapshot.decisions[store.snapshot.decisions.length - 1]), 'You passed the gate "Accept the order" of stage 3.');
	});

	test('A webview message with an edit of the order must have a correct form', () => {
		assert.ok(isFromView({ type: 'editOrder', edit: { action: 'move', id: 'T1', step: -1 } }));
		assert.ok(isFromView({ type: 'editOrder', edit: { action: 'text', id: 'T1', text: '' } }));
		assert.ok(isFromView({ type: 'editOrder', edit: { action: 'add', text: 'A task' } }));
		assert.ok(isFromView({ type: 'editOrder', edit: { action: 'later', id: 'T1', isLater: true } }));
		assert.ok(isFromView({ type: 'editOrder', edit: { action: 'remove', id: 'N1' } }));
		assert.ok(!isFromView({ type: 'editOrder', edit: { action: 'move', id: 'T1', step: 2 } }));
		assert.ok(!isFromView({ type: 'editOrder', edit: { action: 'later', id: 'T1' } }));
		assert.ok(!isFromView({ type: 'editOrder', edit: { action: 'drop', id: 'T1' } }));
		assert.ok(!isFromView({ type: 'editOrder', edit: { action: 'add', text: 'x'.repeat(2001) } }));
		assert.ok(!isFromView({ type: 'editOrder' }));
	});
});
