// The spikes of phase 0 of Shotgun, in the test build of VS Code. The extension writes each result as 1 JSON line into
// the file of the environment variable SPIKE_LOG. spikes/run.mjs starts the test build, and gives the extension each
// next step with a file in the folder of SPIKE_ROOT. This extension is not a part of Shotgun.
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const logFile = process.env.SPIKE_LOG;
const root = process.env.SPIKE_ROOT;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(kind, data = {}) {
	if (logFile) {
		fs.appendFileSync(logFile, `${JSON.stringify({ time: Date.now(), kind, ...data })}\n`);
	}
}

// Waits for a file of the runner, for example trigger-s1-done. False after the time
async function waitFile(name, timeoutMs) {
	const file = path.join(root, name);
	for (let waited = 0; waited < timeoutMs; waited += 300) {
		if (fs.existsSync(file)) {
			return true;
		}
		await sleep(300);
	}
	return false;
}

// The marker of a hole in a frame: /*@hole N: question */, or the short form /*@hole N*/
const HOLE = /\/\*@hole (\d+)(?::[^*]*)?\*\//g;

function holesOf(doc) {
	return [...doc.getText().matchAll(HOLE)].map((m) => ({
		n: Number(m[1]), start: doc.positionAt(m.index), end: doc.positionAt(m.index + m[0].length),
	}));
}

// The frame of S5. The runner formats this file with clang-format
const FRAME = [
	'// A frame of Claude with 3 holes for the decisions of the user',
	'int next_state(int cycles, int limit, bool converged) {',
	'    if (/*@hole 1: when is the plan too late? */) {',
	'        /*@hole 2: what happens to the solver? */',
	'        return 0;',
	'    }',
	'    /*@hole 3: what does the controller do next? */',
	'    return converged ? 1 : 2;',
	'}',
	'',
].join('\n');

// A path in a folder: case-insensitive, as on Windows
function isIn(file, folder) {
	const rel = path.relative(folder.toLowerCase(), file.toLowerCase());
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function summarizeDiff(diff) {
	return {
		base: diff.base, note: diff.note, notice: diff.notice, callGraph: diff.callGraph, noHeat: diff.noHeat,
		files: (diff.files || []).map((f) => ({
			file: f.file, isNew: f.isNew, isCpp: f.isCpp,
			hunks: (f.hunks || []).map((h) => ({ id: h.id, lines: h.lines, added: h.added, removed: h.removed, functions: h.functions, heat: h.heat })),
		})),
		hottest: (diff.hottestChanges || []).map((c) => ({ function: c.function, score: c.score, band: c.band, isReachComplete: c.isReachComplete })),
	};
}

function waitEngine(api, timeoutMs) {
	if (api.engineState === 'ready') {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		let sub;
		const timer = setTimeout(() => {
			sub.dispose();
			resolve(api.engineState === 'ready');
		}, timeoutMs);
		sub = api.onDidChangeEngineState((e) => {
			if (e.state === 'ready' || e.state === 'failed') {
				clearTimeout(timer);
				sub.dispose();
				resolve(e.state === 'ready');
			}
		});
	});
}

async function waitCallGraph(api, timeoutMs) {
	for (let waited = 0; waited < timeoutMs; waited += 1000) {
		const graph = await api.getCallGraph().catch(() => undefined);
		if (graph && (graph.state === 'ready' || graph.state === 'failed')) {
			log('call-graph', { state: graph.state, frames: graph.lastScan && graph.lastScan.frames, error: graph.error });
			return graph.state === 'ready';
		}
		await sleep(1000);
	}
	log('call-graph', { state: 'timeout' });
	return false;
}

const state = { phase: 'commands' };

exports.activate = async (context) => {
	log('activate');
	const project = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;

	// S1: a webview view in the secondary side bar (A) and in the activity bar (B)
	for (const id of ['shotgunSpike.panelA', 'shotgunSpike.panelB']) {
		context.subscriptions.push(vscode.window.registerWebviewViewProvider(id, {
			resolveWebviewView(view) {
				view.webview.html = `<!doctype html><html><body><h3>${id}</h3><p>Panel of the Shotgun spike</p></body></html>`;
				log('s1-resolved', { id });
			},
		}));
	}

	// S5: the decorations and the commands of the holes
	const holeStyle = vscode.window.createTextEditorDecorationType({
		border: '1px dashed #f2b544', backgroundColor: 'rgba(242,181,68,0.12)', borderRadius: '3px',
	});
	context.subscriptions.push(holeStyle);
	const decorate = (editor) => {
		if (!editor) {
			return;
		}
		const holes = holesOf(editor.document);
		editor.setDecorations(holeStyle, holes.map((h) => new vscode.Range(h.start, h.end)));
		void vscode.commands.executeCommand('setContext', 'shotgunSpike.inFrame', holes.length > 0);
	};
	const move = (step) => {
		const editor = vscode.window.activeTextEditor;
		const holes = editor ? holesOf(editor.document) : [];
		if (!editor || holes.length === 0) {
			log('s5-move', { phase: state.phase, step, error: editor ? 'no hole' : 'no editor' });
			return;
		}
		const target = step > 0
			? holes.find((h) => h.start.isAfter(editor.selection.active)) || holes[0]
			: [...holes].reverse().find((h) => h.start.isBefore(editor.selection.start)) || holes[holes.length - 1];
		editor.selection = new vscode.Selection(target.start, target.end);
		editor.revealRange(new vscode.Range(target.start, target.end));
		log('s5-move', { phase: state.phase, step, hole: target.n });
	};
	context.subscriptions.push(
		vscode.commands.registerCommand('shotgunSpike.nextHole', () => move(1)),
		vscode.commands.registerCommand('shotgunSpike.previousHole', () => move(-1)),
		vscode.window.onDidChangeActiveTextEditor(decorate),
		vscode.workspace.onDidChangeTextDocument((e) => decorate(vscode.window.visibleTextEditors.find((x) => x.document === e.document))),
	);

	if (!project || !root) {
		log('error', { message: 'No workspace folder, or no SPIKE_ROOT.' });
		return;
	}
	// activate must return at once: VS Code shows a view of the extension only after activate returns
	void run(context, project, decorate).catch((error) => log('error', { message: String((error && error.stack) || error) }));
};

async function run(context, project, decorate) {
	// DataFlow from its repository, with the fixes of the gap lists
	const dataflow = vscode.extensions.getExtension('KnurrliDev.dataflow');
	if (!dataflow) {
		log('error', { message: 'DataFlow is not there.' });
		return;
	}
	const api = (await dataflow.activate()).getApi(1, { client: 'Shotgun' });
	log('dataflow', {
		version: dataflow.packageJSON.version, engineState: api.engineState,
		methods: ['registerTools', 'registerTab', 'markBase', 'getPlace', 'getCallers', 'getCallGraph', 'getMemberSites', 'onDidParse']
			.filter((m) => api[m] !== undefined),
	});

	// S2, S3 and S4: the tools for the hooks and for the skill. The scope of the guard is the folder notes
	const scope = path.join(project, 'notes');
	context.subscriptions.push(api.registerTools([
		{
			name: 'guard',
			title: 'Guard of the spike',
			description: 'The PreToolUse hook of the spike plugin calls this tool before each file change. Do not call it yourself.',
			inputSchema: { type: 'object', properties: { tool: { type: 'string' }, file: { type: 'string' }, cwd: { type: 'string' } } },
			isReadOnly: true,
			call: (args) => {
				const file = path.resolve(String(args.file || ''));
				const deny = isIn(file, project) && !isIn(file, scope);
				log('guard', { args, decision: deny ? 'deny' : 'none' });
				return JSON.stringify(deny ? {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse',
						permissionDecision: 'deny',
						permissionDecisionReason: `Shotgun spike: ${path.relative(project, file)} is outside of the scope notes. Change only files in notes.`,
					},
				} : {});
			},
		},
		{
			name: 'session_context',
			title: 'Session context of the spike',
			description: 'A hook of the spike plugin calls this tool. Do not call it yourself.',
			inputSchema: { type: 'object', properties: { event: { type: 'string' }, cwd: { type: 'string' } } },
			isReadOnly: true,
			call: (args) => {
				log('session_context', { args });
				// the hook gives the name of its event, and the output of the tool repeats it
				const event = typeof args.event === 'string' && args.event ? args.event : 'SessionStart';
				return JSON.stringify({
					hookSpecificOutput: {
						hookEventName: event,
						additionalContext: `Shotgun (from the ${event} mcp_tool hook): the active task is SPIKE-42. Its stage is 2, the survey.`,
					},
				});
			},
		},
		{
			name: 'get_session',
			title: 'Session of the spike',
			description: 'Gives the active Shotgun task, its stage and a marker. Call it first for each request about Shotgun.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => {
				log('get_session');
				return { task: 'SPIKE-42', stage: 'survey', marker: 'S3-TOOL-OK' };
			},
		},
	]));
	log('tools');

	// The connection to Claude Code. The registry and the settings of Claude Code are in the folder of the run
	await vscode.commands.executeCommand('dataflow.claude.connect');
	log('connected', { registry: process.env.DATAFLOW_MCP_REGISTRY });

	// S1: open the 2 view containers
	const opened = {};
	for (const id of ['shotgunSpikeA', 'shotgunSpikeB']) {
		try {
			await vscode.commands.executeCommand(`workbench.view.extension.${id}`);
			opened[id] = 'ok';
		} catch (error) {
			opened[id] = String((error && error.message) || error);
		}
		await sleep(1500);
	}
	log('s1-commands', { opened });
	await waitFile('trigger-s1-done', 120000);

	// S5: a frame with 3 holes, first with the commands, then with the keys of the runner
	const frameFile = path.join(project, 'src', 'frame_spike.cpp');
	fs.writeFileSync(frameFile, FRAME);
	const doc = await vscode.workspace.openTextDocument(frameFile);
	const editor = await vscode.window.showTextDocument(doc, { preview: false });
	decorate(editor);
	await sleep(500);
	state.phase = 'commands';
	editor.selection = new vscode.Selection(0, 0, 0, 0);
	for (const command of ['shotgunSpike.nextHole', 'shotgunSpike.nextHole', 'shotgunSpike.nextHole', 'shotgunSpike.previousHole']) {
		await vscode.commands.executeCommand(command);
	}
	editor.selection = new vscode.Selection(0, 0, 0, 0);
	state.phase = 'keys';
	await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
	log('s5-ready-keys', { holes: holesOf(doc).length });
	await waitFile('trigger-s5-done', 120000);
	log('s5-text-after-keys', { isChanged: doc.getText() !== FRAME, holes: holesOf(doc).length });

	// S6: a receipt from a base. The extension writes a change on the disk, as Claude Code does
	await vscode.window.showTextDocument(vscode.Uri.file(path.join(project, 'src', 'battery.cpp')), { preview: false });
	log('engine', { ready: await waitEngine(api, 120000), state: api.engineState, error: api.engineError });
	try {
		await api.scanCallGraph();
	} catch (error) {
		log('scan-error', { message: String((error && error.message) || error) });
	}
	await waitCallGraph(api, 180000);
	const s6 = {};
	try {
		s6.mark = await api.markBase({ name: 's6', paths: ['src'] });
		const file = path.join(project, 'src', 'battery.cpp');
		const before = fs.readFileSync(file, 'utf8');
		fs.writeFileSync(file, before.replace(/\n(\s+)return /, '\n$1// spike: a line of Claude\n$1return '));
		await sleep(2500);
		s6.diff = summarizeDiff(await api.getDiff({ base: 'mark:s6', allFiles: true }));
		fs.writeFileSync(file, before);
		s6.deleted = await api.deleteMark({ name: 's6' });
	} catch (error) {
		s6.error = String((error && error.message) || error);
	}
	log('s6', s6);

	// S2: the base before the runs of Claude Code, and the receipt after them
	try {
		log('s2-mark', { mark: await api.markBase({ name: 's2', paths: ['notes', 'outside.txt'] }) });
	} catch (error) {
		log('s2-mark-error', { message: String((error && error.message) || error) });
	}
	log('ready-for-claude');
	await waitFile('trigger-s2', 30 * 60000);
	try {
		log('s2-receipt', { diff: summarizeDiff(await api.getDiff({ base: 'mark:s2', allFiles: true })) });
	} catch (error) {
		log('s2-receipt-error', { message: String((error && error.message) || error) });
	}
	log('done');
}

exports.deactivate = () => undefined;
