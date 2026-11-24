import * as assert from 'assert';
import { rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { DiffFacts, RippleFacts } from '../../dataflow/dataflow-api';
import { calloutLine } from '../../session/callouts';
import { jsonText, readText } from '../../session/files';
import { ledgerMarkdown } from '../../session/ledger';
import { hashLine, LineStore } from '../../session/lines';
import { IS_CASE_SENSITIVE } from '../../session/paths';
import {
	applyReview, capOf, checkReview, currentFixPlan, DEFAULT_OPTIONS, EMPTY_REVIEW, feedbackOf, fixSteps, IssueInput, issuesToCheck, parseReview, ReviewContext,
	ReviewFile, reviewPhase, reviewPrompt, ReviewRound, roundOf, toFix, workPlanOf,
} from '../../session/review';
import { SessionStore, stepNext, workPlan } from '../../session/store';
import { ReviewApi, reviewData, ReviewDeps, submitFixPlan, submitReview } from '../../tools/review';
import { buildModel } from '../../views/model';
import { isFromView } from '../../views/views';
import { fakeEngine, makeProject, SOLVER } from './fixture';

// Stage 6, the review (phases 12 to 14): the checks of the issues, the 2 lists, the rounds, the issues page, the plan of
// the fixes and the fixes. The tests use the store, the tools and the views

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
// diff: the text of the hunk. A different text is a changed hunk in the next round (P23)
const diffFacts = (root: string, diff = '@@ -5,0 +6,1 @@\n+        plan.step(i);'): DiffFacts => ({
	root, base: 'abc1234', suggestedSteps: [],
	files: [{ file: 'src/solver.cpp', lines: 9, hunks: [{ id: 'h1', lines: [6, 6], added: 1, removed: 0, diff }] }],
});
const rippleFacts = (): RippleFacts => ({
	state: 'ready',
	changes: [{ file: 'src/solver.cpp', function: 'solve', lines: [6], bodies: [{ file: 'src/solver.cpp', function: 'solve', depth: 0, lines: [8], steps: [], exits: [] }] }],
});

// A correct plan of the fixes for the issues I1, I2 and U1 (decision 43)
const fixPlan = () => ({
	steps: [
		{
			title: 'Stop at the limit', fixes: ['I1', 'I2'], places: [{ file: 'src/solver.cpp', lines: [6, 6], code: 'plan.step(i);' }],
			text: 'Stop the loop at the cycle limit.', checks: ['The loop stops at the limit.'], decisions: [{ question: 'Stop, or skip the rest of the steps?' }],
		},
		{
			title: 'Log the level', fixes: ['U1'], places: [{ file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }],
			text: 'Give the log line a level.', checks: ['The log line has a level.'], decisions: [],
		},
	],
});

suite('Review', () => {
	let root: string;
	let ctx: ReviewContext;
	const inputOf = (raw: Record<string, unknown>): IssueInput => {
		const checked = checkReview({ issues: [raw] }, ctx);
		assert.deepStrictEqual(checked.problems, []);
		return checked.issues[0];
	};
	// a task in stage 6 after the build with 1 step of the user
	const storeInReview = (): SessionStore => {
		const store = new SessionStore(root, () => new Date(Date.UTC(2026, 10, 17, 10, 0, 0)));
		store.newTask('Cycle limit');
		store.passGate('brief-ready');
		store.passGate('order-tasks');
		store.passGate('accept-order');
		store.writePlan({ steps: [{ id: 'S1', title: 'The limit', task: 'T1', hooks: [], places: [{ file: 'src/solver.cpp', lines: [6, 6] }], text: 'Add the limit.', checks: [], decisions: [] }] });
		store.acceptPlan({ commit: 'abc1234', dirty: [] });
		store.startStep('S1', { writer: 'user', level: null, scope: ['src/solver.cpp'] });
		store.finishStep('S1', 'step-done');
		store.passGate('build-done');
		return store;
	};
	const viewOf = (store: SessionStore) => buildModel({
		version: '0.4.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.2', engine: 'ready' },
		claude: { dataflow: 'connected', marketplace: 'ok', plugin: 'on' }, readLines: (f) => readText(f)?.split(/\r?\n/),
	});

	setup(() => {
		root = makeProject('shotgun-review-');
		ctx = {
			root, folders: [root], isCaseSensitive: IS_CASE_SENSITIVE, readLines: (file) => readText(file)?.split(/\r?\n/),
			tools: ['get_place', 'get_heat', 'get_threads', 'get_callers'], called: new Set(['get_place', 'get_threads']),
			hunks: new Map([['src/solver.cpp', [[6, 6]]]]), ripple: new Map([['src/solver.cpp', [[8, 8]]]]), earlier: [],
		};
	});
	teardown(() => rmSync(root, { recursive: true, force: true }));

	test('The cap on the list to fix comes from the size of the diff (P22)', () => {
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
			/Issue 1: a race starts from the threads of DataFlow\. Call get_threads/,
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
		// a race with the threads of DataFlow and an interleave. Its source can be the model: DataFlow gives 1 run of each
		// worker, and the race can be between 2 runs
		const race = issue({
			title: 'A second solver starts', category: 'race', source: 'model', tools: ['get_threads', 'get_place'],
			scenario: { trigger: 'The limit drops the future.', path: 'The next cycle starts a solver.', result: 'A race.', interleave: 'Run 1 writes x while run 2 writes x.' },
		});
		assert.deepStrictEqual(checkReview({ issues: [race] }, ctx).problems, []);
	});

	test('An issue at the line of a callout that the user closed comes again only with new evidence and the verdict plausible (P35)', () => {
		// the line of a callout now: the line with the text of its key, the nearest to the line of the last check
		const key = `threads|plan|Race|${hashLine('        plan.step(i);')}`;
		assert.deepStrictEqual([calloutLine(['a', 'b', 'c', 'd', 'e', '        plan.step(i);'], { key, line: 4 }), calloutLine(['a'], { key, line: 1 })], [6, undefined]);
		const closed = { file: 'src/solver.cpp', line: 6, source: 'threads' as const, title: 'plan: race', reason: 'The test writes it on purpose.' };
		ctx = { ...ctx, closedCallouts: [closed] };
		const race = (over: Record<string, unknown> = {}): Record<string, unknown> => issue({
			category: 'race', tools: ['get_threads'], scenario: { trigger: 't', path: 'p', result: 'r', interleave: 'Run 1 writes, run 2 reads.' }, ...over,
		});
		const again = checkReview({ issues: [race()] }, ctx).problems;
		assert.ok(again.some((p) => /Issue 1: the user closed the callout "plan: race" at src\/solver\.cpp:6 as "Not a problem": The test writes it/.test(p)), again.join(' | '));
		assert.ok(again.some((p) => /Issue 1: the problem of a callout that the user closed comes again only with the verdict plausible/.test(p)), again.join(' | '));
		// with new evidence and the verdict plausible, Shotgun takes the issue
		const ok = checkReview({ issues: [race({ verdict: 'plausible', evidence: 'The write also starts the solver again.' })] }, ctx);
		assert.deepStrictEqual([ok.problems, ok.issues[0]?.evidence], [[], 'The write also starts the solver again.']);
		// an issue of a different category at the line, or a callout at a different line, is a different problem
		assert.deepStrictEqual(checkReview({ issues: [issue()] }, ctx).problems, []);
		ctx = { ...ctx, closedCallouts: [{ ...closed, line: 8 }] };
		assert.deepStrictEqual(checkReview({ issues: [race()] }, ctx).problems, []);
	});

	test('The lists: the confirmed new issues up to the cap are to fix, the important issues first, and the others are for later', () => {
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
		assert.deepStrictEqual([review.rounds[0].cap, review.nextId, review.sequence], [3, 7, ['I2', 'I5', 'I6']]);
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

	test('The parts of a round: the review, the issues, the plan of the fixes and the fixes. The next round starts after the fixes (P23, decision 43)', () => {
		assert.deepStrictEqual(reviewPhase(undefined), { phase: 'review', round: 1 });
		const round = { n: 1, effort: 'low' as const, areas: ['correctness' as const], changedLines: 1, hunks: [] };
		const review = applyReview(EMPTY_REVIEW, round, [inputOf(issue())], 't').review;
		const at = (gates: Partial<ReviewRound>) => reviewPhase({ ...review, rounds: review.rounds.map((r) => ({ ...r, ...gates })) });
		assert.deepStrictEqual([reviewPhase(review), at({ accepted: 'a' }), at({ accepted: 'a', planAccepted: 'b' }), at({ accepted: 'a', planAccepted: 'b', fixesDone: 'c' })],
			[{ phase: 'issues', round: 1 }, { phase: 'plan', round: 1 }, { phase: 'fixes', round: 1 }, { phase: 'review', round: 2 }]);
		// a fixed issue alone starts no new round
		assert.strictEqual(roundOf({ ...review, issues: review.issues.map((i) => ({ ...i, state: 'fixed' as const })) }), 1);
		assert.strictEqual(roundOf({ ...review, rounds: review.rounds.map((r) => ({ ...r, fixesDone: 'c' })) }), 2);
	});

	test('review.json keeps the base, the options, the rounds, the issues, the sequence, the notes, the issues of the user and the plans of the fixes', () => {
		const first = applyReview(EMPTY_REVIEW, { n: 1, effort: 'high', areas: ['threads'], text: 'Look at the locks.', changedLines: 120, hunks: ['a1b2c3'], note: 'All read.' },
			[inputOf(issue({ fixPlaces: [{ file: 'src/solver.cpp', lines: [8, 8], code: 'return plan.result();' }] })), inputOf(issue({ title: 'Later' }))], 't').review;
		const review: ReviewFile = {
			...first,
			rounds: first.rounds.map((r) => ({ ...r, accepted: 't1', planAccepted: 't2' })),
			issues: first.issues.map((i) => (i.id === 'I2' ? { ...i, list: 'second' as const, secondReason: 'later' as const } : i)),
			base: { commit: 'abc1234', dirty: ['README.md'], time: 't0' }, options: { effort: 'high', areas: ['threads'], text: 'Look at the locks.' },
			sequence: ['I1', 'U1'], notes: { I1: 'Use an atomic.' }, nextUserId: 2,
			userIssues: [{ id: 'U1', text: 'The log line has no level.', round: 1, list: 'steps', state: 'open' }],
			fixPlans: [{
				round: 1, time: 't2', steps: [{
					id: 'F1', title: 'Stop', task: 'review', hooks: [], places: [{ file: 'src/solver.cpp', lines: [6, 6], code: 'plan.step(i);', codeLine: 6 }], text: 'x',
					checks: ['y'], decisions: [], fixes: ['I1', 'U1'],
				}],
			}],
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

	test('Stage 6 in the store, the tools and the views: the base, the options, the review, the closed issues and the gates', async () => {
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

		// before the review: the gate "The task is done" with a warning
		let task = viewOf(store).task!;
		assert.deepStrictEqual([task.review?.phase, task.gate?.label, task.gate?.warning], ['review', 'The task is done', 'Claude did not review the task yet.']);

		// get_review and submit_review
		const data = await reviewData(deps) as Record<string, any>;
		assert.deepStrictEqual([data.round, data.phase, data.effort.level, data.capOnSteps, data.base.commit, data.base.notCommittedBefore], [1, 'review', 'high', 3, 'abc1234', ['README.md']]);
		assert.deepStrictEqual(data.files[0].hunks.map((h: { id: string }) => h.id), ['h1']);
		assert.deepStrictEqual(data.ripple[0], { file: 'src/solver.cpp', function: 'solve', depth: 0, lines: '8' });
		await assert.rejects(submitReview(deps, { issues: [issue({ place: { file: 'src/solver.cpp', lines: [1, 1], code: '#include "solver.h"' } })] }),
			/not in the diff of the task or in its ripple/);
		const result = await submitReview(deps, { issues: [issue(), issue({ title: 'Maybe', verdict: 'plausible' })], note: 'All read.' }) as Record<string, any>;
		assert.deepStrictEqual([result.round, result.toFix.map((i: { id: string }) => i.id), result.forLater.map((i: { id: string }) => i.id)], [1, ['I1'], ['I2']]);
		assert.match(result.next, /The issues page of Shotgun shows the issues to fix and the issues for later/);
		assert.deepStrictEqual(store.snapshot.review?.rounds.map((r) => [r.n, r.effort, r.cap, r.changedLines, r.note]), [[1, 'high', 3, 1, 'All read.']]);

		// the views: the 2 lists, the prompt and the gates
		task = viewOf(store).task!;
		const first = task.review!.toFix[0];
		assert.deepStrictEqual([task.review?.toFix.map((r) => r.issue.id), task.review?.later.map((r) => (r.kind === 'review' ? r.issue.listReason : '')), task.request],
			[['I1'], ['Plausible: the verify pass did not confirm the failure scenario.'], undefined]);
		assert.deepStrictEqual(first.kind === 'review' ? first.issue.place : undefined, { name: 'src/solver.cpp:6', path: path.join(root, 'src', 'solver.cpp'), line: 6, lines: [6, 6] });
		assert.match(task.review?.prompt ?? '', /at the effort high with the focus threads and races\. Look also at this point of mine: Look at the locks\./);
		assert.deepStrictEqual([task.gate?.label, task.gate?.after, task.review?.taskDone.label, task.review?.taskDone.warning],
			['Accept the issues', 'Plan the fixes.', 'The task is done', '1 issue to fix is open. The ledger keeps them as open.']);
		assert.ok(task.ledger);

		// "Not a problem" with a reason, and open again. With no issue to fix, the gate is "The task is done"
		store.setIssueClosed('I1', '  The loop has a limit in plan.steps. ');
		assert.deepStrictEqual(store.snapshot.review?.issues.find((i) => i.id === 'I1')?.closed, { reason: 'The loop has a limit in plan.steps.', time: '2026-11-17T10:00:00.000Z' });
		assert.throws(() => store.setIssueClosed('I1', ' '), /Give the reason/);
		task = viewOf(store).task!;
		assert.deepStrictEqual([task.review?.open, task.review?.closed, task.gate?.label, task.gate?.warning], [0, 1, 'The task is done', undefined]);
		assert.throws(() => store.acceptIssues(), /The list to fix has no issue/);
		store.setIssueClosed('I1', undefined);
		assert.deepStrictEqual([store.snapshot.review?.issues.find((i) => i.id === 'I1')?.state, store.snapshot.review?.sequence], ['open', ['I1']]);
		const kinds = store.snapshot.decisions.map((d) => d.kind);
		assert.deepStrictEqual(kinds.slice(-4), ['review-options', 'review', 'issue-close', 'issue-open']);

		// the commit message in stage 6 (P24), and the gate "The task is done"
		store.writeMessageCheck({ message: 'Add the limit', agrees: true, points: [{ kind: 'ok', text: 'The limit is there.' }] });
		assert.strictEqual(store.snapshot.message?.agrees, true);
		store.passGate('task-done');
		assert.deepStrictEqual([store.snapshot.task?.stage, store.snapshot.task?.isDone], ['review', true]);
		await assert.rejects(reviewData(deps), /The task is done/);
	});

	test('A round goes from the issues through the plan of the fixes to the fixes, and the next round checks the fixes (decision 43)', async () => {
		const store = storeInReview();
		const lines = new LineStore();
		lines.track('src/solver.cpp', SOLVER.split('\n'));
		let hunk: string | undefined;
		const api: ReviewApi = { diff: async () => diffFacts(root, hunk), ripple: async () => rippleFacts() };
		const deps: ReviewDeps = {
			store, folders: () => [root], readText, engine: () => fakeEngine(), calls: () => new Set(['get_place']), review: () => api, lines, log: () => undefined,
		};
		const phase = () => reviewPhase(store.snapshot.review);
		const ids = () => toFix(store.snapshot.review).map((x) => x.issue.id);

		// before the first review, stage 6 has no step
		assert.deepStrictEqual([phase(), workPlan(store.snapshot)?.steps.map((s) => s.id), store.current], [{ phase: 'review', round: 1 }, ['S1'], undefined]);
		await submitReview(deps, { issues: [issue(), issue({ title: 'Maybe', verdict: 'plausible' }), issue({ title: 'Old', origin: 'pre-existing' })] });
		assert.deepStrictEqual([phase(), ids(), store.current], [{ phase: 'issues', round: 1 }, ['I1'], undefined]);
		assert.match(stepNext(store.snapshot, undefined)?.next ?? '', /^Round 1: the user puts the issues to fix in sequence on the issues page/);

		// the issues page: an issue of the user, "Fix it", a move and a note. Shotgun does not move an issue
		store.addUserIssue('  The log line has   no level. ');
		store.setIssueStep('I2', true);
		store.moveIssue('I2', -1);
		store.setIssueNote('I1', ' Use an atomic. ');
		assert.deepStrictEqual([ids(), store.snapshot.review?.userIssues?.map((u) => [u.id, u.text]), store.snapshot.review?.notes],
			[['I1', 'I2', 'U1'], [['U1', 'The log line has no level.']], { I1: 'Use an atomic.' }]);
		assert.throws(() => store.moveIssue('I3', 1), /The issue I3 is not in the list to fix/);
		assert.throws(() => store.addUserIssue(' '), /An issue of yours needs a text of 1 to 300 characters/);

		// "Not now" for an important new issue that the review confirmed: the check gives a warning before the gate
		store.setIssueStep('I1', false);
		let task = viewOf(store).task!;
		assert.deepStrictEqual([task.review?.toFix.map((r) => r.issue.id), task.review?.later.map((r) => [r.issue.id, r.kind === 'review' ? r.issue.listReason : ''])],
			[['I2', 'U1'], [['I1', 'You keep it for later.'], ['I3', 'Pre-existing: the problem was in the code before the task.']]]);
		assert.deepStrictEqual([task.review?.checks, task.gate?.label],
			[[{ text: 'I1 is important and confirmed, but it is in the list for later.', isWarning: true }], 'Accept with 1 warning']);
		store.setIssueStep('I1', true);
		store.moveIssue('I1', -1);
		store.moveIssue('I1', -1);
		task = viewOf(store).task!;
		assert.deepStrictEqual([ids(), task.review?.checks, task.gate?.label, task.review?.canEditIssues], [['I1', 'I2', 'U1'], [], 'Accept the issues', true]);

		// the plan of the fixes comes only after the gate "Accept the issues"
		await assert.rejects(submitFixPlan(deps, fixPlan()), /The user did not accept the issues of this round yet/);
		assert.strictEqual(store.acceptIssues(), 3);
		assert.deepStrictEqual([phase(), stepNext(store.snapshot, undefined)?.request], [{ phase: 'plan', round: 1 }, 'Plan the fixes.']);
		assert.throws(() => store.setIssueStep('I3', true), /You accepted the issues of this round/);
		await assert.rejects(submitReview(deps, { issues: [issue()] }), /The user accepted the issues of this round/);
		task = viewOf(store).task!;
		assert.deepStrictEqual([task.gate?.label, task.gate?.isEnabled, task.gate?.reason, task.review?.canEditIssues, task.review?.canWriteNotes],
			['Accept the fix plan', false, 'Claude did not give the plan of the fixes yet. Tell Claude: "Plan the fixes."', false, true]);
		const data = await reviewData(deps) as Record<string, any>;
		assert.deepStrictEqual([data.phase, data.firstStepId, data.issuesToFix.map((i: { id: string }) => i.id), data.issuesToFix[0].userNote, data.issuesToFix[2]],
			['plan', 'F1', ['I1', 'I2', 'U1'], 'Use an atomic.', { id: 'U1', byUser: true, text: 'The log line has no level.' }]);

		// each issue to fix needs a step, in the sequence of the user
		await assert.rejects(submitFixPlan(deps, { steps: [fixPlan().steps[1], { ...fixPlan().steps[0], fixes: ['I1', 'I9'] }] }), (error: Error) => {
			assert.match(error.message, /The issue I2 has no step/);
			assert.match(error.message, /Step 2: I9 is not an issue to fix of this round/);
			assert.match(error.message, /The step for I1 comes after a step for a later issue/);
			return true;
		});
		const planned = await submitFixPlan(deps, fixPlan()) as Record<string, any>;
		assert.deepStrictEqual(planned.steps.map((s: { id: string; fixes: string[] }) => [s.id, s.fixes]), [['F1', ['I1', 'I2']], ['F2', ['U1']]]);
		task = viewOf(store).task!;
		assert.deepStrictEqual(task.review?.fixPlan?.steps.map((s) => [s.ref, s.fixes, s.taskText]), [
			['F1', ['I1', 'I2'], 'Fixes I1: The loop runs past the limit; I2: Maybe'],
			['F2', ['U1'], 'Fixes U1: The log line has no level.'],
		]);
		assert.deepStrictEqual([task.gate?.label, task.gate?.isEnabled], ['Accept the fix plan', true]);

		// the user sets the levels and the writers of the steps of the fixes before the gate (decision 44): a step of level 5
		// goes to Claude, and a step of level 2 gets a frame
		const setChoices = () => {
			store.setLevel('F1', 5);
			store.setWriter('F1', 'claude');
			store.setLevel('F2', 2);
			store.setWriter('F2', 'frame');
		};
		setChoices();
		task = viewOf(store).task!;
		assert.deepStrictEqual(task.review?.fixPlan?.steps.map((s) => [s.level, s.writer, s.isWriterChosen, s.isLevelEditable]), [[5, 'claude', true, true], [2, 'frame', true, true]]);

		// a new plan keeps a choice of the user only for a step with the same id, title and issues, because the ids of the
		// steps of the fixes come from their places in the plan
		const changed = fixPlan();
		changed.steps[0] = { ...changed.steps[0], title: 'Check the limit before the call' };
		await submitFixPlan(deps, changed);
		const choices = () => ['F1', 'F2'].map((id) => store.snapshot.levels?.levels[id] && [store.snapshot.levels.levels[id].level, store.snapshot.levels.levels[id].writer]);
		assert.deepStrictEqual(choices(), [undefined, [2, 'frame']]);

		// "Back to the issues" removes the plan of the round with the choices for its steps. The user accepts the issues again,
		// and Claude gives the plan again
		store.reopenIssues();
		assert.deepStrictEqual([phase(), store.snapshot.review?.fixPlans ?? [], choices()], [{ phase: 'issues', round: 1 }, [], [undefined, undefined]]);
		store.acceptIssues();
		await submitFixPlan(deps, fixPlan());
		setChoices();
		assert.strictEqual(store.acceptFixPlan(), 2);
		assert.deepStrictEqual([phase(), workPlan(store.snapshot)?.steps.map((s) => s.id), store.current?.ref, store.current?.writer],
			[{ phase: 'fixes', round: 1 }, ['S1', 'F1', 'F2'], 'F1', 'claude']);
		assert.match(stepNext(store.snapshot, store.current)?.next ?? '', /step F1 of the fixes, "Stop at the limit", for I1 and I2/);

		// the steps of the fixes go in sequence, as the steps of the build. The gate of the last step of an issue fixes it
		store.setWriter('F1', undefined);
		store.startStep('F1', { writer: 'user', level: 5, scope: ['src/solver.cpp'] });
		store.finishStep('F1', 'step-done');
		assert.deepStrictEqual(store.snapshot.review?.issues.filter((i) => i.state === 'fixed').map((i) => i.id), ['I1', 'I2']);
		assert.throws(() => store.finishFixes(), /Step F2 of the fixes is not done/);
		task = viewOf(store).task!;
		assert.deepStrictEqual([task.build?.current?.ref, task.build?.current?.writer, task.build?.current?.fixesText, task.gate?.label, task.gate?.reason],
			['F2', 'frame', 'Fixes U1: The log line has no level.', 'The fixes are done', '1 step of the fixes is not done.']);
		store.setWriter('F2', 'user');
		store.startStep('F2', { writer: 'user', level: 2, scope: ['src/solver.cpp'] });
		store.finishStep('F2', 'step-done');
		assert.deepStrictEqual(store.snapshot.review?.userIssues?.map((u) => u.state), ['fixed']);
		assert.match(stepNext(store.snapshot, undefined)?.next ?? '', /^Each step of the fixes is done/);
		assert.deepStrictEqual([viewOf(store).task?.gate?.isEnabled, store.finishFixes(), phase()], [true, 2, { phase: 'review', round: 2 }]);

		// round 2 checks the fixes: the changed hunks, and the issues that the fixes of round 1 fixed (P23)
		hunk = '+    6 | if (i >= limit) break;\n+    7 | plan.step(i);';
		const data2 = await reviewData(deps) as Record<string, any>;
		assert.deepStrictEqual([data2.round, data2.phase, data2.fixedIssues.map((i: { id: string }) => i.id), data2.files[0].hunks[0].isChangedSinceLastRound],
			[2, 'review', ['I1', 'I2'], true]);
		assert.match(viewOf(store).task!.review!.prompt, /^Review the fixes of my Shotgun task "Cycle limit" in round 2 with the skill shotgun-review/);

		// round 2 gives I1 again: it is in the list to fix again, and the steps of the fixes of round 2 start at F3
		await submitReview(deps, { issues: [issue({ repeats: 'I1', summary: 'The fix checks the limit after the call.' })] });
		assert.deepStrictEqual([phase(), ids()], [{ phase: 'issues', round: 2 }, ['I1']]);
		store.acceptIssues();
		assert.strictEqual((await reviewData(deps) as Record<string, any>).firstStepId, 'F3');
		assert.deepStrictEqual(store.snapshot.decisions.map((d) => d.kind).filter((k) => /^(issue|user-issue|review-gate|fix-plan)/.test(k)), [
			'user-issue', 'issue-step', 'issue-move', 'issue-note', 'issue-step', 'issue-step', 'issue-move', 'issue-move', 'review-gate', 'fix-plan',
			'fix-plan', 'review-gate', 'review-gate', 'fix-plan', 'review-gate', 'review-gate', 'review-gate',
		]);
		const texts = viewOf(store).decisions.map((d) => d.text);
		assert.ok(texts.includes('You moved the issue I1 to place 1 of the list to fix.'), texts.join(' | '));
		assert.ok(texts.includes('You accepted the issues of round 2: 1 issue to fix.'), texts.join(' | '));
	});

	test('The feedback of all tasks moves the cap and finds a noisy area (P35), a new round checks the fixes (P23), and the pull request gets the issues (P24)', () => {
		const round = { n: 1, effort: 'medium' as const, areas: ['correctness' as const], changedLines: 1, hunks: ['x'] };
		// 5 reviews with 3 issues to fix each: the user fixed the issues of the ranks 1 and 2, and closed each issue of rank 3
		const reviews = [1, 2, 3, 4, 5].map(() => {
			const r = applyReview(EMPTY_REVIEW, round, ['A', 'B', 'C'].map((title) => inputOf(issue({ title }))), 't').review;
			return {
				...r, issues: r.issues.map((i) => (i.rank === 3 ? { ...i, state: 'closed' as const, closed: { reason: 'Not real.', time: 'u' } }
					: { ...i, state: 'fixed' as const, fixed: 'u' })),
			};
		});
		const feedback = feedbackOf(reviews);
		assert.deepStrictEqual([feedback.decided, feedback.cap, feedback.areas], [15, 2, [{ area: 'correctness', decided: 15, noAction: 5, isTooNoisy: true }]]);
		assert.strictEqual(feedbackOf(reviews.slice(0, 3)).cap, undefined);
		// the cap of the feedback: the third confirmed issue is for later
		const capped = applyReview(EMPTY_REVIEW, round, ['A', 'B', 'C'].map((title) => inputOf(issue({ title }))), 't', { capLimit: feedback.cap }).review;
		assert.deepStrictEqual([capped.issues.map((i) => `${i.list}${i.rank ? ` ${i.rank}` : ''}`), capped.rounds[0].cap], [['steps 1', 'steps 2', 'second'], 2]);

		// the next round checks only the issues that the user fixed after the last round
		const done = reviews[0];
		assert.deepStrictEqual(issuesToCheck(done).map((i) => i.id), ['I1', 'I2']);
		assert.deepStrictEqual(issuesToCheck({ ...done, issues: done.issues.map((i) => ({ ...i, fixed: 'a' })) }), []);
		assert.match(reviewPrompt('Cycle limit', DEFAULT_OPTIONS, 2), /^Review the fixes of my Shotgun task "Cycle limit" in round 2 with the skill shotgun-review/);

		// the text for the pull request has the issues with their states and the reasons of the user
		const markdown = ledgerMarkdown('Cycle limit', [], [], done.issues.map((i) => ({
			id: i.id, title: i.title, severity: i.severity, category: i.category, list: i.list, state: i.state, ...(i.closed ? { reason: i.closed.reason } : {}),
		})));
		assert.match(markdown, /### Issues of the review\n\nTo fix:\n\n- I1 \(important, correctness\): A\. fixed\n- I2 \(important, correctness\): B\. fixed\n- I3 \(important, correctness\): C\. not a problem: Not real\.\n/);
	});

	test('After 3 rounds, the panel asks first (P23), and the page shows the feedback of the user for each area (P35)', () => {
		const roundOfN = (n: number) => ({ n, effort: 'medium' as const, areas: ['correctness' as const], changedLines: 100, hunks: [`h${n}`] });
		let review: ReviewFile = EMPTY_REVIEW;
		for (const n of [1, 2, 3]) {
			review = applyReview(review, roundOfN(n), ['A', 'B', 'C', 'D'].map((t) => inputOf(issue({ title: `${t}${n}` }))), `2026-11-1${n}T10:00:00.000Z`).review;
			// the user fixes the issues of the ranks 1 to 3, and closes the issue of rank 4 in the rounds 1 and 2. Then the round
			// passes its 3 gates
			review = {
				...review,
				rounds: review.rounds.map((r) => (r.n === n ? { ...r, accepted: 'a', planAccepted: 'b', fixesDone: 'c' } : r)),
				issues: review.issues.map((i) => (i.lastRound !== n ? i : i.rank === 4 && n < 3 ? { ...i, state: 'closed' as const, closed: { reason: 'No.', time: 't' } }
					: { ...i, state: 'fixed' as const, fixed: `2026-11-1${n}T11:00:00.000Z` })),
			};
		}
		const store = new SessionStore(root, () => new Date(Date.UTC(2026, 10, 17, 10, 0, 0)));
		store.newTask('Rounds');
		store.passGate('brief-ready');
		store.passGate('order-tasks');
		store.passGate('accept-order');
		store.writePlan({ steps: [{ id: 'S1', title: 'A', task: 'T1', hooks: [], places: [], text: 'x', checks: [], decisions: [] }] });
		store.acceptPlan({ commit: 'abc1234', dirty: [] });
		store.passGate('build-done');
		writeFileSync(path.join(store.dir!, store.snapshot.task!.id, 'review.json'), jsonText({ ...review, base: store.snapshot.review!.base }));
		store.load();
		const brief = '# Brief: Rounds\n\n## Specs\n\n- The loop stops at the limit.\n<!-- a hint -->\n\n## Not in scope\n\n- A time limit.\n\n## Done when\n\n1. A test passes.\n';
		const task = buildModel({
			version: '0.3.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.2', engine: 'ready' },
			claude: { dataflow: 'connected', marketplace: 'ok', plugin: 'on' }, readLines: (f) => readText(f)?.split(/\r?\n/),
			brief: { file: store.briefFile()!, text: brief, isDirty: false },
		}).task!;
		// the page shows the parts of the brief next to the issues of the area The brief
		assert.deepStrictEqual(task.review?.brief, { specs: ['The loop stops at the limit.'], scope: ['A time limit.'], done: ['A test passes.'] });
		assert.deepStrictEqual([task.review?.phase, task.review?.roundNumber, task.review?.nextRound, task.review?.isNewRound, task.review?.toCheck], ['review', 4, 4, true, 4]);
		assert.match(task.review?.roundWarning ?? '', /^The next review is round 4\. After 3 rounds, the issues did not end\./);
		assert.match(task.review?.prompt ?? '', /^Review the fixes of my Shotgun task "Rounds" in round 4/);
		assert.deepStrictEqual(task.review?.feedback?.areas, [{ id: 'correctness', name: 'Correctness', decided: 12, noAction: 2, rate: '17%', isTooNoisy: true, isInFocus: true }]);
		assert.match(task.review?.feedback?.text ?? '', /^You decided 12 issues of the lists to fix in this folder\. Your feedback sets the cap on the list to fix to 3 issues or fewer\./);
	});

	test('The work plan has the steps of the accepted plans of the fixes, after the steps of the plan', () => {
		const round = { n: 1, effort: 'medium' as const, areas: ['correctness' as const], changedLines: 1, hunks: ['x'] };
		const review = applyReview(EMPTY_REVIEW, round, [inputOf(issue({ title: 'A' }))], 't1').review;
		const planned: ReviewFile = {
			...review, rounds: review.rounds.map((r) => ({ ...r, accepted: 't2' })),
			fixPlans: [{ round: 1, time: 't3', steps: [{ id: 'F1', title: 'Fix A', task: 'review', hooks: [], places: [], text: 'x', checks: ['y'], decisions: [], fixes: ['I1'] }] }],
		};
		// before the gate "Accept the fix plan", the plan of the round is no part of the work plan
		assert.deepStrictEqual([fixSteps(planned), currentFixPlan(planned)?.steps.map((s) => s.id)], [[], ['F1']]);
		const accepted: ReviewFile = { ...planned, rounds: planned.rounds.map((r) => ({ ...r, planAccepted: 't4' })) };
		const plan = { steps: [{ id: 'S1', title: 'S', task: 'T1', hooks: [], places: [], text: 'x', checks: [] }] };
		assert.deepStrictEqual([fixSteps(accepted).map((s) => s.id), workPlanOf(plan, accepted, 'review')?.steps.map((s) => s.id), workPlanOf(plan, accepted, 'build')?.steps.length],
			[['F1'], ['S1', 'F1'], 1]);
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
		assert.strictEqual(isFromView({ type: 'setIssueStep', id: 'I2', isStep: true }), true);
		assert.strictEqual(isFromView({ type: 'setIssueStep', id: 'I2', isStep: 'yes' }), false);
		assert.strictEqual(isFromView({ type: 'stepGate' }), true);
		// the issues page (decision 43)
		assert.strictEqual(isFromView({ type: 'moveIssue', id: 'I1', step: -1 }), true);
		assert.strictEqual(isFromView({ type: 'moveIssue', id: 'I1', step: 2 }), false);
		assert.strictEqual(isFromView({ type: 'setIssueNote', id: 'I1', note: 'Use an atomic.' }), true);
		assert.strictEqual(isFromView({ type: 'setIssueNote', id: 'I1' }), false);
		assert.strictEqual(isFromView({ type: 'addUserIssue', text: 'The log line has no level.' }), true);
		assert.strictEqual(isFromView({ type: 'addUserIssue', text: 'x'.repeat(2001) }), false);
		assert.strictEqual(isFromView({ type: 'removeUserIssue', id: 'U1' }), true);
		assert.strictEqual(isFromView({ type: 'reopenIssues' }), true);
		assert.strictEqual(isFromView({ type: 'taskDone' }), true);
	});
});
