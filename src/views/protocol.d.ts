// The messages between the extension and the 2 webviews of Shotgun: the page in the editor area and the panel beside
// the text editor. The extension sends the view model. A webview sends the actions of the user. tsconfig.webview.json
// includes this file, so the 2 sides use the same types.

export type StageName = 'brief' | 'survey' | 'order' | 'plan' | 'build';
export type WriterName = 'user' | 'claude' | 'both';

export interface StageView {
	stage: StageName;
	number: number;
	name: string;
	writer: WriterName;
	state: 'done' | 'current' | 'todo';
}

export interface TaskView {
	id: string;
	title: string;
	created: string;
	stage: StageName;
	stageNumber: number;
	stageName: string;
	writer: WriterName;
	text: string; // the work of the stage
	next: string; // the next work
	guard: string; // the rule of the guard
	request?: string; // a request in words for Claude Code
	brief?: BriefView; // stage 1: the brief and the questions
	survey?: SurveyView; // stage 2 and later: the survey of Claude
	order?: OrderView; // stage 3 and later: the order of the user
	gate?: GateView; // the gate of the stage, if this version of Shotgun has it
	isDone: boolean;
	isPaused: boolean;
}

export interface BriefPartView {
	id: string;
	name: string;
	hasText: boolean;
	summary: string; // for example "4 items" or "no text"
	line?: number; // the line of the heading in brief.md
}

export interface QuestionView {
	id: string;
	text: string;
	partName?: string;
	line?: number; // the line of brief.md that the question is about
}

export interface BriefView {
	file: string;
	parts: BriefPartView[];
	complete: number; // the number of the parts with text
	isComplete: boolean;
	isDirty: boolean; // the text editor has changes that are not saved
	questions: QuestionView[]; // the open questions of Claude
	closed: number; // the number of the closed questions
}

// The facts of DataFlow for a hook (decision 13: the badge Engine)
export interface HookEngineView {
	text: string;
	hasFacts: boolean;
	function?: string;
	type?: string;
	heat?: { function: string; score: number; band: 'cool' | 'warm' | 'hot' | 'very hot'; isReachComplete: boolean; reachUnknown?: string };
}

export interface ExcerptView {
	lines: { line: number; text: string; isHook: boolean }[];
	isCut: boolean; // the hook has more lines than the excerpt
}

export interface HookView {
	id: string;
	title: string;
	kind: string; // the words of Claude
	place: string; // for example "src/battery.cpp:92-107"
	path: string; // the absolute path of the file
	lines: [number, number]; // the lines now: the code of the hook can move after the survey
	isMoved: boolean; // the code of the hook is at different lines now
	isLost: boolean; // the code of the hook is not in the file now
	tasks: string[]; // the ids of the tasks with the hook
	engine?: HookEngineView;
	excerpt?: ExcerptView;
}

export interface SurveyTaskView {
	id: string;
	title: string;
	text?: string;
	hooks: string[];
	needs: string[];
	size?: string; // the estimate of Claude: small, medium or large
}

// A fact of Claude, with the read tool of DataFlow that shows it (decision 13: the badge Model)
export interface FactView {
	text: string;
	place: string;
	path: string;
	line: number;
	tool: string;
}

export interface SurveyQuestionView {
	id: string;
	text: string;
	answer?: string;
}

export interface SurveyView {
	time: string;
	tasks: SurveyTaskView[];
	hooks: HookView[];
	facts: FactView[];
	questions: SurveyQuestionView[];
	isReachComplete: boolean; // false: the scan of the call graph is not complete, so the heat can change
	engineTime?: string; // the time of the last check of the hooks with DataFlow
	isEditable: boolean; // the user can answer the questions: stage 2
}

// A hook of a task in the order, with its place now
export interface OrderHookView {
	id: string;
	place: string; // for example "src/battery.cpp:92-107". Empty if the survey has no hook with this id
	path: string;
	line: number;
}

// A task in the order of the user (stage 3)
export interface OrderTaskView {
	id: string;
	text: string;
	place: number | null; // the place in the plan, from 1. null: the user keeps the task for later
	isNew: boolean; // a task of the user
	isChanged: boolean; // a new task, or a text that is not the text of the survey
	hasSurvey: boolean; // the hooks and the needs are for the text now
	isSurveyedAgain: boolean; // Claude surveyed the task in stage 3
	isLater: boolean;
	hooks: OrderHookView[];
	needsText: string; // for example "needs 1, 2"
	size?: string;
	note?: { by: 'user' | 'claude'; text: string };
	warnings: string[]; // the warnings of the order check for this task
}

export interface OrderView {
	tasks: OrderTaskView[]; // in the order of the user, with the tasks for later at their places
	warnings: string[];
	inPlan: number;
	later: number;
	changed: number; // the tasks in the plan with no survey for their text
	isEditable: boolean; // stage 3
	maxText: number; // the maximum length of the text of a task
}

export interface GateView {
	label: string; // the text of the button
	note: string;
	isEnabled: boolean;
	reason?: string; // why the button is not enabled
	warning?: string; // a fact that the user must know before the gate, for example open questions
	after?: string; // the request in words after the gate
}

export interface DecisionView {
	time: string;
	by: 'user' | 'claude' | 'guard';
	text: string;
}

export interface TaskItem {
	id: string;
	title: string;
	stageNumber: number;
	stageName: string;
	isDone: boolean;
	isActive: boolean;
}

export type ViewCommand = 'newTask' | 'openTask' | 'pause' | 'continue' | 'showPage' | 'connectClaude' | 'connectDataFlow';

// A part that Shotgun needs, with a button if the user must do something
export interface SetupRow {
	id: 'folder' | 'dataflow' | 'claude-dataflow' | 'claude-shotgun';
	isOk: boolean;
	text: string;
	action?: { command: ViewCommand; label: string };
}

export interface ViewModel {
	version: string; // the version of Shotgun
	stages: StageView[];
	task: TaskView | null;
	tasks: TaskItem[];
	decisions: DecisionView[]; // the newest first
	setup: SetupRow[];
	isReady: boolean; // all parts of the setup are OK
	problems: string[]; // the stage files that Shotgun cannot read
}

export type ToView = { type: 'model'; model: ViewModel };

// An edit of the user on the order page. later: true keeps the task for later, and false puts it back into the plan
export type OrderEditView =
	| { action: 'move'; id: string; step: -1 | 1 }
	| { action: 'text'; id: string; text: string }
	| { action: 'add'; text: string }
	| { action: 'later'; id: string; isLater: boolean }
	| { action: 'remove'; id: string };

export type FromView =
	| { type: 'ready' }
	| { type: 'command'; command: ViewCommand }
	| { type: 'selectTask'; id: string }
	| { type: 'copy'; text: string }
	| { type: 'openBrief'; line?: number }
	| { type: 'closeQuestion'; id: string }
	| { type: 'gate' }
	| { type: 'openPlace'; path: string; line: number }
	| { type: 'saveAnswer'; id: string; text: string }
	| { type: 'checkHooks' }
	| { type: 'editOrder'; edit: OrderEditView };
