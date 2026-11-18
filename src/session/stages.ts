// The 6 stages of a task, their writers and their gates. A gate is a decision of the user that ends a stage. The gate
// of the last stage ends the task. These functions use no VS Code API, so the unit tests can call them directly.
// A task of Shotgun 0.2.0 or earlier that is done in stage 5 stays done there, with no review (P25).

export const STAGES = ['brief', 'survey', 'order', 'plan', 'build', 'review'] as const;
export type Stage = (typeof STAGES)[number];

// The writer of a stage: the user, Claude, or the 2 together
export type Writer = 'user' | 'claude' | 'both';

export interface StageInfo {
	readonly number: number;
	readonly name: string;
	readonly writer: Writer;
	// The work of the stage, for the panel
	readonly text: string;
	// The rule of the guard for the files of the project in this stage
	readonly guard: string;
	// The next work in this stage
	readonly next: string;
	// The request in words that the user can type in Claude Code in this stage
	readonly request?: string;
}

export const STAGE_INFO: Readonly<Record<Stage, StageInfo>> = {
	brief: {
		number: 1, name: 'Brief', writer: 'user',
		text: 'You write the brief in brief.md, or you give it to Claude in the chat. Each part is optional. Claude gives your text to Shotgun unchanged, and each later stage starts from these words.',
		guard: 'Claude changes no file in this stage.',
		next: 'The user can write the brief. Each part of the brief is optional. The user selects "The brief is ready" when the brief is ready.',
		request: 'Ask me questions about my brief.',
	},
	survey: {
		number: 2, name: 'Survey', writer: 'claude',
		text: 'Claude reads the code. It gives the facts, the tasks and the hooks: the places where new code goes into the code that is there.',
		guard: 'Claude changes no file in this stage.',
		next: 'The user asks Claude for the survey. Claude reads the code and gives the survey to Shotgun.',
		request: 'Survey my brief.',
	},
	order: {
		number: 3, name: 'Order', writer: 'user',
		text: 'You put the tasks in sequence. You can rewrite a task, add a task, or keep a task for later.',
		guard: 'Claude changes no file in this stage.',
		next: 'The user puts the tasks in sequence, and then selects "Accept the order".',
		request: 'Survey my changed tasks.',
	},
	plan: {
		number: 4, name: 'Plan', writer: 'claude',
		text: 'Claude makes the steps of the plan. Shotgun gives each step a risk level, and you can change each level.',
		guard: 'Claude changes no file in this stage.',
		next: 'The user asks Claude for the plan. Then the user examines the levels, and selects "Accept the plan".',
		request: 'Make the plan.',
	},
	build: {
		number: 5, name: 'Build', writer: 'both',
		text: 'You and Claude write the steps. The risk level of a step selects its writer.',
		guard: 'Claude changes files only in an open step of Claude.',
		next: 'The user asks Claude for a step of Claude, or writes a step of the user.',
		request: 'Do step 1.',
	},
	review: {
		number: 6, name: 'Review', writer: 'both',
		text: 'Claude reviews the whole diff of the task with your effort and your focus. You work through the issues.',
		guard: 'Claude changes no file in the review. Claude changes files only in an open step of Claude for an issue.',
		next: 'The user selects the effort and the focus, and asks Claude for the review. Then the user works through the issues, and selects '
			+ '"The task is done".',
		request: 'Review my task.',
	},
};

// build-done: the gate of stage 5. task-done: the gate of stage 6, and of stage 5 in a task of Shotgun 0.2.0 or earlier
export const GATES = ['brief-ready', 'order-tasks', 'accept-order', 'accept-plan', 'build-done', 'task-done'] as const;
export type Gate = (typeof GATES)[number];

// The gate that ends each stage
export const GATE_OF: Readonly<Record<Stage, Gate>> = {
	brief: 'brief-ready',
	survey: 'order-tasks',
	order: 'accept-order',
	plan: 'accept-plan',
	build: 'build-done',
	review: 'task-done',
};

// The text of the button of each gate
export const GATE_LABEL: Readonly<Record<Gate, string>> = {
	'brief-ready': 'The brief is ready',
	'order-tasks': 'Order the tasks',
	'accept-order': 'Accept the order',
	'accept-plan': 'Accept the plan',
	'build-done': 'The build is done',
	'task-done': 'The task is done',
};

export interface GateRecord {
	readonly gate: Gate;
	readonly stage: Stage;
	readonly time: string; // ISO 8601
}

// The state of a task in the stages
export interface Progress {
	readonly stage: Stage;
	readonly isDone: boolean;
	readonly gates: readonly GateRecord[];
}

export const START: Progress = { stage: 'brief', isDone: false, gates: [] };

export const isStage = (value: unknown): value is Stage => typeof value === 'string' && (STAGES as readonly string[]).includes(value);
export const isGate = (value: unknown): value is Gate => typeof value === 'string' && (GATES as readonly string[]).includes(value);

// The text of a stage for a person, for example "stage 1 of 6, the brief"
export function stageText(stage: Stage): string {
	const info = STAGE_INFO[stage];
	return `stage ${info.number} of ${STAGES.length}, the ${info.name.toLowerCase()}`;
}

// The stages that the user can return to (decision 24): each stage before the current stage, and also the current stage of
// a done task
export function returnStages(progress: Progress): Stage[] {
	const index = STAGES.indexOf(progress.stage);
	return STAGES.filter((_, i) => i < index || (progress.isDone && i === index));
}

// The state after a return of the user to an earlier stage (decision 24). The task is in that stage again, and it is not
// done. The progress keeps only the gates before that stage. The ledger keeps all gates and the return
export function returnTo(progress: Progress, stage: Stage): Progress {
	if (!returnStages(progress).includes(stage)) {
		throw new Error(progress.isDone || STAGES.indexOf(stage) < STAGES.indexOf(progress.stage)
			? `The task cannot return to ${stageText(stage)}.`
			: `The task is in ${stageText(progress.stage)}. It can return only to an earlier stage.`);
	}
	const index = STAGES.indexOf(stage);
	return { stage, isDone: false, gates: progress.gates.filter((g) => STAGES.indexOf(g.stage) < index) };
}

// The state after a gate. The gate must be the gate of the current stage, and the task must not be done
export function passGate(progress: Progress, gate: Gate, time: string): Progress {
	if (progress.isDone) {
		throw new Error('The task is done. It has no more gates.');
	}
	const expected = GATE_OF[progress.stage];
	if (gate !== expected) {
		throw new Error(`"${GATE_LABEL[gate]}" is not the gate of ${stageText(progress.stage)}. The gate of this stage is "${GATE_LABEL[expected]}".`);
	}
	const gates = [...progress.gates, { gate, stage: progress.stage, time }];
	const index = STAGES.indexOf(progress.stage);
	if (index === STAGES.length - 1) {
		return { stage: progress.stage, isDone: true, gates };
	}
	return { stage: STAGES[index + 1], isDone: false, gates };
}
