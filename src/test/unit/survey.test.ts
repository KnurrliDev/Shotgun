import * as assert from 'assert';
import { readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ClaudeState } from '../../claude/connection';
import { HookDecorations } from '../../editor/hooks';
import { parseDecisions, readText } from '../../session/files';
import { isCppFile, isInside, projectPath } from '../../session/paths';
import { SessionStore } from '../../session/store';
import {
	checkAnswer, checkSurvey, codeLineOf, excerptOf, findHook, heatOf, hookEngineOf, movedHook, parseAnswers, parseEngine, parseSurvey, placeText,
	SurveyContext, typeText,
} from '../../session/survey';
import { stageStart, ToolCallLog } from '../../tools/calls';
import { PromptLog } from '../../tools/prompts';
import type { EngineApi } from '../../tools/survey';
import { shotgunTools } from '../../tools/tools';
import { buildModel, decisionText } from '../../views/model';
import { fakeEngine, heatFacts, makeProject, noBuild, placeFacts, SOLVER, SURVEY, TYPE } from './fixture';

suite('Survey', () => {
	let root: string;
	let store: SessionStore;
	const solver = () => path.join(root, 'src', 'solver.cpp');
	const context = (tools: readonly string[] = ['get_callers', 'get_place']): SurveyContext => ({
		root, folders: [root], isCaseSensitive: true, readLines: (file) => readText(file)?.split(/\r?\n/), tools,
	});
	const tool = (name: string, engine?: EngineApi) => shotgunTools({
		store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => engine, ...noBuild(),
	}).find((t) => t.name === name)!;
	const submit = (args: Record<string, unknown>, engine?: EngineApi) => tool('submit_survey', engine).call(args) as Promise<Record<string, unknown>>;
	// a task in stage 2
	const surveyTask = () => {
		store.newTask('A cycle limit for the solver');
		store.passGate('brief-ready');
	};

	setup(() => {
		root = makeProject('shotgun-survey-');
		store = new SessionStore(root);
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The paths of the project', () => {
		assert.ok(isInside(path.join(root, 'src', 'a.cpp'), root, true));
		assert.ok(isInside(root, root, true));
		assert.ok(!isInside(path.join(root, '..', 'other', 'a.cpp'), root, true));
		assert.ok(isInside(path.join(root, 'SRC').toUpperCase(), root, false));
		assert.strictEqual(projectPath(path.join(root, 'src', 'a.cpp'), root, true), 'src/a.cpp');
		assert.strictEqual(projectPath(path.join(os.tmpdir(), 'elsewhere.cpp'), root, true), path.join(os.tmpdir(), 'elsewhere.cpp'));
		assert.deepStrictEqual(['a.cpp', 'a.H', 'a.inl', 'a.c++', 'a.inc', 'a.cu', 'a.cuh', 'a.md', 'a.cs', 'cpp', 'a.incl'].map(isCppFile),
			[true, true, true, true, true, true, true, false, false, false, false]);
	});

	test('With the tool calls of DataFlow, a fact needs a call of its tool in this stage (decision 13)', async () => {
		assert.deepStrictEqual(checkSurvey(SURVEY, { ...context(), called: new Set(['get_callers']) }).problems, []);
		assert.deepStrictEqual(checkSurvey(SURVEY, { ...context(), called: new Set(['get_place']) }).problems,
			['Fact 1: you did not call get_callers in this stage. Call it, and give only a fact that it shows.']);
		// the log: a failed call does not count, and only the calls since the start of the stage count
		const log = new ToolCallLog();
		assert.deepStrictEqual([...log.since(0)], []);
		log.record({ tool: 'get_callers', time: '2026-11-14T10:00:00.000Z', isError: false });
		log.record({ tool: 'get_place', time: '2026-11-14T12:00:00.000Z', isError: true });
		log.record({ tool: 'get_threads', time: '2026-11-14T12:00:00.000Z', isError: false });
		assert.deepStrictEqual([...log.since(Date.parse('2026-11-14T11:00:00.000Z'))], ['get_threads']);
		assert.strictEqual(stageStart({ created: '2026-11-14T09:00:00.000Z', gates: [] }), Date.parse('2026-11-14T09:00:00.000Z'));
		assert.strictEqual(stageStart({ created: '2026-11-14T09:00:00.000Z', gates: [{ gate: 'brief-ready', stage: 'survey', time: '2026-11-14T11:00:00.000Z' }] }),
			Date.parse('2026-11-14T11:00:00.000Z'));
		// a return to an earlier stage starts the stage again (decision 24)
		assert.strictEqual(stageStart({ created: '2026-11-14T09:00:00.000Z', gates: [], returned: '2026-11-14T12:00:00.000Z' }), Date.parse('2026-11-14T12:00:00.000Z'));
		// submit_survey takes the calls since the gate of the brief
		surveyTask();
		const called = new Set<string>();
		const withCalls = shotgunTools({
			store, folders: () => [root], log: () => undefined, prompts: new PromptLog(), readText, openFile: () => undefined, engine: () => undefined, ...noBuild(),
			calls: () => called,
		}).find((t) => t.name === 'submit_survey')!;
		await assert.rejects(withCalls.call(SURVEY) as Promise<unknown>, /Fact 1: you did not call get_callers in this stage\./);
		called.add('get_callers');
		await withCalls.call(SURVEY);
		assert.strictEqual(store.snapshot.survey?.facts.length, 1);
	});

	test('checkSurvey takes a correct survey: relative paths, "line", other spaces in "code", and the tool with its prefix', () => {
		const { survey, problems } = checkSurvey(SURVEY, context());
		assert.deepStrictEqual(problems, []);
		assert.deepStrictEqual(survey.hooks.map((h) => [h.id, h.file, h.lines, h.codeLine]), [['H1', 'src/solver.cpp', [5, 7], 5], ['H2', 'README.md', [3, 3], 3]]);
		assert.deepStrictEqual(survey.tasks[1], { id: 'T2', title: 'A note in the README', hooks: ['H2'], needs: ['T1'] });
		assert.deepStrictEqual(survey.facts, [{ text: 'solve() has 1 caller.', file: 'src/solver.cpp', lines: [3, 3], tool: 'get_callers' }]);
		assert.deepStrictEqual(survey.questions.map((q) => q.id), ['Q1', 'Q2']);
		// an absolute path in the project is correct too
		const absolute = checkSurvey({ ...SURVEY, hooks: [{ ...SURVEY.hooks[0], file: solver() }, SURVEY.hooks[1]] }, context());
		assert.deepStrictEqual([absolute.problems, absolute.survey.hooks[0].file], [[], 'src/solver.cpp']);
	});

	test('checkSurvey gives all problems in 1 list', () => {
		const { problems } = checkSurvey({
			tasks: [
				{ id: 'T1', title: 'A', hooks: ['H1', 'H9'], needs: ['T1', 'T7'] },
				{ id: 't1', title: 'Same id' },
				{ id: 'T2', title: 'B', hooks: [], needs: ['T3'] },
				{ id: 'T3', title: 'C', hooks: [], needs: ['T2'] },
				{ id: 'T4', hooks: 'H1' },
			],
			hooks: [
				{ id: 'H1', title: 'Loop', kind: 'check', file: 'src/solver.cpp', lines: [5, 7], code: 'while (true)' },
				{ id: 'H2', title: 'Out', kind: 'check', file: path.join(os.tmpdir(), 'elsewhere.cpp'), lines: [1, 1], code: 'abc' },
				{ id: 'H3', title: 'No file', kind: 'check', file: 'src/none.cpp', lines: [1, 1], code: 'abc' },
				{ id: 'H4', title: 'Too far', kind: 'check', file: 'src/solver.cpp', lines: [8, 12], code: 'return' },
				{ id: 'H5', title: 'No code', kind: 'check', file: 'src/solver.cpp', lines: [8, 8] },
				{ id: 'H6', title: 'Free', kind: 'check', file: 'src/solver.cpp', line: 8, code: 'return plan.result();' },
				{ id: 'bad id', title: 'X', kind: 'check', file: 'src/solver.cpp', line: 1, code: '#include' },
			],
			facts: [{ text: 'A fact.', file: 'src/solver.cpp', lines: [1, 1], tool: 'delete_mark' }, { text: 'No tool.', file: 'src/solver.cpp', line: 1 }],
			questions: 'Q1',
		}, context());
		assert.deepStrictEqual(problems, [
			'Hook 1: the code "while (true)" is not in the lines 5 to 7 of src/solver.cpp. Read the file again, and give the correct lines.',
			`Hook 2: ${path.join(os.tmpdir(), 'elsewhere.cpp')} is not in a folder of the project.`,
			'Hook 3: the file src/none.cpp is not there. A hook is a place in a file that is there now.',
			'Hook 4: src/solver.cpp has 9 lines, so the lines 8 to 12 are not in it.',
			'Hook 5: give "code", a short text of the code in its lines, copied exactly.',
			'Hook 7: give an "id" of letters and digits, for example H1.',
			'Task 2: the id t1 is there already. Each id must be different.',
			'Task 5: give the "title".',
			'Task 5: "hooks" must be a list of ids.',
			'Fact 1: "delete_mark" is not a read tool of DataFlow. Give the tool that shows the fact, for example get_threads.',
			'Fact 2: give the "tool": the read tool of DataFlow that shows the fact, for example get_threads.',
			'"questions" must be a list.',
			'Task T1: the hook H1 is not in "hooks".',
			'Task T1: the hook H9 is not in "hooks".',
			'Task T1: a task cannot need itself.',
			'Task T1: the task T7 in "needs" is not in "tasks".',
			'Hook H6: no task names it. Give it to the task that changes the code there, or remove it.',
			'The "needs" of the tasks T2, T3 make a circle. A task cannot need itself through other tasks.',
		]);
		assert.deepStrictEqual(checkSurvey({ hooks: [] }, context()).problems, ['Give 1 task or more in "tasks".']);
		const many = checkSurvey({ tasks: Array.from({ length: 31 }, (_, i) => ({ id: `T${i + 1}`, title: 'A', hooks: [] })) }, context());
		assert.deepStrictEqual(many.problems, ['Give a maximum of 30 tasks.']);
		// with no list of tools, Shotgun does not check the names of the tools
		assert.deepStrictEqual(checkSurvey({ ...SURVEY, facts: [{ ...SURVEY.facts[0], tool: 'get_anything' }] }, context([])).problems, []);
	});

	test('findHook follows the code of a hook, and excerptOf gives the lines around it', () => {
		const lines = SOLVER.split('\n');
		const code = 'for (int i = 0; i < plan.steps; ++i)';
		assert.strictEqual(codeLineOf(lines, [3, 9], code), 5);
		assert.strictEqual(codeLineOf(lines, [6, 9], code), undefined);
		const hook = { lines: [4, 7] as const, code, codeLine: 5 };
		assert.deepStrictEqual(findHook(lines, hook), [4, 7]);
		// 2 new lines above the hook: the code is still in the lines 4 to 7, but the hook moves with its code
		const moved = ['// a', '// b', ...lines];
		assert.deepStrictEqual(findHook(moved, hook), [6, 9]);
		assert.strictEqual(movedHook({ id: 'H1', title: 'Loop', kind: 'check', file: 'a.cpp', ...hook }, [6, 9]).codeLine, 7);
		// the lines above the code are gone, so the hook starts at line 1
		assert.deepStrictEqual(findHook(lines.slice(4), hook), [1, 3]);
		assert.strictEqual(findHook(lines.filter((l) => !l.includes('for (')), hook), undefined);
		// a hook of an earlier version of Shotgun has no codeLine: it stays while its lines have the code
		assert.deepStrictEqual(findHook(moved, { lines: [5, 7], code }), [5, 7]);
		const excerpt = excerptOf(lines, [5, 7], 1);
		assert.deepStrictEqual(excerpt.lines.map((l) => [l.line, l.isHook]), [[4, false], [5, true], [6, true], [7, true], [8, false]]);
		assert.strictEqual(excerpt.isCut, false);
		const cut = excerptOf(lines, [3, 9], 3, 4);
		assert.deepStrictEqual([cut.lines.map((l) => l.line), cut.isCut], [[1, 2, 3, 4], true]);
	});

	test('The facts of DataFlow in words: the place, the type and the heat', () => {
		assert.strictEqual(placeText(placeFacts('a.cpp', 6)), 'In solve(), in a for loop. The thread of the caller runs the line, with no lock.');
		assert.strictEqual(placeText({
			...placeFacts('a.cpp', 6), around: [], locks: ['m_lock'], isOnCallerThread: false,
			threads: [{ label: 'worker', via: 'std::thread', file: 'a.cpp', line: 1 }],
			framePath: { reason: 'tick() calls it', path: ['tick'], calls: 1, isInLoop: false },
			reachUnknown: { cause: 'address', text: 'A pointer can call the function' },
		}), 'In solve(). The thread worker runs the line, with the lock m_lock. It runs in each frame: tick() calls it. A pointer can call the function.');
		assert.strictEqual(placeText({ ...placeFacts('a.cpp', 1), function: null }), 'The line is in no function.');
		assert.strictEqual(typeText(TYPE), 'In the type Plan. A type has facts, and no score. 2 or more threads use steps, with no protection. '
			+ '2 or more threads use total, with a lock.');
		assert.deepStrictEqual(heatOf(heatFacts('a.cpp')), { function: 'solve', score: 64, band: 'hot', isReachComplete: false });
		assert.strictEqual(heatOf({ ...heatFacts('a.cpp'), functions: [] }), undefined);
		const engine = hookEngineOf(placeFacts('a.cpp', 6), heatFacts('a.cpp'));
		assert.deepStrictEqual([engine.hasFacts, engine.function, engine.heat?.score], [true, 'solve', 64]);
		// a line in a type, not in a function: the facts of the type
		const type = hookEngineOf({ ...placeFacts('a.h', 2), function: null }, { ...heatFacts('a.h'), functions: [], types: [TYPE] });
		assert.deepStrictEqual([type.hasFacts, type.type, type.heat], [true, 'Plan', undefined]);
		assert.deepStrictEqual(hookEngineOf(undefined, undefined), { text: 'DataFlow gave no facts for the place.', hasFacts: false });
	});

	test('The files of the survey must have a correct form', () => {
		const file = { version: 1, time: 't', tasks: [], hooks: [], facts: [], questions: [] };
		assert.deepStrictEqual(parseSurvey(JSON.stringify(file), 'fix'), file);
		assert.throws(() => parseSurvey(JSON.stringify({ ...file, version: 2 }), 'fix'), /fix\/survey\.json has the version 2/);
		assert.throws(() => parseSurvey(JSON.stringify({ ...file, hooks: [{ id: 'H1' }] }), 'fix'), /no correct fields/);
		assert.throws(() => parseEngine(JSON.stringify({ version: 1, time: 't', hooks: {} }), 'fix'), /needs the fields time, isReachComplete and hooks/);
		assert.deepStrictEqual(parseAnswers(JSON.stringify({ version: 1, answers: { Q1: { text: 'A', time: 't' } } }), 'fix').answers.Q1.text, 'A');
		assert.throws(() => parseAnswers(JSON.stringify({ version: 1, answers: { Q1: 'A' } }), 'fix'), /needs the field answers/);
		assert.strictEqual(checkAnswer('  10 cycles  '), '10 cycles');
		assert.throws(() => checkAnswer('x'.repeat(4001)), /more than 4000 characters/);
	});

	test('submit_survey refuses a survey before stage 2 and a survey with problems, and writes no file', async () => {
		await assert.rejects(submit(SURVEY, fakeEngine()), /No task is active/);
		store.newTask('Fix');
		await assert.rejects(submit(SURVEY, fakeEngine()), /The active task is in stage 1 of 6, the brief\. A survey is only for stage 2\. The user selects "The brief is ready" first\./);
		store.passGate('brief-ready');
		await assert.rejects(submit({ ...SURVEY, tasks: [] }, fakeEngine()),
			(error: Error) => error.message === 'Shotgun did not take the survey. Correct these problems, and call the tool again:\n'
				+ '- Give 1 task or more in "tasks".\n- Hook H1: no task names it. Give it to the task that changes the code there, or remove it.\n'
				+ '- Hook H2: no task names it. Give it to the task that changes the code there, or remove it.');
		assert.strictEqual(readText(path.join(root, '.shotgun', 'fix', 'survey.json')), undefined);
		assert.strictEqual(store.snapshot.survey, undefined);
	});

	test('submit_survey writes the survey and the facts of DataFlow for each hook', async () => {
		surveyTask();
		const calls: string[] = [];
		const result = await submit(SURVEY, fakeEngine(calls));
		const id = 'a-cycle-limit-for-the-solver';
		// DataFlow gets only the C++ hook
		assert.deepStrictEqual(calls.sort(), ['heat solver.cpp:5-7', 'place solver.cpp:5']);
		assert.deepStrictEqual(result.hooks, [
			{ id: 'H1', place: 'src/solver.cpp:5-7', engine: 'In solve(), in a for loop. The thread of the caller runs the line, with no lock.',
				heat: '64 hot, before the end of the scan of the call graph' },
			{ id: 'H2', place: 'README.md:3', engine: 'DataFlow has facts only for C and C++ code.' },
		]);
		assert.deepStrictEqual([result.tasks, result.facts, result.isReachComplete], [2, 1, false]);
		assert.deepStrictEqual(result.questions, [{ id: 'Q1', isAnswered: false }, { id: 'Q2', isAnswered: false }]);
		assert.match(String(result.next), /"Order the tasks"/);
		const { survey, engine } = store.snapshot;
		assert.deepStrictEqual(survey?.hooks.map((h) => h.file), ['src/solver.cpp', 'README.md']);
		assert.deepStrictEqual(engine?.hooks.H1.heat, { function: 'solve', score: 64, band: 'hot', isReachComplete: false });
		assert.strictEqual(engine?.hooks.H2.hasFacts, false);
		assert.strictEqual(JSON.parse(readFileSync(path.join(root, '.shotgun', id, 'survey.json'), 'utf8')).version, 1);
		const ledger = parseDecisions(readFileSync(path.join(root, '.shotgun', id, 'decisions.jsonl'), 'utf8')).decisions;
		const last = ledger[ledger.length - 1];
		assert.deepStrictEqual(last, { ...last, kind: 'survey', by: 'claude', tasks: 2, hooks: 2, facts: 1, questions: 2 });
		assert.strictEqual(decisionText(last), 'Claude gave the survey: 2 tasks, 2 hooks, 1 fact and 2 questions.');
		// get_session gives the survey with the answers of the user
		store.setAnswer('Q1', '10 cycles');
		const session = tool('get_session').call({}) as { survey: { file: string; hooks: number; questions: unknown[] } };
		assert.strictEqual(session.survey.file, path.join(root, '.shotgun', id, 'survey.json'));
		assert.strictEqual(session.survey.hooks, 2);
		assert.deepStrictEqual(session.survey.questions, [{ id: 'Q1', text: 'What is the limit?', answer: '10 cycles' }, { id: 'Q2', text: 'What happens at the limit?' }]);
	});

	test('A failure of DataFlow gives a hook with no facts, and no link to DataFlow gives no facts', async () => {
		surveyTask();
		const fail = async () => {
			throw new Error('The engine is not ready.');
		};
		const result = await submit(SURVEY, fakeEngine([], { place: fail, heat: fail }));
		assert.strictEqual((result.hooks as { engine: string }[])[0].engine, 'DataFlow gave no facts: The engine is not ready.');
		// only the heat fails: the facts of the place stay
		await submit(SURVEY, fakeEngine([], { heat: fail }));
		assert.deepStrictEqual([store.snapshot.engine?.hooks.H1.hasFacts, store.snapshot.engine?.hooks.H1.heat], [true, undefined]);
		const none = await submit(SURVEY);
		assert.strictEqual((none.hooks as { engine: string }[])[0].engine, 'Shotgun has no link to DataFlow, so the hook has no facts of the engine.');
	});

	test('The answers of the user stay with their questions after a new survey', async () => {
		surveyTask();
		assert.throws(() => store.setAnswer('Q1', 'A'), /has no question Q1/);
		await submit(SURVEY, fakeEngine());
		store.setAnswer('Q1', ' 10 cycles ');
		store.setAnswer('Q2', 'Stop.');
		store.setAnswer('Q2', '');
		assert.deepStrictEqual(Object.keys(store.snapshot.answers), ['Q1']);
		assert.strictEqual(store.snapshot.answers.Q1.text, '10 cycles');
		await submit({ ...SURVEY, questions: [SURVEY.questions[0]] }, fakeEngine());
		assert.strictEqual(store.snapshot.answers.Q1.text, '10 cycles');
		const answers = store.snapshot.decisions.filter((d) => d.kind === 'answer').map((d) => decisionText(d));
		assert.deepStrictEqual(answers, [
			'You answered the question Q1: "10 cycles".', 'You answered the question Q2: "Stop.".', 'You removed the answer to the question Q2.',
		]);
		// a second store reads the same state
		const other = new SessionStore(root);
		other.load();
		assert.deepStrictEqual([other.snapshot.survey?.questions.length, other.snapshot.answers.Q1.text, !!other.snapshot.engine], [1, '10 cycles', true]);
	});

	test('The survey page: the hooks at their lines now, the facts, the answers and the gate', async () => {
		surveyTask();
		await submit(SURVEY, fakeEngine());
		store.setAnswer('Q1', '10 cycles');
		const connected: ClaudeState = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' };
		const files: Record<string, string> = { [solver()]: `// new line\n${SOLVER}`, [path.join(root, 'README.md')]: 'The solver.\n' };
		const model = () => buildModel({
			version: '0.1.0', snapshot: store.snapshot, dataflow: { state: 'ready', version: '0.6.0', engine: 'ready' }, claude: connected,
			readLines: (file) => files[file]?.split('\n'),
		});
		const m = model();
		const survey = m.task!.survey!;
		assert.deepStrictEqual(survey.hooks.map((h) => [h.id, h.lines, h.isMoved, h.isLost, h.tasks]), [
			['H1', [6, 8], true, false, ['T1']],
			['H2', [3, 3], false, true, ['T2']],
		]);
		assert.strictEqual(survey.hooks[0].place, 'src/solver.cpp:5-7');
		assert.strictEqual(survey.hooks[0].excerpt?.lines.find((l) => l.isHook)?.text, '    for (int i = 0; i < plan.steps; ++i) {');
		assert.strictEqual(survey.hooks[0].engine?.heat?.band, 'hot');
		assert.deepStrictEqual(survey.facts, [{ text: 'solve() has 1 caller.', place: 'src/solver.cpp:3', path: solver(), line: 3, tool: 'get_callers' }]);
		assert.deepStrictEqual(survey.questions, [{ id: 'Q1', text: 'What is the limit?', answer: '10 cycles' }, { id: 'Q2', text: 'What happens at the limit?' }]);
		assert.deepStrictEqual([survey.isReachComplete, survey.isEditable], [false, true]);
		assert.deepStrictEqual(m.task!.gate, {
			label: 'Order the tasks',
			note: 'Your gate. After it, you put the tasks in sequence. You can rewrite a task, and you can add a task.',
			isEnabled: true,
			warning: '1 question of the survey has no answer.',
		});
		// after the gate, the page shows the survey, but the user cannot answer
		store.passGate('order-tasks');
		const order = model();
		assert.deepStrictEqual([order.task!.stage, order.task!.survey?.isEditable, order.task!.gate?.label], ['order', false, 'Accept the order']);
		assert.throws(() => store.passGate('order-tasks'), /is not the gate of stage 3 of 6/);
	});

	test('The text editor shows the hooks of the survey in the stages 2 and 3, at their lines now', async () => {
		surveyTask();
		await submit(SURVEY, fakeEngine());
		const decorations = new HookDecorations();
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(solver()));
			const readme = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'README.md')));
			const hooks = (d: vscode.TextDocument) => decorations.hooksOf(d).map(({ hook, lines }) => [hook.id, lines]);
			assert.deepStrictEqual(hooks(doc), []); // no snapshot yet
			decorations.update(store.snapshot);
			assert.deepStrictEqual(hooks(doc), [['H1', [5, 7]]]);
			assert.deepStrictEqual(hooks(readme), [['H2', [3, 3]]]);
			// a change of the text above the hook moves the hook, with no save
			const edit = new vscode.WorkspaceEdit();
			edit.insert(doc.uri, new vscode.Position(0, 0), '// a\n// b\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			assert.deepStrictEqual(hooks(doc), [['H1', [7, 9]]]);
			store.passGate('order-tasks');
			decorations.update(store.snapshot);
			assert.deepStrictEqual(hooks(doc), [['H1', [7, 9]]]);
			// after stage 3, the plan has its own decorations
			store.passGate('accept-order');
			decorations.update(store.snapshot);
			assert.deepStrictEqual(hooks(doc), []);
		} finally {
			decorations.dispose();
		}
	});
});
