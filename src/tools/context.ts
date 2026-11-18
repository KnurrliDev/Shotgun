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

// The rules of the STE output (decision 41). The rules apply to 1 prompt, so they stop when the hook stops to give them:
// after the user turns the option off, pauses the task or ends it. The words of the user stay, because submit_brief
// refuses a brief with changed words
export const STE_RULES = [
	'Shotgun: the user turned on the STE output. For this prompt, write all text in ASD-STE100 Simplified Technical English (STE). '
	+ 'This applies to your replies, code comments, commit messages, documents and the text that you give to the tools of Shotgun.',
	'- Write a maximum of 20 words in an instruction and 25 words in a description. Write 1 topic in each sentence, and a maximum of 6 sentences in a paragraph.',
	'- Use the imperative for an instruction. Put a condition before its action.',
	'- Use the active voice and simple verb tenses: present, past and future.',
	'- Use common words with 1 meaning. Use 1 term for 1 thing, and no synonyms.',
	'- Do not use an -ing word as a noun or as an adjective. Use a maximum of 3 nouns together. Keep the articles a, an and the.',
	'- Do not use a slash or an em dash. Write quantities as numerals.',
	'Do not change code, names, paths, commands, values, quotations or the words of the user. If a rule and the technical accuracy have a conflict, keep the accuracy.',
	'Put these rules into the prompt of each subagent that you start. Shotgun gives these rules again with each prompt while they apply.',
].join('\n');

// now: the current work in stage 5, for example the current step and its writer. isSteOutput: the option of the page
export function contextText(task: TaskFile | undefined, isPaused: boolean, now?: string, isSteOutput = false): string | undefined {
	if (!task || task.isDone) {
		return undefined;
	}
	if (isPaused) {
		return `Shotgun: the user paused the task "${task.title}". The guard of Shotgun is off until the user selects "Shotgun: Continue".`;
	}
	const info = STAGE_INFO[task.stage];
	const text = `Shotgun: the active task is "${task.title}", in ${stageText(task.stage)}. ${info.guard} ${now ? `${now} ` : ''}`
		+ `For the details, call the tool ${GET_SESSION_TOOL}.`;
	return isSteOutput ? `${text}\n\n${STE_RULES}` : text;
}

// The text result of the tool: the JSON output of the hook. event: the name of the hook event from the input of the hook
export function contextOutput(text: string | undefined, event: string): string {
	if (!text) {
		return '{}';
	}
	const hookEventName = CONTEXT_EVENTS.has(event) ? event : 'UserPromptSubmit';
	return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}
