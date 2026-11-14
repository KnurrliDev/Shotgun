import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { HeatFacts, HeatTypeFacts, PlaceFacts } from '../../dataflow/dataflow-api';
import { LineStore } from '../../session/lines';
import type { BaseApi, StepChanges } from '../../tools/build';
import type { EngineApi } from '../../tools/survey';

// The fixture of the tests of the survey and of the order: a project with a C++ file with a loop and a text file, a fake
// of the API of DataFlow, and a correct survey of the project

export const SOLVER = [
	'#include "solver.h"',
	'',
	'int solve(Plan& plan)',
	'{',
	'    for (int i = 0; i < plan.steps; ++i) {',
	'        plan.step(i);',
	'    }',
	'    return plan.result();',
	'}',
].join('\n');
export const README = 'The solver.\n\nIt has no limit.\n';

// A new temporary folder with the files of the project
export function makeProject(prefix: string): string {
	const root = mkdtempSync(path.join(os.tmpdir(), prefix));
	mkdirSync(path.join(root, 'src'));
	writeFileSync(path.join(root, 'src', 'solver.cpp'), SOLVER);
	writeFileSync(path.join(root, 'README.md'), README);
	return root;
}

// The facts of DataFlow for a line in the loop of solve()
export const placeFacts = (file: string, line: number): PlaceFacts => ({
	file, line, function: { name: 'solve', lines: [3, 9] }, isInBody: true,
	around: [{ kind: 'for', lines: [5, 7], text: 'int i = 0; i < plan.steps' }],
	locks: [], threads: [], isOnCallerThread: true, isReachComplete: false,
});

export const heatFacts = (file: string, isReachComplete = false): HeatFacts => ({
	file, isReachComplete, notices: [],
	functions: [
		{ name: 'helper', lines: [3, 4], score: 12, band: 'cool', flames: 1, reach: 0, risk: 0, history: 0, isReachComplete: true, reasons: [], signals: [] },
		{ name: 'solve', lines: [3, 9], score: 64, band: 'hot', flames: 4, reach: 1, risk: 1, history: 1, isReachComplete, reasons: [], signals: [] },
	],
});

export const TYPE: HeatTypeFacts = {
	name: 'Plan', kind: 'struct', lines: [1, 5], isReachComplete: true,
	members: [
		{ name: 'steps', line: 2, type: 'int', shared: 'unprotected' },
		{ name: 'lock', line: 3, type: 'std::mutex' },
		{ name: 'total', line: 4, type: 'int', shared: 'locked' },
	],
};

// A fake of the API of DataFlow. calls: the files and the lines of each call
export function fakeEngine(calls: string[] = [], over: Partial<EngineApi> = {}): EngineApi {
	return {
		tools: () => ['get_place', 'get_heat', 'get_threads', 'get_callers'],
		place: async (file, line) => {
			calls.push(`place ${path.basename(file)}:${line}`);
			return placeFacts(file, line);
		},
		heat: async (file, lines) => {
			calls.push(`heat ${path.basename(file)}:${lines[0]}-${lines[1]}`);
			return heatFacts(file);
		},
		...over,
	};
}

// The dependencies of the tools of the build with no link to DataFlow: no base, no diff, and no other changed file
export function noBuild(): { base: () => BaseApi | undefined; saveFiles: () => Promise<void>; lines: LineStore; changes: StepChanges } {
	return { base: () => undefined, saveFiles: async () => undefined, lines: new LineStore(), changes: { start: () => undefined, files: () => [] } };
}

// A correct survey of the project
export const SURVEY = {
	tasks: [
		{ id: 'T1', title: 'A cycle limit', text: 'Stop the loop after a limit.', hooks: ['H1'], needs: [] },
		{ id: 'T2', title: 'A note in the README', hooks: ['H2'], needs: ['T1'] },
	],
	hooks: [
		{ id: 'H1', title: 'The loop of solve()', kind: 'new check in solve()', file: 'src/solver.cpp', lines: [5, 7], code: 'for (int i = 0;  i < plan.steps; ++i)' },
		{ id: 'H2', title: 'The limit in the README', kind: 'new sentence', file: 'README.md', line: 3, code: 'It has no limit.' },
	],
	facts: [{ text: 'solve() has 1 caller.', file: 'src/solver.cpp', lines: [3, 3], tool: 'mcp__plugin_dataflow_dataflow__get_callers' }],
	questions: [{ id: 'Q1', text: 'What is the limit?' }, { id: 'Q2', text: 'What happens at the limit?' }],
};
