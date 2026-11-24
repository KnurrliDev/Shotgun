import { useEffect, useRef, useState } from 'preact/hooks';
import type { FixRowView, IssueView, PlanView, ReviewView, TaskView, ToView, ViewModel } from '../views/protocol';
import { CurrentStep, Navigator, StepList } from './build';
import { CommandButton, GateBlock, PlaceLink, StageBar, TellClaude, WriterBadges } from './common';
import { LedgerPage, LedgerPanel, LooseEnds } from './ledger';
import { Chevron } from './order';
import { BuildState, PlaceCard, RiskBar, StepDetail, WriterMark, Writers } from './plan';
import { post } from './vscode';

// Stage 6: the review (phase 12, decision 43). Each round has 4 parts, as the stages before it. A new session of Claude
// Code reviews the whole diff of the task, and it did not write the code (decision 35). The user puts the issues to fix
// in sequence on the issues page. Claude writes the plan of the fixes, and the steps of the fixes go in sequence, as the
// steps of the build. A button records a decision of the user, and it never starts Claude.

const PLAN_FIXES = 'Plan the fixes.';
const CHANGE_EXAMPLE = 'Fix I1 and I3 in 1 step.';
const PARTS = [['review', 'Review'], ['issues', 'Issues'], ['plan', 'Fix plan'], ['fixes', 'Fixes']] as const;
const SEVERITY_CLASS = { important: 'k-problem', minor: 'k-info' } as const;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const titleOf = (row: FixRowView) => (row.kind === 'review' ? row.issue.title : row.issue.text);

// The feedback of the user from the reviews of all tasks of the folder (P35): the rate with no action for each area. An
// area of the focus with more than 10% gets a proposal to turn it off. hasRates: all areas, for the page
function Feedback({ review, hasRates }: { review: ReviewView; hasRates: boolean }) {
	const feedback = review.feedback;
	const shown = (feedback?.areas ?? []).filter((a) => hasRates || (a.isTooNoisy && a.isInFocus));
	if (!feedback || (!hasRates && shown.length === 0)) {
		return null;
	}
	const turnOff = (area: string) => post({ type: 'setReviewOptions', effort: review.effort, areas: review.areas.filter((a) => a !== area), text: review.text });
	return (
		<div class="feedback">
			{hasRates && <p class="muted small">{feedback.text}</p>}
			<ul class="list">
				{shown.map((a) => (
					<li>
						<span class="grow">
							{a.name}: {a.noAction} of {a.decided} with no action ({a.rate}){a.isTooNoisy ? '. More than 10%: turn the area off?' : ''}
						</span>
						{a.isTooNoisy && a.isInFocus && review.areas.length > 1 && (
							<button type="button" class="pill" title="Remove the area from the focus of the next review" onClick={() => turnOff(a.id)}>Turn off</button>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

// The effort, the areas of the focus and a point of the user. Each change goes to the extension at once. From round 2,
// the next review checks the fixes (P23)
function ReviewOptions({ review, hasRates = false }: { review: ReviewView; hasRates?: boolean }) {
	const [text, setText] = useState(review.text);
	useEffect(() => setText(review.text), [review.text]);
	const send = (next: { effort?: string; areas?: string[]; text?: string }) => post({
		type: 'setReviewOptions', effort: next.effort ?? review.effort, areas: next.areas ?? review.areas, text: next.text ?? text,
	});
	const toggle = (area: string) => {
		const areas = review.areas.includes(area) ? review.areas.filter((a) => a !== area) : [...review.areas, area];
		if (areas.length > 0) {
			send({ areas });
		}
	};
	const effort = review.efforts.find((e) => e.id === review.effort);
	return (
		<div class="review-options">
			<label class="field">
				<span class="name">Effort</span>
				<select value={review.effort} onChange={(e) => send({ effort: (e.target as HTMLSelectElement).value })}>
					{review.efforts.map((e) => <option value={e.id}>{e.name}</option>)}
				</select>
			</label>
			{effort && (
				<p class="muted small">
					<span class="block">Finders: {effort.finders}</span>
					<span class="block">Context: {effort.context}</span>
					<span class="block">Verify pass: {effort.verify}</span>
				</p>
			)}
			<div class="name">Focus</div>
			<div class="chips" role="group" aria-label="The areas of the focus">
				{review.allAreas.map((a) => (
					<button type="button" class={`chip${review.areas.includes(a.id) ? ' on' : ''}`} aria-pressed={review.areas.includes(a.id)} title={a.looksFor}
						onClick={() => toggle(a.id)}>
						{a.name}
					</button>
				))}
			</div>
			<label class="field">
				<span class="muted small">A point of yours for the review (optional)</span>
				<input type="text" value={text} maxLength={review.maxText} placeholder="For example: look at the error paths"
					onInput={(e) => setText((e.target as HTMLInputElement).value)} onChange={(e) => send({ text: (e.target as HTMLInputElement).value })} />
			</label>
			<Feedback review={review} hasRates={hasRates} />
			{review.isNewRound && (
				<p class="small">
					Round {review.nextRound} reviews the fixes: the new and the changed hunks with their ripple, and {count(review.toCheck, 'fixed issue')}.
				</p>
			)}
			{review.roundWarning && <p class="notice">{review.roundWarning}</p>}
			<button type="button" class="btn primary" title="Copy the prompt of the review. Then paste it into a new session of Claude Code."
				onClick={() => post({ type: 'copyReviewPrompt' })}>
				{review.isNewRound ? `Copy the prompt of round ${review.nextRound}` : 'Copy the review prompt'}
			</button>
			<p class="muted small">
				Start a new session of Claude Code in the folder of the project, and paste the prompt. A new session did not write the code, so it reviews
				with a fresh view.
			</p>
		</div>
	);
}

// The 4 parts of the current round. A part before the current part is done
function RoundBar({ review }: { review: ReviewView }) {
	const at = PARTS.findIndex(([id]) => id === review.phase);
	return (
		<div class="round-bar">
			<span class="name">Round {review.roundNumber}</span>
			<ol aria-label={`The parts of round ${review.roundNumber}`}>
				{PARTS.map(([id, name], i) => (
					<li class={`round-part${i < at ? ' done' : i === at ? ' current' : ''}`} aria-current={i === at ? 'step' : undefined} data-part={id}>
						{i < at && <span aria-hidden="true">✓ </span>}{name}
					</li>
				))}
			</ol>
		</div>
	);
}

// The last review in 1 line
function RoundLine({ review }: { review: ReviewView }) {
	const r = review.round;
	if (!r) {
		return <p class="muted">No review yet. Copy the review prompt into a new session of Claude Code.</p>;
	}
	return (
		<p class="muted small">
			Round {r.n} at the effort {r.effortName.toLowerCase()}, focus {r.areaNames.join(', ').toLowerCase()}: {count(r.changedLines, 'changed line')}, a cap of
			{' '}{count(r.cap, 'issue')} to fix.{r.note ? ` Claude: ${r.note}` : ''}
		</p>
	);
}

// The facts of an issue of the review: the place, the failure scenario, the evidence of DataFlow, and the parts of the
// brief that the issue is about
function IssueFacts({ issue, review }: { issue: IssueView; review: ReviewView }) {
	const isEngine = issue.source === 'engine';
	return (
		<div class="issue-facts">
			<p class="change-place"><PlaceLink place={issue.place} note={`${issue.id} · ${issue.title}`} /></p>
			<p>{issue.summary}</p>
			<div class={`order-note${isEngine ? '' : ' claude'}`}>
				<span class={`badge ${isEngine ? 'engine' : 'claude'}`}>{isEngine ? 'Engine' : 'Model'}</span>
				<span>
					{issue.areaName} · {issue.category} · {issue.verdict}{issue.origin === 'pre-existing' ? ' · pre-existing' : ''}
				</span>
			</div>
			<dl class="scenario">
				<dt>Trigger</dt><dd>{issue.scenario.trigger}</dd>
				<dt>Path</dt><dd>{issue.scenario.path}</dd>
				<dt>Result</dt><dd>{issue.scenario.result}</dd>
				{issue.scenario.interleave && <><dt>Interleave</dt><dd>{issue.scenario.interleave}</dd></>}
			</dl>
			{issue.decisions.length > 0 && (
				<div class="issue-decisions">
					<div class="muted small">Open decisions of the fix. The plan of the fixes gets them.</div>
					<ul>
						{issue.decisions.map((d) => (
							<li><span class="id">{d.id}</span> {d.question}{d.options ? <span class="muted"> Options: {d.options.join('; ')}</span> : ''}</li>
						))}
					</ul>
				</div>
			)}
			{/* an issue of the area The brief: the parts of the brief that it is about, next to it */}
			{review.brief && (issue.category === 'spec' || issue.category === 'scope') && (
				<div class="issue-brief">
					{(issue.category === 'scope' ? [['Not in scope', review.brief.scope]] as const
						: [['Specs', review.brief.specs], ['Done when', review.brief.done]] as const).filter(([, lines]) => lines.length > 0).map(([name, lines]) => (
						<p class="small"><span class="badge user">Brief</span> <span class="muted">{name}: </span>{lines.join(' ')}</p>
					))}
				</div>
			)}
			{issue.fixPlaces.length > 0 && (
				<p class="small">
					<span class="muted">Also fix: </span>
					{issue.fixPlaces.map((p) => <span class="block"><PlaceLink place={p} note={`${issue.id} · fix place`} /></span>)}
				</p>
			)}
			<p class="muted small">
				{issue.tools.length > 0 ? `Evidence of DataFlow: ${issue.tools.join(', ')}.` : 'No evidence of a tool of DataFlow.'} Round {issue.round}.
			</p>
			{issue.evidence && <p class="small"><span class="muted">New evidence of Claude: </span>{issue.evidence}</p>}
		</div>
	);
}

// The note of the user for the plan of the fixes, for example "Use an atomic". The note goes to the extension when the
// field loses the focus, or with Enter. Escape gives the note from before
function IssueNote({ id, note, max, isEditable }: { id: string; note: string; max: number; isEditable: boolean }) {
	const [text, setText] = useState(note);
	const sent = useRef(note);
	useEffect(() => {
		setText(note);
		sent.current = note;
	}, [id, note]);
	if (!isEditable) {
		return note ? <div class="order-note user"><span class="badge user">You</span><span>{note}</span></div> : null;
	}
	const commit = () => {
		if (text.trim() !== sent.current.trim()) {
			sent.current = text;
			post({ type: 'setIssueNote', id, note: text });
		}
	};
	return (
		<label class="note-field">
			Your note for the plan
			<input type="text" value={text} maxLength={max} placeholder="For example: use an atomic, or fix it in the caller"
				onInput={(e) => setText((e.target as HTMLInputElement).value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						commit();
					} else if (e.key === 'Escape') {
						setText(sent.current);
					}
				}} />
		</label>
	);
}

// "Not a problem" for an issue of the review, and "Remove" for an issue of the user
function CloseButton({ row }: { row: FixRowView }) {
	return row.kind === 'review' ? (
		<button type="button" class="pill" title="The ledger keeps your reason, and the next review gets it" onClick={() => post({ type: 'closeIssue', id: row.issue.id })}>
			Not a problem
		</button>
	) : (
		<button type="button" class="pill" onClick={() => post({ type: 'removeUserIssue', id: row.issue.id })}>Remove</button>
	);
}

// The severity of an issue of the review, or the badge of an issue of the user
function IssueTag({ row }: { row: FixRowView }) {
	return row.kind === 'review' ? <span class={`kind-chip ${SEVERITY_CLASS[row.issue.severity]}`}>{row.issue.severity}</span> : <span class="badge user">You</span>;
}

// A row of the list to fix: its place in your sequence, your buttons, the facts of the issue and your note
function FixRow({ row, index, last, review }: { row: FixRowView; index: number; last: number; review: ReviewView }) {
	const { id } = row.issue;
	return (
		<li class="order-row fix-row">
			<div class="order-main">
				<span class="order-num" title={`Place ${index + 1} of the list to fix`}>{index + 1}</span>
				<span class="id">{id}</span>
				<span class="order-text">{titleOf(row)}</span>
				<IssueTag row={row} />
				{review.canEditIssues && (
					<span class="order-buttons">
						<button type="button" class="icon-btn" aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => post({ type: 'moveIssue', id, step: -1 })}>
							<Chevron isUp />
						</button>
						<button type="button" class="icon-btn" aria-label={`Move ${id} down`} disabled={index === last} onClick={() => post({ type: 'moveIssue', id, step: 1 })}>
							<Chevron isUp={false} />
						</button>
						<button type="button" class="pill" title="Keep the issue for later" onClick={() => post({ type: 'setIssueStep', id, isStep: false })}>Not now</button>
						<CloseButton row={row} />
					</span>
				)}
			</div>
			{row.kind === 'review' && <IssueFacts issue={row.issue} review={review} />}
			{row.kind === 'review' && row.issue.isUserStep && <p class="muted small">You put this issue into the list to fix.</p>}
			{row.kind === 'user' && <p class="muted small">Your issue of round {row.issue.round}. Claude finds its places in the plan of the fixes.</p>}
			<IssueNote id={id} note={row.note} max={review.maxNote} isEditable={review.canWriteNotes} />
		</li>
	);
}

// The field for an issue of yours. Enter or the button adds the issue at the end of the list to fix
function AddIssue({ max }: { max: number }) {
	const [draft, setDraft] = useState('');
	const add = () => {
		const text = draft.trim();
		if (text) {
			post({ type: 'addUserIssue', text });
			setDraft('');
		}
	};
	return (
		<div class="order-add">
			<span class="order-num" aria-hidden="true">+</span>
			<input class="order-input" type="text" aria-label="The text of an issue of yours" value={draft} maxLength={max}
				placeholder="Write an issue of yours, then push Enter"
				onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => e.key === 'Enter' && add()} />
			<button type="button" class="btn secondary small" disabled={!draft.trim()} onClick={add}>Add the issue</button>
		</div>
	);
}

// A row of the list for later, with the reason. "Fix it" puts the issue at the end of the list to fix
function LaterRow({ row, review }: { row: FixRowView; review: ReviewView }) {
	const { id } = row.issue;
	const why = row.kind === 'review' ? row.issue.listReason : 'You keep it for later.';
	return (
		<li class="order-row later">
			<div class="order-main">
				<span class="order-num" aria-hidden="true">–</span>
				<span class="id">{id}</span>
				<span class="order-text">{titleOf(row)}</span>
				<IssueTag row={row} />
				{review.canEditIssues && (
					<span class="order-buttons">
						<button type="button" class="pill" title="Put the issue at the end of the list to fix" onClick={() => post({ type: 'setIssueStep', id, isStep: true })}>
							Fix it
						</button>
						<CloseButton row={row} />
					</span>
				)}
			</div>
			{why && <p class="muted small">{why}</p>}
			{row.kind === 'review' && (
				<details class="issue-more">
					<summary>The facts of {id}</summary>
					<IssueFacts issue={row.issue} review={review} />
				</details>
			)}
		</li>
	);
}

// An issue that you closed with "Not a problem", and your reason
function ClosedRow({ issue, review }: { issue: IssueView; review: ReviewView }) {
	return (
		<li class="order-row later">
			<div class="order-main">
				<span class="order-num" aria-hidden="true">–</span>
				<span class="id">{issue.id}</span>
				<span class="order-text">{issue.title}</span>
				{review.canEditIssues && (
					<span class="order-buttons">
						<button type="button" class="pill" onClick={() => post({ type: 'reopenIssue', id: issue.id })}>Open again</button>
					</span>
				)}
			</div>
			<p class="small"><span class="badge user">You</span> {issue.reason}</p>
			{issue.evidence && <p class="small"><span class="muted">New evidence of Claude: </span>{issue.evidence}</p>}
		</li>
	);
}

// An issue that a step of the fixes fixed. The next round checks the fix
function FixedRow({ row }: { row: FixRowView }) {
	return (
		<li class="order-row later">
			<div class="order-main">
				<span class="order-num ok-text" aria-hidden="true">✓</span>
				<span class="id">{row.issue.id}</span>
				<span class="order-text">{titleOf(row)}</span>
			</div>
		</li>
	);
}

// The check of the rule on the issues page: each important new issue that the review confirmed is in the list to fix
function IssueCheck({ review }: { review: ReviewView }) {
	const n = review.checks.filter((c) => c.isWarning).length;
	return (
		<>
			<div class="row-head">
				<span class="name">Check</span>
				<span class="badge rule">Rule</span>
				<span class={n === 0 ? 'state ok-text' : 'state warn-text'}>{n === 0 ? 'no warning' : count(n, 'warning')}</span>
			</div>
			{review.checks.length === 0 ? (
				<p class="check-line"><span class="mark ok-text" aria-hidden="true">✓</span> Each important new issue that the review confirmed is in the list to fix.</p>
			) : (
				<ul class="list">
					{review.checks.map((c) => (
						<li><span class={`mark ${c.isWarning ? 'warn-text' : 'muted'}`} aria-hidden="true">{c.isWarning ? '!' : 'i'}</span><span class="grow">{c.text}</span></li>
					))}
				</ul>
			)}
			<p class="muted small">Shotgun does not sort the issues, and it plans no fix.</p>
		</>
	);
}

// The gate "The task is done" beside the gate of the part of the round. It never waits (P16)
function TaskDone({ task }: { task: TaskView }) {
	const review = task.review!;
	if (task.isDone || !task.gate || task.gate.label === review.taskDone.label) {
		return null;
	}
	return (
		<div class="secondary-gate">
			<button type="button" class="btn secondary" onClick={() => post({ type: 'taskDone' })}>{review.taskDone.label}</button>
			<p class="muted small">{review.taskDone.note} An open issue stays open in the ledger.</p>
		</div>
	);
}

// The gate of the part of the round, "Back to the issues" before the gate "Accept the fix plan", and the gate "The task is
// done". hasAfter: the work after the gate, for the page
function PhaseGate({ task, hasAfter = false }: { task: TaskView; hasAfter?: boolean }) {
	const review = task.review!;
	if (task.isDone) {
		return <p class="muted">The task is done.</p>;
	}
	return (
		<>
			{hasAfter && review.phase === 'issues' && review.toFix.length > 0 && (
				<>
					<div class="name">After your gate</div>
					<p class="muted small">
						Claude writes the steps of the fixes in your sequence, as in stage 4. A step can fix more than 1 issue, and it can change each file that the
						fix needs. The rules give each step its level.
					</p>
				</>
			)}
			{hasAfter && review.phase === 'plan' && review.fixPlan && (
				<>
					<div class="name">After your gate</div>
					<p class="muted small">
						The fixes start, as the build. The level of each step gives its first writer. At each level, you can select a different writer.
					</p>
				</>
			)}
			{task.gate && <GateBlock gate={task.gate} />}
			{review.phase === 'plan' && (
				<div class="buttons">
					<button type="button" class="btn secondary small" title="Change the issues again. The plan of the fixes of this round goes away."
						onClick={() => post({ type: 'reopenIssues' })}>
						Back to the issues
					</button>
				</div>
			)}
			<TaskDone task={task} />
		</>
	);
}

// The lists of the earlier rounds before the next review: fixed, for later and closed
function EarlierIssues({ review }: { review: ReviewView }) {
	return (
		<>
			{review.fixed.length > 0 && (
				<>
					<div class="row-head"><span class="name">Fixed</span><span class="muted">{review.fixed.length}</span></div>
					<ul class="order-list">{review.fixed.map((r) => <FixedRow row={r} />)}</ul>
				</>
			)}
			{review.later.length > 0 && (
				<>
					<div class="row-head"><span class="name">For later</span><span class="muted">{review.later.length}</span></div>
					<ul class="order-list">{review.later.map((r) => <LaterRow row={r} review={review} />)}</ul>
				</>
			)}
			{review.closedIssues.length > 0 && (
				<>
					<div class="row-head"><span class="name">Closed</span><span class="badge user">You</span><span class="muted">{review.closedIssues.length}</span></div>
					<ul class="order-list">{review.closedIssues.map((i) => <ClosedRow issue={i} review={review} />)}</ul>
				</>
			)}
		</>
	);
}

// The page before a review: the effort and the focus of the next review, and the issues of the earlier rounds
function ReviewStart({ task, model }: { task: TaskView; model: ViewModel }) {
	const review = task.review!;
	const hasEarlier = review.fixed.length > 0 || review.later.length > 0 || review.closedIssues.length > 0;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Review</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					A new session of Claude Code reviews the whole diff of the task with your effort and focus. Each issue has a failure scenario and the evidence
					of DataFlow. Then you put the issues to fix in sequence, Claude plans the fixes, and the fixes go step by step, as the build.
				</p>
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<h2 class="name">{review.isNewRound ? `Round ${review.nextRound}: the review of the fixes` : 'The review'}</h2>
						{review.base && <p class="muted small">Base commit: {review.base}</p>}
						{review.baseError && <p class="notice">{review.baseError}</p>}
						{task.isDone ? <p class="muted">The task is done.</p> : <ReviewOptions review={review} hasRates />}
					</section>
					{hasEarlier && (
						<section class="card">
							<h2 class="name">The issues of the earlier rounds</h2>
							<RoundLine review={review} />
							<EarlierIssues review={review} />
						</section>
					)}
				</div>
				<div class="column">
					<section class="card">
						<RoundBar review={review} />
						<p class="muted small">
							After the review, its issues come to the issues page, and the loop goes on: the issues, the fix plan, the fixes. With no new issue, end
							the task.
						</p>
						<PhaseGate task={task} />
					</section>
				</div>
			</div>
		</div>
	);
}

// The issues page (decision 43): the list to fix in your sequence, the list for later, and the closed issues. After the
// gate "Accept the issues", the page shows the lists, and you can write the notes until the gate "Accept the fix plan"
function IssuesPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const review = task.review!;
	const last = review.toFix.length - 1;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Issues</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					A new session of Claude reviewed the whole diff of the task, and it changed no file. Now you put the issues to fix in sequence, as the tasks on
					the order page. You can keep an issue for later, close an issue that is not a problem, write a note for the plan, and add an issue of yours.
					Shotgun does not move an issue.
				</p>
				<p class="muted small">
					<span class="badge claude">Model</span> issues · <span class="badge engine">Engine</span> facts of DataFlow · <span class="badge user">You</span> sequence
				</p>
				<RoundLine review={review} />
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<div class="row-head"><span class="name">To fix</span><span class="badge user">You</span><span class="muted">{review.toFix.length}</span></div>
						{review.toFix.length === 0 ? <p class="muted">No issue to fix. Your gate ends the task.</p> : (
							<ol class="order-list" aria-label="The issues to fix in your sequence">
								{review.toFix.map((r, i) => <FixRow row={r} index={i} last={last} review={review} />)}
							</ol>
						)}
						{review.canEditIssues && <AddIssue max={review.maxUserIssue} />}
					</section>
					<section class="card">
						<div class="row-head"><span class="name">For later</span><span class="muted">{review.later.length}</span></div>
						{review.later.length === 0 ? <p class="muted">No issue for later.</p> : (
							<ul class="order-list" aria-label="The issues for later">{review.later.map((r) => <LaterRow row={r} review={review} />)}</ul>
						)}
						{review.round && (
							<p class="muted small">
								The review puts {count(review.round.cap, 'issue')} or fewer into the list to fix, for {count(review.round.changedLines, 'changed line')}.
								The other issues are for later.
							</p>
						)}
					</section>
					{review.closedIssues.length > 0 && (
						<section class="card">
							<div class="row-head"><span class="name">Closed</span><span class="badge user">You</span><span class="muted">{review.closedIssues.length}</span></div>
							<ul class="order-list" aria-label="The issues that you closed">{review.closedIssues.map((i) => <ClosedRow issue={i} review={review} />)}</ul>
							<p class="muted small">The ledger keeps your reason. The next review gets it, and names the issue again only with new evidence.</p>
						</section>
					)}
					{review.fixed.length > 0 && (
						<section class="card">
							<div class="row-head"><span class="name">Fixed</span><span class="muted">{review.fixed.length}</span></div>
							<ul class="order-list" aria-label="The fixed issues">{review.fixed.map((r) => <FixedRow row={r} />)}</ul>
							<p class="muted small">The next round checks each fix.</p>
						</section>
					)}
				</div>
				<div class="column">
					<section class="card">
						<RoundBar review={review} />
						<div class="row-head">
							<span class="name">Your sequence</span>
							<span class="badge user">You</span>
							<span class="muted">{count(review.toFix.length, 'issue')} to fix, {review.later.length} for later</span>
						</div>
						<p>
							The sequence, each note, each issue of yours and each reason are your decisions. The ledger records them, and the next review gets your
							reasons.
						</p>
					</section>
					{review.phase === 'issues' && <section class="card"><IssueCheck review={review} /></section>}
					{review.feedback && (
						<section class="card">
							<div class="row-head"><span class="name">Your feedback</span><span class="badge user">You</span></div>
							<Feedback review={review} hasRates />
						</section>
					)}
					<section class="card">
						{review.phase !== 'issues' && !task.isDone && (
							<p class="muted small">
								You accepted the issues of round {review.roundNumber}. {review.phase === 'plan' ? 'The page of the fix plan shows the plan of Claude.'
									: 'The panel of Shotgun shows the current step of the fixes.'}
							</p>
						)}
						<PhaseGate task={task} hasAfter />
					</section>
				</div>
			</div>
		</div>
	);
}

// The issues and the steps of the plan of the fixes: each issue to fix needs a step
function IssueSteps({ review, view, onSelect }: { review: ReviewView; view: PlanView; onSelect: (id: string) => void }) {
	const rows = [...review.toFix, ...review.fixed];
	const named = [...new Set(view.steps.flatMap((s) => s.fixes ?? []))];
	const ids = [...named, ...review.toFix.map((r) => r.issue.id).filter((id) => !named.includes(id))];
	const missing = ids.filter((id) => !named.includes(id)).length;
	return (
		<>
			<div class="row-head">
				<span class="name">Issues and steps</span>
				<span class="badge rule">Rule</span>
				<span class={missing === 0 ? 'state ok-text' : 'state warn-text'}>{missing === 0 ? 'each issue has a step' : `${missing} with no step`}</span>
			</div>
			<ul class="list">
				{ids.map((id) => {
					const row = rows.find((r) => r.issue.id === id);
					const steps = view.steps.filter((s) => s.fixes?.includes(id));
					return (
						<li>
							<span class="id">{id}</span>
							<span class="grow">{row ? titleOf(row) : id}</span>
							{steps.length === 0 ? <span class="warn-text small">no step</span> : steps.map((s) => (
								<button type="button" class="chip mono" title={`Show step ${s.ref}`} onClick={() => onSelect(s.id)}>{s.ref}</button>
							))}
						</li>
					);
				})}
			</ul>
			{review.later.length > 0 && (
				<p class="muted small">For later: {review.later.map((r) => r.issue.id).join(', ')}. Claude plans no step for {review.later.length === 1 ? 'it' : 'them'}.</p>
			)}
		</>
	);
}

// The page of the plan of the fixes (decision 43), as the plan page of stage 4: the steps of Claude, the selected step and
// its place. Each step names the issues that it fixes
export function FixPlanPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const review = task.review!;
	const view = review.fixPlan;
	const [selected, setSelected] = useState<string | undefined>(view?.steps[0]?.id);
	// a click on a CodeLens line in the text editor selects its step
	useEffect(() => {
		const listener = (event: MessageEvent<ToView>) => {
			if (event.data?.type === 'selectStep') {
				setSelected(event.data.id);
			}
		};
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	}, []);
	const step = view?.steps.find((s) => s.id === selected) ?? view?.steps[0];
	const issues = view ? new Set(view.steps.flatMap((s) => s.fixes ?? [])).size : 0;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Fix plan</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				{view ? (
					<>
						<p class="intro">
							You asked Claude: "{PLAN_FIXES}" Claude wrote {count(view.steps.length, 'step')} for {count(issues, 'issue')} in your sequence. The places of a step
							are all places that its fix changes. A rule made each risk level from the facts of DataFlow, as in stage 4. Only you can change a level.
						</p>
						<p class="muted small">
							<span class="badge claude">Model</span> steps · <span class="badge engine">Engine</span> heat of DataFlow · <span class="badge rule">Rule</span> risk levels
						</p>
						{view.waiting > 0 && <p class="notice">{count(view.waiting, 'step')} {view.waiting === 1 ? 'has' : 'have'} no level until the end of the scan of the call graph.</p>}
					</>
				) : (
					<p class="intro">
						You accepted {count(review.toFix.length, 'issue')} to fix. Claude writes the steps of the fixes in your sequence, as the plan of stage 4.
					</p>
				)}
			</header>
			<div class="grid">
				<div class="column">
					{!view ? (
						<section class="card">
							<h2 class="name">Plan of the fixes</h2>
							<p>Claude did not give the plan of the fixes yet. In Claude Code:</p>
							<TellClaude text={PLAN_FIXES} />
							<p class="muted small">Until your gate, you can write a note for an issue on the issues page. Claude gets your notes.</p>
						</section>
					) : (
						<>
							<section class="card">
								<div class="row-head">
									<span class="name">Steps</span>
									<span class="badge claude">Model</span>
									<span class="muted">{view.steps.length}, in the sequence of your issues</span>
								</div>
								<div class="steps">
									{view.steps.map((s) => (
										<button type="button" class={s.id === step?.id ? 'step-row on' : 'step-row'} aria-pressed={s.id === step?.id} onClick={() => setSelected(s.id)}>
											<span class="step-num">{s.ref}</span>
											<span class="grow">{s.title}<span class="block muted small">Fixes {(s.fixes ?? []).join(', ')}</span></span>
											<BuildState build={task.build} id={s.id} />
											<RiskBar level={s.level} />
											<WriterMark writer={s.writer} />
										</button>
									))}
								</div>
							</section>
							{step && <StepDetail step={step} view={view} build={task.build} />}
						</>
					)}
				</div>
				<div class="column">
					{step && <PlaceCard step={step} />}
					<section class="card">
						<RoundBar review={review} />
						{view && (
							<>
								<div class="name">Writers of the {count(view.steps.length, 'step')}</div>
								<Writers view={view} />
							</>
						)}
					</section>
					{view && (
						<section class="card">
							<IssueSteps review={review} view={view} onSelect={setSelected} />
						</section>
					)}
					{view && (
						<section class="card">
							<div class="row-head"><span class="name">Levels that you changed</span><span class="badge user">You</span><span class="muted">{view.changed.length || 'none'}</span></div>
							{view.changed.length === 0 ? <p>Each level is the level of the rules.</p> : (
								<ul class="list">
									{view.changed.map((c) => (
										<li>
											<button type="button" class="link part grow" onClick={() => setSelected(c.step)}>
												Step {c.step}: level {c.level}.{c.rule ? ` The rules gave ${c.rule}.` : ''}
												<span class="block muted small">{c.note ? `Your note: ${c.note}` : 'No note yet. Write your reason in the note of the step.'}</span>
											</button>
										</li>
									))}
								</ul>
							)}
							<p class="muted small">The ledger records each changed level and each note.</p>
						</section>
					)}
					<section class="card">
						{review.phase === 'plan' && view && !task.isDone && (
							<>
								<div class="name">Change the plan</div>
								<p class="muted small">Before your gate, tell Claude what to change, for example:</p>
								<TellClaude text={CHANGE_EXAMPLE} />
							</>
						)}
						{review.phase === 'fixes' && !task.isDone && <p class="muted">You accepted the fix plan. The panel of Shotgun shows the current step of the fixes.</p>}
						<PhaseGate task={task} hasAfter />
					</section>
				</div>
			</div>
		</div>
	);
}

// The page of stage 6 for the tab of the review: the review before a round, else the issues page
export function ReviewPage({ task, model }: { task: TaskView; model: ViewModel }) {
	return task.review!.phase === 'review' ? <ReviewStart task={task} model={model} /> : <IssuesPage task={task} model={model} />;
}

// The part of the round in the panel
function PhasePanel({ task }: { task: TaskView }) {
	const review = task.review!;
	const build = task.build;
	switch (review.phase) {
		case 'review':
			return (
				<>
					<RoundLine review={review} />
					{!task.isDone && <ReviewOptions review={review} />}
				</>
			);
		case 'issues': {
			const warnings = review.checks.filter((c) => c.isWarning);
			return (
				<>
					<RoundLine review={review} />
					<p>
						Your issues: {count(review.toFix.length, 'issue')} to fix, {review.later.length} for later{review.closed > 0 ? `, ${review.closed} closed` : ''}.
						{review.toFix.length > 0 ? ' Put them in sequence on the page.' : ''}
					</p>
					{warnings.map((w) => <p class="notice">{w.text}</p>)}
					<div class="buttons"><CommandButton label="Show the issues" command="showPage" isPrimary /></div>
					{/* a new review of the round, for example with a different effort, before the gate "Accept the issues" */}
					{!task.isDone && (
						<details class="section">
							<summary>Review round {review.roundNumber} again</summary>
							<p class="muted small">A new review replaces the open issues of round {review.roundNumber}. It keeps the issues that you closed, and your issues.</p>
							<ReviewOptions review={review} />
						</details>
					)}
				</>
			);
		}
		case 'plan': {
			const plan = review.fixPlan;
			if (!plan) {
				return (
					<>
						<p>Claude writes the plan of the fixes for {count(review.toFix.length, 'issue')} in your sequence.</p>
						{task.request && (
							<>
								<p class="muted">In Claude Code:</p>
								<TellClaude text={task.request} />
							</>
						)}
					</>
				);
			}
			const w = plan.writers;
			return (
				<>
					<p>
						The plan of the fixes: {count(plan.steps.length, 'step')}. You write {w.user}{w.frame > 0 ? `, a frame has ${w.frame},` : ''} and Claude writes {w.claude}.
					</p>
					<Writers view={plan} />
					{plan.waiting > 0 && <p class="notice">{count(plan.waiting, 'step')} wait for the end of the scan of the call graph.</p>}
					<div class="buttons"><CommandButton label="Show the fix plan" command="showPage" isPrimary /></div>
				</>
			);
		}
		case 'fixes': {
			const ids = new Set(review.fixPlan?.steps.map((s) => s.id) ?? []);
			const steps = build?.steps.filter((s) => ids.has(s.id)) ?? [];
			return (
				<>
					<div class="row-head"><span class="name">Steps of the fixes</span><span class="muted">{review.fixSteps.done} of {review.fixSteps.total} done</span></div>
					<StepList steps={steps} label="The steps of the fixes" />
					{build?.current ? (
						<>
							<CurrentStep step={build.current} request={task.request} maxNote={build.maxNote} />
							{task.stepGate && <GateBlock gate={task.stepGate} message="stepGate" />}
							<Navigator nav={build.navigator} />
						</>
					) : <p>Each step of the fixes is done.</p>}
				</>
			);
		}
	}
}

type PanelTab = 'review' | 'loose' | 'ledger';

// The panel in stage 6 has 3 tabs. The tab of the review has the parts of the round, and in the fixes, the current step
// with its own gate. The other tabs have the loose ends and the ledger
export function ReviewSummary({ task }: { task: TaskView }) {
	const review = task.review!;
	const build = task.build;
	const [tab, setTab] = useState<PanelTab>('review');
	const tabs: [PanelTab, string][] = [
		['review', review.open > 0 ? `Review (${review.open})` : 'Review'],
		...(build ? [['loose', build.loose.open > 0 ? `Loose ends (${build.loose.open})` : 'Loose ends'] as [PanelTab, string]] : []),
		...(task.ledger ? [['ledger', 'Ledger'] as [PanelTab, string]] : []),
	];
	const shown: PanelTab = tabs.some(([id]) => id === tab) ? tab : 'review';
	return (
		<div>
			<div class="head">
				<span class="name">{task.isDone ? 'Done' : task.stageName}</span>
				{!task.isDone && <WriterBadges writer={task.writer} />}
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			<div class="tabs" role="tablist" aria-label="The parts of the review">
				{tabs.map(([id, label]) => (
					<button type="button" role="tab" class={`tab${shown === id ? ' on' : ''}`} aria-selected={shown === id} onClick={() => setTab(id)}>{label}</button>
				))}
			</div>
			{shown === 'review' && (
				<>
					{review.baseError && <p class="notice">{review.baseError}</p>}
					<RoundBar review={review} />
					<PhasePanel task={task} />
				</>
			)}
			{shown === 'loose' && build && <LooseEnds loose={build.loose} />}
			{shown === 'ledger' && task.ledger && <LedgerPanel ledger={task.ledger} />}
			<PhaseGate task={task} />
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}

// The page of the ledger in stage 6
export function ReviewLedger({ task, model }: { task: TaskView; model: ViewModel }) {
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Ledger</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
			</header>
			<LedgerPage title={task.title} ledger={task.ledger!} />
		</div>
	);
}
