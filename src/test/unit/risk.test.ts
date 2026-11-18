import * as assert from 'assert';
import { Level, LEVEL_INFO, LEVELS, mainLoopAt, PlaceHeat, placeLevel, PlaceRisk, ScanState, stepLevel } from '../../session/risk';
import type { Band } from '../../session/survey';

// The risk rules of decisions 8 and 14 of the plan, with tables of facts and levels
suite('Risk rules', () => {
	const SCORE: Record<Band, number> = { cool: 10, warm: 30, hot: 60, 'very hot': 80 };
	const fn = (band: Band, over: Partial<PlaceHeat> = {}): PlaceHeat => ({ function: 'process', score: SCORE[band], band, isReachComplete: true, ...over });
	const inFn = (heat: PlaceHeat, over: Partial<PlaceRisk> = {}): PlaceRisk => ({ kind: 'function', heat, ...over });

	test('The rules give the level from the facts of DataFlow', () => {
		const cases: [string, PlaceRisk, ScanState, Level | null][] = [
			['a new file', { kind: 'new' }, 'ready', 1],
			['a file that is not C or C++', { kind: 'other' }, 'ready', 2],
			['lines in no function and in no type', { kind: 'none' }, 'ready', 2],
			['a cool function', inFn(fn('cool')), 'ready', 2],
			['a warm function', inFn(fn('warm')), 'ready', 3],
			['a hot function', inFn(fn('hot')), 'ready', 4],
			['a very hot function', inFn(fn('very hot')), 'ready', 5],
			['callers that the call graph cannot see, cool', inFn(fn('cool', { reachUnknown: 'Qt calls the slot' })), 'ready', 3],
			['callers that the call graph cannot see, hot', inFn(fn('hot', { reachUnknown: 'Qt calls the slot' })), 'ready', 4],
			['callers that the call graph cannot see, cool GUI code', inFn(fn('cool', { reachUnknown: 'Qt calls the slot', gui: 'View derives from QWidget' })), 'ready', 2],
			['callers that the call graph cannot see, warm GUI code', inFn(fn('warm', { reachUnknown: 'Qt calls the slot', gui: 'View derives from QWidget' })), 'ready', 3],
			['GUI code with a worker thread', inFn(fn('cool', { gui: 'View derives from QWidget' }), { workerThreads: ['w'] }), 'ready', 3],
			['an incomplete reach while the scan runs', inFn(fn('cool', { isReachComplete: false })), 'scanning', null],
			['an incomplete reach with no scan', inFn(fn('hot', { isReachComplete: false })), 'none', null],
			['an incomplete reach after a stopped scan', inFn(fn('cool', { isReachComplete: false })), 'stopped', 3],
			['an incomplete reach after a failed scan', inFn(fn('cool', { isReachComplete: false })), 'failed', 3],
			['an incomplete reach of a hot function after a stopped scan', inFn(fn('hot', { isReachComplete: false })), 'stopped', 4],
			['an incomplete reach after a complete scan', inFn(fn('cool', { isReachComplete: false })), 'ready', 3],
			['a complete reach while the scan runs', inFn(fn('cool')), 'scanning', 2],
			['a frame path past the limit', inFn(fn('cool'), { framePath: { reason: 'tick() calls it', isPastLimit: true } }), 'ready', 4],
			['a frame path in the limit', inFn(fn('cool'), { framePath: { reason: 'tick() calls it', isPastLimit: false } }), 'ready', 2],
			['a line in the main loop', inFn(fn('cool'), { mainLoop: 'main' }), 'ready', 4],
			['a worker thread', inFn(fn('warm'), { workerThreads: ['solve_power_plan()'] }), 'ready', 4],
			['a lock', inFn(fn('warm'), { locks: ['m_lock'] }), 'ready', 4],
			['a worker thread and a lock: 2 levels more', inFn(fn('cool'), { workerThreads: ['w'], locks: ['l'] }), 'ready', 4],
			['a worker thread and a lock on a hot function: a maximum of 5', inFn(fn('hot'), { workerThreads: ['w'], locks: ['l'] }), 'ready', 5],
			['the main loop and a worker thread', inFn(fn('cool'), { mainLoop: 'main', workerThreads: ['w'] }), 'ready', 5],
			['a new data member of a type', { kind: 'type', type: { name: 'Settings', isHot: false, changed: [] } }, 'ready', 2],
			['a new data member of a type on a frame path', { kind: 'type', type: { name: 'Settings', isHot: true, changed: [] } }, 'ready', 3],
			['a change of a data member with a hot user', {
				kind: 'type', type: { name: 'Ctl', isHot: true, changed: ['count'], hottestUser: { function: 'process', score: 60, band: 'hot' } },
			}, 'ready', 4],
			['a change of a data member with a cool user', {
				kind: 'type', type: { name: 'Ctl', isHot: false, changed: ['count'], hottestUser: { function: 'load', score: 10, band: 'cool' } },
			}, 'ready', 2],
		];
		for (const [name, place, scan, level] of cases) {
			assert.strictEqual(placeLevel(place, scan).level, level, name);
		}
	});

	test('The example plan of the design canvas gets the levels 3, 4, 5, 4, 2, 3, 1 and 1', () => {
		const process = fn('hot', { function: 'electricity::power_ctrl::process', score: 74 });
		const steps: PlaceRisk[] = [
			{ kind: 'type', type: { name: 'OperationalSettings', isHot: true, changed: [] } }, // a new field that process() reads in each frame
			inFn(process),
			inFn(fn('hot', { function: 'electricity::power_ctrl::solve_power_plan', score: 70 }), { workerThreads: ['solve_power_plan()'] }),
			inFn(process),
			inFn(fn('cool', { function: 'load_settings', score: 16, isSiloed: true })),
			inFn(fn('cool', { function: 'SettingsDialog::store', score: 15, reachUnknown: 'Qt calls it through the signal QDialogButtonBox::accepted' })),
			{ kind: 'new' },
			{ kind: 'new' },
		];
		assert.deepStrictEqual(steps.map((s) => placeLevel(s, 'ready').level), [3, 4, 5, 4, 2, 3, 1, 1]);
	});

	test('The reasons tell the rules that gave the level', () => {
		assert.deepStrictEqual(placeLevel(inFn(fn('hot', { function: 'solve_power_plan' }), { workerThreads: ['solve_power_plan()'] }), 'ready').reasons, [
			'A change of a hot function, solve_power_plan: level 4.',
			'The worker thread solve_power_plan() runs the line: 1 level more.',
		]);
		// a rule that does not make the level higher gives no reason
		assert.deepStrictEqual(placeLevel(inFn(fn('very hot', { reachUnknown: 'x' }), { locks: ['m'], mainLoop: 'main' }), 'ready').reasons,
			['A change of a very hot function, process: level 5.']);
		assert.deepStrictEqual(placeLevel(inFn(fn('cool', { isReachComplete: false })), 'stopped').reasons, [
			'A change of a cool function, process: level 2.',
			'The scan of the call graph stopped, so the reach is not complete: level 3 or higher.',
		]);
		assert.deepStrictEqual(placeLevel(inFn(fn('cool', { isReachComplete: false })), 'scanning').reasons,
			['The scan of the call graph is not complete. The level comes at the end of the scan.']);
		assert.deepStrictEqual(placeLevel({
			kind: 'type', type: { name: 'Ctl', isHot: true, changed: ['count', 'limit'], hottestUser: { function: 'process', score: 80, band: 'very hot' } },
		}, 'ready').reasons, [
			'A data member of the type Ctl is on a frame path, or threads share it: level 3.',
			'The step changes count and limit. The hottest function that uses them, process, is very hot: level 5.',
		]);
		assert.deepStrictEqual(placeLevel({ kind: 'other' }, 'ready').reasons,
			['The file is not a C or C++ file. DataFlow has no facts for it: level 2, no facts.']);
		assert.deepStrictEqual(placeLevel(inFn(fn('cool', { function: 'View::onClick', reachUnknown: 'x', gui: 'View derives from QWidget' })), 'ready').reasons, [
			'A change of a cool function, View::onClick: level 2.',
			'View::onClick is GUI code, so the callers that the call graph cannot see give no higher level.',
		]);
		// a warm level is already 3, so the rule of the callers adds no reason
		assert.deepStrictEqual(placeLevel(inFn(fn('warm', { function: 'View::paint', reachUnknown: 'x', gui: 'y' })), 'ready').reasons,
			['A change of a warm function, View::paint: level 3.']);
	});

	test('The level of a step is the highest level of its places, and a place with no level stops it', () => {
		assert.deepStrictEqual(stepLevel([{ level: 2, reasons: ['a'] }, { level: 4, reasons: ['b'] }, { level: 1, reasons: ['c'] }]), { level: 4, reasons: ['b'] });
		assert.deepStrictEqual(stepLevel([{ level: 2, reasons: ['a'] }, { level: null, reasons: ['wait'] }]), { level: null, reasons: ['wait'] });
		assert.strictEqual(stepLevel([]).level, null);
	});

	test('The main loop of a line comes from isMainLoop of DataFlow', () => {
		assert.strictEqual(mainLoopAt('app::run', [{ kind: 'if' }, { kind: 'while', isMainLoop: true }]), 'app::run');
		// an open loop that is no main loop, for example a loop that reads a file
		assert.strictEqual(mainLoopAt('main', [{ kind: 'while', isMainLoop: false }]), undefined);
		// with no complete call graph, a loop has no isMainLoop
		assert.strictEqual(mainLoopAt('main', [{ kind: 'for' }]), undefined);
		assert.strictEqual(mainLoopAt(undefined, [{ kind: 'for', isMainLoop: true }]), undefined);
	});

	test('Each level has a name, a writer and a text', () => {
		assert.deepStrictEqual(LEVELS.map((l) => [LEVEL_INFO[l].name, LEVEL_INFO[l].writer]), [
			['Very low', 'claude'], ['Low', 'claude'], ['Medium', 'frame'], ['High', 'user'], ['Very high', 'user'],
		]);
	});
});
