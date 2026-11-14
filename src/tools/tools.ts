import * as path from 'path';
import type { ExtensionTool } from '../dataflow/dataflow-api';
import { GATE_LABEL, GATE_OF, STAGE_INFO, STAGES } from '../session/stages';
import type { Snapshot, SessionStore } from '../session/store';
import { contextOutput, contextText } from './context';
import { decide, GuardInput, hookOutput, isInside, targetOf } from './guard';

// The tools of Shotgun for the MCP server of DataFlow. DataFlow puts "shotgun_" before each name, so Claude Code sees
// for example mcp__plugin_dataflow_dataflow__shotgun_get_session. Phase 1 has the read tool get_session and the 2 tools
// of the hooks. The later phases add the submit tools.

export interface ToolDeps {
	readonly store: SessionStore;
	readonly folders: () => readonly string[]; // the workspace folders
	readonly log: (message: string) => void;
}

// File systems of Windows and macOS do not tell the case of letters apart
export const IS_CASE_SENSITIVE = process.platform !== 'win32' && process.platform !== 'darwin';

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The result of get_session: the active task, its stage and gates, the rule of the guard and the next work
export function sessionData(snapshot: Snapshot): Record<string, unknown> {
	const task = snapshot.task;
	let guard: string;
	let next: string;
	if (!task) {
		guard = 'No task is active. The guard makes no decision.';
		next = 'The user makes a task with "Shotgun: New Task", or selects a task with "Shotgun: Open Task".';
	} else if (task.isDone) {
		guard = 'The task is done. The guard makes no decision.';
		next = 'The task is done.';
	} else if (snapshot.isPaused) {
		guard = 'The user paused the task. The guard makes no decision.';
		next = 'The user selects "Shotgun: Continue" to continue the task.';
	} else {
		guard = STAGE_INFO[task.stage].guard;
		next = STAGE_INFO[task.stage].next;
	}
	return {
		folder: snapshot.root ?? null,
		task: task ? {
			id: task.id,
			title: task.title,
			created: task.created,
			stage: STAGE_INFO[task.stage].number,
			stageName: STAGE_INFO[task.stage].name,
			writer: STAGE_INFO[task.stage].writer,
			isDone: task.isDone,
			gates: task.gates.map((g) => ({ gate: GATE_LABEL[g.gate], stage: STAGE_INFO[g.stage].number, time: g.time })),
			nextGate: task.isDone ? null : GATE_LABEL[GATE_OF[task.stage]],
		} : null,
		isPaused: snapshot.isPaused,
		guard,
		next,
		stages: STAGES.map((s) => ({ number: STAGE_INFO[s].number, name: STAGE_INFO[s].name, writer: STAGE_INFO[s].writer })),
		otherTasks: snapshot.tasks.filter((t) => t.id !== task?.id)
			.map((t) => ({ id: t.id, title: t.title, stage: STAGE_INFO[t.stage].number, isDone: t.isDone })),
		...(snapshot.problems.length > 0 ? { problems: snapshot.problems } : {}),
	};
}

export function shotgunTools(deps: ToolDeps): ExtensionTool[] {
	return [
		{
			name: 'get_session',
			title: 'Shotgun session',
			description: 'Gives the active Shotgun task: its title, its stage of 5, the gates of the user, the rule of the guard and the next work. '
				+ 'Call it first for each request about Shotgun.',
			inputSchema: { type: 'object', properties: {} },
			isReadOnly: true,
			call: () => sessionData(deps.store.snapshot),
		},
		{
			name: 'guard',
			title: 'Shotgun guard',
			description: 'The PreToolUse hook of the Shotgun plugin calls this tool before each file change. Do not call it.',
			inputSchema: {
				type: 'object',
				properties: { tool: { type: 'string' }, file: { type: 'string' }, cwd: { type: 'string' } },
			},
			// the tool records a deny in the ledger, but it changes no file of the project
			isReadOnly: true,
			call: (args) => {
				const input: GuardInput = { tool: textOf(args.tool), file: textOf(args.file), cwd: textOf(args.cwd) };
				const folders = deps.folders();
				const snapshot = deps.store.snapshot;
				const decision = decide(input, {
					folders, shotgunDir: deps.store.dir, task: snapshot.task, isPaused: snapshot.isPaused, isCaseSensitive: IS_CASE_SENSITIVE,
				});
				if (decision.decision === 'deny') {
					const target = targetOf(input, folders) ?? input.file;
					const root = folders.find((f) => isInside(target, f, IS_CASE_SENSITIVE));
					const file = root ? path.relative(root, target) : target;
					deps.store.recordDeny(input.tool || 'unknown', file, decision.reason);
					deps.log(`The guard denied ${input.tool || 'a change'} of ${file}.`);
				}
				return hookOutput(decision);
			},
		},
		{
			name: 'session_context',
			title: 'Shotgun context',
			description: 'The UserPromptSubmit hook of the Shotgun plugin calls this tool before each prompt. Do not call it.',
			inputSchema: {
				type: 'object',
				properties: { event: { type: 'string' }, cwd: { type: 'string' } },
			},
			isReadOnly: true,
			call: (args) => {
				const snapshot = deps.store.snapshot;
				return contextOutput(contextText(snapshot.task, snapshot.isPaused), textOf(args.event));
			},
		},
	];
}
