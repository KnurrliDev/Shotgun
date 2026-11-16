import { useEffect, useRef, useState } from 'preact/hooks';
import type {
	BuildStepView, CalloutView, CurrentStepView, HintPlaceView, HoleView, LineAnswerView, NavigatorView, ReceiptChangeView, ReceiptView, TaskView,
} from '../views/protocol';
import { GateBlock, PlaceLink, TellClaude, WriterBadges } from './common';
import { LedgerPanel, LooseEnds } from './ledger';
import { post } from './vscode';

// Stage 5: the build in the panel beside the text editor. The steps go in sequence. The current step shows its writer:
// for a step of Claude the request for Claude Code and then the receipt, for a frame its holes and their hints, and for
// a step of the user its places, its text and its checks. The user walks the receipt and puts a mark on each change. A
// mark, a note, a hint or a button records a decision of the user, and it never starts Claude.

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STATE_TEXT = { todo: 'to do', open: 'open', receipt: 'receipt', holes: 'holes', done: 'done' } as const;
const HINTS = ['Nudge', 'Pointer', 'Example', 'Show me'];
const MARKS = [
	{ mark: 'ok', glyph: '✓', label: 'OK' },
	{ mark: 'issue', glyph: '!', label: 'Issue' },
	{ mark: 'question', glyph: '?', label: 'Question' },
] as const;

// The state of a step of the build: to do, open, receipt to walk, or done
export function StateChip({ state, writer }: { state: BuildStepView['state']; writer: BuildStepView['writer'] }) {
	return <span class={`state-chip st-${state} ${writer}`}>{state === 'open' && writer === 'user' ? 'you write' : STATE_TEXT[state]}</span>;
}

function StepList({ steps }: { steps: BuildStepView[] }) {
	return (
		<ol class="build-steps" aria-label="The steps of the plan">
			{steps.map((s) => (
				<li class={`build-step st-${s.state}${s.isCurrent ? ' current' : ''}`} aria-current={s.isCurrent ? 'step' : undefined}>
					<span class={`state-glyph st-${s.state}`} aria-hidden="true">{s.state === 'done' ? '✓' : s.isCurrent ? '●' : '○'}</span>
					<span class={`step-num lv-${s.level ?? 0}`}>{s.n}</span>
					<span class="grow">{s.title}</span>
					<span class="dots" title={s.writerText}>
						{s.writer !== 'user' && <span class="dot claude" />}
						{s.writer !== 'claude' && <span class="dot user" />}
					</span>
				</li>
			))}
		</ol>
	);
}

// The note of the user for a change. The note goes to the extension when the field loses the focus, or with Enter
function ChangeNote({ step, change, maxNote }: { step: string; change: ReceiptChangeView; maxNote: number }) {
	const [note, setNote] = useState(change.userNote);
	const sent = useRef(change.userNote);
	useEffect(() => {
		setNote(change.userNote);
		sent.current = change.userNote;
	}, [change.id, change.userNote]);
	const commit = () => {
		if (note.trim() !== sent.current.trim()) {
			sent.current = note;
			post({ type: 'setChangeNote', step, change: change.id, note });
		}
	};
	return (
		<label class="note-field">
			Your note for Claude
			<input type="text" value={note} maxLength={maxNote} placeholder="For example what is wrong, or your question"
				onInput={(e) => setNote((e.target as HTMLInputElement).value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						commit();
					} else if (e.key === 'Escape') {
						setNote(sent.current);
					}
				}} />
		</label>
	);
}

function ChangeCard({ step, change, maxNote, isEditable }: { step: string; change: ReceiptChangeView; maxNote: number; isEditable: boolean }) {
	const glyph = MARKS.find((m) => m.mark === change.mark)?.glyph ?? String(change.n);
	return (
		<li class={`change m-${change.mark}`}>
			<div class="change-head">
				<span class={`change-num m-${change.mark}`} aria-label={change.mark === 'todo' ? `Change ${change.n}, not walked` : `Change ${change.n}: ${change.mark}`}>
					{glyph}
				</span>
				<span class="grow change-title">{change.title}</span>
				<span class="mono small"><span class="plus">+{change.added}</span> <span class="minus">−{change.removed}</span></span>
			</div>
			<p class="change-place">
				<PlaceLink place={{ name: change.place, path: change.path, line: change.line }} note={`${change.id} · ${change.title}`} />
				{change.heat && <span class={`heat ${change.heat.band.replace(' ', '-')}`} title={`${change.heat.function}: heat ${change.heat.score}`}>{change.heat.band}</span>}
			</p>
			{change.note && <div class="order-note claude"><span class="badge claude">Model</span><span>{change.note}</span></div>}
			<p class="check-line"><span aria-hidden="true">☐</span> {change.check}</p>
			{change.diff.length > 0 && (
				<details class="diff">
					<summary class="muted small">The diff</summary>
					<div class="code">
						{change.diff.map((l) => (
							<div class={`code-line ${l.mark === '+' ? 'add' : l.mark === '-' ? 'del' : ''}`}>
								<span class="ln">{l.line ?? ''}</span>
								<span class="tx">{l.mark === ' ' ? ' ' : l.mark} {l.text}</span>
							</div>
						))}
					</div>
				</details>
			)}
			{isEditable ? (
				<>
					<div class="marks" role="group" aria-label={`Your mark on change ${change.n}`}>
						{MARKS.map((m) => (
							<button type="button" class={`mark-btn m-${m.mark}${change.mark === m.mark ? ' on' : ''}`} aria-pressed={change.mark === m.mark}
								onClick={() => post({ type: 'setMark', step, change: change.id, mark: change.mark === m.mark ? 'todo' : m.mark })}>
								{m.glyph} {m.label}
							</button>
						))}
					</div>
					<ChangeNote step={step} change={change} maxNote={maxNote} />
				</>
			) : change.userNote && <p><span class="badge user">You</span> {change.userNote}</p>}
		</li>
	);
}

function Receipt({ step, receipt, maxNote }: { step: CurrentStepView; receipt: ReceiptView; maxNote: number }) {
	return (
		<div class="receipt">
			<div class="row-head">
				<span class="name">Receipt</span>
				<span class="badge claude">Claude</span>
				<span class="muted mono small"><span class="plus">+{receipt.added}</span> <span class="minus">−{receipt.removed}</span></span>
			</div>
			<p class="muted small">
				Step {step.n}, {step.levelName.toLowerCase()}. Scope: <span class="mono">{step.scope.join(', ')}</span>
				{receipt.round > 1 ? `. Round ${receipt.round}: the receipt has all changes since the first start of the step.` : '.'}
			</p>
			{receipt.denies.length > 0 && (
				<div class="order-warn">
					<span class="badge check">Guard</span>
					<span>{count(receipt.denies.length, 'edit')} out of the scope denied: {[...new Set(receipt.denies.map((d) => d.file))].join(', ')}</span>
				</div>
			)}
			{receipt.outside.length > 0 && (
				<p class="notice">
					These files outside of the scope changed while the step was open: <span class="mono">{receipt.outside.join(', ')}</span>. The guard did not see
					these changes, for example a change through Bash, or a change of a different program.
				</p>
			)}
			{receipt.deleted.length > 0 && <p class="notice">These files of the scope are not there now: <span class="mono">{receipt.deleted.join(', ')}</span>.</p>}
			{receipt.choices.length > 0 && (
				<>
					<div class="row-head"><span class="name">Choices of Claude</span><span class="badge claude">Model</span></div>
					<ul class="list decisions">
						{receipt.choices.map((c) => <li><span class="grow"><span class="decision-question">{c.question}</span> {c.choice}</span></li>)}
					</ul>
					<p class="muted small">Claude decided the open decisions of this step. Check each choice. For a different choice, put an issue on its change.</p>
				</>
			)}
			{receipt.total === 0 ? <p>The receipt has no change. Claude changed no file of the scope.</p> : (
				<>
					<progress class="walk-track" value={receipt.walked} max={receipt.total} aria-label={receipt.walkText} />
					<p class="small">{receipt.walkText}</p>
					<ol class="changes">
						{receipt.changes.map((c) => <ChangeCard step={step.id} change={c} maxNote={maxNote} isEditable={step.isEditable} />)}
					</ol>
				</>
			)}
			{receipt.issues + receipt.questions > 0 && (
				<>
					<p class="muted">For a change with an issue or a question, tell Claude:</p>
					<TellClaude text={`Fix the issues of step ${step.n}.`} />
				</>
			)}
			{receipt.looseEnds.length > 0 && (
				<>
					<div class="row-head"><span class="name">Loose ends</span><span class="badge claude">Model</span></div>
					<ul class="list">
						{receipt.looseEnds.map((e) => (
							<li>
								<span class="grow">
									{e.text}
									{e.place && e.path && (
										<>
											{' '}
											<PlaceLink place={{ name: e.place, path: e.path, line: e.line ?? 1 }} note={e.text} />
										</>
									)}
								</span>
							</li>
						))}
					</ul>
					<p class="muted small">Places outside of the scope that the step can also need. At the gate of the step, they go into the tab Loose ends.</p>
				</>
			)}
			{receipt.notice && <p class="muted small">DataFlow: {receipt.notice}</p>}
		</div>
	);
}

const holeStatus = (h: HoleView): string => (h.state === 'open' ? 'open' : h.state === 'empty' ? 'empty' : h.state === 'changed' ? 'changed'
	: h.by === 'claude' ? 'Claude' : 'yours');

// The selected hole: its question, its place, the facts of DataFlow, and the ladder of its 4 hints
function HoleDetail({ step, hole }: { step: string; hole: HoleView }) {
	return (
		<div class="hole-detail">
			<div class="row-head"><span class="name">Hole {hole.n}</span><span class={`hole-state h-${hole.state}`}>{holeStatus(hole)}</span></div>
			<p class="hole-question">{hole.question}</p>
			<p class="change-place"><PlaceLink place={{ name: hole.place, path: hole.path, line: hole.line }} note={`Hole ${hole.n} · ${hole.question}`} /></p>
			{hole.facts && (hole.facts.function || hole.facts.threads.length > 0 || hole.facts.locks.length > 0 || (hole.facts.names?.length ?? 0) > 0) && (
				<div class="order-note">
					<span class="badge engine">Engine</span>
					<span>
						{hole.facts.function ? `In ${hole.facts.function}.` : ''}
						{hole.facts.threads.length > 0 ? ` The thread ${hole.facts.threads.join(', ')} runs the line.` : ''}
						{hole.facts.locks.length > 0 ? ` The line holds the lock ${hole.facts.locks.join(', ')}.` : ''}
						{hole.facts.names && hole.facts.names.length > 0 ? ` Names in scope: ${hole.facts.names.join(', ')}.` : ''}
					</span>
				</div>
			)}
			{hole.content && <div class="code small"><div class="code-line"><span class="tx">{hole.content}</span></div></div>}
			<div class="row-head"><span class="name">Hint ladder</span></div>
			<div class="marks" role="group" aria-label={`The hints of hole ${hole.n}`}>
				{HINTS.map((label, i) => (
					<button type="button" class={`mark-btn hint-btn${hole.shown > i ? ' on' : ''}${i === 3 ? ' answer' : ''}`} aria-pressed={hole.shown > i}
						disabled={hole.shown > i || hole.state !== 'open' && i === 3}
						onClick={() => post({ type: 'showHint', step, hole: hole.n, level: i + 1 })}>
						{i + 1} {label}
					</button>
				))}
			</div>
			{hole.shown === 0 && (
				<p class="muted small">
					No hint yet. The hints came with the frame, so a click sends no request to Claude. Each step of the ladder gives more help. Step 4 fills
					the hole with the answer of Claude, and its lines are lines of Claude.
				</p>
			)}
			{hole.nudge && <div class="order-note claude"><span class="badge claude">Model</span><span>{hole.nudge}</span></div>}
			{hole.pointer && (
				<div class="order-note claude">
					<span class="badge claude">Model</span>
					<span>{hole.pointer.text} {hole.pointer.places.map((p) => <PlaceLink place={p} note={hole.pointer!.text} />)}</span>
				</div>
			)}
			{hole.example && (
				<>
					<div class="order-note claude"><span class="badge claude">Model</span><span>{hole.example.text} <PlaceLink place={hole.example.place} note={hole.example.text} /></span></div>
					<div class="code small">{hole.example.code.split('\n').map((l) => <div class="code-line"><span class="tx">{l || ' '}</span></div>)}</div>
				</>
			)}
			{hole.answer && (
				<p class="muted small">
					<span class="badge claude">Claude</span> The answer of Claude filled the hole. The ledger counts its lines as lines of Claude.
				</p>
			)}
		</div>
	);
}

// The frame of Claude: its note, the holes with their state, and the selected hole with its hints
function Frame({ step }: { step: CurrentStepView }) {
	const holes = step.holes ?? [];
	const [selected, setSelected] = useState<number | undefined>(undefined);
	const firstOpen = holes.find((h) => h.state === 'open')?.n ?? holes[0]?.n;
	const hole = holes.find((h) => h.n === (selected ?? firstOpen));
	return (
		<div class="receipt">
			{step.frameNote && <div class="order-note claude"><span class="badge claude">Model</span><span>{step.frameNote}</span></div>}
			<p class="muted">For a different frame, tell Claude:</p>
			<TellClaude text={`Give me a different frame for step ${step.n}.`} />
			<div class="row-head">
				<span class="name">Your decisions</span>
				<span class="muted">{step.holesDone ?? 0} of {holes.length}</span>
			</div>
			<progress class="walk-track" value={step.holesDone ?? 0} max={holes.length} aria-label={`${step.holesDone ?? 0} of ${count(holes.length, 'hole')} done`} />
			<ol class="holes">
				{holes.map((h) => (
					<li>
						<button type="button" class={`hole-row${h.n === hole?.n ? ' on' : ''}`} aria-pressed={h.n === hole?.n} onClick={() => setSelected(h.n)}>
							<span class={`change-num h-${h.state}${h.by ? ` by-${h.by}` : ''}`}>{h.n}</span>
							<span class="grow">{h.question}</span>
							<span class={`hole-state h-${h.state}${h.by ? ` by-${h.by}` : ''}`}>{holeStatus(h)}</span>
						</button>
					</li>
				))}
			</ol>
			<p class="muted small">In the text editor, Tab goes to the next hole, and Shift+Tab to the hole before it.</p>
			{hole && <HoleDetail step={step.id} hole={hole} />}
		</div>
	);
}

// The decisions of the current step (decision 31): the open decisions are the choices of the writer, and the answers of
// the user go into the code
function StepDecisions({ step }: { step: CurrentStepView }) {
	const decisions = step.decisions ?? [];
	let text: string;
	if (step.writer === 'user') {
		text = 'You make the open decisions in your code.';
	} else if (step.writer === 'frame') {
		text = 'Each open decision is a hole of the frame.';
	} else {
		text = 'Claude decides the open decisions, and the receipt shows each choice.';
	}
	return (
		<>
			<div class="row-head"><span class="name">Decisions</span></div>
			<ul class="list decisions">
				{decisions.map((d) => (
					<li>
						<span class="grow">
							<span class="decision-question">{d.question}</span>
							{d.answer !== undefined ? <> <span class="badge user">You</span> {d.answer}</> : <span class="hint"> open</span>}
						</span>
					</li>
				))}
			</ul>
			<p class="muted small">{text} An answer is in words on the plan page, and the writer puts it into the code.</p>
		</>
	);
}

function CurrentStep({ step, request, maxNote }: { step: CurrentStepView; request?: string; maxNote: number }) {
	return (
		<section class={`current-step lv-${step.level ?? 0}`} aria-label={`Step ${step.n} of ${step.total}`}>
			<div class="row-head">
				<span class="name">Step {step.n} of {step.total}</span>
				<StateChip state={step.state} writer={step.writer} />
				<span class={`level-name small lv-${step.level ?? 0}`}>{step.levelName}</span>
			</div>
			<p class="title">{step.title}</p>
			<p class="muted">{step.writerText}</p>
			<p class="places">
				{step.places.map((p) => (p.isNew ? <span class="mono small">{p.name}</span> : (
					<PlaceLink place={p} note={`Step ${step.n} of ${step.total} · ${step.title}`} />
				)))}
			</p>
			{(step.writer === 'user' || step.state === 'todo') && (
				<>
					<p>{step.text}</p>
					<ul class="checks">{step.checks.map((c) => <li><span aria-hidden="true">☐</span> {c}</li>)}</ul>
				</>
			)}
			{step.decisions && step.decisions.length > 0 && (step.writer === 'user' || step.state === 'todo') && <StepDecisions step={step} />}
			{step.writer !== 'user' && step.state === 'todo' && request && (
				<>
					<p class="muted">In Claude Code:</p>
					<TellClaude text={request} />
				</>
			)}
			{step.writer !== 'user' && step.state === 'open' && (
				<p class="banner">
					Claude writes the {step.writer === 'frame' ? 'frame' : 'step'}{step.round > 1 ? ` again, round ${step.round}` : ''}. The guard opens only the scope:{' '}
					<span class="mono">{step.scope.join(', ')}</span>. Do not change these files now.
				</p>
			)}
			{step.canRequestFrame && (
				<div class="frame-request">
					<button type="button" class="btn secondary small" onClick={() => post({ type: 'requestFrame', step: step.id })}>I want a frame</button>
					<p class="muted small">
						Claude writes the lines with no decision, and each decision is a hole for you. Your click records the decision. Then tell Claude:
						"Give me a frame for step {step.n}."
					</p>
				</div>
			)}
			{step.holes && step.state === 'holes' && <Frame step={step} />}
			{step.writer === 'user' && step.state === 'open' && (
				<p class="muted small">
					You write this step. Claude changes no file now, but it can answer your questions in the chat.
					{step.baseError ? ` Shotgun has no base for the step: ${step.baseError}` : ' Shotgun records your lines at "The step is done".'}
				</p>
			)}
			{step.receipt && <Receipt step={step} receipt={step.receipt} maxNote={maxNote} />}
		</section>
	);
}

const KIND_TEXT = { problem: 'Problem', warning: 'Warning', info: 'Info' } as const;
const STATUS_TEXT = { open: 'open', held: 'held back by the voice', waiting: 'at the next pause', closed: 'closed by you', gone: 'gone' } as const;
const VOICE_NAMES = [['quiet', 'Quiet'], ['normal', 'Normal'], ['talkative', 'Talkative']] as const;

// A callout: the facts of the engine, the words of Claude, and the buttons of the user
function CalloutDetail({ step, callout }: { step: string; callout: CalloutView }) {
	return (
		<div class={`callout-detail k-${callout.kind}`}>
			<p class="change-place">
				<span class={`kind-chip k-${callout.kind}`}>{KIND_TEXT[callout.kind]}</span>
				<PlaceLink place={{ name: callout.place, path: callout.path, line: callout.line }} editor />
			</p>
			<div class="order-note">
				<span class="badge engine">Engine</span>
				<span>{callout.proof.map((p) => <span class="block">{p}</span>)}</span>
			</div>
			{callout.explanation
				? <div class="order-note claude"><span class="badge claude">Model</span><span>{callout.explanation}</span></div>
				: <p class="muted small">No words of Claude yet. Claude explains a callout only when you ask.</p>}
			{callout.closedReason && <p class="muted small">You closed this callout: not a problem. Your reason: "{callout.closedReason}". The ledger keeps it.</p>}
			<div class="buttons">
				{callout.status === 'closed'
					? <button type="button" class="btn secondary small" onClick={() => post({ type: 'reopenCallout', step, id: callout.id })}>Open again</button>
					: <button type="button" class="btn secondary small" onClick={() => post({ type: 'closeCallout', step, id: callout.id })}>Not a problem</button>}
				<button type="button" class="btn secondary small" title="Shows the line in the side view of DataFlow, with its lens"
					onClick={() => post({ type: 'showInDataFlow', path: callout.path, line: callout.line, source: callout.source })}>
					Show in DataFlow
				</button>
			</div>
		</div>
	);
}

// A question of the user about a line, with the facts of DataFlow at the line and the answer of Claude
function AnswerRow({ answer }: { answer: LineAnswerView }) {
	return (
		<li class={`answer-row${answer.resolved ? ' resolved' : ''}`}>
			<div class="order-note user">
				<span class="badge user">You</span>
				<span>{answer.question} <PlaceLink place={{ name: answer.place, path: answer.path, line: answer.line }} note={answer.question} /></span>
			</div>
			{answer.facts.length > 0 && (
				<div class="order-note"><span class="badge engine">Engine</span><span>{answer.facts.map((f) => <span class="block">{f}</span>)}</span></div>
			)}
			<div class="order-note claude"><span class="badge claude">Model</span><span>{answer.answer}</span></div>
			{answer.resolved ? <p class="muted small">You resolved this question.</p> : (
				<div class="buttons">
					<button type="button" class="btn secondary small" onClick={() => post({ type: 'resolveAnswer', id: answer.id })}>Resolve</button>
				</div>
			)}
		</li>
	);
}

// The navigator of stage 5: the voice of the callouts, the callouts on the lines of the user, and the questions on lines
function Navigator({ nav }: { nav: NavigatorView }) {
	const [selected, setSelected] = useState<string | undefined>(undefined);
	const callout = nav.callouts.find((c) => c.id === selected);
	const firstOpen = nav.callouts.find((c) => c.status === 'open');
	return (
		<section class="navigator">
			{nav.step && (
				<>
					<div class="row-head"><span class="name">Voice of the navigator</span></div>
					<div class="marks" role="group" aria-label="The voice of the callouts">
						{VOICE_NAMES.map(([v, label]) => (
							<button type="button" class={`mark-btn voice${nav.voice === v ? ' on' : ''}`} aria-pressed={nav.voice === v}
								onClick={() => post({ type: 'setVoice', voice: v })}>
								{label}
							</button>
						))}
					</div>
					<p class="muted small">{nav.voiceText}</p>
					<div class="row-head">
						<span class="name">Callouts on your lines</span>
						<span class="badge engine">Engine</span>
						<span class="muted">{nav.open} open</span>
					</div>
					{nav.callouts.length === 0 ? (
						<p class="muted small">
							No callout. A callout comes at a pause of {nav.pauseSeconds} seconds with no edit, from a new fact of DataFlow on your lines.
						</p>
					) : (
						<ol class="callouts">
							{nav.callouts.map((c) => (
								<li>
									<button type="button" class={`callout-row k-${c.kind} s-${c.status}${c.id === selected ? ' on' : ''}`} aria-pressed={c.id === selected}
										onClick={() => setSelected(c.id === selected ? undefined : c.id)}>
										<span class={`kind-chip k-${c.kind}`}>{KIND_TEXT[c.kind]}</span>
										<span class="grow">{c.title}</span>
										<span class="hole-state">{STATUS_TEXT[c.status]}</span>
									</button>
								</li>
							))}
						</ol>
					)}
					{callout && <CalloutDetail step={nav.step!} callout={callout} />}
					{firstOpen && (
						<>
							<p class="muted">The callouts show facts of the engine. For the words of Claude, tell Claude:</p>
							<TellClaude text={`Explain the callout on line ${firstOpen.line}.`} />
						</>
					)}
					<p class="muted small">Limit: {nav.maxPerPause} callouts for each pause.</p>
				</>
			)}
			<div class="row-head"><span class="name">Questions on the line</span></div>
			{nav.answers.length === 0 ? (
				<p class="muted small">Ask Claude in Claude Code, for example "Does the lambda on line 95 copy charge?". Claude puts its answer at the line.</p>
			) : <ul class="answers">{nav.answers.map((a) => <AnswerRow answer={a} />)}</ul>}
		</section>
	);
}

// The panel in stage 5: the steps, the current step with its receipt, the navigator, and the gate
type PanelTab = 'steps' | 'loose' | 'ledger';

// The panel in stage 5: the tabs of the steps, of the loose ends and of the ledger (phase 9), and the gate. After the last
// step, the ledger comes first, because the commit message comes next
export function BuildSummary({ task }: { task: TaskView }) {
	const build = task.build;
	const isEnd = task.isDone || (!!build && !build.current);
	const [tab, setTab] = useState<PanelTab | undefined>(undefined);
	const shown: PanelTab = tab ?? (isEnd && task.ledger ? 'ledger' : 'steps');
	const tabs: [PanelTab, string][] = [
		['steps', 'Steps'],
		['loose', build && build.loose.open > 0 ? `Loose ends (${build.loose.open})` : 'Loose ends'],
		['ledger', 'Ledger'],
	];
	return (
		<div>
			<div class="head">
				<span class="name">{task.stageName}</span>
				<WriterBadges writer={task.writer} />
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			{!build ? <p>{task.text}</p> : (
				<>
					<div class="tabs" role="tablist" aria-label="The parts of the build">
						{tabs.map(([id, label]) => (
							<button type="button" role="tab" class={`tab${shown === id ? ' on' : ''}`} aria-selected={shown === id} onClick={() => setTab(id)}>
								{label}
							</button>
						))}
					</div>
					{shown === 'steps' && (
						<>
							<div class="row-head"><span class="name">Steps</span><span class="muted">{build.done} of {build.total} done</span></div>
							<StepList steps={build.steps} />
							{build.current ? <CurrentStep step={build.current} request={task.request} maxNote={build.maxNote} />
								: <p>Each step of the plan is done.</p>}
							<Navigator nav={build.navigator} />
						</>
					)}
					{shown === 'loose' && <LooseEnds loose={build.loose} />}
					{shown === 'ledger' && task.ledger && <LedgerPanel ledger={task.ledger} />}
				</>
			)}
			{task.gate && <GateBlock gate={task.gate} />}
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}
