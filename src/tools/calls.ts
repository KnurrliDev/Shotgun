import type { ToolCallEvent } from '../dataflow/dataflow-api';
import type { TaskFile } from '../session/files';

// The calls of the tools of the MCP server of DataFlow by the MCP clients, from the event onDidCallTool. Decision 13: a
// fact of Claude names the read tool of DataFlow that shows the fact, and Claude must have called that tool.

// The maximum number of the calls in memory
const MAX_CALLS = 2000;

export class ToolCallLog {
	private readonly calls: { readonly tool: string; readonly time: number }[] = [];

	// A failed call shows no fact, so it does not go into the log
	record(e: Pick<ToolCallEvent, 'tool' | 'time' | 'isError'>): void {
		if (e.isError) {
			return;
		}
		const time = Date.parse(e.time);
		this.calls.push({ tool: e.tool, time: Number.isFinite(time) ? time : Date.now() });
		if (this.calls.length > MAX_CALLS) {
			this.calls.splice(0, this.calls.length - MAX_CALLS);
		}
	}

	// The tools of the calls since the time
	since(time: number): ReadonlySet<string> {
		return new Set(this.calls.filter((c) => c.time >= time).map((c) => c.tool));
	}
}

// The start of the current stage of a task: the time of its last gate, else the time of the task
export function stageStart(task: Pick<TaskFile, 'created' | 'gates'>): number {
	const last = task.gates[task.gates.length - 1];
	const time = Date.parse(last ? last.time : task.created);
	return Number.isFinite(time) ? time : 0;
}
