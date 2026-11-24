import { useEffect, useRef, useState } from 'preact/hooks';
import type { BuildView, PlanHeatView, PlanStepView, PlanView, StepDecisionView, TaskView, ToView, ViewModel } from '../views/protocol';
import { StateChip } from './build';
import { CommandButton, GateBlock, linesOf, PlaceLink, StageBar, TellClaude, timeText, WriterBadges, WriterChoice } from './common';
import { post } from './vscode';

// Stage 4: the plan of Claude with a risk level for each step (decisions 4, 8, 9 and 14). The badge Model marks the
// words of Claude, the badge Engine the heat of DataFlow, and the badge Rule the levels of the rules. Only the user
// changes a level. The page shows the steps, the selected step and its place. The panel shows a summary.

const CHANGE_EXAMPLE = 'Split step 2 into 2 steps.';
const LEVEL_NUMBERS = [1, 2, 3, 4, 5];

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const bandClass = (band: string) => `band-${band.replace(' ', '-')}`;

// 5 segments with the color of the level up to the level
export function RiskBar({ level }: { level: number | null }) {
	return (
		<span class={`risk-bar lv-${level ?? 0}`} role="img" aria-label={level ? `Risk level ${level} of 5` : 'No risk level yet'}>
			{LEVEL_NUMBERS.map((n) => <span class={n <= (level ?? 0) ? 'seg on' : 'seg'} />)}
		</span>
	);
}

// The writer of a step: Claude, a frame of Claude with holes for you, or you
export function WriterMark({ writer }: { writer?: string }) {
	const title = writer === 'user' ? 'You write' : writer === 'frame' ? 'Frame: Claude writes, and you write each decision' : writer ? 'Claude writes' : 'No writer yet';
	return (
		<span class="dots writer" title={title}>
			{(writer === 'claude' || writer === 'frame') && <span class="dot claude" />}
			{(writer === 'user' || writer === 'frame') && <span class="dot user" />}
		</span>
	);
}

function Flames({ heat }: { heat: PlanHeatView }) {
	const n = heat.flames ?? 0;
	return (
		<span class={`flames ${bandClass(heat.band)}`} role="img" aria-label={`${n} of 5 flames`}>
			{LEVEL_NUMBERS.map((i) => (
				<svg aria-hidden="true" class={i <= n ? 'on' : ''} width="9" height="12" viewBox="0 0 10 13">
					<path d="M5 .5C5.4 2.7 8.5 4.6 8.5 8.3 8.5 10.6 6.9 12.5 5 12.5S1.5 10.6 1.5 8.3C1.5 6.6 2.4 5.3 3.4 4.5 3.4 5.9 4 6.9 4.8 7.2 4.2 5 4.4 2.6 5 .5Z" />
				</svg>
			))}
		</span>
	);
}

// The heat of the place that gave the level, with the parts of the score and its strongest reasons
function HeatBlock({ heat }: { heat?: PlanHeatView }) {
	if (!heat) {
		return <p class="muted">No heat: the step has no line in a function. The rules use other facts.</p>;
	}
	return (
		<>
			<p class="heat-line">
				<Flames heat={heat} />
				<span class={`heat-title ${bandClass(heat.band)}`}>Heat {heat.score} of 100: {heat.band}</span>
				{!heat.isReachComplete && <span class="muted small"> · before the end of the scan of the call graph</span>}
			</p>
			<p class="mono small">{heat.function}</p>
			{heat.reach !== undefined && (
				<p class="muted small">
					Reach {heat.reach} of 60 · Risk {heat.risk} of 25 · History {heat.history} of 15{heat.isSiloed ? ' · siloed: the risk and the history count half' : ''}
				</p>
			)}
			{heat.reachUnknown && <p class="muted small">{heat.reachUnknown}</p>}
			{(heat.signals ?? []).length > 0 && (
				<ul class="signals">
					{(heat.signals ?? []).map((s) => <li><span class="pts">+{s.points}</span><span>{s.text}</span></li>)}
				</ul>
			)}
		</>
	);
}

// The note of the user for a step. The note goes to the extension when the field loses the focus, or with Enter
function NoteField({ step, maxNote }: { step: PlanStepView; maxNote: number }) {
	const [note, setNote] = useState(step.userNote);
	const sent = useRef(step.userNote);
	useEffect(() => {
		setNote(step.userNote);
		sent.current = step.userNote;
	}, [step.id, step.userNote]);
	const commit = () => {
		if (note.trim() !== sent.current.trim()) {
			sent.current = note;
			post({ type: 'setLevelNote', step: step.id, note });
		}
	};
	return (
		<label class="note-field">
			Your note for this step
			<input type="text" value={note} maxLength={maxNote} placeholder="For example the reason for a different level"
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

// A text field with Save and Cancel. Enter saves, and Escape cancels
function TextEntry({ value, maxLength, placeholder, label, onSave, onCancel }: {
	value: string; maxLength: number; placeholder: string; label: string; onSave: (text: string) => void; onCancel: () => void;
}) {
	const [text, setText] = useState(value);
	// the browser gives the focus to an autofocus field only 1 time in a document, so the field takes the focus itself
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);
	const save = () => {
		if (text.trim()) {
			onSave(text.trim());
		}
	};
	return (
		<div class="decision-entry">
			<input ref={input} type="text" value={text} maxLength={maxLength} placeholder={placeholder} aria-label={label}
				onInput={(e) => setText((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						save();
					} else if (e.key === 'Escape') {
						onCancel();
					}
				}} />
			<button type="button" class="pill" disabled={!text.trim()} onClick={save}>Save</button>
			<button type="button" class="pill" onClick={onCancel}>Cancel</button>
		</div>
	);
}

// The parts of a step and of the limits for the decisions, for a step of the plan or of the plan of the fixes
type DecisionStep = Pick<PlanStepView, 'id' | 'decisions' | 'isLevelEditable'>;
type DecisionLimits = Pick<PlanView, 'maxAnswer' | 'maxQuestion' | 'maxUserDecisions'>;

// 1 decision of a step: its question, the options of Claude and the answer of the user (P29)
function DecisionRow({ step, decision, isEditable, maxAnswer }: { step: DecisionStep; decision: StepDecisionView; isEditable: boolean; maxAnswer: number }) {
	const [isEditing, setEditing] = useState(false);
	useEffect(() => setEditing(false), [step.id, decision.id, decision.answer]);
	const answer = (text: string) => post({ type: 'answerDecision', step: step.id, decision: decision.id, text });
	const isAnswered = decision.answer !== undefined;
	return (
		<li class={`decision ${isAnswered ? 'answered' : 'open'}`}>
			<div class="decision-head">
				<span class={`badge ${decision.by === 'claude' ? 'claude' : 'user'}`}>{decision.by === 'claude' ? 'Model' : 'You'}</span>
				<span class="decision-question">{decision.question}</span>
				<span class="hint">{isAnswered ? 'answered' : 'open'}</span>
			</div>
			{decision.options.length > 0 && <p class="muted small">Options that Claude sees: {decision.options.join(' · ')}</p>}
			{isAnswered && !isEditing && <p class="decision-answer"><span class="badge user">You</span> {decision.answer}</p>}
			{isEditing && (
				<TextEntry value={decision.answer ?? ''} maxLength={maxAnswer} placeholder="Your answer in words" label={`Your answer to: ${decision.question}`}
					onSave={(text) => {
						answer(text);
						setEditing(false);
					}}
					onCancel={() => setEditing(false)} />
			)}
			{isEditable && !isEditing && (
				<div class="buttons">
					<button type="button" class="pill" onClick={() => setEditing(true)}>{isAnswered ? 'Change the answer' : 'Answer'}</button>
					{isAnswered && <button type="button" class="pill" onClick={() => answer('')}>Open again</button>}
					{decision.by === 'user' && <button type="button" class="pill" onClick={() => post({ type: 'removeDecision', step: step.id, decision: decision.id })}>Remove</button>}
				</div>
			)}
		</li>
	);
}

// The decisions of a step (decision 31). Each open decision is a choice of the user: a hole of the frame, or code of the
// user. A step with no open decision gets at most level 2, so the level gives Claude as the writer. A step of a plan of
// version 0.1.0 has no decisions (P34)
function DecisionsBlock({ step, view }: { step: DecisionStep; view: DecisionLimits }) {
	const [isAdding, setAdding] = useState(false);
	useEffect(() => setAdding(false), [step.id]);
	const decisions = step.decisions;
	if (!decisions) {
		return null;
	}
	const open = decisions.filter((d) => d.answer === undefined).length;
	const added = decisions.filter((d) => d.by === 'user').length;
	return (
		<>
			<div class="row-head">
				<span class="name">Open decisions</span>
				<span class="hint">{decisions.length === 0 ? 'none' : `${open} of ${decisions.length} open`}</span>
			</div>
			<p class="muted small">
				{decisions.length === 0 ? 'Claude found no open decision in this step. ' : 'An open decision is your choice: a hole of the frame, or code that you write. '}
				A step with no open decision gets at most level 2, so the level gives Claude as the writer. Answer a decision in words, and Claude writes its code.
			</p>
			{decisions.length > 0 && (
				<ul class="decisions">
					{decisions.map((d) => <DecisionRow step={step} decision={d} isEditable={step.isLevelEditable} maxAnswer={view.maxAnswer} />)}
				</ul>
			)}
			{step.isLevelEditable && added < view.maxUserDecisions && (isAdding ? (
				<TextEntry value="" maxLength={view.maxQuestion} placeholder="Your decision as a question, for example: What happens at the limit?"
					label="A new decision for this step"
					onSave={(question) => {
						post({ type: 'addDecision', step: step.id, question });
						setAdding(false);
					}}
					onCancel={() => setAdding(false)} />
			) : (
				<div class="buttons"><button type="button" class="pill" onClick={() => setAdding(true)}>Add a decision</button></div>
			))}
		</>
	);
}

// The state of a step in the build, in stage 5, and of a step of the fixes in stage 6
export function BuildState({ build, id }: { build?: BuildView; id: string }) {
	const s = build?.steps.find((b) => b.id === id);
	return s ? <StateChip state={s.state} writer={s.writer} /> : null;
}

// The selected step of the plan, or of the plan of the fixes in stage 6 (decision 43)
export function StepDetail({ step, view, build }: { step: PlanStepView; view: PlanView; build?: BuildView }) {
	const setLevel = (level: number | null) => post({ type: 'setLevel', step: step.id, level });
	let setBy = '';
	if (step.level !== null) {
		const rules = step.isCapped ? 'set by the rules: no open decision' : 'set by the rules';
		setBy = step.user === undefined ? rules : step.rule ? `set by you, the rules gave ${step.rule}` : 'set by you';
	}
	return (
		<section class="card">
			<div class="row-head">
				<span class="name">Step</span>
				<span class="step-num">{step.ref}</span>
				<span class="step-title">{step.title}</span>
				<BuildState build={build} id={step.id} />
			</div>
			{build && <p class="muted small">{build.steps.find((b) => b.id === step.id)?.writerText}{build.steps.find((b) => b.id === step.id)?.walked
				? `. Receipt: ${build.steps.find((b) => b.id === step.id)?.walked}.` : ''}</p>}
			<p class="muted small">{step.fixes ? `${step.taskText}.` : `For task ${step.task}: ${step.taskText}`}</p>
			<p class="places">
				{step.places.map((p) => (p.isNew ? <span class="mono small">{p.name}</span> : (
					<PlaceLink place={p} note={`Step ${step.ref} · ${step.title}`} />
				)))}
				{step.hooks.map((h) => <span class="chip tool">{h}</span>)}
			</p>
			<p>{step.text}</p>
			<ul class="checks">{step.checks.map((c) => <li><span aria-hidden="true">☐</span> {c}</li>)}</ul>
			{step.note && <div class="order-note claude"><span class="badge claude">Model</span><span>{step.note}</span></div>}
			<div class="row-head"><span class="name">Heat</span><span class="badge engine">Engine</span></div>
			<HeatBlock heat={step.heat} />
			<DecisionsBlock step={step} view={view} />
			<div class="row-head">
				<span class="name">Risk level</span>
				<span class={`level-name lv-${step.level ?? 0}`}>{step.levelName}</span>
				<span class="hint">{setBy}</span>
			</div>
			<div class="rule-box">
				<span class="badge rule">Rule</span>
				<span>
					{step.user !== undefined && 'You set this level. '}
					{step.writerText ?? 'The step gets a level at the end of the scan of the call graph. Until then, you can set a level.'}
				</span>
			</div>
			<ul class="reasons muted small">{step.reasons.map((r) => <li>{r}</li>)}</ul>
			{step.isLevelEditable && (
				<div class="buttons" role="group" aria-label="Change the risk level">
					{step.level === null ? LEVEL_NUMBERS.map((n) => <button type="button" class="pill" onClick={() => setLevel(n)}>Level {n}</button>) : (
						<>
							<button type="button" class="pill" disabled={step.level <= 1} onClick={() => setLevel(step.level! - 1)}>Lower</button>
							<button type="button" class="pill" disabled={step.level >= 5} onClick={() => setLevel(step.level! + 1)}>Raise</button>
							{step.user !== undefined && <button type="button" class="pill" onClick={() => setLevel(null)}>Rule value</button>}
						</>
					)}
				</div>
			)}
			{step.isLevelEditable && step.writer && (
				<>
					<div class="row-head"><span class="name">Writer</span><span class="hint">{step.isWriterChosen ? 'set by you' : 'the writer of the level'}</span></div>
					<WriterChoice step={step.id} writer={step.writer} first={step.firstWriter} />
				</>
			)}
			{step.isLevelEditable ? <NoteField step={step} maxNote={view.maxNote} />
				: step.userNote && <p><span class="badge user">You</span> {step.userNote}</p>}
		</section>
	);
}

// The place of the selected step: the code of its first place with lines
export function PlaceCard({ step }: { step: PlanStepView }) {
	const place = step.places.find((p) => p.excerpt) ?? step.places[0];
	return (
		<section class="card">
			<div class="row-head"><span class="name">Place of the step</span><span class="mono small">{place?.name}</span></div>
			{!place || place.isNew ? <p class="muted">A new file. The step makes it, so it has no code yet.</p> : (
				<>
					{place.isMoved && <p class="muted small">The code moved after the plan.</p>}
					{place.isLost && <p class="notice">The code of the place is not in the file now.</p>}
					<div class="buttons">
						<button type="button" class="btn primary small" disabled={place.isLost}
							onClick={() => post({ type: 'showPlace', path: place.path, lines: linesOf(place.name, place.line), note: `Step ${step.ref} · ${step.title}` })}>
							Show in DataFlow
						</button>
						<button type="button" class="btn secondary small" onClick={() => post({ type: 'openPlace', path: place.path, line: place.line })}>
							Open in the text editor
						</button>
					</div>
					{place.excerpt && (
						<div class="code" role="region" aria-label={`The code of step ${step.ref}`}>
							{place.excerpt.lines.map((l) => (
								<div class={l.isHook ? 'code-line hook' : 'code-line'}>
									<span class="ln">{l.line}</span>
									<span class="tx">{l.text || ' '}</span>
								</div>
							))}
							{place.excerpt.isCut && <div class="code-line"><span class="ln" /><span class="tx muted">…</span></div>}
						</div>
					)}
				</>
			)}
		</section>
	);
}

// The writers of the steps: a bar with the color of the level of each step, and the numbers
export function Writers({ view }: { view: PlanView }) {
	const w = view.writers;
	return (
		<>
			<div class="profile" role="img" aria-label={`The risk levels of the steps in sequence: ${view.steps.map((s) => s.level ?? 'none').join(', ')}`}>
				{view.steps.map((s) => <span class={`seg lv-${s.level ?? 0}`} />)}
			</div>
			<p class="writers">
				<span><WriterMark writer="user" /> You write <strong>{w.user}</strong></span>
				{w.frame > 0 && <span><WriterMark writer="frame" /> Frame <strong>{w.frame}</strong></span>}
				<span><WriterMark writer="claude" /> Claude writes <strong>{w.claude}</strong></span>
				{w.none > 0 && <span>No level <strong>{w.none}</strong></span>}
			</p>
		</>
	);
}

export function PlanPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const view = task.plan!;
	const [selected, setSelected] = useState<string | undefined>(view.steps[0]?.id);
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
	const step = view.steps.find((s) => s.id === selected) ?? view.steps[0];
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Plan</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					You asked Claude: "Make the plan." Claude wrote {count(view.steps.length, 'step')} in your sequence. A rule made each risk level from the
					facts of DataFlow. Only you can change a level.
				</p>
				<p class="muted small">
					<span class="badge claude">Model</span> steps · <span class="badge engine">Engine</span> heat of DataFlow · <span class="badge rule">Rule</span> risk levels
					{view.riskTime ? `, checked ${timeText(view.riskTime)}` : ''}
					{view.isEditable && <> · <button type="button" class="link" onClick={() => post({ type: 'checkLevels' })}>Check the levels again</button></>}
				</p>
				{view.waiting > 0 && <p class="notice">{count(view.waiting, 'step')} {view.waiting === 1 ? 'has' : 'have'} no level until the end of the scan of the call graph.</p>}
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<div class="row-head"><span class="name">Steps</span><span class="badge claude">Model</span><span class="muted">{view.steps.length}, in your sequence</span></div>
						<div class="steps">
							{view.steps.map((s) => (
								<button type="button" class={s.id === step?.id ? 'step-row on' : 'step-row'} aria-pressed={s.id === step?.id} onClick={() => setSelected(s.id)}>
									<span class="step-num">{s.n}</span>
									<span class="grow">{s.title}</span>
									<BuildState build={task.build} id={s.id} />
									<RiskBar level={s.level} />
									<WriterMark writer={s.writer} />
								</button>
							))}
						</div>
					</section>
					{step && <StepDetail step={step} view={view} build={task.build} />}
				</div>
				<div class="column">
					{step && <PlaceCard step={step} />}
					<section class="card">
						<div class="name">Writers of the {count(view.steps.length, 'step')}</div>
						<Writers view={view} />
					</section>
					<section class="card">
						<div class="row-head"><span class="name">Levels that you changed</span><span class="badge user">You</span><span class="muted">{view.changed.length || 'none'}</span></div>
						{view.changed.length === 0 ? <p>Each level is the level of the rules.</p> : (
							<ul class="list">
								{view.changed.map((c) => (
									<li>
										<button type="button" class="link part grow" onClick={() => setSelected(c.step)}>
											Step {c.n}: level {c.level}.{c.rule ? ` The rules gave ${c.rule}.` : ''}
											<span class="block muted small">{c.note ? `Your note: ${c.note}` : 'No note yet. Write your reason in the note of the step.'}</span>
										</button>
									</li>
								))}
							</ul>
						)}
						<p class="muted small">The ledger records each changed level and each note.</p>
					</section>
					<section class="card">
						{view.isEditable && (
							<>
								<div class="name">Change the plan</div>
								<p class="muted small">Before your gate, tell Claude what to change, for example:</p>
								<TellClaude text={CHANGE_EXAMPLE} />
							</>
						)}
						{task.build ? <p class="muted">You accepted the plan. The panel of Shotgun shows the current step of the build.</p>
							: task.gate ? <GateBlock gate={task.gate} /> : <p class="muted">You accepted the plan.</p>}
					</section>
				</div>
			</div>
		</div>
	);
}

// The panel in stage 4: a summary of the plan, the request for Claude and the gate
export function PlanSummary({ task }: { task: TaskView }) {
	const view = task.plan;
	return (
		<div>
			<div class="head">
				<span class="name">{task.stageName}</span>
				<WriterBadges writer={task.writer} />
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			{!view ? (
				<>
					<p>{task.text}</p>
					{task.request && (
						<>
							<p class="muted">In Claude Code:</p>
							<TellClaude text={task.request} />
						</>
					)}
				</>
			) : (
				<>
					<p>
						The plan of Claude: {count(view.steps.length, 'step')}. You write {view.writers.user}
						{view.writers.frame > 0 ? `, a frame has ${view.writers.frame},` : ''} and Claude writes {view.writers.claude}.
					</p>
					<Writers view={view} />
					{view.waiting > 0 && <p class="notice">{count(view.waiting, 'step')} wait for the end of the scan of the call graph.</p>}
					{view.changed.length > 0 && <p>You changed {count(view.changed.length, 'level')}.</p>}
					<div class="buttons"><CommandButton label="Show the plan" command="showPage" isPrimary /></div>
				</>
			)}
			{task.gate && <GateBlock gate={task.gate} />}
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}
