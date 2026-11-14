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
	plan?: PlanView; // stage 4 and later: the plan of Claude with the risk levels
	build?: BuildView; // stage 5: the steps of the build and the current step
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

// The heat of DataFlow for the place that gave the level of a step (decision 13: the badge Engine)
export interface PlanHeatView {
	function: string;
	score: number;
	band: 'cool' | 'warm' | 'hot' | 'very hot';
	isReachComplete: boolean;
	reachUnknown?: string;
	flames?: number;
	reach?: number;
	risk?: number;
	history?: number;
	isSiloed?: boolean;
	signals?: { points: number; text: string }[];
}

// A place of a step, at its lines now
export interface PlanPlaceView {
	name: string; // for example "src/battery.cpp:94-96", or "tests/a.cpp (new)"
	path: string;
	line: number; // the first line now. 0 for a new file
	isNew: boolean;
	isMoved: boolean;
	isLost: boolean; // the code of the place is not in the file now
	level: number | null; // the level of the rules for this place
	excerpt?: ExcerptView;
}

export interface PlanStepView {
	id: string;
	n: number; // the place of the step in the plan, from 1
	title: string;
	task: string; // the id of the task of the order
	taskText: string;
	hooks: string[];
	places: PlanPlaceView[];
	text: string;
	checks: string[];
	note?: string; // the note of Claude
	level: number | null; // the level now: the level of the user, else of the rules. null: no level yet
	rule: number | null; // the level of the rules
	user?: number; // the level of the user
	levelName: string; // for example "High, level 4 of 5"
	writer?: 'claude' | 'frame' | 'user';
	writerText?: string; // what the level means for the build
	reasons: string[]; // the rules that gave the level of the rules
	userNote: string;
	heat?: PlanHeatView;
	isLevelEditable: boolean; // stage 4, or a step in stage 5 that Claude did not start (decision 17)
}

export interface PlanView {
	steps: PlanStepView[];
	writers: { user: number; frame: number; claude: number; none: number };
	changed: { step: string; n: number; level: number | null; rule: number | null; note: string }[]; // the steps with a level of the user
	waiting: number; // the steps with no level yet
	scan: string; // the state of the scan of the call graph at the last check
	riskTime?: string; // the time of the last check of the levels
	isEditable: boolean; // stage 4
	maxNote: number;
}

// A step of the plan in the build (stage 5)
export interface BuildStepView {
	id: string;
	n: number; // the place of the step in the plan, from 1
	title: string;
	level: number | null;
	levelName: string; // for example "Low, level 2 of 5"
	writer: 'claude' | 'user' | 'frame';
	writerText: string; // for example "Claude writes it"
	state: 'todo' | 'open' | 'receipt' | 'holes' | 'done';
	isCurrent: boolean;
	walked?: string; // the marks of the receipt, for example "2 of 3 changes walked: 1 issue"
}

export interface DiffLineView {
	mark: '+' | '-' | ' ';
	line?: number; // the line in the text now. A removed line has no line
	text: string;
}

// A change of a receipt: the words of Claude, the facts of the diff, and the mark of the user
export interface ReceiptChangeView {
	id: string;
	n: number;
	title: string;
	check: string; // what the user checks
	note?: string; // the note of Claude
	place: string; // for example "src/battery.cpp:44-45", or "tests/a.cpp (new)"
	path: string;
	line: number;
	added: number;
	removed: number;
	functions: string[];
	heat?: { function: string; score: number; band: 'cool' | 'warm' | 'hot' | 'very hot' };
	diff: DiffLineView[]; // empty: the diff was too long
	mark: 'todo' | 'ok' | 'issue' | 'question';
	userNote: string;
}

export interface ReceiptView {
	round: number; // the number of the times that Claude opened the step
	time: string;
	added: number;
	removed: number;
	total: number; // the number of the changes
	walked: number; // the changes with a mark
	issues: number;
	questions: number;
	walkText: string; // for example "2 of 3 changes walked: 1 issue"
	changes: ReceiptChangeView[];
	denies: { tool: string; file: string }[]; // the edits that the guard denied while the step was open
	outside: string[]; // the files outside of the scope that changed while the step was open
	deleted: string[];
	looseEnds: { text: string; place?: string; path?: string; line?: number }[];
	notice?: string;
}

// A place of a hint, as a link
export interface HintPlaceView {
	name: string; // for example "src/battery.cpp:59-78"
	path: string;
	line: number;
}

// A hole of a frame: its state in the text now, and the hints that the user opened (P9: they came with the frame)
export interface HoleView {
	n: number;
	question: string;
	place: string; // for example "src/battery.cpp:129"
	path: string;
	line: number;
	state: 'open' | 'done' | 'empty' | 'changed';
	by?: 'user' | 'claude'; // a filled hole: the user, or the answer of Claude
	content?: string; // the code in the place of the marker
	shown: number; // the hints that the user opened, from 0 to 4
	nudge?: string;
	pointer?: { text: string; places: HintPlaceView[] };
	example?: { text: string; place: HintPlaceView; code: string };
	answer?: string;
	facts?: { function?: string; threads: string[]; locks: string[]; names?: string[] }; // the facts of DataFlow at the line of the hole
}

// The current step of the build, with its text, its places and its receipt
export interface CurrentStepView extends BuildStepView {
	total: number;
	text: string;
	checks: string[];
	places: PlanPlaceView[];
	scope: string[];
	round: number;
	baseError?: string; // why the step has no base
	receipt?: ReceiptView;
	isEditable: boolean; // the user can put marks on the receipt now
	holes?: HoleView[]; // the holes of the frame of Claude
	holesDone?: number; // the holes with code, or with a place that Shotgun cannot find
	frameNote?: string; // the note of Claude for the frame
	canRequestFrame: boolean; // a step of level 4 of the user: the button "I want a frame" (decision 16)
	isFrameRequested: boolean;
}

// A callout: a new fact of DataFlow on a line of the user (decision 13: the badge Engine), with the words of Claude
export interface CalloutView {
	id: string;
	kind: 'problem' | 'warning' | 'info';
	source: 'threads' | 'logic' | 'hidden';
	title: string;
	place: string; // for example "src/battery.cpp:129"
	path: string;
	line: number;
	status: 'open' | 'held' | 'waiting' | 'closed' | 'gone'; // held: by the voice. waiting: for the next pause
	proof: string[]; // the facts of the engine with their places
	explanation?: string; // the words of Claude
	closedReason?: string;
}

// The answer of Claude to a question of the user about a line
export interface LineAnswerView {
	id: string;
	place: string;
	path: string;
	line: number;
	question: string; // the words of the user
	answer: string; // the words of Claude
	facts: string[]; // the facts of DataFlow at the line
	resolved: boolean;
}

// The navigator of stage 5: the voice, the callouts of the current step, and the answers on lines
export interface NavigatorView {
	step?: string; // the id of the current step with callouts: a step of the user, or a frame with its holes
	voice: 'quiet' | 'normal' | 'talkative';
	voiceText: string;
	callouts: CalloutView[];
	open: number; // the callouts that show now
	answers: LineAnswerView[];
	maxPerPause: number;
	pauseSeconds: number;
}

export interface BuildView {
	navigator: NavigatorView;
	steps: BuildStepView[];
	current: CurrentStepView | null; // null: each step is done
	done: number;
	total: number;
	maxNote: number; // the maximum length of a note of the user for a change
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

// selectStep: the page shows this step, for example after a click on a CodeLens line in the text editor
export type ToView = { type: 'model'; model: ViewModel } | { type: 'selectStep'; id: string };

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
	| { type: 'editOrder'; edit: OrderEditView }
	| { type: 'setLevel'; step: string; level: number | null } // null: the level of the rules again
	| { type: 'setLevelNote'; step: string; note: string }
	| { type: 'checkLevels' }
	| { type: 'setMark'; step: string; change: string; mark: 'todo' | 'ok' | 'issue' | 'question' } // todo: no mark
	| { type: 'setChangeNote'; step: string; change: string; note: string }
	| { type: 'requestFrame'; step: string } // the button "I want a frame"
	| { type: 'showHint'; step: string; hole: number; level: number } // level 4: the answer of Claude fills the hole
	| { type: 'setVoice'; voice: 'quiet' | 'normal' | 'talkative' }
	| { type: 'closeCallout'; step: string; id: string } // "Not a problem": the extension asks for the reason
	| { type: 'reopenCallout'; step: string; id: string }
	| { type: 'showInDataFlow'; path: string; line: number; source: 'threads' | 'logic' | 'hidden' } // after a click of the user
	| { type: 'resolveAnswer'; id: string };
