import * as assert from 'assert';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hashLine, hashLines, LineStore, mapLines, moveLines, runsOf } from '../../session/lines';

// The writer of each changed line (section 6.9 of the plan): the hashes of the lines, the map of the old lines to the
// new lines, and the runs of the writers after a change
suite('Lines of the writers', () => {
	const owner = { writer: 'claude' as const, step: 'S1', change: 'C1' };

	test('A change of the spaces keeps the hash of a line, and a change of the text changes it', () => {
		assert.strictEqual(hashLine('    int x = 1;'), hashLine('int  x = 1;   '));
		assert.notStrictEqual(hashLine('int x = 1;'), hashLine('int x = 2;'));
		assert.strictEqual(hashLine('').length, 6);
	});

	test('The map of the lines finds the old lines after an insert, a delete and a replace', () => {
		const old = ['a', 'b', 'c', 'd', 'e'];
		assert.deepStrictEqual(mapLines(old, ['a', 'b', 'X', 'c', 'd', 'e']), [0, 1, -1, 2, 3, 4]);
		assert.deepStrictEqual(mapLines(old, ['a', 'c', 'd', 'e']), [0, 2, 3, 4]);
		assert.deepStrictEqual(mapLines(old, ['a', 'b', 'Y', 'd', 'e']), [0, 1, -1, 3, 4]);
		assert.deepStrictEqual(mapLines(old, ['Z', 'a', 'b', 'c', 'd', 'e', 'W']), [-1, 0, 1, 2, 3, 4, -1]);
		// 2 separate changes in the middle part
		assert.deepStrictEqual(mapLines(['x', 'p', 'q', 'r', 's', 'y'], ['x', 'p', 'N', 'r', 'M', 's', 'y']), [0, 1, -1, 3, -1, 4, 5]);
		assert.deepStrictEqual(mapLines([], ['a']), [-1]);
		assert.deepStrictEqual(mapLines(['a'], []), []);
	});

	test('The runs move with the lines. A changed line loses its writer, and a new line gets the writer of the change', () => {
		const text = ['int a;', 'int b;', 'int c;', 'int d;'];
		const start = moveLines(undefined, text);
		assert.deepStrictEqual(start.runs, []);
		const claude = { hashes: start.hashes, runs: [{ lines: [2, 3] as [number, number], ...owner }] };
		// 2 lines above the run move it down
		const moved = moveLines(claude, ['// x', '// y', ...text]);
		assert.deepStrictEqual(moved.runs.map((r) => r.lines), [[4, 5]]);
		// the user changes line 2 of Claude: it becomes a line of the user
		const user = { writer: 'user' as const, step: 'S2' };
		const changed = moveLines(claude, ['int a;', 'int b = 2;', 'int c;', 'int d;'], user);
		assert.deepStrictEqual(changed.runs.map((r) => [r.lines, r.writer]), [[[2, 2], 'user'], [[3, 3], 'claude']]);
		// a change from the disk gives the new line no writer
		const disk = moveLines(claude, ['int a;', 'int b;', 'int bb;', 'int c;', 'int d;']);
		assert.deepStrictEqual(disk.runs.map((r) => r.lines), [[2, 2], [4, 4]]);
	});

	test('The runs join the lines with the same writer, step and change', () => {
		const a = { writer: 'claude' as const, step: 'S1', change: 'C1' };
		const b = { writer: 'claude' as const, step: 'S1', change: 'C2' };
		assert.deepStrictEqual(runsOf([undefined, a, a, b, undefined, a]).map((r) => [r.lines, r.change]), [[[2, 3], 'C1'], [[4, 4], 'C2'], [[6, 6], 'C1']]);
	});

	test('The store of the lines keeps only the files with lines of a writer, and lines.json keeps them after a reload', () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-lines-'));
		try {
			const file = path.join(dir, 'task', 'lines.json');
			const lines = new LineStore();
			lines.load(file);
			const text = ['int a;', 'int b;', 'int c;'];
			// a file with no lines of a writer stays out
			assert.strictEqual(lines.sync('src/a.cpp', text, { writer: 'user', step: '' }), false);
			assert.strictEqual(lines.has('src/a.cpp'), false);
			lines.replaceStep('src/a.cpp', text, 'claude', 'S1', [{ lines: [2, 3], change: 'C1' }]);
			assert.deepStrictEqual(lines.runs('src/a.cpp').map((r) => r.lines), [[2, 3]]);
			// a new receipt of the step replaces the old lines of the step
			lines.replaceStep('src/a.cpp', text, 'claude', 'S1', [{ lines: [3], change: 'C2' }]);
			assert.deepStrictEqual(lines.runs('src/a.cpp').map((r) => [r.lines, r.change]), [[[3, 3], 'C2']]);
			assert.strictEqual(lines.sync('src/a.cpp', ['int z;', ...text]), true);
			lines.flush();
			const again = new LineStore();
			again.load(file);
			assert.deepStrictEqual(again.runs('src/a.cpp').map((r) => r.lines), [[4, 4]]);
			assert.strictEqual(again.loadProblem, undefined);
			assert.strictEqual(hashLines(['int z;', ...text]).join(''), (again as unknown as { files: Map<string, { hashes: string }> }).files.get('src/a.cpp')!.hashes);
			// with no lines of a writer, lines.json goes away
			again.replaceStep('src/a.cpp', ['int z;', ...text], 'claude', 'S1', []);
			again.flush();
			assert.strictEqual(existsSync(file), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('A followed file of a step of the user gives a typed line its writer at once, and stays out of lines.json until then', () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-lines-'));
		try {
			const file = path.join(dir, 'task', 'lines.json');
			const lines = new LineStore();
			lines.load(file);
			const text = ['void process() {', '  run();', '}'];
			assert.strictEqual(lines.track('src/battery.cpp', text), true);
			assert.strictEqual(lines.track('src/battery.cpp', ['int other;']), false);
			lines.flush();
			assert.strictEqual(existsSync(file), false);
			// a new indent of the next line keeps its hash, so only the typed line is a line of the user
			const user = { writer: 'user' as const, step: 'S4' };
			assert.strictEqual(lines.sync('src/battery.cpp', ['void process() {', '  charge.is_dirty = true;', '    run();', '}'], user), true);
			assert.deepStrictEqual(lines.runs('src/battery.cpp').map((r) => [r.lines, r.writer, r.step]), [[[2, 2], 'user', 'S4']]);
			// a new file of the step starts with no text
			assert.strictEqual(lines.track('tests/new_test.cpp', ['']), true);
			lines.sync('tests/new_test.cpp', ['TEST(Limit, Stops) {', '}', ''], user);
			assert.deepStrictEqual(lines.runs('tests/new_test.cpp').map((r) => r.lines), [[1, 2]]);
			lines.flush();
			const again = new LineStore();
			again.load(file);
			assert.deepStrictEqual(again.paths.sort(), ['src/battery.cpp', 'tests/new_test.cpp']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
