import * as path from 'path';
import { SHOTGUN_DIR } from '../session/files';
import { isInside } from '../session/paths';
import { Stage, STAGE_INFO, stageText } from '../session/stages';

// The guard: before each file change of Claude Code, the PreToolUse hook of the plugin of Shotgun calls the tool
// shotgun_guard. The tool gives no decision, or a deny with a reason for Claude. With no decision, the normal
// permissions of Claude Code apply. The guard helps the user, but it is not a security boundary: Claude Code continues
// the change when the MCP server of DataFlow has no connection. These functions use no VS Code API.

export interface GuardInput {
	readonly tool: string; // the tool of Claude Code, for example Edit
	readonly file: string; // the file of the change, as Claude Code gives it
	readonly cwd: string; // the folder of the session of Claude Code
}

export interface GuardState {
	readonly folders: readonly string[]; // the workspace folders: the project
	readonly shotgunDir: string | undefined; // the folder .shotgun
	readonly task: { readonly title: string; readonly stage: Stage; readonly isDone: boolean } | undefined; // the active task
	readonly isPaused: boolean;
	readonly isCaseSensitive: boolean; // false on Windows
	// stage 5: the scope of the open step of Claude, and the reason of a deny with no open step of Claude
	readonly build?: {
		readonly scope?: { readonly files: readonly string[]; readonly names: readonly string[] }; // absolute paths, and the names for Claude
		readonly step: string; // for example step 5 of 8, "Read the limit"
		readonly closed: string;
	};
}

// why: the cause of no decision, for the log and the tests
export type GuardDecision =
	| { readonly decision: 'none'; readonly why: 'no file' | 'outside' | 'no task' | 'paused' | 'done' | 'scope' }
	| { readonly decision: 'deny'; readonly reason: string };

// A value of the input that Claude Code did not fill, for example ${tool_input.file_path} for a different tool
const isEmpty = (value: string): boolean => !value.trim() || /^\$\{[^}]*\}$/.test(value.trim());

export { isInside };

// The absolute path of the file of the input, or undefined with no file. A relative path is relative to the folder of
// the session, else to the first folder of the project
export function targetOf(input: GuardInput, folders: readonly string[]): string | undefined {
	if (isEmpty(input.file)) {
		return undefined;
	}
	const base = isEmpty(input.cwd) ? folders[0] ?? process.cwd() : input.cwd;
	return path.resolve(base, input.file);
}

export function decide(input: GuardInput, state: GuardState): GuardDecision {
	const file = targetOf(input, state.folders);
	if (!file) {
		return { decision: 'none', why: 'no file' };
	}
	// the stage files: Claude gives its results with the tools of Shotgun, also in a pause
	if (state.shotgunDir && isInside(file, state.shotgunDir, state.isCaseSensitive)) {
		return {
			decision: 'deny',
			reason: `Shotgun: the folder ${SHOTGUN_DIR} keeps the files of Shotgun. Do not change them. Give your results to Shotgun with its tools.`,
		};
	}
	if (!state.folders.some((folder) => isInside(file, folder, state.isCaseSensitive))) {
		return { decision: 'none', why: 'outside' };
	}
	const task = state.task;
	if (!task) {
		return { decision: 'none', why: 'no task' };
	}
	if (state.isPaused) {
		return { decision: 'none', why: 'paused' };
	}
	if (task.isDone) {
		return { decision: 'none', why: 'done' };
	}
	if (task.stage !== 'build') {
		return {
			decision: 'deny',
			reason: `Shotgun: the task "${task.title}" is in ${stageText(task.stage)}. Claude changes no file before stage 5, the build. `
				+ 'Give your results to Shotgun with its tools. For work outside of the task, the user selects "Shotgun: Pause".',
		};
	}
	const build = state.build;
	const scope = build?.scope;
	if (scope) {
		const key = (f: string) => (state.isCaseSensitive ? path.resolve(f) : path.resolve(f).toLowerCase());
		if (scope.files.some((f) => key(f) === key(file))) {
			return { decision: 'none', why: 'scope' };
		}
		return {
			decision: 'deny',
			reason: `Shotgun: ${build.step} is open, and its scope is ${scope.names.join(', ')}. The file ${input.file} is not in the scope. `
				+ 'Change only the files of the scope. Give each other place that the step needs as a loose end to shotgun_submit_errand.',
		};
	}
	return {
		decision: 'deny',
		reason: `Shotgun: the task "${task.title}" is in ${stageText(task.stage)}. ${build?.closed || `No step of Claude is open. ${STAGE_INFO.build.guard}`} `
			+ 'For work outside of the task, the user selects "Shotgun: Pause".',
	};
}

// The text result of the tool: the JSON output of a PreToolUse hook
export function hookOutput(decision: GuardDecision): string {
	if (decision.decision === 'none') {
		return '{}';
	}
	return JSON.stringify({
		hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason },
	});
}
