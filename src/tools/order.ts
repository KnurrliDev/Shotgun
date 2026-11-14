import { changedTasks, checkTaskSurvey, factsOf, Order, orderWarnings } from '../session/order';
import { IS_CASE_SENSITIVE } from '../session/paths';
import { STAGE_INFO, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import type { Lines } from '../session/survey';
import { engineFacts, SurveyDeps } from './survey';

// The tools of stage 3. get_order gives the order of the user, and submit_task_survey gives the survey of Claude for 1
// task with a new text or for 1 new task. Claude changes no text and no place of a task: the order is the decision of
// the user (decision 3).

const placeText = (file: string, lines: Lines): string => (lines[0] === lines[1] ? `${file}:${lines[0]}` : `${file}:${lines[0]}-${lines[1]}`);

const NO_ORDER = 'The order starts in stage 3, after the gate "Order the tasks" of the user.';

// The result of get_order: the tasks in the order of the user, the tasks with no survey for their text, and the warnings
// of the order check
export function orderData(snapshot: Snapshot, order: Order): Record<string, unknown> {
	const { task, survey } = snapshot;
	if (!task) {
		throw new Error(`No task is active. ${NO_ORDER}`);
	}
	if (!survey || task.stage === 'brief' || task.stage === 'survey') {
		throw new Error(`The active task is in ${stageText(task.stage)}. ${NO_ORDER}`);
	}
	const plan = order.tasks.filter((t) => !t.isLater);
	const place = (id: string) => plan.findIndex((t) => t.id === id) + 1;
	const hooks = new Map(survey.hooks.map((h) => [h.id, h]));
	const changed = changedTasks(order, survey).map((t) => t.id);
	let next: string;
	if (task.isDone || task.stage !== 'order') {
		next = 'The user accepted this order. Make the steps of the plan in this sequence.';
	} else if (changed.length > 0) {
		next = `Survey each task in "changed" with submit_task_survey: ${changed.join(', ')}. Give its text exactly as here.`;
	} else {
		next = 'Each task of the plan has a survey. The user selects "Accept the order".';
	}
	return {
		task: { id: task.id, title: task.title, stage: STAGE_INFO[task.stage].number },
		tasks: order.tasks.map((t) => {
			const facts = factsOf(t, survey);
			return {
				place: t.isLater ? null : place(t.id),
				id: t.id,
				text: t.text,
				isNew: t.isNew,
				isLater: t.isLater,
				hasSurvey: facts.hasSurvey,
				...(!facts.hasSurvey && facts.oldText !== undefined ? { oldText: facts.oldText } : {}),
				hooks: facts.hooks.map((id) => {
					const h = hooks.get(id);
					return h ? `${id} ${placeText(h.file, h.lines)}` : id;
				}),
				needs: [...facts.needs],
				...(facts.size ? { size: facts.size } : {}),
				...(facts.note ? { note: facts.note } : {}),
			};
		}),
		changed,
		warnings: orderWarnings(order, survey).map((w) => w.text),
		next,
	};
}

export async function submitTaskSurvey(deps: SurveyDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { task, survey, root } = store.snapshot;
	if (!task || !root) {
		throw new Error(`No task is active. ${NO_ORDER}`);
	}
	if (task.isDone || task.stage !== 'order') {
		throw new Error(`The active task is in ${stageText(task.stage)}. The survey of a task of the order is only for stage 3. `
			+ (task.stage === 'brief' || task.stage === 'survey' ? NO_ORDER : 'The user accepted the order already.'));
	}
	if (!survey) {
		throw new Error('The active task has no survey of stage 2.');
	}
	const engine = deps.engine();
	const checked = checkTaskSurvey(args, store.order, survey, {
		root, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE, readLines: (file) => deps.readText(file)?.split(/\r?\n/), tools: [],
	});
	if (!checked.result) {
		throw new Error('Shotgun did not take the survey of the task. Correct these problems, and call the tool again:\n'
			+ checked.problems.map((p) => `- ${p}`).join('\n'));
	}
	const { result } = checked;
	store.writeTaskSurvey(result.task.id, result.survey, result.newHooks);
	// the new hooks get the facts of DataFlow, as the hooks of the survey
	if (result.newHooks.length > 0) {
		const facts = await engineFacts(engine, root, result.newHooks);
		const old = store.snapshot.engine;
		store.writeEngine({ isReachComplete: (old?.isReachComplete ?? true) && facts.isReachComplete, hooks: { ...(old?.hooks ?? {}), ...facts.hooks } });
	}
	const after = store.snapshot;
	const hooks = new Map((after.survey?.hooks ?? []).map((h) => [h.id, h]));
	const changed = changedTasks(store.order, after.survey).map((t) => t.id);
	return {
		task: result.task.id,
		hooks: result.survey.hooks.map((id) => {
			const h = hooks.get(id);
			const f = after.engine?.hooks[id];
			return {
				id,
				...(h ? { place: placeText(h.file, h.lines) } : {}),
				...(f ? { engine: f.text } : {}),
				...(f?.heat ? { heat: `${f.heat.score} ${f.heat.band}${f.heat.isReachComplete ? '' : ', before the end of the scan of the call graph'}` } : {}),
			};
		}),
		needs: result.survey.needs,
		warnings: orderWarnings(store.order, after.survey).map((w) => w.text),
		changed,
		next: changed.length > 0
			? `Survey the next task in "changed": ${changed.join(', ')}.`
			: 'Each task of the plan has a survey now. Tell the user that the order page of Shotgun shows the hooks and the needs. The user selects "Accept the order".',
	};
}
