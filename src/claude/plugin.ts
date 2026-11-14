import { existsSync, readdirSync, rmSync } from 'fs';
import * as path from 'path';
import { readText, writeTextAtomic } from '../session/files';
import { MARKETPLACE_NAME, PLUGIN_NAME } from './settings';

// The plugin of Shotgun for Claude Code, in a marketplace in a local folder. Claude Code loads a plugin of a local
// folder in place, so the plugin needs no install. The plugin has the hooks of Shotgun and its skills. The hooks call
// the tools of Shotgun on the MCP server of DataFlow, so the plugin needs no runtime of its own. Phase 0 tested this
// form with Claude Code 2.1.323: a hook of type mcp_tool runs for PreToolUse and UserPromptSubmit, but not for
// SessionStart. These functions use no VS Code API.

// The MCP server of DataFlow in Claude Code: the server dataflow of the plugin dataflow
export const DATAFLOW_SERVER = 'plugin:dataflow:dataflow';
// The time limit of a hook in seconds. After it, Claude Code continues the tool call or the prompt
export const HOOK_TIMEOUT = 10;
const DESCRIPTION = 'The guard, the context and the skills of the Shotgun extension of VS Code';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const skillFile = (name: string): string => path.join('plugins', PLUGIN_NAME, 'skills', name, 'SKILL.md');

// A hook that calls a tool of Shotgun. The values in ${} come from the input of the hook
function toolHook(tool: string, input: Record<string, string>): Record<string, unknown> {
	return { type: 'mcp_tool', server: DATAFLOW_SERVER, tool, input, timeout: HOOK_TIMEOUT };
}

// The files of the marketplace and of its plugin, by their paths in the marketplace folder. skills: the text of the
// file SKILL.md of each skill, by the name of the skill
export function pluginFiles(version: string, skills: Readonly<Record<string, string>> = {}): Record<string, string> {
	const files: Record<string, string> = {
		[path.join('.claude-plugin', 'marketplace.json')]: json({
			name: MARKETPLACE_NAME,
			owner: { name: 'Shotgun' },
			description: 'The plugin of the Shotgun extension of VS Code. Shotgun writes this folder.',
			plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, description: DESCRIPTION }],
		}),
		[path.join('plugins', PLUGIN_NAME, '.claude-plugin', 'plugin.json')]: json({
			name: PLUGIN_NAME,
			displayName: 'Shotgun',
			version,
			description: DESCRIPTION,
			author: { name: 'Shotgun' },
			hooks: {
				// the guard. NotebookEdit has the path in a different field, so it has its own hook
				PreToolUse: [
					{ matcher: 'Edit|MultiEdit|Write', hooks: [toolHook('shotgun_guard', { tool: '${tool_name}', file: '${tool_input.file_path}', cwd: '${cwd}' })] },
					{ matcher: 'NotebookEdit', hooks: [toolHook('shotgun_guard', { tool: '${tool_name}', file: '${tool_input.notebook_path}', cwd: '${cwd}' })] },
				],
				// the context of the active task for each prompt (proposal P14)
				UserPromptSubmit: [
					{ hooks: [toolHook('shotgun_session_context', { event: '${hook_event_name}', cwd: '${cwd}' })] },
				],
			},
		}),
	};
	for (const [name, text] of Object.entries(skills)) {
		files[skillFile(name)] = text;
	}
	return files;
}

// Writes the files that are different. A skill that is not in the files goes away. The result: the number of changes
export function writePlugin(dir: string, files: Readonly<Record<string, string>>): number {
	let changes = 0;
	for (const [name, text] of Object.entries(files)) {
		const file = path.join(dir, name);
		if (readText(file) !== text) {
			writeTextAtomic(file, text);
			changes += 1;
		}
	}
	const skills = path.join(dir, 'plugins', PLUGIN_NAME, 'skills');
	if (existsSync(skills)) {
		for (const name of readdirSync(skills)) {
			if (!Object.prototype.hasOwnProperty.call(files, skillFile(name))) {
				rmSync(path.join(skills, name), { recursive: true, force: true });
				changes += 1;
			}
		}
	}
	return changes;
}

// The skills in the folder plugin/skills of the extension: the text of SKILL.md of each skill folder
export function readSkills(extensionPath: string): Record<string, string> {
	const dir = path.join(extensionPath, 'plugin', 'skills');
	const skills: Record<string, string> = {};
	if (!existsSync(dir)) {
		return skills;
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const text = entry.isDirectory() ? readText(path.join(dir, entry.name, 'SKILL.md')) : undefined;
		if (text !== undefined) {
			skills[entry.name] = text;
		}
	}
	return skills;
}

export function removePlugin(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}
