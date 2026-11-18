// Makes the VSIX package of the extension: node scripts/package-vsix.mjs [folder of the package]
// > The package is for all platforms, because Shotgun has no program of its own. DataFlow has the engine, and the
//   package of DataFlow is only for Windows x64.
// > The script removes the folder out first. Then vsce compiles the extension (vscode:prepublish), so the package has
//   no old files of an earlier build.
// > vsce writes shotgun-<version>.vsix. The default folder of the package is the root folder. The package has no
//   node_modules, because the extension has no runtime dependencies.
// > With the private key of scripts/make-signing-key.mjs, the script writes the signature <package>.sig. The updater of
//   Shotgun installs only a package with a correct signature (decision 42).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { signingKeyFile, signVsix } from './sign-vsix.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
const folder = path.resolve(process.argv[2] ?? repo);
const vsix = path.join(folder, `shotgun-${version}.vsix`);

rmSync(path.join(repo, 'out'), { recursive: true, force: true });
mkdirSync(folder, { recursive: true });

const vsce = path.join(repo, 'node_modules', '@vscode', 'vsce', 'vsce');
const status = spawnSync(process.execPath, [vsce, 'package', '--no-dependencies', '--out', vsix], { cwd: repo, stdio: 'inherit' }).status ?? 1;

if (status === 0) {
	console.log(`The package is ${path.basename(vsix)}.`);
	const keyFile = signingKeyFile();
	if (existsSync(keyFile)) {
		console.log(`The signature is ${path.basename(signVsix(vsix, version, readFileSync(keyFile, 'utf8')))}.`);
	} else {
		rmSync(`${vsix}.sig`, { force: true });
		console.warn(`${keyFile} does not exist, so the package has no signature. The updater of Shotgun does not install this package.`);
	}
}
process.exit(status);
