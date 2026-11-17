import { useEffect, useState } from 'preact/hooks';
import type { IssueView, ReviewView, TaskView, ViewModel } from '../views/protocol';
import { CommandButton, GateBlock, PlaceLink, StageBar, WriterBadges } from './common';
import { LedgerPage, LedgerPanel } from './ledger';
import { post } from './vscode';

// Stage 6: the review (phase 12). The user selects the effort and the focus, and copies the prompt of the review into a
// new session of Claude Code. That session did not write the code, so it reviews with a fresh view (decision 35). Shotgun
// shows the issues of Claude in 2 lists: the list of steps, and the second list for the issues that are less sure (P22).
// A button records a decision of the user, and it never starts Claude.

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The effort, the areas of the focus and a point of the user. Each change goes to the extension at once
function ReviewOptions({ review }: { review: ReviewView }) {
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
			<button type="button" class="btn primary" title="Copy the prompt of the review. Then paste it into a new session of Claude Code."
				onClick={() => post({ type: 'copyReviewPrompt' })}>
				Copy the review prompt
			</button>
			<p class="muted small">
				Start a new session of Claude Code in the folder of the project, and paste the prompt. A new session did not write the code, so it reviews
				with a fresh view.
			</p>
		</div>
	);
}

const SEVERITY_CLASS = { important: 'k-problem', minor: 'k-info' } as const;

// An issue of the review. compact: the short form of the panel
function IssueCard({ issue, isCompact, isDone }: { issue: IssueView; isCompact?: boolean; isDone: boolean }) {
	const isEngine = issue.source === 'engine';
	return (
		<li class={`issue s-${issue.state}`}>
			<div class="row-head">
				<span class="id">{issue.id}</span>
				<span class="change-title grow">{issue.title}</span>
				<span class={`kind-chip ${SEVERITY_CLASS[issue.severity]}`}>{issue.severity}</span>
			</div>
			<p class="change-place"><PlaceLink place={issue.place} note={`${issue.id} · ${issue.title}`} /></p>
			<p>{issue.summary}</p>
			<div class={`order-note${isEngine ? '' : ' claude'}`}>
				<span class={`badge ${isEngine ? 'engine' : 'claude'}`}>{isEngine ? 'Engine' : 'Model'}</span>
				<span>
					{issue.areaName} · {issue.category} · {issue.verdict}{issue.origin === 'pre-existing' ? ' · pre-existing' : ''}
				</span>
			</div>
			{!isCompact && (
				<dl class="scenario">
					<dt>Trigger</dt><dd>{issue.scenario.trigger}</dd>
					<dt>Path</dt><dd>{issue.scenario.path}</dd>
					<dt>Result</dt><dd>{issue.scenario.result}</dd>
					{issue.scenario.interleave && <><dt>Interleave</dt><dd>{issue.scenario.interleave}</dd></>}
				</dl>
			)}
			{!isCompact && issue.decisions.length > 0 && (
				<div class="issue-decisions">
					<div class="muted small">Open decisions of the fix</div>
					<ul>
						{issue.decisions.map((d) => (
							<li><span class="id">{d.id}</span> {d.question}{d.options ? <span class="muted"> Options: {d.options.join('; ')}</span> : ''}</li>
						))}
					</ul>
				</div>
			)}
			{!isCompact && issue.fixPlaces.length > 0 && (
				<p class="small">
					<span class="muted">Also fix: </span>
					{issue.fixPlaces.map((p) => <span class="block"><PlaceLink place={p} note={`${issue.id} · fix place`} /></span>)}
				</p>
			)}
			{!isCompact && <p class="muted small">Evidence of DataFlow: {issue.tools.join(', ')}. Round {issue.round}.</p>}
			{issue.listReason && <p class="muted small">{issue.listReason}</p>}
			{issue.evidence && <p class="small"><span class="muted">New evidence of Claude: </span>{issue.evidence}</p>}
			{issue.state === 'closed' && <p class="muted small">You closed this issue: not a problem. Your reason: "{issue.reason}". The next review gets it.</p>}
			{!isDone && (
				<div class="buttons">
					{issue.state === 'open' && (
						<button type="button" class="btn secondary small" title="The ledger keeps your reason, and the next review gets it"
							onClick={() => post({ type: 'closeIssue', id: issue.id })}>
							Not a problem
						</button>
					)}
					{issue.state === 'closed' && (
						<button type="button" class="btn secondary small" onClick={() => post({ type: 'reopenIssue', id: issue.id })}>Open again</button>
					)}
				</div>
			)}
		</li>
	);
}

function IssueList({ issues, isCompact, isDone, empty }: { issues: IssueView[]; isCompact?: boolean; isDone: boolean; empty: string }) {
	return issues.length === 0 ? <p class="muted">{empty}</p>
		: <ul class="issues">{issues.map((i) => <IssueCard issue={i} isCompact={isCompact} isDone={isDone} />)}</ul>;
}

// The last round of the review in 1 line
function RoundLine({ review }: { review: ReviewView }) {
	const r = review.round;
	if (!r) {
		return <p class="muted">No review yet. Copy the review prompt into a new session of Claude Code.</p>;
	}
	return (
		<p class="muted small">
			Round {r.n} at the effort {r.effortName.toLowerCase()}, focus {r.areaNames.join(', ').toLowerCase()}: {count(r.changedLines, 'changed line')}, a cap of
			{' '}{count(r.cap, 'step')}.{r.note ? ` Claude: ${r.note}` : ''}
		</p>
	);
}

type PanelTab = 'review' | 'ledger';

// The panel in stage 6: the tab of the review with the options, the prompt and the list of steps, and the tab of the ledger
export function ReviewSummary({ task }: { task: TaskView }) {
	const review = task.review!;
	const [tab, setTab] = useState<PanelTab>('review');
	return (
		<div>
			<div class="head">
				<span class="name">{task.isDone ? 'Done' : task.stageName}</span>
				{!task.isDone && <WriterBadges writer={task.writer} />}
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			<div class="tabs" role="tablist" aria-label="The parts of the review">
				<button type="button" role="tab" class={`tab${tab === 'review' ? ' on' : ''}`} aria-selected={tab === 'review'} onClick={() => setTab('review')}>
					{review.open > 0 ? `Review (${review.open})` : 'Review'}
				</button>
				{task.ledger && (
					<button type="button" role="tab" class={`tab${tab === 'ledger' ? ' on' : ''}`} aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')}>
						Ledger
					</button>
				)}
			</div>
			{tab === 'review' && (
				<>
					{review.baseError && <p class="notice">{review.baseError}</p>}
					{!task.isDone && <ReviewOptions review={review} />}
					<RoundLine review={review} />
					{review.round && (
						<>
							<div class="row-head"><span class="name">List of steps</span><span class="muted">{review.open} open</span></div>
							<IssueList issues={review.steps} isCompact isDone={task.isDone} empty="No issue for your steps." />
							{review.second.length > 0 && <p class="muted small">The second list has {count(review.second.length, 'issue')}. The page shows it.</p>}
							<div class="buttons"><CommandButton label="Show the issues on the page" command="showPage" isSmall /></div>
						</>
					)}
				</>
			)}
			{tab === 'ledger' && task.ledger && <LedgerPanel ledger={task.ledger} />}
			{task.gate && <GateBlock gate={task.gate} />}
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}

// The page of the review: the options of the next review, the list of steps, and the second list
export function ReviewPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const review = task.review!;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Review</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					A new session of Claude Code reviews the whole diff of the task with your effort and focus. Each issue has a failure scenario and the evidence of
					DataFlow. The list of steps has the confirmed new issues, the important issues first. The second list has the issues that are less sure, the
					issues from before the task, and the issues above the cap.
				</p>
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<h2 class="name">List of steps</h2>
						<RoundLine review={review} />
						<IssueList issues={review.steps} isDone={task.isDone} empty={review.round ? 'No issue for your steps.' : 'No review yet.'} />
					</section>
					<section class="card">
						<h2 class="name">Second list</h2>
						<IssueList issues={review.second} isDone={task.isDone} empty="No issue in the second list." />
					</section>
				</div>
				<div class="column">
					{!task.isDone && (
						<section class="card">
							<h2 class="name">The next review</h2>
							{review.base && <p class="muted small">Base commit: {review.base}</p>}
							{review.baseError && <p class="notice">{review.baseError}</p>}
							<ReviewOptions review={review} />
						</section>
					)}
					{task.gate && <section class="card"><GateBlock gate={task.gate} /></section>}
				</div>
			</div>
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
