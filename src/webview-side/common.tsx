import { useEffect, useState } from 'preact/hooks';
import type {
	BriefView, DecisionView, GateView, SetupRow, StageView, TaskItem, TaskView, ToView, ViewCommand, ViewModel, WriterName,
} from '../views/protocol';
import { post } from './vscode';

// The parts that the page and the panel share

// The view model from the extension. The script sends ready, and then the extension sends the model after each change
export function useModel(): ViewModel | undefined {
	const [model, setModel] = useState<ViewModel>();
	useEffect(() => {
		const listener = (event: MessageEvent<ToView>) => {
			if (event.data?.type === 'model') {
				setModel(event.data.model);
			}
		};
		window.addEventListener('message', listener);
		post({ type: 'ready' });
		return () => window.removeEventListener('message', listener);
	}, []);
	return model;
}

const WRITER_NAMES: Record<'user' | 'claude', string> = { user: 'You', claude: 'Claude' };
const writersOf = (writer: WriterName): ('user' | 'claude')[] => (writer === 'both' ? ['claude', 'user'] : [writer]);

// The time of a decision, for example 14.11.26, 10:42 in the format of the language of VS Code
export const timeText = (iso: string): string => {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

export function WriterDots({ writer }: { writer: WriterName }) {
	return <span class="dots" aria-hidden="true">{writersOf(writer).map((w) => <span class={`dot ${w}`} />)}</span>;
}

export function WriterBadges({ writer }: { writer: WriterName }) {
	return <>{writersOf(writer).map((w) => <span class={`badge ${w}`}>{WRITER_NAMES[w]}</span>)}</>;
}

export function StageBar({ stages, isLarge }: { stages: StageView[]; isLarge?: boolean }) {
	return (
		<ol class={isLarge ? 'stages large' : 'stages'} aria-label="Stages">
			{stages.map((s) => (
				<li class={`stage ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}
					title={`Stage ${s.number}: ${s.name}. Writer: ${writersOf(s.writer).map((w) => WRITER_NAMES[w]).join(' and ')}.`}>
					<WriterDots writer={s.writer} />
					<span>{s.number} {s.name}</span>
					{s.state === 'done' && <span class="check" aria-label="done">✓</span>}
				</li>
			))}
		</ol>
	);
}

function ChatIcon() {
	return (
		<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
			stroke-linejoin="round">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

// A request that the user types in Claude Code. A click puts the words into the clipboard. It does not start Claude
export function TellClaude({ text }: { text: string }) {
	return (
		<button type="button" class="tell" title="Copy the request. Then paste it in Claude Code." onClick={() => post({ type: 'copy', text })}>
			<span class="who"><ChatIcon />Tell Claude</span>
			<span class="words">{text}</span>
		</button>
	);
}

export function CommandButton({ label, command, isPrimary, isSmall }: { label: string; command: ViewCommand; isPrimary?: boolean; isSmall?: boolean }) {
	return (
		<button type="button" class={`btn ${isPrimary ? 'primary' : 'secondary'}${isSmall ? ' small' : ''}`} onClick={() => post({ type: 'command', command })}>
			{label}
		</button>
	);
}

export function SetupList({ rows }: { rows: SetupRow[] }) {
	return (
		<ul class="list">
			{rows.map((r) => (
				<li class={r.isOk ? 'ok' : 'todo'}>
					<span class="mark" aria-label={r.isOk ? 'OK' : 'To do'}>{r.isOk ? '✓' : '!'}</span>
					<span class="grow">{r.text}</span>
					{r.action && <CommandButton label={r.action.label} command={r.action.command} isPrimary isSmall />}
				</li>
			))}
		</ul>
	);
}

// The stage of the active task: its writers, the work of the stage, the next work, the gate and the rule of the guard.
// Stage 1 shows the parts of the brief and the questions of Claude
export function TaskSummary({ task, hasTitle = true }: { task: TaskView; hasTitle?: boolean }) {
	return (
		<div>
			<div class="head">
				<span class="name">{task.isDone ? 'Done' : task.stageName}</span>
				{!task.isDone && <WriterBadges writer={task.writer} />}
			</div>
			{hasTitle && <p class="title">{task.title}</p>}
			{!task.isDone && <p>{task.text}</p>}
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			{task.brief ? <BriefStage brief={task.brief} request={task.request} /> : (
				<>
					<p><span class="muted">Next: </span>{task.next}</p>
					{task.request && (
						<>
							<p class="muted">In Claude Code:</p>
							<TellClaude text={task.request} />
						</>
					)}
				</>
			)}
			{task.gate && <GateBlock gate={task.gate} />}
			<p class="rule"><span class="muted">Guard: </span>{task.guard}</p>
		</div>
	);
}

// Stage 1: the parts of the brief and the open questions of Claude. A click on a part or on the line of a question
// opens brief.md at that line
function BriefStage({ brief, request }: { brief: BriefView; request?: string }) {
	return (
		<>
			<div class="row-head">
				<span class="name">Parts of the brief</span>
				<span class="muted">{brief.complete} of {brief.parts.length}</span>
			</div>
			<ul class="list">
				{brief.parts.map((p) => (
					<li class={p.hasText ? 'ok' : 'todo'}>
						<span class="mark" aria-label={p.hasText ? 'Has text' : 'No text'}>{p.hasText ? '✓' : '!'}</span>
						<button type="button" class="link part grow" title={`Open brief.md at the part ${p.name}`}
							onClick={() => post({ type: 'openBrief', ...(p.line ? { line: p.line } : {}) })}>
							{p.name}
						</button>
						<span class="muted">{p.summary}</span>
					</li>
				))}
			</ul>
			{brief.isDirty && <p class="muted small">brief.md has changes that are not saved.</p>}
			<div class="buttons">
				<button type="button" class="btn secondary small" onClick={() => post({ type: 'openBrief' })}>Open brief</button>
			</div>
			<div class="row-head">
				<span class="name">Questions of Claude</span>
				<span class="badge claude" title="The words of a language model">Model</span>
			</div>
			{request && <TellClaude text={request} />}
			{brief.questions.length === 0 ? (
				<p class="muted">No open questions.{brief.closed > 0 ? ` You closed ${brief.closed}.` : ''}</p>
			) : (
				<ul class="list">
					{brief.questions.map((q) => (
						<li>
							<span class="mark q" aria-hidden="true">?</span>
							<span class="grow">
								{q.text}
								{q.line && (
									<>
										{' '}
										<button type="button" class="link" title="Open brief.md at this line" onClick={() => post({ type: 'openBrief', line: q.line })}>
											line {q.line}
										</button>
									</>
								)}
							</span>
							<button type="button" class="btn secondary small" title="The brief answers the question now"
								onClick={() => post({ type: 'closeQuestion', id: q.id })}>
								Close
							</button>
						</li>
					))}
				</ul>
			)}
			<p class="muted small">Claude asks only. It writes nothing in your brief. Its tool puts the questions into this panel.</p>
		</>
	);
}

// The gate of the stage: a decision of the user. The button records it, and it never starts Claude
function GateBlock({ gate }: { gate: GateView }) {
	return (
		<div class="gate">
			{gate.warning && <p class="notice">{gate.warning}</p>}
			<button type="button" class="btn primary" disabled={!gate.isEnabled} onClick={() => post({ type: 'gate' })}>{gate.label}</button>
			<p class="muted small">{gate.isEnabled ? gate.note : gate.reason}</p>
			{gate.after && (
				<>
					<p class="muted">Then, in Claude Code:</p>
					<TellClaude text={gate.after} />
				</>
			)}
			<p class="muted small">A button of Shotgun records your decision. It never starts Claude.</p>
		</div>
	);
}

// The panel or the page with no active task
export function NoTask({ hasTasks }: { hasTasks: boolean }) {
	return (
		<div>
			<p class="title">No active task</p>
			<p>Make a task for your next change. Shotgun takes it through the 5 stages, and you make the decisions.</p>
			{hasTasks && <p class="muted">Or select a task of this folder with Open task.</p>}
		</div>
	);
}

export function Decisions({ decisions }: { decisions: DecisionView[] }) {
	if (decisions.length === 0) {
		return <p class="muted">No decisions yet.</p>;
	}
	return (
		<ul class="list">
			{decisions.map((d) => (
				<li class={`by-${d.by}`}>
					<span class="time">{timeText(d.time)}</span>
					<span class="text grow">{d.text}</span>
				</li>
			))}
		</ul>
	);
}

export function TaskList({ tasks }: { tasks: TaskItem[] }) {
	if (tasks.length === 0) {
		return <p class="muted">This folder has no tasks.</p>;
	}
	return (
		<ul class="list">
			{tasks.map((t) => (
				<li>
					<span class={t.isActive ? 'grow active-task' : 'grow'}>{t.title}</span>
					<span class="muted">{t.isDone ? 'done' : `${t.stageNumber} ${t.stageName}`}</span>
					{!t.isActive && (
						<button type="button" class="btn secondary small" onClick={() => post({ type: 'selectTask', id: t.id })}>Open</button>
					)}
				</li>
			))}
		</ul>
	);
}

export function Problems({ problems }: { problems: string[] }) {
	return (
		<section class="section problems">
			<div class="name">Problems</div>
			<ul class="list">{problems.map((p) => <li><span class="mark">!</span><span class="grow">{p}</span></li>)}</ul>
		</section>
	);
}
