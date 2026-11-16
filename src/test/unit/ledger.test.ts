import * as assert from 'assert';
import { rmSync } from 'fs';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import type { DiffFacts, MemberSitesFacts, OutlineMemberFacts, RippleFacts } from '../../dataflow/dataflow-api';
import type { CommitMessage } from '../../git/message';
import { buildNext, BuildFile, StepState } from '../../session/build';
import { readText } from '../../session/files';
import { ledgerMarkdown, ledgerRows, parseMessageCheck, sameMessage } from '../../session/ledger';
import { LineStore } from '../../session/lines';
import {
	addLooseEnds, claudeEnds, EMPTY_LOOSE, LooseFind, looseIndex, looseStep, memberEnds, newMembers, nextLooseStepId, parseLoose, rippleEnds, shortName,
	switchEnds,
} from '../../session/loose';
import { levelOf, PlanStep } from '../../session/plan';
import { SessionStore } from '../../session/store';
import { addedLines, declarationHunks, findLooseEnds, LooseApi, typeHeadLine } from '../../tools/loose';
import { PromptLog } from '../../tools/prompts';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, noBuild, SURVEY } from './fixture';

// Phase 9: the loose ends of the steps, the hand of a loose end to Claude, the ledger, and the check of the commit message

const PLAN = {
	steps: [
		{
			id: 'S1', title: 'The limit in the loop', task: 'T1', hooks: ['H1'], text: 'Stop the loop at the limit.', checks: ['The project builds.'],
			places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)' }], decisions: [],
		},
		{
			id: 'S2', title: 'A test of the limit', task: 'T1', hooks: [], text: 'A test for the limit.', checks: ['The test passes.'],
			places: [{ file: 'tests/limit_test.cpp', new: true }], decisions: [],
		},
		{
			id: 'S3', title: 'The note in the README', task: 'T2', hooks: ['H2'], text: 'Write the limit in the README.', checks: ['The README tells the limit.'],
			places: [{ file: 'README.md', lines: [3, 3], code: 'It has no limit.' }], decisions: [],
		},
	],
};

// The member sites of a struct with the new member solver_cycle_limit. load_settings uses most members, but not the new one
const sitesOf = (root: string): MemberSitesFacts => ({
	type: 'OperationalSettings', kind: 'struct', file: path.join(root, 'include', 'types.hpp'), line: 10, isReachComplete: true,
	members: ['meter_hold_time', 'reading_count_limit', 'solver_cycle_limit'],
	functions: [
		{ function: 'load_settings', file: path.join(root, 'src', 'settings_io.cpp'), lines: [38, 45], uses: ['meter_hold_time', 'reading_count_limit'], writes: [], part: 0.67 },
		{ function: 'save_settings', file: path.join(root, 'src', 'settings_io.cpp'), lines: [48, 53], uses: ['meter_hold_time', 'reading_count_limit', 'solver_cycle_limit'], writes: [], part: 1 },
		{ function: 'describe', file: path.join(root, 'src', 'settings_io.cpp'), lines: [56, 60], uses: ['meter_hold_time'], writes: [], part: 0.33 },
	],
});

// The header of the struct after the change: the lines 11 to 14 are new
const TYPES = [
	'#pragma once',
	'',
	'namespace battery {',
	'',
	'enum class Mode { AUTO, MANUAL };',
	'',
	'// the settings of the controller { with a brace in a comment',
	'struct OperationalSettings {',
	'  double meter_hold_time = 500.0;',
	'  int reading_count_limit = 10;',
	'  // the limit of the cycles',
	'  int solver_cycle_limit = 8;',
	'  static constexpr int max_solver_cycle_limit = 100;',
	'  int clamped_limit() const { return solver_cycle_limit; }',
	'};',
	'',
	'}  // namespace battery',
];

// The outline of the struct after the change: the new member solver_cycle_limit on line 12, a new static member and a
// new inline function
const OUTLINE: OutlineMemberFacts[] = [
	{ line: 9, kind: 'field', name: 'meter_hold_time' },
	{ line: 10, kind: 'field', name: 'reading_count_limit' },
	{ line: 12, kind: 'field', name: 'solver_cycle_limit' },
	{ line: 13, kind: 'field', name: 'max_solver_cycle_limit', marks: ['static', 'constexpr'] },
	{ line: 14, kind: 'method', name: 'clamped_limit', marks: ['const'] },
];

// The ripple of a change of solve(): main() gets its result
const rippleOf = (root: string): RippleFacts => ({
	state: 'ready',
	changes: [{
		file: path.join(root, 'src', 'solver.cpp'), function: 'solve', lines: [6],
		bodies: [
			{ file: path.join(root, 'src', 'solver.cpp'), function: 'solve', depth: 0, lines: [6], steps: [], exits: [] },
			{
				file: path.join(root, 'src', 'main.cpp'), function: 'main', depth: 1, call: { file: path.join(root, 'src', 'main.cpp'), line: 10 }, lines: [10, 11],
				steps: [{ line: 10, kind: 'data', confidence: 'exact', distance: 1, text: 'int result = solve(plan);' }], exits: [],
			},
		],
	}],
});

suite('Loose ends and ledger', () => {
	let root: string;
	let store: SessionStore;
	let message: CommitMessage | undefined;
	const lines = new LineStore();
	const tools = () => shotgunTools({
		store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => fakeEngine(),
		...noBuild(), message: () => message,
	});
	const call = async (name: string, args: Record<string, unknown> = {}) => (await tools().find((t) => t.name === name)!.call(args)) as Record<string, unknown>;
	const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
	const model = (commit?: { text: string }, ledgerLines: Parameters<typeof buildModel>[0]['ledgerLines'] = []) => buildModel({
		version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.1', engine: 'ready' }, claude: connected,
		readLines: (f) => readText(f)?.split(/\r?\n/), ledgerLines, ...(commit ? { commit } : {}),
	});
	// the task of the fixture in stage 5: S1 and S2 are steps of Claude, S3 is a step of the user
	const buildStage = async () => {
		store.newTask('A cycle limit for the solver');
		store.passGate('brief-ready');
		await call('submit_survey', SURVEY);
		store.passGate('order-tasks');
		store.acceptOrder();
		await call('submit_plan', PLAN);
		store.setLevel('S1', 2);
		store.setLevel('S2', 1);
		store.setLevel('S3', 4);
		store.acceptPlan();
	};
	const finishErrand = (step: string) => {
		store.startStep(step, { writer: 'claude', level: 2, scope: [] });
		store.writeReceipt(step, { time: '', round: 1, changes: [], denies: [], outside: [], deleted: [], looseEnds: [] });
		store.finishStep(step, 'accept-receipt');
	};

	setup(() => {
		root = makeProject('shotgun-ledger-');
		store = new SessionStore(root);
		message = { message: 'Add the cycle limit\n\nThe solver stops after 8 cycles.', repository: root, files: [{ file: 'src/solver.cpp', status: 'modified' }] };
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The facts of DataFlow: a function that does not use a new member, a switch with no case for a new enumerator, and a caller that a change reaches', () => {
		const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
		// a new member has its declaration on an added line. A static member does not count, and a new type has no new members
		assert.deepStrictEqual(newMembers(OUTLINE, [11, 12, 13, 14]), { fields: ['solver_cycle_limit'], enumerators: [] });
		assert.deepStrictEqual(newMembers(OUTLINE, [9, 10, 11, 12, 13, 14]), { fields: [], enumerators: [] });
		const modes: OutlineMemberFacts[] = ['AUTO', 'MANUAL', 'BOOST'].map((name, i) => ({ line: 5 + i, kind: 'enumerator', name }));
		assert.deepStrictEqual(newMembers(modes, [7]), { fields: [], enumerators: ['BOOST'] });
		assert.deepStrictEqual(memberEnds(sitesOf(root), 'solver_cycle_limit', rel).map((e) => [e.kind, e.source, e.title, e.file, e.lines]),
			[['mechanical', 'members', 'load_settings does not use solver_cycle_limit', 'src/settings_io.cpp', [38, 45]]]);
		assert.match(memberEnds(sitesOf(root), 'solver_cycle_limit', rel)[0].proof[0], /load_settings uses 2 of 3 data members of OperationalSettings, but not the new member/);
		// the title has the short name of the function, and the proof has the qualified name
		const sites = sitesOf(root);
		const qualified = memberEnds({ ...sites, functions: [{ ...sites.functions![0], function: 'battery::io::load_settings' }] }, 'solver_cycle_limit', rel)[0];
		assert.deepStrictEqual([qualified.title, qualified.proof[0].startsWith('battery::io::load_settings uses 2 of 3')], ['load_settings does not use solver_cycle_limit', true]);
		assert.deepStrictEqual(['a::b::c', 'main', 'Foo<A::B>::bar'].map(shortName), ['c', 'main', 'bar']);
		const enumSites: MemberSitesFacts = {
			type: 'Mode', kind: 'enum class', file: path.join(root, 'include', 'types.hpp'), line: 5, isReachComplete: true, enumerators: ['AUTO', 'MANUAL', 'BOOST'],
			switches: [
				{ function: 'mode_name', file: path.join(root, 'src', 'modes.cpp'), line: 12, missing: ['BOOST'], hasDefault: false },
				{ function: 'apply', file: path.join(root, 'src', 'modes.cpp'), line: 30, missing: [], hasDefault: true },
			],
		};
		assert.deepStrictEqual(switchEnds(enumSites, 'BOOST', rel).map((e) => [e.title, e.file, e.lines, e.proof[0].endsWith('It has no default case.')]),
			[['The switch in mode_name does not handle BOOST', 'src/modes.cpp', [12, 12], true]]);
		assert.deepStrictEqual(rippleEnds(rippleOf(root), rel, () => false).map((e) => [e.kind, e.source, e.title, e.file, e.lines]),
			[['decision', 'ripple', 'The change of solve reaches main', 'src/main.cpp', [10, 10]]]);
		// a caller in the changed lines of the step is no loose end
		assert.deepStrictEqual(rippleEnds(rippleOf(root), rel, (f, l) => f === 'src/main.cpp' && l === 10), []);
		assert.deepStrictEqual(claudeEnds([{ text: 'save_settings() does not write the new limit. Add it.', file: 'src/settings_io.cpp', lines: [50, 55] }, { text: 'Check the log.' }])
			.map((e) => [e.title, e.source, e.kind, e.file]), [['save_settings() does not write the new limit.', 'claude', 'mechanical', 'src/settings_io.cpp'],
			['Check the log.', 'claude', 'mechanical', undefined]]);
	});

	test('The loose ends of a task: new ids, no copy of an open loose end, the place of the step of a loose end, and the file', () => {
		const find: LooseFind = {
			kind: 'mechanical', source: 'members', title: 'load_settings does not use solver_cycle_limit', proof: ['x'], file: 'src/settings_io.cpp', lines: [38, 45],
		};
		let file = addLooseEnds(EMPTY_LOOSE, 'S2', [find, find], 't');
		assert.deepStrictEqual(file.ends.map((e) => [e.id, e.step, e.state]), [['E1', 'S2', 'open']]);
		file = addLooseEnds(file, 'S3', [find, { ...find, title: 'describe does not use solver_cycle_limit' }], 't');
		assert.deepStrictEqual([file.ends.map((e) => e.id), file.checked, file.nextId], [['E1', 'E2'], ['S2', 'S3'], 3]);
		assert.deepStrictEqual(parseLoose(JSON.stringify(file), 'x'), file);
		assert.throws(() => parseLoose('{"version":1,"ends":[{}],"checked":[],"nextId":1}', 'x'), /needs the fields version, ends, checked and nextId/);
		// decision 21: after the open step, or before the next step that nobody started, and after the loose ends that wait there
		const steps = [{ id: 'S1' }, { id: 'S2' }, { id: 'L1', looseEnd: 'E1' }, { id: 'S3' }] as unknown as PlanStep[];
		const states: Record<string, StepState> = { S1: 'done', S2: 'open' };
		const stateOf = (id: string) => states[id] ?? 'todo';
		assert.strictEqual(looseIndex(steps, stateOf), 3);
		states.S2 = 'done';
		assert.strictEqual(looseIndex(steps, stateOf), 3);
		assert.strictEqual(looseIndex(steps.filter((s) => s.id !== 'L1'), stateOf), 2);
		assert.strictEqual(looseIndex(steps, () => 'done'), 4);
		assert.strictEqual(nextLooseStepId(steps), 'L2');
		const step = looseStep({ ...file.ends[0], code: 'OperationalSettings load_settings(const KeyValueStore &store) {' }, 'L2', 'T1');
		assert.deepStrictEqual([step.places, step.looseEnd, step.task, step.hooks], [
			[{ file: 'src/settings_io.cpp', lines: [38, 45], code: 'OperationalSettings load_settings(const KeyValueStore &store) {', codeLine: 38 }], 'E1', 'T1', [],
		]);
		assert.throws(() => looseStep({ ...file.ends[0], file: undefined }, 'L3', 'T1'), /The loose end E1 has no place/);
	});

	test('The head of the type around a line: a line with the name of the type, for DataFlow', () => {
		// the members and the inline function are in the struct. A brace in a comment does not count
		assert.deepStrictEqual([12, 13, 14, 15].map((l) => typeHeadLine(TYPES, l)), [8, 8, 8, 8]);
		// a line in the namespace, and a line in a function, are in no type
		assert.deepStrictEqual([16, 17].map((l) => typeHeadLine(TYPES, l)), [undefined, undefined]);
		const solver = readText(path.join(root, 'src', 'solver.cpp'))!.split(/\r?\n/);
		assert.strictEqual(typeHeadLine(solver, 6), undefined);
		// a head on more than 1 line, an enum with a base, a template, and a string with a brace
		const text = [
			'template <class T>',
			'class ENGINE_API Controller',
			'    : public Base<T>',
			'{',
			'  const char* open_ = "{";',
			'  enum class Kind : int {',
			'    FAST,',
			'  };',
			'  int count_ = 0;',
			'};',
			'template <class T>',
			'void run(T value)',
			'{',
			'  int a = 0;',
			'}',
		];
		assert.deepStrictEqual([5, 7, 9, 14].map((l) => typeHeadLine(text, l)), [2, 6, 2, undefined]);
	});

	test('At the gate: the added lines of a hunk, the hunks with declarations, and the loose ends of a step from DataFlow', async () => {
		// the hunk in the struct has the new member, a static member and a new inline function. The hunk in solve() is in the
		// body of an old function, so it comes last
		const diff: DiffFacts = {
			root, base: 'mark:x', suggestedSteps: [],
			files: [
				{ file: 'src/solver.cpp', lines: 9, hunks: [{ id: 'h2', lines: [6, 6], added: 1, removed: 0, functions: ['solve'], diff: '+    6 |         check();' }] },
				{
					file: 'include/types.hpp', lines: 20,
					hunks: [{
						id: 'h1', lines: [11, 14], added: 4, removed: 0, functions: ['OperationalSettings::clamped_limit'], newFunctions: ['OperationalSettings::clamped_limit'],
						diff: ['   10 |   int reading_count_limit = 10;', '+   11 |   // the limit of the cycles', '+   12 |   int solver_cycle_limit = 8;',
							'+   13 |   static constexpr int max_solver_cycle_limit = 100;', '+   14 |   int clamped_limit() const { return solver_cycle_limit; }'].join('\n'),
					}],
				},
				{ file: 'README.md', lines: 3, isCpp: false, hunks: [{ id: 'h3', lines: [3, 3], added: 1, removed: 1, diff: '+    3 | The limit is 8.' }] },
			],
		};
		assert.deepStrictEqual(addedLines(diff.files[1].hunks[0].diff).slice(0, 2), [{ line: 11, text: '  // the limit of the cycles' }, { line: 12, text: '  int solver_cycle_limit = 8;' }]);
		assert.deepStrictEqual(declarationHunks(diff, root), [{ file: 'include/types.hpp', lines: [11, 12, 13, 14] }, { file: 'src/solver.cpp', lines: [6] }]);
		const asked: string[] = [];
		const api: LooseApi = {
			scan: async () => {
				asked.push('scan');
				return true;
			},
			outline: async (file, line) => {
				asked.push(`outline ${path.basename(file)}:${line}`);
				if (path.basename(file) !== 'types.hpp') {
					throw new Error('No type at the line.');
				}
				return { type: 'OperationalSettings', members: OUTLINE };
			},
			memberSites: async (file, line) => {
				asked.push(`sites ${path.basename(file)}:${line}`);
				return sitesOf(root);
			},
			ripple: async (base, paths) => {
				asked.push(`ripple ${base} ${paths.length}`);
				return rippleOf(root);
			},
		};
		// the text of the header, and the file solver.cpp of the project
		const readLines = (f: string) => (path.basename(f) === 'types.hpp' ? TYPES : readText(f)?.split(/\r?\n/));
		const logs: string[] = [];
		const finds = await findLooseEnds(api, root, 'sg.x.S2', ['include/types.hpp', 'src/solver.cpp'], diff, readLines, (m) => logs.push(m));
		// a new scan of the call graph comes first. DataFlow gets the line of the head of the struct. The hunk in solve() is in
		// no type, so DataFlow gets no question about it
		assert.deepStrictEqual(asked, ['scan', 'outline types.hpp:8', 'sites types.hpp:8', 'ripple mark:sg.x.S2 2']);
		assert.deepStrictEqual(finds.map((f) => [f.source, f.title]), [['members', 'load_settings does not use solver_cycle_limit'], ['ripple', 'The change of solve reaches main']]);
		assert.deepStrictEqual(logs, []);
		// a failure of DataFlow goes to the log, and the gate gets no loose ends of the failure
		const failing: LooseApi = {
			scan: async () => true,
			outline: async () => ({ type: 'OperationalSettings', members: OUTLINE }),
			memberSites: async () => {
				throw new Error('The file is not parsed yet.');
			},
			ripple: async () => ({ state: 'failed', message: 'The base mark:sg.x.S2 is not there.' }),
		};
		const noOutline: LooseApi = {
			...failing,
			outline: async () => {
				throw new Error('No class, struct, union or enum on line 8 of types.hpp.');
			},
		};
		// with an old index of the call graph, the member sites can give false loose ends, so Shotgun does not ask for them
		const noScan: LooseApi = { ...failing, scan: async () => false };
		const scanError: LooseApi = {
			...failing,
			scan: async () => {
				throw new Error('The DataFlow engine is not ready.');
			},
		};
		const failLogs: string[] = [];
		for (const x of [failing, noOutline, noScan, scanError]) {
			assert.deepStrictEqual(await findLooseEnds(x, root, 'sg.x.S2', [], diff, readLines, (m) => failLogs.push(m)), []);
		}
		assert.deepStrictEqual(failLogs, [
			'DataFlow gave no member sites of OperationalSettings: The file is not parsed yet.',
			'DataFlow gave no ripple of the changes: The base mark:sg.x.S2 is not there.',
			'DataFlow gave no outline of the type on line 8 of include/types.hpp: No class, struct, union or enum on line 8 of types.hpp.',
			'DataFlow gave no ripple of the changes: The base mark:sg.x.S2 is not there.',
			'DataFlow did not end the scan of the call graph in time.',
			'Shotgun did not get the member sites of OperationalSettings, because the index of the call graph of DataFlow can be old.',
			'DataFlow gave no ripple of the changes: The base mark:sg.x.S2 is not there.',
			'DataFlow did not scan the call graph: The DataFlow engine is not ready.',
			'Shotgun did not get the member sites of OperationalSettings, because the index of the call graph of DataFlow can be old.',
			'DataFlow gave no ripple of the changes: The base mark:sg.x.S2 is not there.',
		]);
	});

	test('A return from the build to the plan: the open step goes back to todo, and a new plan keeps the steps with the same title (decisions 24 and 25)', async () => {
		await buildStage();
		finishErrand('S1');
		// Claude opened step 2
		store.startStep('S2', { writer: 'claude', level: 1, scope: [], base: 'sg.base.S2' });
		const { task, removed } = store.returnToStage('plan');
		assert.deepStrictEqual([task.stage, task.isDone, task.gates.map((g) => g.gate), removed?.id, removed?.step.base],
			['plan', false, ['brief-ready', 'order-tasks', 'accept-order'], 'S2', 'sg.base.S2']);
		assert.deepStrictEqual(Object.entries(store.snapshot.build!.steps).map(([id, b]) => [id, b.state]), [['S1', 'done']]);
		assert.strictEqual(decisionText(store.snapshot.decisions.at(-1)!),
			'You returned the task from stage 5 to stage 4 of 5, the plan. Step S2 was open, and it went back to todo.');
		// the stage chips of the stages before the plan are returns
		assert.deepStrictEqual(model().stages.map((s) => s.canReturn), [true, true, true, false, false]);
		assert.throws(() => store.returnToStage('build'), /It can return only to an earlier stage/);
		// a new plan with the same title of step 1 keeps its state in the build
		await call('submit_plan', PLAN);
		assert.deepStrictEqual(Object.keys(store.snapshot.build!.steps), ['S1']);
		store.acceptPlan();
		assert.deepStrictEqual([store.snapshot.task!.stage, store.current?.step.id, store.current?.state], ['build', 'S2', 'todo']);
		// a return to the plan, and a plan with a different step 1: the state of step 1 goes away
		store.returnToStage('plan');
		await call('submit_plan', { steps: PLAN.steps.map((x) => (x.id === 'S1' ? { ...x, title: 'A different first step' } : x)) });
		assert.deepStrictEqual(Object.keys(store.snapshot.build?.steps ?? {}), []);
	});

	test('"Hand to Claude": the loose end is the next step of the plan with level 2, and the user tells Claude "Do the loose ends."', async () => {
		await buildStage();
		finishErrand('S1');
		store.addLooseEnds('S1', [
			{ kind: 'mechanical', source: 'members', title: 'solve does not use limit', proof: ['solve uses 3 of 4 data members of Plan.'], file: 'src/solver.cpp', lines: [3, 9] },
			{ kind: 'decision', source: 'ripple', title: 'The change of solve reaches main', proof: ['main gets the result of solve.'], file: 'README.md', lines: [3, 3] },
			{ kind: 'mechanical', source: 'claude', title: 'Check the log.', proof: ['Check the log.'] },
		]);
		const step = store.handLooseEnd('E1');
		assert.deepStrictEqual([step.id, store.snapshot.plan!.steps.map((s) => s.id)], ['L1', ['S1', 'L1', 'S2', 'S3']]);
		assert.strictEqual(levelOf(store.snapshot.plan!.steps.find((s) => s.id === 'L1')!, store.snapshot.risk, store.snapshot.levels).level, 2);
		const current = store.current!;
		assert.deepStrictEqual([current.step.id, current.writer, current.state], ['L1', 'claude', 'todo']);
		assert.strictEqual(buildNext(current).request, 'Do the loose ends.');
		assert.deepStrictEqual(store.snapshot.loose!.ends.map((e) => [e.id, e.state, e.handed]), [['E1', 'handed', 'L1'], ['E2', 'open', undefined], ['E3', 'open', undefined]]);
		assert.throws(() => store.handLooseEnd('E1'), /The loose end E1 is step L1 of Claude already\./);
		assert.throws(() => store.handLooseEnd('E3'), /The loose end E3 has no place, so Claude cannot do it as a step\./);
		assert.throws(() => store.handLooseEnd('E2'), /The loose end E2 is a decision for you, not a step for Claude\./);
		// Claude does the step of the loose end as an errand
		const got = await call('get_step', { step: 'L1' });
		assert.match(JSON.stringify(got), /A loose end of step S1: solve does not use limit/);
		// the user closes a loose end with a reason, and opens it again
		assert.throws(() => store.closeLooseEnd('E2', ' '), /Give a reason of 1 to 500 characters\./);
		store.closeLooseEnd('E2', '  main needs no change. ');
		assert.deepStrictEqual([store.snapshot.loose!.ends[1].state, store.snapshot.loose!.ends[1].reason], ['closed', 'main needs no change.']);
		assert.throws(() => store.closeLooseEnd('E1', 'x'), /The loose end E1 is step L1 of Claude\./);
		store.closeLooseEnd('E2', undefined);
		assert.strictEqual(store.snapshot.loose!.ends[1].state, 'open');
		assert.deepStrictEqual(store.snapshot.decisions.slice(-3).map(decisionText), [
			'You handed the loose end E1 to Claude as step L1: "solve does not use limit".',
			'You closed the loose end E2, "The change of solve reaches main": main needs no change.',
			'You opened the loose end E2 again.',
		]);
		// the panel: the loose ends with the step of Claude, and the request
		const loose = model().task!.build!.loose;
		assert.deepStrictEqual([loose.open, loose.checked, loose.request], [2, 'after step 1', 'Do the loose ends.']);
		assert.match(model().task?.gate?.reason ?? '', /Tell Claude: "Do the loose ends\."/);
		assert.deepStrictEqual(loose.ends.map((e) => [e.id, e.kind, e.state, e.stepN, e.handed?.n, e.place]),
			[['E1', 'mechanical', 'handed', 1, 2, 'src/solver.cpp:3-9'], ['E2', 'decision', 'open', 1, undefined, 'README.md:3'], ['E3', 'mechanical', 'open', 1, undefined, undefined]]);
		assert.deepStrictEqual(['handLooseEnd', 'closeLooseEnd', 'reopenLooseEnd'].map((type) => isFromView({ type, id: 'E1' })), [true, true, true]);
		assert.deepStrictEqual([isFromView({ type: 'showLedger' }), isFromView({ type: 'copyLedger' }), isFromView({ type: 'handLooseEnd', id: 5 })], [true, true, false]);
		// a place in DataFlow (decision 26), and a return to a stage (decision 24)
		assert.deepStrictEqual([
			isFromView({ type: 'showPlace', path: 'a.cpp', lines: [3, 5], note: 'H1 · A hook' }), isFromView({ type: 'showPlace', path: 'a.cpp', lines: [5, 3], note: '' }),
			isFromView({ type: 'showPlace', path: 'a.cpp', lines: [3], note: '' }), isFromView({ type: 'returnToStage', stage: 'brief' }),
			isFromView({ type: 'returnToStage', stage: 'done' }),
		], [true, false, false, true, false]);
	});

	test('The ledger: the lines of each writer, the lines of Claude that the user walked, and the Markdown for a pull request', async () => {
		const build: BuildFile = {
			version: 1,
			steps: {
				S1: {
					state: 'done', writer: 'claude', level: 2, scope: [], round: 1,
					receipt: {
						time: '', round: 1, denies: [], outside: [], deleted: [], looseEnds: [],
						changes: [
							{ id: 'C1', file: 'src/a.cpp', lines: [1, 2], title: 't', check: 'c', added: 2, removed: 0, hunks: [], mark: 'ok' },
							{ id: 'C2', file: 'src/a.cpp', lines: [5, 7], title: 't', check: 'c', added: 3, removed: 0, hunks: [], mark: 'todo' },
						],
					},
				},
			},
		};
		const files = [
			{ file: 'src/a.cpp', runs: [{ writer: 'claude' as const, step: 'S1', change: 'C1', lines: [1, 2] as const }, { writer: 'claude' as const, step: 'S1', change: 'C2', lines: [5, 7] as const }, { writer: 'user' as const, step: 'S2', lines: [9, 9] as const }] },
			{ file: 'src/b.cpp', runs: [{ writer: 'claude' as const, step: 'S3', change: 'frame', lines: [1, 4] as const }, { writer: 'claude' as const, step: 'S3', change: 'H1', lines: [6, 6] as const }] },
			{ file: 'src/c.cpp', runs: [] },
		];
		const rows = ledgerRows(files, build);
		assert.deepStrictEqual(rows, [{ file: 'src/a.cpp', user: 1, walked: 2, notWalked: 3, firstNotWalked: 5, firstNotWalkedLines: [5, 7] }, { file: 'src/b.cpp', user: 0, walked: 5, notWalked: 0 }]);
		const markdown = ledgerMarkdown('A cycle limit', ['You passed the gate "The brief is ready" of stage 1.'], rows);
		assert.match(markdown, /^## A cycle limit\n\n### Decisions of the user\n\n- You passed the gate "The brief is ready" of stage 1\.\n/);
		assert.match(markdown, /The user wrote 1 line\. Claude wrote 10 lines, and the user walked 7 of them\./);
		assert.match(markdown, /\| `src\/a\.cpp` \| 1 \| 2 \| 3 \|/);
		// the ledger page of a task in stage 5. Its step S1 has no receipt, so the user walked only the lines of the frame
		await buildStage();
		const ledger = model(undefined, files).task!.ledger!;
		assert.deepStrictEqual([ledger.user, ledger.walked, ledger.notWalked, ledger.rows.length, ledger.message.hasRepository], [1, 5, 5, 2, false]);
		assert.ok(ledger.decisions.user > 0 && ledger.userDecisions[0].n === 1 && ledger.markdown.includes('### Lines of each writer'));
		assert.strictEqual(sameMessage('Add the limit\r\n\r\nBody ', 'Add the limit\n\nBody'), true);
	});

	test('The check of the commit message: the message and the ledger for Claude, a refused check, the problems, and the points in the panel', async () => {
		await buildStage();
		finishErrand('S1');
		const got = await call('get_commit_message');
		assert.deepStrictEqual([got.message, got.changedFiles, (got.steps as unknown[]).length], [message!.message, [{ file: 'src/solver.cpp', status: 'modified' }], 3]);
		assert.match(String(got.openSteps), /Step 2 and later are not done/);
		assert.ok((got.decisionsOfTheUser as string[]).some((d) => d.includes('The brief is ready')));
		// a check of a different text
		await assert.rejects(call('submit_message_check', { message: 'Other', agrees: true, points: [{ kind: 'ok', text: 'x' }] }),
			/The commit message in Source Control is not the message that you checked\./);
		// all problems in 1 list
		await assert.rejects(call('submit_message_check', { message: message!.message, agrees: true, points: [{ kind: 'missing', text: '' }, { kind: 'maybe', text: 'x', line: 3 }] }),
			(error: Error) => {
				assert.match(error.message, /Point 1: give "text" of 1 to 300 characters\./);
				assert.match(error.message, /Point 2: give "kind": ok, missing, wrong, question\./);
				assert.match(error.message, /Point 2: give the "file" of the line\./);
				assert.match(error.message, /"agrees" must be false when a point has the kind missing or wrong\./);
				return true;
			});
		const out = await call('submit_message_check', {
			message: message!.message.replace(/\n/g, '\r\n'), agrees: false, note: 'Name the new test in the body.',
			points: [{ kind: 'ok', text: 'The first line tells the limit.' }, { kind: 'missing', text: 'The message does not tell the new test.', file: 'tests/limit_test.cpp', line: 1 }],
		});
		assert.deepStrictEqual([out.agrees, out.points], [false, 2]);
		assert.strictEqual(parseMessageCheck(JSON.stringify(store.snapshot.message), 'x').points.length, 2);
		assert.strictEqual(decisionText(store.snapshot.decisions[store.snapshot.decisions.length - 1]),
			'Claude checked the commit message: it does not agree with the diff, with 2 points.');
		// the panel shows the points. After a change of the message, the check is old
		const check = model({ text: message!.message }).task!.ledger!.message.check!;
		assert.deepStrictEqual([check.agrees, check.isOld, check.points.map((p) => [p.kind, p.place]), check.note],
			[false, false, [['ok', undefined], ['missing', 'tests/limit_test.cpp:1']], 'Name the new test in the body.']);
		assert.strictEqual(model({ text: 'Add the cycle limit and its test' }).task!.ledger!.message.check!.isOld, true);
		// no message, and no repository
		message = { ...message!, message: '  ' };
		await assert.rejects(call('get_commit_message'), /The input box of Source Control has no commit message\./);
		message = undefined;
		await assert.rejects(call('get_commit_message'), /Shotgun found no repository of git for the project in Source Control\./);
		// the lines of the writers are in the result too
		assert.strictEqual(lines.paths.length, 0);
	});
});
