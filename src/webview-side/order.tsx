import { useEffect, useRef, useState } from 'preact/hooks';
import type { OrderEditView, OrderTaskView, OrderView, TaskView, ViewModel } from '../views/protocol';
import { CommandButton, GateBlock, linesOf, StageBar, TellClaude, WriterBadges } from './common';
import { post } from './vscode';

// Stage 3: the order of the user (decision 3). The page shows each task with its text, its hooks, its size and the
// tasks that it needs. The user moves a task, changes its text, adds a task, keeps a task for later, and removes a new
// task. Each edit is a decision of the user, and the extension records it. The panel shows a summary.

const SURVEY_CHANGED = 'Survey my changed tasks.';

const edit = (change: OrderEditView) => post({ type: 'editOrder', edit: change });
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function Chevron({ isUp }: { isUp: boolean }) {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
			stroke-linejoin="round">
			<polyline points={isUp ? '6 15 12 9 18 15' : '6 9 12 15 18 9'} />
		</svg>
	);
}

// The text of a task. The text goes to the extension when the field loses the focus, or with Enter. Escape gives the
// text from before
function TaskText({ task, maxText, isEditable }: { task: OrderTaskView; maxText: number; isEditable: boolean }) {
	const [text, setText] = useState(task.text);
	// the last text that went to the extension: Enter and then the loss of the focus send it 1 time
	const sent = useRef(task.text);
	useEffect(() => {
		setText(task.text);
		sent.current = task.text;
	}, [task.text]);
	if (!isEditable) {
		return <span class="order-text">{task.text}</span>;
	}
	const commit = () => {
		if (text.trim() !== sent.current.trim()) {
			sent.current = text;
			edit({ action: 'text', id: task.id, text });
		}
	};
	return (
		<input class="order-input" type="text" aria-label={task.place ? `The text of task ${task.place}` : `The text of the task ${task.id}, for later`}
			value={text} maxLength={maxText} placeholder="Write the text of the task"
			onInput={(e) => setText((e.target as HTMLInputElement).value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					commit();
				} else if (e.key === 'Escape') {
					setText(task.text);
				}
			}} />
	);
}

function OrderRow({ task, index, last, view }: { task: OrderTaskView; index: number; last: number; view: OrderView }) {
	const tag = task.isChanged ? `${task.isNew ? 'new' : 'rewritten'}${task.isSurveyedAgain ? ', surveyed' : ''}` : undefined;
	const classes = ['order-row', task.isLater ? 'later' : '', task.warnings.length > 0 ? 'warn' : '', task.hasSurvey ? '' : 'nosurvey'];
	return (
		<li class={classes.filter(Boolean).join(' ')}>
			<div class="order-main">
				<span class="order-num" title={task.place ? `Place ${task.place} of the plan` : 'For later'}>{task.place ?? '–'}</span>
				<TaskText task={task} maxText={view.maxText} isEditable={view.isEditable} />
				{view.isEditable && (
					<span class="order-buttons">
						<button type="button" class="icon-btn" aria-label="Move the task up" disabled={index === 0}
							onClick={() => edit({ action: 'move', id: task.id, step: -1 })}>
							<Chevron isUp />
						</button>
						<button type="button" class="icon-btn" aria-label="Move the task down" disabled={index === last}
							onClick={() => edit({ action: 'move', id: task.id, step: 1 })}>
							<Chevron isUp={false} />
						</button>
						<button type="button" class={task.isLater ? 'pill on' : 'pill'} aria-pressed={task.isLater}
							title={task.isLater ? 'Put the task back into the plan' : 'Keep the task for later'}
							onClick={() => edit({ action: 'later', id: task.id, isLater: !task.isLater })}>
							{task.isLater ? 'Later' : 'Not now'}
						</button>
						{task.isNew && <button type="button" class="pill" onClick={() => edit({ action: 'remove', id: task.id })}>Remove</button>}
					</span>
				)}
			</div>
			<div class="order-meta">
				{tag && <span class={`tag ${task.isSurveyedAgain ? 'claude' : 'user'}`}>{tag}</span>}
				<span class="order-hooks">
					{task.hooks.length === 0 ? <span class="muted small">{task.hasSurvey ? 'no hook' : 'no hook yet'}</span> : task.hooks.map((h) => (
						<button type="button" class="chip mono" title={h.place ? `Show ${h.place} in DataFlow` : 'The survey has no hook with this id'} disabled={!h.path}
							onClick={() => post({ type: 'showPlace', path: h.path, lines: linesOf(h.place, h.line), note: `${h.id} · ${task.text}`.slice(0, 300) })}>
							{h.id}
						</button>
					))}
				</span>
				<span class="order-size" title="The estimate of Claude">{task.size ?? '–'}</span>
				<span class="order-needs muted">{task.needsText}</span>
			</div>
			{task.note && (
				<div class={`order-note ${task.note.by}`}>
					<span class={`badge ${task.note.by}`}>{task.note.by === 'claude' ? 'Claude' : 'You'}</span>
					<span>{task.note.text}</span>
				</div>
			)}
			{task.warnings.length > 0 && (
				<div class="order-warn">
					<span class="badge check">Check</span>
					<span>{task.warnings.join(' ')}</span>
				</div>
			)}
		</li>
	);
}

// The field for a new task. Enter or the button adds the task
function AddTask({ maxText }: { maxText: number }) {
	const [draft, setDraft] = useState('');
	const add = () => {
		const text = draft.trim();
		if (text) {
			edit({ action: 'add', text });
			setDraft('');
		}
	};
	return (
		<div class="order-add">
			<span class="order-num" aria-hidden="true">+</span>
			<input class="order-input" type="text" aria-label="The text of a new task" value={draft} maxLength={maxText}
				placeholder="Write a new task, then push Enter"
				onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => e.key === 'Enter' && add()} />
			<button type="button" class="btn secondary small" disabled={!draft.trim()} onClick={add}>Add the task</button>
		</div>
	);
}

// The order check: the needs from the surveys of Claude, with the badge Model
function OrderCheck({ view }: { view: OrderView }) {
	const n = view.warnings.length;
	return (
		<>
			<div class="row-head">
				<span class="name">Order check</span>
				<span class="badge claude" title="The words of Claude">Model</span>
				<span class="hint">needs</span>
				<span class={n === 0 ? 'state ok-text' : 'state warn-text'}>{n === 0 ? 'no warning' : count(n, 'warning')}</span>
			</div>
			{n === 0 ? (
				<p class="check-line"><span class="mark ok-text" aria-hidden="true">✓</span> Each task comes after the tasks that it needs.</p>
			) : (
				<ul class="list">
					{view.warnings.map((w) => <li><span class="mark warn-text" aria-hidden="true">!</span><span class="grow">{w}</span></li>)}
				</ul>
			)}
			<p class="muted small">The needs come from the surveys of Claude. Shotgun gives a warning, and it does not sort your tasks.</p>
		</>
	);
}

// The tasks with no survey for their text, and the request for Claude
function Changed({ view }: { view: OrderView }) {
	return (
		<>
			<div class="row-head">
				<span class="name">Changed by you</span>
				<span class="badge user">You</span>
				<span class="muted">{view.changed === 0 ? 'none with no survey' : `${view.changed} with no survey`}</span>
			</div>
			<p>
				{view.changed === 0 ? 'Each task of the plan has a survey of Claude.'
					: 'A new task and a rewritten task have no survey. Tell Claude to survey them, or Claude surveys them at the start of the plan.'}
			</p>
			{view.isEditable && view.changed > 0 && <TellClaude text={SURVEY_CHANGED} />}
		</>
	);
}

export function OrderPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const view = task.order!;
	const last = view.tasks.length - 1;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Order</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					You put the tasks in sequence. You can change the text of a task, and you can add a task. Shotgun shows what each task needs,
					from the survey of Claude. It gives a warning, and it does not move a task.
				</p>
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<div class="row-head">
							<span class="name">Order of the tasks</span>
							<span class="badge user">You</span>
							<span class="muted">{view.inPlan} in the plan, {view.later} later</span>
						</div>
						<ol class="order-list" aria-label="The tasks in sequence">
							{view.tasks.map((t, i) => <OrderRow task={t} index={i} last={last} view={view} />)}
						</ol>
						{view.isEditable && <AddTask maxText={view.maxText} />}
						<p class="muted small">
							The hooks, the sizes and the needs are words of Claude. A new task and a rewritten task get them when Claude surveys
							the task. A click on a hook opens its place.
						</p>
					</section>
				</div>
				<div class="column">
					<section class="card">
						<OrderCheck view={view} />
					</section>
					<section class="card">
						<Changed view={view} />
					</section>
					<section class="card">
						<div class="name">Your sequence</div>
						<p>The sequence, each new text and each new task are your decisions. The ledger records each of them.</p>
						{task.gate ? <GateBlock gate={task.gate} /> : <p class="muted">You accepted the order.</p>}
					</section>
				</div>
			</div>
		</div>
	);
}

// The panel in stage 3: a summary of the order, the request for Claude and the gate
export function OrderSummary({ task }: { task: TaskView }) {
	const view = task.order;
	const n = view?.warnings.length ?? 0;
	return (
		<div>
			<div class="head">
				<span class="name">{task.stageName}</span>
				<WriterBadges writer={task.writer} />
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			{view && (
				<>
					<p>
						Your sequence: {view.inPlan} in the plan, {view.later} later. {n === 0 ? 'The order check has no warning.' : `The order check has ${count(n, 'warning')}.`}
					</p>
					<div class="buttons"><CommandButton label="Show the order" command="showPage" isPrimary /></div>
					<div class="section"><Changed view={view} /></div>
				</>
			)}
			{task.gate && <GateBlock gate={task.gate} />}
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}
