// The test of Shotgun with Claude Code. It starts the test build of VS Code with DataFlow and Shotgun from their
// repository folders. In VS Code, it makes a task with "Shotgun: New Task", and connects DataFlow and Shotgun to Claude
// Code with their commands. Then 2 tasks go from the brief to stage 2 (the condition of phase 2), with 3 prompts of the
// CLI of Claude Code in print mode:
// 1. Task 1: the test writes the brief into brief.md, as the user does. "Ask me questions about my brief." loads the
//    skill shotgun, and Claude gives its questions with shotgun_submit_questions. The test closes the questions.
// 2. Claude tries to change a file of the project in stage 1, and the guard denies the change (phase 1).
// 3. The test passes the gate of task 1. Then the user gives a brief in the chat, and Claude gives it to Shotgun with
//    shotgun_submit_brief. Shotgun makes task 2, and the test passes its gate.
// The commands write the settings of proposal P15, and the test checks these files. The CLI loads the 2 plugins with
// --plugin-dir from the folders that the commands wrote. The CLI uses the login and thus the config folder of the user,
// and a marketplace from settings would go into the plugin data of the user.
// The settings of the user do not change: the test build has its own user data, MCP registry, folder for the settings
// of Claude Code and Shotgun folder. The test records the plugin data of Claude Code of the user before the runs, and
// checks it after them. It removes the empty folders that the CLI makes there.
// The test uses the Claude subscription of the user for 2 short runs of Claude Code, so it runs only on request.
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

// The processes with the run folder in their command line. The query itself is not in the list
function processesOf(dir) {
	const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir.replace(/'/g, "''")}') `
		+ "-and -not $_.CommandLine.Contains('Get-CimInstance') } | ForEach-Object { \"$($_.ProcessId)`t$($_.Name)\" }";
	const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
	return out.split(/\r?\n/).filter(Boolean).map((l) => ({ pid: Number(l.split('\t')[0]), name: l.split('\t')[1] }));
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

// Types a text into the visible quick input, and selects Enter. title: the title of the quick input, or no title for the
// Command Palette
async function quickInput(wb, text, title) {
	for (let i = 0; i < 40; i++) {
		const isReady = await wb.evaluate(`(() => {
			const w = document.querySelector('.quick-input-widget');
			if (!w || getComputedStyle(w).display === 'none' || !w.contains(document.activeElement)) { return false; }
			const t = w.querySelector('.quick-input-title')?.textContent ?? '';
			return ${JSON.stringify(title ?? '')} ? t.includes(${JSON.stringify(title ?? '')}) : true;
		})()`);
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

// Selects the first item of the visible quick pick with this title
async function quickPickFirst(wb, title) {
	for (let i = 0; i < 40; i++) {
		const isReady = await wb.evaluate(`(() => {
			const w = document.querySelector('.quick-input-widget');
			if (!w || getComputedStyle(w).display === 'none') { return false; }
			return (w.querySelector('.quick-input-title')?.textContent ?? '').includes(${JSON.stringify(title)}) && !!w.querySelector('.monaco-list-row');
		})()`);
		if (isReady) {
			await wb.key('Enter', 'Enter', 13);
			return;
		}
		await sleep(250);
	}
	throw new Error(`The quick pick "${title}" did not open.`);
}

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
const ledgerOf = (id) => (fs.existsSync(taskFile(id, 'decisions.jsonl'))
	? fs.readFileSync(taskFile(id, 'decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// Runs a command with the Command Palette. A click on the editor area first takes the focus from a webview, for example
// from the panel of Shotgun after "Shotgun: New Task"
async function command(wb, text) {
	const box = await wb.evaluate(`(() => { const r = document.querySelector('.part.editor')?.getBoundingClientRect();
		return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined; })()`);
	if (box) {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await wb.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
		}
		await sleep(300);
	}
	await wb.key('P', 'KeyP', 80, 10); // ctrl+shift+p
	await quickInput(wb, text);
	await sleep(800);
}

// The text of the webview of the panel of Shotgun, or undefined
async function panelText() {
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	for (const t of targets.filter((x) => x.webSocketDebuggerUrl && x.url.includes('vscode-webview'))) {
		const c = await connect(t.webSocketDebuggerUrl);
		const text = await c.evaluate("(() => { const d = document.querySelector('iframe#active-frame')?.contentDocument ?? document; "
			+ "return d.querySelector('.panel') ? d.body.innerText : undefined; })()");
		c.ws.close();
		if (text) {
			return text;
		}
	}
	return undefined;
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

function runClaude(name, prompt) {
	const args = [
		'-p', prompt,
		'--output-format', 'stream-json', '--verbose', '--include-hook-events',
		'--model', 'sonnet',
		// no settings of the user, and the 2 plugins from the folders that the commands wrote
		'--setting-sources', 'project', '--plugin-dir', dataflowPlugin, '--plugin-dir', shotgunPlugin,
		'--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
		'--allowedTools', [GET_SESSION, SUBMIT_BRIEF, SUBMIT_QUESTIONS, 'Skill'].join(','),
		'--max-turns', '8', '--no-session-persistence',
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
		const timer = setTimeout(() => killTree(proc.pid), 300000);
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
	try {
		const wb = await workbench();
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
		check('The bridge of DataFlow lists the 5 tools of Shotgun', bridge.shotgun?.length === 5,
			{ ...bridge, windows, listeners: bridge.shotgun?.length === 5 ? undefined : listenersOf(MCP_PORT) });
		if (bridge.shotgun?.length !== 5) {
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
		check('The ledger records the deny', deny?.tool === 'Edit' && deny?.file === path.join('src', 'battery.cpp'), deny);
		text = await poll(async () => (await panelText())?.includes(`The guard stopped Edit of ${path.join('src', 'battery.cpp')}.`) && true, 15);
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
		wb.ws.close();
	} catch (error) {
		check('The test runs to its end', false, String(error?.stack ?? error));
	} finally {
		killTree(proc.pid);
		await sleep(2000);
		for (const x of processesOf(dir)) {
			killTree(x.pid);
		}
		await sleep(500);
		const left = processesOf(dir);
		check('No process of the run is left', left.length === 0, left);
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
