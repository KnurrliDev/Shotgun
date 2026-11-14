// The test of Shotgun with Claude Code. It starts the test build of VS Code with DataFlow and Shotgun from their
// repository folders. In VS Code, it makes a task with "Shotgun: New Task", and connects DataFlow and Shotgun to Claude
// Code with their commands. Then it runs 2 prompts with the CLI of Claude Code in print mode:
// 1. Claude reads the session with the tool shotgun_get_session.
// 2. Claude tries to change a file of the project in stage 1, and the guard denies the change.
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
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = path.resolve(import.meta.dirname, '..');
const DATAFLOW = path.resolve(process.env.DATAFLOW_REPO ?? path.join(repo, '..', 'DataFlow'));
const PORT = 9361;
// The port of the MCP server of DataFlow in the test build. A different window of DataFlow can have the default 47321
const MCP_PORT = 47391;
const TITLE = 'A cycle limit for the solver';
const GET_SESSION = 'mcp__plugin_dataflow_dataflow__shotgun_get_session';
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
		'--allowedTools', GET_SESSION,
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
		check('The bridge of DataFlow lists the 3 tools of Shotgun', bridge.shotgun?.length === 3,
			{ ...bridge, windows, listeners: bridge.shotgun?.length === 3 ? undefined : listenersOf(MCP_PORT) });
		if (bridge.shotgun?.length !== 3) {
			throw new Error('The bridge does not work, so the test does not run Claude Code.');
		}

		// 1: Claude reads the session
		const session = await runClaude('session', 'Read my Shotgun session with the Shotgun tool. Then tell me the title of the task and its stage.');
		const isPlugin = (name, folder) => session.plugins.some((x) => x.name === name && path.resolve(x.path) === path.resolve(folder));
		check('Claude Code loads the plugins that DataFlow and Shotgun wrote', isPlugin('dataflow', dataflowPlugin) && isPlugin('shotgun', shotgunPlugin),
			session.plugins);
		check('The MCP server of DataFlow is connected', session.servers.some((s) => s.name === 'plugin:dataflow:dataflow' && s.status === 'connected'), session.servers);
		const context = session.hooks.find((h) => h.hook === 'UserPromptSubmit');
		check('The context hook gives the task to Claude', String(context?.output).includes(`the active task is \\"${TITLE}\\"`) || String(context?.output).includes(`the active task is "${TITLE}"`), context);
		check('Claude reads the session with shotgun_get_session', session.toolUses.some((t) => t.name === GET_SESSION), session.toolUses.map((t) => t.name));
		check('The answer of Claude has the title and the stage', session.result.includes(TITLE.slice(2)) && /brief|stage 1/i.test(session.result), session.result);

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
		const ledger = fs.readFileSync(path.join(p.project, '.shotgun', 'a-cycle-limit-for-the-solver', 'decisions.jsonl'), 'utf8')
			.split('\n').filter(Boolean).map((l) => JSON.parse(l));
		const deny = ledger.find((d) => d.kind === 'deny');
		check('The ledger records the deny', deny?.tool === 'Edit' && deny?.file === path.join('src', 'battery.cpp'), deny);

		// the panel and the page show the deny
		await command(wb, 'Focus on Shotgun View');
		await sleep(1500);
		const text = await panelText();
		check('The panel shows the deny', !!text?.includes(`The guard stopped Edit of ${path.join('src', 'battery.cpp')}.`), text);
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
