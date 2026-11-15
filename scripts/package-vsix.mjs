// Makes the VSIX package of the extension: node scripts/package-vsix.mjs
// > The package is for all platforms, because Shotgun has no program of its own. DataFlow has the engine, and the
//   package of DataFlow is only for Windows x64.
// > The script removes the folder out first. Then vsce compiles the extension (vscode:prepublish), so the package has
//   no old files of an earlier build.
// > vsce writes shotgun-<version>.vsix into the root folder. The package has no node_modules, because the extension
//   has no runtime dependencies.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');

rmSync(path.join(repo, 'out'), { recursive: true, force: true });

const vsce = path.join(repo, 'node_modules', '@vscode', 'vsce', 'vsce');
const status = spawnSync(process.execPath, [vsce, 'package', '--no-dependencies'], { cwd: repo, stdio: 'inherit' }).status ?? 1;

const { version } = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
if (status === 0) {
	console.log(`The package is shotgun-${version}.vsix.`);
}
process.exit(status);
