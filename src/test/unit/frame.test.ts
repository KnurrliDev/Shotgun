import * as assert from 'assert';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import type { DiffFacts } from '../../dataflow/dataflow-api';
import { buildGuard, buildNext, buildWriterOf } from '../../session/build';
import { readText } from '../../session/files';
import { anchorOf, answerText, checkFrame, findMarkers, holeNow, isObviousAnswer } from '../../session/frame';
import { LineStore } from '../../session/lines';
import { SessionStore } from '../../session/store';
import type { BaseApi } from '../../tools/build';
import { PromptLog } from '../../tools/prompts';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, SURVEY } from './fixture';

// The plan of the fixture: S1 changes the loop of solve() with a frame and 2 open decisions, S2 is a new test file with 1
// open decision, and S3 is the README
const PLAN = {
	steps: [
		{
			id: 'S1', title: 'Stop the loop at the limit', task: 'T1', hooks: ['H1'], text: 'Stop the loop at the limit.', checks: ['The project builds.'],
			places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)' }],
			decisions: [{ question: 'When does the loop stop?' }, { question: 'What happens at the limit?' }],
		},
		{
			id: 'S2', title: 'A test of the limit', task: 'T1', hooks: [], text: 'A test for the limit.', checks: ['The test passes.'],
			places: [{ file: 'tests/limit_test.cpp', new: true }], decisions: [{ question: 'Which limit does the test use?' }],
		},
		{
			id: 'S3', title: 'The note in the README', task: 'T2', hooks: ['H2'], text: 'Write the limit in the README.', checks: ['The README tells the limit.'],
			places: [{ file: 'README.md', lines: [3, 3], code: 'It has no limit.' }], decisions: [],
		},
	],
};

// The frame of S1 in the loop of solve(): an inline hole and a hole alone on its line
const FRAME = [
	'#include "solver.h"',
	'',
	'int solve(Plan& plan)',
	'{',
	'    for (int i = 0; i < plan.steps; ++i) {',
	'        if (/*@hole 1: When does the loop stop? */) {',
	'            /*@hole 2: What happens at the limit? */',
	'        }',
	'        plan.step(i);',
	'    }',
	'    return plan.result();',
	'}',
];

// the hints of hole n, for the open decision Dn of the step
const HINTS = (n: number, question: string, answer: string) => ({
	n, decision: `D${n}`, question, nudge: 'Compare the counter with the limit.',
	pointer: { text: 'The loop counts in i, and plan.steps is the limit of the loop.', places: [{ file: 'src/solver.cpp', lines: [5, 5] }] },
	example: { text: 'The loop has the same form.', file: 'src/solver.cpp', lines: [5, 5], code: 'i < plan.steps' },
	answer,
});

suite('Frames', () => {
	test('The markers: a marker in an expression, a marker alone on its line, and a marker that a format broke into 2 lines', () => {
		const text = ['x = f(/*@hole 1: Which value? */);', '    /*@hole 2: What', '     * happens next? */', 'y();'].join('\r\n');
		const markers = findMarkers(text);
		assert.deepStrictEqual(markers.map((m) => [m.n, m.question, m.start, m.end]), [
			[1, 'Which value?', { line: 1, col: 6 }, { line: 1, col: 32 }],
			[2, 'What happens next?', { line: 2, col: 4 }, { line: 3, col: 23 }],
		]);
		const lines = text.split(/\r?\n/);
		assert.deepStrictEqual(anchorOf(lines, markers[0]), { before: 'x = f(', after: ');' });
		assert.deepStrictEqual(anchorOf(lines, markers[1]), { before: '', after: '', prev: 'x = f(\u0001);', next: 'y();' });
	});

	test('A hole is open with its marker, done with code in its place, empty with no code, and changed if Shotgun cannot find its place', () => {
		const markers = findMarkers(FRAME.join('\n'));
		const holes = markers.map((m) => ({ n: m.n, line: m.start.line, anchor: anchorOf(FRAME, m) }));
		assert.deepStrictEqual(holes.map((h) => holeNow(FRAME, h, markers).state), ['open', 'open']);
		// the user fills hole 1. The anchor of hole 2 has the marker of hole 1, so hole 2 is still found
		const filled1 = FRAME.map((l, i) => (i === 5 ? '        if (i >= plan.limit) {' : l));
		const m1 = findMarkers(filled1.join('\n'));
		assert.deepStrictEqual(holeNow(filled1, holes[0], m1), { state: 'done', line: 6, lastLine: 6, content: 'i >= plan.limit' });
		assert.strictEqual(holeNow(filled1, holes[1], m1).state, 'open');
		// 2 new lines above the frame, hole 2 with 2 statements, and hole 1 empty again
		const filled2 = ['// a', '// b', ...FRAME.slice(0, 5), '        if () {', '            log("limit");', '            break;', ...FRAME.slice(7)];
		const m2 = findMarkers(filled2.join('\n'));
		assert.deepStrictEqual(holeNow(filled2, holes[0], m2), { state: 'empty', line: 8, lastLine: 8 });
		assert.deepStrictEqual(holeNow(filled2, holes[1], m2), { state: 'done', line: 9, lastLine: 10, content: 'log("limit");\nbreak;' });
		// the user removed the lines around hole 2
		assert.strictEqual(holeNow(FRAME.slice(0, 6), holes[1], findMarkers(FRAME.slice(0, 6).join('\n'))).state, 'changed');
	});

	test('The answer of a hole of more lines gets the indent of the line of its marker', () => {
		assert.strictEqual(answerText('log("limit");\nbreak;', '            /*@hole 2: x */'), 'log("limit");\n            break;');
		assert.strictEqual(answerText('i >= plan.limit', '        if (/*@hole 1: x */) {'), 'i >= plan.limit');
	});

	test('Each marker needs a hole with its 4 hints, and each hole needs its marker', () => {
		const root = path.resolve('/p');
		const files: Record<string, string[]> = { [path.join(root, 'src', 'solver.cpp')]: FRAME };
		const ctx = { root, scope: ['src/solver.cpp'], folders: [root], isCaseSensitive: true, readLines: (f: string) => files[f] };
		const checked = checkFrame({
			holes: [
				HINTS(1, 'When does the loop stop?', 'i >= plan.limit'),
				{ ...HINTS(3, 'Where?', 'stop();'), example: { text: 'An example.', file: 'src/solver.cpp', lines: [5, 5], code: 'no such code' } },
			],
			note: 'The frame has the branch.',
		}, ctx);
		assert.deepStrictEqual(checked.problems, [
			'Hole 3 has no marker /*@hole 3: question */ in the files of the scope. Write the marker in the place of the decision.',
			'Hole 3: the example code is not in src/solver.cpp:5-5. Copy the code exactly from these lines.',
			'The marker of hole 2 in src/solver.cpp:7 has no hints. Give hole 2 in "holes".',
		]);
		const ok = checkFrame({ holes: [HINTS(1, 'when does the loop stop?', 'i >= plan.limit'), HINTS(2, 'What happens at the limit?', 'break;')] }, ctx);
		assert.deepStrictEqual(ok.problems, []);
		assert.deepStrictEqual(ok.holes.map((h) => [h.n, h.question, h.file, h.line]), [
			[1, 'When does the loop stop?', 'src/solver.cpp', 6], [2, 'What happens at the limit?', 'src/solver.cpp', 7],
		]);
	});

	test('An answer that is only a type, a name, a literal or a list of parameters is an obvious hole (P32)', () => {
		const obvious = ['int', 'std::optional<double>', 'const std::string&', 'limit', 'settings.cycle_limit', 'ctl->state', '8', '"x"', 'true', 'std::nullopt',
			'int limit, bool force = false', '(int limit, std::atomic<bool>& stop)', '()', 'charge, settings', 'int cycle_limit = 8;', 'unsigned int'];
		const decisions = ['counter = 0;', 'return std::nullopt;', 'break;', 'i >= plan.limit', '!stop.load()', 'std::clamp(limit, 1, 100)', 'a == b',
			'if (a) {\n    b = 0;\n}', 'int limit = std::clamp(v, 1, 100)', '++count;', 'x + y, z', 'log("limit"); // the end'];
		assert.deepStrictEqual(obvious.filter((a) => !isObviousAnswer(a)), []);
		assert.deepStrictEqual(decisions.filter((a) => isObviousAnswer(a)), []);
	});

	test('With the open decisions of the step, each open decision needs exactly 1 hole, and a hole needs code with a decision (decision 32)', () => {
		const root = path.resolve('/p');
		const files: Record<string, string[]> = { [path.join(root, 'src', 'solver.cpp')]: FRAME };
		const decisions = [{ id: 'D1', question: 'When does the loop stop?' }, { id: 'D2', question: 'What happens at the limit?' }];
		const ctx = {
			root, scope: ['src/solver.cpp'], folders: [root], isCaseSensitive: true, readLines: (f: string) => files[f], decisions,
			stepText: 'Stop the loop at the limit. Call plan.finish(i) at the limit.',
		};
		const checked = checkFrame({
			holes: [{ ...HINTS(1, 'When does the loop stop?', 'plan.done'), decision: 'D7' }, { ...HINTS(2, 'What happens at the limit?', 'plan.finish(i);'), decision: undefined }],
		}, ctx);
		assert.deepStrictEqual(checked.problems, [
			'Hole 1: the answer "plan.done" is only a type, a name, a literal or a list of parameters. Such code is no decision: write it in the frame. '
				+ 'A hole holds the whole code of its decision, for example a condition with its branch.',
			'Hole 1: D7 is not an open decision of the step. The open decisions are D1, D2. A decision with an answer of the user is no hole: write the code '
				+ 'of the answer in the frame.',
			'Hole 2: the text of the step already gives the answer "plan.finish(i);", so the hole is no open decision. Write it in the frame.',
			'Hole 2: give "decision": the id of the open decision of the step that the hole decides (D1, D2).',
			'The open decision D1 "When does the loop stop?" has no hole. Give each open decision of the step 1 hole with the whole code of the decision.',
			'The open decision D2 "What happens at the limit?" has no hole. Give each open decision of the step 1 hole with the whole code of the decision.',
		]);
		const twice = checkFrame({ holes: [HINTS(1, 'When does the loop stop?', 'i >= plan.limit'), { ...HINTS(2, 'What happens at the limit?', 'break;'), decision: 'D1' }] }, ctx);
		assert.deepStrictEqual(twice.problems, [
			'Hole 2: the decision D1 has a hole already. Give each open decision exactly 1 hole.',
			'The open decision D2 "What happens at the limit?" has no hole. Give each open decision of the step 1 hole with the whole code of the decision.',
		]);
		const ok = checkFrame({ holes: [HINTS(1, 'When does the loop stop?', 'i >= plan.limit'), HINTS(2, 'What happens at the limit?', 'break;')] }, ctx);
		assert.deepStrictEqual([ok.problems, ok.holes.map((h) => h.decision)], [[], ['D1', 'D2']]);
		assert.deepStrictEqual(checkFrame({ holes: [HINTS(1, 'When does the loop stop?', 'i >= plan.limit')] }, { ...ctx, decisions: [] }).problems[0],
			'The step has no open decision, so a frame has no hole. The user can add a decision on the plan page.');
	});

	test('The writer: level 3 gets a frame, and level 4 gets a frame only after the button of the user', () => {
		assert.deepStrictEqual([1, 2, 3, 4, 5].map((l) => buildWriterOf(l as 1 | 2 | 3 | 4 | 5)), ['claude', 'claude', 'frame', 'user', 'user']);
		assert.strictEqual(buildWriterOf(4, true), 'frame');
		assert.strictEqual(buildWriterOf(5, true), 'user');
		assert.strictEqual(isFromView({ type: 'showHint', step: 'S1', hole: 1, level: 4 }), true);
		assert.strictEqual(isFromView({ type: 'showHint', step: 'S1', hole: 1, level: 5 }), false);
		assert.strictEqual(isFromView({ type: 'requestFrame', step: 'S1' }), true);
	});

	suite('A frame in the build', () => {
		let root: string;
		let store: SessionStore;
		let lines: LineStore;
		let next: DiffFacts | undefined;
		const solver = () => path.join(root, 'src', 'solver.cpp');
		const base: BaseApi = { mark: async () => ({}), diff: async () => next!, deleteMark: async () => ({}) };
		const tools = () => shotgunTools({
			store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => fakeEngine(),
			base: () => base, saveFiles: async () => undefined, lines, changes: { start: () => undefined, files: () => [] },
		});
		const call = async (name: string, args: Record<string, unknown> = {}) => (await tools().find((t) => t.name === name)!.call(args)) as Record<string, unknown>;
		const guard = (file: string) => JSON.parse(tools().find((t) => t.name === 'guard')!.call({ tool: 'Edit', file, cwd: root }) as string);
		const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
		const model = () => buildModel({
			version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
			readLines: (f) => readText(f)?.split(/\r?\n/),
		});
		const setText = (text: readonly string[]) => writeFileSync(solver(), text.join('\n'));

		setup(async () => {
			root = makeProject('shotgun-frame-');
			store = new SessionStore(root);
			lines = new LineStore();
			next = undefined;
			store.newTask('A cycle limit for the solver');
			store.passGate('brief-ready');
			await call('submit_survey', SURVEY);
			store.passGate('order-tasks');
			store.acceptOrder();
			await call('submit_plan', PLAN);
			store.setLevel('S1', 3);
			store.setLevel('S2', 4);
			store.setLevel('S3', 2);
			store.acceptPlan();
		});
		teardown(() => {
			rmSync(root, { recursive: true, force: true });
		});

		test('Claude writes the frame, the user fills the holes with the hints, and "The step is done" needs each hole', async () => {
			const current = store.current!;
			assert.deepStrictEqual([current.writer, current.state], ['frame', 'todo']);
			assert.strictEqual(buildNext(current).request, 'Give me a frame for step 1.');
			assert.match(buildGuard(current, 'start').closed, /a frame of Claude\. Open it with start and the kind frame first/);
			await assert.rejects(call('start_step', { step: 'S1', kind: 'errand' }), /Step 1 is a frame: write only the lines with no decision/);
			// a frame needs an open decision (decision 32): with each decision answered, Claude cannot open the frame
			store.answerDecision('S1', 'D1', 'At the limit of the plan.');
			store.answerDecision('S1', 'D2', 'Stop with the partial result.');
			await assert.rejects(call('start_step', { step: 'S1', kind: 'frame' }), /Step 1 has no open decision, so a frame has no hole/);
			store.answerDecision('S1', 'D1', '');
			store.answerDecision('S1', 'D2', '');
			const opened = await call('start_step', { step: 'S1', kind: 'frame' });
			assert.match(String(opened.next), /Each open decision of the step is exactly 1 hole: D1 "When does the loop stop\?", D2 "What happens at the limit\?"/);
			assert.deepStrictEqual(guard(solver()), {});
			// Claude writes the frame
			setText(FRAME);
			next = {
				root, base: 'mark:x', suggestedSteps: [],
				files: [{
					file: 'src/solver.cpp', lines: 12,
					hunks: [{ id: 'h1', lines: [6, 8], added: 3, removed: 0, diff: [6, 7, 8].map((l) => `+${String(l).padStart(5)} | ${FRAME[l - 1]}`).join('\n') }],
				}],
			};
			await assert.rejects(call('submit_frame', { step: 'S1', holes: [HINTS(1, 'When does the loop stop?', 'i >= plan.limit')] }),
				/The marker of hole 2 in src\/solver\.cpp:7 has no hints\./);
			const out = await call('submit_frame', {
				step: 'S1', note: 'The frame has the branch in the loop. The 2 decisions are yours.',
				holes: [HINTS(1, 'When does the loop stop?', 'i >= plan.limit'), HINTS(2, 'What happens at the limit?', 'break;')],
			});
			assert.match(String(out.next), /The panel of Shotgun shows the holes/);
			const step = store.snapshot.build!.steps.S1;
			assert.deepStrictEqual([step.state, step.holes?.length, step.holes?.[0].facts?.function], ['holes', 2, 'solve']);
			// the names in scope at the line of the hole (item 45 of dataflow-gaps-2.md)
			assert.deepStrictEqual(step.holes?.[0].facts?.names, ['plan: Plan &']);
			assert.deepStrictEqual(model().task?.build?.current?.holes?.[0].facts?.names, ['plan: Plan &']);
			assert.deepStrictEqual(lines.runs('src/solver.cpp').map((r) => [r.lines, r.writer, r.change]), [[[6, 8], 'claude', 'frame']]);
			assert.match(guard(solver()).hookSpecificOutput.permissionDecisionReason, /The user fills the holes of the frame of step 1 of 3/);
			let m = model();
			assert.deepStrictEqual(m.task?.build?.current?.holes?.map((h) => [h.n, h.state, h.shown, h.nudge]), [[1, 'open', 0, undefined], [2, 'open', 0, undefined]]);
			assert.deepStrictEqual([m.task?.gate?.label, m.task?.gate?.isEnabled, m.task?.gate?.reason], ['The step is done', false, 'Fill the holes first: 0 of 2 holes done.']);
			// the user opens 2 hints of hole 2, and fills hole 1
			store.setHint('S1', 2, 2);
			setText(FRAME.map((l, i) => (i === 5 ? '        if (i >= plan.limit) {' : l)));
			m = model();
			assert.deepStrictEqual(m.task?.build?.current?.holes?.map((h) => [h.state, h.by, h.shown, !!h.nudge, !!h.pointer, !!h.example]),
				[['done', 'user', 0, false, false, false], ['open', undefined, 2, true, true, false]]);
			assert.strictEqual(m.task?.build?.current?.holesDone, 1);
			// the answer of Claude fills hole 2
			store.setHint('S1', 2, 4);
			setText(FRAME.map((l, i) => (i === 5 ? '        if (i >= plan.limit) {' : i === 6 ? '            break;' : l)));
			m = model();
			assert.deepStrictEqual(m.task?.build?.current?.holes?.map((h) => [h.state, h.by]), [['done', 'user'], ['done', 'claude']]);
			assert.strictEqual(m.task?.gate?.isEnabled, true);
			const got = await call('get_step');
			assert.deepStrictEqual((got.frame as { holes: { state: string; content?: string }[] }).holes.map((h) => [h.state, h.content]),
				[['done', 'i >= plan.limit'], ['done', 'break;']]);
			store.finishStep('S1', 'step-done');
			assert.strictEqual(store.current?.step.id, 'S2');
			assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind !== 'deny').slice(-5).map((d) => decisionText(d)), [
				'Claude opened step S1.',
				'Claude gave the frame of step S1: 2 holes.',
				'You opened hint 2 of hole 2 of step S1.',
				'The answer of Claude filled hole 2 of step S1.',
				'You ended step S1: "The step is done".',
			]);
		});

		test('A step of level 4: "I want a frame" gives it to Claude as a frame, and a new level in stage 5 starts the step again', async () => {
			store.startStep('S1', { writer: 'frame', level: 3, scope: ['src/solver.cpp'] });
			store.writeFrame('S1', [], undefined);
			store.finishStep('S1', 'step-done');
			// S2 is open for the user, as the extension opens it
			store.startStep('S2', { writer: 'user', level: 4, scope: ['tests/limit_test.cpp'], base: 'sg.base.S2' });
			assert.strictEqual(model().task?.build?.current?.canRequestFrame, true);
			await assert.rejects(call('start_step', { step: 'S2', kind: 'frame' }), /For a frame of Claude, the user selects "I want a frame" in the panel of Shotgun first/);
			// "I want a frame" needs an open decision (decision 32)
			store.answerDecision('S2', 'D1', 'The limit 3.');
			assert.strictEqual(model().task?.build?.current?.canRequestFrame, false);
			assert.throws(() => store.requestFrame('S2'), /Step 2 has no open decision, so a frame has no hole\. Add a decision on the plan page first\./);
			store.answerDecision('S2', 'D1', '');
			const old = store.requestFrame('S2');
			assert.strictEqual(old?.base, 'sg.base.S2');
			const current = store.current!;
			assert.deepStrictEqual([current.writer, current.state, current.build?.isFrameRequested], ['frame', 'todo', true]);
			assert.strictEqual(model().task?.build?.current?.writerText, 'You asked for a frame. Claude writes the frame, and you fill its holes');
			// an open for the user that started before the request does not change the step
			assert.throws(() => store.startStep('S2', { writer: 'user', level: 4, scope: ['tests/limit_test.cpp'], base: 'sg.base.S2' }),
				/Step 2 changed while it opened\. Its writer is frame now, not user\./);
			assert.deepStrictEqual([store.current?.writer, store.current?.state, store.current?.build?.isFrameRequested], ['frame', 'todo', true]);
			// a new level in stage 5 removes the frame request: the step starts again with the writer of its level
			const removed = store.setLevel('S2', 2);
			assert.strictEqual(removed?.isFrameRequested, true);
			assert.deepStrictEqual([store.current?.writer, store.current?.state], ['claude', 'todo']);
			// a step that is done, or that Claude started, keeps its level
			assert.throws(() => store.setLevel('S1', 4), /The step is done, so its level stays\./);
			await call('start_step', { step: 'S2' });
			assert.throws(() => store.setLevel('S2', 4), /Claude started the step, so its level stays\./);
			const plan = model().task?.plan?.steps.map((s) => s.isLevelEditable);
			assert.deepStrictEqual(plan, [false, false, true]);
			assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind === 'frame-request' || (d.kind === 'level' && d.step === 'S2')).map((d) => d.kind),
				['level', 'frame-request', 'level']);
			assert.match(readFileSync(path.join(root, '.shotgun', 'a-cycle-limit-for-the-solver', 'decisions.jsonl'), 'utf8'), /"kind":"frame-request"/);
		});

		test('An errand with an open decision: Claude gives its choice, and the receipt shows it (P31)', async () => {
			store.startStep('S1', { writer: 'frame', level: 3, scope: ['src/solver.cpp'] });
			store.writeFrame('S1', [], undefined);
			store.finishStep('S1', 'step-done');
			store.setLevel('S2', 2);
			const start = await call('start_step', { step: 'S2' });
			assert.match(String(start.next), /The step has open decisions: D1 "Which limit does the test use\?"\. Decide each one, and give your choice in "choices"\./);
			mkdirSync(path.join(root, 'tests'));
			writeFileSync(path.join(root, 'tests', 'limit_test.cpp'), 'int limit = 3;');
			next = {
				root, base: 'mark:x', suggestedSteps: [],
				files: [{ file: 'tests/limit_test.cpp', lines: 1, isNew: true, hunks: [{ id: 'h1', lines: [1, 1], added: 1, removed: 0, diff: '+    1 | int limit = 3;' }] }],
			};
			const changes = [{ file: 'tests/limit_test.cpp', lines: [1, 1], title: 'The limit of the test', check: 'Is 3 the correct limit?' }];
			await assert.rejects(call('submit_errand', { step: 'S2', changes }), /Give your choice for the open decision D1 "Which limit does the test use\?" in "choices"\./);
			await assert.rejects(call('submit_errand', { step: 'S2', changes, choices: [{ decision: 'D7', choice: 'x' }] }),
				/Choice 1: "D7" is not an open decision of the step\./);
			await call('submit_errand', { step: 'S2', changes, choices: [{ decision: 'D1', choice: 'The limit 3: the smallest limit of the brief.' }] });
			const choice = { decision: 'D1', question: 'Which limit does the test use?', choice: 'The limit 3: the smallest limit of the brief.' };
			assert.deepStrictEqual(store.snapshot.build!.steps.S2.receipt?.choices, [choice]);
			assert.deepStrictEqual(model().task?.build?.current?.receipt?.choices, [choice]);
			assert.deepStrictEqual(model().task?.build?.current?.decisions, [{ id: 'D1', question: 'Which limit does the test use?', options: [], by: 'claude' }]);
		});
	});
});
