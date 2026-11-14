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
	gate?: string; // the text of the gate of the stage
	isDone: boolean;
	isPaused: boolean;
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
	| { type: 'copy'; text: string };
