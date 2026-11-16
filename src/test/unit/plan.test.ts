import * as assert from 'assert';
import { readFileSync, rmSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ClaudeState } from '../../claude/connection';
import type { HeatFacts } from '../../dataflow/dataflow-api';
import { StepDecorations } from '../../editor/steps';
import { readText } from '../../session/files';
import { checkPlan, decisionsOf, levelOf, levelReasons, parseLevels, parsePlan, parseRisk } from '../../session/plan';
import { placeLevel } from '../../session/risk';
import { SessionStore } from '../../session/store';
import type { SurveyContext } from '../../session/survey';
import { placeRisk } from '../../tools/plan';
import { PromptLog } from '../../tools/prompts';
import type { EngineApi } from '../../tools/survey';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, heatFacts, makeProject, noBuild, placeFacts, SURVEY } from './fixture';

// A plan for the fixture: S1 changes the loop of solve() with 1 open decision, S2 makes a new file, and S3 changes the
// README
const PLAN = {
	steps: [
		{
			id: 'S1', title: 'The limit in the loop', task: 'T1', hooks: ['H1'], text: 'Stop the loop at the limit.', checks: ['The project builds.'],
			places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)' }],
			decisions: [{ question: 'What happens to the partial result at the limit?', options: ['Keep it', 'Drop it'] }],
		},
		{
			id: 'S2', title: 'A test of the limit', task: 'T1', hooks: [], text: 'A test for the limit.', checks: ['The test passes.'],
			places: [{ file: 'tests/limit_test.cpp', new: true }], decisions: [],
		},
		{
			id: 'S3', title: 'The note in the README', task: 'T2', hooks: ['H2'], text: 'Write the limit in the README.', checks: ['The README tells the limit.'],
			places: [{ file: 'README.md', lines: [3, 3], code: 'It has no limit.' }], note: 'A text file, with no facts of DataFlow.', decisions: [],
		},
	],
};

suite('Plan', () => {
	let root: string;
	let store: SessionStore;
	const id = 'a-cycle-limit-for-the-solver';
	const solver = () => path.join(root, 'src', 'solver.cpp');
	const context = (): SurveyContext => ({ root, folders: [root], isCaseSensitive: true, readLines: (f) => readText(f)?.split(/\r?\n/), tools: [] });
	const tool = (name: string, engine: EngineApi = fakeEngine()) => shotgunTools({
		store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => engine, ...noBuild(),
	}).find((t) => t.name === name)!;
	const call = (name: string, args: Record<string, unknown>, engine?: EngineApi) => tool(name, engine).call(args) as Promise<Record<string, unknown>>;
	// the task of the fixture in stage 4, with the order of the survey
	const planStage = async () => {
		store.newTask('A cycle limit for the solver');
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		store.acceptOrder();
	};
	const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
	const model = () => buildModel({
		version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
		readLines: (f) => readText(f)?.split(/\r?\n/),
	});
	const levels = () => store.snapshot.plan!.steps.map((s) => levelOf(s, store.snapshot.risk, store.snapshot.levels).level);

	setup(() => {
		root = makeProject('shotgun-plan-');
		store = new SessionStore(root);
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('checkPlan gives all problems in 1 list', async () => {
		await planStage();
		const order = store.order;
		const survey = store.snapshot.survey!;
		const { plan, problems } = checkPlan(PLAN, context(), order, survey);
		assert.deepStrictEqual(problems, []);
		assert.deepStrictEqual(plan.steps.map((s) => s.places), [
			[{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)', codeLine: 5 }],
			[{ file: 'tests/limit_test.cpp' }],
			[{ file: 'README.md', lines: [3, 3], code: 'It has no limit.', codeLine: 3 }],
		]);
		// Shotgun gives the open decisions the ids D1 to D3
		assert.deepStrictEqual(plan.steps.map((s) => s.decisions), [
			[{ id: 'D1', question: 'What happens to the partial result at the limit?', options: ['Keep it', 'Drop it'] }], [], [],
		]);
		const bad = checkPlan({
			steps: [
				{ id: 'S1', title: 'A', task: 'T2', hooks: ['H9'], text: 'x', checks: [], places: [], decisions: [] },
				{ id: 's1', title: 'B', task: 'T7', text: 'x', checks: ['a', 'b', 'c', 'd', 'e', 'f'], places: [{ file: 'README.md', new: true }], decisions: [] },
				{ id: 'S3', title: 'C', task: 'T1', text: 'x', checks: ['a'], places: [{ file: 'src/none.cpp', lines: [1, 1], code: 'abc' }], decisions: [] },
				{ id: 'S4', title: 'D', task: 'T1', text: 'x', checks: ['a'], places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'while (true)' }], decisions: [] },
			],
		}, context(), order, survey);
		assert.deepStrictEqual(bad.problems, [
			'Step 1: H9 is not a hook of the survey.',
			'Step 1: give 1 to 5 "checks": what the user checks after the step.',
			'Step 1: give 1 to 8 "places".',
			'Step 2: the id s1 is there already. Each id must be different.',
			'Step 2: the task T7 is not in the plan of the order. Call get_order for the tasks of the plan.',
			'Step 2: give a maximum of 5 checks, each with a maximum of 300 characters.',
			'Step 2, place 1: the file README.md is there already. Give its "lines" and "code", or a different name for a new file.',
			'Step 3, place 1: the file src/none.cpp is not there. For a new file, give "new": true and no lines.',
			'Step 4, place 1: the code "while (true)" is not in the lines 5 to 7 of src/solver.cpp. Read the file again, and give the correct lines.',
			'The step S3 is for task 1 of the order, but it comes after a step for task 2. Give the steps in the sequence of the order.',
			'The step S4 is for task 1 of the order, but it comes after a step for task 2. Give the steps in the sequence of the order.',
		]);
		assert.deepStrictEqual(checkPlan({ steps: [] }, context(), order, survey).problems, [
			'Give 1 step or more in "steps".',
			'The task T1 "A cycle limit" has no step. Each task of the plan needs 1 step or more.',
			'The task T2 "A note in the README" has no step. Each task of the plan needs 1 step or more.',
		]);
	});

	test('submit_plan gives each step the level of the rules from the facts of DataFlow', async () => {
		await assert.rejects(call('submit_plan', PLAN), /No task is active/);
		store.newTask('A cycle limit for the solver');
		await assert.rejects(call('submit_plan', PLAN), /The plan is only for stage 4\. The plan starts in stage 4/);
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		store.acceptOrder();
		const result = await call('submit_plan', PLAN);
		// S1: the hot function solve(). S2: a new file. S3: a file that is not C or C++
		assert.deepStrictEqual(levels(), [4, 1, 2]);
		assert.deepStrictEqual((result.steps as { writer: string }[]).map((s) => s.writer), ['user', 'claude', 'claude']);
		assert.match(String(result.next), /Accept the plan/);
		const risk = parseRisk(readFileSync(path.join(root, '.shotgun', id, 'risk.json'), 'utf8'), id);
		assert.deepStrictEqual(risk.steps.S1.reasons, ['A change of a hot function, solve: level 4.']);
		assert.deepStrictEqual([risk.steps.S1.places[0].heat?.function, risk.steps.S1.places[0].heat?.score], ['solve', 64]);
		assert.strictEqual(parsePlan(readFileSync(path.join(root, '.shotgun', id, 'plan.json'), 'utf8'), id).steps.length, 3);
		assert.strictEqual(decisionText(store.snapshot.decisions[store.snapshot.decisions.length - 1]), 'Claude gave the plan: 3 steps.');
		// a worker thread at the line: 1 level more
		await call('submit_plan', PLAN, fakeEngine([], { place: async (file, line) => ({ ...placeFacts(file, line), threads: [{ label: 'worker', via: 'std::thread', file, line: 1 }] }) }));
		assert.deepStrictEqual(levels(), [5, 1, 2]);
		// while the scan of the call graph runs, a function with an incomplete reach has no level
		let scans = 0;
		const scanning = fakeEngine([], { callGraph: async () => ({ state: 'scanning' }), scan: () => scans++ });
		const waiting = await call('submit_plan', PLAN, scanning);
		assert.deepStrictEqual(levels(), [null, 1, 2]);
		assert.match(String(waiting.next), /The steps S1 have no level yet/);
		// with no scan, Shotgun starts the scan
		await call('submit_plan', PLAN, fakeEngine([], { callGraph: async () => ({ state: 'none' }), scan: () => scans++ }));
		assert.strictEqual(scans, 1);
		const data = tool('get_plan').call({}) as { steps: { id: string; level: number | null; checks: string[] }[]; waiting: string[] };
		assert.deepStrictEqual([data.waiting, data.steps[0].checks], [['S1'], ['The project builds.']]);
	});

	test('The facts of a place: a type with a hot user, and a line in the main loop', async () => {
		const typeHeat = async (file: string): Promise<HeatFacts> => ({
			file, isReachComplete: true, notices: [], functions: [],
			types: [{
				name: 'Plan', kind: 'struct', lines: [1, 2], isReachComplete: true,
				members: [{ name: 'steps', line: 1, type: 'int', users: [{ function: 'solve', file: 'src/solver.cpp', line: 6, isWrite: true }] }],
			}],
		});
		const veryHot = async (file: string): Promise<HeatFacts> => {
			const h = heatFacts(file, true);
			return { ...h, functions: [{ ...h.functions[1], score: 80, band: 'very hot' }] };
		};
		const type = await placeRisk(fakeEngine([], { heat: typeHeat, functionHeat: veryHot }), root,
			{ file: 'src/solver.cpp', lines: [1, 1], code: '#include', codeLine: 1 });
		assert.deepStrictEqual(type, {
			kind: 'type', type: { name: 'Plan', isHot: false, changed: ['steps'], hottestUser: { function: 'solve', score: 80, band: 'very hot' } },
		});
		assert.strictEqual(placeLevel(type, 'ready').level, 5);
		// with insert, the step adds a member next to the line and changes no member, so the hot user does not apply (P26)
		const inserted = await placeRisk(fakeEngine([], { heat: typeHeat, functionHeat: veryHot }), root,
			{ file: 'src/solver.cpp', lines: [1, 1], code: '#include', codeLine: 1, insert: true });
		assert.deepStrictEqual(inserted, { kind: 'type', type: { name: 'Plan', isHot: false, isNew: true, changed: [] } });
		assert.deepStrictEqual(placeLevel(inserted, 'ready'), {
			level: 2, reasons: ['The step adds a data member to the type Plan, with no frame path and no shared data: level 2.'],
		});
		const coolHeat = async (file: string): Promise<HeatFacts> => {
			const h = heatFacts(file, true);
			return { ...h, functions: [h.functions[0]] };
		};
		const inLoop = await placeRisk(fakeEngine([], {
			heat: coolHeat,
			place: async (file, line) => ({ ...placeFacts(file, line), function: { name: 'main', lines: [1, 9] }, around: [{ kind: 'while', lines: [2, 8], isOpenLoop: true, isMainLoop: true }] }),
		}), root, { file: 'src/solver.cpp', lines: [5, 7], code: 'for', codeLine: 5 });
		assert.deepStrictEqual([inLoop.kind, inLoop.mainLoop, placeLevel(inLoop, 'ready').level], ['function', 'main', 4]);
		const failed = await placeRisk(fakeEngine([], {
			place: async () => {
				throw new Error('The engine is not ready.');
			},
			heat: async () => {
				throw new Error('The engine is not ready.');
			},
		}), root, { file: 'src/solver.cpp', lines: [5, 7] });
		assert.deepStrictEqual([failed.kind, placeLevel(failed, 'ready').level], ['unknown', null]);
		assert.deepStrictEqual(await placeRisk(undefined, root, { file: 'src/solver.cpp', lines: [5, 7] }), {
			kind: 'unknown', reason: 'Shotgun has no link to DataFlow, so the place has no facts. The level comes with the link.',
		});
	});

	test('The open decisions: the checks, the level from the heat and the decisions, and the answers and the decisions of the user', async () => {
		await planStage();
		// the checks of the decisions and of insert (P26, P27)
		const bad = checkPlan({
			steps: [
				{ ...PLAN.steps[0], decisions: undefined },
				{ ...PLAN.steps[1], decisions: [{ question: '' }, { question: 'A?' }, { question: 'a?' }] },
				{
					...PLAN.steps[1], id: 'S3', title: 'Another test', places: [{ file: 'tests/other_test.cpp', new: true }],
					decisions: [{ question: 'A?', options: ['x'.repeat(121)] }, { question: 'B?' }, { question: 'C?' }, { question: 'D?' }],
				},
				{
					...PLAN.steps[2], id: 'S4', decisions: [],
					places: [{ file: 'tests/x.cpp', new: true, insert: true }, { file: 'README.md', lines: [3, 3], code: 'It has no limit.', insert: 'yes' }],
				},
			],
		}, context(), store.order, store.snapshot.survey!);
		assert.deepStrictEqual(bad.problems, [
			'Step 1: give "decisions": the open decisions of the step, 0 to 3. An open decision is a choice that the brief, the answers of the user and the '
				+ 'order do not settle. Give an empty list for a step with no open decision.',
			'Step 2, decision 1: give a "question" of 1 to 200 characters.',
			'Step 2, decision 3: the step has the question "a?" 2 times.',
			'Step 3: give a maximum of 3 "decisions". Split a step with more decisions into 2 steps.',
			'Step 3, decision 1: give 0 to 4 "options", each with a maximum of 120 characters.',
			'Step 4, place 1: a new file has no "insert". Give "insert": true only for lines of a file that is there.',
			'Step 4, place 2: "insert" is true or false.',
		]);
		const s1 = () => store.snapshot.plan!.steps[0];
		const level = () => levelOf(s1(), store.snapshot.risk, store.snapshot.levels);
		// an open decision keeps the level of the heat. With no open decision, the level is at most 2 (decision 31)
		await call('submit_plan', PLAN);
		assert.deepStrictEqual(level(), { level: 4, rule: 4, heat: 4, isCapped: false });
		store.answerDecision('S1', 'D1', '  Keep   it, and log it. ');
		assert.deepStrictEqual(level(), { level: 2, rule: 2, heat: 4, isCapped: true });
		assert.deepStrictEqual(levelReasons(s1(), store.snapshot.risk, store.snapshot.levels), [
			'A change of a hot function, solve: level 4.', 'The step has no open decision, so its level is at most 2. The heat gave level 4.',
		]);
		// a decision of the user is open, so the step has the level of the heat again
		store.addDecision('S1', 'Does the log line name the limit?');
		assert.strictEqual(level().level, 4);
		assert.throws(() => store.addDecision('S1', 'does the log line name the limit?'), /has the decision "does the log line name the limit\?" already/);
		assert.throws(() => store.removeDecision('S1', 'D1'), /Only a decision that you added can go/);
		assert.throws(() => store.answerDecision('S1', 'D9', 'x'), /Step S1 has no decision D9/);
		assert.throws(() => store.answerDecision('S1', 'D1', 'x'.repeat(501)), /maximum of 500 characters/);
		store.removeDecision('S1', 'U1');
		assert.strictEqual(level().level, 2);
		store.answerDecision('S1', 'D1', '');
		assert.strictEqual(level().level, 4);
		// a level of the user comes first (decision 9)
		store.setLevel('S1', 3);
		store.answerDecision('S1', 'D1', 'Drop it.');
		assert.deepStrictEqual(level(), { level: 3, rule: 2, heat: 4, isCapped: true, user: 3 });
		const file = parseLevels(readFileSync(path.join(root, '.shotgun', id, 'levels.json'), 'utf8'), id);
		assert.deepStrictEqual([file.levels.S1.level, file.levels.S1.answers?.D1.text, file.levels.S1.added], [3, 'Drop it.', undefined]);
		assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind === 'decision').map((d) => decisionText(d)), [
			'You answered the decision "What happens to the partial result at the limit?" of step S1: "Keep it, and log it.".',
			'You added the decision "Does the log line name the limit?" to step S1.',
			'You removed your decision "Does the log line name the limit?" from step S1.',
			'You opened the decision "What happens to the partial result at the limit?" of step S1 again.',
			'You answered the decision "What happens to the partial result at the limit?" of step S1: "Drop it.".',
		]);
		const got = tool('get_plan').call({}) as { steps: { decisions?: unknown[] }[] };
		assert.deepStrictEqual(got.steps[0].decisions, [{ id: 'D1', question: 'What happens to the partial result at the limit?', options: ['Keep it', 'Drop it'], by: 'claude', answer: 'Drop it.' }]);
		// a new plan with a different question: the old answer does not apply
		await call('submit_plan', { steps: [{ ...PLAN.steps[0], decisions: [{ question: 'Where does the loop stop?' }] }, PLAN.steps[1], PLAN.steps[2]] });
		store.setLevel('S1', undefined);
		assert.deepStrictEqual(decisionsOf(s1(), store.snapshot.levels), [{ id: 'D1', question: 'Where does the loop stop?', by: 'claude' }]);
		assert.deepStrictEqual(level(), { level: 4, rule: 4, heat: 4, isCapped: false });
		const view = model().task!.plan!;
		assert.deepStrictEqual(view.steps.map((s) => [s.level, s.isCapped, s.decisions?.length]), [[4, false, 1], [1, false, 0], [2, false, 0]]);
		assert.deepStrictEqual([view.maxQuestion, view.maxAnswer, view.maxUserDecisions], [200, 500, 3]);
		// a step with no field decisions, for example of a plan of version 0.1.0, has the level of the heat only (P34)
		assert.deepStrictEqual(levelOf({ ...s1(), decisions: undefined }, store.snapshot.risk, undefined), { level: 4, rule: 4, heat: 4, isCapped: false });
		// level 5 stays a step of the user, also with no open decision (decision 33)
		const veryHot = async (f: string): Promise<HeatFacts> => {
			const h = heatFacts(f, true);
			return { ...h, functions: [{ ...h.functions[1], score: 80, band: 'very hot' }] };
		};
		await call('submit_plan', { steps: [{ ...PLAN.steps[0], decisions: [] }, PLAN.steps[1], PLAN.steps[2]] }, fakeEngine([], { heat: veryHot }));
		assert.deepStrictEqual(level(), { level: 5, rule: 5, heat: 5, isCapped: false });
		// the messages of the page
		assert.strictEqual(isFromView({ type: 'answerDecision', step: 'S1', decision: 'D1', text: 'x' }), true);
		assert.strictEqual(isFromView({ type: 'addDecision', step: 'S1', question: 'x' }), true);
		assert.strictEqual(isFromView({ type: 'removeDecision', step: 'S1', decision: 'U1' }), true);
		assert.strictEqual(isFromView({ type: 'answerDecision', step: 'S1', decision: 'D1' }), false);
	});

	test('The levels and the notes of the user go into levels.json and the ledger, and stay with their steps', async () => {
		await planStage();
		await call('submit_plan', PLAN);
		assert.throws(() => store.setLevel('S9', 3), /The plan has no step S9/);
		store.setLevel('S1', 3);
		store.setLevel('S1', 3); // no change, so no decision
		store.setLevelNote('S1', '  The default is in  my brief. ');
		store.setLevel('S2', 2);
		store.setLevel('S2', undefined);
		assert.throws(() => store.setLevelNote('S1', 'x'.repeat(501)), /maximum of 500 characters/);
		assert.deepStrictEqual(levels(), [3, 1, 2]);
		assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind === 'level' || d.kind === 'level-note').map((d) => decisionText(d)), [
			'You set step S1 to level 3. The rules gave 4.',
			'Your note for step S1: "The default is in my brief.".',
			'You set step S2 to level 2. The rules gave 1.',
			'You set step S2 back to the level of the rules, 1.',
		]);
		const file = parseLevels(readFileSync(path.join(root, '.shotgun', id, 'levels.json'), 'utf8'), id);
		assert.deepStrictEqual(Object.keys(file.levels), ['S1']);
		assert.deepStrictEqual([file.levels.S1.level, file.levels.S1.note], [3, 'The default is in my brief.']);
		// a new plan with the same id keeps the level of the user
		await call('submit_plan', { steps: [PLAN.steps[0], PLAN.steps[2]] });
		assert.deepStrictEqual(levels(), [3, 2]);
		// after the gate, a level changes only for a step that Claude did not start (decision 17)
		store.acceptPlan();
		assert.strictEqual(store.snapshot.task?.stage, 'build');
		store.setLevel('S1', 4);
		assert.deepStrictEqual(levels(), [4, 2]);
		store.passGate('task-done');
		assert.throws(() => store.setLevel('S1', 3), /only in stage 4, the plan, and in stage 5, the build/);
		await assert.rejects(call('submit_plan', PLAN), /The user accepted the plan already/);
		await assert.rejects(call('submit_task_survey', { task: 'T1', text: 'A cycle limit', hooks: ['H1'], needs: [] }), /The user accepted the plan already/);
	});

	test('A task with no survey gets its survey in stage 4, before the plan', async () => {
		store.newTask('A cycle limit for the solver');
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		store.editOrder({ action: 'add', text: 'Write the limit to the log' });
		store.acceptOrder();
		const plan = { steps: [...PLAN.steps, { ...PLAN.steps[1], id: 'S4', title: 'The log line', task: 'N1', places: [{ file: 'tests/log_test.cpp', new: true }] }] };
		await assert.rejects(call('submit_plan', plan), /The task N1 "Write the limit to the log" has no survey for its text\. Call submit_task_survey for it first\./);
		await call('submit_task_survey', { task: 'N1', text: 'Write the limit to the log', hooks: ['H1'], needs: ['T1'] });
		await call('submit_plan', plan);
		assert.deepStrictEqual(levels(), [4, 1, 2, 1]);
	});

	test('The plan page: the levels, the writers, the changed levels and the gate', async () => {
		await planStage();
		await call('submit_plan', PLAN, fakeEngine([], { callGraph: async () => ({ state: 'scanning' }) }));
		let view = model().task!.plan!;
		assert.deepStrictEqual(view.steps.map((s) => [s.n, s.id, s.level, s.levelName, s.writer]), [
			[1, 'S1', null, 'No level yet', undefined],
			[2, 'S2', 1, 'Very low, level 1 of 5', 'claude'],
			[3, 'S3', 2, 'Low, level 2 of 5', 'claude'],
		]);
		assert.deepStrictEqual([view.waiting, view.writers, view.isEditable], [1, { user: 0, frame: 0, claude: 2, none: 1 }, true]);
		assert.deepStrictEqual(view.steps[0].places[0], {
			name: 'src/solver.cpp:5-7', path: solver(), line: 5, isNew: false, isMoved: false, isLost: false, level: null,
			excerpt: view.steps[0].places[0].excerpt,
		});
		assert.deepStrictEqual(view.steps[1].places[0].name, 'tests/limit_test.cpp (new)');
		assert.deepStrictEqual(model().task!.gate, {
			label: 'Accept the plan',
			note: 'Your gate. After it, the build starts, and the level of each step selects its writer.',
			isEnabled: false,
			reason: '1 step has no level yet. Wait for the end of the scan of the call graph, or set the level.',
			after: 'Do step 1.',
		});
		// the user sets the level of the step that waits
		store.setLevel('S1', 4);
		view = model().task!.plan!;
		assert.deepStrictEqual([view.steps[0].level, view.steps[0].user, view.steps[0].rule, view.waiting], [4, 4, null, 0]);
		assert.deepStrictEqual(view.changed, [{ step: 'S1', n: 1, level: 4, rule: null, note: '' }]);
		assert.strictEqual(model().task!.gate!.isEnabled, true);
		store.acceptPlan();
		const after = model().task!;
		// in stage 5, the gate is the gate of the current step. The user writes step 1 at level 4, and Shotgun opens it first
		assert.deepStrictEqual([after.stage, after.plan?.isEditable, after.gate?.label, after.gate?.isEnabled, after.build?.current?.writer],
			['build', false, 'The step is done', false, 'user']);
		assert.strictEqual(decisionText(store.snapshot.decisions[store.snapshot.decisions.length - 1]), 'You passed the gate "Accept the plan" of stage 4.');
	});

	test('The text editor shows each place of a step with its level and a CodeLens line', async () => {
		await planStage();
		await call('submit_plan', PLAN);
		const steps = new StepDecorations();
		try {
			steps.update(store.snapshot);
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(solver()));
			assert.deepStrictEqual(steps.placesOf(doc).map((p) => [p.step.id, p.n, p.total, p.level, p.lines]), [['S1', 1, 3, 4, [5, 7]]]);
			// DataFlow can give CodeLens lines for a C++ file too
			const lenses = (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri))
				.filter((l) => l.command?.command === 'shotgun.showStep');
			assert.deepStrictEqual(lenses.map((l) => [l.range.start.line, l.command?.title, l.command?.arguments]), [
				[4, 'Step 1 of 3 · The limit in the loop · risk 4 of 5, high · you write', ['S1']],
			]);
			// a change above the place moves it, with no save
			const edit = new vscode.WorkspaceEdit();
			edit.insert(doc.uri, new vscode.Position(0, 0), '// a\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			assert.deepStrictEqual(steps.placesOf(doc).map((p) => p.lines), [[6, 8]]);
			// after the build, the text editor shows no step
			store.acceptPlan();
			store.passGate('task-done');
			steps.update(store.snapshot);
			assert.deepStrictEqual(steps.placesOf(doc), []);
		} finally {
			steps.dispose();
		}
	});

	test('A webview message for a level must have a correct form', () => {
		assert.ok(isFromView({ type: 'setLevel', step: 'S1', level: 3 }));
		assert.ok(isFromView({ type: 'setLevel', step: 'S1', level: null }));
		assert.ok(isFromView({ type: 'setLevelNote', step: 'S1', note: '' }));
		assert.ok(isFromView({ type: 'checkLevels' }));
		assert.ok(!isFromView({ type: 'setLevel', step: 'S1', level: 6 }));
		assert.ok(!isFromView({ type: 'setLevel', step: 'S1', level: 2.5 }));
		assert.ok(!isFromView({ type: 'setLevel', step: 'S1' }));
		assert.ok(!isFromView({ type: 'setLevelNote', step: 'S1', note: 'x'.repeat(2001) }));
	});
});
