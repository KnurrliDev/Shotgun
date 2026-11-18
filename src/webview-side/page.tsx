import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TaskView, ToView, ViewModel } from '../views/protocol';
import { CommandButton, Decisions, NoTask, Problems, SetupList, StageBar, TaskList, TaskSummary, useModel } from './common';
import { LedgerPage } from './ledger';
import { OrderPage } from './order';
import { PlanPage } from './plan';
import { ReviewLedger, ReviewPage } from './review';
import { applyStyles } from './styles';
import { SurveyPage } from './survey';
import { post } from './vscode';

// The script of the page in the editor area. Phase 1 shows the active task, its decisions, the tasks of the folder and
// the setup. The later phases add the full pages of the survey, the order, the plan and the ledger.

applyStyles();
document.body.classList.add('page-body');

// The page of the ledger (phase 9): the decisions, the lines of each writer, and the commit message
function LedgerScreen({ task, model }: { task: TaskView; model: ViewModel }) {
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version} · Ledger</div>
				<h1 class="page-title">{task.title}</h1>
				<StageBar stages={model.stages} isLarge />
				<p class="intro">
					The ledger shows your decisions, the lines that you and Claude wrote, and the lines of Claude that you did not walk. You write the commit
					message in Source Control, and Claude checks it when you ask.
				</p>
			</header>
			<LedgerPage title={task.title} ledger={task.ledger!} />
		</div>
	);
}

// The option of the STE output (decision 41). It is above each page, because the pages of the stages 2 to 6 have no setup
function SteOption({ isOn }: { isOn: boolean }) {
	return (
		<div class="page-options">
			<label class="option">
				<input type="checkbox" checked={isOn} onChange={(e) => post({ type: 'setSteOutput', isOn: e.currentTarget.checked })} />
				<span>Claude writes in Simplified Technical English (STE) while a task is active</span>
			</label>
		</div>
	);
}

function Page({ model }: { model: ViewModel | undefined }) {
	const [tab, setTab] = useState<'review' | 'plan' | 'ledger' | undefined>(undefined);
	// "Show the ledger" of the panel, and a click on a CodeLens line in the text editor
	useEffect(() => {
		const listener = (event: MessageEvent<ToView>) => {
			if (event.data?.type === 'showLedger') {
				setTab('ledger');
			} else if (event.data?.type === 'selectStep') {
				setTab('plan');
			}
		};
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	}, []);
	// a new stage or a different task starts with the default tab of its page, for example the review in stage 6. The first
	// model is no change: "Show the ledger" can come before it
	const shownStage = useRef<string | undefined>(undefined);
	const stageKey = model?.task ? `${model.task.id}:${model.task.stage}` : undefined;
	useEffect(() => {
		if (stageKey !== undefined && shownStage.current !== undefined && stageKey !== shownStage.current) {
			setTab(undefined);
		}
		if (stageKey !== undefined) {
			shownStage.current = stageKey;
		}
	}, [stageKey]);
	if (!model) {
		return <div class="page"><p class="muted">Shotgun starts.</p></div>;
	}
	const { task } = model;
	// stage 6: the review, the plan and the ledger. The review comes first
	if (task?.review) {
		const shown = tab ?? 'review';
		const tabs: ['review' | 'plan' | 'ledger', string][] = [['review', 'Review'], ...(task.plan ? [['plan', 'Plan'] as ['plan', string]] : []),
			...(task.ledger ? [['ledger', 'Ledger'] as ['ledger', string]] : [])];
		return (
			<>
				<div class="tabs page-tabs" role="tablist" aria-label="The pages of stage 6">
					{tabs.map(([id, label]) => (
						<button type="button" role="tab" class={`tab${shown === id ? ' on' : ''}`} aria-selected={shown === id} onClick={() => setTab(id)}>{label}</button>
					))}
				</div>
				{shown === 'ledger' && task.ledger ? <ReviewLedger task={task} model={model} />
					: shown === 'plan' && task.plan ? <PlanPage task={task} model={model} /> : <ReviewPage task={task} model={model} />}
			</>
		);
	}
	// stage 5: the plan and the ledger. After the last step, the ledger comes first
	if (task?.plan && task.ledger) {
		const shown = tab ?? (task.isDone || !task.build?.current ? 'ledger' : 'plan');
		return (
			<>
				<div class="tabs page-tabs" role="tablist" aria-label="The pages of stage 5">
					<button type="button" role="tab" class={`tab${shown === 'plan' ? ' on' : ''}`} aria-selected={shown === 'plan'} onClick={() => setTab('plan')}>Plan</button>
					<button type="button" role="tab" class={`tab${shown === 'ledger' ? ' on' : ''}`} aria-selected={shown === 'ledger'} onClick={() => setTab('ledger')}>
						Ledger
					</button>
				</div>
				{shown === 'ledger' ? <LedgerScreen task={task} model={model} /> : <PlanPage task={task} model={model} />}
			</>
		);
	}
	// stage 4 and later: the plan of Claude. Stage 3, and stage 4 with no plan: the order of the user. Stage 2: the survey
	if (task?.plan) {
		return <PlanPage task={task} model={model} />;
	}
	if (task?.order) {
		return <OrderPage task={task} model={model} />;
	}
	if (task?.survey) {
		return <SurveyPage task={task} model={model} />;
	}
	return (
		<div class="page">
			<header>
				<div class="label">Shotgun {model.version}</div>
				<h1 class="page-title">{task ? task.title : 'No active task'}</h1>
				<StageBar stages={model.stages} isLarge />
			</header>
			<div class="grid">
				<div class="column">
					<section class="card">
						{task ? <TaskSummary task={task} hasTitle={false} /> : <NoTask hasTasks={model.tasks.length > 0} />}
						<div class="buttons">
							{task && !task.isDone && (task.isPaused
								? <CommandButton label="Continue" command="continue" isPrimary />
								: <CommandButton label="Pause" command="pause" />)}
							<CommandButton label="New task" command="newTask" isPrimary={!task} />
						</div>
					</section>
					<section class="card">
						<h2 class="name">Decisions</h2>
						<Decisions decisions={model.decisions} />
					</section>
				</div>
				<div class="column">
					<section class="card">
						<h2 class="name">Setup</h2>
						<SetupList rows={model.setup} />
					</section>
					<section class="card">
						<h2 class="name">Tasks of this folder</h2>
						<TaskList tasks={model.tasks} />
					</section>
					{model.problems.length > 0 && <Problems problems={model.problems} />}
				</div>
			</div>
		</div>
	);
}

function Shell() {
	const model = useModel();
	return (
		<>
			{model && <SteOption isOn={model.isSteOutput} />}
			<Page model={model} />
		</>
	);
}

render(<Shell />, document.getElementById('root')!);
