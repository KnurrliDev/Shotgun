import { render } from 'preact';
import { CommandButton, Decisions, NoTask, Problems, SetupList, StageBar, TaskSummary, useModel } from './common';
import { OrderSummary } from './order';
import { applyStyles } from './styles';
import { SurveySummary } from './survey';

// The script of the panel beside the text editor: the stage bar, the active task, the buttons and the last decisions.
// The setup comes first while a part is not ready.

applyStyles();

function Panel() {
	const model = useModel();
	if (!model) {
		return <div class="panel"><p class="muted">Shotgun starts.</p></div>;
	}
	const { task } = model;
	const canOpen = model.tasks.some((t) => !t.isActive);
	return (
		<div class="panel">
			<div class="label">Shotgun</div>
			<StageBar stages={model.stages} />
			{!model.isReady && (
				<section class="section">
					<div class="name">Setup</div>
					<SetupList rows={model.setup} />
				</section>
			)}
			<section class="section">
				{!task ? <NoTask hasTasks={canOpen} />
					: task.isDone ? <TaskSummary task={task} />
						: task.stage === 'survey' ? <SurveySummary task={task} />
							: task.stage === 'order' ? <OrderSummary task={task} />
								: <TaskSummary task={task} />}
				<div class="buttons">
					{task && !task.isDone && (task.isPaused
						? <CommandButton label="Continue" command="continue" isPrimary />
						: <CommandButton label="Pause" command="pause" />)}
					<CommandButton label="New task" command="newTask" isPrimary={!task} />
					{canOpen && <CommandButton label="Open task" command="openTask" />}
					<CommandButton label="Show page" command="showPage" />
				</div>
			</section>
			{model.problems.length > 0 && <Problems problems={model.problems} />}
			{model.decisions.length > 0 && (
				<section class="section">
					<div class="name">Last decisions</div>
					<Decisions decisions={model.decisions.slice(0, 5)} />
				</section>
			)}
			{model.isReady && (
				<section class="section">
					<details>
						<summary class="name">Setup</summary>
						<SetupList rows={model.setup} />
					</details>
				</section>
			)}
		</div>
	);
}

render(<Panel />, document.getElementById('root')!);
