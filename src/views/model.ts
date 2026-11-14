import * as path from 'path';
import type { ClaudeState } from '../claude/connection';
import { MIN_DATAFLOW } from '../dataflow/version';
import { parseBrief, partName, partSummary, questionLine } from '../session/brief';
import type { Decision, TaskFile } from '../session/files';
import { changedTasks, factsOf, MAX_TASK_TEXT, orderOf, orderWarnings } from '../session/order';
import {
	buildNext, buildWriterOf, currentStep, diffLines, MAX_CHANGE_NOTE, receiptCounts, stateOf, walkText,
} from '../session/build';
import { calloutStatus, DEFAULT_PAUSE_SECONDS, DEFAULT_VOICE, MAX_PER_PAUSE, Voice, VOICE_TEXT } from '../session/callouts';
import { findMarkers, Hole, holeNow, isHoleDone } from '../session/frame';
import { absolutePath } from '../session/paths';
import { levelOf, MAX_LEVEL_NOTE, placeName } from '../session/plan';
import { LEVEL_INFO } from '../session/risk';
import { GATE_LABEL, STAGE_INFO, STAGES, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import { excerptOf, findHook, Lines } from '../session/survey';
import type {
	BriefView, BuildStepView, BuildView, CurrentStepView, DecisionView, GateView, HoleView, HookView, NavigatorView, OrderTaskView, OrderView, PlanPlaceView,
	PlanStepView, PlanView, ReceiptView, SetupRow, StageView, SurveyView, TaskView, ViewModel,
} from './protocol';

// The view model of the page and of the panel, from the session, the state of DataFlow and the connection to Claude
// Code. These functions use no VS Code API, so the unit tests can call them directly.

// The state of DataFlow for the views, with no API object
export interface DataFlowView {
	readonly state: 'linking' | 'missing' | 'old' | 'failed' | 'ready';
	readonly version?: string;
	readonly reason?: string; // the reason of the state failed
	readonly engine?: 'stopped' | 'starting' | 'ready' | 'failed';
	readonly engineError?: string;
	readonly toolsError?: string; // the reason why DataFlow did not add the tools of Shotgun
}

export interface ModelInput {
	readonly version: string; // the version of Shotgun
	readonly snapshot: Snapshot;
	readonly dataflow: DataFlowView;
	readonly claude: ClaudeState;
	// the brief of the active task: the text of the open text editor, else of the file
	readonly brief?: { readonly file: string; readonly text: string; readonly isDirty: boolean };
	// the lines of a file of the project now, for the hooks of the survey. undefined: no file
	readonly readLines?: (file: string) => readonly string[] | undefined;
	// the settings of the callouts (decision 19)
	readonly voice?: Voice;
	readonly pauseSeconds?: number;
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const placeText = (file: string, lines: Lines): string => (lines[0] === lines[1] ? `${file}:${lines[0]}` : `${file}:${lines[0]}-${lines[1]}`);

// The maximum number of decisions in the views
const MAX_DECISIONS = 30;

export function decisionText(decision: Decision): string {
	switch (decision.kind) {
		case 'task':
			return `${decision.by === 'claude' ? 'Claude' : 'You'} started the task "${decision.title}".`;
		case 'gate':
			return `You passed the gate "${GATE_LABEL[decision.gate]}" of stage ${STAGE_INFO[decision.stage].number}.`;
		case 'pause':
			return 'You paused the guard for work outside of the task.';
		case 'continue':
			return 'You continued the task. The guard is on.';
		case 'deny':
			return `The guard stopped ${decision.tool} of ${decision.file}.`;
		case 'brief':
			return `Claude gave your brief from the chat: ${decision.lines === 1 ? '1 line' : `${decision.lines} lines`} of your words.`;
		case 'questions':
			return `Claude asked ${decision.count === 1 ? '1 question' : `${decision.count} questions`} about the brief.`;
		case 'question':
			return `You closed the question "${decision.text}".`;
		case 'survey':
			return `Claude gave the survey: ${count(decision.tasks, 'task')}, ${count(decision.hooks, 'hook')}, ${count(decision.facts, 'fact')} `
				+ `and ${count(decision.questions, 'question')}.`;
		case 'answer':
			return decision.text ? `You answered the question ${decision.id}: "${decision.text}".` : `You removed the answer to the question ${decision.id}.`;
		case 'order':
			switch (decision.action) {
				case 'move':
					return `You moved "${decision.text}" to place ${decision.position ?? '?'}.`;
				case 'text':
					return decision.text ? `You changed the text of task ${decision.task} to "${decision.text}".` : `You removed the text of task ${decision.task}.`;
				case 'add':
					return `You added the task "${decision.text}".`;
				case 'later':
					return `You kept "${decision.text}" for later.`;
				case 'now':
					return `You put "${decision.text}" back into the plan.`;
				case 'remove':
					return `You removed the task "${decision.text}".`;
			}
			return 'You changed the order.';
		case 'task-survey':
			return `Claude surveyed the task ${decision.task}: ${count(decision.hooks, 'hook')}, and it needs ${decision.needs === 0 ? 'no task' : count(decision.needs, 'task')}.`;
		case 'plan':
			return `Claude gave the plan: ${count(decision.steps, 'step')}.`;
		case 'level':
			if (decision.level === null) {
				return `You set step ${decision.step} back to the level of the rules${decision.rule ? `, ${decision.rule}` : ''}.`;
			}
			return `You set step ${decision.step} to level ${decision.level}.${decision.rule ? ` The rules gave ${decision.rule}.` : ''}`;
		case 'level-note':
			return decision.text ? `Your note for step ${decision.step}: "${decision.text}".` : `You removed your note for step ${decision.step}.`;
		case 'step':
			return decision.round > 1 ? `Claude opened step ${decision.step} again, round ${decision.round}.` : `Claude opened step ${decision.step}.`;
		case 'errand':
			return `Claude gave the receipt of step ${decision.step}: ${count(decision.changes, 'change')}, +${decision.added} −${decision.removed}`
				+ `${decision.looseEnds > 0 ? `, ${count(decision.looseEnds, 'loose end')}` : ''}.`;
		case 'mark':
			return decision.mark === 'todo' ? `You removed your mark on change ${decision.change} of step ${decision.step}.`
				: `You marked change ${decision.change} of step ${decision.step}: ${MARK_WORDS[decision.mark]}.`;
		case 'change-note':
			return decision.text ? `Your note for change ${decision.change} of step ${decision.step}: "${decision.text}".`
				: `You removed your note for change ${decision.change} of step ${decision.step}.`;
		case 'step-gate':
			return decision.gate === 'accept-receipt'
				? `You accepted the receipt of step ${decision.step}.${decision.notWalked > 0 ? ` ${count(decision.notWalked, 'change')} not walked.` : ''}`
				: `You ended step ${decision.step}: "The step is done".`;
		case 'frame-request':
			return `You asked for a frame of Claude for step ${decision.step}.`;
		case 'frame':
			return `Claude gave the frame of step ${decision.step}: ${count(decision.holes, 'hole')}.`;
		case 'hint':
			return decision.level >= 4 ? `The answer of Claude filled hole ${decision.hole} of step ${decision.step}.`
				: `You opened hint ${decision.level} of hole ${decision.hole} of step ${decision.step}.`;
		case 'callout-close':
			return `You closed the callout "${decision.title}" of step ${decision.step}: not a problem. Your reason: "${decision.reason}".`;
		case 'callout-open':
			return `You opened the callout ${decision.callout} of step ${decision.step} again.`;
		case 'explanation':
			return `Claude explained the callout ${decision.callout} of step ${decision.step}.`;
		case 'line-answer':
			return `Claude answered your question about ${decision.file}:${decision.line}: "${decision.question}".`;
		case 'line-resolve':
			return `You resolved the question ${decision.answer}.`;
	}
}

const MARK_WORDS = { ok: 'OK', issue: 'issue', question: 'question' } as const;

// Stage 2 and later: the survey of Claude with the facts of DataFlow. The hooks are in the text as it is now
function surveyView(snapshot: Snapshot, readLines: ModelInput['readLines']): SurveyView | undefined {
	const { survey, root, task } = snapshot;
	if (!survey || !root || !task) {
		return undefined;
	}
	const files = new Map<string, readonly string[] | undefined>();
	const linesOf = (file: string) => {
		if (!files.has(file)) {
			files.set(file, readLines?.(file));
		}
		return files.get(file);
	};
	const hooks: HookView[] = survey.hooks.map((h) => {
		const file = absolutePath(h.file, root);
		const text = linesOf(file);
		const found = text ? findHook(text, h) : undefined;
		const lines = found ?? h.lines;
		const engine = snapshot.engine?.hooks[h.id];
		return {
			id: h.id,
			title: h.title,
			kind: h.kind,
			place: placeText(h.file, h.lines),
			path: file,
			lines: [lines[0], lines[1]],
			isMoved: !!found && found[0] !== h.lines[0],
			isLost: !!text && !found,
			tasks: survey.tasks.filter((t) => t.hooks.includes(h.id)).map((t) => t.id),
			...(engine ? { engine: { ...engine } } : {}),
			...(text ? { excerpt: excerptOf(text, lines) } : {}),
		};
	});
	return {
		time: survey.time,
		tasks: survey.tasks.map((t) => ({
			id: t.id, title: t.title, ...(t.text ? { text: t.text } : {}), hooks: [...t.hooks], needs: [...t.needs], ...(t.size ? { size: t.size } : {}),
		})),
		hooks,
		facts: survey.facts.map((f) => ({ text: f.text, place: placeText(f.file, f.lines), path: absolutePath(f.file, root), line: f.lines[0], tool: f.tool })),
		questions: survey.questions.map((q) => ({ id: q.id, text: q.text, ...(snapshot.answers[q.id] ? { answer: snapshot.answers[q.id].text } : {}) })),
		isReachComplete: snapshot.engine?.isReachComplete ?? false,
		...(snapshot.engine ? { engineTime: snapshot.engine.time } : {}),
		isEditable: task.stage === 'survey' && !task.isDone,
	};
}

// Stage 3 and later: the order of the user, with the facts of each task and the order check. survey: the hooks at
// their lines now
function orderView(snapshot: Snapshot, survey: SurveyView | undefined): OrderView | undefined {
	const { task } = snapshot;
	if (!task || !snapshot.survey || task.stage === 'brief' || task.stage === 'survey') {
		return undefined;
	}
	const order = orderOf(snapshot.order, snapshot.survey);
	const plan = order.tasks.filter((t) => !t.isLater);
	const place = (id: string) => plan.findIndex((t) => t.id === id) + 1;
	const warnings = orderWarnings(order, snapshot.survey);
	const hooks = new Map((survey?.hooks ?? []).map((h) => [h.id, h]));
	const tasks: OrderTaskView[] = order.tasks.map((t) => {
		const facts = factsOf(t, snapshot.survey);
		const needs = facts.needs.map(place).filter((p) => p > 0).sort((a, b) => a - b);
		let needsText = needs.length > 0 ? `needs ${needs.join(', ')}` : 'needs no task';
		if (t.isLater) {
			needsText = 'later';
		} else if (t.isNew && !facts.hasSurvey) {
			needsText = 'needs not known';
		}
		let note: OrderTaskView['note'];
		if (t.isNew && !facts.hasSurvey) {
			note = { by: 'user', text: 'Your task. It has no survey yet: no hooks and no needs.' };
		} else if (!facts.hasSurvey) {
			note = { by: 'user', text: `You changed the text. The hooks and the needs are from the old text: "${facts.oldText ?? ''}".` };
		} else if (facts.note) {
			note = { by: 'claude', text: facts.note };
		}
		return {
			id: t.id,
			text: t.text,
			place: t.isLater ? null : place(t.id),
			isNew: t.isNew,
			isChanged: facts.isChanged,
			hasSurvey: facts.hasSurvey,
			isSurveyedAgain: facts.isSurveyedAgain,
			isLater: t.isLater,
			hooks: facts.hooks.map((id) => {
				const h = hooks.get(id);
				return h ? { id, place: h.place, path: h.path, line: h.lines[0] } : { id, place: '', path: '', line: 0 };
			}),
			needsText,
			...(facts.size ? { size: facts.size } : {}),
			...(note ? { note } : {}),
			warnings: warnings.filter((w) => w.task === t.id).map((w) => w.text),
		};
	});
	return {
		tasks,
		warnings: warnings.map((w) => w.text),
		inPlan: plan.length,
		later: order.tasks.length - plan.length,
		changed: changedTasks(order, snapshot.survey).length,
		isEditable: task.stage === 'order' && !task.isDone,
		maxText: MAX_TASK_TEXT,
	};
}

// Stage 4 and later: the plan of Claude, with the level of each step and the places at their lines now
function planView(snapshot: Snapshot, readLines: ModelInput['readLines']): PlanView | undefined {
	const { task, plan, risk, levels, root } = snapshot;
	if (!task || !plan || !root) {
		return undefined;
	}
	const order = orderOf(snapshot.order, snapshot.survey);
	const files = new Map<string, readonly string[] | undefined>();
	const linesOf = (file: string) => {
		if (!files.has(file)) {
			files.set(file, readLines?.(file));
		}
		return files.get(file);
	};
	const steps: PlanStepView[] = plan.steps.map((s, i) => {
		const l = levelOf(s.id, risk, levels);
		const stepRisk = risk?.steps[s.id];
		const places: PlanPlaceView[] = s.places.map((p, j) => {
			const path = absolutePath(p.file, root);
			const level = stepRisk?.places[j]?.level ?? null;
			if (!p.lines) {
				return { name: placeName(p), path, line: 0, isNew: true, isMoved: false, isLost: false, level };
			}
			const text = linesOf(path);
			const found = text && p.code ? findHook(text, { lines: p.lines, code: p.code, codeLine: p.codeLine }) : undefined;
			const lines = found ?? p.lines;
			return {
				name: placeName({ ...p, lines }), path, line: lines[0], isNew: false, isMoved: !!found && found[0] !== p.lines[0], isLost: !!text && !!p.code && !found,
				level, ...(text ? { excerpt: excerptOf(text, lines) } : {}),
			};
		});
		// the heat of the place with the highest level
		const hottest = [...(stepRisk?.places ?? [])].filter((p) => p.heat).sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
		const info = l.level ? LEVEL_INFO[l.level] : undefined;
		return {
			id: s.id,
			n: i + 1,
			title: s.title,
			task: s.task,
			taskText: order.tasks.find((t) => t.id === s.task)?.text ?? s.task,
			hooks: [...s.hooks],
			places,
			text: s.text,
			checks: [...s.checks],
			...(s.note ? { note: s.note } : {}),
			level: l.level,
			rule: l.rule,
			...(l.user ? { user: l.user } : {}),
			levelName: info ? `${info.name}, level ${l.level} of 5` : 'No level yet',
			...(info ? { writer: info.writer, writerText: info.text } : {}),
			reasons: [...(stepRisk?.reasons ?? ['Shotgun did not check the step with DataFlow yet.'])],
			userNote: levels?.levels[s.id]?.note ?? '',
			isLevelEditable: !task.isDone && (task.stage === 'plan' || (task.stage === 'build' && (stateOf(snapshot.build, s.id) === 'todo'
				|| (stateOf(snapshot.build, s.id) === 'open' && snapshot.build?.steps[s.id]?.writer === 'user')))),
			...(hottest?.heat ? { heat: { ...hottest.heat, signals: [...(hottest.heat.signals ?? [])] } } : {}),
		};
	});
	const writers = (w: PlanStepView['writer']) => steps.filter((s) => s.writer === w).length;
	return {
		steps,
		writers: { user: writers('user'), frame: writers('frame'), claude: writers('claude'), none: steps.filter((s) => !s.writer).length },
		changed: steps.filter((s) => s.user !== undefined).map((s) => ({ step: s.id, n: s.n, level: s.level, rule: s.rule, note: s.userNote })),
		waiting: steps.filter((s) => s.level === null).length,
		scan: risk?.scan ?? 'none',
		...(risk ? { riskTime: risk.time } : {}),
		isEditable: task.stage === 'plan' && !task.isDone,
		maxNote: MAX_LEVEL_NOTE,
	};
}

const WRITER_TEXT = { claude: 'Claude writes it', user: 'You write it', frame: 'Claude writes the frame, and you fill its holes' } as const;

// The holes of a frame with their state in the text now, and the hints that the user opened
function holeViews(holes: readonly Hole[], root: string, readLines: ModelInput['readLines']): HoleView[] {
	const files = new Map<string, readonly string[]>();
	const linesOf = (file: string) => {
		if (!files.has(file)) {
			files.set(file, readLines?.(absolutePath(file, root)) ?? []);
		}
		return files.get(file)!;
	};
	const link = (file: string, lines: readonly [number, number]) => ({
		name: placeName({ file, lines: [lines[0], lines[1]] }), path: absolutePath(file, root), line: lines[0],
	});
	return holes.map((h) => {
		const lines = linesOf(h.file);
		const now = holeNow(lines, h, findMarkers(lines.join('\n')));
		const isDone = now.state === 'done';
		return {
			n: h.n,
			question: h.question,
			place: `${h.file}:${now.line}`,
			path: absolutePath(h.file, root),
			line: now.line,
			state: now.state,
			...(isDone ? { by: h.shown >= 4 ? 'claude' as const : 'user' as const } : {}),
			...(now.content ? { content: now.content } : {}),
			shown: h.shown,
			...(h.shown >= 1 ? { nudge: h.hints.nudge } : {}),
			...(h.shown >= 2 ? { pointer: { text: h.hints.pointer.text, places: h.hints.pointer.places.map((p) => link(p.file, p.lines)) } } : {}),
			...(h.shown >= 3 ? { example: { text: h.hints.example.text, place: link(h.hints.example.file, h.hints.example.lines), code: h.hints.example.code } } : {}),
			...(h.shown >= 4 ? { answer: h.hints.answer } : {}),
			...(h.facts ? {
				facts: {
					...(h.facts.function ? { function: h.facts.function } : {}), threads: [...h.facts.threads], locks: [...h.facts.locks],
					...(h.facts.names ? { names: [...h.facts.names] } : {}),
				},
			} : {}),
		};
	});
}

// Stage 5: the navigator: the voice, the callouts of the current step of the user, and the answers of Claude on lines
function navigatorView(snapshot: Snapshot, voice: Voice, pauseSeconds: number): NavigatorView {
	const { plan, build, root } = snapshot;
	const steps = plan?.steps ?? [];
	const n = steps.findIndex((s) => build?.steps[s.id]?.state !== 'done');
	const b = n >= 0 ? build?.steps[steps[n].id] : undefined;
	const step = b && ((b.writer === 'user' && b.state === 'open') || (b.writer === 'frame' && b.state === 'holes')) ? steps[n].id : undefined;
	const callouts = (step ? snapshot.callouts?.steps[step]?.callouts ?? [] : []).filter((c) => !c.isGone).map((c) => ({
		id: c.id, kind: c.kind, source: c.source, title: c.title, place: `${c.file}:${c.line}`, path: absolutePath(c.file, root ?? ''), line: c.line,
		status: calloutStatus(c, voice), proof: [...c.proof], ...(c.explanation ? { explanation: c.explanation.text } : {}),
		...(c.closed ? { closedReason: c.closed.reason } : {}),
	}));
	return {
		...(step ? { step } : {}),
		voice,
		voiceText: VOICE_TEXT[voice],
		callouts,
		open: callouts.filter((c) => c.status === 'open').length,
		answers: (snapshot.callouts?.answers ?? []).map((a) => ({
			id: a.id, place: `${a.file}:${a.line}`, path: absolutePath(a.file, root ?? ''), line: a.line, question: a.question, answer: a.answer,
			facts: [...a.facts], resolved: !!a.resolved,
		})),
		maxPerPause: MAX_PER_PAUSE,
		pauseSeconds,
	};
}

// Stage 5: the steps in sequence, and the current step with its receipt. plan: the steps of the plan view, with their
// places at the lines now
function buildView(snapshot: Snapshot, plan: PlanView, readLines: ModelInput['readLines'], navigator: NavigatorView): BuildView | undefined {
	const { task, risk, levels, build, root } = snapshot;
	if (!task || !snapshot.plan || !root) {
		return undefined;
	}
	const current = currentStep(snapshot.plan, risk, levels, build);
	const steps: BuildStepView[] = snapshot.plan.steps.map((s, i) => {
		const b = build?.steps[s.id];
		const level = b?.level ?? levelOf(s.id, risk, levels).level;
		const writer = b?.writer ?? buildWriterOf(level);
		return {
			id: s.id,
			n: i + 1,
			title: s.title,
			level,
			levelName: level ? `${LEVEL_INFO[level].name}, level ${level} of 5` : 'No level',
			writer,
			writerText: writer === 'frame' && b?.isFrameRequested ? `You asked for a frame. ${WRITER_TEXT.frame}` : WRITER_TEXT[writer],
			state: stateOf(build, s.id),
			isCurrent: current?.step.id === s.id,
			...(b?.receipt ? { walked: walkText(b.receipt) } : {}),
		};
	});
	let view: CurrentStepView | null = null;
	if (current) {
		const b = current.build;
		const receipt = b?.receipt;
		const planStep = plan.steps[current.n - 1];
		let receiptView: ReceiptView | undefined;
		if (receipt) {
			const c = receiptCounts(receipt);
			receiptView = {
				round: receipt.round,
				time: receipt.time,
				added: c.added,
				removed: c.removed,
				total: c.changes,
				walked: c.walked,
				issues: c.issues,
				questions: c.questions,
				walkText: walkText(receipt),
				changes: receipt.changes.map((ch, i) => {
					const hot = ch.hunks.flatMap((h) => h.heat ?? []).sort((a, b) => b.score - a.score)[0];
					return {
						id: ch.id,
						n: i + 1,
						title: ch.title,
						check: ch.check,
						...(ch.note ? { note: ch.note } : {}),
						place: ch.isNewFile ? `${ch.file} (new)` : placeName({ file: ch.file, lines: ch.lines }),
						path: absolutePath(ch.file, root),
						line: ch.lines[0],
						added: ch.added,
						removed: ch.removed,
						functions: [...new Set(ch.hunks.flatMap((h) => h.functions ?? []))],
						...(hot ? { heat: { function: hot.function, score: hot.score, band: hot.band } } : {}),
						diff: ch.hunks.every((h) => h.diff) ? ch.hunks.flatMap((h, j) => [
							...(j > 0 ? [{ mark: ' ' as const, text: '…' }] : []), ...diffLines(h.diff!),
						]) : [],
						mark: ch.mark,
						userNote: ch.userNote ?? '',
					};
				}),
				denies: receipt.denies.map((d) => ({ tool: d.tool, file: d.file })),
				outside: [...receipt.outside],
				deleted: [...receipt.deleted],
				looseEnds: receipt.looseEnds.map((e) => ({
					text: e.text,
					...(e.file ? { place: e.lines ? placeName({ file: e.file, lines: e.lines }) : e.file, path: absolutePath(e.file, root), line: e.lines?.[0] ?? 1 } : {}),
				})),
				...(receipt.notice ? { notice: receipt.notice } : {}),
			};
		}
		view = {
			...steps[current.n - 1],
			total: steps.length,
			text: current.step.text,
			checks: [...current.step.checks],
			places: planStep ? planStep.places : [],
			scope: [...(b?.scope ?? [...new Set(current.step.places.map((p) => p.file))])],
			round: b?.round ?? 0,
			...(b?.baseError ? { baseError: b.baseError } : {}),
			...(receiptView ? { receipt: receiptView } : {}),
			isEditable: current.state === 'receipt' && !task.isDone,
			...(b?.holes ? (() => {
				const holes = holeViews(b.holes, root, readLines);
				return { holes, holesDone: holes.filter((h) => isHoleDone(h.state)).length };
			})() : {}),
			...(b?.frameNote ? { frameNote: b.frameNote } : {}),
			canRequestFrame: !task.isDone && current.writer === 'user' && current.level === 4 && (current.state === 'todo' || current.state === 'open'),
			isFrameRequested: !!b?.isFrameRequested,
		};
	}
	return {
		navigator,
		steps,
		current: view,
		done: steps.filter((s) => s.state === 'done').length,
		total: steps.length,
		maxNote: MAX_CHANGE_NOTE,
	};
}

// Stage 1: the parts of the brief and the open questions of Claude
function briefView(snapshot: Snapshot, brief: NonNullable<ModelInput['brief']>): BriefView {
	const parsed = parseBrief(brief.text);
	const open = snapshot.questions.filter((q) => q.state === 'open');
	return {
		file: brief.file,
		parts: parsed.parts.map((p) => ({ id: p.id, name: p.name, hasText: p.hasText, summary: partSummary(p), ...(p.line ? { line: p.line } : {}) })),
		complete: parsed.parts.filter((p) => p.hasText).length,
		isComplete: parsed.isComplete,
		isDirty: brief.isDirty,
		questions: open.map((q) => {
			const line = questionLine(brief.text, parsed.parts, q);
			return { id: q.id, text: q.text, ...(q.part ? { partName: partName(q.part) } : {}), ...(line ? { line } : {}) };
		}),
		closed: snapshot.questions.length - open.length,
	};
}

// The gate of stage 5: the gate of the current step, or "The task is done" after the last step
function buildGate(build: BuildView): GateView {
	const current = build.current;
	if (!current) {
		return { label: GATE_LABEL['task-done'], note: 'Your gate. It ends the task. Then you make the commit.', isEnabled: true };
	}
	if (current.writer === 'user') {
		return {
			label: 'The step is done',
			note: 'Your gate. Shotgun records your lines, and the next step of the plan starts.',
			isEnabled: current.state === 'open',
			...(current.state === 'open' ? {} : { reason: 'Shotgun opens the step first.' }),
		};
	}
	if (current.writer === 'frame') {
		if (current.state !== 'holes') {
			return {
				label: 'The step is done',
				note: '',
				isEnabled: false,
				reason: current.state === 'open' ? 'Claude writes the frame. The holes come when Claude closes the step.'
					: `Claude writes the frame first. Tell Claude: "Give me a frame for step ${current.n}."`,
			};
		}
		const total = current.holes?.length ?? 0;
		const done = current.holesDone ?? 0;
		const changed = (current.holes ?? []).filter((h) => h.state === 'changed').map((h) => h.n);
		return {
			label: 'The step is done',
			note: 'Your gate. Shotgun records your lines, and the next step of the plan starts.',
			isEnabled: done === total,
			...(done < total ? { reason: `Fill the holes first: ${done} of ${count(total, 'hole')} done.` } : {}),
			...(changed.length > 0 ? {
				warning: `Shotgun cannot find the place of hole ${changed.join(', ')}, because the lines around it changed. It counts as done.`,
			} : {}),
		};
	}
	const receipt = current.receipt;
	if (current.state !== 'receipt' || !receipt) {
		return {
			label: 'Accept the receipt',
			note: '',
			isEnabled: false,
			reason: current.state === 'open' ? 'Claude writes the step. The receipt comes when Claude closes the step.'
				: `Claude writes this step. Tell Claude: "Do step ${current.n}."`,
		};
	}
	const notWalked = receipt.total - receipt.walked;
	const warnings = [
		...(notWalked > 0 ? [`${count(notWalked, 'change')} ${notWalked === 1 ? 'has' : 'have'} no mark. The ledger keeps ${notWalked === 1 ? 'it' : 'them'} as not walked.`] : []),
		...(receipt.questions > 0 ? [`${count(receipt.questions, 'question')} of yours ${receipt.questions === 1 ? 'is' : 'are'} open.`] : []),
	];
	return {
		label: 'Accept the receipt',
		note: 'Your gate. Shotgun then deletes the base of the step, and the next step of the plan starts.',
		isEnabled: receipt.issues === 0,
		...(receipt.issues > 0 ? {
			reason: `${count(receipt.issues, 'change')} ${receipt.issues === 1 ? 'has' : 'have'} an issue. Tell Claude "Fix the issues of step ${current.n}.", `
				+ 'or change the mark.',
		} : {}),
		...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
	};
}

// The gate of the stage
function gateView(task: TaskFile, brief: BriefView | undefined, survey: SurveyView | undefined, order: OrderView | undefined, plan: PlanView | undefined,
	build: BuildView | undefined): GateView | undefined {
	if (task.isDone) {
		return undefined;
	}
	if (task.stage === 'build') {
		return build ? buildGate(build) : undefined;
	}
	if (task.stage === 'plan') {
		const note = 'Your gate. After it, the build starts, and the level of each step selects its writer.';
		if (!plan) {
			return { label: GATE_LABEL['accept-plan'], note, isEnabled: false, reason: 'Ask Claude for the plan first.' };
		}
		return {
			label: GATE_LABEL['accept-plan'],
			note,
			isEnabled: plan.waiting === 0,
			...(plan.waiting > 0 ? {
				reason: `${count(plan.waiting, 'step')} ${plan.waiting === 1 ? 'has' : 'have'} no level yet. Wait for the end of the scan of the call graph, `
					+ 'or set the level.',
			} : {}),
			...(STAGE_INFO.build.request ? { after: STAGE_INFO.build.request } : {}),
		};
	}
	if (task.stage === 'order') {
		if (!order) {
			return undefined;
		}
		const n = order.warnings.length;
		const empty = order.tasks.find((t) => t.place !== null && !t.text.trim());
		let reason: string | undefined;
		if (order.inPlan === 0) {
			reason = 'Put 1 task or more into the plan.';
		} else if (empty) {
			reason = `Write the text of task ${empty.place}.`;
		}
		return {
			// the label tells the number of the warnings, and the gate does not stop because of them
			label: n === 0 ? GATE_LABEL['accept-order'] : `Accept with ${count(n, 'warning')}`,
			note: 'Your gate. After it, Claude makes the plan in this sequence.',
			isEnabled: !reason,
			...(reason ? { reason } : {}),
			...(order.changed > 0
				? { warning: `${count(order.changed, 'task')} of the plan ${order.changed === 1 ? 'has' : 'have'} no survey. Claude surveys `
					+ `${order.changed === 1 ? 'it' : 'them'} at the start of the plan.` } : {}),
			...(STAGE_INFO.plan.request ? { after: STAGE_INFO.plan.request } : {}),
		};
	}
	if (task.stage === 'survey') {
		const open = survey ? survey.questions.filter((q) => !q.answer).length : 0;
		return {
			label: GATE_LABEL['order-tasks'],
			note: 'Your gate. After it, you put the tasks in sequence. You can rewrite a task, and you can add a task.',
			isEnabled: !!survey,
			...(survey ? {} : { reason: 'Ask Claude for the survey first.' }),
			...(open > 0 ? { warning: `${open === 1 ? '1 question' : `${open} questions`} of the survey ${open === 1 ? 'has' : 'have'} no answer.` } : {}),
		};
	}
	if (task.stage !== 'brief' || !brief) {
		return undefined;
	}
	const missing = brief.parts.filter((p) => !p.hasText).map((p) => p.name);
	const open = brief.questions.length;
	return {
		label: GATE_LABEL['brief-ready'],
		note: 'Your gate. It starts the scan of the call graph.',
		isEnabled: missing.length === 0,
		...(missing.length > 0 ? { reason: `Write ${missing.join(', ')} in brief.md first.` } : {}),
		...(open > 0 ? { warning: `${open === 1 ? '1 question' : `${open} questions`} of Claude ${open === 1 ? 'is' : 'are'} open.` } : {}),
		...(STAGE_INFO.survey.request ? { after: STAGE_INFO.survey.request } : {}),
	};
}

function dataflowRow(dataflow: DataFlowView): SetupRow {
	const id = 'dataflow';
	const name = `DataFlow ${dataflow.version ?? ''}`.trim();
	switch (dataflow.state) {
		case 'linking':
			return { id, isOk: false, text: 'Shotgun looks for DataFlow.' };
		case 'missing':
			return { id, isOk: false, text: `Install DataFlow ${MIN_DATAFLOW} or a later version. Shotgun uses its engine and its MCP server.` };
		case 'old':
			return { id, isOk: false, text: `${name} is too old. Install DataFlow ${MIN_DATAFLOW} or a later version.` };
		case 'failed':
			return { id, isOk: false, text: `${name} did not start: ${dataflow.reason ?? 'no reason'}` };
		case 'ready':
			if (dataflow.toolsError) {
				return { id, isOk: false, text: `${name} did not add the tools of Shotgun: ${dataflow.toolsError}` };
			}
			if (dataflow.engine === 'failed') {
				return { id, isOk: false, text: `${name}: the engine failed. ${dataflow.engineError ?? ''}`.trim() };
			}
			return {
				id, isOk: true,
				text: dataflow.engine === 'ready' ? `${name}: the engine is ready.`
					: dataflow.engine === 'starting' ? `${name}: the engine starts.`
						: `${name}: the engine is stopped. ${dataflow.engineError ?? ''}`.trim(),
			};
	}
}

function shotgunRow(claude: ClaudeState, hasTask: boolean): SetupRow {
	const id = 'claude-shotgun';
	if (claude.marketplace === 'none') {
		return {
			id, isOk: false, text: 'Connect Shotgun to Claude Code for the guard and the context of the task.',
			action: { command: 'connectClaude', label: 'Connect Shotgun' },
		};
	}
	if (claude.marketplace === 'other') {
		return {
			id, isOk: false, text: 'The settings of Claude Code have a different folder for the plugin of Shotgun.',
			action: { command: 'connectClaude', label: 'Connect again' },
		};
	}
	if (!hasTask) {
		return { id, isOk: true, text: 'Shotgun is connected to Claude Code. The plugin goes on in this folder with the first task.' };
	}
	return claude.plugin === 'on'
		? { id, isOk: true, text: 'Shotgun is connected to Claude Code. Its plugin is on in this folder.' }
		: {
			id, isOk: false, text: 'The plugin of Shotgun is off in this folder.',
			action: { command: 'connectClaude', label: 'Turn it on' },
		};
}

export function setupRows(input: ModelInput): SetupRow[] {
	const { snapshot, claude } = input;
	return [
		snapshot.root
			? { id: 'folder', isOk: true, text: `Folder: ${path.basename(snapshot.root)}` }
			: { id: 'folder', isOk: false, text: 'Open a folder. Shotgun keeps its files in the folder .shotgun of the first workspace folder.' },
		dataflowRow(input.dataflow),
		claude.dataflow === 'connected'
			? { id: 'claude-dataflow', isOk: true, text: 'DataFlow is connected to Claude Code.' }
			: {
				id: 'claude-dataflow', isOk: false,
				text: 'Connect DataFlow to Claude Code. The tools of Shotgun are in the MCP server of DataFlow.',
				action: { command: 'connectDataFlow', label: 'Connect DataFlow' },
			},
		shotgunRow(claude, snapshot.tasks.length > 0),
	];
}

function stageViews(snapshot: Snapshot): StageView[] {
	const task = snapshot.task;
	const current = task ? STAGES.indexOf(task.stage) : -1;
	return STAGES.map((stage, i) => {
		const info = STAGE_INFO[stage];
		let state: StageView['state'] = 'todo';
		if (task && (task.isDone || i < current)) {
			state = 'done';
		} else if (i === current) {
			state = 'current';
		}
		return { stage, number: info.number, name: info.name, writer: info.writer, state };
	});
}

function taskView(snapshot: Snapshot, briefInput: ModelInput['brief'], readLines: ModelInput['readLines'], voice: Voice, pauseSeconds: number): TaskView | null {
	const task = snapshot.task;
	if (!task) {
		return null;
	}
	const brief = task.stage === 'brief' && !task.isDone && briefInput ? briefView(snapshot, briefInput) : undefined;
	const survey = task.stage !== 'brief' ? surveyView(snapshot, readLines) : undefined;
	const order = orderView(snapshot, survey);
	const plan = task.stage === 'plan' || task.stage === 'build' ? planView(snapshot, readLines) : undefined;
	const build = task.stage === 'build' && plan ? buildView(snapshot, plan, readLines, navigatorView(snapshot, voice, pauseSeconds)) : undefined;
	const gate = gateView(task, brief, survey, order, plan, build);
	const info = STAGE_INFO[task.stage];
	const isActive = !task.isDone && !snapshot.isPaused;
	const now = task.stage === 'build' ? buildNext(currentStep(snapshot.plan, snapshot.risk, snapshot.levels, snapshot.build)) : undefined;
	let next = now?.next ?? info.next;
	let guard = info.guard;
	const request = now ? now.request : info.request;
	if (task.isDone) {
		next = 'The task is done.';
		guard = 'The task is done. The guard makes no decision.';
	} else if (snapshot.isPaused) {
		next = 'Select Continue when the work outside of the task is done.';
		guard = 'The guard makes no decision in a pause.';
	}
	return {
		id: task.id,
		title: task.title,
		created: task.created,
		stage: task.stage,
		stageNumber: info.number,
		stageName: info.name,
		writer: info.writer,
		text: info.text,
		next,
		guard,
		...(isActive && request ? { request } : {}),
		...(brief ? { brief } : {}),
		...(survey ? { survey } : {}),
		...(order ? { order } : {}),
		...(plan ? { plan } : {}),
		...(build ? { build } : {}),
		...(gate ? { gate } : {}),
		isDone: task.isDone,
		isPaused: snapshot.isPaused,
	};
}

export function buildModel(input: ModelInput): ViewModel {
	const { snapshot } = input;
	const setup = setupRows(input);
	const decisions: DecisionView[] = [...snapshot.decisions].reverse().slice(0, MAX_DECISIONS)
		.map((d) => ({ time: d.time, by: d.by, text: decisionText(d) }));
	return {
		version: input.version,
		stages: stageViews(snapshot),
		task: taskView(snapshot, input.brief, input.readLines, input.voice ?? DEFAULT_VOICE, input.pauseSeconds ?? DEFAULT_PAUSE_SECONDS),
		tasks: snapshot.tasks.map((t) => ({
			id: t.id, title: t.title, stageNumber: STAGE_INFO[t.stage].number, stageName: STAGE_INFO[t.stage].name, isDone: t.isDone,
			isActive: t.id === snapshot.task?.id,
		})),
		decisions,
		setup,
		isReady: setup.every((r) => r.isOk),
		problems: [...snapshot.problems],
	};
}

// The text of the status bar item and its tooltip
export function statusOf(snapshot: Snapshot): { text: string; tooltip: string } {
	const task = snapshot.task;
	if (!task) {
		return { text: 'Shotgun', tooltip: 'Shotgun: no active task. Select to show the panel.' };
	}
	if (task.isDone) {
		return { text: 'Shotgun: the task is done', tooltip: `Shotgun: the task "${task.title}" is done.` };
	}
	if (snapshot.isPaused) {
		return { text: 'Shotgun: paused', tooltip: `Shotgun: the guard is off for "${task.title}". Select "Shotgun: Continue" to continue.` };
	}
	// stage 5: the problems on the lines of the user come first
	const problems = Object.values(snapshot.callouts?.steps ?? {}).flatMap((s) => s.callouts)
		.filter((c) => c.kind === 'problem' && c.shown && !c.closed && !c.isGone).length;
	if (task.stage === 'build' && problems > 0) {
		return {
			text: `Shotgun: ${problems === 1 ? '1 problem' : `${problems} problems`} on your lines`,
			tooltip: 'Shotgun: callouts of DataFlow on the lines that you wrote. The panel of Shotgun shows them.',
		};
	}
	return { text: `Shotgun: ${stageText(task.stage)}`, tooltip: `Shotgun: "${task.title}". Next: ${STAGE_INFO[task.stage].next}` };
}
