import type { HeatFacts } from '../dataflow/dataflow-api';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile } from '../session/paths';
import { checkPlan, levelOf, Plan, PlanPlace, placeName, RiskFile, StepRisk } from '../session/plan';
import { LEVEL_INFO, mainLoopAt, PlaceHeat, placeLevel, PlaceRisk, ScanState, stepLevel } from '../session/risk';
import { STAGE_INFO, stageText } from '../session/stages';
import type { Snapshot } from '../session/store';
import { findHook } from '../session/survey';
import type { EngineApi, SurveyDeps } from './survey';

// The tools of stage 4. submit_plan gives the steps of Claude, and Shotgun gives each step the level of the rules from
// the facts of DataFlow (decisions 8 and 14). get_plan gives the steps with their levels. Only the user changes a level.

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const NO_PLAN = 'The plan starts in stage 4, after the gate "Accept the order" of the user.';

// The hottest function of a heat result, with the parts of its score and its 4 strongest reasons
export function placeHeatOf(heat: HeatFacts): PlaceHeat | undefined {
	const f = [...heat.functions].sort((a, b) => b.score - a.score)[0];
	if (!f) {
		return undefined;
	}
	const signals = [...(f.signals ?? [])].filter((s) => s.points > 0 || s.id === 'reachUnknown').sort((a, b) => b.points - a.points).slice(0, 4)
		.map((s) => ({ points: s.points, text: s.text }));
	return {
		function: f.name, score: f.score, band: f.band, isReachComplete: f.isReachComplete,
		...(f.reachUnknown ? { reachUnknown: f.reachUnknown.text } : {}),
		flames: f.flames, reach: f.reach, risk: f.risk, history: f.history, ...(f.siloed ? { isSiloed: true } : {}), signals,
	};
}

// The facts of DataFlow for 1 place of a step
export async function placeRisk(engine: EngineApi | undefined, root: string, place: PlanPlace): Promise<PlaceRisk> {
	const range = place.lines;
	if (!range) {
		return { kind: 'new' };
	}
	const file = absolutePath(place.file, root);
	if (!isCppFile(file)) {
		return { kind: 'other' };
	}
	if (!engine) {
		return { kind: 'unknown', reason: 'Shotgun has no link to DataFlow, so the place has no facts. The level comes with the link.' };
	}
	let error = '';
	const fail = (e: unknown) => {
		error = messageOf(e);
		return undefined;
	};
	const [facts, heat] = await Promise.all([engine.place(file, place.codeLine ?? range[0]).catch(fail), engine.heat(file, range).catch(fail)]);
	if (!facts && !heat) {
		return { kind: 'unknown', reason: `DataFlow gave no facts for the place: ${error} The level comes when DataFlow gives them.` };
	}
	const hot = heat ? placeHeatOf(heat) : undefined;
	if (hot) {
		const mainLoop = mainLoopAt(facts?.function?.name, facts?.around ?? []);
		return {
			kind: 'function',
			heat: hot,
			workerThreads: (facts?.threads ?? []).map((t) => t.label),
			locks: [...(facts?.locks ?? [])],
			...(facts?.framePath ? { framePath: { reason: facts.framePath.reason, isPastLimit: facts.framePath.isPastLimit === true } } : {}),
			...(mainLoop ? { mainLoop } : {}),
		};
	}
	const type = heat?.types?.[0];
	if (type) {
		// the data members in the lines, and the hottest function that uses them
		const changed = type.members.filter((m) => m.line >= range[0] && m.line <= range[1]);
		const users = new Map<string, { name: string; file: string }>();
		changed.flatMap((m) => m.users ?? []).forEach((u) => users.set(`${u.file}#${u.function}`, { name: u.function, file: u.file }));
		let hottestUser: { function: string; score: number; band: PlaceHeat['band'] } | undefined;
		if (engine.functionHeat && users.size > 0) {
			const heats = await Promise.all([...users.values()].slice(0, 10)
				.map((u) => engine.functionHeat!(u.file, u.name).then((h) => h.functions[0]).catch(() => undefined)));
			const best = heats.filter((h) => !!h).sort((a, b) => b!.score - a!.score)[0];
			if (best) {
				hottestUser = { function: best.name, score: best.score, band: best.band };
			}
		}
		return {
			kind: 'type',
			type: {
				name: type.name, isHot: type.members.some((m) => !!m.framePath || !!m.shared), changed: changed.map((m) => m.name),
				...(hottestUser ? { hottestUser } : {}),
			},
		};
	}
	return { kind: 'none' };
}

// A place at its lines now: the code of the place can move after the plan
export function placeNow(place: PlanPlace, root: string, readLines: (file: string) => readonly string[] | undefined): PlanPlace {
	if (!place.lines || !place.code) {
		return place;
	}
	const text = readLines(absolutePath(place.file, root));
	const lines = text ? findHook(text, { lines: place.lines, code: place.code, codeLine: place.codeLine }) : undefined;
	if (!lines) {
		return place;
	}
	return { ...place, lines, ...(place.codeLine !== undefined ? { codeLine: lines[1] - (place.lines[1] - place.codeLine) } : {}) };
}

// The facts and the levels of the rules for all steps of a plan. With no scan of the call graph, Shotgun starts it, and
// the levels come at its end
export async function planRisk(engine: EngineApi | undefined, root: string, plan: Plan, readLines: (file: string) => readonly string[] | undefined)
	: Promise<Omit<RiskFile, 'version' | 'time'>> {
	let scan: ScanState = engine ? 'ready' : 'none';
	if (engine?.callGraph) {
		const graph = await engine.callGraph().catch(() => undefined);
		scan = graph?.state ?? 'none';
		if (scan === 'none') {
			engine.scan?.();
		}
	}
	const steps: Record<string, StepRisk> = {};
	for (const step of plan.steps) {
		const places = await Promise.all(step.places.map(async (p) => {
			const now = placeNow(p, root, readLines);
			const facts = await placeRisk(engine, root, now);
			const rule = placeLevel(facts, scan);
			// with 2 or more places, each reason names its place
			const reasons = step.places.length > 1 ? rule.reasons.map((r) => `${placeName(now)}: ${r}`) : [...rule.reasons];
			return { place: placeName(now), kind: facts.kind, level: rule.level, reasons, ...(facts.heat ? { heat: facts.heat } : {}) };
		}));
		const level = stepLevel(places);
		steps[step.id] = { level: level.level, reasons: [...level.reasons], places };
	}
	return { scan, steps };
}

// The steps of a plan with their levels, for the result of a tool
function stepsData(snapshot: Snapshot): Record<string, unknown>[] {
	const { plan, risk, levels } = snapshot;
	return (plan?.steps ?? []).map((s, i) => {
		const l = levelOf(s.id, risk, levels);
		const note = levels?.levels[s.id]?.note;
		return {
			n: i + 1,
			id: s.id,
			title: s.title,
			task: s.task,
			places: s.places.map(placeName),
			level: l.level,
			rule: l.rule,
			...(l.user ? { user: l.user } : {}),
			writer: l.level ? LEVEL_INFO[l.level].writer : null,
			reasons: risk?.steps[s.id]?.reasons ?? [],
			...(note ? { userNote: note } : {}),
		};
	});
}

const waitingOf = (snapshot: Snapshot): string[] => (snapshot.plan?.steps ?? [])
	.filter((s) => levelOf(s.id, snapshot.risk, snapshot.levels).level === null).map((s) => s.id);

// The result of get_plan: the steps of the plan with their texts, checks and levels
export function planData(snapshot: Snapshot): Record<string, unknown> {
	const { task, plan } = snapshot;
	if (!task) {
		throw new Error(`No task is active. ${NO_PLAN}`);
	}
	if (task.stage === 'brief' || task.stage === 'survey' || task.stage === 'order') {
		throw new Error(`The active task is in ${stageText(task.stage)}. ${NO_PLAN}`);
	}
	const steps = stepsData(snapshot).map((s, i) => ({ ...s, hooks: plan!.steps[i].hooks, text: plan!.steps[i].text, checks: plan!.steps[i].checks }));
	const waiting = waitingOf(snapshot);
	let next: string;
	if (!plan) {
		next = 'The task has no plan. Make the plan with submit_plan.';
	} else if (task.stage === 'plan') {
		next = waiting.length > 0 ? `The steps ${waiting.join(', ')} have no level until the end of the scan of the call graph.`
			: 'The user examines the levels, and selects "Accept the plan".';
	} else {
		next = 'The user accepted the plan. The level of each step selects its writer.';
	}
	return { task: { id: task.id, title: task.title, stage: STAGE_INFO[task.stage].number }, steps, waiting, next };
}

export async function submitPlan(deps: SurveyDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const { task, survey, root } = store.snapshot;
	if (!task || !root) {
		throw new Error(`No task is active. ${NO_PLAN}`);
	}
	if (task.isDone || task.stage !== 'plan') {
		throw new Error(`The active task is in ${stageText(task.stage)}. The plan is only for stage 4. `
			+ (task.stage === 'build' || task.isDone ? 'The user accepted the plan already.' : NO_PLAN));
	}
	if (!survey) {
		throw new Error('The active task has no survey of stage 2.');
	}
	const readLines = (file: string) => deps.readText(file)?.split(/\r?\n/);
	const checked = checkPlan(args, { root, folders: deps.folders(), isCaseSensitive: IS_CASE_SENSITIVE, readLines, tools: [] }, store.order, survey);
	if (checked.problems.length > 0) {
		throw new Error(`Shotgun did not take the plan. Correct these problems, and call the tool again:\n${checked.problems.map((p) => `- ${p}`).join('\n')}`);
	}
	const file = store.writePlan(checked.plan);
	const risk = await planRisk(deps.engine(), root, checked.plan, readLines);
	// a new plan can come while DataFlow works. The levels are only for the plan that is there now
	if (store.snapshot.plan?.time === file.time) {
		store.writeRisk(risk);
	}
	const waiting = waitingOf(store.snapshot);
	return {
		steps: stepsData(store.snapshot),
		scan: risk.scan,
		next: waiting.length > 0
			? `The steps ${waiting.join(', ')} have no level yet. The scan of the call graph is not complete, and Shotgun gives their levels at its end. Tell the user.`
			: 'The plan page of Shotgun shows the steps with their risk levels. Tell the user. The user can change each level, and then selects "Accept the plan".',
	};
}
