import { useState } from 'preact/hooks';
import type { LedgerView, LooseEndView, LooseView, MessageView } from '../views/protocol';
import { PlaceLink, TellClaude } from './common';
import { post } from './vscode';

// Stage 5: the loose ends and the ledger (phase 9). The engine finds the loose ends at the gate of each step. A mechanical
// loose end can go to Claude: a click of the user makes it the next step of the plan (decision 21), and then the user
// tells Claude "Do the loose ends.". The ledger shows the decisions, the lines of each writer, and the commit message of
// Source Control with the check of Claude. A button records a decision of the user, and it never starts Claude.

const SOURCE_TEXT = { members: 'data member', switch: 'switch', ripple: 'ripple', claude: 'Claude' } as const;
const HANDED_TEXT = { todo: 'to do', open: 'Claude writes it', receipt: 'receipt to walk', holes: 'holes', done: 'done' } as const;
const POINT_GLYPH = { ok: '✓', missing: '!', wrong: '!', question: '?' } as const;
const POINT_TEXT = { ok: 'agrees', missing: 'missing', wrong: 'wrong', question: 'question' } as const;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A loose end: its place, the facts of the engine or the words of Claude, and the buttons of the user
function LooseEndCard({ end }: { end: LooseEndView }) {
	const isClaude = end.source === 'claude';
	return (
		<li class={`loose-end s-${end.state}`}>
			<div class="row-head">
				<span class="change-title grow">{end.title}</span>
				<span class="kind-chip k-info">{SOURCE_TEXT[end.source]}</span>
			</div>
			{end.place && end.path && end.line && <p class="change-place"><PlaceLink place={{ name: end.place, path: end.path, line: end.line }} note={`${end.id} · ${end.title}`} /></p>}
			<div class={`order-note${isClaude ? ' claude' : ''}`}>
				<span class={`badge ${isClaude ? 'claude' : 'engine'}`}>{isClaude ? 'Model' : 'Engine'}</span>
				<span>{end.proof.map((p) => <span class="block">{p}</span>)}</span>
			</div>
			<p class="muted small">From step {end.stepN}.</p>
			{end.state === 'handed' && end.handed && (
				<p class="small">Step {end.handed.n} of Claude: <span class="muted">{HANDED_TEXT[end.handed.state]}</span></p>
			)}
			{end.state === 'closed' && <p class="muted small">You closed this loose end. Your reason: "{end.reason}". The ledger keeps it.</p>}
			<div class="buttons">
				{end.state === 'open' && end.kind === 'mechanical' && end.place && (
					<button type="button" class="btn primary small" title="The loose end becomes the next step of the plan for Claude"
						onClick={() => post({ type: 'handLooseEnd', id: end.id })}>
						Hand to Claude
					</button>
				)}
				{end.state === 'open' && <button type="button" class="btn secondary small" onClick={() => post({ type: 'closeLooseEnd', id: end.id })}>Close</button>}
				{end.state === 'closed' && <button type="button" class="btn secondary small" onClick={() => post({ type: 'reopenLooseEnd', id: end.id })}>Open again</button>}
			</div>
		</li>
	);
}

// The tab "Loose ends" of the panel: the decisions of the user, the mechanical loose ends, and the loose ends of Claude
export function LooseEnds({ loose }: { loose: LooseView }) {
	const open = loose.ends.filter((e) => e.state === 'open');
	const decisions = open.filter((e) => e.kind === 'decision');
	const mechanical = open.filter((e) => e.kind === 'mechanical');
	const handed = loose.ends.filter((e) => e.state === 'handed');
	const closed = loose.ends.filter((e) => e.state === 'closed');
	return (
		<section class="loose">
			<div class="row-head">
				<span class="name">Loose ends</span>
				<span class="badge engine">Engine</span>
				<span class="muted">{loose.checked}</span>
			</div>
			{loose.ends.length === 0 && (
				<p class="muted small">No loose end. At the gate of each step, Shotgun gets the places that the changes can also need from DataFlow.</p>
			)}
			{loose.request && (
				<>
					<p class="muted">A loose end is the next step of Claude. Tell Claude:</p>
					<TellClaude text={loose.request} />
				</>
			)}
			{decisions.length > 0 && (
				<>
					<div class="row-head"><span class="name">Decisions: yours</span><span class="muted">{decisions.length}</span></div>
					<ul class="loose-ends">{decisions.map((e) => <LooseEndCard end={e} />)}</ul>
				</>
			)}
			{mechanical.length > 0 && (
				<>
					<div class="row-head"><span class="name">Mechanical: you can hand them over</span><span class="muted">{mechanical.length}</span></div>
					<ul class="loose-ends">{mechanical.map((e) => <LooseEndCard end={e} />)}</ul>
					<p class="muted small">Your click hands a loose end over. Then tell Claude "Do the loose ends."</p>
				</>
			)}
			{handed.length > 0 && (
				<>
					<div class="row-head"><span class="name">Handed to Claude</span><span class="muted">{handed.length}</span></div>
					<ul class="loose-ends">{handed.map((e) => <LooseEndCard end={e} />)}</ul>
				</>
			)}
			{closed.length > 0 && (
				<details>
					<summary class="name">Closed: {closed.length}</summary>
					<ul class="loose-ends">{closed.map((e) => <LooseEndCard end={e} />)}</ul>
				</details>
			)}
		</section>
	);
}

// The commit message of Source Control, and the check of Claude with the badge Model
export function MessageCheck({ message }: { message: MessageView }) {
	const check = message.check;
	return (
		<section class="message">
			<div class="row-head"><span class="name">Commit message</span><span class="badge user">You</span></div>
			{!message.hasRepository ? <p class="muted small">Shotgun found no repository of git for this folder in Source Control.</p>
				: message.text.trim() ? <pre class="message-text">{message.text}</pre>
					: <p class="muted small">You write the message in the input box of Source Control. Shotgun shows the same text here.</p>}
			<div class="row-head">
				<span class="name">Check against the diff</span>
				<span class="badge claude">Model</span>
				{check && <span class="muted">{check.agrees ? 'agrees' : 'does not agree'}</span>}
			</div>
			{check ? (
				<>
					{check.isOld && <p class="banner">The message changed after this check. Ask Claude again for a check of the message now.</p>}
					<ul class="points">
						{check.points.map((p) => (
							<li class={`point p-${p.kind}`}>
								<span class="point-glyph" title={POINT_TEXT[p.kind]}>{POINT_GLYPH[p.kind]}</span>
								<span class="grow">
									{p.text}
									{p.place && p.path && p.line && <> <PlaceLink place={{ name: p.place, path: p.path, line: p.line }} note={p.text} /></>}
								</span>
							</li>
						))}
					</ul>
					{check.note && <div class="order-note claude"><span class="badge claude">Model</span><span>{check.note}</span></div>}
					<p class="muted small">A model made this check. Compare its words with the diff.</p>
				</>
			) : <p class="muted small">No check yet. Claude makes this check when you ask.</p>}
			{message.hasRepository && message.text.trim() && <TellClaude text={message.request} />}
			<p class="muted small">Shotgun makes no commit. You commit in Source Control.</p>
		</section>
	);
}

// The tab "Ledger" of the panel: the totals, the commit message and its check, and the page of the ledger
export function LedgerPanel({ ledger }: { ledger: LedgerView }) {
	return (
		<section class="ledger">
			<div class="row-head">
				<span class="name">Ledger</span>
				<span class="muted">{count(ledger.decisions.user, 'decision')} of yours</span>
			</div>
			<p class="small">
				{count(ledger.user, 'line')} of yours, {count(ledger.walked + ledger.notWalked, 'line')} of Claude
				{ledger.notWalked > 0 ? `, ${ledger.notWalked} not walked` : ''}.
			</p>
			<div class="buttons">
				<button type="button" class="btn secondary small" onClick={() => post({ type: 'showLedger' })}>Show the ledger</button>
				<button type="button" class="btn secondary small" onClick={() => post({ type: 'copyLedger' })}>Copy for the pull request</button>
			</div>
			<MessageCheck message={ledger.message} />
		</section>
	);
}

// The page of the ledger: the decisions, the lines of each writer in each file, and the commit message
export function LedgerPage({ title, ledger }: { title: string; ledger: LedgerView }) {
	const [isAll, setAll] = useState(false);
	const shown = isAll ? ledger.userDecisions : ledger.userDecisions.slice(-20);
	return (
		<div class="grid">
			<div class="column">
				<section class="card">
					<h2 class="name">Your decisions in this task</h2>
					<p class="muted small">{count(ledger.decisions.user, 'decision')} of yours, {count(ledger.decisions.claude, 'result')} of Claude. Each one is in the ledger file decisions.jsonl.</p>
					{ledger.userDecisions.length === 0 ? <p class="muted">No decision yet.</p> : (
						<ol class="list decisions-list">
							{shown.map((d) => (
								<li>
									<span class="time">{d.n}</span>
									<span class="text">{d.text}</span>
								</li>
							))}
						</ol>
					)}
					{!isAll && ledger.userDecisions.length > shown.length && (
						<button type="button" class="btn secondary small" onClick={() => setAll(true)}>Show all {ledger.userDecisions.length}</button>
					)}
					<div class="buttons">
						<button type="button" class="btn primary" onClick={() => post({ type: 'copyLedger' })}>Copy for the pull request</button>
					</div>
					<p class="muted small">The copy is Markdown with your decisions and the lines of each writer, for the pull request of "{title}".</p>
				</section>
			</div>
			<div class="column">
				<section class="card">
					<h2 class="name">Lines</h2>
					<p class="small">
						{count(ledger.user, 'line')} of yours, {count(ledger.walked, 'line')} of Claude walked, {count(ledger.notWalked, 'line')} of Claude not walked.
					</p>
					{ledger.rows.length === 0 ? <p class="muted">No line of a writer yet.</p> : (
						// a narrow card scrolls the table, so no column gets cut off
						<div class="table-wrap">
							<table class="ledger-table">
								<thead>
									<tr><th scope="col">File</th><th scope="col">Yours</th><th scope="col">Claude, walked</th><th scope="col">Not walked</th><th scope="col"><span class="hidden">Walk</span></th></tr>
								</thead>
								<tbody>
									{ledger.rows.map((r) => (
										<tr>
											<td><PlaceLink place={{ name: r.file, path: r.path, line: 1 }} editor /></td>
											<td>{r.user}</td>
											<td>{r.walked}</td>
											<td class={r.notWalked > 0 ? 'warn' : ''}>{r.notWalked}</td>
											<td>
												{r.firstNotWalked !== undefined && (
													<button type="button" class="btn secondary small" title="Open the first line of Claude that you did not walk"
														onClick={() => post({ type: 'openPlace', path: r.path, line: r.firstNotWalked! })}>
														Walk
													</button>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<p class="muted small">Walked: lines of Claude with your mark on their change, and the lines of the frames. lines.json keeps the writer of each line.</p>
				</section>
				<section class="card">
					<MessageCheck message={ledger.message} />
				</section>
			</div>
		</div>
	);
}
