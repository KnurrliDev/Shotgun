// The test of the updates of Shotgun in the test build of VS Code (decision 42): node scripts/test-update.mjs <new run folder>
// > The script makes packages of three versions from the VSIX package of the repository. A release server on this computer
//   gives them to an installed package of Shotgun.
// > The installed package gets the second version with a correct signature by itself, and it offers a reload. After the
//   reload, the second version runs.
// > Then the server gives the signed package of the second version as a third version. Shotgun refuses it.
// > The packages use a key pair of this run, not the private key of the releases. The script replaces the address of the
//   releases, the public key and the delay of the first check only in the unpacked copy of the package.
// > All files of the run go into the run folder: the packages, the user data and the extensions of VS Code, the settings
//   of Claude Code, the MCP registry of DataFlow and the home folder of Shotgun. The packages in the root folder of the
//   repository do not change. At the end, the script stops each process of the run.
// Prerequisites: DataFlow in ../DataFlow or in DATAFLOW_REPO, with a test build of VS Code in .vscode-test, and a VSIX
// package of DataFlow in its root folder or in DATAFLOW_VSIX. Do not use the mouse or the keyboard in the window of the test.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as h from './harness.mjs';
import { signVsix } from './sign-vsix.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const DATAFLOW = path.resolve(process.env.DATAFLOW_REPO ?? path.join(repo, '..', 'DataFlow'));
const PORT = 9374;

const dir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || fs.existsSync(dir)) {
	console.error('Give a new run folder: node scripts/test-update.mjs <new run folder>');
	process.exit(2);
}
const p = {
	packages: path.join(dir, 'packages'),
	unpacked: path.join(dir, 'unpacked'),
	extensions: path.join(dir, 'extensions'),
	userData: path.join(dir, 'user-data'),
	project: path.join(dir, 'project'),
	shots: path.join(dir, 'shots'),
};
Object.values(p).forEach((d) => fs.mkdirSync(d, { recursive: true }));

const base = h.readJson(path.join(repo, 'package.json')).version;
const [major, minor, patch] = base.split('.').map(Number);
const versions = { old: base, next: `${major}.${minor}.${patch + 1}`, replay: `${major}.${minor}.${patch + 2}` };
const packageName = (version) => `shotgun-${version}.vsix`;
const folderOf = (version) => `knurrlidev.shotgun-${version}`;
const result = { versions };

const results = [];
function check(name, isOk, detail) {
	results.push(isOk);
	console.log(`${isOk ? 'PASS' : 'FAIL'} ${name}${!isOk && detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
}

// The release server: the latest release, and its files. latest is the release that the server gives now
let latest;
const served = [];
const server = http.createServer((req, res) => {
	served.push(req.url);
	if (req.url === '/latest') {
		const etag = `"${latest.json.tag_name}"`;
		if (req.headers['if-none-match'] === etag) {
			res.writeHead(304).end();
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag }).end(JSON.stringify(latest.json));
		return;
	}
	const file = latest?.files.get(req.url);
	if (!file) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
	fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;

// A release of the server with a package and a signature file
function releaseOf(version, vsix, signature) {
	const name = packageName(version);
	const asset = (assetName, file) => ({
		name: assetName, size: fs.statSync(file).size, state: 'uploaded', browser_download_url: `${address}/files/${assetName}`,
		digest: `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`,
	});
	return {
		json: { tag_name: `v${version}`, draft: false, prerelease: false, html_url: `https://releases.test/v${version}`, assets: [asset(name, vsix), asset(`${name}.sig`, signature)] },
		files: new Map([[`/files/${name}`, vsix], [`/files/${name}.sig`, signature]]),
	};
}

const powershell = (command) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
	{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const zipLibrary = 'Add-Type -AssemblyName System.IO.Compression.FileSystem;';

// Replaces a text in a file of the unpacked package. The text must be there
function replaceIn(file, from, to) {
	const full = path.join(p.unpacked, file);
	const text = fs.readFileSync(full, 'utf8');
	if (!text.includes(from)) {
		throw new Error(`${file} does not contain ${from}`);
	}
	fs.writeFileSync(full, text.split(from).join(to));
}

// The packages: the old version with the key and the server of this run, and the next version with a correct signature
function makePackages() {
	const made = spawnSync(process.execPath, [path.join(repo, 'scripts', 'package-vsix.mjs'), p.packages],
		{ cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, SHOTGUN_SIGNING_KEY: path.join(dir, 'no-key.pem') } });
	if (made.status !== 0) {
		throw new Error(`package-vsix.mjs failed: ${made.stdout}${made.stderr}`);
	}
	const source = path.join(p.packages, packageName(base));
	powershell(`${zipLibrary} [IO.Compression.ZipFile]::ExtractToDirectory('${source}', '${p.unpacked}')`);
	const keys = generateKeyPairSync('ed25519');
	const release = 'extension/out/update/release.js';
	const realKey = /UPDATE_PUBLIC_KEY = '([^']*)'/.exec(fs.readFileSync(path.join(p.unpacked, release), 'utf8'))?.[1];
	if (realKey === undefined) {
		throw new Error(`${release} has no UPDATE_PUBLIC_KEY`);
	}
	replaceIn(release, `UPDATE_PUBLIC_KEY = '${realKey}'`, `UPDATE_PUBLIC_KEY = '${keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}'`);
	replaceIn(release, 'https://api.github.com/repos/KnurrliDev/Shotgun/releases/latest', `${address}/latest`);
	replaceIn('extension/out/update/start.js', 'START_DELAY_MS = 60000', 'START_DELAY_MS = 1500');

	const files = {};
	let current = base;
	for (const version of [versions.old, versions.next]) {
		if (version !== current) {
			replaceIn('extension/package.json', `"version": "${current}"`, `"version": "${version}"`);
			replaceIn('extension.vsixmanifest', `Version="${current}"`, `Version="${version}"`);
			current = version;
		}
		const file = path.join(p.packages, `made-${version}`, packageName(version));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		powershell(`${zipLibrary} [IO.Compression.ZipFile]::CreateFromDirectory('${p.unpacked}', '${file}')`);
		files[version] = file;
	}
	const signature = signVsix(files[versions.next], versions.next, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

	// the signed package of the next version, with the name of a higher version and its old signature
	const replay = path.join(p.packages, 'made-replay', packageName(versions.replay));
	fs.mkdirSync(path.dirname(replay), { recursive: true });
	fs.copyFileSync(files[versions.next], replay);
	fs.copyFileSync(signature, `${replay}.sig`);
	return {
		old: files[versions.old],
		next: releaseOf(versions.next, files[versions.next], signature),
		replay: releaseOf(versions.replay, replay, `${replay}.sig`),
	};
}

// Installs a package with the CLI of the test build, with no console window
const code = h.codeExe(DATAFLOW);
const cliJs = fs.readdirSync(path.dirname(code)).map((d) => path.join(path.dirname(code), d, 'resources', 'app', 'out', 'cli.js')).find((f) => fs.existsSync(f));
function install(vsix) {
	const out = spawnSync(code, [cliJs, '--extensions-dir', p.extensions, '--user-data-dir', p.userData, '--install-extension', vsix],
		{ env: h.cleanEnv({ ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf8', windowsHide: true, timeout: 180000 });
	if (out.status !== 0) {
		throw new Error(`The install of ${path.basename(vsix)} failed: ${out.stdout}${out.stderr}`);
	}
}

// The newest package of DataFlow. VS Code installs Shotgun only with DataFlow
function dataflowVsix() {
	if (process.env.DATAFLOW_VSIX) {
		return path.resolve(process.env.DATAFLOW_VSIX);
	}
	const name = fs.readdirSync(DATAFLOW).filter((n) => /^dataflow-win32-x64-.+\.vsix$/.test(n))
		.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
	if (!name) {
		throw new Error(`${DATAFLOW} has no VSIX package of DataFlow. Give one in DATAFLOW_VSIX.`);
	}
	return path.join(DATAFLOW, name);
}

// The folders of the installed versions of Shotgun
const installed = () => fs.readdirSync(p.extensions).filter((d) => d.startsWith('knurrlidev.shotgun-')).sort();

// The text and the buttons of a notification toast with this text
const toast = (wb, text) => wb.evaluate(`(() => { const t = [...document.querySelectorAll('.notifications-toasts .notification-toast')]
	.find((x) => x.textContent.includes(${JSON.stringify(text)}));
	return t ? { text: t.querySelector('.notification-list-item-message')?.textContent ?? '', buttons: [...t.querySelectorAll('.monaco-button')].map((b) => b.textContent) } : null; })()`);
const clickButton = (wb, text, button) => wb.evaluate(`(() => { const t = [...document.querySelectorAll('.notifications-toasts .notification-toast')]
	.find((x) => x.textContent.includes(${JSON.stringify(text)}));
	const b = t && [...t.querySelectorAll('.monaco-button')].find((x) => x.textContent === ${JSON.stringify(button)});
	if (b) { b.click(); } return !!b; })()`);
const waitForToast = async (wb, text, seconds, what) => {
	const value = await h.poll(() => toast(wb, text), seconds);
	if (!value) {
		throw new Error(`No ${what} after ${seconds} s.`);
	}
	return value;
};

let proc;
try {
	const made = makePackages();
	install(dataflowVsix());
	install(made.old);
	result.before = installed();

	// a folder with a task folder of Shotgun: Shotgun starts with the window
	fs.mkdirSync(path.join(p.project, '.shotgun'), { recursive: true });
	fs.writeFileSync(path.join(p.project, '.shotgun', 'active.json'), JSON.stringify({ version: 1, task: null, isPaused: false }));
	const notes = path.join(p.project, 'notes.txt');
	fs.writeFileSync(notes, 'A file for the focus of the text editor.\n');
	const user = path.join(p.userData, 'User');
	fs.mkdirSync(user, { recursive: true });
	fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none', 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'chat.disableAIFeatures': true,
		'git.enabled': false, 'extensions.ignoreRecommendations': true, 'extensions.autoCheckUpdates': false, 'update.mode': 'none',
		'telemetry.telemetryLevel': 'off', 'security.workspace.trust.enabled': false, 'window.restoreWindows': 'none',
		// DataFlow does not look for its releases on GitHub in this test
		'dataflow.update.mode': 'off',
	}, null, 2));

	latest = made.next;
	proc = spawn(code, [`--extensions-dir=${p.extensions}`, `--user-data-dir=${p.userData}`, `--remote-debugging-port=${PORT}`,
		'--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', p.project, '--goto', `${notes}:1:1`], {
		stdio: 'ignore', windowsHide: true,
		env: h.cleanEnv({ SHOTGUN_HOME: path.join(dir, 'shotgun-home'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'), DATAFLOW_MCP_REGISTRY: path.join(dir, 'registry') }),
	});
	let wb = await h.workbench(PORT, p.shots);

	// the window installs the new version by itself, and the old version runs until the reload
	const installedText = `Shotgun ${versions.next} is installed`;
	result.offer = await waitForToast(wb, installedText, 120, 'offer of a reload');
	result.afterInstall = { folders: installed() };
	await wb.shot('update-offer.png');

	// the reload starts the new version. The mark of the old page goes away with the reload
	await wb.evaluate('window.__shotgunUpdateTest = true');
	await clickButton(wb, installedText, 'Reload');
	wb.ws.close();
	await h.sleep(1000);
	wb = await h.workbench(PORT, p.shots);
	const isReloaded = () => Promise.race([
		wb.evaluate('window.__shotgunUpdateTest !== true && !!document.querySelector(".monaco-editor .view-lines")'), h.sleep(2000).then(() => false),
	]);
	if (!await h.poll(isReloaded, 90)) {
		throw new Error('The window did not reload.');
	}
	await h.sleep(3000);

	// the command finds a higher version. Its package has a correct signature, but for a different version
	latest = made.replay;
	await h.command(wb, 'Shotgun: Check for Updates');
	const askText = `Shotgun ${versions.replay} is available`;
	result.ask = await waitForToast(wb, askText, 30, 'question for the update');
	await clickButton(wb, askText, 'Update');
	result.refused = await waitForToast(wb, `did not install version ${versions.replay}`, 60, 'warning for the signature');
	await wb.shot('update-refused.png');
	result.afterRefusal = { folders: installed() };
	result.served = [...new Set(served)];
	wb.ws.close();
} catch (error) {
	result.error = String(error?.stack ?? error);
} finally {
	if (proc) {
		h.killTree(proc.pid);
	}
	result.left = (await h.stopProcessesOf(dir)).map((x) => x.name);
	server.close();
	server.closeAllConnections();
}

const { old, next, replay } = versions;
check('The run has no error', !result.error, result.error);
check('Before the update, only the old version is installed', JSON.stringify(result.before) === JSON.stringify([folderOf(old)]), result.before);
check('The new version installs by itself, and a notification offers the reload',
	JSON.stringify(result.offer) === JSON.stringify({ text: `Shotgun ${next} is installed. Reload the window to use it.`, buttons: ['Reload', 'Release Notes'] }), result.offer);
check('The folder of the new version is there before the reload', !!result.afterInstall?.folders.includes(folderOf(next)), result.afterInstall);
check('After the reload, the new version runs, and the command asks for the higher version',
	JSON.stringify(result.ask) === JSON.stringify({ text: `Shotgun ${replay} is available. You have version ${next}.`, buttons: ['Update', 'Release Notes', 'Skip This Version'] }), result.ask);
check('Shotgun refuses the old package as a new version',
	result.refused?.text === `Shotgun did not install version ${replay}, because the signature of the package is not correct.`, result.refused);
check('The refused version is not installed', !!result.afterRefusal && !result.afterRefusal.folders.includes(folderOf(replay)), result.afterRefusal);
const expected = ['/latest', `/files/${packageName(next)}.sig`, `/files/${packageName(next)}`, `/files/${packageName(replay)}.sig`, `/files/${packageName(replay)}`];
check('The updater asked the release server only for the release and its files',
	JSON.stringify([...(result.served ?? [])].sort()) === JSON.stringify([...expected].sort()), result.served);
check('No process of the run is left', result.left.length === 0, result.left);
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
console.log(`${results.filter(Boolean).length} of ${results.length} checks passed. The data is in ${path.join(dir, 'result.json')}.`);
process.exit(results.every(Boolean) ? 0 : 1);
