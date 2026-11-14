// The runner of the phase 0 spikes of Shotgun. Each subcommand does 1 part of the spikes, so you can examine the result
// before the next part. All files of a run go into the run folder. The user settings of VS Code and of Claude Code
// do not change: the test build of VS Code gets its own user data, its own MCP registry and its own Claude settings.
// Usage: node spikes/run.mjs <subcommand> <run folder> [arguments]
//   setup                  copies the battery fixture of DataFlow and writes the settings of the test build
//   start                  starts the test build of VS Code with DataFlow and the spike extension
//   s1                     finds the 2 panels in the DOM and takes a screenshot (S1)
//   s5                     sends Tab and Shift+Tab to the frame, and formats the frame with clang-format (S5)
//   wait <kind> [seconds]  waits for a line of the log
//   probe [strict|local]   starts Claude Code until its init message, then stops it. local: the spike plugin is on
//                          in the local settings of the project, not with --plugin-dir
//   claude <name> <prompt> runs 1 prompt with Claude Code in print mode
//   latency [count]        measures the time of a call of shotgun_guard through the bridge
//   receipt                tells the extension to make the receipt of S2
//   stop                   stops the test build and all processes of the run
//   log [kind]             shows the log of the extension
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const here = import.meta.dirname;
const DATAFLOW = path.resolve(process.env.DATAFLOW_REPO ?? path.join(here, '..', '..', 'DataFlow'));
const EXT = path.join(here, 'ext');
const SPIKE_PLUGIN = path.join(here, 'plugin');
const PORT = 9351;
const CLANG_FORMAT = process.env.CLANG_FORMAT ?? 'C:/Program Files/LLVM/bin/clang-format.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const newest = (dir, prefix) => fs.readdirSync(dir).filter((d) => d.startsWith(prefix))
	.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];

// The newest test build of DataFlow, or the build of SPIKE_VSCODE_BUILD, for example 1.143.1
function codeExe() {
	const tests = path.join(DATAFLOW, '.vscode-test');
	const build = process.env.SPIKE_VSCODE_BUILD ? `vscode-win32-x64-archive-${process.env.SPIKE_VSCODE_BUILD}` : newest(tests, 'vscode-win32-x64-archive');
	return path.join(tests, build, 'Code.exe');
}

function claudeExe() {
	if (process.env.CLAUDE_EXE) {
		return process.env.CLAUDE_EXE;
	}
	const dir = path.join(os.homedir(), '.vscode', 'extensions');
	return path.join(dir, newest(dir, 'anthropic.claude-code-'), 'resources', 'native-binary', 'claude.exe');
}

// The environment for a child process: no variables of the Claude Code session of this runner, and no variables of a
// VS Code that started this runner
function cleanEnv(extra = {}) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!/^(CLAUDE|ANTHROPIC|VSCODE_|ELECTRON_)/i.test(key)) {
			env[key] = value;
		}
	}
	return { ...env, ...extra };
}

const paths = (dir) => ({
	project: path.join(dir, 'project'),
	log: path.join(dir, 'spike.log'),
	registry: path.join(dir, 'registry'),
	dataflowPlugin: path.join(dir, 'registry', 'claude', 'plugins', 'dataflow'),
	pid: path.join(dir, 'code.pid'),
});

function readLog(dir) {
	const file = paths(dir).log;
	if (!fs.existsSync(file)) {
		return [];
	}
	return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function waitLog(dir, kind, seconds) {
	for (let waited = 0; waited < seconds * 1000; waited += 500) {
		const hit = readLog(dir).find((e) => e.kind === kind);
		if (hit) {
			return hit;
		}
		const error = readLog(dir).find((e) => e.kind === 'error');
		if (error) {
			throw new Error(`The extension wrote an error: ${error.message}`);
		}
		await sleep(500);
	}
	throw new Error(`No log line "${kind}" after ${seconds} s.`);
}

const print = (value) => console.log(JSON.stringify(value, null, 2));

//-------------------
// The test build of VS Code

function setup(dir) {
	const { project } = paths(dir);
	if (fs.existsSync(project)) {
		throw new Error(`The folder ${project} is there already. Use a new run folder.`);
	}
	const fixture = path.join(DATAFLOW, 'test', 'fixtures', 'battery');
	for (const name of ['src', 'include', '.vscode', 'CMakeLists.txt']) {
		fs.cpSync(path.join(fixture, name), path.join(project, name), { recursive: true });
	}
	// the compile database of the copy, in the form of scripts/prepare-fixtures.mjs of DataFlow
	const build = path.join(project, 'build');
	fs.mkdirSync(build, { recursive: true });
	const sources = fs.readdirSync(path.join(project, 'src')).filter((f) => f.endsWith('.cpp'));
	fs.writeFileSync(path.join(build, 'compile_commands.json'), JSON.stringify(sources.map((f) => {
		const file = path.join(project, 'src', f);
		return { directory: build, file, arguments: ['clang++', '-std=c++20', `-I${path.join(project, 'include')}`, '-c', file] };
	}), null, 2));
	// S2: the scope of the guard is the folder notes. outside.txt is in the project, but not in the scope
	fs.mkdirSync(path.join(project, 'notes'));
	fs.writeFileSync(path.join(project, 'notes', 'inside.txt'), 'A file in the scope of the step.\n');
	fs.writeFileSync(path.join(project, 'outside.txt'), 'A file outside of the scope of the step.\n');
	fs.writeFileSync(path.join(project, '.gitignore'), 'build/\n');
	// S4: the file of the SessionStart command hook. It has a different task than the tools of the extension
	fs.mkdirSync(path.join(project, '.shotgun'));
	fs.writeFileSync(path.join(project, '.shotgun', 'active.json'), JSON.stringify({ task: 'SPIKE-77', stage: 'plan' }));
	const git = (...args) => execFileSync('git', ['-c', 'user.name=Shotgun spike', '-c', 'user.email=spike@example.invalid', ...args],
		{ cwd: project, stdio: 'pipe', windowsHide: true });
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-q', '-m', 'Add the battery fixture for the spikes');

	const user = path.join(dir, 'user-data', 'User');
	fs.mkdirSync(user, { recursive: true });
	fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
		'dataflow.mcp.enabled': true,
		'dataflow.engine.maxThreads': 8,
		'workbench.startupEditor': 'none',
		'workbench.secondarySideBar.defaultVisibility': 'visible',
		'chat.disableAIFeatures': true,
		'git.openRepositoryInParentFolders': 'never',
		'editor.minimap.enabled': false,
		'editor.formatOnSave': false,
		'window.zoomLevel': 0,
		'window.restoreWindows': 'none',
		'security.workspace.trust.enabled': false,
		'update.mode': 'none',
		'extensions.autoUpdate': false,
		'extensions.autoCheckUpdates': false,
		'telemetry.telemetryLevel': 'off',
	}, null, 2));
	print({ project, code: codeExe(), claude: claudeExe(), sources });
}

function start(dir) {
	const p = paths(dir);
	const env = cleanEnv({
		SPIKE_LOG: p.log, SPIKE_ROOT: dir, DATAFLOW_MCP_REGISTRY: p.registry, CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
	});
	const proc = spawn(codeExe(), [
		`--extensionDevelopmentPath=${DATAFLOW}`, `--extensionDevelopmentPath=${EXT}`,
		`--user-data-dir=${path.join(dir, 'user-data')}`, `--extensions-dir=${path.join(dir, 'extensions')}`,
		`--remote-debugging-port=${PORT}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window',
		p.project,
	], { detached: true, stdio: 'ignore', windowsHide: true, env });
	proc.unref();
	fs.writeFileSync(p.pid, String(proc.pid));
	print({ pid: proc.pid });
}

// A connection to the workbench page, with the Chrome DevTools Protocol
async function workbench() {
	let page;
	for (let i = 0; i < 120 && !page; i++) {
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
	const ws = new WebSocket(page.webSocketDebuggerUrl);
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
	const key = async (k, code, vk, modifiers = 0) => {
		await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
	};
	const click = async (x, y) => {
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
		}
	};
	const shot = async (file) => {
		const res = await send('Page.captureScreenshot', { format: 'png' });
		fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
	};
	return { ws, send, evaluate, key, click, shot };
}

async function s1(dir) {
	const commands = await waitLog(dir, 's1-commands', 240);
	const wb = await workbench();
	await sleep(1500);
	const dom = await wb.evaluate(`(() => {
		const isVisible = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none';
		const part = (name) => {
			const p = document.querySelector('.part.' + name);
			if (!p) { return null; }
			const r = p.getBoundingClientRect();
			const texts = [...p.querySelectorAll('[aria-label], .title-label, .composite-title, h2, h3')]
				.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim())
				.filter((t) => /shotgun|panel a|panel b/i.test(t));
			return { isVisible: isVisible(p), box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, texts: [...new Set(texts)] };
		};
		return { auxiliarybar: part('auxiliarybar'), sidebar: part('sidebar'), activitybar: part('activitybar'), panel: part('panel') };
	})()`);
	await wb.shot(path.join(dir, 's1.png'));
	wb.ws.close();
	fs.writeFileSync(path.join(dir, 'trigger-s1-done'), '');
	print({ commands: commands.opened, resolved: readLog(dir).filter((e) => e.kind === 's1-resolved').map((e) => e.id), dom });
}

//-------------------
// S5: the holes of a frame

const HOLE = /\/\*@hole (\d+)(?::[^*]*)?\*\//g;
const holeTexts = (text) => [...text.matchAll(HOLE)].map((m) => m[0].replace(/\s+/g, ' '));

async function s5(dir) {
	await waitLog(dir, 's5-ready-keys', 120);
	const wb = await workbench();
	await sleep(1000);
	// a click on line 1 gives the focus to the text editor. Line 1 has no hole
	const line1 = await wb.evaluate(`(() => {
		const ed = [...document.querySelectorAll('.part.editor .monaco-editor')].find((e) => e.getBoundingClientRect().width > 200);
		const lines = [...ed.querySelectorAll('.view-line')].map((l) => l.getBoundingClientRect()).sort((a, b) => a.top - b.top);
		return { x: lines[0].left + 20, y: lines[0].top + lines[0].height / 2 };
	})()`);
	await wb.click(line1.x, line1.y);
	await sleep(500);
	for (const [label, modifiers] of [['tab', 0], ['tab', 0], ['tab', 0], ['shift+tab', 8]]) {
		await wb.key('Tab', 'Tab', 9, modifiers);
		await sleep(400);
		void label;
	}
	await sleep(500);
	await wb.shot(path.join(dir, 's5.png'));
	wb.ws.close();
	fs.writeFileSync(path.join(dir, 'trigger-s5-done'), '');
	const after = await waitLog(dir, 's5-text-after-keys', 30);
	const moves = readLog(dir).filter((e) => e.kind === 's5-move');

	// clang-format: the markers must stay complete and in the same sequence
	const frame = fs.readFileSync(path.join(paths(dir).project, 'src', 'frame_spike.cpp'), 'utf8');
	const styles = {
		llvm: 'LLVM',
		google: 'Google',
		narrow: '{BasedOnStyle: LLVM, ColumnLimit: 40}',
		dataflow: `file:${path.join(DATAFLOW, '.clang-format')}`,
	};
	const formats = {};
	for (const [name, style] of Object.entries(styles)) {
		const res = spawnSync(CLANG_FORMAT, [`--style=${style}`, '--assume-filename=frame_spike.cpp'], { input: frame, encoding: 'utf8', windowsHide: true });
		const out = res.stdout ?? '';
		fs.writeFileSync(path.join(dir, `s5-${name}.cpp`), out);
		formats[name] = {
			status: res.status, error: (res.stderr || '').trim() || undefined,
			holesBefore: holeTexts(frame), holesAfter: holeTexts(out),
			isSame: JSON.stringify(holeTexts(frame)) === JSON.stringify(holeTexts(out)),
		};
	}
	print({ moves: moves.map((m) => ({ phase: m.phase, step: m.step, hole: m.hole, error: m.error })), after, formats });
}

//-------------------
// Claude Code

// The spike plugin of the run, with the path of the runtime for the command hook. This hook is alternative B of S4
function shotgunPlugin(dir) {
	const target = path.join(dir, 'shotgun-plugin');
	fs.rmSync(target, { recursive: true, force: true });
	fs.cpSync(SPIKE_PLUGIN, target, { recursive: true });
	const manifest = path.join(target, '.claude-plugin', 'plugin.json');
	fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replaceAll('__RUNTIME__', codeExe().split(path.sep).join('/')));
	return target;
}

// The spike plugin in a local marketplace for the plugin test. The project settings declare the marketplace, and the
// local settings of the project turn the plugin on. SPIKE_SETTINGS can declare the marketplace in their place
function localPlugin(dir) {
	const market = path.join(dir, 'market');
	fs.rmSync(market, { recursive: true, force: true });
	fs.cpSync(shotgunPlugin(dir), path.join(market, 'plugins', 'shotgun-spike'), { recursive: true });
	fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true });
	fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({
		name: 'shotgun-spike-market', owner: { name: 'Shotgun spike' },
		plugins: [{ name: 'shotgun-spike', source: './plugins/shotgun-spike', description: 'The spike plugin of Shotgun.' }],
	}, null, 2));
	const settings = path.join(paths(dir).project, '.claude');
	fs.mkdirSync(settings, { recursive: true });
	fs.writeFileSync(path.join(settings, 'settings.json'), JSON.stringify({
		extraKnownMarketplaces: { 'shotgun-spike-market': { source: { source: 'directory', path: market } } },
	}, null, 2));
	fs.writeFileSync(path.join(settings, 'settings.local.json'), JSON.stringify({
		enabledPlugins: { 'shotgun-spike@shotgun-spike-market': true },
	}, null, 2));
}

function claudeArgs(dir, { strict = false, local = false } = {}) {
	if (local) {
		localPlugin(dir);
	}
	const args = [
		'--output-format', 'stream-json', '--verbose', '--include-hook-events',
		'--model', 'sonnet',
		// SPIKE_SETTING_SOURCES and SPIKE_SETTINGS change the settings for the variants of the probe
		'--setting-sources', process.env.SPIKE_SETTING_SOURCES ?? (local ? 'project,local' : 'project'),
		...(process.env.SPIKE_SETTINGS ? ['--settings', process.env.SPIKE_SETTINGS] : []),
		'--plugin-dir', paths(dir).dataflowPlugin, ...(local ? [] : ['--plugin-dir', shotgunPlugin(dir)]),
		'--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
		'--allowedTools', 'Skill,mcp__plugin_dataflow_dataflow__shotgun_get_session',
		'--max-turns', '8', '--no-session-persistence',
	];
	if (strict) {
		args.push('--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }));
	}
	return args;
}

function killTree(pid) {
	try {
		execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} catch {
		// the process is closed
	}
}

// Runs Claude Code in print mode. stopAt: a function that stops the run at a message of the stream
function runClaude(dir, prompt, { strict = false, local = false, stopAt, timeoutMs = 300000, file } = {}) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const proc = spawn(claudeExe(), ['-p', prompt, ...claudeArgs(dir, { strict, local })], {
			// no connectors of the claude.ai account in the spike sessions
			cwd: paths(dir).project, env: cleanEnv({ ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
		});
		const messages = [];
		let rest = '';
		let stderr = '';
		let isStopped = false;
		const stop = () => {
			if (!isStopped) {
				isStopped = true;
				killTree(proc.pid);
			}
		};
		const timer = setTimeout(stop, timeoutMs);
		proc.stdout.on('data', (chunk) => {
			rest += chunk.toString('utf8');
			const lines = rest.split('\n');
			rest = lines.pop();
			for (const line of lines.filter((l) => l.trim())) {
				try {
					const m = JSON.parse(line);
					m.atMs = Math.round(performance.now() - t0);
					messages.push(m);
					if (stopAt && stopAt(m)) {
						stop();
					}
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
			if (file) {
				fs.writeFileSync(file, messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
				fs.writeFileSync(file.replace(/\.jsonl$/, '.err.txt'), stderr);
			}
			resolve({ code, isStopped, ms: Math.round(performance.now() - t0), messages, stderr });
		});
	});
}

function summarizeInit(m) {
	if (!m) {
		return undefined;
	}
	return {
		model: m.model, permissionMode: m.permissionMode, apiKeySource: m.apiKeySource,
		mcpServers: m.mcp_servers,
		mcpTools: (m.tools || []).filter((t) => t.startsWith('mcp__')),
		plugins: m.plugins,
		skills: (m.skills || []).filter((s) => /shotgun/i.test(typeof s === 'string' ? s : JSON.stringify(s))),
		slashCommands: (m.slash_commands || []).filter((s) => /shotgun/i.test(s)),
	};
}

const short = (value, max = 400) => {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	return text && text.length > max ? `${text.slice(0, max)}...` : text;
};

function summarizeRun(run) {
	const events = [];
	for (const m of run.messages) {
		if (m.type === 'system' && m.subtype === 'init') {
			continue;
		}
		if (m.type === 'system') {
			events.push({ at: m.atMs, system: m.subtype, hook: m.hook_name ?? m.hook_event, data: short(m.output ?? m.stdout ?? m.response ?? m.error ?? m.outcome ?? m) });
		} else if (m.type === 'assistant') {
			for (const block of m.message?.content ?? []) {
				if (block.type === 'tool_use') {
					events.push({ at: m.atMs, toolUse: block.name, input: short(block.input, 300) });
				} else if (block.type === 'text') {
					events.push({ at: m.atMs, text: short(block.text, 300) });
				}
			}
		} else if (m.type === 'user') {
			for (const block of Array.isArray(m.message?.content) ? m.message.content : []) {
				if (block.type === 'tool_result') {
					events.push({ at: m.atMs, toolResult: short(block.content, 300), isError: block.is_error === true });
				}
			}
		} else if (m.type === 'result') {
			events.push({ at: m.atMs, result: m.subtype, text: short(m.result, 600), turns: m.num_turns, costUsd: m.total_cost_usd, isError: m.is_error });
		}
	}
	return {
		code: run.code, isStopped: run.isStopped, ms: run.ms,
		init: summarizeInit(run.messages.find((m) => m.type === 'system' && m.subtype === 'init')),
		events, stderr: short(run.stderr.trim(), 800),
	};
}

async function probe(dir, mode) {
	const run = await runClaude(dir, 'Reply with the word OK.', {
		strict: mode === 'strict', local: mode === 'local', timeoutMs: 120000, file: path.join(dir, `probe${mode ? `-${mode}` : ''}.jsonl`),
		stopAt: (m) => m.type === 'system' && m.subtype === 'init',
	});
	print(summarizeRun(run));
}

async function claude(dir, name, prompt) {
	const run = await runClaude(dir, prompt, { file: path.join(dir, `claude-${name}.jsonl`) });
	print(summarizeRun(run));
}

//-------------------
// The time of a call of the guard through the bridge, as Claude Code calls it

async function latency(dir, count) {
	const p = paths(dir);
	const plugin = JSON.parse(fs.readFileSync(path.join(p.dataflowPlugin, '.claude-plugin', 'plugin.json'), 'utf8'));
	const server = plugin.mcpServers.dataflow;
	const t0 = performance.now();
	const proc = spawn(server.command, server.args, {
		cwd: p.project, env: cleanEnv(server.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
	});
	let rest = '';
	let nextId = 0;
	const pending = new Map();
	proc.stdout.on('data', (chunk) => {
		rest += chunk.toString('utf8');
		const lines = rest.split('\n');
		rest = lines.pop();
		for (const line of lines.filter((l) => l.trim())) {
			const m = JSON.parse(line);
			if (m.id !== undefined && pending.has(m.id)) {
				pending.get(m.id)(m);
				pending.delete(m.id);
			}
		}
	});
	let stderr = '';
	proc.stderr.on('data', (chunk) => {
		stderr += chunk.toString('utf8');
	});
	const request = (method, params) => new Promise((resolve) => {
		const id = ++nextId;
		pending.set(id, resolve);
		proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
	});
	const timed = async (method, params) => {
		const t = performance.now();
		const response = await request(method, params);
		return { ms: performance.now() - t, response };
	};
	const result = {};
	try {
		const init = await timed('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'shotgun-spike', version: '0.0.1' } });
		result.initializeMs = Math.round(init.ms);
		result.startToInitializeMs = Math.round(performance.now() - t0);
		proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		const list = await timed('tools/list', {});
		result.listMs = Math.round(list.ms);
		result.shotgunTools = (list.response.result?.tools ?? []).map((t) => t.name).filter((n) => n.startsWith('shotgun_'));
		const stats = (values) => {
			const sorted = [...values].sort((a, b) => a - b);
			const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
			return { count: sorted.length, min: +sorted[0].toFixed(1), median: +at(0.5).toFixed(1), p90: +at(0.9).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1) };
		};
		for (const [label, file] of [['deny', path.join(p.project, 'outside.txt')], ['allow', path.join(p.project, 'notes', 'inside.txt')]]) {
			const times = [];
			let last;
			for (let i = 0; i < count; i++) {
				const call = await timed('tools/call', { name: 'shotgun_guard', arguments: { tool: 'Edit', file, cwd: p.project } });
				times.push(call.ms);
				last = call.response;
			}
			result[label] = { ...stats(times), lastResult: short(last.result ?? last.error, 500) };
		}
	} finally {
		killTree(proc.pid);
	}
	result.stderr = short(stderr.trim(), 500);
	print(result);
}

//-------------------
// The end of the run

async function receipt(dir) {
	fs.writeFileSync(path.join(dir, 'trigger-s2'), '');
	const hit = await waitLog(dir, 'done', 60);
	print({ receipt: readLog(dir).filter((e) => e.kind.startsWith('s2-receipt')), done: hit.time });
}

// The processes with the run folder in their command line, for example the bridge or the engine
function processesOf(dir) {
	// the query itself has the run folder in its command line, so the filter removes it
	const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir.replace(/'/g, "''")}') `
		+ "-and -not $_.CommandLine.Contains('Get-CimInstance') } | "
		+ 'ForEach-Object { "$($_.ProcessId)`t$($_.Name)" }';
	const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
	return out.split(/\r?\n/).filter(Boolean).map((l) => {
		const [pid, name] = l.split('\t');
		return { pid: Number(pid), name };
	}).filter((x) => x.pid !== process.pid);
}

async function stopRun(dir) {
	const p = paths(dir);
	const killed = [];
	if (fs.existsSync(p.pid)) {
		const pid = Number(fs.readFileSync(p.pid, 'utf8'));
		killTree(pid);
		killed.push(pid);
	}
	await sleep(2000);
	for (const x of processesOf(dir)) {
		killTree(x.pid);
		killed.push(`${x.pid} ${x.name}`);
	}
	await sleep(1000);
	print({ killed, left: processesOf(dir) });
}

function showLog(dir, kind) {
	for (const e of readLog(dir).filter((x) => !kind || x.kind === kind)) {
		console.log(short(e, 2000));
	}
}

//-------------------

const [command, dirArg, ...rest] = process.argv.slice(2);
if (!command || !dirArg) {
	console.error('Usage: node spikes/run.mjs <subcommand> <run folder> [arguments]');
	process.exit(2);
}
const dir = path.resolve(dirArg);
fs.mkdirSync(dir, { recursive: true });
const commands = {
	setup: () => setup(dir),
	start: () => start(dir),
	s1: () => s1(dir),
	s5: () => s5(dir),
	wait: async () => print(await waitLog(dir, rest[0], Number(rest[1] ?? 300))),
	probe: () => probe(dir, rest[0]),
	claude: () => claude(dir, rest[0], rest.slice(1).join(' ')),
	latency: () => latency(dir, Number(rest[0] ?? 20)),
	receipt: () => receipt(dir),
	stop: () => stopRun(dir),
	log: () => showLog(dir, rest[0]),
};
if (!commands[command]) {
	console.error(`No subcommand ${command}.`);
	process.exit(2);
}
try {
	await commands[command]();
} catch (error) {
	console.error(String(error?.stack ?? error));
	process.exitCode = 1;
}
