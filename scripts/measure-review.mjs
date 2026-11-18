// The measurement of the review skill shotgun-review (P36). The script starts the test build of VS Code with DataFlow and
// Shotgun, as test-claude.mjs does, and connects them to Claude Code. Then, for each case of review-cases.mjs, each effort
// and each run, it:
// 1. Resets the copy of the fixture battery to its base commit, and applies the change of the case.
// 2. Makes a task in stage 6 with the brief of the case, the base commit, the effort and the default focus. The task goes
//    into the folder .shotgun of the project, and becomes the active task.
// 3. Runs the review prompt in a new run of the CLI of Claude Code, as the user does after "Copy the review prompt".
// 4. Reads the issues of review.json, and compares them with the known bug of the case.
// An issue finds the bug if its place or a fix place is near the line of the bug. The results give the recall and the
// precision of each effort, and the issues of the clean cases. They also give the cost: the time, the subagents, the
// turns and the cost in USD that the CLI reports. The results of an LLM change from run to run, so each configuration
// runs more than 1 time.
// The settings of the user do not change. The test build has its own user data, MCP registry, folder for the settings of
// Claude Code and Shotgun folder. The script removes the folder of the project of the run in the data of Claude Code.
// The script uses the Claude subscription of the user for each run, so it runs only on request.
// Usage: node scripts/measure-review.mjs <run folder> [--efforts low,medium,high] [--runs 3] [--cases B1,C1] [--model sonnet]
// With a run folder that has results.jsonl, the script continues with the runs that are not done. With --report, it only
// writes the summary of results.jsonl again.
// Environment: DATAFLOW_REPO (default: ../DataFlow), CLAUDE_EXE (default: the CLI of the VS Code extension of Claude Code)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
	callBridgeTool, checkBridge, cleanEnv, cleanUserData, codeExe, command, killTree, poll, readJson, runClaude, sleep, stopProcessesOf, userState, waitFor,
	workbench,
} from './harness.mjs';
import { CASES } from './review-cases.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const DATAFLOW = path.resolve(process.env.DATAFLOW_REPO ?? path.join(repo, '..', 'DataFlow'));
// the ports of the test build. They are different from the ports of test-claude.mjs
const PORT = 9371;
const MCP_PORT = 47392;
const SHOTGUN_TOOLS = 21;
const require = createRequire(import.meta.url);
const { SessionStore } = require(path.join(repo, 'out', 'session', 'store.js'));
const { AREA_INFO, areaOf, DEFAULT_AREAS, reviewPrompt } = require(path.join(repo, 'out', 'session', 'review.js'));

// The tools of a review run, as in step 12 of test-claude.mjs
const DF = 'mcp__plugin_dataflow_dataflow__';
const REVIEW_TOOLS = [
	`${DF}shotgun_get_session`, `${DF}shotgun_get_review`, `${DF}shotgun_submit_review`, 'Skill', 'Agent', 'Task', 'Read', 'Grep', 'Glob',
	...['list_functions', 'get_outline', 'get_place', 'get_callers', 'get_calls', 'get_threads', 'get_heat', 'get_flow', 'get_logic', 'get_hidden',
		'get_member_sites', 'get_includes', 'get_diff', 'get_ripple'].map((t) => `${DF}${t}`),
];

//-------------------
// The arguments and the run folder

const { values: options, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		efforts: { type: 'string', default: 'low,medium,high' },
		runs: { type: 'string', default: '3' },
		cases: { type: 'string', default: '' },
		model: { type: 'string', default: 'sonnet' },
		report: { type: 'boolean', default: false },
	},
});
if (positionals.length !== 1) {
	console.error('Usage: node scripts/measure-review.mjs <run folder> [--efforts low,medium,high] [--runs 3] [--cases B1,C1] [--model sonnet] [--report]');
	process.exit(2);
}
const efforts = options.efforts.split(',').map((e) => e.trim()).filter(Boolean);
const runs = Number(options.runs);
const cases = options.cases ? CASES.filter((c) => options.cases.split(',').includes(c.id)) : CASES;
if (!efforts.every((e) => ['low', 'medium', 'high', 'xhigh', 'max'].includes(e)) || !Number.isInteger(runs) || runs < 1 || cases.length === 0) {
	console.error('Give the efforts low, medium, high, xhigh or max, a number of runs from 1, and the ids of cases of review-cases.mjs.');
	process.exit(2);
}
const dir = path.resolve(positionals[0]);
const resultsFile = path.join(dir, 'results.jsonl');
const isResume = fs.existsSync(resultsFile);
if (!isResume && fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
	console.error(`The folder ${dir} is not empty, and it has no results.jsonl. Use a new run folder.`);
	process.exit(2);
}
const p = {
	project: path.join(dir, 'project'),
	registry: path.join(dir, 'registry'),
	claudeConfig: path.join(dir, 'claude-config'),
	shotgunHome: path.join(dir, 'shotgun-home'),
	userData: path.join(dir, 'user-data'),
	stage: path.join(dir, 'stage'), // a folder for the store of the script: it makes each task before it goes into the project
	logs: path.join(dir, 'logs'),
};
const userSettings = path.join(p.claudeConfig, 'settings.json');
const dataflowPlugin = path.join(p.registry, 'claude', 'plugins', 'dataflow');
const shotgunPlugin = path.join(p.shotgunHome, 'claude', 'plugins', 'shotgun');
const bridge = { pluginDir: dataflowPlugin, cwd: p.project };
const git = (...args) => execFileSync('git', ['-c', 'user.name=Shotgun test', '-c', 'user.email=test@example.invalid', ...args],
	{ cwd: p.project, encoding: 'utf8', windowsHide: true });

// A copy of the fixture battery of DataFlow with git and a compile database, as in test-claude.mjs. Git ignores the
// folders of Shotgun and of the local settings of Claude Code
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
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-q', '-m', 'Add the battery fixture for the measurement');
	fs.appendFileSync(path.join(p.project, '.git', 'info', 'exclude'), '\n.shotgun/\n.claude/\n');
	const user = path.join(p.userData, 'User');
	fs.mkdirSync(user, { recursive: true });
	fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
		'dataflow.mcp.enabled': true,
		'dataflow.mcp.port': MCP_PORT,
		'dataflow.engine.maxThreads': 8,
		'workbench.startupEditor': 'none',
		'chat.disableAIFeatures': true,
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
// The cases

// The project at its base commit, with no change of an earlier case
function resetProject() {
	git('checkout', '-q', '--', '.');
	git('clean', '-q', '-fd');
}

// Applies the edits of a case. A file keeps its line ends
function applyCase(c) {
	for (const e of c.edits) {
		const file = path.join(p.project, e.file);
		const old = fs.readFileSync(file, 'utf8');
		const isCrlf = old.includes('\r\n');
		const text = old.replace(/\r\n/g, '\n');
		if (text.split(e.find).length !== 2) {
			throw new Error(`${c.id}: the text to replace is not in ${e.file} exactly 1 time.`);
		}
		const next = text.replace(e.find, e.replace);
		fs.writeFileSync(file, isCrlf ? next.replace(/\n/g, '\r\n') : next);
	}
}

// The line of each place of the bug in the file after the change
function bugLines(c) {
	return (c.bug?.places ?? []).map((pl) => {
		const lines = fs.readFileSync(path.join(p.project, pl.file), 'utf8').split(/\r?\n/);
		const n = lines.findIndex((l) => l.includes(pl.code));
		if (n < 0) {
			throw new Error(`${c.id}: the place of the bug "${pl.code}" is not in ${pl.file}.`);
		}
		return { file: pl.file, line: n + 1 };
	});
}

// A task in stage 6 for the case, as a user makes it. It has the brief, and a plan with 1 step of the user that changed
// the files of the case. It also has the base commit, the gate "The build is done", and the effort with the default
// focus. The store of the script makes the task in its own folder, so the extension sees only the task in stage 6. The
// result: the id and the title of the task
function makeTask(c, effort, n, base) {
	fs.rmSync(p.stage, { recursive: true, force: true });
	fs.mkdirSync(p.stage, { recursive: true });
	const store = new SessionStore(p.stage);
	store.load();
	// the number of the run makes the title different in each run, with no hint of the case or of the effort
	const title = `${c.title} ${n}`;
	store.newTask(title);
	const id = store.snapshot.task.id;
	fs.writeFileSync(store.briefFile(), c.briefText.replace(`# Brief: ${c.title}`, `# Brief: ${title}`));
	store.passGate('brief-ready');
	store.passGate('order-tasks');
	store.passGate('accept-order');
	const files = [...new Set(c.edits.map((e) => e.file))];
	store.writePlan({
		steps: [{
			id: 'S1', title: c.title, task: 'T1', hooks: [], places: files.map((f) => ({ file: f, lines: [1, 1] })), text: c.brief.goal,
			checks: c.brief.doneWhen, decisions: [],
		}],
	});
	store.acceptPlan({ commit: base, dirty: [] });
	store.startStep('S1', { writer: 'user', level: null, scope: files });
	store.finishStep('S1', 'step-done');
	store.passGate('build-done');
	store.setReviewOptions({ effort, areas: [...DEFAULT_AREAS] });
	const target = path.join(p.project, '.shotgun', id);
	fs.rmSync(target, { recursive: true, force: true });
	fs.cpSync(path.join(p.stage, '.shotgun', id), target, { recursive: true });
	fs.writeFileSync(path.join(p.project, '.shotgun', 'active.json'), JSON.stringify({ version: 1, task: id, isPaused: false }, null, 2));
	return { id, title };
}

// The score of the issues of a run against the bug of the case. margin: the lines before and after the bug
function score(c, issues, lines) {
	const margin = c.bug?.margin ?? 3;
	const isMatch = (issue) => [issue.place, ...(issue.fixPlaces ?? [])].some((pl) => lines.some((b) => b.file === pl.file
		&& pl.lines[0] - margin <= b.line && b.line <= pl.lines[1] + margin));
	const rows = issues.map((i) => ({
		id: i.id, list: i.list, category: i.category, area: areaOf(i.category), severity: i.severity, verdict: i.verdict, origin: i.origin, source: i.source,
		place: `${i.place.file}:${i.place.lines[0]}`, title: i.title, isMatch: c.kind === 'bug' && isMatch(i),
	}));
	const matched = rows.filter((r) => r.isMatch);
	return {
		issues: rows,
		foundSteps: matched.some((r) => r.list === 'steps'),
		foundAny: matched.length > 0,
		isAreaRight: matched.some((r) => c.bug.areas.includes(r.area)),
	};
}

//-------------------
// The results

const readResults = () => (fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pct = (a, b) => (b === 0 ? '-' : `${Math.round((100 * a) / b)}%`);
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// The kind of an issue of a run. bug: the issue found the bug of the case. test: a condition of done of the brief with no
// test. Each brief of the cases asks for a test, and no change has a test. Thus the area Tests can find this gap
// correctly. pre-existing: a problem in the code before the change. other: each other issue. It is a false alarm, or a
// real problem that the case did not plan. Only bug and other count for the precision
const kindOf = (issue) => (issue.isMatch ? 'bug' : issue.category === 'test' ? 'test' : issue.origin === 'pre-existing' ? 'pre-existing' : 'other');

// The summary of the results for each effort, and the cases that each effort found, as Markdown and as data
function summarize(results) {
	const rows = [];
	const data = {};
	for (const effort of efforts) {
		const of = results.filter((r) => r.effort === effort);
		const ok = of.filter((r) => !r.error);
		const bugs = ok.filter((r) => r.kind === 'bug');
		const clean = ok.filter((r) => r.kind === 'clean');
		// the issues of the runs with their kind, in the list of steps and in both lists
		const all = ok.flatMap((r) => (r.issues ?? []).map((i) => ({ ...i, kind: kindOf(i) })));
		const steps = all.filter((i) => i.list === 'steps');
		const count = (list, kind) => list.filter((i) => i.kind === kind).length;
		const perRun = (list, kind) => (ok.length === 0 ? 0 : count(list, kind) / ok.length);
		const usd = ok.map((r) => r.cost?.usd).filter((x) => typeof x === 'number');
		const d = {
			runs: of.length,
			failed: of.length - ok.length,
			recallSteps: bugs.filter((r) => r.foundSteps).length / Math.max(1, bugs.length),
			recallAny: bugs.filter((r) => r.foundAny).length / Math.max(1, bugs.length),
			areaRight: bugs.filter((r) => r.isAreaRight).length / Math.max(1, bugs.filter((r) => r.foundAny).length),
			precisionSteps: count(steps, 'bug') / Math.max(1, count(steps, 'bug') + count(steps, 'other')),
			precisionAny: count(all, 'bug') / Math.max(1, count(all, 'bug') + count(all, 'other')),
			otherSteps: perRun(steps, 'other'),
			otherAny: perRun(all, 'other'),
			testGaps: perRun(all, 'test'),
			preExisting: perRun(all, 'pre-existing'),
			cleanOtherSteps: mean(clean.map((r) => (r.issues ?? []).filter((i) => i.list === 'steps' && kindOf(i) === 'other').length)),
			minutes: median(ok.map((r) => r.ms / 60000)),
			subagents: mean(ok.map((r) => r.subagents)),
			usd: usd.length > 0 ? mean(usd) : undefined,
		};
		data[effort] = d;
		rows.push(`| ${effort} | ${of.length} (${d.failed} failed) | ${pct(bugs.filter((r) => r.foundSteps).length, bugs.length)} | `
			+ `${pct(bugs.filter((r) => r.foundAny).length, bugs.length)} | ${pct(count(steps, 'bug'), count(steps, 'bug') + count(steps, 'other'))} | `
			+ `${pct(count(all, 'bug'), count(all, 'bug') + count(all, 'other'))} | ${d.otherSteps.toFixed(2)} | ${d.cleanOtherSteps.toFixed(2)} | `
			+ `${d.testGaps.toFixed(2)} | ${d.preExisting.toFixed(2)} | ${d.minutes.toFixed(1)} | ${d.subagents.toFixed(1)} | `
			+ `${d.usd === undefined ? '-' : `$${d.usd.toFixed(2)}`} |`);
	}
	const caseRows = cases.map((c) => `| ${c.id} | ${c.kind} | ${c.title} | ${efforts.map((e) => {
		const of = results.filter((r) => r.case === c.id && r.effort === e && !r.error);
		return c.kind === 'bug' ? `${of.filter((r) => r.foundSteps).length}/${of.filter((r) => r.foundAny).length}/${of.length}`
			: `${of.reduce((n, r) => n + (r.issues ?? []).filter((i) => i.list === 'steps' && kindOf(i) === 'other').length, 0)} in ${of.length}`;
	}).join(' | ')} |`);
	// the issues of the kind other, for a check by hand: a false alarm, or a real problem that the case did not plan
	const others = results.flatMap((r) => (r.issues ?? []).filter((i) => kindOf(i) === 'other')
		.map((i) => `| ${r.case} | ${r.effort} | ${r.run} | ${i.list} | ${i.category} | ${i.verdict} | ${i.place} | ${i.title.replace(/\|/g, '/')} |`));
	const markdown = [
		'# Measurement of the review skill',
		'',
		`Model ${options.model}, the default focus (${DEFAULT_AREAS.map((a) => AREA_INFO[a].name.toLowerCase()).join(', ')}), ${cases.length} cases, `
			+ `${runs} ${runs === 1 ? 'run' : 'runs'} for each case and effort. ${results.length} runs are done.`,
		'',
		'| Effort | Runs | Recall, list of steps | Recall, both lists | Precision, list of steps | Precision, both lists | Other issues in the steps, each run | Other issues in the steps, each clean run | Test gaps, each run | Pre-existing issues, each run | Minutes (median) | Subagents | Cost (CLI) |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...rows,
		'',
		'Recall: the runs of the bug cases that found the bug. Each issue has a kind: the bug of the case, a test gap, a pre-existing problem, or other. '
			+ 'Each brief asks for a test, and no change has a test, so a test gap is a correct issue. Precision: the issues of the bug, of the issues of the '
			+ 'bug and of the kind other. An issue of the kind other is a false alarm, or a real problem that the case did not plan. The cost is the value '
			+ 'that the CLI reports.',
		'',
		`| Case | Kind | Title | ${efforts.join(' | ')} |`,
		`| --- | --- | --- | ${efforts.map(() => '---').join(' | ')} |`,
		...caseRows,
		'',
		'A bug case gives the runs that found the bug in the list of steps / in both lists / the runs with no error. A clean case gives the issues of the '
			+ 'kind other in the list of steps.',
		'',
		'## The issues of the kind other',
		'',
		...(others.length > 0 ? ['| Case | Effort | Run | List | Category | Verdict | Place | Title |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...others]
			: ['No issue.']),
	].join('\n');
	return { markdown, data };
}

//-------------------

async function main() {
	if (!isResume) {
		setup();
	}
	fs.mkdirSync(p.logs, { recursive: true });
	const base = git('rev-parse', 'HEAD').trim();
	const done = new Set(readResults().map((r) => `${r.case}|${r.effort}|${r.run}`));
	const before = userState();
	const proc = spawn(codeExe(DATAFLOW), [
		`--extensionDevelopmentPath=${DATAFLOW}`, `--extensionDevelopmentPath=${repo}`,
		`--user-data-dir=${p.userData}`, `--extensions-dir=${path.join(dir, 'extensions')}`,
		`--remote-debugging-port=${PORT}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', p.project,
	], {
		detached: true, stdio: 'ignore', windowsHide: true,
		env: cleanEnv({ DATAFLOW_MCP_REGISTRY: p.registry, CLAUDE_CONFIG_DIR: p.claudeConfig, SHOTGUN_HOME: p.shotgunHome }),
	});
	proc.unref();
	let wb;
	let n = readResults().length;
	try {
		wb = await workbench(PORT, dir);
		await sleep(4000);
		// as for a user, the folder has a task before the connect
		resetProject();
		applyCase(cases[0]);
		makeTask(cases[0], efforts[0], 0, base);
		await sleep(2000);
		await command(wb, 'DataFlow: Connect to Claude Code');
		await waitFor(() => readJson(userSettings)?.enabledPlugins?.['dataflow@dataflow-vscode'] === true, 30, 'connection of DataFlow');
		await command(wb, 'Shotgun: Connect to Claude Code');
		await waitFor(() => readJson(userSettings)?.extraKnownMarketplaces?.['shotgun-vscode'], 30, 'marketplace of Shotgun');
		const tools = await checkBridge(bridge);
		if (tools.shotgun?.length !== SHOTGUN_TOOLS) {
			throw new Error(`The bridge of DataFlow does not list the ${SHOTGUN_TOOLS} tools of Shotgun: ${JSON.stringify(tools)}`);
		}
		console.log(`The bridge lists ${tools.count} tools. ${done.size} runs are done already.`);

		for (let run = 1; run <= runs; run++) {
			for (const effort of efforts) {
				for (const c of cases) {
					if (done.has(`${c.id}|${effort}|${run}`)) {
						continue;
					}
					n += 1;
					resetProject();
					applyCase(c);
					const lines = bugLines(c);
					const task = makeTask(c, effort, n, base);
					// the extension loads the new active task from the stage files
					const session = await poll(async () => {
						const r = await callBridgeTool(bridge, 'shotgun_get_session', {});
						try {
							const s = JSON.parse(r.text ?? '');
							return s.task?.id === task.id && s.task.stage === 6 ? s : undefined;
						} catch {
							return undefined;
						}
					}, 30);
					const name = `${c.id}-${effort}-${run}`;
					let record;
					if (!session) {
						record = { case: c.id, kind: c.kind, effort, run, n, task: task.id, error: 'Shotgun did not load the task in stage 6.' };
					} else {
						const prompt = reviewPrompt(task.title, { effort, areas: [...DEFAULT_AREAS] });
						const res = await runClaude({
							name, prompt, cwd: p.project, logDir: p.logs, pluginDirs: [dataflowPlugin, shotgunPlugin], tools: REVIEW_TOOLS, maxTurns: 80,
							seconds: 2400, model: options.model,
						});
						const review = readJson(path.join(p.project, '.shotgun', task.id, 'review.json'));
						const names = res.toolUses.map((t) => t.name);
						const isSubmitted = (review?.rounds ?? []).length > 0;
						record = {
							case: c.id, kind: c.kind, effort, run, n, task: task.id, code: res.code, ms: res.ms, cost: res.cost,
							subagents: names.filter((x) => x === 'Agent' || x === 'Task').length, isSkill: res.toolUses.some((t) => t.name === 'Skill'
								&& String(t.input?.skill).includes('shotgun-review')),
							...(isSubmitted ? score(c, review.issues ?? [], lines) : { error: `No review in review.json. Result: ${String(res.result).slice(0, 300)}` }),
						};
					}
					fs.appendFileSync(resultsFile, `${JSON.stringify(record)}\n`);
					const s = summarize(readResults());
					fs.writeFileSync(path.join(dir, 'results.md'), `${s.markdown}\n`);
					console.log(`${name}: ${record.error ?? `${record.issues.length} issues, ${c.kind === 'bug' ? `found ${record.foundSteps ? 'in the steps' : record.foundAny ? 'in the second list' : 'no'}` : `${record.issues.filter((i) => i.list === 'steps').length} in the steps`}`}, `
						+ `${Math.round((record.ms ?? 0) / 1000)} s`);
				}
			}
		}
		wb.ws.close();
	} catch (error) {
		console.error(`The measurement stopped: ${error?.stack ?? error}`);
		await wb?.shot('failure.png').catch(() => undefined);
		process.exitCode = 1;
	} finally {
		killTree(proc.pid);
		await sleep(2000);
		const left = await stopProcessesOf(dir);
		const user = cleanUserData(before, dir);
		resetProject();
		const s = summarize(readResults());
		fs.writeFileSync(path.join(dir, 'results.md'), `${s.markdown}\n`);
		fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s.data, null, 2));
		console.log(s.markdown);
		console.log(`Processes left: ${left.length}. The data of Claude Code of the user is ${user.isSame ? 'as before' : `not as before: ${JSON.stringify(user.added)}`}.`);
		if (left.length > 0 || !user.isSame) {
			process.exitCode = 1;
		}
	}
}

if (options.report) {
	const s = summarize(readResults());
	fs.writeFileSync(path.join(dir, 'results.md'), `${s.markdown}\n`);
	fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(s.data, null, 2));
	console.log(s.markdown);
} else {
	await main();
}
