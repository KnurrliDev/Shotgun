import type { TaskFile } from '../session/files';
import { STAGE_INFO, stageText } from '../session/stages';

// The context for Claude: before each prompt, the UserPromptSubmit hook of the plugin of Shotgun calls the tool
// shotgun_session_context. Its text tells Claude the active task, the stage and the rule of the guard, so Claude sees
// each gate that the user recorded after the last prompt. With no active task, the hook gives no text. These functions
// use no VS Code API.

// The full name of the tool get_session in Claude Code. MCP tools are deferred tools there, so the text gives the full
// name for ToolSearch
export const GET_SESSION_TOOL = 'mcp__plugin_dataflow_dataflow__shotgun_get_session';

// The hook events that can give a text to Claude
const CONTEXT_EVENTS = new Set(['UserPromptSubmit', 'SessionStart']);

// now: the current work in stage 5, for example the current step and its writer
export function contextText(task: TaskFile | undefined, isPaused: boolean, now?: string): string | undefined {
	if (!task || task.isDone) {
		return undefined;
	}
	if (isPaused) {
		return `Shotgun: the user paused the task "${task.title}". The guard of Shotgun is off until the user selects "Shotgun: Continue".`;
	}
	const info = STAGE_INFO[task.stage];
	return `Shotgun: the active task is "${task.title}", in ${stageText(task.stage)}. ${info.guard} ${now ? `${now} ` : ''}`
		+ `For the details, call the tool ${GET_SESSION_TOOL}.`;
}

// The text result of the tool: the JSON output of the hook. event: the name of the hook event from the input of the hook
export function contextOutput(text: string | undefined, event: string): string {
	if (!text) {
		return '{}';
	}
	const hookEventName = CONTEXT_EVENTS.has(event) ? event : 'UserPromptSubmit';
	return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}
