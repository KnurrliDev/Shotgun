import { circleOf, itemChecks, Size, Survey, SurveyContext, SurveyHook } from './survey';

// Stage 3: the order of the tasks (decision 3). The user puts the tasks of the survey in sequence, changes the text of a
// task, adds a task, or keeps a task for later. A changed task and a new task have no survey until Claude surveys them
// with submit_task_survey. The needs from the surveys give warnings, and Shotgun never moves a task.
// These functions use no VS Code API, so the unit tests can call them directly.

export const MAX_ORDER_TASKS = 50;
export const MAX_TASK_TEXT = 200;
const MAX_NOTE = 500;
const MAX_NEW_HOOKS = 10;

// The survey of Claude for 1 task in stage 3, for the text of the task at that time
export interface TaskSurvey {
	readonly text: string;
	readonly hooks: readonly string[];
	readonly needs: readonly string[];
	readonly size?: Size;
	readonly note?: string; // a short note of Claude for the user
	readonly time: string;
}

export interface OrderTask {
	readonly id: string; // the id of the task of the survey, for example T1, or N1 for a new task of the user
	readonly text: string; // the text of the user. At first, the title of the task of the survey
	readonly isNew: boolean;
	readonly isLater: boolean; // the user keeps the task for later
	readonly survey?: TaskSurvey; // the last survey of Claude for the task in stage 3
}

export interface Order {
	readonly tasks: readonly OrderTask[];
	readonly nextId: number; // the number of the next new task: N1, N2 and so on. Shotgun uses no id 2 times
}

export interface OrderFile extends Order {
	readonly version: 1;
	readonly time: string;
}

// The order of the user: order.json, else the tasks of the survey in their sequence. An order before a new survey of
// Claude, for example after a return to stage 2 (decision 24), is for the tasks of the old survey: the order then starts
// again from the new survey. The ledger keeps the decisions of the old order
export function orderOf(file: (Order & { readonly time?: string }) | undefined, survey: (Survey & { readonly time?: string }) | undefined): Order {
	const isOld = !!file?.time && !!survey?.time && Date.parse(file.time) < Date.parse(survey.time);
	return file && !isOld ? file : { tasks: (survey?.tasks ?? []).map((t) => ({ id: t.id, text: t.title, isNew: false, isLater: false })), nextId: 1 };
}

//-------------------
// The facts of a task in the order

export interface TaskFacts {
	readonly isChanged: boolean; // a new task, or a text that is not the title of the task of the survey
	readonly hasSurvey: boolean; // a survey of Claude is there for the text now
	readonly isSurveyedAgain: boolean; // the survey is from stage 3
	readonly hooks: readonly string[]; // with no survey: the hooks of the old text
	readonly needs: readonly string[]; // the ids of the tasks that this task needs first. With no survey: of the old text
	readonly size?: Size;
	readonly note?: string;
	readonly oldText?: string; // with no survey: the text of the hooks and of the needs
}

export function factsOf(task: OrderTask, survey: Survey | undefined): TaskFacts {
	const base = task.isNew ? undefined : survey?.tasks.find((t) => t.id === task.id);
	const text = task.text.trim();
	const isChanged = !base || text !== base.title;
	if (task.survey && task.survey.text === text) {
		const s = task.survey;
		return {
			isChanged, hasSurvey: true, isSurveyedAgain: true, hooks: [...s.hooks], needs: [...s.needs],
			...(s.size ? { size: s.size } : {}), ...(s.note ? { note: s.note } : {}),
		};
	}
	if (base && !isChanged) {
		return { isChanged, hasSurvey: true, isSurveyedAgain: false, hooks: [...base.hooks], needs: [...base.needs], ...(base.size ? { size: base.size } : {}) };
	}
	// a changed task: the facts of the last survey are for a different text
	const old = task.survey ?? (base ? { text: base.title, hooks: base.hooks, needs: base.needs } : undefined);
	return {
		isChanged, hasSurvey: false, isSurveyedAgain: false, hooks: old ? [...old.hooks] : [], needs: old ? [...old.needs] : [],
		...(old ? { oldText: old.text } : {}),
	};
}

// The tasks in the plan with no survey for their text: Claude surveys them on request, or at the start of the plan.
// A task with no text needs a text of the user first
export function changedTasks(order: Order, survey: Survey | undefined): OrderTask[] {
	return order.tasks.filter((t) => !t.isLater && t.text.trim() !== '' && !factsOf(t, survey).hasSurvey);
}

//-------------------
// The order check

export interface OrderWarning {
	readonly task: string; // the id of the task
	readonly text: string;
}

// The warnings of the order: a task with no text, and a task that comes before a task that it needs. The needs are
// words of Claude, so Shotgun gives a warning and moves no task
export function orderWarnings(order: Order, survey: Survey | undefined): OrderWarning[] {
	const plan = order.tasks.filter((t) => !t.isLater);
	const place = (id: string) => plan.findIndex((t) => t.id === id) + 1;
	const warnings: OrderWarning[] = [];
	for (const task of plan) {
		const n = place(task.id);
		if (!task.text.trim()) {
			warnings.push({ task: task.id, text: `Task ${n} has no text.` });
		}
		for (const need of factsOf(task, survey).needs) {
			const other = order.tasks.find((t) => t.id === need);
			const m = place(need);
			if (!other) {
				warnings.push({ task: task.id, text: `Task ${n} needs the task ${need}, but the order has no task ${need}.` });
			} else if (m === 0) {
				warnings.push({ task: task.id, text: `Task ${n} needs "${other.text.trim()}". That task is for later.` });
			} else if (m > n) {
				warnings.push({ task: task.id, text: `Task ${n} needs task ${m}. Task ${m} comes later.` });
			}
		}
	}
	return warnings;
}

//-------------------
// The edits of the user

export type OrderEdit =
	| { readonly action: 'move'; readonly id: string; readonly step: -1 | 1 }
	| { readonly action: 'text'; readonly id: string; readonly text: string }
	| { readonly action: 'add'; readonly text: string }
	| { readonly action: 'later'; readonly id: string; readonly isLater: boolean }
	| { readonly action: 'remove'; readonly id: string };

// The ids that the survey uses, in lower case. A new task gets an id that is not in this set
export function surveyIds(survey: Survey | undefined): Set<string> {
	const ids = [...(survey?.tasks ?? []), ...(survey?.hooks ?? []), ...(survey?.questions ?? [])].map((x) => x.id.toLowerCase());
	return new Set(ids);
}

function checkText(value: string): string {
	const text = value.trim().replace(/\s+/g, ' ');
	if (text.length > MAX_TASK_TEXT) {
		throw new Error(`The text of a task has a maximum of ${MAX_TASK_TEXT} characters. Give a shorter text.`);
	}
	return text;
}

// The order after 1 edit of the user. task: the task of the edit, after the edit. position: its place in the order,
// from 1. used: the ids of the survey
export function applyEdit(order: Order, edit: OrderEdit, used: ReadonlySet<string>): { order: Order; task: OrderTask; position: number } {
	const { tasks } = order;
	if (edit.action === 'add') {
		const text = checkText(edit.text);
		if (!text) {
			throw new Error('Give the text of the new task.');
		}
		if (tasks.length >= MAX_ORDER_TASKS) {
			throw new Error(`The order has a maximum of ${MAX_ORDER_TASKS} tasks.`);
		}
		let n = order.nextId;
		while (used.has(`n${n}`) || tasks.some((t) => t.id.toLowerCase() === `n${n}`)) {
			n++;
		}
		const task: OrderTask = { id: `N${n}`, text, isNew: true, isLater: false };
		return { order: { tasks: [...tasks, task], nextId: n + 1 }, task, position: tasks.length + 1 };
	}
	const index = tasks.findIndex((t) => t.id === edit.id);
	if (index < 0) {
		throw new Error(`The order has no task ${edit.id}.`);
	}
	const task = tasks[index];
	const replace = (next: OrderTask) => tasks.map((t, i) => (i === index ? next : t));
	switch (edit.action) {
		case 'move': {
			const target = index + edit.step;
			if (target < 0 || target >= tasks.length) {
				throw new Error(`The task is at the ${edit.step < 0 ? 'start' : 'end'} of the order already.`);
			}
			const next = [...tasks];
			next[index] = tasks[target];
			next[target] = task;
			return { order: { ...order, tasks: next }, task, position: target + 1 };
		}
		case 'text': {
			// an empty text is possible while the user writes. The order check gives a warning, and the gate waits
			const changed = { ...task, text: checkText(edit.text) };
			return { order: { ...order, tasks: replace(changed) }, task: changed, position: index + 1 };
		}
		case 'later': {
			const changed = { ...task, isLater: edit.isLater };
			return { order: { ...order, tasks: replace(changed) }, task: changed, position: index + 1 };
		}
		case 'remove':
			if (!task.isNew) {
				throw new Error('Shotgun removes only a new task of yours. Keep a task of the survey for later.');
			}
			return { order: { ...order, tasks: tasks.filter((_, i) => i !== index) }, task, position: index + 1 };
	}
}

//-------------------
// The survey of a task in stage 3

export interface TaskSurveyResult {
	readonly task: OrderTask;
	readonly survey: Omit<TaskSurvey, 'time'>;
	readonly newHooks: readonly SurveyHook[]; // the new hooks go into survey.json
}

// Checks the survey of 1 task of Claude in stage 3. The result has all problems in 1 list (proposal P7)
export function checkTaskSurvey(raw: Record<string, unknown>, order: Order, survey: Survey, ctx: SurveyContext)
	: { result: TaskSurveyResult | undefined; problems: string[] } {
	const problems: string[] = [];
	const used = surveyIds(survey);
	order.tasks.forEach((t) => used.add(t.id.toLowerCase()));
	const { listOf, textField, idList, sizeOf, hookOf } = itemChecks(ctx, problems, used);

	const id = typeof raw.task === 'string' ? raw.task.trim() : '';
	const task = order.tasks.find((t) => t.id === id);
	if (!task) {
		problems.push(id ? `The order has no task ${id}. Call get_order, and give the id of a task.` : 'Give the id of the task in "task".');
	}
	const text = task?.text.trim() ?? '';
	if (task && !text) {
		problems.push(`Task ${id} has no text. The user must write its text first.`);
	} else if (task && (typeof raw.text !== 'string' || raw.text.trim().replace(/\s+/g, ' ') !== text)) {
		problems.push(`"text" is not the text of task ${id} now. The text now is "${text}". Survey this text, and give it in "text".`);
	}

	const known = new Set(survey.hooks.map((h) => h.id));
	const hooks = idList(raw.hooks, 'The task', 'hooks');
	hooks.filter((h) => !known.has(h)).forEach((h) => problems.push(`${h} is not a hook of the survey. Give a new hook in "newHooks".`));
	const newHooks: SurveyHook[] = [];
	listOf(raw, 'newHooks', MAX_NEW_HOOKS, 'new hooks').forEach((h, i) => {
		const hook = hookOf(h, `New hook ${i + 1}`);
		if (hook) {
			newHooks.push(hook);
		}
	});

	const needs = idList(raw.needs, 'The task', 'needs');
	needs.filter((n) => n === id).forEach(() => problems.push('A task cannot need itself.'));
	needs.filter((n) => n !== id && !order.tasks.some((t) => t.id === n))
		.forEach((n) => problems.push(`The task ${n} in "needs" is not in the order.`));
	const size = sizeOf(raw.size, 'The task');
	const note = textField(raw, 'note', 'The task', MAX_NOTE, true);

	// the needs of the other tasks and the new needs must not make a circle
	if (task) {
		const all = order.tasks.map((t) => ({ id: t.id, needs: t.id === id ? needs : factsOf(t, survey).needs }));
		const circle = circleOf(all);
		if (circle) {
			problems.push(`The needs make a circle: ${circle.join(', ')}. A task cannot need itself through other tasks.`);
		}
	}
	if (problems.length > 0 || !task) {
		return { result: undefined, problems };
	}
	const unique = [...new Set([...hooks, ...newHooks.map((h) => h.id)])];
	return {
		result: { task, survey: { text, hooks: unique, needs: [...new Set(needs)], ...(size ? { size } : {}), ...(note ? { note } : {}) }, newHooks },
		problems,
	};
}

//-------------------
// The file

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

function isTaskSurvey(value: unknown): boolean {
	return isObject(value) && typeof value.text === 'string' && isIdList(value.hooks) && isIdList(value.needs) && typeof value.time === 'string'
		&& (value.size === undefined || typeof value.size === 'string') && (value.note === undefined || typeof value.note === 'string');
}

// id: the name of the folder of the task
export function parseOrder(text: string, id: string): OrderFile {
	const value: unknown = JSON.parse(text);
	const name = `${id}/order.json`;
	if (!isObject(value)) {
		throw new Error(`${name} is not a JSON object.`);
	}
	if (typeof value.version === 'number' && value.version > 1) {
		throw new Error(`${name} has the version ${value.version}. This version of Shotgun reads only version 1. Install a newer version of Shotgun.`);
	}
	if (value.version !== 1 || typeof value.time !== 'string' || !Array.isArray(value.tasks) || !Number.isInteger(value.nextId)) {
		throw new Error(`${name} needs the fields version, time, tasks and nextId.`);
	}
	const isTask = (t: unknown) => isObject(t) && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.isNew === 'boolean'
		&& typeof t.isLater === 'boolean' && (t.survey === undefined || isTaskSurvey(t.survey));
	if (!value.tasks.every(isTask)) {
		throw new Error(`${name} has a task with no correct fields.`);
	}
	return value as unknown as OrderFile;
}
