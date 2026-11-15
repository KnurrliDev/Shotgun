import * as assert from 'assert';
import { GATE_OF, GATES, isGate, isStage, passGate, Progress, returnStages, returnTo, STAGES, stageText, START } from '../../session/stages';

// The state machine of the stages and the gates
suite('Stages and gates', () => {
	const time = '2026-11-14T10:00:00.000Z';

	test('The 5 gates take a task from the brief to done', () => {
		let progress: Progress = START;
		for (const stage of STAGES) {
			assert.strictEqual(progress.stage, stage);
			assert.strictEqual(progress.isDone, false);
			progress = passGate(progress, GATE_OF[stage], time);
		}
		assert.strictEqual(progress.isDone, true);
		assert.strictEqual(progress.stage, 'build');
		assert.deepStrictEqual(progress.gates.map((g) => g.gate), [...GATES]);
		assert.deepStrictEqual(progress.gates.map((g) => g.stage), [...STAGES]);
	});

	test('A gate of a different stage, or a gate of a done task, is an error, and the state stays', () => {
		assert.throws(() => passGate(START, 'accept-plan', time),
			/^Error: "Accept the plan" is not the gate of stage 1 of 5, the brief\. The gate of this stage is "The brief is ready"\.$/);
		assert.throws(() => passGate({ stage: 'build', isDone: true, gates: [] }, 'task-done', time), /The task is done/);
		assert.deepStrictEqual(START, { stage: 'brief', isDone: false, gates: [] });
	});

	test('A return to an earlier stage keeps only the gates before it, and a done task can return to each stage (decision 24)', () => {
		let progress: Progress = START;
		for (const stage of ['brief', 'survey', 'order'] as const) {
			progress = passGate(progress, GATE_OF[stage], time);
		}
		// the task is in stage 4, the plan
		assert.deepStrictEqual([progress.stage, returnStages(progress)], ['plan', ['brief', 'survey', 'order']]);
		const back = returnTo(progress, 'survey');
		assert.deepStrictEqual([back.stage, back.isDone, back.gates.map((g) => g.gate)], ['survey', false, ['brief-ready']]);
		assert.deepStrictEqual(returnTo(progress, 'brief').gates, []);
		// the current stage and a later stage are no return
		assert.throws(() => returnTo(progress, 'plan'), /The task is in stage 4 of 5, the plan\. It can return only to an earlier stage\./);
		assert.throws(() => returnTo(progress, 'build'), /It can return only to an earlier stage/);
		assert.deepStrictEqual(returnStages(START), []);
		// a done task can return to each stage, also to the build
		const done: Progress = { stage: 'build', isDone: true, gates: progress.gates };
		assert.deepStrictEqual(returnStages(done), [...STAGES]);
		assert.deepStrictEqual([returnTo(done, 'build').stage, returnTo(done, 'build').isDone], ['build', false]);
	});

	test('The texts and the checks of the names', () => {
		assert.strictEqual(stageText('survey'), 'stage 2 of 5, the survey');
		assert.ok(isStage('plan') && !isStage('done') && !isStage(3));
		assert.ok(isGate('brief-ready') && !isGate('brief'));
	});
});
