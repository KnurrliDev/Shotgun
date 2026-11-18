// The shared parts of the scripts that run Claude Code with Shotgun in the test build of VS Code: test-claude.mjs and
// measure-review.mjs. The functions keep no state of a script. Each function gets its folders and its ports as
// parameters.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const newest = (dir, prefix) => fs.readdirSync(dir).filter((d) => d.startsWith(prefix))
	.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

// The test build of VS Code of DataFlow
export const codeExe = (dataflow) => path.join(dataflow, '.vscode-test', newest(path.join(dataflow, '.vscode-test'), 'vscode-win32-x64-archive'), 'Code.exe');

// The CLI of Claude Code: CLAUDE_EXE, else the CLI of the VS Code extension of Claude Code
export function claudeExe() {
	if (process.env.CLAUDE_EXE) {
		return process.env.CLAUDE_EXE;
	}
	const dir = path.join(os.homedir(), '.vscode', 'extensions');
	return path.join(dir, newest(dir, 'anthropic.claude-code-'), 'resources', 'native-binary', 'claude.exe');
}

// The environment for a child process: no variables of a session of Claude Code or of a VS Code that started the script
export function cleanEnv(extra = {}) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!/^(CLAUDE|ANTHROPIC|VSCODE_|ELECTRON_)/i.test(key)) {
			env[key] = value;
		}
	}
	return { ...env, ...extra };
}

export function killTree(pid) {
	try {
		execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} catch {
		// the process is closed
	}
}

// The processes with the run folder in their command line. The query, the script and the processes that started the
// script are not in the list. The command line of the script also has the run folder
export function processesOf(dir) {
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

// Stops each process of the run folder. The result: the processes that are left
export async function stopProcessesOf(dir) {
	for (const x of processesOf(dir)) {
		killTree(x.pid);
	}
	await sleep(500);
	return processesOf(dir);
}

export const readJson = (file) => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return undefined;
	}
};

export async function waitFor(fn, seconds, what) {
	for (let waited = 0; waited < seconds * 1000; waited += 250) {
		const value = fn();
		if (value) {
			return value;
		}
		await sleep(250);
	}
	throw new Error(`No ${what} after ${seconds} s.`);
}

// The value of fn when it has one, or undefined after the time. fn can be async
export async function poll(fn, seconds) {
	for (let waited = 0; waited < seconds * 1000; waited += 300) {
		const value = await fn();
		if (value) {
			return value;
		}
		await sleep(300);
	}
	return undefined;
}

//-------------------
// VS Code through the Chrome DevTools Protocol

export async function connect(url) {
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

// The workbench of the test build on the debug port. shotDir: the folder of the screenshots
export async function workbench(port, shotDir) {
	let page;
	for (let i = 0; i < 240 && !page; i++) {
		try {
			page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes('workbench'));
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
		fs.writeFileSync(path.join(shotDir, name), Buffer.from(res.result.data, 'base64'));
	};
	return wb;
}

// True if the quick input is visible with this title, or with any title for no title. A webview can take the focus
// after the quick input opens. Then the quick input gets the focus again
export function isQuickInputReady(wb, title) {
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
export async function quickInput(wb, text, title) {
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
export async function quickPickNth(wb, title, n = 0) {
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

// Runs a command with the Command Palette. A click on the text editor first takes the focus from a webview, for example
// from the panel of Shotgun after "Shotgun: New Task". If the page of Shotgun is the active editor, a click can hit a
// button of the page. Then the script removes the focus from the webview, and the workbench gets the keys
export async function command(wb, text) {
	// a new webview can take the focus after the keys, so the script tries 3 times
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
export async function inWebview(port, root, script) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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

// A click of the mouse at a point of the workbench, as the user clicks
export async function clickAt(wb, { x, y }) {
	for (const type of ['mousePressed', 'mouseReleased']) {
		await wb.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
	}
	await sleep(400);
}

// Clicks the button of a modal message of VS Code with this text. The result: true if the message was there
export async function clickDialog(wb, label) {
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
export function listenersOf(port) {
	const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { `
		+ '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; "$($_.LocalAddress) $($_.OwningProcess) $($p.ExecutablePath)" }';
	try {
		return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
			.split(/\r?\n/).filter(Boolean);
	} catch (error) {
		return [String(error)];
	}
}

// Starts the bridge, and sends the messages of a client after the start. The result: the value of select for the first
// answer, or an error of the bridge. The first parameter gives the folder of the plugin of DataFlow and of the project
function askBridge({ pluginDir, cwd }, request, select, seconds) {
	const server = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'))?.mcpServers?.dataflow;
	if (!server) {
		return Promise.resolve({ error: 'The plugin of DataFlow has no MCP server.' });
	}
	return new Promise((resolve) => {
		const proc = spawn(server.command, server.args, { cwd, env: cleanEnv(server.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		let out = '';
		let stderr = '';
		const finish = (result) => {
			clearTimeout(timer);
			killTree(proc.pid);
			resolve({ ...result, stderr: stderr.slice(0, 1500) });
		};
		const timer = setTimeout(() => finish({ error: `No answer of the bridge after ${seconds} s.`, out: out.slice(0, 1500) }), seconds * 1000);
		proc.stdout.on('data', (chunk) => {
			out += chunk.toString('utf8');
			const answer = out.split('\n').filter((l) => l.trim()).map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return undefined;
				}
			}).find((m) => m?.id === 2);
			if (answer) {
				finish(select(answer));
			}
		});
		proc.stderr.on('data', (chunk) => {
			stderr += chunk.toString('utf8');
		});
		const send = (message) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
		send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shotgun-test', version: '0.3.0' } } });
		send({ method: 'notifications/initialized' });
		send({ id: 2, ...request });
	});
}

// Calls 1 tool of the MCP server of DataFlow through the bridge, as a client with no Claude. The result: the text of the
// result and isError, or an error of the bridge
export const callBridgeTool = (bridge, name, args) => askBridge(bridge, { method: 'tools/call', params: { name, arguments: args } }, (answer) => ({
	text: (answer.result?.content ?? []).map((c) => c.text ?? '').join('\n'), isError: answer.result?.isError === true || !!answer.error,
	...(answer.error ? { error: answer.error.message } : {}),
}), 60);

// The tools of the MCP server of DataFlow through the bridge: their number, and the tools of Shotgun
export const checkBridge = (bridge) => askBridge(bridge, { method: 'tools/list', params: {} }, (list) => {
	const tools = (list.result?.tools ?? []).map((t) => t.name);
	return { count: tools.length, shotgun: tools.filter((t) => t.startsWith('shotgun_')), error: list.error?.message };
}, 20);

//-------------------
// Claude Code

// A run of the CLI of Claude Code in print mode. The options give the name of the run, the prompt and the folder of the
// project. They also give the folder of the logs, the folders of the plugins, and the tools that Claude can use with no
// permission prompt. maxTurns, seconds and model: the maximum of turns, the time limit and the model. With no plugin
// folder, the run has no plugins, thus no tools of Shotgun and no guard. The result: the plugins, the MCP servers, the
// hooks, the tool uses and results, the result text, and the cost data of the CLI
export function runClaude({ name, prompt, cwd, logDir, pluginDirs = [], tools, maxTurns = 8, seconds = 300, model = 'sonnet' }) {
	const args = [
		'-p', prompt,
		'--output-format', 'stream-json', '--verbose', '--include-hook-events',
		'--model', model,
		// no settings of the user, and the plugins from the folders that the commands wrote
		'--setting-sources', 'project', ...pluginDirs.flatMap((d) => ['--plugin-dir', d]),
		'--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
		'--allowedTools', tools.join(','),
		'--max-turns', String(maxTurns), '--no-session-persistence',
		'--debug-file', path.join(logDir, `claude-${name}.debug.log`),
	];
	return new Promise((resolve) => {
		const t0 = performance.now();
		const proc = spawn(claudeExe(), args, {
			cwd, env: cleanEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
			fs.writeFileSync(path.join(logDir, `claude-${name}.jsonl`), messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
			const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
			const end = messages.find((m) => m.type === 'result');
			resolve({
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
				result: end?.result ?? '',
				// the cost data of the CLI: the turns, the time of the API, the tokens and the cost in USD that the CLI reports
				cost: end ? { turns: end.num_turns, apiMs: end.duration_api_ms, usd: end.total_cost_usd, usage: end.usage } : undefined,
				stderr: stderr.slice(0, 1000),
			});
		});
	});
}

//-------------------
// The data of Claude Code of the user that a run of the CLI can change

const userClaude = path.join(os.homedir(), '.claude');
const userFiles = [path.join(userClaude, 'plugins', 'known_marketplaces.json'), path.join(userClaude, 'plugins', 'installed_plugins.json')];
const userFolders = [path.join(userClaude, 'plugins', 'data'), path.join(userClaude, 'projects')];
const listOf = (folder) => (fs.existsSync(folder) ? fs.readdirSync(folder) : []);

export const userState = () => ({
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

// The CLI makes folders in the data of the user. In projects, it makes a folder for the project of the run. In
// plugins/data, it makes a folder for each plugin. This function removes them. The folder of the project has the name of
// the run folder. The subagents of a review write their data into it, so the function removes it with its content. The
// folders of the plugins go only when they are empty. The result: true if the data of the user is as before, and the new
// folders that are left
export function cleanUserData(before, runDir) {
	const isOfRun = (name) => name.includes(path.basename(runDir)) || ['dataflow-inline', 'shotgun-inline'].includes(name);
	const after = userState();
	userFolders.forEach((folder, i) => after.folders[i].filter((n) => !before.folders[i].includes(n) && isOfRun(n))
		.forEach((n) => (n.includes(path.basename(runDir)) ? fs.rmSync(path.join(folder, n), { recursive: true, force: true }) : removeIfEmpty(path.join(folder, n)))));
	const added = userFolders.flatMap((folder, i) => listOf(folder).filter((n) => !before.folders[i].includes(n)));
	return { isSame: JSON.stringify(after.files) === JSON.stringify(before.files) && added.length === 0, added };
}
