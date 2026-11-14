import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GATE_OF, STAGES } from '../../session/stages';
import { SessionStore } from '../../session/store';
import { contextOutput, contextText, GET_SESSION_TOOL } from '../../tools/context';
import { decide, GuardState, hookOutput } from '../../tools/guard';
import { shotgunTools } from '../../tools/tools';

// The tools of Shotgun for the MCP server of DataFlow: the guard, the context and get_session
suite('Tools of Shotgun', () => {
	let root: string;
	let store: SessionStore;
	const tool = (name: string) => shotgunTools({ store, folders: () => [root], log: () => undefined }).find((t) => t.name === name)!;
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
		assert.deepStrictEqual(denies[0], { ...denies[0], tool: 'Edit', file: path.join('src', 'a.cpp') });
	});

	test('In stage 5 with no open step, the guard denies; after the last gate, it gives no decision', () => {
		store.newTask('Fix');
		for (const stage of STAGES.slice(0, 4)) {
			store.passGate(GATE_OF[stage]);
		}
		assert.match(guard('a.cpp').hookSpecificOutput.permissionDecisionReason, /stage 5 of 5, the build, and no step of Claude is open/);
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
