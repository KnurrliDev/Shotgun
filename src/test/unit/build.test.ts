import * as assert from 'assert';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import type { DiffFacts } from '../../dataflow/dataflow-api';
import {
	buildGuard, buildNext, buildWriterOf, checkErrand, currentStep, findStep, hunkKey, keepMarks, markName, parseBuild, receiptChanges, ReceiptChange,
	walkText,
} from '../../session/build';
import { readText } from '../../session/files';
import { LineStore } from '../../session/lines';
import { SessionStore } from '../../session/store';
import type { BaseApi } from '../../tools/build';
import { PromptLog } from '../../tools/prompts';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, SURVEY } from './fixture';

// The plan of the fixture: S1 changes the loop of solve(), S2 makes a new test file, and S3 changes the README
const PLAN = {
	steps: [
		{
			id: 'S1', title: 'The limit in the loop', task: 'T1', hooks: ['H1'], text: 'Stop the loop at the limit.', checks: ['The project builds.'],
			places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)' }],
		},
		{
			id: 'S2', title: 'A test of the limit', task: 'T1', hooks: [], text: 'A test for the limit.', checks: ['The test passes.'],
			places: [{ file: 'tests/limit_test.cpp', new: true }],
		},
		{
			id: 'S3', title: 'The note in the README', task: 'T2', hooks: ['H2'], text: 'Write the limit in the README.', checks: ['The README tells the limit.'],
			places: [{ file: 'README.md', lines: [3, 3], code: 'It has no limit.' }],
		},
	],
};

// A fake of the bases and the diffs of DataFlow. The test gives the diff of each call
function fakeBase(calls: string[]): BaseApi & { next: DiffFacts | undefined } {
	const base = {
		next: undefined as DiffFacts | undefined,
		mark: async (name: string, paths: readonly string[]) => {
			calls.push(`mark ${name} ${paths.map((p) => path.basename(p)).join(',')}`);
			return {};
		},
		diff: async (b: string) => {
			calls.push(`diff ${b}`);
			if (!base.next) {
				throw new Error('no diff');
			}
			return base.next;
		},
		deleteMark: async (name: string) => {
			calls.push(`delete ${name}`);
			return {};
		},
	};
	return base;
}

// The diff of DataFlow for 1 hunk in solver.cpp with 1 added line
const solverDiff = (root: string, line: number, text: string): DiffFacts => ({
	root, base: 'mark:x', suggestedSteps: [],
	files: [{
		file: 'src/solver.cpp', lines: 10,
		hunks: [{
			id: 'h1', lines: [line, line], added: 1, removed: 0, functions: ['solve'],
			heat: [{ function: 'solve', score: 18, band: 'cool', isReachComplete: true }],
			diff: [`    ${String(line - 1).padStart(5)} | for (...) {`, `+${String(line).padStart(5)} | ${text}`].join('\n'),
		}],
	}],
});

suite('Build', () => {
	let root: string;
	let store: SessionStore;
	let calls: string[];
	let base: ReturnType<typeof fakeBase>;
	let lines: LineStore;
	let changed: string[];
	const solver = () => path.join(root, 'src', 'solver.cpp');
	const tools = () => shotgunTools({
		store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => fakeEngine(),
		base: () => base, saveFiles: async () => undefined, lines, changes: { start: () => (changed = []), files: () => changed },
	});
	const call = async (name: string, args: Record<string, unknown> = {}) => (await tools().find((t) => t.name === name)!.call(args)) as Record<string, unknown>;
	const guard = (file: string) => JSON.parse(tools().find((t) => t.name === 'guard')!.call({ tool: 'Edit', file, cwd: root }) as string);
	const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
	const model = () => buildModel({
		version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
		readLines: (f) => readText(f)?.split(/\r?\n/),
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

	setup(() => {
		root = makeProject('shotgun-build-');
		store = new SessionStore(root);
		calls = [];
		base = fakeBase(calls);
		lines = new LineStore();
		changed = [];
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The level selects the writer. Until the frames of phase 7, the user writes a step of level 3', () => {
		assert.deepStrictEqual([1, 2, 3, 4, 5].map((l) => buildWriterOf(l as 1 | 2 | 3 | 4 | 5)), ['claude', 'claude', 'user', 'user', 'user']);
		assert.strictEqual(buildWriterOf(null), 'user');
		const plan = { steps: [{ id: 'S1' }, { id: 'S2' }] } as unknown as Parameters<typeof findStep>[0];
		assert.strictEqual(findStep(plan, 'S2')?.n, 2);
		assert.strictEqual(findStep(plan, 'step 1')?.n, 1);
		assert.strictEqual(findStep(plan, 2)?.n, 2);
		assert.strictEqual(findStep(plan, 'S9'), undefined);
		const name = markName('a-cycle-limit-for-the-solver-and-a-long-title-of-the-task', 'S12');
		assert.match(name, /^[A-Za-z0-9_.-]{1,64}$/);
		assert.notStrictEqual(name, markName('a-cycle-limit-for-the-solver-and-a-different-title', 'S12'));
	});

	test('Each hunk needs a change of Claude, and each change needs a hunk', () => {
		const ctx = { root: path.resolve('/p'), scope: ['src/a.cpp'], folders: [path.resolve('/p')], isCaseSensitive: true };
		const checked = checkErrand({
			changes: [
				{ file: 'src/a.cpp', lines: [10, 12], title: 'Read the limit', check: 'Is 8 the default?' },
				{ file: 'src/b.cpp', lines: [1, 1], title: 'Out of the scope', check: 'x' },
				{ file: 'src/a.cpp', lines: [40, 41], title: '', check: 'x' },
			],
			looseEnds: [{ text: 'describe() does not name the limit', file: 'src/b.cpp', lines: [5, 6] }, 'A test of the limit'],
		}, ctx);
		assert.deepStrictEqual(checked.problems, [
			'Change 2: src/b.cpp is not in the scope of the step: src/a.cpp.',
			'Change 3: give a "title" of 1 to 200 characters.',
		]);
		assert.deepStrictEqual(checked.looseEnds, [{ text: 'describe() does not name the limit', file: 'src/b.cpp', lines: [5, 6] }, { text: 'A test of the limit' }]);
		const hunk = (lines: [number, number], diff: string) => ({ file: 'src/a.cpp', id: `h${lines[0]}`, lines, added: 1, removed: 0, diff, key: hunkKey('src/a.cpp', diff, 1, 0) });
		const hunks = [hunk([11, 11], '+   11 | int limit = 8;'), hunk([13, 13], '+   13 | log(limit);'), hunk([30, 30], '+   30 | x();')];
		const matched = receiptChanges([checked.changes[0]], hunks);
		assert.deepStrictEqual(matched.problems, ['The change at src/a.cpp:30 (+1 −0) has no note. Give a change with its lines, a title and a check.']);
		assert.deepStrictEqual(matched.changes.map((c) => [c.id, c.lines, c.hunks.length, c.added]), [['C1', [11, 13], 2, 2]]);
		const none = receiptChanges([{ file: 'src/a.cpp', lines: [50, 52], title: 't', check: 'c' }], []);
		assert.deepStrictEqual(none.problems, ['Change 1 (src/a.cpp:50-52) has no change since the base of the step. Give the lines of the change in the text now.']);
	});

	test('A new round keeps the mark OK of a change with the same hunks. Each other change starts with no mark', () => {
		const change = (id: string, text: string, mark: ReceiptChange['mark']): ReceiptChange => ({
			id, file: 'src/a.cpp', lines: [1, 1], title: id, check: 'c', added: 1, removed: 0, mark,
			hunks: [{ id: 'h', lines: [1, 1], added: 1, removed: 0, key: hunkKey('src/a.cpp', `+    1 | ${text}`, 1, 0) }],
		});
		const old = { time: '', round: 1, changes: [change('C1', 'a();', 'ok'), change('C2', 'b();', 'issue')], denies: [], outside: [], deleted: [], looseEnds: [] };
		// the line number of a hunk does not change its key
		const moved = { ...change('C1', 'a();', 'todo'), hunks: [{ id: 'h', lines: [5, 5] as [number, number], added: 1, removed: 0, key: hunkKey('src/a.cpp', '+    5 | a();', 1, 0) }] };
		const next = keepMarks([moved, change('C2', 'b();', 'todo'), change('C3', 'c();', 'todo')], old);
		assert.deepStrictEqual(next.map((c) => c.mark), ['ok', 'todo', 'todo']);
		assert.strictEqual(walkText({ ...old, changes: next }), '1 of 3 changes walked');
	});

	test('An errand: the guard opens only the scope, the receipt has a note for each change, and the user puts the marks', async () => {
		await buildStage();
		const id = 'a-cycle-limit-for-the-solver';
		const current = store.current!;
		assert.deepStrictEqual([current.step.id, current.writer, current.state, current.level], ['S1', 'claude', 'todo', 2]);
		assert.strictEqual(model().task?.request, 'Do step 1.');
		// before start_step, the guard denies each file change, and its reason names start_step
		assert.match(guard(solver()).hookSpecificOutput.permissionDecisionReason, /a step of Claude\. Open it with mcp__plugin_dataflow_dataflow__shotgun_start_step first/);
		// only the current step opens, and only a step of Claude
		await assert.rejects(call('start_step', { step: 'S3' }), /Step 3 is not the current step\. The steps go in sequence/);
		const started = await call('start_step', { step: '1' });
		assert.strictEqual(started.state, 'open');
		assert.deepStrictEqual(started.scope, ['src/solver.cpp']);
		assert.deepStrictEqual(calls, [`mark ${markName(id, 'S1')} solver.cpp`]);
		assert.deepStrictEqual(guard(solver()), {});
		const denied = guard(path.join(root, 'README.md')).hookSpecificOutput.permissionDecisionReason;
		assert.match(denied, /^Shotgun: step 1 of 3, "The limit in the loop" is open, and its scope is src\/solver\.cpp\. The file .*README\.md is not in the scope\./);
		// Claude changes the loop. A change with no note gives a problem
		const text = readFileSync(solver(), 'utf8').split('\n');
		text.splice(5, 0, '        if (i >= plan.limit) break;');
		writeFileSync(solver(), text.join('\n'));
		base.next = solverDiff(root, 6, '        if (i >= plan.limit) break;');
		await assert.rejects(call('submit_errand', { step: 'S1', changes: [] }), /The change at src\/solver\.cpp:6 \(\+1 −0\) has no note\./);
		assert.strictEqual(store.current!.state, 'open');
		changed = [path.join(root, 'src', 'solver.cpp'), path.join(root, 'notes.txt')];
		const out = await call('submit_errand', {
			step: 'S1',
			changes: [{ file: 'src/solver.cpp', lines: [6, 6], title: 'Stop at the limit', check: 'Is >= correct at the limit?' }],
			looseEnds: [{ text: 'main() does not set the limit' }],
		});
		assert.match(String(out.next), /The panel of Shotgun shows the receipt/);
		const step = store.snapshot.build!.steps.S1;
		assert.strictEqual(step.state, 'receipt');
		assert.deepStrictEqual(step.receipt!.changes.map((c) => [c.id, c.file, c.lines, c.mark]), [['C1', 'src/solver.cpp', [6, 6], 'todo']]);
		assert.deepStrictEqual(step.receipt!.denies, [{ tool: 'Edit', file: 'README.md' }]);
		assert.deepStrictEqual(step.receipt!.outside, ['notes.txt']);
		assert.deepStrictEqual(lines.runs('src/solver.cpp').map((r) => [r.lines, r.writer, r.step, r.change]), [[[6, 6], 'claude', 'S1', 'C1']]);
		// the scope is closed again
		assert.match(guard(solver()).hookSpecificOutput.permissionDecisionReason, /The user walks the receipt of step 1 of 3/);
		// an issue stops the gate, and the request asks Claude to fix it
		store.setMark('S1', 'C1', 'issue');
		store.setChangeNote('S1', 'C1', 'Use > here.');
		let m = model();
		assert.strictEqual(m.task?.gate?.isEnabled, false);
		assert.match(m.task?.gate?.reason ?? '', /1 change has an issue\. Tell Claude "Fix the issues of step 1\."/);
		assert.strictEqual(m.task?.request, 'Fix the issues of step 1.');
		assert.deepStrictEqual(m.task?.build?.current?.receipt?.changes.map((c) => [c.mark, c.userNote, c.diff.length]), [['issue', 'Use > here.', 2]]);
		const got = await call('get_step');
		assert.deepStrictEqual((got.receipt as { issues: unknown[] }).issues, [{ change: 'C1', title: 'Stop at the limit', place: 'src/solver.cpp:6', userNote: 'Use > here.' }]);
		// Claude opens the step again: the step keeps its base, and the new receipt starts with no mark for the changed hunk
		const again = await call('start_step', { step: 'S1' });
		assert.strictEqual(again.round, 2);
		assert.strictEqual(calls.filter((c) => c.startsWith('mark')).length, 1);
		base.next = solverDiff(root, 6, '        if (i > plan.limit) break;');
		await call('submit_errand', { step: 'S1', changes: [{ file: 'src/solver.cpp', lines: [6, 6], title: 'Stop after the limit', check: 'Is > correct?', note: 'You asked for >.' }] });
		assert.deepStrictEqual(store.snapshot.build!.steps.S1.receipt!.changes.map((c) => [c.mark, c.note]), [['todo', 'You asked for >.']]);
		store.setMark('S1', 'C1', 'ok');
		m = model();
		assert.strictEqual(m.task?.gate?.label, 'Accept the receipt');
		assert.strictEqual(m.task?.gate?.isEnabled, true);
		store.finishStep('S1', 'accept-receipt');
		assert.strictEqual(store.current?.step.id, 'S2');
		assert.deepStrictEqual(store.snapshot.decisions.filter((d) => d.kind !== 'deny').slice(-8).map((d) => d.kind),
			['step', 'errand', 'mark', 'change-note', 'step', 'errand', 'mark', 'step-gate']);
		assert.strictEqual(decisionText(store.snapshot.decisions[store.snapshot.decisions.length - 1]), 'You accepted the receipt of step S1.');
		// build.json is correct after a reload
		assert.strictEqual(parseBuild(readFileSync(path.join(root, '.shotgun', id, 'build.json'), 'utf8'), id).steps.S1.state, 'done');
	});

	test('A step with only a new file has no base, and its receipt has all lines of the file', async () => {
		await buildStage();
		store.startStep('S1', { writer: 'claude', level: 2, scope: ['src/solver.cpp'] });
		store.writeReceipt('S1', { time: '', round: 1, changes: [], denies: [], outside: [], deleted: [], looseEnds: [] });
		store.finishStep('S1', 'accept-receipt');
		await call('start_step', { step: 'S2' });
		assert.deepStrictEqual(calls, []);
		assert.deepStrictEqual(store.snapshot.build!.steps.S2.newFiles, ['tests/limit_test.cpp']);
		mkdirSync(path.join(root, 'tests'));
		writeFileSync(path.join(root, 'tests', 'limit_test.cpp'), '#include "solver.h"\n\nint main() { return 0; }\n');
		await call('submit_errand', { step: 2, changes: [{ file: 'tests/limit_test.cpp', lines: [1, 3], title: 'The test', check: 'Does it run?' }] });
		const receipt = store.snapshot.build!.steps.S2.receipt!;
		assert.deepStrictEqual(receipt.changes.map((c) => [c.isNewFile, c.added, c.lines]), [[true, 3, [1, 3]]]);
		assert.deepStrictEqual(lines.runs('tests/limit_test.cpp').map((r) => r.lines), [[1, 3]]);
		assert.strictEqual(model().task?.build?.current?.receipt?.changes[0].place, 'tests/limit_test.cpp (new)');
	});

	test('A step of the user: Claude cannot open it, and "The step is done" ends it. Then the task is done', async () => {
		await buildStage();
		for (const s of ['S1', 'S2']) {
			store.startStep(s, { writer: 'claude', level: 1, scope: [] });
			store.writeReceipt(s, { time: '', round: 1, changes: [], denies: [], outside: [], deleted: [], looseEnds: [] });
			store.finishStep(s, 'accept-receipt');
		}
		const current = store.current!;
		assert.deepStrictEqual([current.step.id, current.writer, current.state], ['S3', 'user', 'todo']);
		await assert.rejects(call('start_step', { step: 'S3' }), /Step 3 has risk level 4, so the user writes it\./);
		assert.match(guard(path.join(root, 'README.md')).hookSpecificOutput.permissionDecisionReason, /The current step is step 3 of 3, "The note in the README", and the user writes it\./);
		assert.match(buildNext(current).next, /^The user writes step 3 of 3, "The note in the README", at risk level 4, and then selects "The step is done"\./);
		store.startStep('S3', { writer: 'user', level: 4, scope: ['README.md'], base: markName('x', 'S3') });
		let m = model();
		assert.deepStrictEqual([m.task?.gate?.label, m.task?.gate?.isEnabled, m.task?.request], ['The step is done', true, undefined]);
		store.finishStep('S3', 'step-done');
		assert.strictEqual(store.current, undefined);
		m = model();
		assert.deepStrictEqual([m.task?.gate?.label, m.task?.build?.done], ['The task is done', 3]);
		assert.strictEqual(buildGuard(undefined, 'x').closed, 'Each step of the plan is done, so Claude changes no file.');
		store.passGate('task-done');
		assert.strictEqual(store.snapshot.task?.isDone, true);
		assert.strictEqual(currentStep(store.snapshot.plan, store.snapshot.risk, store.snapshot.levels, store.snapshot.build), undefined);
	});

	test('The webviews send the marks and the notes of the user', () => {
		assert.strictEqual(isFromView({ type: 'setMark', step: 'S1', change: 'C1', mark: 'ok' }), true);
		assert.strictEqual(isFromView({ type: 'setMark', step: 'S1', change: 'C1', mark: 'maybe' }), false);
		assert.strictEqual(isFromView({ type: 'setChangeNote', step: 'S1', change: 'C1', note: 'x' }), true);
	});
});
