import * as assert from 'assert';
import { createHash, generateKeyPairSync, sign } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isNewer, isSignatureValid, readRelease, RELEASE_API, updateStatement } from '../../update/release';
import { CHECK_INTERVAL_MS, RETRY_INTERVAL_MS, UpdateMode, Updater } from '../../update/updater';

// The updates from the releases on GitHub (decision 42): the data of a release, the signature of a package, and the work
// of the updater with a server in memory

const keys = generateKeyPairSync('ed25519');
const PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const HOST = 'https://releases.test';

// A release on the server. signedVersion: the signature is for a different version. digest: GitHub gives this digest.
// statement: the text that the signature signs, for example the text of DataFlow
function releaseOf(version: string, options: { signedVersion?: string; digest?: string; statement?: string } = {}) {
	const name = `shotgun-${version}.vsix`;
	const bytes = Buffer.from(`package ${version}`);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const statement = options.statement ?? updateStatement(name, options.signedVersion ?? version, sha256);
	const signature = Buffer.from(sign(null, Buffer.from(statement), keys.privateKey).toString('base64'));
	return {
		json: {
			tag_name: `v${version}`, draft: false, prerelease: false, html_url: `${HOST}/v${version}`,
			assets: [
				{ name, browser_download_url: `${HOST}/${name}`, size: bytes.length, state: 'uploaded', digest: options.digest ?? `sha256:${sha256}` },
				{ name: `${name}.sig`, browser_download_url: `${HOST}/${name}.sig`, size: signature.length, state: 'uploaded' },
			],
		},
		files: new Map([[`${HOST}/${name}`, bytes], [`${HOST}/${name}.sig`, signature]]),
		sha256,
	};
}

suite('Updates from the releases on GitHub', () => {
	let dir: string;
	let clock: number;
	let mode: UpdateMode;
	let latest: ReturnType<typeof releaseOf>;
	let isOffline: boolean;
	let hasRelease: boolean;
	let requests: { url: string; etag: string | null; agent: string | null }[];
	let answer: 'update' | 'skip' | undefined;
	let installFails: boolean;
	let installs: string[];
	let asks: string[];
	let reloads: string[];
	let infos: string[];
	let warnings: string[];

	const downloads = () => requests.filter((r) => r.url !== RELEASE_API).length;

	// The updater of a window with the running version. Two updaters with the same folder are two windows
	const window = (version = '0.3.0') => new Updater({
		version, publicKey: PUBLIC_KEY, storageDir: dir, mode: () => mode,
		fetch: async (input, init) => {
			const url = String(input);
			const headers = new Headers(init?.headers);
			const etag = headers.get('if-none-match');
			requests.push({ url, etag, agent: headers.get('user-agent') });
			if (isOffline) {
				throw new Error('The network is not available.');
			}
			if (url === RELEASE_API) {
				if (!hasRelease) {
					return new Response('{"message":"Not Found"}', { status: 404 });
				}
				const tag = `"${latest.json.tag_name}${latest.json.assets[0].digest}"`;
				return etag === tag ? new Response(null, { status: 304 }) : new Response(JSON.stringify(latest.json), { headers: { ETag: tag } });
			}
			const file = latest.files.get(url);
			return file ? new Response(new Uint8Array(file)) : new Response('', { status: 404 });
		},
		install: async (vsix) => {
			if (installFails) {
				throw new Error('VS Code did not install the package.');
			}
			installs.push(readFileSync(vsix, 'utf8'));
		},
		ui: {
			askToUpdate: async (version_) => {
				asks.push(version_);
				return answer;
			},
			offerReload: async (version_) => {
				reloads.push(version_);
			},
			progress: (_title, work) => work(),
			info: (message) => infos.push(message),
			warn: (message) => warnings.push(message),
		},
		log: { info: () => undefined, warn: () => undefined },
		now: () => clock,
	});

	setup(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), 'shotgun-update-'));
		clock = Date.now();
		mode = 'auto';
		latest = releaseOf('0.3.1');
		isOffline = false;
		hasRelease = true;
		installFails = false;
		answer = undefined;
		[requests, installs, asks, reloads, infos, warnings] = [[], [], [], [], [], []];
	});

	teardown(() => rmSync(dir, { recursive: true, force: true }));

	test('A version is newer only if its numbers are higher, and a text that is not a version is never newer', () => {
		assert.deepStrictEqual([isNewer('0.3.1', '0.3.0'), isNewer('v0.10.0', '0.9.9'), isNewer('1.0.0', '0.99.99')], [true, true, true]);
		assert.deepStrictEqual([isNewer('0.3.0', '0.3.0'), isNewer('0.2.9', '0.3.0'), isNewer('0.4.0-beta', '0.3.0'), isNewer('latest', '0.3.0')],
			[false, false, false, false]);
	});

	test('A release needs a published version, a package shotgun-<version>.vsix and its signature', () => {
		const { json } = releaseOf('0.3.1');
		const release = readRelease(json);
		assert.deepStrictEqual([release?.version, release?.notesUrl, release?.vsix.name, release?.signature.name],
			['0.3.1', `${HOST}/v0.3.1`, 'shotgun-0.3.1.vsix', 'shotgun-0.3.1.vsix.sig']);
		assert.strictEqual(readRelease({ ...json, prerelease: true }), undefined);
		assert.strictEqual(readRelease({ ...json, draft: true }), undefined);
		assert.strictEqual(readRelease({ ...json, tag_name: 'nightly' }), undefined);
		assert.strictEqual(readRelease({ ...json, tag_name: 'v0.3.2' }), undefined, 'the package of a different version');
		assert.strictEqual(readRelease({ ...json, assets: [json.assets[0]] }), undefined, 'no signature');
		assert.strictEqual(readRelease({ ...json, assets: [{ ...json.assets[0], state: 'starter' }, json.assets[1]] }), undefined, 'an upload that is not complete');
		assert.strictEqual(readRelease({ ...json, html_url: 'http://releases.test/v0.3.1' })?.notesUrl, 'https://github.com/KnurrliDev/Shotgun/releases');
		assert.strictEqual(readRelease(null), undefined);
	});

	test('A signature is correct only for the name, the version and the file that it signs, and only with the key', () => {
		const statement = updateStatement('a.vsix', '0.3.1', 'abc');
		const signature = sign(null, Buffer.from(statement), keys.privateKey).toString('base64');
		assert.strictEqual(isSignatureValid(statement, `${signature}\n`, PUBLIC_KEY), true);
		assert.strictEqual(isSignatureValid(updateStatement('a.vsix', '0.3.2', 'abc'), signature, PUBLIC_KEY), false, 'a different version');
		assert.strictEqual(isSignatureValid(updateStatement('a.vsix', '0.3.1', 'abd'), signature, PUBLIC_KEY), false, 'a different file');
		assert.strictEqual(isSignatureValid(statement, 'not a signature', PUBLIC_KEY), false);
		const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
		assert.strictEqual(isSignatureValid(statement, signature, other), false, 'a different key');
		assert.strictEqual(isSignatureValid(statement, signature, 'not a key'), false);
		assert.strictEqual(isSignatureValid(statement, signature, ''), false, 'no key');
	});

	test('auto: a new version installs one time, the window offers a reload, and the download is removed', async () => {
		const updater = window();
		await updater.tick();
		assert.deepStrictEqual([installs, reloads, asks, warnings], [['package 0.3.1'], ['0.3.1'], [], []]);
		assert.strictEqual(existsSync(path.join(dir, 'download')), false);
		assert.strictEqual(existsSync(path.join(dir, 'updater.lock')), false);
		// GitHub needs a User-Agent. It names only Shotgun and its version
		assert.deepStrictEqual([...new Set(requests.map((r) => r.agent))], ['Shotgun/0.3.0']);

		// the time for the next check did not come, and the reload shows one time in the window
		const count = requests.length;
		await updater.tick();
		assert.deepStrictEqual([requests.length, installs.length, reloads.length], [count, 1, 1]);
	});

	test('A different window does not install the version again, and it offers the reload too', async () => {
		await window().tick();
		const count = requests.length;
		await window().tick();
		assert.deepStrictEqual([requests.length, installs.length, reloads], [count, 1, ['0.3.1', '0.3.1']]);
		// after the reload, the window runs the new version
		const reloaded = window('0.3.1');
		clock += CHECK_INTERVAL_MS;
		await reloaded.tick();
		assert.deepStrictEqual([installs.length, reloads.length, warnings], [1, 2, []]);
	});

	test('ask: nothing downloads until the user clicks Update, and a skipped version does not ask again', async () => {
		mode = 'ask';
		const updater = window();
		await updater.tick();
		assert.deepStrictEqual([asks, installs, downloads()], [['0.3.1'], [], 0]);
		// the same window asks one time
		clock += CHECK_INTERVAL_MS;
		await updater.tick();
		assert.deepStrictEqual(asks, ['0.3.1']);

		answer = 'skip';
		clock += CHECK_INTERVAL_MS;
		await window().tick();
		assert.deepStrictEqual(asks, ['0.3.1', '0.3.1']);
		clock += CHECK_INTERVAL_MS;
		await window().tick();
		assert.deepStrictEqual(asks, ['0.3.1', '0.3.1'], 'a skipped version');

		// the command asks also for a skipped version
		answer = 'update';
		await window().check(true);
		assert.deepStrictEqual([installs, reloads], [['package 0.3.1'], ['0.3.1']]);
	});

	test('off: no automatic check, but the command still works', async () => {
		mode = 'off';
		await window().tick();
		assert.strictEqual(requests.length, 0);
		answer = 'update';
		await window().check(true);
		assert.deepStrictEqual([asks, installs], [['0.3.1'], ['package 0.3.1']]);
	});

	test('The command tells that the version is the latest version, and an older release installs nothing', async () => {
		await window('0.3.1').check(true);
		assert.deepStrictEqual([infos, installs], [['Shotgun 0.3.1 is the latest version.'], []]);
		latest = releaseOf('0.2.0');
		clock += CHECK_INTERVAL_MS;
		await window('0.3.1').tick();
		assert.deepStrictEqual([installs, reloads], [[], []]);
	});

	test('A repository with no published release is not a failure', async () => {
		hasRelease = false;
		await window().tick();
		assert.deepStrictEqual([requests.length, installs, warnings], [1, [], []]);
		await window().check(true);
		assert.deepStrictEqual([infos, warnings], [['Shotgun 0.3.0 is the latest version.'], []]);
		// the next automatic check waits for the interval
		await window().tick();
		assert.strictEqual(requests.length, 2);
	});

	test('A check waits for the interval, sends the ETag of the last reply, and finds a new release', async () => {
		const updater = window('0.3.1');
		await updater.tick();
		assert.deepStrictEqual(requests.map((r) => r.etag), [null]);
		await updater.tick();
		assert.strictEqual(requests.length, 1, 'the interval');
		clock += CHECK_INTERVAL_MS;
		await updater.tick();
		assert.deepStrictEqual(requests.map((r) => r.etag), [null, `"v0.3.1${latest.json.assets[0].digest}"`]);

		latest = releaseOf('0.3.2');
		clock += CHECK_INTERVAL_MS;
		await updater.tick();
		assert.deepStrictEqual([installs, reloads], [['package 0.3.2'], ['0.3.2']]);
	});

	test('An old package with its correct signature does not install as a new version, and the warning comes one time', async () => {
		latest = releaseOf('0.3.1', { signedVersion: '0.3.0' });
		await window().tick();
		assert.deepStrictEqual([installs, reloads], [[], []]);
		assert.deepStrictEqual(warnings, ['Shotgun did not install version 0.3.1, because the signature of the package is not correct.']);

		// the next checks do not download the version again
		const count = downloads();
		clock += CHECK_INTERVAL_MS;
		await window().tick();
		assert.deepStrictEqual([downloads(), warnings.length], [count, 1]);

		// the command tries again, and a correct package of a newer version installs
		answer = 'update';
		await window().check(true);
		assert.deepStrictEqual([installs.length, warnings.length], [0, 2]);
		latest = releaseOf('0.3.2');
		clock += CHECK_INTERVAL_MS;
		await window().tick();
		assert.deepStrictEqual(installs, ['package 0.3.2']);
	});

	test('A signature of the text of DataFlow does not install a package of Shotgun', async () => {
		const name = 'shotgun-0.3.1.vsix';
		const sha256 = releaseOf('0.3.1').sha256;
		latest = releaseOf('0.3.1', { statement: `dataflow-update-1\n${name}\n0.3.1\n${sha256}\n` });
		await window().tick();
		assert.deepStrictEqual([installs, warnings], [[], ['Shotgun did not install version 0.3.1, because the signature of the package is not correct.']]);
	});

	test('A damaged download does not install, shows no warning, and tries again after a short time', async () => {
		latest = releaseOf('0.3.1', { digest: 'sha256:0000' });
		await window().tick();
		assert.deepStrictEqual([installs, warnings], [[], []]);
		latest = releaseOf('0.3.1');
		clock += RETRY_INTERVAL_MS - 1000;
		await window().tick();
		assert.strictEqual(installs.length, 0, 'the time did not come');
		clock += 1000;
		await window().tick();
		assert.deepStrictEqual(installs, ['package 0.3.1']);
	});

	test('A failure of the network or of the install is quiet, and the command tells it', async () => {
		isOffline = true;
		await window().tick();
		assert.deepStrictEqual([installs, warnings], [[], []]);
		await window().check(true);
		assert.deepStrictEqual(warnings, ['Shotgun could not check for updates: The network is not available.']);

		isOffline = false;
		installFails = true;
		warnings = [];
		clock += RETRY_INTERVAL_MS;
		await window().tick();
		assert.deepStrictEqual([reloads, warnings], [[], []]);
		answer = 'update';
		await window().check(true);
		assert.deepStrictEqual([reloads, warnings], [[], ['Shotgun could not install version 0.3.1: VS Code did not install the package.']]);
		assert.strictEqual(existsSync(path.join(dir, 'download')), false);
	});

	test('A window waits for the lock of a different window, and takes a lock that is stale', async () => {
		mkdirSync(dir, { recursive: true });
		const lock = path.join(dir, 'updater.lock');
		writeFileSync(lock, '');
		await window().tick();
		assert.strictEqual(requests.length, 0);
		await window().check(true);
		assert.deepStrictEqual(infos, ['A different window of VS Code updates Shotgun now. Try again in some minutes.']);

		const old = new Date(clock - 60 * 60 * 1000);
		utimesSync(lock, old, old);
		await window().tick();
		assert.deepStrictEqual(installs, ['package 0.3.1']);
	});
});
