import { useEffect, useState } from 'preact/hooks';
import type { HookView, SurveyQuestionView, SurveyView, TaskView, ViewModel } from '../views/protocol';
import { CommandButton, GateBlock, StageBar, TellClaude, timeText, WriterBadges } from './common';
import { post } from './vscode';

// Stage 2: the survey of Claude. The page shows the full survey, and the panel shows a summary. The badge Model marks
// the words of Claude, and the badge Engine marks the facts of DataFlow (decision 13).

// An example of a change of the survey before the gate
const CHANGE_EXAMPLE = 'Split task T2 into 2 tasks.';

const bandClass = (band: string): string => band.replace(' ', '-');

function HeatChip({ hook }: { hook: HookView }) {
	const engine = hook.engine;
	if (!engine) {
		return <span class="heat none">not checked</span>;
	}
	if (engine.heat) {
		const heat = engine.heat;
		const title = `Heat ${heat.score} of 100 in ${heat.function}${heat.isReachComplete ? '' : '. The scan of the call graph is not complete, so the heat can change'}`;
		return <span class={`heat ${bandClass(heat.band)}`} title={title}>{heat.score} {heat.band}{heat.isReachComplete ? '' : ' *'}</span>;
	}
	if (engine.type) {
		return <span class="heat none">type: no score</span>;
	}
	return <span class="heat none">{engine.hasFacts ? 'no score' : 'no facts'}</span>;
}

function ModelBadge() {
	return <span class="badge claude" title="The words of Claude">Model</span>;
}

function EngineBadge() {
	return <span class="badge engine" title="The facts of DataFlow">Engine</span>;
}

// The place of the selected hook: its code, read only, and the facts of DataFlow
function HookPlace({ hook }: { hook: HookView }) {
	const lines = hook.lines[0] === hook.lines[1] ? `line ${hook.lines[0]}` : `lines ${hook.lines[0]} to ${hook.lines[1]}`;
	return (
		<section class="card">
			<div class="row-head"><span class="name">Place of the hook</span><ModelBadge /></div>
			<p class="title">{hook.id} · {hook.title}</p>
			<p class="muted">{hook.kind}</p>
			<p class="small">
				<span class="mono">{hook.place.replace(/:.*$/, '')}</span>, {lines}, read only
				{hook.isMoved && <span class="muted"> (the code moved after the survey)</span>}
			</p>
			{hook.isLost && <p class="notice">The code of the hook is not in the file now.</p>}
			<div class="buttons">
				<button type="button" class="btn secondary small" onClick={() => post({ type: 'openPlace', path: hook.path, line: hook.lines[0] })}>
					Open in the text editor
				</button>
			</div>
			{hook.excerpt && (
				<div class="code" role="region" aria-label={`The code of ${hook.id}`}>
					{hook.excerpt.lines.map((l) => (
						<div class={l.isHook ? 'code-line hook' : 'code-line'}>
							<span class="ln">{l.line}</span>
							<span class="tx">{l.text || ' '}</span>
						</div>
					))}
					{hook.excerpt.isCut && <div class="code-line"><span class="ln" /><span class="tx muted">…</span></div>}
				</div>
			)}
			<div class="row-head"><span class="name">Facts of the place</span><EngineBadge /></div>
			<p>{hook.engine?.text ?? 'Shotgun did not check the hook with DataFlow yet.'}</p>
			{hook.engine?.heat && (
				<p>
					<HeatChip hook={hook} /> <span class="muted">in {hook.engine.heat.function}</span>
					{hook.engine.heat.reachUnknown && <span class="muted"> · {hook.engine.heat.reachUnknown}</span>}
				</p>
			)}
		</section>
	);
}

// A question of the survey with the field for the answer of the user
function AnswerField({ question, isEditable }: { question: SurveyQuestionView; isEditable: boolean }) {
	const [text, setText] = useState(question.answer ?? '');
	useEffect(() => setText(question.answer ?? ''), [question.answer]);
	const isChanged = text.trim() !== (question.answer ?? '');
	return (
		<div class="answer">
			<p><span class={question.answer ? 'mark ok' : 'mark q'}>{question.answer ? '✓' : '?'}</span> <span class="id">{question.id}</span> {question.text}</p>
			{isEditable ? (
				<>
					<textarea rows={2} value={text} placeholder="Your answer" aria-label={`The answer to ${question.id}`}
						onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
					<button type="button" class="btn primary small" disabled={!isChanged}
						onClick={() => post({ type: 'saveAnswer', id: question.id, text })}>
						Save the answer
					</button>
				</>
			) : <p class="muted">{question.answer ?? 'No answer.'}</p>}
		</div>
	);
}

export function SurveyPage({ task, model }: { task: TaskView; model: ViewModel }) {
	const survey = task.survey!;
	const [selected, setSelected] = useState<string | undefined>(survey.hooks[0]?.id);
	const hook = survey.hooks.find((h) => h.id === selected) ?? survey.hooks[0];
	const answered = survey.questions.filter((q) => q.answer).length;
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Survey</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					You asked Claude: "Survey my brief." Claude read the code for your brief, and changed no file. It gives the tasks in no sequence,
					and the hooks: the places where new code goes into the code that is there.
				</p>
				<p class="muted small">
					<ModelBadge /> the words of Claude · <EngineBadge /> the facts of DataFlow
					{survey.engineTime ? `, checked ${timeText(survey.engineTime)}` : ''}
					{!survey.isReachComplete && ' · * heat before the end of the scan of the call graph'}
					{' · '}
					<button type="button" class="link" onClick={() => post({ type: 'checkHooks' })}>Check the hooks again</button>
				</p>
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						<div class="row-head"><span class="name">Tasks, in no sequence</span><ModelBadge /><span class="muted">{survey.tasks.length}</span></div>
						<ul class="list">
							{survey.tasks.map((t) => (
								<li>
									<span class="id">{t.id}</span>
									<span class="grow">
										{t.title}
										{t.text && <span class="muted small"> {t.text}</span>}
										{t.needs.length > 0 && <span class="muted small"> · needs {t.needs.join(', ')}</span>}
									</span>
									<span class="chips">
										{t.hooks.length === 0 ? <span class="muted small">new files, no hook</span> : t.hooks.map((h) => (
											<button type="button" class={h === hook?.id ? 'chip on' : 'chip'} onClick={() => setSelected(h)}>{h}</button>
										))}
									</span>
								</li>
							))}
						</ul>
					</section>
					<section class="card hooks">
						<div class="row-head"><span class="name">Hooks</span><ModelBadge /><span class="muted small">places</span><EngineBadge />
							<span class="muted small">check and heat</span><span class="muted">{survey.hooks.length}</span></div>
						{survey.hooks.length === 0 ? <p class="muted">No hooks.</p> : survey.hooks.map((h) => (
							<button type="button" class={h.id === hook?.id ? 'row on' : 'row'} onClick={() => setSelected(h.id)}>
								<span class="id">{h.id}</span>
								<span class="grow">
									{h.title}
									<span class="block muted small">{h.kind}{h.isLost ? ' · lost' : ''}</span>
									<span class="block mono small muted">{h.place}</span>
								</span>
								<HeatChip hook={h} />
							</button>
						))}
					</section>
					<section class="card">
						<div class="row-head"><span class="name">Facts</span><ModelBadge /><span class="muted">{survey.facts.length}</span></div>
						<p class="muted small">Claude wrote these facts. The tool and the place show where you can check them.</p>
						{survey.facts.length === 0 ? <p class="muted">No facts.</p> : (
							<ul class="list">
								{survey.facts.map((f) => (
									<li>
										<span class="grow">
											{f.text}
											<span class="block">
												<button type="button" class="link mono small" onClick={() => post({ type: 'openPlace', path: f.path, line: f.line })}>{f.place}</button>
												{' '}<span class="chip tool">{f.tool}</span>
											</span>
										</span>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>
				<div class="column">
					{hook && <HookPlace hook={hook} />}
					<section class="card">
						<div class="row-head"><span class="name">Questions for you</span><span class="muted">{answered} of {survey.questions.length}</span></div>
						<p class="muted small">The facts give no answer. The decision is yours.</p>
						{survey.questions.length === 0 ? <p class="muted">No questions.</p>
							: survey.questions.map((q) => <AnswerField question={q} isEditable={survey.isEditable} />)}
					</section>
					<section class="card">
						{survey.isEditable && (
							<>
								<div class="name">Change the survey</div>
								<p class="muted small">Before your gate, tell Claude what to change, for example:</p>
								<TellClaude text={CHANGE_EXAMPLE} />
							</>
						)}
						{task.gate ? <GateBlock gate={task.gate} /> : <p class="muted">You passed the gate of the survey.</p>}
					</section>
				</div>
			</div>
		</div>
	);
}

// The panel in stage 2: a summary of the survey, the questions and the gate
export function SurveySummary({ task }: { task: TaskView }) {
	const survey = task.survey;
	const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	return (
		<div>
			<div class="head">
				<span class="name">{task.stageName}</span>
				<WriterBadges writer={task.writer} />
			</div>
			<p class="title">{task.title}</p>
			{task.isPaused && <p class="banner">The guard is off for work outside of the task. Claude Code applies only its own permissions.</p>}
			{survey ? (
				<>
					<p>
						The survey of Claude: {count(survey.tasks.length, 'task')}, {count(survey.hooks.length, 'hook')} and {count(survey.facts.length, 'fact')}.
						Shotgun marks each hook in the text editor.
					</p>
					{!survey.isReachComplete && <p class="notice">The scan of the call graph is not complete. The heat of the hooks can change.</p>}
					<div class="buttons"><CommandButton label="Show the survey" command="showPage" isPrimary /></div>
					<div class="row-head">
						<span class="name">Questions for you</span>
						<span class="muted">{survey.questions.filter((q) => q.answer).length} of {survey.questions.length}</span>
					</div>
					{survey.questions.length === 0 ? <p class="muted">No questions.</p> : (
						<ul class="list">
							{survey.questions.map((q) => (
								<li class={q.answer ? 'ok' : 'todo'}>
									<span class={q.answer ? 'mark' : 'mark q'}>{q.answer ? '✓' : '?'}</span>
									<span class="grow">{q.text}</span>
								</li>
							))}
						</ul>
					)}
					<p class="muted small">The facts give no answer. The decision is yours. Answer on the survey page.</p>
					{survey.isEditable && (
						<>
							<div class="row-head"><span class="name">Change the survey</span></div>
							<p class="muted small">Before your gate, tell Claude what to change, for example:</p>
							<TellClaude text={CHANGE_EXAMPLE} />
						</>
					)}
				</>
			) : (
				<>
					<p>{task.text}</p>
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
