// The test of Shotgun with Claude Code. It starts the test build of VS Code with DataFlow and Shotgun from their
// repository folders. In VS Code, it makes a task with "Shotgun: New Task", and connects DataFlow and Shotgun to Claude
// Code with their commands. Then it runs the prompts of the CLI of Claude Code in print mode, in 17 parts:
// 1. Task 1: the gate of the empty brief is on, because each part is optional. The sidebar of Shotgun shows the task.
//    The test writes the brief into brief.md, as the user does. "Ask me questions about my brief." loads the skill
//    shotgun, and Claude gives its questions with shotgun_submit_questions. The test closes the questions.
// 2. Claude tries to change a file of the project in stage 1, and the guard denies the change (phase 1).
// 3. The test passes the gate of task 1. Then the user gives a brief in the chat, and Claude gives it to Shotgun with
//    shotgun_submit_brief. Shotgun makes task 2, and the test passes its gate (the condition of phase 2).
// 4. The test opens task 1 again. "Survey my brief." loads the skill shotgun-survey, and Claude gives the survey with
//    shotgun_submit_survey. Shotgun adds the facts of DataFlow to each hook. A click on a hook shows it in DataFlow with
//    a highlight. The test returns task 1 to stage 1 and passes the gate of the brief again, and the survey stays. The test
//    answers the questions of the survey, and passes the gate "Order the tasks" (the condition of phase 3).
// 5. On the order page, the test changes the text of a task, adds a task and moves it. "Survey my changed tasks."
//    loads the skill shotgun-survey, and Claude surveys the 2 tasks with shotgun_submit_task_survey. Then the test
//    passes the gate "Accept the order" on the page (the condition of phase 4).
// 6. "Make the plan." loads the skill shotgun-plan, and Claude gives the steps with their open decisions with
//    shotgun_submit_plan. The rules give each step a level from the facts of DataFlow and from its open decisions, and a
//    step that adds a data member gets level 2 (phase 11). The test changes a level and writes a note on the page. It adds
//    a decision to step 3, and answers a decision of a later step. It sets step 1 to level 4, and steps 2 and 5 to level 2.
//    Then it passes the gate "Accept the plan" (the condition of phase 5).
// 7. In stage 5, Shotgun opens step 1 for the user. A run of Claude Code with no plugins stands in for the user and
//    does the step, because step 2 can need its work. The test passes "The step is done". Then "Do step 2." loads the
//    skill shotgun-errand: Claude opens the step, changes its scope, and gives the receipt. The test puts the marks and
//    an issue with a note on the receipt in the panel.
// 8. "Fix the issues of step 2." opens the step again, and Claude gives a new receipt. The test marks each change OK,
//    and passes "Accept the receipt" (the condition of phase 6).
// 9. In stage 5, the test sets step 3 to level 4, and selects the writer "Frame" in the panel (decision 44). "Give me a
//    frame for step 3." loads the skill shotgun-frame, and Claude gives the frame with shotgun_submit_frame: 1 hole for
//    each open decision of the step, and no hole that is only a type, a name or a literal (phase 11). The test goes to
//    the holes with Tab and types their code. The last hole gets the nudge and then the answer of Claude. The gate "The
//    step is done" ends the step (the condition of phase 7).
// 10. The test sets step 4 to level 4, and writes a line in process() that makes a race with the worker thread. At the
//    pause, the race shows as a problem callout (the condition of phase 8). "Explain the callout ..." and a question
//    about a line load the skill shotgun-explain. The test closes the callout with "Not a problem" and a reason.
// 11. The test ends step 4. The gate of each step got the loose ends of the step from DataFlow. The test hands a
//    mechanical loose end to Claude, if the steps have one, and writes a commit message in Source Control. "Check my
//    commit message." loads the skill shotgun-commit, and the ledger page shows the decisions, the lines of each writer
//    and the check of the message (the condition of phase 9).
// 12. "The build is done" takes the task to stage 6. The test selects the effort medium and the focus correctness and
//    threads, and copies the review prompt. A new run of the CLI gets the prompt and loads the skill shotgun-review.
//    Claude starts subagents, and gives the issues with shotgun_submit_review. The test checks a refusal through the
//    bridge (the condition of phase 12).
// 13. The issues page (decision 43). If the list to fix has fewer than 2 issues of the review, "Fix it" adds issues of
//    the list for later. The test adds an issue of the user, writes a note for the plan, moves an issue, and closes an
//    issue with "Not a problem". Then it passes the gate "Accept the issues".
// 14. "Plan the fixes." loads the skill shotgun-plan, and Claude gives the steps F1, F2 and so on with
//    shotgun_submit_fix_plan. Each issue to fix has a step. On the page of the fix plan, the test selects the writer of the
//    first 2 steps: the user for step A, and Claude for step B (decision 44). Then it passes "Accept the fix plan".
// 15. The fixes go step by step, as the build. A run of Claude Code with no plugins stands in for the user and writes
//    step A. "Do step F2." gives an errand of Claude with a receipt in stage 6. The other steps end with no code. The gate
//    "The fixes are done" ends round 1.
// 16. The panel copies the prompt of round 2. get_review marks the changed hunks and gives the fixed issues. A new run of
//    the CLI reviews the fixes, and checks each fixed issue in a subagent. A correct fix stays fixed. An issue with a
//    wrong fix comes again with its id. The closed issue does not come again.
// 17. The gate "The task is done" ends the task, and Claude checks the commit message again (the condition of phase 13).
// The commands write the settings of proposal P15, and the test checks these files. The CLI loads the 2 plugins with
// --plugin-dir from the folders that the commands wrote. The CLI uses the login and thus the config folder of the user,
// and a marketplace from settings would go into the plugin data of the user.
// The settings of the user do not change: the test build has its own user data, MCP registry, folder for the settings
// of Claude Code and Shotgun folder. The test records the plugin data of Claude Code of the user before the runs, and
// checks it after them. It removes the empty folders that the CLI makes there.
// The test uses the Claude subscription of the user for 18 runs of Claude Code, so it runs only on request.
// Usage: node scripts/test-claude.mjs <new run folder>
// Environment: DATAFLOW_REPO (default: ../DataFlow), CLAUDE_EXE (default: the CLI of the VS Code extension of Claude Code)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
	callBridgeTool as harnessCallBridgeTool, checkBridge as harnessCheckBridge, cleanEnv, cleanUserData, clickAt, clickDialog, codeExe as harnessCodeExe,
	command, inWebview as harnessInWebview, killTree, listenersOf, poll, quickInput, quickPickNth, readJson, runClaude as harnessRunClaude, sleep,
	stopProcessesOf, userState, waitFor, workbench as harnessWorkbench,
} from './harness.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const DATAFLOW = path.resolve(process.env.DATAFLOW_REPO ?? path.join(repo, '..', 'DataFlow'));
const PORT = 9361;
// The port of the MCP server of DataFlow in the test build. A different window of DataFlow can have the default 47321
const MCP_PORT = 47391;
const TITLE = 'A cycle limit for the solver';
const TASK_1 = 'a-cycle-limit-for-the-solver';
const GET_SESSION = 'mcp__plugin_dataflow_dataflow__shotgun_get_session';
const SUBMIT_BRIEF = 'mcp__plugin_dataflow_dataflow__shotgun_submit_brief';
const SUBMIT_QUESTIONS = 'mcp__plugin_dataflow_dataflow__shotgun_submit_questions';
const SUBMIT_SURVEY = 'mcp__plugin_dataflow_dataflow__shotgun_submit_survey';
const GET_ORDER = 'mcp__plugin_dataflow_dataflow__shotgun_get_order';
const SUBMIT_TASK_SURVEY = 'mcp__plugin_dataflow_dataflow__shotgun_submit_task_survey';
const SUBMIT_PLAN = 'mcp__plugin_dataflow_dataflow__shotgun_submit_plan';
const GET_PLAN = 'mcp__plugin_dataflow_dataflow__shotgun_get_plan';
const GET_STEP = 'mcp__plugin_dataflow_dataflow__shotgun_get_step';
const START_STEP = 'mcp__plugin_dataflow_dataflow__shotgun_start_step';
const SUBMIT_ERRAND = 'mcp__plugin_dataflow_dataflow__shotgun_submit_errand';
const SUBMIT_FRAME = 'mcp__plugin_dataflow_dataflow__shotgun_submit_frame';
const GET_CALLOUTS = 'mcp__plugin_dataflow_dataflow__shotgun_get_callouts';
const SUBMIT_EXPLANATION = 'mcp__plugin_dataflow_dataflow__shotgun_submit_explanation';
const SUBMIT_LINE_ANSWER = 'mcp__plugin_dataflow_dataflow__shotgun_submit_line_answer';
const GET_COMMIT_MESSAGE = 'mcp__plugin_dataflow_dataflow__shotgun_get_commit_message';
const SUBMIT_MESSAGE_CHECK = 'mcp__plugin_dataflow_dataflow__shotgun_submit_message_check';
const GET_REVIEW = 'mcp__plugin_dataflow_dataflow__shotgun_get_review';
const SUBMIT_REVIEW = 'mcp__plugin_dataflow_dataflow__shotgun_submit_review';
const SUBMIT_FIX_PLAN = 'mcp__plugin_dataflow_dataflow__shotgun_submit_fix_plan';
// The read tools of DataFlow for the survey
const READ_TOOLS = ['list_functions', 'get_outline', 'get_place', 'get_callers', 'get_calls', 'get_threads', 'get_heat', 'get_flow', 'get_logic',
	'get_structure', 'get_member_sites', 'get_includes', 'get_call_graph', 'get_hidden'].map((t) => `mcp__plugin_dataflow_dataflow__${t}`);
// The number of the tools of Shotgun in the MCP server of DataFlow
const SHOTGUN_TOOLS = 22;
// The brief of task 1, as the user writes it in brief.md
const BRIEF_1 = [
	`# Brief: ${TITLE}`, '',
	'## Goal', '', 'The controller must not wait without end for a solver that does not converge.', '',
	'## Facts', '', '- process() runs one time in each cycle of the main loop.', '- The solver runs on a worker thread of the executor.',
	'- In the planning state, the controller waits until the solver is done.', '',
	'## Specs', '', '- After a limit of cycles, the controller goes to the next price slot.', '- The limit is a setting. The default is 8 cycles.', '',
	'## Not in scope', '', '- A time limit in seconds.', '',
	'## Done when', '', '- A test with a solver that does not converge passes.', '',
].join('\n');
// The brief of task 2, as the user gives it in the chat
const CHAT_PROMPT = 'Here is my brief for a new Shotgun task, a log line for the preset. Goal: The controller writes which preset it selects. '
	+ 'Facts: best_preset() selects the preset in src/battery.cpp. log_info() writes a line to the log. '
	+ 'Specs: The controller writes 1 log line for each selected preset. The line has the name of the preset. '
	+ 'Not in scope: A new log file. Done when: A test reads the log line. Give this brief to Shotgun.';
// The parser of the brief of Shotgun, from the build. The test runs after "npm run compile"
const { foreignLines, parseBrief } = createRequire(import.meta.url)(path.join(repo, 'out', 'session', 'brief.js'));
// The rules of the levels with the open decisions, and the check of an obvious hole (phase 11)
const { levelOf, openDecisions, stepWriterOf } = createRequire(import.meta.url)(path.join(repo, 'out', 'session', 'plan.js'));
const { isObviousAnswer } = createRequire(import.meta.url)(path.join(repo, 'out', 'session', 'frame.js'));
// the parts of a round of the review and the issues to fix in the sequence of the user (decision 43)
const { reviewPhase, reviewPrompt, toFix } = createRequire(import.meta.url)(path.join(repo, 'out', 'session', 'review.js'));
const hashOf = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

//-------------------
// The run folder

const dirArg = process.argv[2];
if (!dirArg) {
	console.error('Usage: node scripts/test-claude.mjs <new run folder>');
	process.exit(2);
}
const dir = path.resolve(dirArg);
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
	console.error(`The folder ${dir} is not empty. Use a new run folder.`);
	process.exit(2);
}
const p = {
	project: path.join(dir, 'project'),
	registry: path.join(dir, 'registry'),
	claudeConfig: path.join(dir, 'claude-config'),
	shotgunHome: path.join(dir, 'shotgun-home'),
	userData: path.join(dir, 'user-data'),
};
const userSettings = path.join(p.claudeConfig, 'settings.json');
const localSettings = path.join(p.project, '.claude', 'settings.local.json');
const dataflowPlugin = path.join(p.registry, 'claude', 'plugins', 'dataflow');
const shotgunPlugin = path.join(p.shotgunHome, 'claude', 'plugins', 'shotgun');

const results = { checks: [], runs: {} };
function check(name, isOk, detail) {
	results.checks.push({ name, isOk, ...(detail === undefined ? {} : { detail }) });
	console.log(`${isOk ? 'PASS' : 'FAIL'} ${name}${!isOk && detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
}

// A copy of the fixture battery of DataFlow with git and a compile database
function setup() {
	const fixture = path.join(DATAFLOW, 'test', 'fixtures', 'battery');
	for (const name of ['src', 'include', '.vscode', 'CMakeLists.txt']) {
		fs.cpSync(path.join(fixture, name), path.join(p.project, name), { recursive: true });
	}
	const build = path.join(p.project, 'build');
	fs.mkdirSync(build, { recursive: true });
	const sources = fs.readdirSync(path.join(p.project, 'src')).filter((f) => f.endsWith('.cpp'));
	fs.writeFileSync(path.join(build, 'compile_commands.json'), JSON.stringify(sources.map((f) => {
		const file = path.join(p.project, 'src', f);
		return { directory: build, file, arguments: ['clang++', '-std=c++20', `-I${path.join(p.project, 'include')}`, '-c', file] };
	}), null, 2));
	fs.writeFileSync(path.join(p.project, '.gitignore'), 'build/\n');
	const git = (...args) => execFileSync('git', ['-c', 'user.name=Shotgun test', '-c', 'user.email=test@example.invalid', ...args],
		{ cwd: p.project, stdio: 'pipe', windowsHide: true });
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-q', '-m', 'Add the battery fixture for the test');
	const user = path.join(p.userData, 'User');
	fs.mkdirSync(user, { recursive: true });
	fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
		'dataflow.mcp.enabled': true,
		'dataflow.mcp.port': MCP_PORT,
		'dataflow.engine.maxThreads': 8,
		'workbench.startupEditor': 'none',
		'workbench.secondarySideBar.defaultVisibility': 'visible',
		'chat.disableAIFeatures': true,
		// a modal message of VS Code is then a part of the page, and not a dialog of Windows
		'window.dialogStyle': 'custom',
		'git.openRepositoryInParentFolders': 'never',
		// the Source Control view keeps the input box of the commit message in view. With autoReveal, the view scrolls to
		// the file of the active editor
		'scm.autoReveal': false,
		'security.workspace.trust.enabled': false,
		'window.restoreWindows': 'none',
		'update.mode': 'none',
		'extensions.autoUpdate': false,
		'extensions.autoCheckUpdates': false,
		'telemetry.telemetryLevel': 'off',
	}, null, 2));
}

//-------------------
// VS Code through the Chrome DevTools Protocol, with the functions of harness.mjs

const workbench = () => harnessWorkbench(PORT, dir);
const quickPickFirst = (wb, title) => quickPickNth(wb, title, 0);

// The text of the logs of Shotgun in the test build
function shotgunLog() {
	const found = [];
	const walk = (folder) => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				walk(file);
			} else if (entry.name === 'Shotgun.log') {
				found.push(file);
			}
		}
	};
	try {
		walk(path.join(p.userData, 'logs'));
	} catch {
		return '';
	}
	return found.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

const taskFile = (id, name) => path.join(p.project, '.shotgun', id, name);
// The changed files of the project in git, with no file of .shotgun
const gitChanges = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p.project, encoding: 'utf8', windowsHide: true })
	.split('\n').filter((l) => l.trim() && !l.includes('.shotgun/')).map((l) => l.slice(3).trim().replace(/^"|"$/g, ''));
// The changed files of the project with the hash of their text now
const fileHashes = () => new Map(gitChanges().map((f) => [f, fs.existsSync(path.join(p.project, f)) ? hashOf(path.join(p.project, f)) : 'deleted']));
const ledgerOf = (id) => (fs.existsSync(taskFile(id, 'decisions.jsonl'))
	? fs.readFileSync(taskFile(id, 'decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// Saves the active text editor with Ctrl+S. In the Command Palette, "File: Save" can select a different command, for
// example "File: Compare Active File with Saved". The result: true if the file on the disk has the text
async function saveEditor(wb, file, text) {
	const box = await wb.evaluate(`(() => {
		const r = [...document.querySelectorAll('.part.editor .monaco-editor .view-lines')].map((e) => e.getBoundingClientRect()).find((x) => x.width > 0);
		return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
	if (box) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await wb.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
		}
	}
	await sleep(300);
	await wb.key('s', 'KeyS', 83, 2); // ctrl+s
	return !!(await poll(() => fs.readFileSync(file, 'utf8').includes(text) || undefined, 10));
}

// Runs a script in the webview of Shotgun with this root element: .panel for the panel, .page for the page
const inWebview = (root, script) => harnessInWebview(PORT, root, script);

// The text of the webview of the panel of Shotgun, or undefined
const panelText = () => inWebview('.panel', '() => d.body.innerText');
// The text of the page of Shotgun, or undefined
const pageText = () => inWebview('.page', '() => d.body.innerText');

//-------------------
// The bridge of DataFlow and Claude Code, with the functions of harness.mjs

// Calls 1 tool of the MCP server of DataFlow through the bridge, as a client with no Claude
const callBridgeTool = (name, args) => harnessCallBridgeTool({ pluginDir: dataflowPlugin, cwd: p.project }, name, args);
const checkBridge = () => harnessCheckBridge({ pluginDir: dataflowPlugin, cwd: p.project });

// options: tools, the tools that Claude can use with no permission prompt, maxTurns and seconds, the time limit, and
// plugins. With plugins false, the run has no plugins, thus no tools of Shotgun and no guard
async function runClaude(name, prompt, { tools = [GET_SESSION, SUBMIT_BRIEF, SUBMIT_QUESTIONS, 'Skill'], maxTurns = 8, seconds = 300, plugins = true } = {}) {
	const run = await harnessRunClaude({
		name, prompt, cwd: p.project, logDir: dir, pluginDirs: plugins ? [dataflowPlugin, shotgunPlugin] : [], tools, maxTurns, seconds,
	});
	results.runs[name] = run;
	return run;
}

//-------------------

async function main() {
	setup();
	const before = userState();
	const proc = spawn(harnessCodeExe(DATAFLOW), [
		`--extensionDevelopmentPath=${DATAFLOW}`, `--extensionDevelopmentPath=${repo}`,
		`--user-data-dir=${p.userData}`, `--extensions-dir=${path.join(dir, 'extensions')}`,
		`--remote-debugging-port=${PORT}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', p.project,
	], {
		detached: true, stdio: 'ignore', windowsHide: true,
		env: cleanEnv({ DATAFLOW_MCP_REGISTRY: p.registry, CLAUDE_CONFIG_DIR: p.claudeConfig, SHOTGUN_HOME: p.shotgunHome }),
	});
	proc.unref();
	let wb;
	try {
		wb = await workbench();
		await sleep(4000);

		// the commands of the user in VS Code
		await command(wb, 'Shotgun: New Task');
		await quickInput(wb, TITLE, 'Shotgun: New Task');
		const active = await waitFor(() => readJson(path.join(p.project, '.shotgun', 'active.json')), 30, 'active.json');
		check('"Shotgun: New Task" makes the active task', active.task === 'a-cycle-limit-for-the-solver', active);
		await command(wb, 'DataFlow: Connect to Claude Code');
		await waitFor(() => readJson(userSettings)?.enabledPlugins?.['dataflow@dataflow-vscode'] === true, 30, 'connection of DataFlow');
		await command(wb, 'Shotgun: Connect to Claude Code');
		await waitFor(() => readJson(userSettings)?.extraKnownMarketplaces?.['shotgun-vscode'], 30, 'marketplace of Shotgun');
		const local = await waitFor(() => readJson(localSettings), 30, 'local settings');
		check('Connect: the marketplace of Shotgun is in the user settings of the run',
			readJson(userSettings).extraKnownMarketplaces['shotgun-vscode'].source.path === path.join(p.shotgunHome, 'claude'));
		check('Connect: the plugin of Shotgun is on in the local settings of the project', local.enabledPlugins?.['shotgun@shotgun-vscode'] === true, local);
		const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p.project, encoding: 'utf8', windowsHide: true });
		check('Connect: git does not show the local settings', !status.includes('settings.local.json'), status);
		let bridge = await checkBridge();
		const windowFiles = () => fs.readdirSync(p.registry).filter((n) => /^window-\d+\.json$/.test(n));
		// DataFlow 0.6.0 can give its server a different token than the token file at the first start of a profile:
		// 2 calls of getToken at the same time make 2 tokens. A new start of the server takes the token of the file
		if (String(bridge.error).includes('token is missing or wrong')) {
			results.notes = ['DataFlow: the server had a different token than the token file. The test started the MCP server of DataFlow again.'];
			console.log(`WARN ${results.notes[0]}`);
			await command(wb, 'DataFlow: Stop MCP Server');
			await waitFor(() => windowFiles().length === 0, 20, 'stop of the MCP server');
			await command(wb, 'DataFlow: Start MCP Server');
			await waitFor(() => windowFiles().length > 0, 20, 'start of the MCP server');
			bridge = await checkBridge();
		}
		results.bridge = bridge;
		const windows = windowFiles().map((n) => readJson(path.join(p.registry, n)));
		check(`The bridge of DataFlow lists the ${SHOTGUN_TOOLS} tools of Shotgun`, bridge.shotgun?.length === SHOTGUN_TOOLS,
			{ ...bridge, windows, listeners: bridge.shotgun?.length === SHOTGUN_TOOLS ? undefined : listenersOf(MCP_PORT) });
		if (bridge.shotgun?.length !== SHOTGUN_TOOLS) {
			throw new Error('The bridge does not work, so the test does not run Claude Code.');
		}

		// task 1: the brief in a file. "Shotgun: New Task" made brief.md from the template and opened it
		const brief1 = taskFile(TASK_1, 'brief.md');
		const tab = await wb.evaluate("document.querySelector('.part.editor .tab.active')?.textContent ?? ''");
		const template = fs.readFileSync(brief1, 'utf8');
		check('"Shotgun: New Task" makes brief.md from the template, with the note that each part is optional, and opens it',
			template.startsWith(`# Brief: ${TITLE}\n\n<!-- All parts are optional.`) && template.includes('\n## Goal\n') && String(tab).includes('brief.md'), tab);
		let text = await poll(async () => (await panelText())?.includes('0 of 5') && true, 15);
		check('The panel shows the parts of the empty brief', !!text, await panelText());
		// each part of the brief is optional, so the gate is on with the empty brief (decision 22)
		const isGateOn = await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The brief is ready'));
			return !!b && !b.disabled;
		}`);
		check('The gate "The brief is ready" is on with the empty brief', isGateOn === true, await panelText());
		// the sidebar of Shotgun in the activity bar: the task, the page and the other commands (decision 23)
		const sidebarBox = await wb.evaluate(`(() => {
			const a = [...document.querySelectorAll('.part.activitybar .action-item .action-label')].find((e) => /^Shotgun/.test(e.getAttribute('aria-label') ?? ''));
			const r = a?.getBoundingClientRect();
			return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
		if (sidebarBox) {
			await clickAt(wb, sidebarBox);
		}
		const sidebar = await poll(() => wb.evaluate(`(() => {
			const t = document.querySelector('.part.sidebar')?.innerText ?? '';
			return ['${TITLE}', 'Show Page', 'Open Brief', 'Open Project Folder', 'Show Log'].every((x) => t.includes(x)) ? t : undefined; })()`), 15);
		check('The sidebar of Shotgun shows the task, "Show Page", "Open Brief", "Open Project Folder" and "Show Log"', !!sidebarBox && !!sidebar,
			{ sidebarBox, sidebar: await wb.evaluate("document.querySelector('.part.sidebar')?.innerText ?? ''") });
		await wb.shot('sidebar.png');
		// the Explorer comes back into the sidebar
		const explorerBox = await wb.evaluate(`(() => {
			const a = [...document.querySelectorAll('.part.activitybar .action-item .action-label')].find((e) => /^Explorer/.test(e.getAttribute('aria-label') ?? ''));
			const r = a?.getBoundingClientRect();
			return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
		if (explorerBox) {
			await clickAt(wb, explorerBox);
		}
		fs.writeFileSync(brief1, BRIEF_1);
		text = await poll(async () => (await panelText())?.includes('5 of 5') && true, 15);
		check('The panel shows the 5 parts of the brief of the user', !!text, await panelText());

		// 1: Claude asks questions about the brief
		const asked = await runClaude('questions', 'Ask me questions about my brief.');
		const names = asked.toolUses.map((t) => t.name);
		const isPlugin = (name, folder) => asked.plugins.some((x) => x.name === name && path.resolve(x.path) === path.resolve(folder));
		check('Claude Code loads the plugins that DataFlow and Shotgun wrote', isPlugin('dataflow', dataflowPlugin) && isPlugin('shotgun', shotgunPlugin),
			asked.plugins);
		check('The MCP server of DataFlow is connected', asked.servers.some((s) => s.name === 'plugin:dataflow:dataflow' && s.status === 'connected'), asked.servers);
		const context = asked.hooks.find((h) => h.hook === 'UserPromptSubmit');
		check('The context hook gives the task to Claude', String(context?.output).includes(`the active task is \\"${TITLE}\\"`)
			|| String(context?.output).includes(`the active task is "${TITLE}"`), context);
		check('The request loads the skill shotgun', asked.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun')), names);
		check('Claude reads the session with shotgun_get_session', names.includes(GET_SESSION), names);
		check('Claude gives its questions with shotgun_submit_questions', names.includes(SUBMIT_QUESTIONS), names);
		const open = (readJson(taskFile(TASK_1, 'questions.json'))?.questions ?? []).filter((q) => q.state === 'open');
		check('questions.json has the open questions of Claude', open.length >= 1 && open.length <= 10, open);
		text = await poll(async () => open.length > 0 && (await panelText())?.includes(open[0].text) && true, 15);
		check('The panel shows the questions of Claude', !!text, await panelText());
		check('Claude did not change the brief', fs.readFileSync(brief1, 'utf8') === BRIEF_1);
		await wb.shot('panel-questions.png');

		// the user closes the questions
		for (let i = 0; i < open.length; i++) {
			await command(wb, 'Shotgun: Close Question');
			await quickPickFirst(wb, 'Shotgun: Close Question');
			await sleep(600);
		}
		const closed = readJson(taskFile(TASK_1, 'questions.json'))?.questions ?? [];
		check('"Shotgun: Close Question" closes each question', closed.length > 0 && closed.every((q) => q.state === 'closed'), closed.map((q) => q.state));
		check('The ledger records each closed question', ledgerOf(TASK_1).filter((d) => d.kind === 'question').length === open.length,
			ledgerOf(TASK_1).map((d) => d.kind));

		// 2: the guard denies a change in stage 1
		const file = path.join(p.project, 'src', 'battery.cpp');
		const hash = hashOf(file);
		const edit = await runClaude('edit', "With the Edit tool, add the line '// e2e' at the end of src/battery.cpp. Use no other way to change a file. "
			+ 'Then tell me what happened, and quote each message that blocked the change.');
		const guard = edit.hooks.find((h) => h.hook === 'PreToolUse:Edit');
		check('The guard hook denies the edit with the reason of stage 1', String(guard?.output).includes('"permissionDecision":"deny"')
			&& String(guard?.output).includes('stage 1 of 6, the brief'), guard);
		check('Claude gets the reason of the deny', edit.toolResults.some((r) => r.isError && r.text.includes('stage 1 of 6, the brief')), edit.toolResults);
		check('The file did not change', hashOf(file) === hash);
		const deny = ledgerOf(TASK_1).find((d) => d.kind === 'deny');
		check('The ledger records the deny', deny?.tool === 'Edit' && deny?.file === 'src/battery.cpp', deny);
		text = await poll(async () => (await panelText())?.includes('The guard stopped Edit of src/battery.cpp.') && true, 15);
		check('The panel shows the deny', !!text, await panelText());

		// the gate of task 1
		await command(wb, 'Shotgun: Pass the Gate');
		const task1 = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'survey' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "The brief is ready" takes task 1 to stage 2', task1?.gates?.[0]?.gate === 'brief-ready', readJson(taskFile(TASK_1, 'task.json')));
		const scan = await poll(() => shotgunLog().includes('The scan of the call graph started'), 20);
		check('The gate starts the scan of the call graph', !!scan, shotgunLog().slice(-1000));

		// 3: task 2, the brief from the chat
		const chat = await runClaude('chat', CHAT_PROMPT);
		const chatNames = chat.toolUses.map((t) => t.name);
		check('The brief in the chat loads the skill shotgun', chat.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun')), chatNames);
		check('Claude gives the brief with shotgun_submit_brief', chatNames.includes(SUBMIT_BRIEF), chatNames);
		const refused = chat.toolResults.filter((r) => r.isError && r.text.includes('did not take the brief')).length;
		if (refused > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refused} brief of Claude before it took the brief.`];
			console.log(`NOTE Shotgun refused ${refused} brief of Claude before it took the brief.`);
		}
		const task2 = readJson(path.join(p.project, '.shotgun', 'active.json'))?.task;
		check('Shotgun makes task 2 for the brief from the chat', !!task2 && task2 !== TASK_1, task2);
		const brief2 = task2 && fs.existsSync(taskFile(task2, 'brief.md')) ? fs.readFileSync(taskFile(task2, 'brief.md'), 'utf8') : '';
		const body2 = brief2.split('\n').slice(1).join('\n');
		check('Each line of brief 2 is in the words of the user', !!body2.trim() && foreignLines(body2.replace(/<!--[^>]*-->/g, ''), [CHAT_PROMPT]).length === 0,
			{ foreign: foreignLines(body2.replace(/<!--[^>]*-->/g, ''), [CHAT_PROMPT]), brief2 });
		check('Each part of brief 2 has text', parseBrief(brief2).isComplete, brief2);
		check('The ledger of task 2 records the brief of Claude', ledgerOf(task2).some((d) => d.kind === 'brief' && d.by === 'claude'),
			ledgerOf(task2).map((d) => `${d.kind}:${d.by}`));

		// the gate of task 2
		await command(wb, 'Shotgun: Pass the Gate');
		const done2 = await poll(() => (readJson(taskFile(task2, 'task.json'))?.stage === 'survey' ? readJson(taskFile(task2, 'task.json')) : undefined), 20);
		check('The gate "The brief is ready" takes task 2 to stage 2', done2?.gates?.[0]?.gate === 'brief-ready', readJson(taskFile(task2, 'task.json')));
		check('2 new tasks went from the brief to stage 2: 1 from a file and 1 from the chat', task1?.stage === 'survey' && done2?.stage === 'survey');

		// the panel and the page
		await command(wb, 'Focus on Shotgun View');
		await sleep(1500);
		text = await panelText();
		check('The panel shows stage 2 of task 2 with its request', !!text?.includes('Survey my brief.') && !!text?.includes('Claude gave your brief from the chat'), text);
		await wb.shot('panel.png');
		await command(wb, 'Shotgun: Show Page');
		await sleep(2000);
		await wb.shot('page.png');

		// 4: the survey of task 1 (phase 3). A click in the editor area for the Command Palette must not hit the page, so
		// the test uses the page first, then opens a text editor, and then uses the Command Palette
		await command(wb, 'Shotgun: Open Task');
		await quickInput(wb, TITLE, 'Shotgun: Open Task');
		const reopened = await poll(() => readJson(path.join(p.project, '.shotgun', 'active.json'))?.task === TASK_1, 20);
		check('"Shotgun: Open Task" makes task 1 the active task again', !!reopened, readJson(path.join(p.project, '.shotgun', 'active.json')));
		const surveyed = await runClaude('survey', 'Survey my brief.', { tools: [GET_SESSION, SUBMIT_SURVEY, 'Skill', ...READ_TOOLS], maxTurns: 40, seconds: 900 });
		const surveyNames = surveyed.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-survey', surveyed.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-survey')),
			surveyNames);
		check('Claude reads the code with the read tools of DataFlow', surveyNames.some((n) => READ_TOOLS.includes(n)), surveyNames);
		// Shotgun cannot see the tool calls of Claude, so only this test checks the tool of each fact (gap 43 of DataFlow)
		const called = new Set(surveyNames.filter((n) => READ_TOOLS.includes(n)).map((n) => n.replace('mcp__plugin_dataflow_dataflow__', '')));
		check('Claude gives the survey with shotgun_submit_survey', surveyNames.includes(SUBMIT_SURVEY), surveyNames);
		const refusedSurveys = surveyed.toolResults.filter((r) => r.isError && r.text.includes('did not take the survey')).length;
		if (refusedSurveys > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedSurveys} survey of Claude before it took the survey.`];
			console.log(`NOTE Shotgun refused ${refusedSurveys} survey of Claude before it took the survey.`);
		}
		const survey = readJson(taskFile(TASK_1, 'survey.json'));
		const engine = readJson(taskFile(TASK_1, 'engine.json'));
		check('survey.json has the tasks and the hooks of Claude', survey?.tasks?.length >= 1 && survey?.hooks?.length >= 1, survey);
		const uncited = (survey?.facts ?? []).filter((f) => !called.has(f.tool));
		check('Each fact names a read tool of DataFlow that Claude called', !!survey && uncited.length === 0, { called: [...called], uncited });
		const cppHooks = (survey?.hooks ?? []).filter((h) => /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(h.file));
		check('Each hook in a C++ file has the facts of DataFlow', cppHooks.length > 0 && cppHooks.every((h) => engine?.hooks?.[h.id]?.hasFacts === true),
			cppHooks.map((h) => ({ id: h.id, engine: engine?.hooks?.[h.id] })));
		const inFunctions = cppHooks.filter((h) => engine?.hooks?.[h.id]?.function);
		check('Each hook in a function has its heat', inFunctions.length > 0 && inFunctions.every((h) => engine.hooks[h.id].heat),
			inFunctions.map((h) => ({ id: h.id, engine: engine?.hooks?.[h.id] })));
		results.survey = {
			tasks: survey?.tasks?.length, hooks: survey?.hooks?.length, facts: survey?.facts?.length, questions: survey?.questions?.length,
			isReachComplete: engine?.isReachComplete,
			heat: inFunctions.map((h) => {
				const heat = engine.hooks[h.id].heat;
				return `${h.id} ${h.file}:${h.lines[0]}-${h.lines[1]} ${heat?.function} ${heat?.score} ${heat?.band}`;
			}),
		};
		console.log(`INFO The survey: ${JSON.stringify(results.survey)}`);
		const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p.project, encoding: 'utf8', windowsHide: true })
			.split('\n').filter((l) => l.trim() && !l.includes('.shotgun/'));
		check('Claude changed no file of the project in stage 2', changed.length === 0, changed);
		text = await poll(async () => (await panelText())?.includes('The survey of Claude:') && true, 20);
		check('The panel shows the survey and its questions', !!text, await panelText());
		await wb.shot('panel-survey.png');

		// the page of the survey
		await command(wb, 'Shotgun: Show Page');
		const firstTask = survey?.tasks?.[0]?.title ?? '?';
		text = await poll(async () => {
			const t = await pageText();
			return t?.includes(firstTask) && t.includes('Order the tasks') ? t : undefined;
		}, 20);
		check('The page shows the survey with the gate "Order the tasks"', !!text, await pageText());
		await wb.shot('page-survey.png');
		const questions = survey?.questions ?? [];
		if (questions.length > 0) {
			// the first answer on the page
			await inWebview('.page', `() => {
				const t = d.querySelector('.answer textarea');
				if (!t) { return false; }
				t.value = 'The test answers on the page.';
				t.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
				return true;
			}`);
			await sleep(500);
			await inWebview('.page', `() => {
				const b = d.querySelector('.answer button:not([disabled])');
				b?.click();
				return !!b;
			}`);
			const first = await poll(() => readJson(taskFile(TASK_1, 'answers.json'))?.answers?.[questions[0].id], 15);
			check('The page saves an answer of the user', first?.text === 'The test answers on the page.', readJson(taskFile(TASK_1, 'answers.json')));
		}

		// a click on a hook shows it in the side view of DataFlow, with its lines highlighted and the hook as the note
		// (decision 26). Then the page opens the place of the hook in the text editor, and the text editor shows the hook
		const hook = cppHooks[0] ?? survey?.hooks?.[0];
		if (hook) {
			// a C++ text editor of a different file is on the screen beside the page. Before DataFlow 0.6.2, a click then also
			// opened the file of the hook in that text editor (decision 34)
			const otherFile = /battery\.cpp$/.test(hook.file) ? 'include/battery/types.hpp' : 'src/battery.cpp';
			await command(wb, 'Go to File');
			await quickInput(wb, otherFile);
			await sleep(1500);
			await command(wb, 'View: Split Editor Right');
			await sleep(1000);
			await command(wb, 'Shotgun: Show Page');
			await poll(async () => (await pageText())?.includes(hook.id) && true, 15);
			const tabLabels = (selector) => wb.evaluate(`[...document.querySelectorAll(${JSON.stringify(`.part.editor ${selector} .label-name`)})].map((e) => e.textContent.trim())`);
			const visibleBefore = await tabLabels('.tab.active');
			await inWebview('.page', `() => {
				const row = [...d.querySelectorAll('.hooks .row')].find((r) => r.querySelector('.id')?.textContent === ${JSON.stringify(hook.id)});
				row?.click();
				return !!row;
			}`);
			const shownNote = await poll(() => (shotgunLog().includes(`DataFlow shows 1 note of Shotgun in ${path.basename(hook.file)}, lines ${hook.lines[0]} to ${hook.lines[1]}: ${hook.id} · `)
				? true : undefined), 15);
			const sideView = await poll(() => inWebview('.lensgroup', '() => true'), 15);
			check('A click on a hook shows it in the side view of DataFlow, with its lines highlighted and the hook as the note', !!shownNote && !!sideView,
				{ shownNote, sideView, log: shotgunLog().slice(-600) });
			await sleep(1000);
			const visibleAfter = await tabLabels('.tab.active');
			const dataflowTabs = (await tabLabels('.tab')).filter((l) => l.startsWith('DataFlow'));
			check('The click opens no text editor, and only 1 DataFlow window shows the hook', visibleBefore.includes(path.basename(otherFile))
				&& !visibleAfter.includes(path.basename(hook.file)) && dataflowTabs.length === 1, { visibleBefore, visibleAfter, dataflowTabs });
			await wb.shot('dataflow-hook.png');
			await sleep(500);
			await inWebview('.page', `() => {
				const b = [...d.querySelectorAll('button')].find((x) => x.textContent.includes('Open in the text editor'));
				b?.click();
				return !!b;
			}`);
			const tab = await poll(async () => {
				const t = await wb.evaluate("document.querySelector('.part.editor .tab.active')?.textContent ?? ''");
				return String(t).includes(path.basename(hook.file)) ? t : undefined;
			}, 15);
			await sleep(1000);
			const cursor = String(await wb.evaluate("document.getElementById('status.editor.selection')?.textContent ?? ''"));
			check('The page opens the place of the hook in the text editor', !!tab && cursor.includes(`Ln ${hook.lines[0]},`), { tab, cursor, hook });
			const mark = `${hook.id} · `;
			const label = await poll(() => wb.evaluate(`(() => {
				for (const el of document.querySelectorAll('.part.editor .view-lines span')) {
					const after = getComputedStyle(el, '::after').content;
					if (after && after.includes(${JSON.stringify(mark)})) { return after; }
					if (el.children.length === 0 && el.textContent.includes(${JSON.stringify(mark)})) { return el.textContent; }
				}
				return undefined;
			})()`), 10);
			check('The text editor shows the hook with its id and its title', !!label, label);
			await wb.shot('editor-hook.png');
		}

		// a click on the stage chip "1 Brief" returns task 1 to stage 1 after a question. The survey stays, and the gate of the
		// brief takes the task to stage 2 again (decision 24)
		const surveyText = fs.readFileSync(taskFile(TASK_1, 'survey.json'), 'utf8');
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.stage-btn')].find((x) => x.textContent.includes('1 Brief'));
			b?.click();
			return !!b;
		}`);
		const askedReturn = await poll(() => clickDialog(wb, 'Return'), 10);
		const returned = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'brief' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 15);
		check('A click on the stage "1 Brief" returns task 1 to stage 1 after a question, and the ledger records the return', !!askedReturn && !!returned
			&& returned.gates.length === 0 && ledgerOf(TASK_1).some((d) => d.kind === 'return' && d.from === 'survey' && d.to === 'brief'),
			{ askedReturn, task: readJson(taskFile(TASK_1, 'task.json')), ledger: ledgerOf(TASK_1).slice(-2) });
		// the CSS of the panel shows the names of the sections in capitals, so the check ignores the case
		text = await poll(async () => /parts of the brief/i.test((await panelText()) ?? '') || undefined, 15);
		await wb.shot('panel-returned.png');
		await command(wb, 'Shotgun: Pass the Gate');
		const surveyAgain = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'survey' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 15);
		check('The gate "The brief is ready" takes task 1 to stage 2 again, and the survey stays', !!text && !!surveyAgain
			&& fs.readFileSync(taskFile(TASK_1, 'survey.json'), 'utf8') === surveyText, { text: !!text, task: readJson(taskFile(TASK_1, 'task.json')) });

		// the other answers with the Command Palette, and the gate
		for (let i = 1; i < questions.length; i++) {
			await command(wb, 'Shotgun: Answer Question');
			await quickPickNth(wb, 'Shotgun: Answer Question', i);
			await quickInput(wb, `The test answers ${questions[i].id} with the Command Palette.`, `Shotgun: Answer ${questions[i].id}`);
			await sleep(800);
		}
		const answers = readJson(taskFile(TASK_1, 'answers.json'))?.answers ?? {};
		check('Each question of the survey has an answer', questions.every((q) => answers[q.id]?.text), answers);
		check('The ledger records each answer', ledgerOf(TASK_1).filter((d) => d.kind === 'answer').length === questions.length,
			ledgerOf(TASK_1).map((d) => d.kind));
		await command(wb, 'Shotgun: Pass the Gate');
		// with a question with no answer, a modal message asks first
		if (await poll(() => clickDialog(wb, 'Pass the Gate'), 2)) {
			results.notes = [...(results.notes ?? []), 'The gate "Order the tasks" asked about questions with no answer.'];
		}
		const ordered = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'order' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "Order the tasks" takes task 1 to stage 3', ordered?.gates?.[1]?.gate === 'order-tasks', readJson(taskFile(TASK_1, 'task.json')));
		text = await poll(async () => (await panelText())?.includes('Your sequence:') && true, 15);
		check('The panel shows the order of task 1 in stage 3', !!text, await panelText());
		await wb.shot('panel-order.png');

		// 5: the order of task 1 (phase 4). The user changes the text of a task, adds a task and moves it, on the page
		await command(wb, 'Shotgun: Show Page');
		const rows = await poll(async () => {
			const n = await inWebview('.page', "() => d.querySelectorAll('.order-row').length");
			return n > 0 ? n : undefined;
		}, 20);
		check('The page shows the order with the tasks of the survey', rows === survey?.tasks?.length, { rows, tasks: survey?.tasks?.length });
		const before = (readJson(taskFile(TASK_1, 'survey.json'))?.tasks ?? []).map((t) => t.title);
		const rewritten = `${before[0]}, with a limit from 1 to 100 cycles`;
		const added = 'Write the cycle limit to the log at the start of the program';
		// a text goes to the extension with Enter. The page needs a render between the input and the key
		const typeInto = async (selector, value) => {
			await inWebview('.page', `() => {
				const input = d.querySelector(${JSON.stringify(selector)});
				input.value = ${JSON.stringify(value)};
				input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
				return true;
			}`);
			await sleep(400);
			await inWebview('.page', `() => {
				d.querySelector(${JSON.stringify(selector)}).dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				return true;
			}`);
			await sleep(800);
		};
		await typeInto('.order-row .order-input', rewritten);
		await typeInto('.order-add .order-input', added);
		await poll(() => readJson(taskFile(TASK_1, 'order.json'))?.tasks?.length === before.length + 1, 10);
		// the new task goes up 1 place
		await inWebview('.page', `() => {
			const rows = [...d.querySelectorAll('.order-row')];
			rows[rows.length - 1].querySelector('button[aria-label="Move the task up"]').click();
			return true;
		}`);
		const order1 = await poll(() => {
			const o = readJson(taskFile(TASK_1, 'order.json'));
			return o?.tasks?.[o.tasks.length - 2]?.isNew ? o : undefined;
		}, 10);
		const tasks1 = order1?.tasks ?? [];
		check('The page changes the text of a task, adds a task and moves it', tasks1[0]?.text === rewritten && tasks1[tasks1.length - 2]?.text === added
			&& tasks1[tasks1.length - 2]?.id === 'N1', tasks1);
		check('The ledger records the 3 edits of the order', ledgerOf(TASK_1).filter((d) => d.kind === 'order').map((d) => d.action).join() === 'text,add,move',
			ledgerOf(TASK_1).filter((d) => d.kind === 'order'));
		text = await poll(async () => (await pageText())?.includes('2 with no survey') && true, 10);
		check('The page shows 2 tasks with no survey', !!text, await pageText());
		await wb.shot('page-order.png');

		// Claude surveys the 2 changed tasks
		const resurveyed = await runClaude('order', 'Survey my changed tasks.', {
			tools: [GET_SESSION, GET_ORDER, SUBMIT_TASK_SURVEY, 'Skill', ...READ_TOOLS], maxTurns: 40, seconds: 900,
		});
		const orderNames = resurveyed.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-survey', resurveyed.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-survey')),
			orderNames);
		check('Claude reads the order with shotgun_get_order', orderNames.includes(GET_ORDER), orderNames);
		check('Claude gives a survey for each changed task with shotgun_submit_task_survey', orderNames.filter((n) => n === SUBMIT_TASK_SURVEY).length >= 2,
			orderNames);
		const refusedTasks = resurveyed.toolResults.filter((r) => r.isError && r.text.includes('did not take the survey of the task')).length;
		if (refusedTasks > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedTasks} survey of a task before it took the survey.`];
			console.log(`NOTE Shotgun refused ${refusedTasks} survey of a task before it took the survey.`);
		}
		const order2 = readJson(taskFile(TASK_1, 'order.json'));
		const tasks2 = order2?.tasks ?? [];
		check('Claude changed no text and no place of a task', JSON.stringify(tasks2.map((t) => [t.id, t.text])) === JSON.stringify(tasks1.map((t) => [t.id, t.text])),
			{ before: tasks1.map((t) => [t.id, t.text]), after: tasks2.map((t) => [t.id, t.text]) });
		// the changed tasks: the first task with its new text, and the new task N1
		const changedNow = [tasks2[0], tasks2.find((t) => t.id === 'N1')].filter(Boolean);
		check('Each changed task has a survey for its text now', changedNow.length === 2 && changedNow.every((t) => t.survey?.text === t.text),
			changedNow.map((t) => ({ id: t.id, text: t.text, survey: t.survey })));
		const engine2 = readJson(taskFile(TASK_1, 'engine.json'));
		const newHooks = (readJson(taskFile(TASK_1, 'survey.json'))?.hooks ?? []).filter((h) => !(survey?.hooks ?? []).some((x) => x.id === h.id));
		check('Each new hook of a task survey has the facts of DataFlow', newHooks.every((h) => !/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(h.file)
			|| engine2?.hooks?.[h.id]?.hasFacts === true), newHooks.map((h) => ({ id: h.id, file: h.file, engine: engine2?.hooks?.[h.id] })));
		results.order = {
			tasks: tasks2.map((t) => ({ id: t.id, text: t.text, hooks: t.survey?.hooks, needs: t.survey?.needs, size: t.survey?.size, note: t.survey?.note })),
			newHooks: newHooks.map((h) => `${h.id} ${h.file}:${h.lines[0]}-${h.lines[1]}`),
		};
		console.log(`INFO The order: ${JSON.stringify(results.order)}`);
		const changedFiles = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p.project, encoding: 'utf8', windowsHide: true })
			.split('\n').filter((l) => l.trim() && !l.includes('.shotgun/'));
		check('Claude changed no file of the project in stage 3', changedFiles.length === 0, changedFiles);
		text = await poll(async () => (await pageText())?.includes('none with no survey') && true, 15);
		check('The page shows that each task has a survey', !!text, await pageText());
		await wb.shot('page-order-surveyed.png');

		// the gate "Accept the order". With a warning of the order check, a modal message asks first
		await inWebview('.page', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('Accept'));
			b?.click();
			return !!b;
		}`);
		if (await poll(() => clickDialog(wb, 'Pass the Gate'), 3)) {
			results.notes = [...(results.notes ?? []), 'The gate "Accept the order" asked about the warnings of the order check.'];
		}
		const planned = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'plan' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "Accept the order" of the page takes task 1 to stage 4', planned?.gates?.[2]?.gate === 'accept-order', readJson(taskFile(TASK_1, 'task.json')));
		text = await poll(async () => (await panelText())?.includes('Make the plan.') && true, 15);
		check('The panel shows stage 4 of task 1 with its request', !!text, await panelText());
		await wb.shot('panel-plan.png');

		// 6: the plan of task 1 (phase 5). Claude makes the steps, and the rules give each step a level from the facts of DataFlow
		const planRun = await runClaude('plan', 'Make the plan.', {
			tools: [GET_SESSION, GET_ORDER, SUBMIT_TASK_SURVEY, SUBMIT_PLAN, GET_PLAN, 'Skill', ...READ_TOOLS], maxTurns: 50, seconds: 900,
		});
		const planNames = planRun.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-plan', planRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-plan')), planNames);
		check('Claude gives the plan with shotgun_submit_plan', planNames.includes(SUBMIT_PLAN), planNames);
		const refusedPlans = planRun.toolResults.filter((r) => r.isError && r.text.includes('did not take the plan')).length;
		if (refusedPlans > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedPlans} plan of Claude before it took the plan.`];
			console.log(`NOTE Shotgun refused ${refusedPlans} plan of Claude before it took the plan.`);
		}
		const plan = readJson(taskFile(TASK_1, 'plan.json'));
		const steps = plan?.steps ?? [];
		const inPlan = tasks2.filter((t) => !t.isLater).map((t) => t.id);
		check('Each task of the plan has 1 step or more, in the sequence of the order', steps.length >= inPlan.length
			&& inPlan.every((id) => steps.some((s) => s.task === id))
			&& steps.every((s, i) => i === 0 || inPlan.indexOf(s.task) >= inPlan.indexOf(steps[i - 1].task)), steps.map((s) => [s.id, s.task]));
		// the scan of the call graph ended at the start of stage 2, so each step has a level of the rules
		const risk = await poll(() => {
			const r = readJson(taskFile(TASK_1, 'risk.json'));
			return r && steps.every((s) => r.steps?.[s.id]?.level) ? r : undefined;
		}, 60);
		check('The rules give each step a level from the facts of DataFlow', !!risk, readJson(taskFile(TASK_1, 'risk.json')));
		// the open decisions of each step (decision 31), and a step that adds a data member next to the other members (P26)
		const levelsNow = () => readJson(taskFile(TASK_1, 'levels.json'));
		check('Each step of the plan gives its open decisions', steps.every((s) => Array.isArray(s.decisions)), steps.map((s) => [s.id, s.decisions]));
		const memberSteps = steps.filter((s) => s.places.length > 0 && s.places.every((pl) => pl.lines && /types\.hpp$/.test(pl.file)));
		check('A step that adds a data member has a place with insert, and gets level 2', memberSteps.length > 0
			&& memberSteps.every((s) => s.places.every((pl) => pl.insert === true) && (risk?.steps?.[s.id]?.level ?? 9) <= 2),
			memberSteps.map((s) => ({ id: s.id, places: s.places, level: risk?.steps?.[s.id]?.level, reasons: risk?.steps?.[s.id]?.reasons })));
		results.plan = {
			steps: steps.map((s) => {
				const l = risk ? levelOf(s, risk, levelsNow()) : undefined;
				return {
					id: s.id, task: s.task, title: s.title, places: s.places.map((p) => (p.lines ? `${p.file}:${p.lines[0]}-${p.lines[1]}${p.insert ? ' (insert)' : ''}` : `${p.file} (new)`)),
					heat: l?.heat ?? null, level: l?.rule ?? null, decisions: (s.decisions ?? []).map((d) => d.question), reasons: risk?.steps?.[s.id]?.reasons ?? [],
				};
			}),
		};
		console.log(`INFO The plan: ${JSON.stringify(results.plan.steps.map((s) => `${s.id} ${s.task} heat ${s.heat} level ${s.level} decisions ${s.decisions.length} ${s.places.join(' ')}`))}`);
		const planFiles = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p.project, encoding: 'utf8', windowsHide: true })
			.split('\n').filter((l) => l.trim() && !l.includes('.shotgun/'));
		check('Claude changed no file of the project in stage 4', planFiles.length === 0, planFiles);

		// the page of the plan, and a step in the text editor with its CodeLens line
		await command(wb, 'Shotgun: Show Page');
		text = await poll(async () => {
			const t = await pageText();
			return t?.includes(steps[0]?.title ?? '?') && t.includes('Accept the plan') ? t : undefined;
		}, 20);
		check('The page shows the plan with the gate "Accept the plan"', !!text, await pageText());
		await wb.shot('page-plan.png');
		const withLines = steps.findIndex((s) => s.places.some((pl) => pl.lines));
		if (withLines >= 0) {
			const placeFile = steps[withLines].places.find((pl) => pl.lines).file;
			await inWebview('.page', `() => {
				d.querySelectorAll('.step-row')[${withLines}].click();
				return true;
			}`);
			await sleep(500);
			await inWebview('.page', `() => {
				const b = [...d.querySelectorAll('button')].find((x) => x.textContent.includes('Open in the text editor'));
				b?.click();
				return !!b;
			}`);
			const lens = await poll(() => wb.evaluate(`(() => {
				const t = [...document.querySelectorAll('.part.editor .codelens-decoration')].map((e) => e.textContent).find((x) => x.includes('Step ${withLines + 1} of'));
				return t;
			})()`), 20);
			check('The text editor shows the step with its CodeLens line', !!lens && String(lens).includes('risk'), { lens, placeFile });
			await wb.shot('editor-step.png');
		}

		// the user changes the level of step 1 and writes a note on the page
		await command(wb, 'Shotgun: Show Page');
		await poll(async () => (await pageText())?.includes('Accept the plan') && true, 15);
		// the level of the rules on the page: with no open decision, it is at most 2 (decision 31)
		const rule1 = (steps[0] && risk ? levelOf(steps[0], risk, levelsNow()).rule : 0) ?? 0;
		const button = rule1 >= 5 ? 'Lower' : 'Raise';
		await inWebview('.page', `() => {
			d.querySelectorAll('.step-row')[0].click();
			return true;
		}`);
		await sleep(500);
		await inWebview('.page', `() => {
			const b = [...d.querySelectorAll('.pill')].find((x) => x.textContent.trim() === ${JSON.stringify(button)});
			b?.click();
			return !!b;
		}`);
		const note = 'The test changes this level.';
		await inWebview('.page', `() => {
			const input = d.querySelector('.note-field input');
			input.value = ${JSON.stringify(note)};
			input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
			return true;
		}`);
		await sleep(400);
		await inWebview('.page', `() => {
			d.querySelector('.note-field input').dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			return true;
		}`);
		const userLevel = await poll(() => {
			const l = readJson(taskFile(TASK_1, 'levels.json'))?.levels?.[steps[0]?.id];
			return l?.level && l?.note ? l : undefined;
		}, 15);
		check('The page changes the level of a step and keeps the note of the user', userLevel?.level === rule1 + (button === 'Raise' ? 1 : -1)
			&& userLevel?.note === note, readJson(taskFile(TASK_1, 'levels.json')));
		check('The ledger records the level and the note', ledgerOf(TASK_1).filter((d) => d.kind === 'level' || d.kind === 'level-note').map((d) => d.kind).join() === 'level,level-note',
			ledgerOf(TASK_1).filter((d) => d.kind === 'level' || d.kind === 'level-note'));
		await wb.shot('page-plan-level.png');

		// the open decisions on the page (P29). The user adds a decision to step 3, so its frame has a hole for it. The user
		// answers a decision of Claude in a step after step 5, which the test does not build
		const typeOnPage = async (text) => {
			await sleep(500);
			await inWebview('.page', `() => {
				const input = d.querySelector('.decision-entry input');
				input.value = ${JSON.stringify(text)};
				input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
				return true;
			}`);
			await sleep(400);
			await inWebview('.page', `() => {
				d.querySelector('.decision-entry input').dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				return true;
			}`);
		};
		const clickOnPage = (selector, label) => inWebview('.page', `() => {
			const b = [...d.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
			b?.click();
			return !!b;
		}`);
		const added3 = 'Which cycles of the wait count, and when does the count start again?';
		await inWebview('.page', `() => {
			d.querySelectorAll('.step-row')[2].click();
			return true;
		}`);
		await sleep(500);
		await clickOnPage('.pill', 'Add a decision');
		await typeOnPage(added3);
		const withAdded = await poll(() => (levelsNow()?.levels?.[steps[2]?.id]?.added ?? []).find((x) => x.question === added3), 15);
		check('The page adds a decision of the user to step 3, and the ledger records it', !!withAdded
			&& ledgerOf(TASK_1).some((x) => x.kind === 'decision' && x.action === 'add' && x.step === steps[2]?.id), levelsNow());
		await wb.shot('page-plan-decisions.png');
		const later = steps.slice(5).find((s) => (s.decisions ?? []).length > 0);
		if (later) {
			const answerText = 'The test answers this decision.';
			await inWebview('.page', `() => {
				d.querySelectorAll('.step-row')[${steps.indexOf(later)}].click();
				return true;
			}`);
			await sleep(500);
			await clickOnPage('.decision .pill', 'Answer');
			await typeOnPage(answerText);
			const answered = await poll(() => Object.values(levelsNow()?.levels?.[later.id]?.answers ?? {})[0], 15);
			check('The page keeps the answer of the user to a decision of Claude, and the ledger records it', answered?.text === answerText
				&& ledgerOf(TASK_1).some((x) => x.kind === 'decision' && x.action === 'answer' && x.step === later.id), levelsNow());
		} else {
			results.notes = [...(results.notes ?? []), 'No step after step 5 has an open decision of Claude, so the test answers no decision.'];
			console.log('NOTE No step after step 5 has an open decision of Claude, so the test answers no decision.');
		}

		// for the build: the user writes step 1 (level 4), and Claude writes step 2 (level 2). "Shotgun: Set Risk Level" sets them.
		// Step 5 also gets level 2: then no step of the user is open after step 4, and a loose end that the user hands to
		// Claude is the next step after step 4 (decision 21)
		const levelSets = [[0, 4], [1, 2], ...(steps.length > 4 ? [[4, 2]] : [])];
		for (const [n, level] of levelSets) {
			await command(wb, 'Shotgun: Set Risk Level');
			await quickPickNth(wb, 'Shotgun: Set Risk Level', n);
			await quickPickNth(wb, 'Shotgun: Set Risk Level of', level - 1);
			await sleep(600);
		}
		const setLevels = await poll(() => {
			const l = readJson(taskFile(TASK_1, 'levels.json'))?.levels ?? {};
			return levelSets.every(([n, level]) => l[steps[n]?.id]?.level === level) ? l : undefined;
		}, 15);
		check('"Shotgun: Set Risk Level" sets step 1 to level 4, and steps 2 and 5 to level 2', !!setLevels, readJson(taskFile(TASK_1, 'levels.json')));
		await command(wb, 'Shotgun: Show Page');
		await poll(async () => (await pageText())?.includes('Accept the plan') && true, 15);

		// the gate "Accept the plan" on the page. An open decision in a step of Claude is a decision of Claude in its errand, so
		// a modal message names these decisions first (P31)
		const decidedByClaude = steps.filter((s) => {
			const l = risk ? levelOf(s, risk, levelsNow()).level : null;
			return l !== null && l <= 2 && openDecisions(s, levelsNow()).length > 0;
		});
		await inWebview('.page', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('Accept the plan'));
			b?.click();
			return !!b;
		}`);
		if (decidedByClaude.length > 0) {
			const asked = await poll(() => clickDialog(wb, 'Pass the Gate'), 10);
			check('The gate "Accept the plan" asks first, because steps of Claude have open decisions', !!asked, decidedByClaude.map((s) => s.id));
		}
		const built = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'build' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "Accept the plan" of the page takes task 1 to stage 5', built?.gates?.[3]?.gate === 'accept-plan', readJson(taskFile(TASK_1, 'task.json')));
		// the CSS of the panel shows the name of the step in capitals, so the checks of the panel text ignore the case
		text = await poll(async () => /step 1 of/i.test((await panelText()) ?? ''), 15);
		check('The panel shows stage 5 of task 1 with step 1', !!text, await panelText());
		await wb.shot('panel-build.png');
		// 7: the build of task 1 (phase 6). Step 1 is a step of the user, and step 2 is an errand of Claude
		const s1 = steps[0];
		const s2 = steps[1];
		const buildOf = () => readJson(taskFile(TASK_1, 'build.json'));
		const opened1 = await poll(() => (buildOf()?.steps?.[s1.id]?.state === 'open' ? buildOf().steps[s1.id] : undefined), 30);
		check('Shotgun opens step 1 for the user, with the base of its files', opened1?.writer === 'user'
			&& (!!opened1?.base || (opened1?.newFiles ?? []).length === opened1?.scope?.length), buildOf());
		text = await poll(async () => (await panelText())?.includes('The step is done') && true, 15);
		check('The panel shows step 1 of the user with the gate "The step is done"', !!text, await panelText());
		await wb.shot('panel-user-step.png');
		// the user writes step 1. The next steps of Claude can need the work of step 1, for example new data members. Thus a
		// run of Claude Code with no plugins stands in for the user and does the step. If the run changes no file, the test
		// writes a comment line above the first place of the step, or a new file
		const scope1 = opened1?.scope ?? [...new Set(s1.places.map((pl) => pl.file))];
		const before1 = fileHashes();
		const userRun = await runClaude('user-step-1', [
			`You stand in for the user of this project. Make this change: ${s1.title}. ${s1.text ?? ''}`,
			`Change only these files: ${scope1.join(', ')}. Make only this change, and no change of a different step.`,
			'Do not build or run the code.',
		].join(' '), { tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'], maxTurns: 20, seconds: 300, plugins: false });
		const changed1 = [...fileHashes()].filter(([f, h]) => before1.get(f) !== h).map(([f]) => f);
		const inScope1 = new Set(scope1.map((f) => f.toLowerCase()));
		check('A run of Claude Code with no plugins stands in for the user, and changes only the files of step 1', changed1.length > 0
			&& changed1.every((f) => inScope1.has(f.toLowerCase())) && !userRun.plugins.some((x) => /shotgun|dataflow/i.test(x.name)),
			{ changed1, scope1, plugins: userRun.plugins, result: userRun.result.slice(0, 300) });
		if (changed1.length === 0) {
			const place1 = s1.places.find((pl) => pl.lines) ?? s1.places[0];
			const file1 = path.join(p.project, place1.file);
			const mark1 = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inl)$/i.test(place1.file) ? '//' : /\.(md|markdown)$/i.test(place1.file) ? '' : '#';
			const userLine = `${mark1 ? `${mark1} ` : ''}The user wrote this line in step 1.`;
			if (place1.lines && fs.existsSync(file1)) {
				const t = fs.readFileSync(file1, 'utf8').split('\n');
				t.splice(place1.lines[0] - 1, 0, userLine);
				fs.writeFileSync(file1, t.join('\n'));
			} else {
				fs.mkdirSync(path.dirname(file1), { recursive: true });
				fs.writeFileSync(file1, `${userLine}\n`);
			}
		}
		await sleep(1500);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done'));
			b?.click();
			return !!b;
		}`);
		const done1 = await poll(() => (buildOf()?.steps?.[s1.id]?.state === 'done' ? buildOf() : undefined), 20);
		check('The gate "The step is done" ends step 1', !!done1, buildOf());
		const userRuns = await poll(() => {
			const runs = Object.values(readJson(taskFile(TASK_1, 'lines.json'))?.files ?? {}).flatMap((x) => x.runs ?? []);
			return runs.some((r) => r.writer === 'user' && r.step === s1.id) ? runs : undefined;
		}, 10);
		check('lines.json records the lines of the user in step 1', !!userRuns, readJson(taskFile(TASK_1, 'lines.json')));

		// "Do step 2.": Claude opens the step, changes the files of its scope, and gives the receipt
		text = await poll(async () => (await panelText())?.includes('Do step 2.') && true, 15);
		check('The panel shows step 2 of Claude with its request', !!text, await panelText());
		const before2 = fileHashes();
		const errandTools = [GET_SESSION, GET_STEP, START_STEP, SUBMIT_ERRAND, GET_PLAN, 'Skill', 'Read', 'Edit', 'Write', 'MultiEdit', ...READ_TOOLS];
		const errandRun = await runClaude('errand', 'Do step 2.', { tools: errandTools, maxTurns: 40, seconds: 900 });
		const errandNames = errandRun.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-errand', errandRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-errand')), errandNames);
		const firstEdit = errandNames.findIndex((n) => ['Edit', 'Write', 'MultiEdit'].includes(n));
		check('Claude opens the step with shotgun_start_step before its first file change', errandNames.includes(START_STEP)
			&& (firstEdit < 0 || errandNames.indexOf(START_STEP) < firstEdit), errandNames);
		check('Claude gives the receipt with shotgun_submit_errand', errandNames.includes(SUBMIT_ERRAND), errandNames);
		const refusedReceipts = errandRun.toolResults.filter((r) => r.isError && r.text.includes('did not take the receipt')).length;
		if (refusedReceipts > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedReceipts} receipt of Claude before it took the receipt.`];
			console.log(`NOTE Shotgun refused ${refusedReceipts} receipt of Claude before it took the receipt.`);
		}
		const step2 = buildOf()?.steps?.[s2.id];
		const receipt = step2?.receipt;
		check('The receipt has a change with a title and a check for each hunk since the base', step2?.state === 'receipt'
			&& (!!step2?.base || (step2?.newFiles ?? []).length === step2?.scope?.length)
			&& (receipt?.changes?.length ?? 0) > 0 && receipt.changes.every((c) => c.title && c.check && c.hunks.length > 0), step2);
		const scope2 = new Set((step2?.scope ?? []).map((f) => f.toLowerCase()));
		const changed2 = [...fileHashes()].filter(([f, h]) => before2.get(f) !== h).map(([f]) => f);
		check('Claude changed only the files of the scope of step 2', changed2.length > 0 && changed2.every((f) => scope2.has(f.toLowerCase())), { changed2, scope: step2?.scope });
		// the open decisions of step 2 are decisions of Claude, and the receipt names each choice (P31)
		const open2 = openDecisions(s2, levelsNow());
		if (open2.length > 0) {
			check('The receipt of step 2 has a choice of Claude for each open decision', (step2?.receipt?.choices ?? []).length === open2.length,
				{ open: open2, choices: step2?.receipt?.choices });
			results.choices = step2?.receipt?.choices;
		}
		const claudeLines = Object.entries(readJson(taskFile(TASK_1, 'lines.json'))?.files ?? {})
			.flatMap(([f, x]) => x.runs.filter((r) => r.writer === 'claude' && r.step === s2.id).map((r) => `${f}:${r.lines[0]}-${r.lines[1]} ${r.change}`));
		check('lines.json records the lines of Claude in step 2', claudeLines.length > 0, readJson(taskFile(TASK_1, 'lines.json')));
		results.errand = { step: s2.id, scope: step2?.scope, changes: receipt?.changes?.map((c) => ({ id: c.id, file: c.file, lines: c.lines, title: c.title, check: c.check, note: c.note, added: c.added, removed: c.removed })), denies: receipt?.denies, outside: receipt?.outside, looseEnds: receipt?.looseEnds, claudeLines };
		console.log(`INFO The receipt of step 2: ${JSON.stringify(results.errand.changes?.map((c) => `${c.id} ${c.file}:${c.lines.join('-')} +${c.added} -${c.removed} ${c.title}`))}`);
		text = await poll(async () => {
			const t = await panelText();
			return t?.includes('Accept the receipt') && t.includes(receipt?.changes?.[0]?.title ?? '?') ? t : undefined;
		}, 15);
		check('The panel shows the receipt with the gate "Accept the receipt"', !!text, await panelText());
		// the editor button of the place of the first change opens the text editor, with a mark in the gutter for each line
		// of Claude. The link itself shows the place in DataFlow (decision 26)
		await inWebview('.panel', `() => {
			const b = d.querySelector('.change .change-place .editor-link');
			b?.click();
			return !!b;
		}`);
		const gutter = await poll(() => wb.evaluate(`[...document.querySelectorAll('.part.editor .monaco-editor .margin *, .part.editor .monaco-editor .glyph-margin-widgets *')]
			.filter((e) => getComputedStyle(e).backgroundImage.includes('svg')).length`), 15);
		check('The text editor shows the lines of Claude in the gutter', gutter > 0, gutter);
		await wb.shot('editor-claude-lines.png');
		await wb.shot('panel-receipt.png');

		// the user walks the receipt: OK on each change after the first, and an issue with a note on the first change
		const clickMark = (i, label) => inWebview('.panel', `() => {
			const card = d.querySelectorAll('.change')[${i}];
			const b = card && [...card.querySelectorAll('.mark-btn')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
			if (b && !b.classList.contains('on')) { b.click(); }
			return !!b;
		}`);
		const changeCount = receipt?.changes?.length ?? 0;
		for (let i = 1; i < changeCount; i++) {
			await clickMark(i, 'OK');
			await sleep(400);
		}
		await clickMark(0, 'Issue');
		await sleep(400);
		const issueNote = 'Add a short comment above this change that tells what it does.';
		await inWebview('.panel', `() => {
			const input = d.querySelectorAll('.change')[0].querySelector('.note-field input');
			input.value = ${JSON.stringify(issueNote)};
			input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
			return true;
		}`);
		await sleep(400);
		await inWebview('.panel', `() => {
			d.querySelectorAll('.change')[0].querySelector('.note-field input').dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			return true;
		}`);
		const marked = await poll(() => {
			const r = buildOf()?.steps?.[s2.id]?.receipt;
			return r && r.changes[0]?.mark === 'issue' && r.changes[0]?.userNote === issueNote && r.changes.slice(1).every((c) => c.mark === 'ok') ? r : undefined;
		}, 15);
		check('The panel puts the marks and the note of the user on the receipt', !!marked, buildOf()?.steps?.[s2.id]?.receipt?.changes?.map((c) => [c.id, c.mark, c.userNote]));
		const isGateOff = await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('Accept the receipt'));
			return b ? String(b.disabled) : undefined;
		}`);
		text = await poll(async () => (await panelText())?.includes('Fix the issues of step 2.') && true, 10);
		check('An issue stops the gate, and the panel shows the request "Fix the issues of step 2."', isGateOff === 'true' && !!text, { isGateOff, panel: await panelText() });
		await wb.shot('panel-receipt-issue.png');

		// 8: "Fix the issues of step 2.": Claude reads the issue, opens the step again, and gives a new receipt
		const fixRun = await runClaude('fix', 'Fix the issues of step 2.', { tools: errandTools, maxTurns: 40, seconds: 900 });
		const fixNames = fixRun.toolUses.map((t) => t.name);
		check('Claude reads the issue with shotgun_get_step, and opens the step again', fixNames.includes(GET_STEP) && fixNames.includes(START_STEP)
			&& fixNames.includes(SUBMIT_ERRAND), fixNames);
		const step2b = buildOf()?.steps?.[s2.id];
		check('The step keeps its base, and the new receipt is round 2', step2b?.state === 'receipt' && step2b.round === 2 && step2b.base === step2?.base
			&& step2b.receipt?.round === 2, step2b);
		const kept = (step2b?.receipt?.changes ?? []).filter((c) => c.mark === 'ok').length;
		results.fix = { changes: step2b?.receipt?.changes?.map((c) => ({ id: c.id, file: c.file, lines: c.lines, title: c.title, note: c.note, mark: c.mark })), kept };
		console.log(`INFO The receipt of round 2: ${JSON.stringify(results.fix.changes?.map((c) => `${c.id} ${c.mark} ${c.title}`))}. ${kept} changes kept the mark OK.`);
		text = await poll(async () => /round 2/i.test((await panelText()) ?? ''), 15);
		check('The panel shows the receipt of round 2', !!text, await panelText());
		// the user marks each change OK, and accepts the receipt
		for (let i = 0; i < (step2b?.receipt?.changes?.length ?? 0); i++) {
			await clickMark(i, 'OK');
			await sleep(400);
		}
		const allOk = await poll(() => (buildOf()?.steps?.[s2.id]?.receipt?.changes ?? []).every((c) => c.mark === 'ok') || undefined, 15);
		check('Each change of round 2 has the mark OK', !!allOk, buildOf()?.steps?.[s2.id]?.receipt?.changes?.map((c) => [c.id, c.mark]));
		await sleep(500);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('Accept the receipt'));
			b?.click();
			return !!b;
		}`);
		const accepted2 = await poll(() => (buildOf()?.steps?.[s2.id]?.state === 'done' ? buildOf() : undefined), 20);
		check('The gate "Accept the receipt" ends step 2', !!accepted2, buildOf());
		const kinds = ledgerOf(TASK_1).map((d) => d.kind);
		check('The ledger records the starts, the receipts, the marks, the note and the gates of the steps',
			['step', 'errand', 'mark', 'change-note', 'step-gate'].every((k) => kinds.includes(k)) && kinds.filter((k) => k === 'step-gate').length === 2, kinds);
		text = await poll(async () => new RegExp(`step 3 of ${steps.length}`, 'i').test((await panelText()) ?? ''), 15);
		check('The panel shows step 3 after the gate', steps.length < 3 || !!text, await panelText());
		await wb.shot('panel-build-step-3.png');

		// 9: a frame of Claude for step 3 (phase 7). In stage 5, the user sets step 3 to level 4 (decision 17), and selects the
		// writer "Frame" (decision 44). Then "Give me a frame for step 3." loads the skill shotgun-frame
		const s3 = steps[2];
		// step 3 can be open for the user already. The new level opens it again, so the test waits for the new open
		const levelTime3 = Date.now();
		await command(wb, 'Shotgun: Set Risk Level');
		await quickPickNth(wb, 'Shotgun: Set Risk Level', 0);
		await quickPickNth(wb, 'Shotgun: Set Risk Level of', 3);
		const opened3 = await poll(() => {
			const b = buildOf()?.steps?.[s3.id];
			return readJson(taskFile(TASK_1, 'levels.json'))?.levels?.[s3.id]?.level === 4 && b?.state === 'open' && b.writer === 'user'
				&& Date.parse(b.opened) >= levelTime3 ? b : undefined;
		}, 30);
		check('In stage 5, "Shotgun: Set Risk Level" sets step 3 to level 4, and Shotgun opens it for the user', !!opened3,
			{ levels: readJson(taskFile(TASK_1, 'levels.json')), build: buildOf()?.steps?.[s3.id] });
		text = await poll(async () => {
			const t = await panelText();
			return t && ['I write it', 'Frame', 'Claude writes it'].every((x) => t.includes(x)) ? t : undefined;
		}, 15);
		check('The panel shows the writers of the step of level 4: "I write it", "Frame" and "Claude writes it"', !!text, await panelText());
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.writer-choice button')].find((x) => x.textContent.trim() === 'Frame');
			b?.click();
			return !!b;
		}`);
		// the step of the user had a base. The new writer removes the state of the step, so it is a frame of Claude to do
		const requested = await poll(() => {
			const l = levelsNow()?.levels?.[s3.id];
			const b = buildOf()?.steps?.[s3.id];
			return l?.writer === 'frame' && l.level === 4 && (!b || b.state === 'todo') ? l : undefined;
		}, 15);
		check('The button records the writer of the user, the level stays 4, and step 3 becomes a frame of Claude', !!requested
			&& ledgerOf(TASK_1).some((d) => d.kind === 'writer' && d.step === s3.id && d.writer === 'frame'),
		{ levels: levelsNow()?.levels?.[s3.id], build: buildOf()?.steps?.[s3.id] });
		text = await poll(async () => (await panelText())?.includes('Give me a frame for step 3.') && true, 15);
		check('The panel shows the request "Give me a frame for step 3."', !!text, await panelText());
		await wb.shot('panel-frame-request.png');

		const before3 = fileHashes();
		const frameTools = [GET_SESSION, GET_STEP, START_STEP, SUBMIT_FRAME, GET_PLAN, 'Skill', 'Read', 'Edit', 'Write', 'MultiEdit', ...READ_TOOLS];
		const frameRun = await runClaude('frame', 'Give me a frame for step 3.', { tools: frameTools, maxTurns: 40, seconds: 900 });
		const frameNames = frameRun.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-frame', frameRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-frame')), frameNames);
		const firstFrameEdit = frameNames.findIndex((n) => ['Edit', 'Write', 'MultiEdit'].includes(n));
		check('Claude opens the step with the kind frame before its first file change', frameRun.toolUses.some((t) => t.name === START_STEP && t.input?.kind === 'frame')
			&& (firstFrameEdit < 0 || frameNames.indexOf(START_STEP) < firstFrameEdit), frameRun.toolUses.filter((t) => t.name === START_STEP));
		check('Claude gives the frame with shotgun_submit_frame', frameNames.includes(SUBMIT_FRAME), frameNames);
		const refusedFrames = frameRun.toolResults.filter((r) => r.isError && r.text.includes('did not take the frame')).length;
		if (refusedFrames > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedFrames} frame of Claude before it took the frame.`];
			console.log(`NOTE Shotgun refused ${refusedFrames} frame of Claude before it took the frame.`);
		}
		const step3 = buildOf()?.steps?.[s3.id];
		const holes3 = step3?.holes ?? [];
		check('The frame has holes, each with its question and 4 hints', step3?.state === 'holes' && holes3.length > 0 && holes3.every((h) => h.question
			&& h.hints?.nudge && h.hints?.pointer?.text && h.hints?.pointer?.places?.length > 0 && h.hints?.example?.code && h.hints?.answer), step3);
		const hasMarker = (h) => new RegExp(`/\\*[ \\t]*@hole[ \\t]+${h.n}\\b`).test(fs.readFileSync(path.join(p.project, h.file), 'utf8'));
		check('Each hole has its marker in its file', holes3.length > 0 && holes3.every(hasMarker), holes3.map((h) => [h.n, h.file, h.line]));
		// each open decision of step 3 is 1 hole, and no hole is only a type, a name or a literal (decision 32)
		const open3 = openDecisions(s3, levelsNow());
		check('Each open decision of step 3 has exactly 1 hole, also the decision of the user', open3.length > 0 && holes3.length === open3.length
			&& open3.every((d) => holes3.filter((h) => h.decision === d.id).length === 1) && open3.some((d) => d.by === 'user'),
			{ open: open3, holes: holes3.map((h) => [h.n, h.decision, h.question]) });
		check('No hole is only a type, a name, a literal or a list of parameters', holes3.every((h) => !isObviousAnswer(h.hints.answer)),
			holes3.map((h) => h.hints.answer));
		const scope3 = new Set((step3?.scope ?? []).map((f) => f.toLowerCase()));
		const changed3 = [...fileHashes()].filter(([f, h]) => before3.get(f) !== h).map(([f]) => f);
		check('Claude changed only the files of the scope of step 3', changed3.length > 0 && changed3.every((f) => scope3.has(f.toLowerCase())), { changed3, scope: step3?.scope });
		const runsOfStep3 = () => Object.entries(readJson(taskFile(TASK_1, 'lines.json'))?.files ?? {})
			.flatMap(([f, x]) => x.runs.filter((r) => r.step === s3.id).map((r) => ({ file: f, lines: r.lines, writer: r.writer, change: r.change })));
		check('lines.json records the frame lines of Claude', runsOfStep3().some((r) => r.writer === 'claude' && r.change === 'frame'), runsOfStep3());
		results.frame = {
			step: s3.id, note: step3?.frameNote, frameLines: runsOfStep3(),
			holes: holes3.map((h) => ({ n: h.n, decision: h.decision, question: h.question, place: `${h.file}:${h.line}`, nudge: h.hints.nudge,
				pointer: h.hints.pointer.text, example: `${h.hints.example.file}:${h.hints.example.lines.join('-')} ${h.hints.example.code}`, answer: h.hints.answer,
				answerLines: h.hints.answer.split('\n').length, facts: h.facts })),
		};
		console.log(`INFO The frame of step 3: ${JSON.stringify(results.frame.holes.map((h) => `${h.n} ${h.decision} ${h.place} ${h.question} = ${h.answer}`))}`);
		text = await poll(async () => {
			const t = await panelText();
			return t && /your decisions/i.test(t) && t.includes(holes3[0]?.question ?? '?') ? t : undefined;
		}, 15);
		const gateOff = () => inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done'));
			return b ? String(b.disabled) : undefined;
		}`);
		check('The panel shows the holes, and the gate "The step is done" waits for them', !!text && (await gateOff()) === 'true', await panelText());
		await wb.shot('panel-frame.png');

		// Tab in the text editor selects the next open hole. The user types the code of each hole but the last one
		const selection = () => wb.evaluate(`[...document.querySelectorAll('.statusbar-item')].map((e) => e.textContent).find((x) => /Ln \\d+, Col \\d+/.test(x)) ?? ''`);
		const toFill = holes3.length > 1 ? holes3.slice(0, -1) : holes3;
		await inWebview('.panel', `() => {
			const b = d.querySelector('.hole-detail .change-place .editor-place');
			b?.click();
			return !!b;
		}`);
		await sleep(1500);
		const tabs = [];
		for (const h of toFill) {
			await wb.key('Tab', 'Tab', 9);
			await sleep(700);
			const at = await selection();
			tabs.push({ hole: h.n, line: h.line, at });
			if (!new RegExp(`Ln ${h.line},`).test(at) || !/selected/.test(at)) {
				break;
			}
			await wb.send('Input.insertText', { text: h.hints.answer.split('\n').map((l) => l.trim()).join(' ') });
			await sleep(700);
		}
		check('Tab selects each open hole in the text editor, and the user types its code', tabs.length === toFill.length
			&& tabs.every((t) => new RegExp(`Ln ${t.line},`).test(t.at) && /selected/.test(t.at)), tabs);
		await wb.shot('editor-frame-tab.png');
		const filledByUser = await poll(async () => {
			const t = await panelText();
			return t && (t.match(/\byours\b/g) ?? []).length >= toFill.length ? t : undefined;
		}, 15);
		check('The panel shows the holes of the user as yours', !!filledByUser, await panelText());

		// the hint ladder of the last hole: the nudge, and then the answer of Claude
		const last = holes3[holes3.length - 1];
		if (holes3.length > 1) {
			await inWebview('.panel', `() => {
				const rows = d.querySelectorAll('.hole-row');
				rows[rows.length - 1].click();
				return true;
			}`);
			await sleep(500);
			const clickHint = (label) => inWebview('.panel', `() => {
				const b = [...d.querySelectorAll('.hole-detail .hint-btn')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
				b?.click();
				return !!b;
			}`);
			await clickHint('Nudge');
			const nudged = await poll(() => (buildOf()?.steps?.[s3.id]?.holes?.find((h) => h.n === last.n)?.shown === 1 ? true : undefined), 15);
			text = await poll(async () => (await panelText())?.includes(last.hints.nudge.slice(0, 40)) && true, 15);
			check('A click on "1 Nudge" shows the nudge of the hole, with no request to Claude', !!nudged && !!text, await panelText());
			await clickHint('Show me');
			const dialog = await poll(() => clickDialog(wb, 'Fill the Hole'), 10);
			// the answer goes into the text editor, and the file on the disk changes at the save. The panel shows the hole with the
			// text of the text editor
			const answered = await poll(async () => (buildOf()?.steps?.[s3.id]?.holes?.find((h) => h.n === last.n)?.shown === 4
				&& await inWebview('.panel', `() => {
					const rows = d.querySelectorAll('.hole-row .hole-state');
					return rows[rows.length - 1]?.textContent === 'Claude' ? true : undefined;
				}`) ? true : undefined), 15);
			check('"4 Show me" puts the answer of Claude into the hole after a modal message', !!dialog && !!answered,
				{ dialog, hole: buildOf()?.steps?.[s3.id]?.holes?.find((h) => h.n === last.n) });
			const answerRun = await poll(() => runsOfStep3().find((r) => r.writer === 'claude' && r.change === `H${last.n}`), 15);
			check('lines.json records the answer of Claude as lines of Claude', !!answerRun, runsOfStep3());
			await wb.shot('panel-frame-answer.png');
		}

		// the gate "The step is done": each hole has code
		const gateOn = await poll(async () => ((await gateOff()) === 'false' ? true : undefined), 20);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done'));
			b?.click();
			return !!b;
		}`);
		const done3 = await poll(() => (buildOf()?.steps?.[s3.id]?.state === 'done' ? buildOf() : undefined), 20);
		check('With each hole filled, the gate "The step is done" ends step 3', !!gateOn && !!done3, buildOf()?.steps?.[s3.id]);
		const userRuns3 = await poll(() => runsOfStep3().filter((r) => r.writer === 'user').length > 0 ? runsOfStep3() : undefined, 15);
		check('lines.json records the lines of the user in the holes', !!userRuns3, runsOfStep3());
		results.frame.lines = runsOfStep3();
		const kinds3 = ledgerOf(TASK_1).map((d) => d.kind);
		// a frame with only 1 hole gets no hints: the test types the code of its hole
		check('The ledger records the writer of the user, the frame, the hints and the gate of step 3',
			['writer', 'frame', ...(holes3.length > 1 ? ['hint'] : [])].every((k) => kinds3.includes(k))
			&& kinds3.filter((k) => k === 'step-gate').length === 3, kinds3);
		await wb.shot('panel-build-step-4.png');

		// A step that the test does not build ends as a step of the user with no code: level 4, and "The step is done". The
		// command lists only the steps that Claude did not start, so the current step is its first item
		const endWithNoCode = async (step) => {
			const b = () => buildOf()?.steps?.[step.id];
			if (!(b()?.state === 'open' && b()?.writer === 'user')) {
				await command(wb, 'Shotgun: Set Risk Level');
				await quickPickNth(wb, 'Shotgun: Set Risk Level', 0);
				await quickPickNth(wb, 'Shotgun: Set Risk Level of', 3);
				await poll(() => (b()?.state === 'open' && b()?.writer === 'user') || undefined, 30);
			}
			await poll(() => inWebview('.panel', `() => {
				const button = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done') && !x.disabled);
				button?.click();
				return !!button;
			}`), 15);
			return poll(() => b()?.state === 'done' || undefined, 30);
		};

		// 10: the callouts of a step of the user (phase 8). The test sets step 4 to level 4, writes a line in process() that
		// writes charge.is_dirty, which the worker thread also uses, and waits for the pause. Then "Explain the callout" and a
		// question about a line load the skill shotgun-explain. A line outside of the scope of the step is no line of the user,
		// so the step of the race is the first step from step 4 with a place in src/battery.cpp. The plan of Claude can put
		// a different step there. The steps before it end with no code
		const raceAt = steps.findIndex((s, i) => i >= 3 && s.places.some((pl) => pl.file === 'src/battery.cpp'));
		for (const skipped of steps.slice(3, Math.max(3, raceAt))) {
			await endWithNoCode(skipped);
		}
		const s4 = steps[raceAt >= 3 ? raceAt : 3];
		console.log(`INFO The step of the race: ${s4?.id} ${s4?.title}`);
		await command(wb, 'Shotgun: Set Risk Level');
		await quickPickNth(wb, 'Shotgun: Set Risk Level', 0);
		await quickPickNth(wb, 'Shotgun: Set Risk Level of', 3);
		const opened4 = await poll(() => {
			const b = buildOf()?.steps?.[s4.id];
			return b?.state === 'open' && b.writer === 'user' ? b : undefined;
		}, 30);
		const calloutsOf = () => readJson(taskFile(TASK_1, 'callouts.json'));
		const started4 = await poll(() => calloutsOf()?.steps?.[s4.id], 60);
		check('Shotgun keeps the facts of DataFlow at the start of step 4 of the user', !!opened4 && !!started4,
			{ build: buildOf()?.steps?.[s4.id], start: started4 ? started4.startKeys.length : undefined });
		const batteryFile = path.join(p.project, 'src', 'battery.cpp');
		const batteryLines = fs.readFileSync(batteryFile, 'utf8').split('\n');
		const target = batteryLines.findIndex((l) => l.includes('if (home_battery_ctl.state == HOMEPOWER_CHARGE_PLANNING)')) + 1;
		// the lambda that executor.async gets. A step of Claude can add arguments to its call of solve_power_plan
		const lambda = batteryLines.findIndex((l) => /\.async\(\s*\[/.test(l)) + 1;
		const lambdaLine = lambda > target ? lambda + 1 : lambda;
		await command(wb, 'Go to File');
		await quickInput(wb, 'src/battery.cpp');
		await sleep(1500);
		await command(wb, 'Go to Line/Column');
		await quickInput(wb, String(target));
		await sleep(700);
		await wb.send('Input.insertText', { text: '  charge.is_dirty = true;\n' });
		const userLine4 = await poll(() => {
			const runs = readJson(taskFile(TASK_1, 'lines.json'))?.files?.['src/battery.cpp']?.runs ?? [];
			return runs.find((r) => r.writer === 'user' && r.step === s4.id && r.lines[0] <= target && r.lines[1] >= target);
		}, 15);
		check('The line that the user types is a line of the user in step 4', !!userLine4, readJson(taskFile(TASK_1, 'lines.json'))?.files?.['src/battery.cpp']);
		// the pause: 2 seconds with no edit, then the facts of DataFlow
		const problem = await poll(() => (calloutsOf()?.steps?.[s4.id]?.callouts ?? []).find((c) => c.kind === 'problem' && c.shown && c.source === 'threads'), 40);
		check('At a pause, the race on the line of the user shows as a problem callout', !!problem && problem.line === target,
			{ target, callouts: calloutsOf()?.steps?.[s4.id]?.callouts });
		results.callouts = calloutsOf()?.steps?.[s4.id]?.callouts?.map((c) => ({ id: c.id, kind: c.kind, line: c.line, title: c.title, shown: !!c.shown, proof: c.proof }));
		console.log(`INFO The callouts of step 4: ${JSON.stringify(results.callouts?.map((c) => `${c.id} ${c.kind} ${c.line} ${c.title}${c.shown ? '' : ' (held)'}`))}`);
		text = await poll(async () => {
			const t = await panelText();
			return t && /callouts on your lines/i.test(t) && t.includes(problem?.title ?? '?') ? t : undefined;
		}, 15);
		const statusBar = await poll(() => wb.evaluate(`[...document.querySelectorAll('.statusbar-item')].map((e) => e.textContent).find((x) => /problem on your lines/.test(x))`), 15);
		check('The panel and the status bar show the problem on the line of the user', !!text && !!statusBar, { statusBar, panel: await panelText() });
		await wb.shot('editor-callout.png');
		// Claude reads the file on the disk, so the test saves the line of the user
		const isSaved4 = await saveEditor(wb, batteryFile, 'charge.is_dirty = true;');
		check('Ctrl+S saves the line of the user for Claude', isSaved4, fs.readFileSync(batteryFile, 'utf8').split('\n').slice(target - 3, target + 2));

		const question = `does the lambda on line ${lambdaLine} copy charge?`;
		const explainRun = await runClaude('explain', `Explain the callout on line ${problem?.line ?? target}. Then answer my question: ${question}`, {
			tools: [GET_SESSION, GET_CALLOUTS, SUBMIT_EXPLANATION, SUBMIT_LINE_ANSWER, 'Skill', 'Read', ...READ_TOOLS], maxTurns: 30, seconds: 600,
		});
		const explainNames = explainRun.toolUses.map((t) => t.name);
		check('The requests load the skill shotgun-explain', explainRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-explain')), explainNames);
		const explained = (calloutsOf()?.steps?.[s4.id]?.callouts ?? []).find((c) => c.id === problem?.id);
		check('Claude explains the callout with shotgun_submit_explanation, and changes no file', explainNames.includes(SUBMIT_EXPLANATION) && !!explained?.explanation?.text
			&& !explainNames.some((n) => ['Edit', 'Write', 'MultiEdit'].includes(n)), { explainNames, explanation: explained?.explanation });
		const answer = (calloutsOf()?.answers ?? []).find((a) => a.question.toLowerCase().includes('copy charge'));
		check('Claude answers the question on the line, and Shotgun adds the facts of DataFlow at the line', explainNames.includes(SUBMIT_LINE_ANSWER)
			&& !!answer && answer.line === lambdaLine && answer.facts.length > 0, { answer, explainNames });
		const refusedAnswers = explainRun.toolResults.filter((r) => r.isError && r.text.includes('did not take the answer')).length;
		if (refusedAnswers > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedAnswers} answer of Claude before it took the answer.`];
			console.log(`NOTE Shotgun refused ${refusedAnswers} answer of Claude before it took the answer.`);
		}
		results.explain = { explanation: explained?.explanation?.text, answer: answer ? { question: answer.question, answer: answer.answer, facts: answer.facts } : undefined };
		console.log(`INFO The explanation: ${explained?.explanation?.text ?? '-'} The answer: ${answer?.answer ?? '-'}`);
		text = await poll(async () => {
			const t = await panelText();
			return t && t.includes(answer?.answer?.slice(0, 30) ?? '?') ? t : undefined;
		}, 15);
		check('The panel shows the question of the user with the facts of DataFlow and the answer of Claude', !!text, await panelText());
		await wb.shot('panel-callout-answer.png');

		// "Not a problem": the reason of the user goes into the ledger
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.callout-row')].find((x) => x.textContent.includes(${JSON.stringify(problem?.title ?? '?')}));
			b?.click();
			return !!b;
		}`);
		await sleep(500);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.callout-detail button')].find((x) => x.textContent.includes('Not a problem'));
			b?.click();
			return !!b;
		}`);
		const reason = 'The test writes the flag on purpose.';
		await quickInput(wb, reason, 'Not a Problem');
		const closed4 = await poll(() => (calloutsOf()?.steps?.[s4.id]?.callouts ?? []).find((c) => c.id === problem?.id && c.closed), 15);
		check('"Not a problem" closes the callout, and the ledger keeps the reason of the user', closed4?.closed?.reason === reason
			&& ledgerOf(TASK_1).some((d) => d.kind === 'callout-close' && d.reason === reason), closed4);
		// the voice of the navigator
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.mark-btn.voice')].find((x) => x.textContent.includes('Quiet'));
			b?.click();
			return !!b;
		}`);
		text = await poll(async () => (await panelText())?.includes('Quiet: problems only') && true, 15);
		check('The panel sets the voice of the callouts', !!text, await panelText());
		await wb.shot('panel-callout-closed.png');

		// 11: the loose ends, the ledger and the check of the commit message (phase 9). The gate of each step gets the loose
		// ends of the step from DataFlow. The test ends step 4, hands a mechanical loose end to Claude if the steps have one,
		// writes a commit message in Source Control, and asks Claude for a check of the message
		const looseOf = () => readJson(taskFile(TASK_1, 'loose.json'));
		const planOf = () => readJson(taskFile(TASK_1, 'plan.json'));
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done'));
			b?.click();
			return !!b;
		}`);
		const done4 = await poll(() => (buildOf()?.steps?.[s4.id]?.state === 'done' ? buildOf() : undefined), 60);
		const checkedSteps = await poll(() => {
			const l = looseOf();
			return l && [steps[0], steps[1], steps[2], s4].every((s) => l.checked.includes(s.id)) ? l : undefined;
		}, 30);
		check('The gate of each step gets the loose ends of the step from DataFlow', !!done4 && !!checkedSteps,
			{ checked: looseOf()?.checked, state4: buildOf()?.steps?.[s4.id]?.state });
		results.looseEnds = (looseOf()?.ends ?? []).map((e) => ({ id: e.id, step: e.step, kind: e.kind, source: e.source, title: e.title, file: e.file, lines: e.lines }));
		console.log(`INFO The loose ends: ${JSON.stringify(results.looseEnds.map((e) => `${e.id} ${e.step} ${e.kind} ${e.source}: ${e.title}`))}`);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.tabs .tab')].find((x) => x.textContent.includes('Loose ends'));
			b?.click();
			return !!b;
		}`);
		text = await poll(async () => {
			const t = await panelText();
			return t && /after steps 1 to 4/i.test(t) ? t : undefined;
		}, 15);
		check('The tab "Loose ends" of the panel shows the loose ends after steps 1 to 4', !!text, await panelText());
		await wb.shot('panel-loose-ends.png');
		const mechanical = (looseOf()?.ends ?? []).find((e) => e.state === 'open' && e.kind === 'mechanical' && e.file && e.lines);
		if (mechanical) {
			await inWebview('.panel', `() => {
				const card = [...d.querySelectorAll('.loose-end')].find((x) => x.textContent.includes(${JSON.stringify(mechanical.title)}));
				const b = card && [...card.querySelectorAll('button')].find((x) => x.textContent.includes('Hand to Claude'));
				b?.click();
				return !!b;
			}`);
			const handed = await poll(() => {
				const step = planOf()?.steps?.find((s) => s.looseEnd === mechanical.id);
				return step && readJson(taskFile(TASK_1, 'levels.json'))?.levels?.[step.id]?.level === 2 ? step : undefined;
			}, 15);
			const order = planOf()?.steps?.map((s) => s.id) ?? [];
			check('"Hand to Claude" makes the loose end the next step of the plan with level 2, and the ledger records it', !!handed
				&& order.indexOf(handed.id) === order.indexOf(s4.id) + 1 && ledgerOf(TASK_1).some((d) => d.kind === 'loose-hand' && d.end === mechanical.id),
				{ handed, order });
			text = await poll(async () => (await panelText())?.includes('Do the loose ends.') && true, 15);
			check('The panel shows the request "Do the loose ends."', !!text, await panelText());
			await wb.shot('panel-loose-handed.png');
		} else {
			results.notes = [...(results.notes ?? []), 'The steps had no mechanical loose end, so the test did not hand a loose end to Claude.'];
			console.log('NOTE The steps had no mechanical loose end, so the test did not hand a loose end to Claude.');
		}

		// the commit message in the input box of Source Control
		const commitText = 'Add a cycle limit for the solver\n\nAfter a limit of planning cycles, the controller takes the next price slot.';
		await command(wb, 'View: Show Source Control');
		await sleep(1500);
		const scmBox = await poll(() => wb.evaluate(`(() => {
			const e = document.querySelector('.scm-editor .monaco-editor .view-lines') ?? document.querySelector('.scm-input .monaco-editor .view-lines');
			const r = e?.getBoundingClientRect();
			return r && r.width > 0 ? { x: r.left + 10, y: r.top + r.height / 2 } : undefined; })()`), 15);
		if (scmBox) {
			for (const type of ['mousePressed', 'mouseReleased']) {
				await wb.send('Input.dispatchMouseEvent', { type, x: scmBox.x, y: scmBox.y, button: 'left', clickCount: 1 });
			}
			await sleep(400);
			await wb.send('Input.insertText', { text: commitText });
		}
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.tabs .tab')].find((x) => x.textContent.includes('Ledger'));
			b?.click();
			return !!b;
		}`);
		text = await poll(async () => (await panelText())?.includes('Add a cycle limit for the solver') && true, 20);
		check('The tab "Ledger" of the panel shows the commit message of Source Control', !!scmBox && !!text, { scmBox, panel: await panelText() });

		// "Check my commit message." loads the skill shotgun-commit. Claude reads the diff and gives its points
		const checkRun = await runClaude('commit', 'Check my commit message.', {
			tools: [GET_SESSION, GET_COMMIT_MESSAGE, SUBMIT_MESSAGE_CHECK, 'Skill', 'Read', 'Bash(git diff:*)', 'Bash(git status:*)', ...READ_TOOLS,
				'mcp__plugin_dataflow_dataflow__get_diff'],
			maxTurns: 30, seconds: 600,
		});
		const checkNames = checkRun.toolUses.map((t) => t.name);
		check('The request loads the skill shotgun-commit', checkRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-commit')), checkNames);
		const messageCheck = readJson(taskFile(TASK_1, 'message.json'));
		check('Claude checks the message with shotgun_submit_message_check, and changes no file', checkNames.includes(SUBMIT_MESSAGE_CHECK) && !!messageCheck
			&& messageCheck.points.length > 0 && messageCheck.message.replace(/\r\n/g, '\n').trim() === commitText
			&& !checkNames.some((n) => ['Edit', 'Write', 'MultiEdit'].includes(n)), { checkNames, messageCheck });
		results.message = messageCheck;
		console.log(`INFO The check of the message: ${messageCheck?.agrees ? 'agrees' : 'does not agree'}: ${JSON.stringify(messageCheck?.points?.map((p) => `${p.kind}: ${p.text}`))}`);
		const firstPoint = messageCheck?.points?.[0]?.text?.slice(0, 30) ?? '?';
		text = await poll(async () => (await panelText())?.includes(firstPoint) && true, 15);
		check('The panel shows the points of the check of Claude', !!text, await panelText());
		await wb.shot('panel-ledger.png');

		// the ledger page: the decisions, the lines of each writer, and the check of the message
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.ledger button')].find((x) => x.textContent.includes('Show the ledger'));
			b?.click();
			return !!b;
		}`);
		text = await poll(async () => {
			const t = await pageText();
			return t && /your decisions in this task/i.test(t) && t.includes('src/battery.cpp') && t.includes(firstPoint) ? t : undefined;
		}, 20);
		check('The ledger page shows the decisions of the user, the lines of each writer, and the check of the message', !!text, await pageText());
		await wb.shot('page-ledger.png');
		await inWebview('.page', `() => {
			const b = [...d.querySelectorAll('button')].find((x) => x.textContent.includes('Copy for the pull request'));
			b?.click();
			return !!b;
		}`);
		const copied = await poll(() => wb.evaluate(`[...document.querySelectorAll('.statusbar-item')].map((e) => e.textContent).find((x) => /ledger is in the clipboard/.test(x))`), 10);
		check('"Copy for the pull request" puts the ledger into the clipboard as Markdown', !!copied);

		// 12: stage 6, the review (phase 12). The test does not build the last steps, so it ends them as steps of the user with
		// no code: level 4, and "The step is done". Then "The build is done" takes the task to stage 6
		const planNow = () => readJson(taskFile(TASK_1, 'plan.json'));
		const buildNow = () => readJson(taskFile(TASK_1, 'build.json'));
		for (let k = 0; k < 8; k++) {
			const next = (planNow()?.steps ?? []).find((s) => buildNow()?.steps?.[s.id]?.state !== 'done');
			if (!next) {
				break;
			}
			await endWithNoCode(next);
		}
		const notDone = (planNow()?.steps ?? []).filter((s) => buildNow()?.steps?.[s.id]?.state !== 'done').map((s) => s.id);
		check('The test ends the steps that it does not build as steps of the user with no code', notDone.length === 0, { notDone, build: buildNow() });
		// "The build is done". The user selects the effort and the focus in the panel, and copies the prompt of the review into a
		// new session of Claude Code: a new run of the CLI
		await poll(async () => (await panelText())?.includes('The build is done') && true, 20);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The build is done'));
			b?.click();
			return !!b;
		}`);
		const inReview = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.stage === 'review' ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "The build is done" takes task 1 to stage 6, the review', inReview?.gates?.at(-1)?.gate === 'build-done', readJson(taskFile(TASK_1, 'task.json')));
		const reviewNow = () => readJson(taskFile(TASK_1, 'review.json'));
		const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p.project, encoding: 'utf8', windowsHide: true }).trim();
		check('The first gate "Accept the plan" recorded the commit of HEAD as the base of the task', reviewNow()?.base?.commit === head, reviewNow()?.base);
		// the focus: correctness and threads, with a point of the user
		await poll(async () => (await panelText())?.includes('Copy the review prompt') && true, 15);
		for (const area of ['Lifetime', 'The brief', 'Tests']) {
			await inWebview('.panel', `() => {
				const b = [...d.querySelectorAll('.review-options .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(area)});
				b?.click();
				return !!b;
			}`);
			await sleep(700);
		}
		await inWebview('.panel', `() => {
			const input = d.querySelector('.review-options input');
			input.value = 'Look at the worker thread of the solver.';
			input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
			input.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
			return true;
		}`);
		const options = await poll(() => {
			const o = reviewNow()?.options;
			return o?.text && o.areas.length === 2 ? o : undefined;
		}, 15);
		check('The panel sets the effort and the focus of the review, and the ledger records them', options?.effort === 'medium'
			&& JSON.stringify(options?.areas) === JSON.stringify(['correctness', 'threads']) && ledgerOf(TASK_1).some((d) => d.kind === 'review-options'), reviewNow()?.options);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.review-options button')].find((x) => x.textContent.includes('Copy the review prompt'));
			b?.click();
			return !!b;
		}`);
		const toast = await poll(() => wb.evaluate(`[...document.querySelectorAll('.notifications-toasts .notification-list-item-message')].map((e) => e.textContent)
			.find((x) => /review prompt is in the clipboard/.test(x))`), 10);
		check('"Copy the review prompt" tells the user to paste it into a new session of Claude Code', /new session of Claude Code/.test(toast ?? ''), toast);
		await wb.shot('panel-review-options.png');

		// "Review my Shotgun task ..." in a new session loads the skill shotgun-review. Claude starts the finders and the
		// verifiers as subagents, and gives the issues with shotgun_submit_review
		const prompt = reviewPrompt(TITLE, options ?? { effort: 'medium', areas: ['correctness', 'threads'] });
		const changesBefore = gitChanges();
		const reviewRun = await runClaude('review', prompt, {
			tools: [GET_SESSION, GET_REVIEW, SUBMIT_REVIEW, 'Skill', 'Agent', 'Task', 'Read', 'Grep', 'Glob', ...READ_TOOLS,
				'mcp__plugin_dataflow_dataflow__get_diff', 'mcp__plugin_dataflow_dataflow__get_ripple'],
			maxTurns: 80, seconds: 2400,
		});
		const reviewNames = reviewRun.toolUses.map((t) => t.name);
		check('The prompt loads the skill shotgun-review', reviewRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-review')), reviewNames);
		const subagents = reviewRun.toolUses.filter((t) => t.name === 'Agent' || t.name === 'Task');
		check('Claude starts the finders and the verifiers as subagents', subagents.length >= 2, reviewNames);
		const review = reviewNow();
		const round = review?.rounds?.[0];
		check('Claude gives the review with shotgun_submit_review, and changes no file', reviewNames.includes(SUBMIT_REVIEW) && !!round
			&& !reviewNames.some((n) => ['Edit', 'Write', 'MultiEdit'].includes(n)) && JSON.stringify(gitChanges()) === JSON.stringify(changesBefore),
		{ reviewNames, result: reviewRun.result, changes: gitChanges() });
		const issues = review?.issues ?? [];
		results.review = { round, issues: issues.map((i) => `${i.id} ${i.list} ${i.severity} ${i.category} ${i.verdict} ${i.source} ${i.place.file}:${i.place.lines[0]} ${i.title}`) };
		console.log(`INFO The review: ${round ? `${round.changedLines} changed lines, a cap of ${round.cap}` : 'no round'}: ${JSON.stringify(results.review.issues)}`);
		check('The review at the effort medium gives 1 issue or more, each with a severity, an origin, a verdict, a failure scenario and the evidence of DataFlow',
			round?.effort === 'medium' && issues.length > 0 && issues.every((i) => i.severity && i.origin && i.verdict && i.scenario?.trigger && i.scenario?.result
				&& i.tools.length > 0), review);
		// a race starts from the threads of DataFlow (P20). Its source can be the model: DataFlow gives 1 run of each worker
		const races = issues.filter((i) => i.category === 'race');
		check('Each race issue starts from the threads of DataFlow: it names get_threads and gives the interleave',
			races.every((i) => i.tools.includes('get_threads') && !!i.scenario?.interleave), races);
		console.log(`INFO The races of the review: ${JSON.stringify(races.map((i) => `${i.id} ${i.source}`))}`);
		// the race of the callout that the user closed comes again only with new evidence and the verdict plausible (P35). The
		// line of the callout now is the line with its text
		const raceLineNow = fs.readFileSync(path.join(p.project, 'src', 'battery.cpp'), 'utf8').split(/\r?\n/).findIndex((l) => l.trim() === 'charge.is_dirty = true;') + 1;
		const closedRace = races.filter((i) => i.place.file === 'src/battery.cpp' && i.place.lines[0] <= raceLineNow && raceLineNow <= i.place.lines[1]);
		console.log(`INFO The race of the callout that the user closed: ${closedRace.length === 0 ? 'not in the review' : JSON.stringify(closedRace.map((i) => `${i.id} ${i.verdict} ${i.list}`))}`);
		check('The race of the callout that the user closed comes again only with new evidence and the verdict plausible', raceLineNow > 0
			&& closedRace.every((i) => i.verdict === 'plausible' && !!i.evidence && i.list === 'second'), { raceLineNow, closedRace });
		// Shotgun refuses an issue outside of the diff of the task. The test calls the tool directly, as a client
		const refusedOutside = await callBridgeTool('shotgun_submit_review', {
			issues: [{
				title: 'Outside', summary: 'A place outside of the task.', scenario: { trigger: 'x', path: 'y', result: 'z' }, category: 'correctness',
				severity: 'minor', origin: 'pre-existing', verdict: 'plausible', source: 'model',
				place: { file: 'include/battery/types.hpp', lines: [1, 1], code: fs.readFileSync(path.join(p.project, 'include', 'battery', 'types.hpp'), 'utf8').split(/\r?\n/)[0].trim() },
				tools: ['get_place'],
			}],
		});
		check('Shotgun refuses an issue outside of the diff of the task', refusedOutside.isError && /not in the diff of the task/.test(refusedOutside.text ?? '')
			&& reviewNow()?.issues?.length === issues.length, refusedOutside);

		// the lists of the review in the panel and on the issues page (decision 43)
		const phaseNow = () => reviewPhase(reviewNow());
		const toFixIds = () => toFix(reviewNow()).map((x) => x.issue.id);
		// an issue of the review or of the user, by its id
		const issueOf = (id) => reviewNow()?.issues?.find((i) => i.id === id) ?? reviewNow()?.userIssues?.find((u) => u.id === id);
		const toFix6 = issues.filter((i) => i.list === 'steps' && i.state === 'open');
		const first6 = toFix6[0] ?? issues[0];
		check('After the review, round 1 is at the issues page', phaseNow().phase === 'issues' && phaseNow().round === 1, phaseNow());
		text = await poll(async () => {
			const t = await panelText();
			return t && t.includes('Show the issues') && /to fix/.test(t) ? t : undefined;
		}, 20);
		check('The panel shows the issues to fix and the button "Show the issues"', !!text, await panelText());
		await wb.shot('panel-review.png');
		await command(wb, 'Shotgun: Show Page');
		text = await poll(async () => {
			const t = await pageText();
			return t && /to fix/i.test(t) && /for later/i.test(t) && t.includes(first6?.title ?? '?') ? t : undefined;
		}, 20);
		check('The issues page shows the list to fix and the list for later', !!text, await pageText());
		await wb.shot('page-issues.png');
		// a button of a row of the issues page: the text of the button, or its label for a button with an icon
		const clickRow = (id, label) => inWebview('.page', `() => {
			const row = [...d.querySelectorAll('.order-row')].find((x) => x.querySelector('.id')?.textContent === ${JSON.stringify(id)});
			const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}
				|| x.getAttribute('aria-label') === ${JSON.stringify(label)});
			b?.click();
			return !!b;
		}`);
		// the first enabled button of a gate in the panel with a text that the expression finds
		const clickPanelGate = (label) => inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => new RegExp(${JSON.stringify(label)}).test(x.textContent) && !x.disabled);
			b?.click();
			return !!b;
		}`);
		// types a text into a field of the page, and then pushes Enter. The field shows the text only after the next render
		const typeInPage = async (selector, value) => {
			await inWebview('.page', `() => {
				const input = d.querySelector(${JSON.stringify(selector)});
				if (!input) { return false; }
				input.value = ${JSON.stringify(value)};
				input.dispatchEvent(new d.defaultView.Event('input', { bubbles: true }));
				return true;
			}`);
			await sleep(400);
			return inWebview('.page', `() => {
				const input = d.querySelector(${JSON.stringify(selector)});
				input?.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				return !!input;
			}`);
		};

		// 13: the issues page (decision 43). The test needs 2 issues of the review to fix. If the list to fix has fewer, "Fix
		// it" puts issues of the list for later at its end. The race of the closed callout stays for later
		const isClosedRace = (i) => closedRace.some((c) => c.id === i.id);
		for (const extra of issues.filter((i) => i.list === 'second' && i.state === 'open' && !isClosedRace(i)).slice(0, Math.max(0, 2 - toFix6.length))) {
			await clickRow(extra.id, 'Fix it');
			await poll(() => toFixIds().includes(extra.id) || undefined, 10);
		}
		const fixIt = ledgerOf(TASK_1).filter((d) => d.kind === 'issue-step');
		if (fixIt.length > 0) {
			check('"Fix it" puts an issue of the list for later at the end of the list to fix, and the ledger records it',
				fixIt.every((d) => d.isStep && toFixIds().includes(d.issue)), { fixIt, toFix: toFixIds() });
		}
		// an issue of the user. It gets the id U1, and Claude finds its places in the plan of the fixes
		const USER_ISSUE = 'The struct OperationalSettings in include/battery/types.hpp has no comment that tells the unit of each limit.';
		await typeInPage('.order-add input', USER_ISSUE);
		const u1 = await poll(() => reviewNow()?.userIssues?.find((u) => u.text === USER_ISSUE), 15);
		check('An issue of the user goes to the end of the list to fix with the id U1, and the ledger records it', u1?.id === 'U1' && toFixIds().at(-1) === 'U1'
			&& ledgerOf(TASK_1).some((d) => d.kind === 'user-issue' && d.issue === 'U1' && d.action === 'add'), { userIssues: reviewNow()?.userIssues, toFix: toFixIds() });
		// a note of the user for the plan of the fixes, on the first issue to fix
		const NOTE_6 = 'Keep the fix small, and change no signature of a function.';
		// the first row of the list to fix is the first row with a note field. The rows of the list for later have no note
		const noteId = toFixIds()[0];
		await typeInPage('.fix-row .note-field input', NOTE_6);
		const noted = await poll(() => reviewNow()?.notes?.[noteId] === NOTE_6 || undefined, 15);
		check('A note of the user for the plan goes into review.json, and the ledger records it', !!noted
			&& ledgerOf(TASK_1).some((d) => d.kind === 'issue-note' && d.issue === noteId && d.text === NOTE_6), reviewNow()?.notes);
		// the user moves the issue of the user up 1 place. Shotgun does not move an issue
		const beforeMove = toFixIds();
		if (beforeMove.indexOf('U1') > 0) {
			await clickRow('U1', 'Move U1 up');
			const moved = await poll(() => (toFixIds().indexOf('U1') === beforeMove.indexOf('U1') - 1 ? toFixIds() : undefined), 10);
			check('The user moves an issue up, and the ledger records its new place', !!moved
				&& ledgerOf(TASK_1).some((d) => d.kind === 'issue-move' && d.issue === 'U1' && d.position === beforeMove.indexOf('U1')), { beforeMove, now: toFixIds() });
		}
		// "Not a problem" closes an issue with a reason: the last issue of the review to fix if there are 3, else an issue for
		// later
		const reason6 = 'The test closes this issue on purpose.';
		const reviewToFix = toFixIds().filter((id) => /^I\d+$/.test(id));
		const closeC = (reviewToFix.length >= 3 ? issueOf(reviewToFix.at(-1)) : undefined)
			?? (reviewNow()?.issues ?? []).find((i) => i.list === 'second' && i.state === 'open');
		if (closeC) {
			await clickRow(closeC.id, 'Not a problem');
			await quickInput(wb, reason6, 'Not a Problem');
			const closed6 = await poll(() => reviewNow()?.issues?.find((i) => i.id === closeC.id && i.state === 'closed'), 15);
			check('"Not a problem" closes an issue of the review, and the ledger keeps the reason of the user', closed6?.closed?.reason === reason6
				&& !toFixIds().includes(closeC.id) && ledgerOf(TASK_1).some((d) => d.kind === 'issue-close' && d.issue === closeC.id && d.reason === reason6), closed6);
		}
		await wb.shot('page-issues-done.png');
		// the gate "Accept the issues". A modal message asks first if an important new issue that the review confirmed is for
		// later
		const toFixAtGate = toFixIds();
		await poll(() => clickPanelGate('^Accept (the issues|with)'), 15);
		await poll(() => clickDialog(wb, 'Accept the Issues'), 3);
		const accepted6 = await poll(() => (phaseNow().phase === 'plan' ? reviewNow() : undefined), 20);
		check('The gate "Accept the issues" records the issues to fix in the sequence of the user, and the round goes to the plan of the fixes',
			!!accepted6?.rounds?.[0]?.accepted && JSON.stringify(toFix(accepted6).map((x) => x.issue.id)) === JSON.stringify(toFixAtGate)
				&& ledgerOf(TASK_1).some((d) => d.kind === 'review-gate' && d.gate === 'accept-issues' && d.count === toFixAtGate.length), { phase: phaseNow(), toFixAtGate });
		text = await poll(async () => (await panelText())?.includes('Plan the fixes.') && true, 15);
		check('After the gate, the panel shows the request "Plan the fixes."', !!text, await panelText());

		// 14: the plan of the fixes (decision 43). "Plan the fixes." loads the skill shotgun-plan, and Claude gives the steps
		// of the fixes with shotgun_submit_fix_plan. The rules of stage 4 give their levels
		const changesBefore14 = gitChanges();
		const fixPlanRun = await runClaude('fix-plan', 'Plan the fixes.', {
			tools: [GET_SESSION, GET_REVIEW, SUBMIT_FIX_PLAN, GET_PLAN, 'Skill', 'Read', 'Grep', 'Glob', ...READ_TOOLS], maxTurns: 40, seconds: 900,
		});
		const fixPlanNames = fixPlanRun.toolUses.map((t) => t.name);
		check('"Plan the fixes." loads the skill shotgun-plan', fixPlanRun.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-plan')),
			fixPlanNames);
		const fixPlan = reviewNow()?.fixPlans?.find((x) => x.round === 1);
		const fixSteps = fixPlan?.steps ?? [];
		check('Claude reads the issues to fix with shotgun_get_review, gives the plan with shotgun_submit_fix_plan, and changes no file',
			fixPlanNames.includes(GET_REVIEW) && fixPlanNames.includes(SUBMIT_FIX_PLAN) && fixSteps.length > 0 && JSON.stringify(gitChanges()) === JSON.stringify(changesBefore14),
			{ fixPlanNames, result: fixPlanRun.result.slice(0, 300), changes: gitChanges() });
		const refusedFixPlans = fixPlanRun.toolResults.filter((r) => r.isError && r.text.includes('did not take the plan of the fixes')).length;
		if (refusedFixPlans > 0) {
			results.notes = [...(results.notes ?? []), `Shotgun refused ${refusedFixPlans} plan of the fixes of Claude before it took the plan.`];
			console.log(`NOTE Shotgun refused ${refusedFixPlans} plan of the fixes of Claude before it took the plan.`);
		}
		results.fixPlan = fixSteps.map((s) => `${s.id} [${(s.fixes ?? []).join(', ')}] ${s.places.map((pl) => `${pl.file}:${pl.lines?.[0] ?? 'new'}`).join(' ')} ${s.title}`);
		console.log(`INFO The plan of the fixes: ${JSON.stringify(results.fixPlan)}`);
		check('The steps of the fixes have the ids F1, F2 and so on, and each issue to fix has a step', fixSteps.every((s, i) => s.id === `F${i + 1}`)
			&& toFixAtGate.every((id) => fixSteps.some((s) => (s.fixes ?? []).includes(id))), results.fixPlan);
		check('The ledger records the plan of the fixes', ledgerOf(TASK_1).some((d) => d.kind === 'fix-plan' && d.round === 1 && d.steps === fixSteps.length),
			ledgerOf(TASK_1).filter((d) => d.kind === 'fix-plan'));
		// the levels of the rules. A step with no level yet gets a level of the user
		const riskNow = () => readJson(taskFile(TASK_1, 'risk.json'));
		const withLevels = await poll(() => (fixSteps.every((s) => levelOf(s, riskNow(), levelsNow()).level !== null) ? true : undefined), 30);
		if (!withLevels) {
			console.log(`NOTE The steps ${fixSteps.filter((s) => levelOf(s, riskNow(), levelsNow()).level === null).map((s) => s.id).join(', ')} have no level of the rules.`);
		}
		check('The rules give each step of the fixes a level, as in stage 4', !!withLevels, fixSteps.map((s) => `${s.id} ${levelOf(s, riskNow(), levelsNow()).level}`));
		await command(wb, 'Shotgun: Show Page');
		text = await poll(async () => {
			const t = await pageText();
			return t && /fix plan/i.test(t) && fixSteps.every((s) => t.includes(s.title)) ? t : undefined;
		}, 20);
		check('The page of the fix plan shows the steps of the fixes', !!text, await pageText());
		await wb.shot('page-fix-plan.png');

		// the writer at each level (decision 44): the user writes step A, and Claude writes step B. The page shows the writers
		// of the selected step. A step with no level gets level 3 first, because the page shows no writer before a level
		const stepA = fixSteps[0];
		const stepB = fixSteps[1];
		const writerNow = (s) => stepWriterOf(s, riskNow(), levelsNow());
		const selectWriter = async (step, label) => {
			if (levelOf(step, riskNow(), levelsNow()).level === null) {
				await command(wb, 'Shotgun: Set Risk Level');
				await quickPickNth(wb, 'Shotgun: Set Risk Level', fixSteps.indexOf(step));
				await quickPickNth(wb, 'Shotgun: Set Risk Level of', 2);
				await poll(() => levelsNow()?.levels?.[step.id]?.level || undefined, 15);
			}
			await poll(() => inWebview('.page', `() => {
				const row = [...d.querySelectorAll('.step-row')].find((x) => x.querySelector('.step-num')?.textContent === ${JSON.stringify(step.id)});
				row?.click();
				return !!row;
			}`), 10);
			await sleep(600);
			return poll(() => inWebview('.page', `() => {
				const b = [...d.querySelectorAll('.writer-choice button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
				b?.click();
				return !!b;
			}`), 10);
		};
		await selectWriter(stepA, 'I write it');
		await poll(() => writerNow(stepA) === 'user' || undefined, 10);
		if (stepB) {
			await selectWriter(stepB, 'Claude writes it');
			await poll(() => writerNow(stepB) === 'claude' || undefined, 10);
		}
		check('On the page of the fix plan, the user selects the writers: the user for step A, and Claude for step B (decision 44)',
			writerNow(stepA) === 'user' && (!stepB || writerNow(stepB) === 'claude'),
			{ A: writerNow(stepA), B: stepB && writerNow(stepB), levels: levelsNow()?.levels });
		if (!stepB) {
			console.log('NOTE The plan of the fixes has 1 step, so stage 6 has no errand of Claude.');
		}
		// the gate "Accept the fix plan". An open decision in a step of Claude gets a modal message first
		await poll(() => clickPanelGate('Accept the fix plan'), 15);
		await poll(() => clickDialog(wb, 'Pass the Gate'), 3);
		const planAccepted = await poll(() => (phaseNow().phase === 'fixes' ? reviewNow() : undefined), 20);
		check('The gate "Accept the fix plan" takes the round to the fixes', !!planAccepted?.rounds?.[0]?.planAccepted
			&& ledgerOf(TASK_1).some((d) => d.kind === 'review-gate' && d.gate === 'accept-fix-plan'), { phase: phaseNow(), rounds: reviewNow()?.rounds });

		// 15: the steps of the fixes go in sequence, as the steps of the build. Shotgun opens step A for the user. A run of
		// Claude Code with no plugins stands in for the user and writes the fix
		const isFixed = (id) => issueOf(id)?.state === 'fixed';
		// the issues that only this step fixes. The gate of the step fixes them
		const onlyIn = (step) => (step.fixes ?? []).filter((id) => fixSteps.filter((s) => (s.fixes ?? []).includes(id)).length === 1);
		const openedA = await poll(() => (buildOf()?.steps?.[stepA.id]?.state === 'open' ? buildOf().steps[stepA.id] : undefined), 30);
		check(`Shotgun opens step ${stepA.id} of the fixes for the user`, openedA?.writer === 'user', buildOf()?.steps?.[stepA.id]);
		text = await poll(async () => {
			const t = await panelText();
			return t && new RegExp(`step ${stepA.id}`, 'i').test(t) && t.includes('The step is done') && t.includes('The fixes are done') ? t : undefined;
		}, 15);
		check(`The panel shows step ${stepA.id} with its own gate, and the gate "The fixes are done"`, !!text, await panelText());
		await wb.shot('panel-fix-step.png');
		const scopeA = openedA?.scope ?? [...new Set(stepA.places.map((pl) => pl.file))];
		const beforeA = fileHashes();
		const userFix = await runClaude('fix-user', [
			`You stand in for the user of this project. Do this step of a plan: ${stepA.title}. ${stepA.text}`,
			`It fixes these issues of a code review: ${(stepA.fixes ?? []).map((id) => issueOf(id)).map((i) => i?.title ?? i?.text ?? '').join(' ')}`,
			`Change only these files: ${scopeA.join(', ')}. Do not build or run the code.`,
		].join(' '), { tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob'], maxTurns: 20, seconds: 300, plugins: false });
		const changedA = [...fileHashes()].filter(([f, h]) => beforeA.get(f) !== h).map(([f]) => f);
		check(`A run of Claude Code with no plugins stands in for the user, and writes step ${stepA.id}`, changedA.length > 0,
			{ changedA, result: userFix.result.slice(0, 300) });
		if (changedA.length === 0) {
			const placeA = stepA.places.find((pl) => pl.lines) ?? stepA.places[0];
			const fileA = path.join(p.project, placeA.file);
			const t = fs.readFileSync(fileA, 'utf8').split('\n');
			t.splice((placeA.lines?.[0] ?? 1) - 1, 0, '// The user wrote this line in the fix of the issue.');
			fs.writeFileSync(fileA, t.join('\n'));
		}
		await sleep(1500);
		await poll(() => clickPanelGate('The step is done'), 10);
		const doneA = await poll(() => (buildOf()?.steps?.[stepA.id]?.state === 'done' ? buildOf().steps[stepA.id] : undefined), 20);
		check(`The gate "The step is done" ends step ${stepA.id}, and fixes each issue that no other step fixes`, !!doneA && onlyIn(stepA).every(isFixed),
			{ step: buildOf()?.steps?.[stepA.id], issues: (stepA.fixes ?? []).map(issueOf) });
		const linesA = await poll(() => {
			const runs = Object.values(readJson(taskFile(TASK_1, 'lines.json'))?.files ?? {}).flatMap((x) => x.runs ?? []);
			return runs.some((r) => r.writer === 'user' && r.step === stepA.id) ? runs : undefined;
		}, 10);
		check(`lines.json records the lines of the user in step ${stepA.id}`, !!linesA, readJson(taskFile(TASK_1, 'lines.json')));

		// B: Claude writes step B as an errand with a receipt, by the choice of the user
		if (stepB) {
			text = await poll(async () => (await panelText())?.includes(`Do step ${stepB.id}.`) && true, 15);
			check(`The panel shows the request "Do step ${stepB.id}."`, !!text, await panelText());
			const beforeB = fileHashes();
			const errandB = await runClaude('fix-errand', `Do step ${stepB.id}.`, { tools: errandTools, maxTurns: 40, seconds: 900 });
			const namesB = errandB.toolUses.map((t) => t.name);
			const editB = namesB.findIndex((n) => ['Edit', 'Write', 'MultiEdit'].includes(n));
			check(`"Do step ${stepB.id}." loads the skill shotgun-errand, opens the step before its first file change, and gives a receipt`,
				errandB.toolUses.some((t) => t.name === 'Skill' && String(t.input?.skill).includes('shotgun-errand')) && namesB.includes(START_STEP)
					&& (editB < 0 || namesB.indexOf(START_STEP) < editB) && namesB.includes(SUBMIT_ERRAND), namesB);
			const stepBuildB = buildOf()?.steps?.[stepB.id];
			const scopeB = new Set((stepBuildB?.scope ?? []).map((f) => f.toLowerCase()));
			const changedB = [...fileHashes()].filter(([f, h]) => beforeB.get(f) !== h).map(([f]) => f);
			check(`In stage 6, the guard lets Claude change only the scope of step ${stepB.id}, and the receipt has its changes`, stepBuildB?.state === 'receipt'
				&& changedB.every((f) => scopeB.has(f.toLowerCase())) && (stepBuildB?.receipt?.changes?.length ?? 0) > 0, { changedB, step: stepBuildB });
			for (let i = 0; i < (stepBuildB?.receipt?.changes?.length ?? 0); i++) {
				await clickMark(i, 'OK');
				await sleep(400);
			}
			await poll(() => (buildOf()?.steps?.[stepB.id]?.receipt?.changes ?? []).every((c) => c.mark === 'ok') || undefined, 15);
			await sleep(500);
			await poll(() => clickPanelGate('Accept the receipt'), 10);
			const doneB = await poll(() => (buildOf()?.steps?.[stepB.id]?.state === 'done' ? buildOf().steps[stepB.id] : undefined), 20);
			check(`The gate "Accept the receipt" ends step ${stepB.id}, and fixes each issue that no other step fixes`, !!doneB && onlyIn(stepB).every(isFixed),
				{ step: buildOf()?.steps?.[stepB.id], issues: (stepB.fixes ?? []).map(issueOf) });
		}

		// the other steps of the fixes end with no code. Then the gate "The fixes are done" ends round 1
		for (let k = 0; k < 12; k++) {
			const next = fixSteps.find((s) => buildOf()?.steps?.[s.id]?.state !== 'done');
			if (!next) {
				break;
			}
			await endWithNoCode(next);
		}
		const fixesLeft = fixSteps.filter((s) => buildOf()?.steps?.[s.id]?.state !== 'done').map((s) => s.id);
		check('Each step of the fixes is done, and each issue to fix of round 1 is fixed', fixesLeft.length === 0 && toFixAtGate.every(isFixed),
			{ fixesLeft, issues: toFixAtGate.map(issueOf) });
		await poll(() => clickPanelGate('The fixes are done'), 15);
		const fixesDone = await poll(() => (phaseNow().phase === 'review' && phaseNow().round === 2 ? reviewNow() : undefined), 20);
		check('The gate "The fixes are done" ends round 1, and round 2 starts with a review', !!fixesDone?.rounds?.[0]?.fixesDone
			&& ledgerOf(TASK_1).some((d) => d.kind === 'review-gate' && d.gate === 'fixes-done'), { phase: phaseNow(), rounds: reviewNow()?.rounds });

		// 16: the next round reviews the fixes (P23). get_review marks the changed hunks, and gives the fixed issues to check
		const fixedIds = (reviewNow()?.issues ?? []).filter((i) => i.state === 'fixed').map((i) => i.id);
		text = await poll(async () => (await panelText())?.includes('Copy the prompt of round 2') && true, 15);
		check('After "The fixes are done", the panel copies the prompt of round 2', !!text, await panelText());
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.review-options button')].find((x) => x.textContent.includes('Copy the prompt of round 2'));
			b?.click();
			return !!b;
		}`);
		const data2 = await callBridgeTool('shotgun_get_review', {});
		let review2Data;
		try {
			review2Data = JSON.parse(data2.text ?? '');
		} catch {
			review2Data = undefined;
		}
		check('get_review of round 2 gives the fixed issues to check, and marks the hunks that changed since round 1', review2Data?.round === 2
			&& review2Data?.phase === 'review' && fixedIds.every((id) => review2Data.fixedIssues?.some((i) => i.id === id))
			&& (review2Data.files ?? []).some((f) => f.hunks.some((h) => h.isChangedSinceLastRound)), { ...data2, text: data2.text?.slice(0, 1500) });
		const reviewRun2 = await runClaude('review-2', reviewPrompt(TITLE, reviewNow()?.options ?? options, 2), {
			tools: [GET_SESSION, GET_REVIEW, SUBMIT_REVIEW, 'Skill', 'Agent', 'Task', 'Read', 'Grep', 'Glob', ...READ_TOOLS,
				'mcp__plugin_dataflow_dataflow__get_diff', 'mcp__plugin_dataflow_dataflow__get_ripple'],
			maxTurns: 80, seconds: 2400,
		});
		const after2 = reviewNow();
		check('The prompt of round 2 loads the skill shotgun-review, and Claude gives round 2 with shotgun_submit_review',
			reviewRun2.toolUses.some((t) => t.name === SUBMIT_REVIEW) && (after2?.rounds ?? []).some((r) => r.n === 2), reviewRun2.toolUses.map((t) => t.name));
		const states2 = fixedIds.map((id) => after2?.issues?.find((i) => i.id === id)).map((i) => `${i?.id} ${i?.state} ${i?.lastRound}`);
		results.review2 = { fixed: states2, issues: (after2?.issues ?? []).filter((i) => i.lastRound === 2).map((i) => `${i.id} ${i.list} ${i.state} ${i.title}`) };
		console.log(`INFO Round 2: ${JSON.stringify(results.review2)}`);
		// the skill checks each fixed issue in a subagent with the prompt of a fix check
		const fixChecks = reviewRun2.toolUses.filter((t) => (t.name === 'Agent' || t.name === 'Task') && /check 1 fix/i.test(String(t.input?.prompt)));
		check('Round 2 checks each fixed issue in a subagent with the prompt of a fix check',
			fixedIds.every((id) => fixChecks.some((t) => new RegExp(`\\b${id}\\b`).test(String(t.input?.prompt)))), fixChecks.map((t) => t.input?.description));
		// a correct fix stays fixed. An issue with a wrong fix comes again with its id
		check('Each fixed issue stays fixed, or comes again with its id in round 2', fixedIds.every((id) => {
			const i = after2?.issues?.find((x) => x.id === id);
			return i?.state === 'fixed' || (i?.state === 'open' && i.lastRound === 2);
		}), states2);
		check('Round 2 repeats no closed issue', !closeC || after2?.issues?.find((i) => i.id === closeC.id)?.state === 'closed',
			after2?.issues?.find((i) => i.id === closeC?.id));
		check('After the review of round 2, the round is at the issues page', phaseNow().phase === 'issues' && phaseNow().round === 2, phaseNow());

		// 17: the gate "The task is done" never waits. It is beside the gate of each part of the round. With open issues to
		// fix, a modal message asks first
		await command(wb, 'Shotgun: Show Page');
		await poll(() => inWebview('.page', `() => {
			const b = [...d.querySelectorAll('.gate button, .secondary-gate button')].find((x) => x.textContent.trim() === 'The task is done' && !x.disabled);
			b?.click();
			return !!b;
		}`), 15);
		await poll(() => clickDialog(wb, 'Pass the Gate'), 5);
		const done6 = await poll(() => (readJson(taskFile(TASK_1, 'task.json'))?.isDone ? readJson(taskFile(TASK_1, 'task.json')) : undefined), 20);
		check('The gate "The task is done" ends the task in stage 6', done6?.stage === 'review' && done6?.gates?.at(-1)?.gate === 'task-done', readJson(taskFile(TASK_1, 'task.json')));
		// the check of the commit message also works after the end of the task (P24)
		const checkRun2 = await runClaude('commit-2', 'Check my commit message.', {
			tools: [GET_SESSION, GET_COMMIT_MESSAGE, SUBMIT_MESSAGE_CHECK, 'Skill', 'Read', 'Bash(git diff:*)', 'Bash(git status:*)', ...READ_TOOLS,
				'mcp__plugin_dataflow_dataflow__get_diff'],
			maxTurns: 30, seconds: 600,
		});
		const messageCheck2 = readJson(taskFile(TASK_1, 'message.json'));
		check('After the end of the task, Claude checks the commit message again', checkRun2.toolUses.some((t) => t.name === SUBMIT_MESSAGE_CHECK)
			&& !!messageCheck2 && messageCheck2.time !== messageCheck?.time, { names: checkRun2.toolUses.map((t) => t.name), messageCheck2 });

		wb.ws.close();
	} catch (error) {
		check('The test runs to its end', false, String(error?.stack ?? error));
		// the screen at the failure
		await wb?.shot('failure.png').catch(() => undefined);
	} finally {
		killTree(proc.pid);
		await sleep(2000);
		const left = await stopProcessesOf(dir);
		check('No process of the run is left', left.length === 0, left);
		// a write of a stage file that failed leaves a temporary file
		const temps = [];
		const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(folder, e.name))
			: e.name.endsWith('.tmp') && temps.push(path.join(folder, e.name))));
		if (fs.existsSync(path.join(p.project, '.shotgun'))) {
			walk(path.join(p.project, '.shotgun'));
		}
		check('No temporary file is left in .shotgun', temps.length === 0, temps);
		// the CLI makes folders in the data of the user. cleanUserData removes the folders of the run. A different new folder
		// stays, but the check fails
		const user = cleanUserData(before, dir);
		check('The data of Claude Code of the user did not change', user.isSame, user.added);
	}
	fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
	const failed = results.checks.filter((c) => !c.isOk).length;
	console.log(`${results.checks.length - failed} of ${results.checks.length} checks passed. The files are in ${dir}.`);
	process.exitCode = failed === 0 ? 0 : 1;
}

await main();
