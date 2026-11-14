import type { CallGraphFacts, HeatFacts, HiddenFacts, LogicFacts, PlaceFacts, ThreadFacts } from '../dataflow/dataflow-api';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile } from '../session/paths';
import { stageText } from '../session/stages';
import type { SessionStore } from '../session/store';
import { checkSurvey, EngineFile, HookEngine, hookEngineOf, Lines, SurveyHook } from '../session/survey';
import { stageStart } from './calls';

// The submit tool of stage 2: submit_survey gives the survey of Claude. The tool checks all data and gives all problems
// in 1 list (proposal P7). Then Shotgun gets the facts of DataFlow for each hook (decision 13: the badge Engine).

// The facts of DataFlow that the survey needs. The extension makes it from the API of DataFlow, and a test can fake it
export interface EngineApi {
	readonly tools: () => readonly string[]; // the read tools of the MCP server of DataFlow
	readonly place: (file: string, line: number) => Promise<PlaceFacts>;
	readonly heat: (file: string, lines: Lines) => Promise<HeatFacts>;
	// for the risk levels of the plan: the heat of 1 function, and the state of the call graph with its frame functions.
	// scan starts the scan of the call graph
	readonly functionHeat?: (file: string, name: string) => Promise<HeatFacts>;
	readonly callGraph?: () => Promise<CallGraphFacts>;
	readonly scan?: () => void;
	// for the callouts of the build: the races of the threads of a file, and the logic and the hidden C++ of the function
	// at a line
	readonly threads?: (file: string) => Promise<ThreadFacts>;
	readonly logic?: (file: string, line: number) => Promise<LogicFacts>;
	readonly hidden?: (file: string, line: number) => Promise<HiddenFacts>;
}

export interface SurveyDeps {
	readonly store: SessionStore;
	readonly folders: () => readonly string[];
	readonly readText: (file: string) => string | undefined; // the text of a file, from an open text editor first
	readonly engine: () => EngineApi | undefined; // undefined: no link to DataFlow
	// the tools of DataFlow that the MCP clients called since a time. undefined: DataFlow does not tell the calls
	readonly calls?: (since: number) => ReadonlySet<string> | undefined;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The facts of DataFlow for 1 hook. A failure of DataFlow is a fact too: the hook then has no facts
export async function hookEngine(engine: EngineApi | undefined, root: string, hook: SurveyHook): Promise<HookEngine> {
	if (!engine) {
		return { text: 'Shotgun has no link to DataFlow, so the hook has no facts of the engine.', hasFacts: false };
	}
	const file = absolutePath(hook.file, root);
	if (!isCppFile(file)) {
		return { text: 'DataFlow has facts only for C and C++ code.', hasFacts: false };
	}
	// the place of the hook is the line of its code: Claude selected that line. The heat is for all lines of the hook
	const [place, heat] = await Promise.all([
		engine.place(file, hook.codeLine ?? hook.lines[0]).catch((error: unknown) => messageOf(error)),
		engine.heat(file, hook.lines).catch((error: unknown) => messageOf(error)),
	]);
	if (typeof place === 'string' && typeof heat === 'string') {
		return { text: `DataFlow gave no facts: ${place}`, hasFacts: false };
	}
	return hookEngineOf(typeof place === 'string' ? undefined : place, typeof heat === 'string' ? undefined : heat);
}

// The facts of DataFlow for all hooks of a survey
export async function engineFacts(engine: EngineApi | undefined, root: string, hooks: readonly SurveyHook[]): Promise<Omit<EngineFile, 'version' | 'time'>> {
	const entries = await Promise.all(hooks.map(async (h) => [h.id, await hookEngine(engine, root, h)] as const));
	const facts = Object.fromEntries(entries);
	// the heat is complete when each hook in a function has the reach of the call graph
	const isReachComplete = Object.values(facts).every((f) => !f.heat || f.heat.isReachComplete);
	return { isReachComplete, hooks: facts };
}

const placeText = (file: string, lines: Lines): string => (lines[0] === lines[1] ? `${file}:${lines[0]}` : `${file}:${lines[0]}-${lines[1]}`);

export async function submitSurvey(deps: SurveyDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const store = deps.store;
	const task = store.snapshot.task;
	const root = store.snapshot.root;
	const problems: string[] = [];
	if (!task || !root) {
		problems.push('No task is active. A survey needs the active task in stage 2.');
	} else if (task.isDone || task.stage !== 'survey') {
		problems.push(`The active task is in ${stageText(task.stage)}. A survey is only for stage 2. `
			+ (task.stage === 'brief' ? 'The user selects "The brief is ready" first.' : 'The user passed the gate of the survey already.'));
	}
	const engine = deps.engine();
	const called = task ? deps.calls?.(stageStart(task)) : undefined;
	const checked = checkSurvey(args, {
		root: root ?? process.cwd(),
		folders: deps.folders(),
		isCaseSensitive: IS_CASE_SENSITIVE,
		readLines: (file) => deps.readText(file)?.split(/\r?\n/),
		tools: engine?.tools() ?? [],
		...(called ? { called } : {}),
	});
	problems.push(...checked.problems);
	if (problems.length > 0) {
		throw new Error(`Shotgun did not take the survey. Correct these problems, and call the tool again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
	}
	const survey = checked.survey;
	store.writeSurvey(survey);
	const facts = await engineFacts(engine, root!, survey.hooks);
	store.writeEngine(facts);
	const answers = store.snapshot.answers;
	return {
		tasks: survey.tasks.length,
		hooks: survey.hooks.map((h) => {
			const f = facts.hooks[h.id];
			return {
				id: h.id,
				place: placeText(h.file, h.lines),
				engine: f?.text,
				...(f?.heat ? { heat: `${f.heat.score} ${f.heat.band}${f.heat.isReachComplete ? '' : ', before the end of the scan of the call graph'}` } : {}),
			};
		}),
		facts: survey.facts.length,
		questions: survey.questions.map((q) => ({ id: q.id, isAnswered: !!answers[q.id] })),
		isReachComplete: facts.isReachComplete,
		next: 'The survey page of Shotgun shows the survey, and the text editor shows the hooks. Tell the user. The user answers the questions, '
			+ 'and then selects "Order the tasks". For a change of the survey, call submit_survey again with the full survey and the same ids.',
	};
}
