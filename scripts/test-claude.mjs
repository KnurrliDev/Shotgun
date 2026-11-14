// The test of Shotgun with Claude Code. It starts the test build of VS Code with DataFlow and Shotgun from their
// repository folders. In VS Code, it makes a task with "Shotgun: New Task", and connects DataFlow and Shotgun to Claude
// Code with their commands. Then it runs 9 prompts of the CLI of Claude Code in print mode:
// 1. Task 1: the test writes the brief into brief.md, as the user does. "Ask me questions about my brief." loads the
//    skill shotgun, and Claude gives its questions with shotgun_submit_questions. The test closes the questions.
// 2. Claude tries to change a file of the project in stage 1, and the guard denies the change (phase 1).
// 3. The test passes the gate of task 1. Then the user gives a brief in the chat, and Claude gives it to Shotgun with
//    shotgun_submit_brief. Shotgun makes task 2, and the test passes its gate (the condition of phase 2).
// 4. The test opens task 1 again. "Survey my brief." loads the skill shotgun-survey, and Claude gives the survey with
//    shotgun_submit_survey. Shotgun adds the facts of DataFlow to each hook. The test answers the questions of the
//    survey, and passes the gate "Order the tasks" (the condition of phase 3).
// 5. On the order page, the test changes the text of a task, adds a task and moves it. "Survey my changed tasks."
//    loads the skill shotgun-survey, and Claude surveys the 2 tasks with shotgun_submit_task_survey. Then the test
//    passes the gate "Accept the order" on the page (the condition of phase 4).
// 6. "Make the plan." loads the skill shotgun-plan, and Claude gives the steps with shotgun_submit_plan. The rules give
//    each step a level from the facts of DataFlow. The test changes a level and writes a note on the page, and passes
//    the gate "Accept the plan" (the condition of phase 5). It sets step 1 to level 4 and step 2 to level 2 first.
// 7. In stage 5, Shotgun opens step 1 for the user. The test writes a line, and passes "The step is done". Then "Do step
//    2." loads the skill shotgun-errand: Claude opens the step, changes its scope, and gives the receipt. The test puts
//    the marks and an issue with a note on the receipt in the panel.
// 8. "Fix the issues of step 2." opens the step again, and Claude gives a new receipt. The test marks each change OK,
//    and passes "Accept the receipt" (the condition of phase 6).
// 9. In stage 5, the test sets step 3 to level 4, and selects "I want a frame". "Give me a frame for step 3." loads the
//    skill shotgun-frame, and Claude gives the frame with shotgun_submit_frame. The test goes to the holes with Tab and
//    types their code. The last hole gets the nudge and then the answer of Claude. The gate "The step is done" ends the
//    step (the condition of phase 7).
// The commands write the settings of proposal P15, and the test checks these files. The CLI loads the 2 plugins with
// --plugin-dir from the folders that the commands wrote. The CLI uses the login and thus the config folder of the user,
// and a marketplace from settings would go into the plugin data of the user.
// The settings of the user do not change: the test build has its own user data, MCP registry, folder for the settings
// of Claude Code and Shotgun folder. The test records the plugin data of Claude Code of the user before the runs, and
// checks it after them. It removes the empty folders that the CLI makes there.
// The test uses the Claude subscription of the user for 9 runs of Claude Code, so it runs only on request.
// Usage: node scripts/test-claude.mjs <new run folder>
// Environment: DATAFLOW_REPO (default: ../DataFlow), CLAUDE_EXE (default: the CLI of the VS Code extension of Claude Code)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

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
// The read tools of DataFlow for the survey
const READ_TOOLS = ['list_functions', 'get_outline', 'get_place', 'get_callers', 'get_calls', 'get_threads', 'get_heat', 'get_flow', 'get_logic',
	'get_structure', 'get_member_sites', 'get_includes', 'get_call_graph', 'get_hidden'].map((t) => `mcp__plugin_dataflow_dataflow__${t}`);
// The number of the tools of Shotgun in the MCP server of DataFlow
const SHOTGUN_TOOLS = 14;
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const newest = (dir, prefix) => fs.readdirSync(dir).filter((d) => d.startsWith(prefix))
	.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const codeExe = () => path.join(DATAFLOW, '.vscode-test', newest(path.join(DATAFLOW, '.vscode-test'), 'vscode-win32-x64-archive'), 'Code.exe');
function claudeExe() {
	if (process.env.CLAUDE_EXE) {
		return process.env.CLAUDE_EXE;
	}
	const dir = path.join(os.homedir(), '.vscode', 'extensions');
	return path.join(dir, newest(dir, 'anthropic.claude-code-'), 'resources', 'native-binary', 'claude.exe');
}

// The environment for a child process: no variables of a session of Claude Code or of a VS Code that started this script
function cleanEnv(extra = {}) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!/^(CLAUDE|ANTHROPIC|VSCODE_|ELECTRON_)/i.test(key)) {
			env[key] = value;
		}
	}
	return { ...env, ...extra };
}

function killTree(pid) {
	try {
		execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} catch {
		// the process is closed
	}
}

// The processes with the run folder in their command line. The query, this script and the processes that started this
// script are not in the list: the command line of this script also has the run folder
function processesOf(dir) {
	const script = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$([int]($_.CommandLine -and "
		+ `$_.CommandLine.Contains('${dir.replace(/'/g, "''")}') -and -not $_.CommandLine.Contains('Get-CimInstance')))\" }`;
	const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
	const all = out.split(/\r?\n/).filter(Boolean).map((l) => {
		const [pid, parent, name, isOfRun] = l.split('\t');
		return { pid: Number(pid), parent: Number(parent), name, isOfRun: isOfRun === '1' };
	});
	const parents = new Map(all.map((x) => [x.pid, x.parent]));
	const own = new Set();
	for (let pid = process.pid; pid && !own.has(pid); pid = parents.get(pid)) {
		own.add(pid);
	}
	return all.filter((x) => x.isOfRun && !own.has(x.pid)).map(({ pid, name }) => ({ pid, name }));
}

const readJson = (file) => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return undefined;
	}
};
const hashOf = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function waitFor(fn, seconds, what) {
	for (let waited = 0; waited < seconds * 1000; waited += 250) {
		const value = fn();
		if (value) {
			return value;
		}
		await sleep(250);
	}
	throw new Error(`No ${what} after ${seconds} s.`);
}

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

// The data of Claude Code of the user that a run of the CLI can change
const userClaude = path.join(os.homedir(), '.claude');
const userFiles = [path.join(userClaude, 'plugins', 'known_marketplaces.json'), path.join(userClaude, 'plugins', 'installed_plugins.json')];
const userFolders = [path.join(userClaude, 'plugins', 'data'), path.join(userClaude, 'projects')];
const listOf = (folder) => (fs.existsSync(folder) ? fs.readdirSync(folder) : []);
const userState = () => ({
	files: userFiles.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)),
	folders: userFolders.map(listOf),
});

// Removes a folder that has only empty folders. The result: true if the folder is gone
function removeIfEmpty(folder) {
	try {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			if (!entry.isDirectory() || !removeIfEmpty(path.join(folder, entry.name))) {
				return false;
			}
		}
		fs.rmdirSync(folder);
		return true;
	} catch {
		return false;
	}
}

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
		'security.workspace.trust.enabled': false,
		'window.restoreWindows': 'none',
		'update.mode': 'none',
		'extensions.autoUpdate': false,
		'extensions.autoCheckUpdates': false,
		'telemetry.telemetryLevel': 'off',
	}, null, 2));
}

//-------------------
// VS Code through the Chrome DevTools Protocol

async function connect(url) {
	const ws = new WebSocket(url);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id && pending.has(m.id)) {
			pending.get(m.id)(m);
			pending.delete(m.id);
		}
	};
	const send = (method, params = {}) => new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		ws.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
	return { ws, send, evaluate };
}

async function workbench() {
	let page;
	for (let i = 0; i < 240 && !page; i++) {
		try {
			page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes('workbench'));
		} catch {
			// not ready
		}
		if (!page) {
			await sleep(500);
		}
	}
	if (!page) {
		throw new Error('No workbench page on the debug port.');
	}
	const wb = await connect(page.webSocketDebuggerUrl);
	// the page acts as if it has the focus, also when a different window of the desktop has it
	await wb.send('Emulation.setFocusEmulationEnabled', { enabled: true });
	wb.key = async (key, code, vk, modifiers = 0) => {
		await wb.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
		await wb.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
	};
	wb.shot = async (name) => {
		const res = await wb.send('Page.captureScreenshot', { format: 'png' });
		fs.writeFileSync(path.join(dir, name), Buffer.from(res.result.data, 'base64'));
	};
	return wb;
}

// True if the quick input is visible with this title, or with any title for no title. A webview can take the focus
// after the quick input opens. Then the quick input gets the focus again
function isQuickInputReady(wb, title) {
	return wb.evaluate(`(() => {
		const w = document.querySelector('.quick-input-widget');
		if (!w || getComputedStyle(w).display === 'none') { return false; }
		const t = w.querySelector('.quick-input-title')?.textContent ?? '';
		if (${JSON.stringify(title ?? '')} && !t.includes(${JSON.stringify(title ?? '')})) { return false; }
		if (!w.contains(document.activeElement)) { w.querySelector('input')?.focus(); }
		return w.contains(document.activeElement);
	})()`);
}

// Types a text into the visible quick input, and selects Enter. title: the title of the quick input, or no title for the
// Command Palette
async function quickInput(wb, text, title) {
	for (let i = 0; i < 40; i++) {
		const isReady = await isQuickInputReady(wb, title);
		if (isReady) {
			await wb.send('Input.insertText', { text });
			await sleep(600);
			await wb.key('Enter', 'Enter', 13);
			return;
		}
		await sleep(250);
	}
	throw new Error(`The quick input for "${text}" did not open.`);
}

// Selects an item of the visible quick pick with this title. n: the index of the item, from 0
async function quickPickNth(wb, title, n = 0) {
	for (let i = 0; i < 40; i++) {
		const isReady = await wb.evaluate(`(() => {
			const w = document.querySelector('.quick-input-widget');
			if (!w || getComputedStyle(w).display === 'none') { return false; }
			return (w.querySelector('.quick-input-title')?.textContent ?? '').includes(${JSON.stringify(title)}) && !!w.querySelector('.monaco-list-row');
		})()`);
		if (isReady) {
			for (let k = 0; k < n; k++) {
				await wb.key('ArrowDown', 'ArrowDown', 40);
				await sleep(150);
			}
			await wb.key('Enter', 'Enter', 13);
			return;
		}
		await sleep(250);
	}
	throw new Error(`The quick pick "${title}" did not open.`);
}
const quickPickFirst = (wb, title) => quickPickNth(wb, title, 0);

// The value of fn when it has one, or undefined after the time. fn can be async
async function poll(fn, seconds) {
	for (let waited = 0; waited < seconds * 1000; waited += 300) {
		const value = await fn();
		if (value) {
			return value;
		}
		await sleep(300);
	}
	return undefined;
}

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

// Runs a command with the Command Palette. A click on the text editor first takes the focus from a webview, for example
// from the panel of Shotgun after "Shotgun: New Task". If the page of Shotgun is the active editor, a click can hit a
// button of the page. Then the test removes the focus from the webview, and the workbench gets the keys
async function command(wb, text) {
	// a new webview can take the focus after the keys, so the test tries 3 times
	for (let attempt = 0; attempt < 3; attempt++) {
		const box = await wb.evaluate(`(() => {
			const r = [...document.querySelectorAll('.part.editor .monaco-editor .view-lines')].map((e) => e.getBoundingClientRect()).find((x) => x.width > 0);
			return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
		if (box) {
			for (const type of ['mousePressed', 'mouseReleased']) {
				await wb.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
			}
		} else {
			await wb.evaluate('document.activeElement?.blur()');
		}
		await sleep(300);
		await wb.key('P', 'KeyP', 80, 10); // ctrl+shift+p
		if (await poll(() => isQuickInputReady(wb), 4)) {
			await quickInput(wb, text);
			await sleep(800);
			return;
		}
	}
	// a webview can keep the keys, for example the page of Shotgun with no visible text editor. A click on the Command
	// Center of the title bar opens the quick input, and ">" makes it the Command Palette
	const center = await wb.evaluate(`(() => {
		const e = document.querySelector('.command-center .command-center-center') ?? document.querySelector('.command-center');
		const r = e?.getBoundingClientRect();
		return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
	if (center) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await wb.send('Input.dispatchMouseEvent', { type, x: center.x, y: center.y, button: 'left', clickCount: 1 });
		}
		if (await poll(() => isQuickInputReady(wb), 4)) {
			await quickInput(wb, `>${text}`);
			await sleep(800);
			return;
		}
	}
	throw new Error(`The Command Palette did not open for "${text}".`);
}

// Runs a script in the webview of Shotgun with this root element: .panel for the panel, .page for the page. The script
// has the document of the webview in the variable d. The result: the value of the script, or undefined
async function inWebview(root, script) {
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	for (const t of targets.filter((x) => x.webSocketDebuggerUrl && x.url.includes('vscode-webview'))) {
		const c = await connect(t.webSocketDebuggerUrl);
		const value = await c.evaluate(`(() => { const d = document.querySelector('iframe#active-frame')?.contentDocument ?? document; `
			+ `if (!d.querySelector(${JSON.stringify(root)})) { return undefined; } return (${script})(); })()`);
		c.ws.close();
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

// The text of the webview of the panel of Shotgun, or undefined
const panelText = () => inWebview('.panel', '() => d.body.innerText');
// The text of the page of Shotgun, or undefined
const pageText = () => inWebview('.page', '() => d.body.innerText');

// Clicks the button of a modal message of VS Code with this text. The result: true if the message was there
async function clickDialog(wb, label) {
	return wb.evaluate(`(() => {
		const box = document.querySelector('.monaco-dialog-box');
		const button = box && [...box.querySelectorAll('.monaco-button')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
		button?.click();
		return !!button;
	})()`);
}

//-------------------
// The bridge of DataFlow, as Claude Code starts it: the command of the MCP server of the plugin of DataFlow

// The processes that listen on a TCP port, for the data of a failure
function listenersOf(port) {
	const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { `
		+ '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; "$($_.LocalAddress) $($_.OwningProcess) $($p.ExecutablePath)" }';
	try {
		return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
			.split(/\r?\n/).filter(Boolean);
	} catch (error) {
		return [String(error)];
	}
}

function checkBridge() {
	const server = readJson(path.join(dataflowPlugin, '.claude-plugin', 'plugin.json'))?.mcpServers?.dataflow;
	if (!server) {
		return Promise.resolve({ error: 'The plugin of DataFlow has no MCP server.' });
	}
	return new Promise((resolve) => {
		const proc = spawn(server.command, server.args, { cwd: p.project, env: cleanEnv(server.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		let out = '';
		let stderr = '';
		const finish = (result) => {
			clearTimeout(timer);
			killTree(proc.pid);
			resolve({ ...result, stderr: stderr.slice(0, 1500) });
		};
		const timer = setTimeout(() => finish({ error: 'No answer of the bridge after 20 s.', out: out.slice(0, 1500) }), 20000);
		proc.stdout.on('data', (chunk) => {
			out += chunk.toString('utf8');
			const lines = out.split('\n').filter((l) => l.trim()).map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return undefined;
				}
			});
			const list = lines.find((m) => m?.id === 2);
			if (list) {
				const tools = (list.result?.tools ?? []).map((t) => t.name);
				finish({ count: tools.length, shotgun: tools.filter((t) => t.startsWith('shotgun_')), error: list.error?.message });
			}
		});
		proc.stderr.on('data', (chunk) => {
			stderr += chunk.toString('utf8');
		});
		const send = (message) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
		send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shotgun-test', version: '0.1.0' } } });
		send({ method: 'notifications/initialized' });
		send({ id: 2, method: 'tools/list', params: {} });
	});
}

//-------------------
// Claude Code

// options: tools, the tools that Claude can use with no permission prompt, maxTurns and seconds, the time limit
function runClaude(name, prompt, { tools = [GET_SESSION, SUBMIT_BRIEF, SUBMIT_QUESTIONS, 'Skill'], maxTurns = 8, seconds = 300 } = {}) {
	const args = [
		'-p', prompt,
		'--output-format', 'stream-json', '--verbose', '--include-hook-events',
		'--model', 'sonnet',
		// no settings of the user, and the 2 plugins from the folders that the commands wrote
		'--setting-sources', 'project', '--plugin-dir', dataflowPlugin, '--plugin-dir', shotgunPlugin,
		'--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
		'--allowedTools', tools.join(','),
		'--max-turns', String(maxTurns), '--no-session-persistence',
		'--debug-file', path.join(dir, `claude-${name}.debug.log`),
	];
	return new Promise((resolve) => {
		const t0 = performance.now();
		const proc = spawn(claudeExe(), args, {
			cwd: p.project, env: cleanEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
		});
		const messages = [];
		let rest = '';
		let stderr = '';
		const timer = setTimeout(() => killTree(proc.pid), seconds * 1000);
		proc.stdout.on('data', (chunk) => {
			rest += chunk.toString('utf8');
			const lines = rest.split('\n');
			rest = lines.pop();
			for (const line of lines.filter((l) => l.trim())) {
				try {
					messages.push(JSON.parse(line));
				} catch {
					messages.push({ type: 'text', text: line });
				}
			}
		});
		proc.stderr.on('data', (chunk) => {
			stderr += chunk.toString('utf8');
		});
		proc.on('close', (code) => {
			clearTimeout(timer);
			fs.writeFileSync(path.join(dir, `claude-${name}.jsonl`), messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
			const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
			const run = {
				code,
				ms: Math.round(performance.now() - t0),
				plugins: (init?.plugins ?? []).filter((x) => !x.source.endsWith('@builtin')).map((x) => ({ name: x.name, path: x.path })),
				servers: init?.mcp_servers ?? [],
				hooks: messages.filter((m) => m.type === 'system' && m.subtype === 'hook_response')
					.map((m) => ({ hook: m.hook_name, output: m.output ?? m.stdout ?? m.response ?? '' })),
				toolUses: messages.filter((m) => m.type === 'assistant').flatMap((m) => m.message?.content ?? [])
					.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input })),
				toolResults: messages.filter((m) => m.type === 'user').flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []))
					.filter((b) => b.type === 'tool_result').map((b) => ({ isError: b.is_error === true, text: JSON.stringify(b.content).slice(0, 600) })),
				result: messages.find((m) => m.type === 'result')?.result ?? '',
				stderr: stderr.slice(0, 1000),
			};
			results.runs[name] = run;
			resolve(run);
		});
	});
}

//-------------------

async function main() {
	setup();
	const before = userState();
	const proc = spawn(codeExe(), [
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
		check('"Shotgun: New Task" makes brief.md from the template and opens it',
			fs.readFileSync(brief1, 'utf8').startsWith(`# Brief: ${TITLE}\n\n## Goal\n`) && String(tab).includes('brief.md'), tab);
		let text = await poll(async () => (await panelText())?.includes('0 of 5') && true, 15);
		check('The panel shows the parts of the empty brief', !!text, await panelText());
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
			&& String(guard?.output).includes('stage 1 of 5, the brief'), guard);
		check('Claude gets the reason of the deny', edit.toolResults.some((r) => r.isError && r.text.includes('stage 1 of 5, the brief')), edit.toolResults);
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

		// the page opens the place of a hook in the text editor, and the text editor shows the hook
		const hook = cppHooks[0] ?? survey?.hooks?.[0];
		if (hook) {
			await inWebview('.page', `() => {
				const row = [...d.querySelectorAll('.hooks .row')].find((r) => r.querySelector('.id')?.textContent === ${JSON.stringify(hook.id)});
				row?.click();
				return !!row;
			}`);
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
		results.plan = {
			steps: steps.map((s) => ({
				id: s.id, task: s.task, title: s.title, places: s.places.map((p) => (p.lines ? `${p.file}:${p.lines[0]}-${p.lines[1]}` : `${p.file} (new)`)),
				level: risk?.steps?.[s.id]?.level ?? null, reasons: risk?.steps?.[s.id]?.reasons ?? [],
			})),
		};
		console.log(`INFO The plan: ${JSON.stringify(results.plan.steps.map((s) => `${s.id} ${s.task} ${s.level} ${s.places.join(' ')}`))}`);
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
		const rule1 = risk?.steps?.[steps[0]?.id]?.level ?? 0;
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

		// for the build: the user writes step 1 (level 4), and Claude writes step 2 (level 2). "Shotgun: Set Risk Level" sets them
		for (const [n, level] of [[0, 4], [1, 2]]) {
			await command(wb, 'Shotgun: Set Risk Level');
			await quickPickNth(wb, 'Shotgun: Set Risk Level', n);
			await quickPickNth(wb, 'Shotgun: Set Risk Level of', level - 1);
			await sleep(600);
		}
		const setLevels = await poll(() => {
			const l = readJson(taskFile(TASK_1, 'levels.json'))?.levels ?? {};
			return l[steps[0]?.id]?.level === 4 && l[steps[1]?.id]?.level === 2 ? l : undefined;
		}, 15);
		check('"Shotgun: Set Risk Level" sets step 1 to level 4 and step 2 to level 2', !!setLevels, readJson(taskFile(TASK_1, 'levels.json')));
		await command(wb, 'Shotgun: Show Page');
		await poll(async () => (await pageText())?.includes('Accept the plan') && true, 15);

		// the gate "Accept the plan" on the page
		await inWebview('.page', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('Accept the plan'));
			b?.click();
			return !!b;
		}`);
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
		// the user writes step 1: a comment line above the first place of the step, or a new file
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
		await sleep(1500);
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.gate button')].find((x) => x.textContent.includes('The step is done'));
			b?.click();
			return !!b;
		}`);
		const done1 = await poll(() => (buildOf()?.steps?.[s1.id]?.state === 'done' ? buildOf() : undefined), 20);
		check('The gate "The step is done" ends step 1', !!done1, buildOf());
		const userRuns = await poll(() => {
			const runs = readJson(taskFile(TASK_1, 'lines.json'))?.files?.[place1.file]?.runs ?? [];
			return runs.some((r) => r.writer === 'user' && r.step === s1.id) ? runs : undefined;
		}, 10);
		check('lines.json records the line of the user in step 1', !!userRuns, readJson(taskFile(TASK_1, 'lines.json')));

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
		// the place of the first change opens in the text editor, with a mark in the gutter for each line of Claude
		await inWebview('.panel', `() => {
			const b = d.querySelector('.change .change-place .link');
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

		// 9: a frame of Claude for step 3 (phase 7). In stage 5, the user sets step 3 to level 4 (decision 17), and selects
		// "I want a frame" (decision 16). Then "Give me a frame for step 3." loads the skill shotgun-frame
		const s3 = steps[2];
		await command(wb, 'Shotgun: Set Risk Level');
		await quickPickNth(wb, 'Shotgun: Set Risk Level', 0);
		await quickPickNth(wb, 'Shotgun: Set Risk Level of', 3);
		const opened3 = await poll(() => {
			const b = buildOf()?.steps?.[s3.id];
			return readJson(taskFile(TASK_1, 'levels.json'))?.levels?.[s3.id]?.level === 4 && b?.state === 'open' && b.writer === 'user' ? b : undefined;
		}, 30);
		check('In stage 5, "Shotgun: Set Risk Level" sets step 3 to level 4, and Shotgun opens it for the user', !!opened3,
			{ levels: readJson(taskFile(TASK_1, 'levels.json')), build: buildOf()?.steps?.[s3.id] });
		text = await poll(async () => (await panelText())?.includes('I want a frame') && true, 15);
		check('The panel shows the button "I want a frame" for the step of level 4', !!text, await panelText());
		await inWebview('.panel', `() => {
			const b = [...d.querySelectorAll('.frame-request button')].find((x) => x.textContent.includes('I want a frame'));
			b?.click();
			return !!b;
		}`);
		const requested = await poll(() => {
			const b = buildOf()?.steps?.[s3.id];
			return b?.isFrameRequested && b.writer === 'frame' && b.state === 'todo' ? b : undefined;
		}, 15);
		check('The button records the decision of the user, and step 3 becomes a frame of Claude', !!requested
			&& ledgerOf(TASK_1).some((d) => d.kind === 'frame-request' && d.step === s3.id), buildOf()?.steps?.[s3.id]);
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
		const scope3 = new Set((step3?.scope ?? []).map((f) => f.toLowerCase()));
		const changed3 = [...fileHashes()].filter(([f, h]) => before3.get(f) !== h).map(([f]) => f);
		check('Claude changed only the files of the scope of step 3', changed3.length > 0 && changed3.every((f) => scope3.has(f.toLowerCase())), { changed3, scope: step3?.scope });
		const runsOfStep3 = () => Object.entries(readJson(taskFile(TASK_1, 'lines.json'))?.files ?? {})
			.flatMap(([f, x]) => x.runs.filter((r) => r.step === s3.id).map((r) => ({ file: f, lines: r.lines, writer: r.writer, change: r.change })));
		check('lines.json records the frame lines of Claude', runsOfStep3().some((r) => r.writer === 'claude' && r.change === 'frame'), runsOfStep3());
		results.frame = {
			step: s3.id, note: step3?.frameNote, frameLines: runsOfStep3(),
			holes: holes3.map((h) => ({ n: h.n, question: h.question, place: `${h.file}:${h.line}`, nudge: h.hints.nudge, pointer: h.hints.pointer.text,
				example: `${h.hints.example.file}:${h.hints.example.lines.join('-')} ${h.hints.example.code}`, answer: h.hints.answer, facts: h.facts })),
		};
		console.log(`INFO The frame of step 3: ${JSON.stringify(results.frame.holes.map((h) => `${h.n} ${h.place} ${h.question} = ${h.answer}`))}`);
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
			const b = d.querySelector('.hole-detail .change-place .link');
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
		check('The ledger records the frame request, the frame, the hints and the gate of step 3', ['frame-request', 'frame', 'hint'].every((k) => kinds3.includes(k))
			&& kinds3.filter((k) => k === 'step-gate').length === 3, kinds3);
		await wb.shot('panel-build-step-4.png');

		wb.ws.close();
	} catch (error) {
		check('The test runs to its end', false, String(error?.stack ?? error));
		// the screen at the failure
		await wb?.shot('failure.png').catch(() => undefined);
	} finally {
		killTree(proc.pid);
		await sleep(2000);
		for (const x of processesOf(dir)) {
			killTree(x.pid);
		}
		await sleep(500);
		const left = processesOf(dir);
		check('No process of the run is left', left.length === 0, left);
		// a write of a stage file that failed leaves a temporary file
		const temps = [];
		const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(folder, e.name))
			: e.name.endsWith('.tmp') && temps.push(path.join(folder, e.name))));
		if (fs.existsSync(path.join(p.project, '.shotgun'))) {
			walk(path.join(p.project, '.shotgun'));
		}
		check('No temporary file is left in .shotgun', temps.length === 0, temps);
		// the CLI makes empty folders in the data of the user: the folder of the project of the run in projects, and the
		// data of the 2 plugins in plugins/data. The test removes them. A different new folder stays, but the check fails
		const isOfRun = (name) => name.includes(path.basename(dir)) || ['dataflow-inline', 'shotgun-inline'].includes(name);
		const after = userState();
		userFolders.forEach((folder, i) => after.folders[i].filter((n) => !before.folders[i].includes(n) && isOfRun(n))
			.forEach((n) => removeIfEmpty(path.join(folder, n))));
		const added = userFolders.flatMap((folder, i) => listOf(folder).filter((n) => !before.folders[i].includes(n)));
		check('The data of Claude Code of the user did not change', JSON.stringify(after.files) === JSON.stringify(before.files) && added.length === 0, added);
	}
	fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
	const failed = results.checks.filter((c) => !c.isOk).length;
	console.log(`${results.checks.length - failed} of ${results.checks.length} checks passed. The files are in ${dir}.`);
	process.exitCode = failed === 0 ? 0 : 1;
}

await main();
