import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readText } from '../../session/files';
import { GATE_OF, STAGES } from '../../session/stages';
import { SessionStore } from '../../session/store';
import { contextOutput, contextText, GET_SESSION_TOOL } from '../../tools/context';
import { decide, GuardState, hookOutput } from '../../tools/guard';
import { PromptLog } from '../../tools/prompts';
import { shotgunTools, ToolDeps } from '../../tools/tools';
import { noBuild } from './fixture';

// The dependencies of the tools for a test: the files on the disk, a list of the files that a tool opens, and no link to
// DataFlow
function testDeps(store: SessionStore, root: string, prompts: PromptLog, opened: string[]): ToolDeps {
	return {
		store, folders: () => [root], log: () => undefined, prompts, readText, openFile: (file) => opened.push(file), engine: () => undefined, ...noBuild(),
	};
}

// The tools of Shotgun for the MCP server of DataFlow: the guard, the context and get_session
suite('Tools of Shotgun', () => {
	let root: string;
	let store: SessionStore;
	const tool = (name: string) => shotgunTools(testDeps(store, root, new PromptLog(), [])).find((t) => t.name === name)!;
	const guard = (file: string, cwd = root) => JSON.parse(tool('guard').call({ tool: 'Edit', file, cwd }) as string);

	setup(() => {
		root = mkdtempSync(path.join(os.tmpdir(), 'shotgun-tools-'));
		store = new SessionStore(root);
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The guard denies each file change of the project in the stages 1 to 4, and the ledger records it', () => {
		store.newTask('Cycle limit');
		for (const stage of STAGES.slice(0, 4)) {
			const out = guard(path.join(root, 'src', 'a.cpp'));
			assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
			assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
			assert.match(out.hookSpecificOutput.permissionDecisionReason, new RegExp(`the task "Cycle limit" is in stage \\d of 5, the ${stage}\\.`));
			store.passGate(GATE_OF[stage]);
		}
		const denies = store.snapshot.decisions.filter((d) => d.kind === 'deny');
		assert.strictEqual(denies.length, 4);
		assert.deepStrictEqual(denies[0], { ...denies[0], tool: 'Edit', file: 'src/a.cpp' });
	});

	test('In stage 5 with no open step, the guard denies; after the last gate, it gives no decision', () => {
		store.newTask('Fix');
		for (const stage of STAGES.slice(0, 4)) {
			store.passGate(GATE_OF[stage]);
		}
		assert.match(guard('a.cpp').hookSpecificOutput.permissionDecisionReason, /stage 5 of 5, the build\. No step of Claude is open\./);
		store.passGate('task-done');
		assert.deepStrictEqual(guard('a.cpp'), {});
	});

	test('The guard gives no decision outside of the project, with no task, in a pause, and for an empty path', () => {
		assert.deepStrictEqual(guard(path.join(root, 'a.cpp')), {});
		store.newTask('Fix');
		assert.deepStrictEqual(guard(path.join(os.tmpdir(), 'elsewhere.txt')), {});
		assert.deepStrictEqual(guard(''), {});
		// Claude Code did not fill the value of the input
		assert.deepStrictEqual(guard('${tool_input.file_path}'), {});
		store.setPaused(true);
		assert.deepStrictEqual(guard(path.join(root, 'a.cpp')), {});
	});

	test('The guard always denies a change in .shotgun, also in a pause', () => {
		store.newTask('Fix');
		store.setPaused(true);
		const out = guard(path.join(root, '.shotgun', 'fix', 'task.json'));
		assert.match(out.hookSpecificOutput.permissionDecisionReason, /the folder \.shotgun keeps the files of Shotgun/);
	});

	test('The guard resolves a relative path with the folder of the session, and Windows paths have no case', () => {
		const state: GuardState = {
			folders: ['C:\\Work\\Project'], shotgunDir: 'C:\\Work\\Project\\.shotgun', task: { title: 'Fix', stage: 'brief', isDone: false },
			isPaused: false, isCaseSensitive: false,
		};
		if (process.platform !== 'win32') {
			return; // the paths of this test are Windows paths
		}
		assert.strictEqual(decide({ tool: 'Edit', file: 'src\\a.cpp', cwd: 'c:\\work\\project' }, state).decision, 'deny');
		assert.strictEqual(decide({ tool: 'Write', file: 'C:\\WORK\\PROJECT\\b.h', cwd: '' }, state).decision, 'deny');
		assert.strictEqual(decide({ tool: 'Edit', file: '..\\other\\c.cpp', cwd: 'C:\\Work\\Project' }, state).decision, 'none');
		assert.strictEqual(decide({ tool: 'Edit', file: 'C:\\Work\\Project2\\c.cpp', cwd: '' }, state).decision, 'none');
		assert.strictEqual(hookOutput({ decision: 'none', why: 'outside' }), '{}');
	});

	test('The context gives the task and the rule for each prompt, and no text with no task', () => {
		const context = (event: string) => JSON.parse(tool('session_context').call({ event, cwd: root }) as string);
		assert.deepStrictEqual(context('UserPromptSubmit'), {});
		store.newTask('Cycle limit');
		const out = context('UserPromptSubmit');
		assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
		assert.strictEqual(out.hookSpecificOutput.additionalContext, 'Shotgun: the active task is "Cycle limit", in stage 1 of 5, the brief. '
			+ `Claude changes no file in this stage. For the details, call the tool ${GET_SESSION_TOOL}.`);
		// the name of the event comes from the input. A name that cannot give a text becomes UserPromptSubmit
		assert.strictEqual(context('SessionStart').hookSpecificOutput.hookEventName, 'SessionStart');
		assert.strictEqual(context('${hook_event_name}').hookSpecificOutput.hookEventName, 'UserPromptSubmit');
		store.setPaused(true);
		assert.match(context('UserPromptSubmit').hookSpecificOutput.additionalContext, /the user paused the task "Cycle limit"/);
		assert.strictEqual(contextText(undefined, false), undefined);
		assert.strictEqual(contextOutput(undefined, 'UserPromptSubmit'), '{}');
	});

	test('get_session gives the task, its stage and gates, the guard and the next work', () => {
		const empty = tool('get_session').call({}) as Record<string, unknown>;
		assert.strictEqual(empty.task, null);
		assert.strictEqual(empty.guard, 'No task is active. The guard makes no decision.');
		store.newTask('Old task');
		store.newTask('Cycle limit');
		store.passGate('brief-ready');
		const session = tool('get_session').call({}) as Record<string, any>;
		assert.strictEqual(session.folder, root);
		assert.strictEqual(session.task.title, 'Cycle limit');
		assert.strictEqual(session.task.stage, 2);
		assert.strictEqual(session.task.stageName, 'Survey');
		assert.strictEqual(session.task.writer, 'claude');
		assert.deepStrictEqual(session.task.gates.map((g: { gate: string }) => g.gate), ['The brief is ready']);
		assert.strictEqual(session.task.nextGate, 'Order the tasks');
		assert.strictEqual(session.guard, 'Claude changes no file in this stage.');
		assert.match(session.next, /asks Claude for the survey/);
		assert.deepStrictEqual(session.otherTasks, [{ id: 'old-task', title: 'Old task', stage: 1, isDone: false }]);
		assert.strictEqual(session.stages.length, 5);
		assert.ok(!('problems' in session));
	});
});

// The tools of stage 1: submit_brief, submit_questions, and the prompts of the context hook (decision 12)
suite('Tools of stage 1', () => {
	let root: string;
	let store: SessionStore;
	let prompts: PromptLog;
	let opened: string[];
	const call = (name: string, args: Record<string, unknown>) =>
		shotgunTools(testDeps(store, root, prompts, opened)).find((t) => t.name === name)!.call(args) as Record<string, any>;
	const brief = ['## Goal', 'The controller must not wait without end.', '## Facts', '- process() runs one time in each cycle.', '## Specs',
		'- The limit is 8 cycles.', '## Not in scope', '- A time limit in seconds.', '## Done when', '- A test passes.'].join('\n');
	const userPrompt = 'Here is my brief. Goal: The controller must not wait without end. Facts: process() runs one time in each cycle. '
		+ 'Specs: The limit is 8 cycles. Not in scope: A time limit in seconds. Done when: A test passes. Give it to Shotgun.';

	setup(() => {
		root = mkdtempSync(path.join(os.tmpdir(), 'shotgun-brief-'));
		store = new SessionStore(root, () => new Date(Date.UTC(2026, 10, 14, 10, 0, 0)));
		prompts = new PromptLog();
		opened = [];
	});
	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('The context hook keeps each prompt, but not a value that Claude Code did not fill', () => {
		call('session_context', { event: 'UserPromptSubmit', prompt: '${prompt}' });
		assert.deepStrictEqual(prompts.prompts, []);
		call('session_context', { event: 'UserPromptSubmit', prompt: userPrompt });
		assert.deepStrictEqual(prompts.prompts, [userPrompt]);
	});

	test('submit_brief makes a new task with the words of the user, and opens brief.md', () => {
		prompts.add(userPrompt);
		const result = call('submit_brief', { title: 'Cycle limit', text: brief });
		assert.strictEqual(result.isNewTask, true);
		assert.strictEqual(result.isComplete, true);
		assert.match(result.next, /selects "The brief is ready"/);
		assert.strictEqual(store.snapshot.task?.title, 'Cycle limit');
		const file = store.briefFile()!;
		assert.deepStrictEqual(opened, [file]);
		assert.strictEqual(readFileSync(file, 'utf8'), `# Brief: Cycle limit\n\n${brief}\n`);
		assert.deepStrictEqual(store.snapshot.decisions.map((d) => [d.kind, d.by]), [['task', 'claude'], ['brief', 'claude']]);
		assert.deepStrictEqual(store.snapshot.decisions[1], { ...store.snapshot.decisions[1], lines: 5 });
	});

	test('submit_brief refuses each line that is not in the words of the user, and gives all problems in 1 list', () => {
		prompts.add(userPrompt);
		assert.throws(() => call('submit_brief', { title: ' ', text: `${brief}\n- The limit must be fast.\n<!-- a hidden fact -->` }), (error: Error) => {
			assert.match(error.message, /^Shotgun did not take the brief\. Correct these problems, and call the tool again:\n- /);
			assert.match(error.message, /- Give a short title of the task/);
			assert.match(error.message, /- 2 lines are not in the words of the user: "The limit must be fast\.", "<!-- a hidden fact -->"\./);
			return true;
		});
		assert.strictEqual(store.snapshot.task, undefined);
		assert.deepStrictEqual(opened, []);
		// with no prompt of the user, Shotgun cannot check the brief
		prompts = new PromptLog();
		assert.throws(() => call('submit_brief', { title: 'Fix', text: brief }), /Shotgun has no prompt of the user in this VS Code window/);
	});

	test('submit_brief fills the empty brief of the active task, and does not change a brief with text', () => {
		store.newTask('Cycle limit');
		prompts.add(userPrompt);
		const result = call('submit_brief', { title: 'Other title', text: '## Goal\nThe controller must not wait without end.' });
		assert.strictEqual(result.isNewTask, false);
		assert.strictEqual(store.snapshot.tasks.length, 1);
		const text = readFileSync(store.briefFile()!, 'utf8');
		// the title of the user stays, and the parts that the user did not give get their headings
		assert.ok(text.startsWith('# Brief: Cycle limit\n\n## Goal\nThe controller must not wait without end.\n\n## Facts\n\n<!-- '), text);
		assert.deepStrictEqual(result.parts.map((p: { hasText: boolean }) => p.hasText), [true, false, false, false, false]);
		assert.match(result.next, /These parts have no text: Facts, Specs, Not in scope, Done when\. Ask the user/);
		assert.throws(() => call('submit_brief', { title: 'x', text: 'The controller must not wait without end.' }),
			/The brief of the active task "Cycle limit" has text\. Shotgun does not change the text of a brief/);
		const second = call('submit_brief', { title: 'Second', text: 'The controller must not wait without end.', isNewTask: true });
		assert.strictEqual(second.isNewTask, true);
		assert.deepStrictEqual(second.previousTask, { id: 'cycle-limit', title: 'Cycle limit', stage: 1 });
		assert.strictEqual(store.snapshot.task?.id, 'second');
	});

	test('submit_brief makes a new task when the active task is after stage 1', () => {
		store.newTask('Old');
		store.passGate('brief-ready');
		prompts.add(userPrompt);
		const result = call('submit_brief', { title: 'New', text: brief });
		assert.strictEqual(result.isNewTask, true);
		assert.deepStrictEqual(result.previousTask, { id: 'old', title: 'Old', stage: 2 });
	});

	test('submit_questions gives the questions of Claude to the active task in stage 1', () => {
		store.newTask('Cycle limit');
		writeFileSync(store.briefFile()!, '# Brief: Cycle limit\n\n## Goal\nThe controller must not wait without end.\n\n## Facts\n- The solver runs on a worker thread.\n');
		const result = call('submit_questions', {
			questions: [
				{ text: 'Does the limit count cycles of the main loop?', part: 'specs' },
				{ text: 'Which thread stops the solver?', part: 'facts', quote: 'The solver runs on a worker thread.' },
			],
		});
		assert.deepStrictEqual(result.questions.map((q: { id: string; part: string; line?: number }) => [q.id, q.part, q.line]),
			[['q1', 'Specs', undefined], ['q2', 'Facts', 7]]);
		assert.match(result.next, /Do not answer the questions/);
		store.closeQuestion('q1');
		call('submit_questions', { questions: [{ text: 'A new question?' }] });
		assert.deepStrictEqual(store.snapshot.questions.map((q) => [q.id, q.state]), [['q1', 'closed'], ['q3', 'open']]);
	});

	test('submit_questions checks all data, and needs the active task in stage 1', () => {
		assert.throws(() => call('submit_questions', { questions: [] }), /No task is active[\s\S]*Give 1 question or more/);
		store.newTask('Fix');
		assert.throws(() => call('submit_questions', {
			questions: [{ text: '' }, { text: 'Why?', part: 'other' }, { text: 'Where?', quote: 'not in the brief' }, 7],
		}), (error: Error) => {
			assert.match(error.message, /^Shotgun did not take the questions\./);
			assert.match(error.message, /- Question 1: give the "text"\./);
			assert.match(error.message, /- Question 2: "part" must be goal, facts, specs, scope or done\./);
			assert.match(error.message, /- Question 3: the quote is not in brief\.md\./);
			assert.match(error.message, /- Question 4 is not an object\./);
			return true;
		});
		assert.deepStrictEqual(store.snapshot.questions, []);
		store.passGate('brief-ready');
		assert.throws(() => call('submit_questions', { questions: [{ text: 'Why?' }] }),
			/The active task is in stage 2 of 5, the survey\. Questions about the brief are only for stage 1\./);
	});

	test('get_session gives the brief with its parts and the open questions', () => {
		store.newTask('Fix');
		store.setQuestions([{ text: 'Why?', part: 'goal' }]);
		const session = call('get_session', {});
		assert.strictEqual(session.brief.file, store.briefFile());
		assert.deepStrictEqual(session.brief.parts.map((p: { name: string; summary: string }) => [p.name, p.summary])[0], ['Goal', 'no text']);
		assert.strictEqual(session.brief.isComplete, false);
		assert.deepStrictEqual(session.brief.openQuestions, [{ id: 'q1', text: 'Why?', line: 3 }]);
	});
});
