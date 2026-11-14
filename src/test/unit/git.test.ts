import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { excludeFromGit } from '../../claude/git';

// The local settings of Claude Code go into info/exclude of git (proposal P15)
suite('Git exclude', () => {
	let dir: string;
	const file = '.claude/settings.local.json';

	setup(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-git-'));
	});
	teardown(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('The file goes into info/exclude 1 time, also for a folder in the repository', function () {
		if (spawnSync('git', ['--version'], { windowsHide: true }).status !== 0) {
			this.skip(); // no git
		}
		execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
		const sub = path.join(dir, 'app');
		mkdirSync(sub);
		assert.strictEqual(excludeFromGit(dir, file), true);
		assert.strictEqual(excludeFromGit(dir, file), false);
		assert.strictEqual(excludeFromGit(sub, file), true);
		const text = readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
		assert.ok(text.includes('\n/.claude/settings.local.json\n'), text);
		assert.ok(text.includes('\n/app/.claude/settings.local.json\n'), text);
		// git does not show the 2 files
		for (const folder of [dir, sub]) {
			mkdirSync(path.join(folder, '.claude'));
			writeFileSync(path.join(folder, '.claude', 'settings.local.json'), '{}');
		}
		const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8', windowsHide: true });
		assert.strictEqual(status, '');
	});

	test('A folder with no repository does not change', () => {
		assert.strictEqual(excludeFromGit(dir, file), false);
	});
});
