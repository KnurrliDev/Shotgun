import * as assert from 'assert';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DATAFLOW_SERVER, HOOK_TIMEOUT, pluginFiles, readSkills, writePlugin } from '../../claude/plugin';
import { MARKETPLACE_NAME } from '../../claude/settings';

// The CLI of Claude Code for the check of the plugin: CLAUDE_EXE, else claude on the PATH. undefined: no CLI
function claudeCli(): string | undefined {
	const candidates = [process.env.CLAUDE_EXE, 'claude'].filter((c): c is string => !!c);
	return candidates.find((c) => spawnSync(c, ['--version'], { encoding: 'utf8', windowsHide: true, env: cliEnv() }).status === 0);
}

// The CLI does not start in a session of Claude Code with the variable CLAUDECODE
function cliEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.CLAUDECODE;
	return env;
}

// The plugin of Shotgun for Claude Code
suite('Plugin of Shotgun', () => {
	const manifestPath = path.join('plugins', 'shotgun', '.claude-plugin', 'plugin.json');
	// the folder of the repository: the tests run from out/test/unit
	const repo = path.resolve(__dirname, '..', '..', '..');
	let dir: string;

	setup(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-plugin-'));
	});
	teardown(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('The files have the marketplace, the guard, the context and the skills', () => {
		const files = pluginFiles('1.2.3', { shotgun: '---\nname: shotgun\n---\n' });
		const market = JSON.parse(files[path.join('.claude-plugin', 'marketplace.json')]);
		assert.strictEqual(market.name, MARKETPLACE_NAME);
		assert.deepStrictEqual(market.plugins.map((p: { name: string; source: string }) => [p.name, p.source]), [['shotgun', './plugins/shotgun']]);
		const manifest = JSON.parse(files[manifestPath]);
		assert.strictEqual(manifest.name, 'shotgun');
		assert.strictEqual(manifest.version, '1.2.3');
		const guard = manifest.hooks.PreToolUse;
		assert.deepStrictEqual(guard.map((h: { matcher: string }) => h.matcher), ['Edit|MultiEdit|Write', 'NotebookEdit']);
		assert.deepStrictEqual(guard[0].hooks[0], {
			type: 'mcp_tool', server: DATAFLOW_SERVER, tool: 'shotgun_guard',
			input: { tool: '${tool_name}', file: '${tool_input.file_path}', cwd: '${cwd}' }, timeout: HOOK_TIMEOUT,
		});
		assert.strictEqual(guard[1].hooks[0].input.file, '${tool_input.notebook_path}');
		const context = manifest.hooks.UserPromptSubmit[0].hooks[0];
		assert.strictEqual(context.tool, 'shotgun_session_context');
		// the prompt is for the check of a brief from the chat (decision 12)
		assert.deepStrictEqual(context.input, { event: '${hook_event_name}', cwd: '${cwd}', prompt: '${prompt}' });
		// Claude Code does not run a hook of type mcp_tool at SessionStart (phase 0, S4)
		assert.ok(!('SessionStart' in manifest.hooks));
		assert.strictEqual(files[path.join('plugins', 'shotgun', 'skills', 'shotgun', 'SKILL.md')], '---\nname: shotgun\n---\n');
	});

	test('writePlugin writes only the changed files, and removes the old skills', () => {
		assert.strictEqual(writePlugin(dir, pluginFiles('1.0.0', { a: 'A', b: 'B' })), 4);
		assert.strictEqual(writePlugin(dir, pluginFiles('1.0.0', { a: 'A', b: 'B' })), 0);
		// a new version and 1 skill less: the manifest, the new text of a, and the removal of b
		assert.strictEqual(writePlugin(dir, pluginFiles('1.1.0', { a: 'A2' })), 3);
		assert.deepStrictEqual(readdirSync(path.join(dir, 'plugins', 'shotgun', 'skills')), ['a']);
	});

	test('readSkills reads the file SKILL.md of each skill folder of the extension', () => {
		assert.deepStrictEqual(readSkills(dir), {});
		mkdirSync(path.join(dir, 'plugin', 'skills', 'shotgun'), { recursive: true });
		mkdirSync(path.join(dir, 'plugin', 'skills', 'empty'), { recursive: true });
		writeFileSync(path.join(dir, 'plugin', 'skills', 'shotgun', 'SKILL.md'), 'text');
		assert.deepStrictEqual(readSkills(dir), { shotgun: 'text' });
	});

	test('The extension has the skills of each stage of Claude, and of the callouts', () => {
		const skills = readSkills(repo);
		assert.deepStrictEqual(Object.keys(skills).sort(), ['shotgun', 'shotgun-errand', 'shotgun-explain', 'shotgun-frame', 'shotgun-plan', 'shotgun-survey']);
		assert.match(skills['shotgun-plan'], /^---\r?\nname: shotgun-plan\r?\ndescription: '[^']*Make the plan[^']*'\r?\n---/);
		for (const tool of ['shotgun_get_order', 'shotgun_submit_task_survey', 'shotgun_submit_plan', 'shotgun_get_plan', 'get_heat']) {
			assert.ok(skills['shotgun-plan'].includes(`mcp__plugin_dataflow_dataflow__${tool}`), tool);
		}
		assert.ok(skills.shotgun.includes('shotgun-plan'));
		assert.match(skills.shotgun, /^---\r?\nname: shotgun\r?\ndescription: '.*Ask me questions about my brief.*'\r?\n---/);
		assert.match(skills['shotgun-survey'], /^---\r?\nname: shotgun-survey\r?\ndescription: '[^']*Survey my brief[^']*'\r?\n---/);
		// a skill gives the full names of its tools, because MCP tools are deferred tools in Claude Code
		for (const tool of ['get_session', 'submit_brief', 'submit_questions']) {
			assert.ok(skills.shotgun.includes(`shotgun_${tool}`), tool);
		}
		for (const tool of ['shotgun_get_session', 'shotgun_submit_survey', 'get_place']) {
			assert.ok(skills['shotgun-survey'].includes(`mcp__plugin_dataflow_dataflow__${tool}`), tool);
		}
		assert.ok(skills.shotgun.includes('shotgun-survey'));
	});

	test('Claude Code accepts the plugin with its skills, and the marketplace', function () {
		this.timeout(120000);
		const cli = claudeCli();
		if (!cli) {
			this.skip(); // no CLI of Claude Code: set CLAUDE_EXE to run this test
		}
		writePlugin(dir, pluginFiles('0.1.0', readSkills(repo)));
		assert.ok(existsSync(path.join(dir, 'plugins', 'shotgun', 'skills', 'shotgun', 'SKILL.md')));
		for (const folder of [path.join(dir, 'plugins', 'shotgun'), dir]) {
			assert.ok(existsSync(folder));
			const result: SpawnSyncReturns<string> = spawnSync(cli!, ['plugin', 'validate', folder], { encoding: 'utf8', windowsHide: true, env: cliEnv() });
			assert.strictEqual(result.status, 0, `${folder}\n${result.stdout}\n${result.stderr}`);
			assert.match(result.stdout, /Validation passed/, result.stdout);
		}
	});
});
