import * as assert from 'assert';
import { rmSync } from 'fs';
import * as path from 'path';
import type { DiffFacts, RippleFacts } from '../../dataflow/dataflow-api';
import { jsonText, readText } from '../../session/files';
import { LineStore } from '../../session/lines';
import { IS_CASE_SENSITIVE } from '../../session/paths';
import {
	applyReview, capOf, checkReview, DEFAULT_OPTIONS, EMPTY_REVIEW, IssueInput, parseReview, ReviewContext, ReviewFile, reviewPrompt, roundOf,
} from '../../session/review';
import { SessionStore } from '../../session/store';
import { ReviewApi, reviewData, ReviewDeps, submitReview } from '../../tools/review';
import { buildModel } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, SOLVER } from './fixture';

// Stage 6, the review (phase 12): the checks of the issues of Claude, the 2 lists, the rounds, the store, the tools and
// the views

// A correct issue of Claude at the changed line 6 of src/solver.cpp
const issue = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	title: 'The loop runs past the limit',
	summary: 'plan.step(i) runs for each step with no check of the cycle limit.',
	scenario: { trigger: 'A plan with 20 steps.', path: 'solve() calls plan.step(i) in the loop.', result: 'The controller waits 20 cycles.' },
	category: 'correctness', severity: 'important', origin: 'new', verdict: 'confirmed', source: 'model',
	place: { file: 'src/solver.cpp', lines: [6, 6], code: 'plan.step(i);' },
	decisions: [{ question: 'Stop at the limit, or skip the rest of the steps?' }],
	tools: ['get_place'],
	...over,
});

// The diff of DataFlow with 1 added line 6 in solver.cpp, and a ripple that reaches line 8
const diffFacts = (root: string): DiffFacts => ({
	root, base: 'abc1234', suggestedSteps: [],
	files: [{ file: 'src/solver.cpp', lines: 9, hunks: [{ id: 'h1', lines: [6, 6], added: 1, removed: 0, diff: '@@ -5,0 +6,1 @@\n+        plan.step(i);' }] }],
});
const rippleFacts = (): RippleFacts => ({
	state: 'ready',
	changes: [{ file: 'src/solver.cpp', function: 'solve', lines: [6], bodies: [{ file: 'src/solver.cpp', function: 'solve', depth: 0, lines: [8], steps: [], exits: [] }] }],
});

suite('Review', () => {
	let root: string;
	let ctx: ReviewContext;
	const inputOf = (raw: Record<string, unknown>): IssueInput => {
		const checked = checkReview({ issues: [raw] }, ctx);
		assert.deepStrictEqual(checked.problems, []);
		return checked.issues[0];
	};

	setup(() => {
		root = makeProject('shotgun-review-');
		ctx = {
			root, folders: [root], isCaseSensitive: IS_CASE_SENSITIVE, readLines: (file) => readText(file)?.split(/\r?\n/),
			tools: ['get_place', 'get_heat', 'get_threads', 'get_callers'], called: new Set(['get_place', 'get_threads']),
			hunks: new Map([['src/solver.cpp', [[6, 6]]]]), ripple: new Map([['src/solver.cpp', [[8, 8]]]]), earlier: [],
		};
	});
	teardown(() => rmSync(root, { recursive: true, force: true }));

	test('The cap on the steps comes from the size of the diff (P22)', () => {
		assert.deepStrictEqual([capOf(0), capOf(99), capOf(250), capOf(799), capOf(5000)], [3, 3, 5, 10, 10]);
	});

	test('checkReview takes a correct issue, and gives all problems of a wrong review in 1 list', () => {
		const ok = checkReview({ issues: [issue(), issue({ title: 'A null plan', place: { file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }, origin: 'pre-existing' })] }, ctx);
		assert.deepStrictEqual(ok.problems, []);
		assert.deepStrictEqual([ok.issues[0].place.codeLine, ok.issues[0].decisions[0].id, ok.issues[1].origin], [6, 'D1', 'pre-existing']);
		assert.match(checkReview({}, ctx).problems[0], /Give "issues"/);
		const bad = checkReview({
			issues: [
				issue({ category: 'race' }),
				issue({ title: 'Outside', place: { file: 'src/solver.cpp', lines: [1, 1], code: '#include "solver.h"' } }),
				issue({ title: 'Not called', tools: ['get_callers'] }),
				issue({ title: 'Not a tool', tools: ['get_magic'] }),
				issue({ title: 'Wrong code', place: { file: 'src/solver.cpp', lines: [6, 6], code: 'nothing here' } }),
				issue({ title: 'Wrong severity', severity: 'huge' }),
				issue({ title: 'No path', scenario: { trigger: 'x', result: 'y' } }),
				issue({ title: 'Earlier', repeats: 'I9' }),
			],
		}, ctx).problems;
		const expected = [
			/Issue 1: a race needs the "interleave"/,
			/Issue 2: src\/solver\.cpp:1 is not in the diff of the task or in its ripple/,
			/Issue 3: nobody called get_callers in this stage/,
			/Issue 4: "get_magic" is not a read tool of DataFlow/,
			/Issue 5, place: the code "nothing here" is not in the lines 6 to 6/,
			/Issue 6: "severity" must be important or minor/,
			/Issue 7, scenario: give the "path"/,
			/Issue 8: "repeats" names I9, but the earlier review has no such issue/,
		];
		for (const re of expected) {
			assert.ok(bad.some((p) => re.test(p)), `${re} in ${bad.join(' | ')}`);
		}
		const twice = checkReview({ issues: [issue(), issue()] }, ctx).problems;
		assert.ok(twice.some((p) => /is there 2 times/.test(p)), twice.join(' | '));
	});

	test('The lists: the confirmed new issues up to the cap are steps, the important issues first, and the others go into the second list', () => {
		const inputs = [
			inputOf(issue({ title: 'Minor', severity: 'minor' })),
			inputOf(issue({ title: 'Important 1' })),
			inputOf(issue({ title: 'Plausible', verdict: 'plausible' })),
			inputOf(issue({ title: 'Old', origin: 'pre-existing' })),
			inputOf(issue({ title: 'Important 2' })),
			inputOf(issue({ title: 'Important 3' })),
		];
		const { review } = applyReview(EMPTY_REVIEW, { n: 1, effort: 'medium', areas: ['correctness'], changedLines: 1, hunks: ['x'] }, inputs, 't');
		const rows = review.issues.map((i) => `${i.id} ${i.title} ${i.list}${i.secondReason ? ` ${i.secondReason}` : ''}`);
		assert.deepStrictEqual(rows, [
			'I2 Important 1 steps', 'I3 Plausible second plausible', 'I4 Old second pre-existing', 'I5 Important 2 steps', 'I6 Important 3 steps',
			'I1 Minor second cap',
		]);
		assert.deepStrictEqual([review.rounds[0].cap, review.nextId], [3, 7]);
	});

	test('A new review of the same round replaces its open issues, and keeps the closed issues. A repeated issue keeps its id', () => {
		const round = { n: 1, effort: 'medium' as const, areas: ['correctness' as const], changedLines: 1, hunks: ['x'] };
		let review: ReviewFile = applyReview(EMPTY_REVIEW, round, [inputOf(issue({ title: 'A' })), inputOf(issue({ title: 'B' }))], 't1').review;
		review = { ...review, issues: review.issues.map((i) => (i.id === 'I2' ? { ...i, state: 'closed' as const, closed: { reason: 'Not real.', time: 't2' } } : i)) };
		ctx = { ...ctx, earlier: review.issues };
		const again = applyReview(review, round, [inputOf(issue({ title: 'A again', repeats: 'I1' })), inputOf(issue({ title: 'C' }))], 't3');
		assert.deepStrictEqual(again.review.issues.map((i) => `${i.id} ${i.title} ${i.state}`), ['I2 B closed', 'I1 A again open', 'I3 C open']);
		assert.deepStrictEqual([again.added, again.repeated, again.review.rounds.length], [1, 1, 1]);
		// a closed issue comes again only with new evidence and the verdict plausible (P35)
		const closedAgain = checkReview({ issues: [issue({ title: 'B', repeats: 'I2' })] }, ctx).problems;
		assert.ok(closedAgain.some((p) => /closed I2 as "Not a problem": Not real\. Give it again only with new "evidence"/.test(p)), closedAgain.join(' | '));
		assert.ok(closedAgain.some((p) => /comes again only with the verdict plausible/.test(p)), closedAgain.join(' | '));
		const reopened = applyReview(review, round, [inputOf(issue({ title: 'B', repeats: 'I2', evidence: 'A new test fails.', verdict: 'plausible' }))], 't4').review;
		const b = reopened.issues.find((i) => i.id === 'I2')!;
		assert.deepStrictEqual([b.state, b.list, b.secondReason, b.closed, b.evidence], ['open', 'second', 'plausible', undefined, 'A new test fails.']);
		assert.deepStrictEqual(reopened.issues.map((i) => i.id), ['I2']);
	});

	test('The round: 1 for the first review, and the same round while no issue is fixed (P23)', () => {
		assert.strictEqual(roundOf(undefined), 1);
		const round = { n: 1, effort: 'low' as const, areas: ['correctness' as const], changedLines: 1, hunks: [] };
		const review = applyReview(EMPTY_REVIEW, round, [inputOf(issue())], 't').review;
		assert.strictEqual(roundOf(review), 1);
		assert.strictEqual(roundOf({ ...review, issues: review.issues.map((i) => ({ ...i, state: 'fixed' as const })) }), 2);
	});

	test('review.json keeps the base, the options, the rounds and the issues', () => {
		const review = {
			...applyReview(EMPTY_REVIEW, { n: 1, effort: 'high', areas: ['threads'], text: 'Look at the locks.', changedLines: 120, hunks: ['a1b2c3'], note: 'All read.' },
				[inputOf(issue({ fixPlaces: [{ file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }] }))], 't').review,
			base: { commit: 'abc1234', dirty: ['README.md'], time: 't0' }, options: { effort: 'high' as const, areas: ['threads' as const], text: 'Look at the locks.' },
		};
		assert.deepStrictEqual(parseReview(jsonText(review), 'fix'), JSON.parse(jsonText(review)));
		assert.throws(() => parseReview('{"version":2,"rounds":[],"issues":[],"nextId":1}', 'fix'), /reads only version 1/);
		assert.throws(() => parseReview('{"version":1,"rounds":[{"n":1}],"issues":[],"nextId":1}', 'fix'), /A round or an issue/);
	});

	test('The prompt of the review names the skill, the effort and the focus, for a new session of Claude Code', () => {
		assert.strictEqual(reviewPrompt('Cycle limit', DEFAULT_OPTIONS), 'Review my Shotgun task "Cycle limit" with the skill shotgun-review, at the effort medium with '
			+ 'the focus correctness, threads and races, lifetime, the brief and tests. Get the data with shotgun_get_review, start the subagents that the effort '
			+ 'needs, and give the issues with shotgun_submit_review. Change no file.');
		assert.match(reviewPrompt('X', { effort: 'max', areas: ['threads'], text: 'Look at the locks.' }),
			/at the effort max with the focus threads and races\. Look also at this point of mine: Look at the locks\. Get the data/);
	});

	test('Stage 6 in the store, the tools and the views: the base, the options, the review, the closed issues and the gate', async () => {
		const store = new SessionStore(root, () => new Date(Date.UTC(2026, 10, 17, 10, 0, 0)));
		store.newTask('Cycle limit');
		store.passGate('brief-ready');
		store.passGate('order-tasks');
		store.passGate('accept-order');
		store.writePlan({ steps: [{ id: 'S1', title: 'The limit', task: 'T1', hooks: [], places: [{ file: 'src/solver.cpp', lines: [6, 6] }], text: 'Add the limit.', checks: [], decisions: [] }] });
		store.acceptPlan({ commit: 'abc1234', dirty: ['README.md'] });
		assert.deepStrictEqual(store.snapshot.review?.base, { commit: 'abc1234', dirty: ['README.md'], time: '2026-11-17T10:00:00.000Z' });
		assert.throws(() => store.setReviewOptions(DEFAULT_OPTIONS), /only in stage 6, the review/);

		const lines = new LineStore();
		lines.track('src/solver.cpp', SOLVER.split('\n'));
		const api: ReviewApi = { diff: async () => diffFacts(root), ripple: async () => rippleFacts() };
		const deps: ReviewDeps = {
			store, folders: () => [root], readText, engine: () => fakeEngine(), calls: () => new Set(['get_place']), review: () => api, lines, log: () => undefined,
		};
		await assert.rejects(reviewData(deps), /The active task is in stage 5 of 6, the build\. The review is only for stage 6/);
		store.passGate('build-done');
		assert.strictEqual(store.snapshot.task?.stage, 'review');

		// the effort and the focus of the user
		store.setReviewOptions({ effort: 'high', areas: ['threads', 'nope' as 'threads'], text: ' Look   at the locks. ' });
		assert.deepStrictEqual(store.snapshot.review?.options, { effort: 'high', areas: ['threads'], text: 'Look at the locks.' });
		assert.throws(() => store.setReviewOptions({ effort: 'huge' as 'high', areas: ['threads'] }), /The effort must be 1 of low, medium, high, xhigh, max/);
		assert.throws(() => store.setReviewOptions({ effort: 'low', areas: [] }), /Select 1 area of the focus or more/);

		// get_review and submit_review
		const data = await reviewData(deps) as Record<string, any>;
		assert.deepStrictEqual([data.round, data.effort.level, data.capOnSteps, data.base.commit, data.base.notCommittedBefore], [1, 'high', 3, 'abc1234', ['README.md']]);
		assert.deepStrictEqual(data.files[0].hunks.map((h: { id: string }) => h.id), ['h1']);
		assert.deepStrictEqual(data.ripple[0], { file: 'src/solver.cpp', function: 'solve', depth: 0, lines: '8' });
		await assert.rejects(submitReview(deps, { issues: [issue({ place: { file: 'src/solver.cpp', lines: [1, 1], code: '#include "solver.h"' } })] }),
			/not in the diff of the task or in its ripple/);
		const result = await submitReview(deps, { issues: [issue(), issue({ title: 'Maybe', verdict: 'plausible' })], note: 'All read.' }) as Record<string, any>;
		assert.deepStrictEqual([result.round, result.steps.map((i: { id: string }) => i.id), result.second.map((i: { id: string }) => i.id)], [1, ['I1'], ['I2']]);
		assert.deepStrictEqual(store.snapshot.review?.rounds.map((r) => [r.n, r.effort, r.cap, r.changedLines, r.note]), [[1, 'high', 3, 1, 'All read.']]);

		// the views: the 2 lists, the prompt and the gate
		const view = () => buildModel({
			version: '0.2.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.2', engine: 'ready' },
			claude: { dataflow: 'connected', marketplace: 'ok', plugin: 'on' }, readLines: (f) => readText(f)?.split(/\r?\n/),
		}).task!;
		let task = view();
		assert.deepStrictEqual([task.review?.steps.map((i) => i.id), task.review?.second.map((i) => i.listReason), task.request],
			[['I1'], ['Plausible: the verify pass did not confirm the failure scenario.'], undefined]);
		assert.deepStrictEqual(task.review?.steps[0].place, { name: 'src/solver.cpp:6', path: path.join(root, 'src', 'solver.cpp'), line: 6, lines: [6, 6] });
		assert.match(task.review?.prompt ?? '', /at the effort high with the focus threads and races\. Look also at this point of mine: Look at the locks\./);
		assert.deepStrictEqual([task.gate?.label, task.gate?.warning], ['The task is done', '1 issue of the list of steps is open. The ledger keeps them as open.']);
		assert.ok(task.ledger);

		// "Not a problem" with a reason, and open again
		store.setIssueClosed('I1', '  The loop has a limit in plan.steps. ');
		assert.deepStrictEqual(store.snapshot.review?.issues.find((i) => i.id === 'I1')?.closed, { reason: 'The loop has a limit in plan.steps.', time: '2026-11-17T10:00:00.000Z' });
		assert.throws(() => store.setIssueClosed('I1', ' '), /Give the reason/);
		task = view();
		assert.deepStrictEqual([task.review?.open, task.review?.closed, task.gate?.warning], [0, 1, undefined]);
		store.setIssueClosed('I1', undefined);
		assert.strictEqual(store.snapshot.review?.issues.find((i) => i.id === 'I1')?.state, 'open');
		const kinds = store.snapshot.decisions.map((d) => d.kind);
		assert.deepStrictEqual(kinds.slice(-4), ['review-options', 'review', 'issue-close', 'issue-open']);

		// the commit message in stage 6 (P24), and the gate "The task is done"
		store.writeMessageCheck({ message: 'Add the limit', agrees: true, points: [{ kind: 'ok', text: 'The limit is there.' }] });
		assert.strictEqual(store.snapshot.message?.agrees, true);
		store.passGate('task-done');
		assert.deepStrictEqual([store.snapshot.task?.stage, store.snapshot.task?.isDone], ['review', true]);
		await assert.rejects(reviewData(deps), /The task is done/);
	});

	test('A task with no base commit gets no review data, and the base stays from the first gate', async () => {
		const store = new SessionStore(root, () => new Date(Date.UTC(2026, 10, 17, 10, 0, 0)));
		store.newTask('No git');
		store.passGate('brief-ready');
		store.passGate('order-tasks');
		store.passGate('accept-order');
		store.writePlan({ steps: [{ id: 'S1', title: 'A', task: 'T1', hooks: [], places: [], text: 'x', checks: [], decisions: [] }] });
		store.acceptPlan({ dirty: [], error: 'The folder has no repository of git, or the Git extension of VS Code is off.' });
		store.returnToStage('plan');
		store.acceptPlan({ commit: 'later', dirty: [] });
		assert.strictEqual(store.snapshot.review?.base?.commit, undefined);
		store.passGate('build-done');
		const deps: ReviewDeps = {
			store, folders: () => [root], readText, engine: () => undefined, review: () => undefined, lines: new LineStore(), log: () => undefined,
		};
		await assert.rejects(reviewData(deps), /The task has no base commit, so Shotgun cannot give its diff: The folder has no repository of git/);
	});

	test('The webviews send the options of the review, the prompt and the decisions about the issues', () => {
		assert.strictEqual(isFromView({ type: 'setReviewOptions', effort: 'high', areas: ['threads'], text: '' }), true);
		assert.strictEqual(isFromView({ type: 'setReviewOptions', effort: 'high', areas: 'threads', text: '' }), false);
		assert.strictEqual(isFromView({ type: 'copyReviewPrompt' }), true);
		assert.strictEqual(isFromView({ type: 'closeIssue', id: 'I1' }), true);
		assert.strictEqual(isFromView({ type: 'reopenIssue', id: 7 }), false);
	});
});
