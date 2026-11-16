import * as assert from 'assert';
import { rmSync } from 'fs';
import * as path from 'path';
import type { ClaudeState } from '../../claude/connection';
import type { HiddenFacts, LogicFacts, ThreadFacts } from '../../dataflow/dataflow-api';
import {
	accessLines, calloutStatus, EngineFact, factKeys, hiddenFacts, itemLines, keepUserState, logicFacts, revealCallouts, StepCallouts, threadFacts,
	updateCallouts, voiceAllows,
} from '../../session/callouts';
import { readText } from '../../session/files';
import { SessionStore } from '../../session/store';
import { PromptLog } from '../../tools/prompts';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText, statusOf } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, noBuild, SURVEY } from './fixture';

// The callouts of phase 8: the facts of DataFlow on the lines of the user, the keys with the text of the line, the voice,
// the limit of each pause, and the tools for the words of Claude

const THREADS: ThreadFacts = {
	file: 'src/solver.cpp', threads: [{ label: 'solver', via: 'std::async', line: 5, function: 'solve', handle: 'future', joins: [] }],
	items: [
		{ item: 'plan.steps', kind: 'member', type: 'int', verdict: 'Race', caller: 'reads 5 · writes 7', worker: 'writes 6, other.cpp:12', protection: 'no lock', summary: 'Two threads use plan.steps with no lock.' },
		{ item: 'plan.total', kind: 'member', type: 'int', verdict: 'Check', caller: 'reads 8', worker: 'writes 6', protection: 'an order', summary: 'Check the order.' },
		{ item: 'plan.id', kind: 'member', type: 'int', verdict: 'Safe', caller: 'reads 4', worker: '–', protection: 'one thread only', summary: '' },
	],
	counts: { race: 1, check: 1, safe: 1 },
};
const LOGIC: LogicFacts = {
	file: 'src/solver.cpp', function: { name: 'solve', lines: [3, 9] }, decisions: [], path: [], deadLines: [],
	warnings: [{ line: 7, text: 'Two events on one path.' }],
};
const HIDDEN: HiddenFacts = { file: 'src/solver.cpp', function: 'solve', items: [{ line: 6, kind: 'copy', text: 'a copy of Plan', detail: 'The call takes Plan by value.' }] };

const TEXT = ['#include "solver.h"', '', 'int solve(Plan& plan)', '{', '    for (int i = 0; i < plan.steps; ++i) {', '        plan.step(i);', '    }', '    return plan.result();', '}'];

suite('Callouts', () => {
	test('The facts of DataFlow: races and data after the end of a function are problems, checks and the logic are warnings, the hidden C++ is info', () => {
		assert.deepStrictEqual(accessLines('reads 94, 101 · writes 129'), [94, 101, 129]);
		assert.deepStrictEqual(accessLines('reads battery.cpp:76 · writes 12'), [12]);
		assert.deepStrictEqual(accessLines('–'), []);
		const threads = threadFacts(THREADS);
		assert.deepStrictEqual(threads.map((f) => [f.kind, f.title, f.lines]), [['problem', 'plan.steps: race', [5, 7, 6]], ['warning', 'plan.total: check', [8, 6]]]);
		assert.match(threads[0].proof.join(' '), /The thread of the caller reads 5 · writes 7\. The worker thread writes 6, other\.cpp:12\. Protection: no lock\./);
		assert.deepStrictEqual(logicFacts(LOGIC).map((f) => [f.kind, f.title, f.lines, f.function]), [['warning', 'Two events on one path.', [7], 'solve']]);
		assert.deepStrictEqual(hiddenFacts(HIDDEN).map((f) => [f.kind, f.title, f.lines]), [['info', 'copy: a copy of Plan', [6]]]);
		assert.deepStrictEqual(['problem', 'warning', 'info'].map((k) => voiceAllows('quiet', k as 'problem')), [true, false, false]);
		assert.deepStrictEqual(['problem', 'warning', 'info'].map((k) => voiceAllows('normal', k as 'problem')), [true, true, false]);
		assert.deepStrictEqual(['problem', 'warning', 'info'].map((k) => voiceAllows('talkative', k as 'problem')), [true, true, true]);
	});

	test('With the accesses of DataFlow, only an access that can run at the same time as a different thread is a line of a race', () => {
		const item = THREADS.items[0];
		const withAccesses: ThreadFacts = {
			...THREADS,
			items: [
				{
					...item,
					accesses: [
						{ line: 5, role: 'read', isWrite: false, thread: 'caller', locks: [], pair: 'race' },
						{ line: 7, role: 'write', isWrite: true, thread: 'caller', locks: [] }, // after the join
						{ line: 6, role: 'write', isWrite: true, thread: 'worker', locks: [], pair: 'race' },
						{ file: 'src/other.cpp', line: 12, role: 'write', isWrite: true, thread: 'worker', locks: [], pair: 'race' },
					],
				},
				// a reference after the end of its function has no pair, so each access in the file counts
				{ ...THREADS.items[1], verdict: 'Dangling', accesses: [{ line: 8, role: 'read', isWrite: false, thread: 'caller', locks: [] }] },
			],
		};
		assert.deepStrictEqual(threadFacts(withAccesses).map((f) => [f.title, f.lines]),
			[['plan.steps: race', [5, 6]], ['plan.total: a reference after the end of its function', [8]]]);
		// an item with no accesses, for example of the kind capture, gives the lines of its texts
		assert.deepStrictEqual(itemLines(item), [5, 7, 6]);
	});

	test('Only a new fact on a line of the user is a callout. A fact that only moved keeps its key, and a fact that went away is gone', () => {
		const race: EngineFact = { source: 'threads', kind: 'problem', id: 'threads|plan.steps|Race', title: 'plan.steps: race', proof: ['x'], lines: [5, 6] };
		const start: StepCallouts = { started: 't0', startKeys: factKeys([race], TEXT), callouts: [], nextId: 1 };
		// the user adds a write to plan.steps on a new line 6. The old accesses moved 1 line down
		const now = [...TEXT.slice(0, 5), '        plan.steps = 0;', ...TEXT.slice(5)];
		const moved: EngineFact = { ...race, lines: [5, 6, 7] };
		const step = updateCallouts(start, 'src/solver.cpp', [moved], now, new Set([6]));
		assert.deepStrictEqual(step.callouts.map((c) => [c.id, c.line, c.kind, c.title]), [['C1', 6, 'problem', 'plan.steps: race']]);
		// an old fact on a line of the user with the same text is no callout
		assert.deepStrictEqual(updateCallouts(start, 'src/solver.cpp', [race], TEXT, new Set([5, 6])).callouts, []);
		// a second check keeps the callout and its state. With no fact, the callout is gone
		const shown = revealCallouts(step, 'normal', 't1').step;
		const again = updateCallouts(shown, 'src/solver.cpp', [moved], now, new Set([6]));
		assert.deepStrictEqual(again.callouts.map((c) => [c.id, c.shown, c.isGone]), [['C1', 't1', undefined]]);
		assert.strictEqual(updateCallouts(again, 'src/solver.cpp', [], now, new Set([6])).callouts[0].isGone, true);
	});

	test('A pause shows a maximum of 3 callouts that the voice allows: the problems first, then the warnings, then the other facts', () => {
		const make = (n: number, kind: 'problem' | 'warning' | 'info', line: number) => ({
			id: `C${n}`, key: `k${n}`, file: 'a.cpp', line, kind, source: 'threads' as const, title: `t${n}`, proof: [],
		});
		const step: StepCallouts = {
			started: 't0', startKeys: [], nextId: 6,
			callouts: [make(1, 'info', 1), make(2, 'warning', 2), make(3, 'problem', 9), make(4, 'warning', 4), make(5, 'problem', 5)],
		};
		const quiet = revealCallouts(step, 'quiet', 't1');
		assert.deepStrictEqual([quiet.shown, quiet.step.callouts.filter((c) => c.shown).map((c) => c.id)], [2, ['C3', 'C5']]);
		const normal = revealCallouts(step, 'normal', 't1');
		assert.deepStrictEqual(normal.step.callouts.filter((c) => c.shown).map((c) => c.id).sort(), ['C2', 'C3', 'C5']);
		assert.deepStrictEqual(normal.step.callouts.map((c) => calloutStatus(c, 'normal')), ['held', 'open', 'open', 'waiting', 'open']);
		// the next pause shows the warning that waits
		const next = revealCallouts(normal.step, 'normal', 't2');
		assert.deepStrictEqual([next.shown, next.step.callouts.find((c) => c.id === 'C4')?.shown], [1, 't2']);
		// a decision of the user while DataFlow worked stays
		const latest = { ...normal.step, callouts: normal.step.callouts.map((c) => (c.id === 'C3' ? { ...c, closed: { reason: 'r', time: 't' } } : c)) };
		assert.deepStrictEqual(keepUserState(next.step, latest).callouts.find((c) => c.id === 'C3')?.closed, { reason: 'r', time: 't' });
	});

	suite('In the build', () => {
		let root: string;
		let store: SessionStore;
		let prompts: PromptLog;
		const engine = fakeEngine([], { threads: async () => THREADS, logic: async () => LOGIC, hidden: async () => HIDDEN });
		const tools = () => shotgunTools({
			store, folders: () => [root], log: () => undefined, prompts, readText, openFile: () => undefined, engine: () => engine, ...noBuild(),
			voice: () => 'normal',
		});
		const call = async (name: string, args: Record<string, unknown> = {}) => (await tools().find((t) => t.name === name)!.call(args)) as Record<string, unknown>;
		const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
		const model = () => buildModel({
			version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
			readLines: (f) => readText(f)?.split(/\r?\n/), voice: 'normal', pauseSeconds: 2,
		});

		setup(async () => {
			root = makeProject('shotgun-callouts-');
			store = new SessionStore(root);
			prompts = new PromptLog();
			store.newTask('A cycle limit for the solver');
			store.passGate('brief-ready');
			await call('submit_survey', SURVEY);
			store.passGate('order-tasks');
			store.acceptOrder();
			await call('submit_plan', {
				steps: [{
					id: 'S1', title: 'The limit in the loop', task: 'T1', hooks: ['H1'], text: 'Stop the loop at the limit.', checks: ['The project builds.'],
					places: [{ file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0; i < plan.steps; ++i)' }], decisions: [],
				}, {
					id: 'S2', title: 'The note', task: 'T2', hooks: ['H2'], text: 'Write the limit.', checks: ['The README tells the limit.'],
					places: [{ file: 'README.md', lines: [3, 3], code: 'It has no limit.' }], decisions: [],
				}],
			});
			store.setLevel('S1', 5);
			store.acceptPlan();
			store.startStep('S1', { writer: 'user', level: 5, scope: ['src/solver.cpp'], base: 'sg.x.S1' });
		});
		teardown(() => {
			rmSync(root, { recursive: true, force: true });
		});

		test('The tools give the callouts to Claude, keep the words of Claude, and keep the facts of DataFlow apart from the answer', async () => {
			store.startCallouts('S1', []);
			const step = updateCallouts(store.snapshot.callouts!.steps.S1, 'src/solver.cpp', threadFacts(THREADS), TEXT, new Set([5]));
			store.writeStepCallouts('S1', revealCallouts(step, 'normal', 't1').step);
			const got = await call('get_callouts');
			assert.deepStrictEqual((got.callouts as { id: string; place: string; kind: string; status: string }[]).map((c) => [c.id, c.place, c.kind, c.status]),
				[['C1', 'src/solver.cpp:5', 'problem', 'open']]);
			await assert.rejects(call('submit_explanation', { callout: 'C9', text: 'x' }), /Step 1 has no callout C9/);
			await call('submit_explanation', { line: 5, text: 'The worker thread can change plan.steps while the loop reads it.' });
			assert.strictEqual(store.snapshot.callouts!.steps.S1.callouts[0].explanation?.text, 'The worker thread can change plan.steps while the loop reads it.');
			// a question must be in the words of the user
			await assert.rejects(call('submit_line_answer', { file: 'src/solver.cpp', line: 5, question: 'Is the loop safe?', answer: 'No.' }),
				/The question is not in the recent prompts of the user/);
			prompts.add('Does the loop on line 5 read plan.steps with no lock?');
			const out = await call('submit_line_answer', {
				file: 'src/solver.cpp', line: 5, question: 'Does the loop on line 5 read plan.steps with no lock?', answer: 'Yes. The worker thread writes it at the same time.',
			});
			assert.deepStrictEqual(out.answer, { id: 'A1', place: 'src/solver.cpp:5', engineFacts: 2 });
			const answer = store.snapshot.callouts!.answers[0];
			assert.deepStrictEqual(answer.facts, [
				'In solve, lines 3-9.',
				'plan.steps (Race): the thread of the caller reads 5 · writes 7, the worker thread writes 6, other.cpp:12. no lock.',
			]);
			assert.strictEqual(answer.code, 'for (int i = 0; i < plan.steps; ++i) {');
			// the user closes the callout with a reason, and resolves the question
			assert.throws(() => store.closeCallout('S1', 'C1', '  '), /Give a reason/);
			store.closeCallout('S1', 'C1', 'The worker thread only reads a copy.');
			store.resolveAnswer('A1');
			const m = model();
			assert.deepStrictEqual(m.task?.build?.navigator.callouts.map((c) => [c.status, c.closedReason]), [['closed', 'The worker thread only reads a copy.']]);
			assert.strictEqual(m.task?.build?.navigator.answers[0].resolved, true);
			assert.deepStrictEqual(store.snapshot.decisions.slice(-4).map((d) => decisionText(d)), [
				'Claude explained the callout C1 of step S1.',
				'Claude answered your question about src/solver.cpp:5: "Does the loop on line 5 read plan.steps with no lock?".',
				'You closed the callout "plan.steps: race" of step S1: not a problem. Your reason: "The worker thread only reads a copy.".',
				'You resolved the question A1.',
			]);
		});

		test('The navigator shows the voice and the state of each callout, and the status bar counts the open problems', () => {
			store.startCallouts('S1', []);
			const facts = [...threadFacts(THREADS), ...hiddenFacts(HIDDEN)];
			const step = updateCallouts(store.snapshot.callouts!.steps.S1, 'src/solver.cpp', facts, TEXT, new Set([5, 6, 8]));
			store.writeStepCallouts('S1', revealCallouts(step, 'normal', 't1').step);
			const nav = model().task!.build!.navigator;
			assert.deepStrictEqual([nav.step, nav.voice, nav.open, nav.maxPerPause, nav.pauseSeconds], ['S1', 'normal', 2, 3, 2]);
			assert.deepStrictEqual(nav.callouts.map((c) => [c.kind, c.status]), [['problem', 'open'], ['warning', 'open'], ['info', 'held']]);
			assert.strictEqual(statusOf(store.snapshot).text, 'Shotgun: 1 problem on your lines');
			assert.strictEqual(isFromView({ type: 'setVoice', voice: 'quiet' }), true);
			assert.strictEqual(isFromView({ type: 'setVoice', voice: 'loud' }), false);
			assert.strictEqual(isFromView({ type: 'showInDataFlow', path: path.join(root, 'a.cpp'), line: 3, source: 'threads' }), true);
		});
	});
});
