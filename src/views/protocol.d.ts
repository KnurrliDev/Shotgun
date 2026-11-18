// The messages between the extension and the 2 webviews of Shotgun: the page in the editor area and the panel beside
// the text editor. The extension sends the view model. A webview sends the actions of the user. tsconfig.webview.json
// includes this file, so the 2 sides use the same types.

export type StageName = 'brief' | 'survey' | 'order' | 'plan' | 'build' | 'review';
export type WriterName = 'user' | 'claude' | 'both';

export interface StageView {
	stage: StageName;
	number: number;
	name: string;
	writer: WriterName;
	state: 'done' | 'current' | 'todo';
	canReturn: boolean; // the user can return the active task to this stage (decision 24)
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
	build?: BuildView; // stage 5: the steps of the build and the current step. Stage 6: also the steps of the issues (P22)
	review?: ReviewView; // stage 6: the effort, the focus and the issues of the review
	ledger?: LedgerView; // the stages 5 and 6, and after the end of the task: the ledger and the commit message
	gate?: GateView; // the gate of the stage, if this version of Shotgun has it
	stepGate?: GateView; // stage 6: the gate of the current step of an issue. Its button posts stepGate
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

// A decision of a step (decision 31): open, or with the answer of the user. by: Claude gave it in the plan, or the user
// added it
export interface StepDecisionView {
	id: string; // D1 to D3 of Claude, U1 to U3 of the user
	question: string;
	options: string[];
	by: 'claude' | 'user';
	answer?: string;
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
	isLevelEditable: boolean; // stage 4, or a step in stage 5 that Claude did not start (decision 17). Also for the decisions
	decisions?: StepDecisionView[]; // undefined: a plan of version 0.1.0 or a loose end, with the level of the heat only (P34)
	isCapped: boolean; // the step has no open decision, so the level of the rules is at most 2 (decision 31)
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
	maxQuestion: number; // the maximum length of a decision of the user
	maxAnswer: number; // the maximum length of an answer of the user
	maxUserDecisions: number; // the decisions that the user can add to a step
}

// A step of the plan in the build (stage 5)
export interface BuildStepView {
	id: string;
	n: number; // the place of the step in the plan, from 1
	ref: string; // the step in a text: its number, or the id of the issue for the step of an issue, for example I3
	issue?: string; // the id of the issue for the step of an issue in stage 6
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
	choices: { decision: string; question: string; choice: string }[]; // the choices of Claude for the open decisions (P31)
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
	canRequestFrame: boolean; // a step of level 4 of the user with an open decision: the button "I want a frame" (decision 16)
	isFrameRequested: boolean;
	decisions?: StepDecisionView[]; // the decisions of the step with the answers of the user (decision 31)
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

// A loose end of the build (phase 9): a place that a change of a step can also need. mechanical: Claude can do it, and a
// click of the user hands it over. decision: the user decides it. The facts of the engine have the badge Engine, and a
// loose end of Claude has the badge Model
export interface LooseEndView {
	id: string;
	kind: 'mechanical' | 'decision';
	source: 'members' | 'switch' | 'ripple' | 'claude';
	title: string;
	proof: string[];
	place?: string; // for example "src/settings_io.cpp:38-45"
	path?: string;
	line?: number;
	state: 'open' | 'handed' | 'closed';
	stepN: number; // the number of the step that made the loose end
	step: string; // the step that made the loose end in a text: its number, or the id of the issue
	// the step of Claude for the loose end
	handed?: { id: string; n: number; ref: string; state: 'todo' | 'open' | 'receipt' | 'holes' | 'done' };
	reason?: string; // the reason of the user for a closed loose end
}

export interface LooseView {
	ends: LooseEndView[];
	checked: string; // for example "after steps 1 to 4"
	open: number;
	request?: string; // the request for Claude Code when the current step is a loose end for Claude
}

// The commit message in Source Control, and the check of Claude (phase 9)
export interface MessagePointView {
	kind: 'ok' | 'missing' | 'wrong' | 'question';
	text: string;
	place?: string;
	path?: string;
	line?: number;
}

export interface MessageView {
	hasRepository: boolean;
	text: string; // the message in the input box of Source Control now
	check?: { agrees: boolean; points: MessagePointView[]; note?: string; time: string; isOld: boolean }; // isOld: the message changed after the check
	request: string; // "Check my commit message."
}

// The lines of each writer in a file of the ledger
export interface LedgerRowView {
	file: string;
	path: string;
	user: number;
	walked: number;
	notWalked: number;
	firstNotWalked?: number;
	firstNotWalkedLines?: [number, number]; // the first run of Claude that the user did not walk
}

// The ledger of the task (phase 9): the decisions, the lines of each writer, and the commit message
export interface LedgerView {
	rows: LedgerRowView[];
	user: number; // the lines of the user
	walked: number; // the lines of Claude that the user walked
	notWalked: number;
	decisions: { user: number; claude: number };
	userDecisions: { n: number; text: string; time: string }[];
	markdown: string; // the text for a pull request
	message: MessageView;
}

export interface BuildView {
	navigator: NavigatorView;
	loose: LooseView;
	steps: BuildStepView[];
	current: CurrentStepView | null; // null: each step is done
	done: number;
	total: number;
	maxNote: number; // the maximum length of a note of the user for a change
}

// A place of an issue of the review, at its lines now
export interface IssuePlaceView {
	name: string; // for example "src/battery.cpp:101-103"
	path: string; // absolute
	line: number;
	lines: [number, number];
}

// An issue of the review of Claude (P19)
export interface IssueView {
	id: string;
	title: string;
	summary: string;
	scenario: { trigger: string; path: string; result: string; interleave?: string };
	category: string;
	areaName: string;
	severity: 'important' | 'minor';
	origin: 'new' | 'pre-existing';
	verdict: 'confirmed' | 'plausible';
	source: 'engine' | 'model';
	place: IssuePlaceView;
	fixPlaces: IssuePlaceView[];
	decisions: { id: string; question: string; options?: string[] }[];
	tools: string[];
	list: 'steps' | 'second';
	listReason?: string; // why the issue is in the second list
	state: 'open' | 'fixed' | 'closed';
	reason?: string; // the reason of the user for "Not a problem"
	evidence?: string; // the new evidence of Claude for an issue that the user closed before
	round: number;
	isUserStep?: boolean; // the user made the issue of the second list a step
	step?: IssueStepView; // the step of an issue of the list of steps that the user did not close (P22)
}

// The step of an issue in stage 6: its state in the build, its level and its writer
export interface IssueStepView {
	state: 'todo' | 'open' | 'receipt' | 'holes' | 'done';
	isCurrent: boolean;
	level: number | null;
	levelName: string; // for example "High, level 4 of 5"
	writer: 'claude' | 'user' | 'frame';
	writerText: string; // for example "You write it"
	user?: number; // the level of the user
	heatLevel?: number; // the level that the heat of the places gives. Only a hint: the level of the step is 4 (P22)
	isLevelEditable: boolean; // a step that Claude did not start: the buttons Lower and Raise, and the answers to the decisions
	decisions?: StepDecisionView[]; // the open decisions of the fix with the answers of the user, as on the plan page
}

export interface EffortView {
	id: string;
	name: string;
	finders: string;
	context: string;
	verify: string;
}

export interface AreaView {
	id: string;
	name: string;
	looksFor: string;
}

// Stage 6: the effort and the focus of the next review, the request, and the 2 lists of the last review (P22)
export interface ReviewView {
	effort: string;
	areas: string[];
	text: string;
	efforts: EffortView[];
	allAreas: AreaView[];
	maxText: number;
	maxReason: number;
	maxAnswer: number; // the limits of the decisions of the steps of the issues
	maxQuestion: number;
	maxUserDecisions: number;
	prompt: string; // the prompt of the review for a new session of Claude Code
	nextRound: number; // the round of the next review (P23)
	isNewRound: boolean; // the next review is a new round that checks the fixes
	toCheck: number; // the fixed issues that the next round checks
	roundWarning?: string; // after 3 rounds: think about the approach again. The extension asks before it copies the prompt
	feedback?: FeedbackView; // the feedback of the user from the reviews of all tasks of the folder (P35)
	brief?: { specs: string[]; scope: string[]; done: string[] }; // the parts of the brief for the issues of the area The brief
	base?: string; // for example "1a2b3c4, 2 files with changes that were not committed"
	baseError?: string; // why the review has no base commit
	round?: { n: number; time: string; effortName: string; areaNames: string[]; cap: number; changedLines: number; note?: string };
	steps: IssueView[]; // the list of steps
	second: IssueView[]; // the second list
	open: number; // the open issues of the list of steps
	closed: number;
}

// The issues of the list of steps that the user decided in all tasks of the folder: fixed, or closed with no action (P35)
export interface FeedbackView {
	decided: number;
	areas: { id: string; name: string; decided: number; noAction: number; rate: string; isTooNoisy: boolean; isInFocus: boolean }[];
	cap?: number; // the cap on the steps from the feedback
	text: string; // the feedback in 1 sentence
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
export type ToView = { type: 'model'; model: ViewModel } | { type: 'selectStep'; id: string } | { type: 'showLedger' };

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
	// a click on a hook or on a place of a step: the side view of DataFlow with the lines highlighted and a note (decision 26)
	| { type: 'showPlace'; path: string; lines: [number, number]; note: string }
	// a click on a stage chip: the user returns the active task to that stage (decision 24)
	| { type: 'returnToStage'; stage: StageName }
	| { type: 'saveAnswer'; id: string; text: string }
	| { type: 'checkHooks' }
	| { type: 'editOrder'; edit: OrderEditView }
	| { type: 'setLevel'; step: string; level: number | null } // null: the level of the rules again
	| { type: 'setLevelNote'; step: string; note: string }
	// the decisions of a step (P29): an answer in words, an empty answer opens the decision again, a decision of the user
	| { type: 'answerDecision'; step: string; decision: string; text: string }
	| { type: 'addDecision'; step: string; question: string }
	| { type: 'removeDecision'; step: string; decision: string }
	| { type: 'checkLevels' }
	| { type: 'setMark'; step: string; change: string; mark: 'todo' | 'ok' | 'issue' | 'question' } // todo: no mark
	| { type: 'setChangeNote'; step: string; change: string; note: string }
	| { type: 'requestFrame'; step: string } // the button "I want a frame"
	| { type: 'showHint'; step: string; hole: number; level: number } // level 4: the answer of Claude fills the hole
	| { type: 'setVoice'; voice: 'quiet' | 'normal' | 'talkative' }
	| { type: 'closeCallout'; step: string; id: string } // "Not a problem": the extension asks for the reason
	| { type: 'reopenCallout'; step: string; id: string }
	| { type: 'showInDataFlow'; path: string; line: number; source: 'threads' | 'logic' | 'hidden' } // after a click of the user
	| { type: 'resolveAnswer'; id: string }
	| { type: 'handLooseEnd'; id: string } // the button "Hand to Claude" (decision 21)
	| { type: 'closeLooseEnd'; id: string } // the extension asks for the reason
	| { type: 'reopenLooseEnd'; id: string }
	| { type: 'showLedger' } // the page shows the ledger
	| { type: 'copyLedger' } // the extension copies the ledger as Markdown for a pull request
	| { type: 'setReviewOptions'; effort: string; areas: string[]; text: string } // the effort and the focus of the next review
	| { type: 'copyReviewPrompt' } // the prompt of the review for a new session of Claude Code
	| { type: 'closeIssue'; id: string } // "Not a problem": the extension asks for the reason
	| { type: 'reopenIssue'; id: string }
	| { type: 'setIssueStep'; id: string; isStep: boolean } // "Make it a step", or "Back to the second list"
	| { type: 'stepGate' }; // the gate of the current step in stage 6: "The step is done" or "Accept the receipt"
