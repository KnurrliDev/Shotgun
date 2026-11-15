import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { claudeText, EMPTY_HOME, HomeItem, homeItems, HomeState, MAX_RECENT, parseRecent, withRecent } from '../../views/home';

// The sidebar of Shotgun in the activity bar (decision 23): its items for each state, and the recent projects

const root = path.join(os.tmpdir(), 'shotgun-home', 'battery');
const other = path.join(os.tmpdir(), 'shotgun-home', 'planner');
const ids = (items: readonly HomeItem[]) => items.map((i) => i.id);

suite('Sidebar', () => {
	test('With no folder: a folder to open, the recent projects, the connection and the log', () => {
		const items = homeItems({ ...EMPTY_HOME, claude: 'not connected', recent: [{ name: 'planner', root: other }] });
		assert.deepStrictEqual(ids(items), ['openFolder', 'recent', 'claude', 'log']);
		const recent = items.find((i) => i.id === 'recent')!;
		assert.deepStrictEqual(recent.children!.map((c) => [c.label, c.description, c.command, c.arguments]),
			[['planner', other, 'shotgun.openRecentProject', [other]]]);
		assert.strictEqual(items.find((i) => i.id === 'claude')!.description, 'not connected');
	});

	test('With a folder and an active task: the tasks, the page, the brief, the guard and the panel. The folder is no recent project', () => {
		const state: HomeState = {
			project: { name: 'battery', root },
			tasks: [
				{ id: 'a-cycle-limit', title: 'A cycle limit', stage: '2 Survey', stageText: 'stage 2 of 5, the survey', isActive: true, isDone: false },
				{ id: 'a-log-line', title: 'A log line', stage: 'done', stageText: 'done', isActive: false, isDone: true },
			],
			hasLedger: false,
			canReturn: true,
			isPaused: false,
			claude: 'connected',
			// the same folder with a different case is the same project on Windows and macOS
			recent: [{ name: 'battery', root: process.platform === 'linux' ? root : root.toUpperCase() }, { name: 'planner', root: other }],
		};
		const items = homeItems(state);
		assert.deepStrictEqual(ids(items), ['newTask', 'tasks', 'showPage', 'openBrief', 'returnToStage', 'pause', 'showPanel', 'openFolder', 'recent', 'claude', 'log']);
		assert.strictEqual(items.find((i) => i.id === 'returnToStage')!.description, 'from 2 Survey');
		// the short stage is the description, and the tooltip has the full stage
		assert.deepStrictEqual(items.find((i) => i.id === 'tasks')!.children!.map((c) => [c.label, c.description, c.tooltip, c.icon, c.arguments]), [
			['A cycle limit', '2 Survey', 'The active task: A cycle limit, stage 2 of 5, the survey', 'circle-filled', ['a-cycle-limit']],
			['A log line', 'done', 'Make A log line the active task: done', 'pass', ['a-log-line']],
		]);
		assert.deepStrictEqual([items.find((i) => i.id === 'claude')!.label, items.find((i) => i.id === 'claude')!.description], ['Claude Code', 'connected']);
		assert.deepStrictEqual(items.find((i) => i.id === 'recent')!.children!.map((c) => c.label), ['planner']);
		assert.strictEqual(items.find((i) => i.id === 'openBrief')!.description, 'A cycle limit');
		// stage 5: the ledger. A paused guard gives "Continue"
		const build = homeItems({ ...state, hasLedger: true, isPaused: true, recent: [] });
		assert.deepStrictEqual(ids(build), ['newTask', 'tasks', 'showPage', 'openBrief', 'showLedger', 'returnToStage', 'continue', 'showPanel', 'openFolder', 'claude', 'log']);
		// a task in stage 1 has no earlier stage
		assert.ok(!ids(homeItems({ ...state, canReturn: false })).includes('returnToStage'));
		assert.strictEqual(build.find((i) => i.id === 'continue')!.description, 'the guard is off');
		// a folder with no task: no tasks, no page and no guard
		assert.deepStrictEqual(ids(homeItems({ ...EMPTY_HOME, project: { name: 'battery', root } })), ['newTask', 'showPanel', 'openFolder', 'claude', 'log']);
	});

	test('The recent projects: the last project first, no copies, a maximum of 10, and no wrong values', () => {
		const projects = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, root: path.join(os.tmpdir(), `p${i}`) }));
		const recent = withRecent(projects, projects[5]);
		assert.deepStrictEqual([recent.length, recent[0].name, recent.filter((p) => p.name === 'p5').length], [MAX_RECENT, 'p5', 1]);
		assert.deepStrictEqual(parseRecent([{ name: 'a', root: 'x' }, { name: 3 }, 'b', null]), [{ name: 'a', root: 'x' }]);
		assert.deepStrictEqual([parseRecent(undefined), parseRecent({ name: 'a' })], [[], []]);
	});

	test('The state of the connection to Claude Code in a few words', () => {
		const ok = { dataflow: 'connected', marketplace: 'ok', plugin: 'on' } as const;
		assert.deepStrictEqual([
			claudeText(ok, true), claudeText({ ...ok, marketplace: 'none' }, true), claudeText({ ...ok, marketplace: 'other' }, true),
			claudeText({ ...ok, plugin: 'off' }, true), claudeText({ ...ok, plugin: 'off' }, false), claudeText({ ...ok, dataflow: 'none' }, false),
		], ['connected', 'not connected', 'a different plugin folder', 'the plugin is off in this folder', 'connected', 'DataFlow is not connected']);
	});
});
