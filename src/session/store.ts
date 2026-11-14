import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { EventEmitter } from 'events';
import * as path from 'path';
import {
	ACTIVE_FILE, ActiveFile, Decision, DECISIONS_FILE, decisionLine, DecisionInput, FILE_VERSION, jsonText, parseActive, parseDecisions,
	parseTask, readText, SHOTGUN_DIR, TASK_FILE, TASK_ID, TaskFile, taskIdOf, writeTextAtomic,
} from './files';
import { Gate, passGate, Stage, START } from './stages';

// The session of Shotgun in a workspace: the tasks, the active task and its decisions. The store keeps the state in
// memory, so the guard decides with no file access. Each change goes to the stage files first, and then into memory.
// The store uses no VS Code API, so the unit tests can use it with a temporary folder.

export interface TaskSummary {
	readonly id: string;
	readonly title: string;
	readonly stage: Stage;
	readonly isDone: boolean;
	readonly created: string;
}

export interface Snapshot {
	readonly root: string | undefined; // the first workspace folder
	readonly task: TaskFile | undefined; // the active task
	readonly isPaused: boolean;
	readonly tasks: readonly TaskSummary[]; // all tasks, the newest first
	readonly decisions: readonly Decision[]; // the last decisions of the active task, the newest last
	readonly problems: readonly string[]; // the stage files that Shotgun cannot read
}

// The maximum number of decisions in memory. The file keeps all decisions
const MAX_DECISIONS = 500;
const MAX_TITLE = 200;

export class SessionStore {
	private state: Snapshot;
	private readonly events = new EventEmitter();

	constructor(private readonly root: string | undefined, private readonly now: () => Date = () => new Date()) {
		this.state = { root, task: undefined, isPaused: false, tasks: [], decisions: [], problems: [] };
	}

	get snapshot(): Snapshot {
		return this.state;
	}

	// The folder .shotgun, or undefined with no workspace folder
	get dir(): string | undefined {
		return this.root ? path.join(this.root, SHOTGUN_DIR) : undefined;
	}

	onDidChange(listener: (snapshot: Snapshot) => void): { dispose(): void } {
		this.events.on('change', listener);
		return { dispose: () => this.events.off('change', listener) };
	}

	// Reads the stage files again, for example after a change by a different window
	load(): void {
		const dir = this.dir;
		const problems: string[] = [];
		const tasks: TaskFile[] = [];
		if (dir && existsSync(dir)) {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (!entry.isDirectory() || !TASK_ID.test(entry.name)) {
					continue;
				}
				const text = readText(path.join(dir, entry.name, TASK_FILE));
				if (text === undefined) {
					continue;
				}
				try {
					tasks.push(parseTask(text, entry.name));
				} catch (error) {
					problems.push(messageOf(error));
				}
			}
		}
		tasks.sort((a, b) => b.created.localeCompare(a.created));

		let active: ActiveFile = { version: FILE_VERSION, task: null, isPaused: false };
		const activeText = dir ? readText(path.join(dir, ACTIVE_FILE)) : undefined;
		if (activeText !== undefined) {
			try {
				active = parseActive(activeText);
			} catch (error) {
				problems.push(messageOf(error));
			}
		}
		const task = active.task ? tasks.find((t) => t.id === active.task) : undefined;
		if (active.task && !task) {
			problems.push(`${ACTIVE_FILE} names the task ${active.task}, but its folder has no correct ${TASK_FILE}.`);
		}
		let decisions: Decision[] = [];
		if (task && dir) {
			const parsed = parseDecisions(readText(path.join(dir, task.id, DECISIONS_FILE)) ?? '');
			decisions = parsed.decisions.slice(-MAX_DECISIONS);
			if (parsed.invalid > 0) {
				problems.push(`${task.id}/${DECISIONS_FILE} has ${parsed.invalid} lines that are not correct. Shotgun ignores them.`);
			}
		}
		this.set({
			root: this.root,
			task,
			isPaused: task ? active.isPaused : false,
			tasks: tasks.map(({ id, title, stage, isDone, created }) => ({ id, title, stage, isDone, created })),
			decisions,
			problems,
		});
	}

	// Makes a new task in stage 1 and makes it the active task. by: the user with the command, or Claude with a tool
	newTask(title: string, by: 'user' | 'claude' = 'user'): TaskFile {
		const dir = this.requireDir();
		const text = title.trim().replace(/\s+/g, ' ');
		if (!text) {
			throw new Error('Give a title for the task.');
		}
		if (text.length > MAX_TITLE) {
			throw new Error(`The title has more than ${MAX_TITLE} characters. Give a shorter title.`);
		}
		const taken = new Set(existsSync(dir) ? readdirSync(dir).map((n) => n.toLowerCase()) : []);
		const id = taskIdOf(text, taken);
		const task: TaskFile = { version: FILE_VERSION, id, title: text, created: this.time(), ...START };
		writeTextAtomic(path.join(dir, id, TASK_FILE), jsonText(task));
		this.append(id, { kind: 'task', by, title: text });
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: id, isPaused: false } satisfies ActiveFile));
		this.load();
		return task;
	}

	// Makes a task of the workspace the active task. The guard is on for it
	openTask(id: string): TaskFile {
		const dir = this.requireDir();
		const task = this.state.tasks.find((t) => t.id === id);
		if (!task) {
			throw new Error(`The workspace has no task ${id}.`);
		}
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: id, isPaused: false } satisfies ActiveFile));
		this.load();
		return this.requireTask();
	}

	// Stops the guard for work outside of the task, or starts it again. The ledger records each change
	setPaused(isPaused: boolean): void {
		const dir = this.requireDir();
		const task = this.requireTask();
		if (this.state.isPaused === isPaused) {
			return;
		}
		writeTextAtomic(path.join(dir, ACTIVE_FILE), jsonText({ version: FILE_VERSION, task: task.id, isPaused } satisfies ActiveFile));
		this.append(task.id, { kind: isPaused ? 'pause' : 'continue', by: 'user' });
		this.load();
	}

	// Records a gate of the user: the active task goes to the next stage, or it is done after the last gate
	passGate(gate: Gate): TaskFile {
		const dir = this.requireDir();
		const task = this.requireTask();
		const progress = passGate(task, gate, this.time());
		const next: TaskFile = { ...task, ...progress };
		writeTextAtomic(path.join(dir, task.id, TASK_FILE), jsonText(next));
		this.append(task.id, { kind: 'gate', by: 'user', gate, stage: task.stage });
		this.load();
		return next;
	}

	// Records a deny of the guard in the ledger of the active task. This is the fast path of the guard: it reads no file
	recordDeny(tool: string, file: string, reason: string): void {
		const task = this.state.task;
		if (!task) {
			return;
		}
		const decision = this.append(task.id, { kind: 'deny', by: 'guard', tool, file, reason });
		this.set({ ...this.state, decisions: [...this.state.decisions, decision].slice(-MAX_DECISIONS) });
	}

	private append(id: string, input: DecisionInput): Decision {
		const decision = { version: FILE_VERSION, time: this.time(), ...input } as Decision;
		const file = path.join(this.requireDir(), id, DECISIONS_FILE);
		mkdirSync(path.dirname(file), { recursive: true });
		appendFileSync(file, decisionLine(decision));
		return decision;
	}

	private set(next: Snapshot): void {
		const isChanged = JSON.stringify(next) !== JSON.stringify(this.state);
		this.state = next;
		if (isChanged) {
			this.events.emit('change', next);
		}
	}

	private requireDir(): string {
		const dir = this.dir;
		if (!dir) {
			throw new Error('Open a folder in VS Code first. Shotgun keeps its files in the folder .shotgun of the first workspace folder.');
		}
		return dir;
	}

	private requireTask(): TaskFile {
		const task = this.state.task;
		if (!task) {
			throw new Error('No task is active. Make a task with "Shotgun: New Task", or select one with "Shotgun: Open Task".');
		}
		return task;
	}

	private time(): string {
		return this.now().toISOString();
	}
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
