import { render } from 'preact';
import { CommandButton, Decisions, NoTask, Problems, SetupList, StageBar, TaskList, TaskSummary, useModel } from './common';
import { OrderPage } from './order';
import { applyStyles } from './styles';
import { SurveyPage } from './survey';

// The script of the page in the editor area. Phase 1 shows the active task, its decisions, the tasks of the folder and
// the setup. The later phases add the full pages of the survey, the order, the plan and the ledger.

applyStyles();
document.body.classList.add('page-body');

function Page() {
	const model = useModel();
	if (!model) {
		return <div class="page"><p class="muted">Shotgun starts.</p></div>;
	}
	const { task } = model;
	// stage 3 and later: the order of the user on the full page. Stage 2: the survey of Claude
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

render(<Page />, document.getElementById('root')!);
