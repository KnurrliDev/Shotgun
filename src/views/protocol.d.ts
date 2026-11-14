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

export type FromView =
	| { type: 'ready' }
	| { type: 'command'; command: ViewCommand }
	| { type: 'selectTask'; id: string }
	| { type: 'copy'; text: string }
	| { type: 'openBrief'; line?: number }
	| { type: 'closeQuestion'; id: string }
	| { type: 'gate' };
