import { createPublicKey, verify } from 'crypto';

// The releases of Shotgun on GitHub: the data of the latest release, and the signature of its package (decision 42). The
// updater of DataFlow has the same design. This module does not use the VS Code API, so the unit tests can call it
// directly.

// The latest release of the repository. GitHub gives no draft and no prerelease here
export const RELEASE_API = 'https://api.github.com/repos/KnurrliDev/Shotgun/releases/latest';
export const RELEASES_PAGE = 'https://github.com/KnurrliDev/Shotgun/releases';

// The public key of the signatures of the packages: Ed25519, as SPKI in base64. scripts/make-signing-key.mjs makes the
// key pair. The private key is not in the repository
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAOnCMh9N4Kca2aDVrXHvR0luFqffmHV1R4HStewSnq7g=';

export interface ReleaseAsset {
	readonly name: string;
	readonly url: string;
	readonly size: number;
	readonly digest?: string; // "sha256:<hex>", if GitHub gives it
}

// A release with a package and its signature. The package of Shotgun is for all platforms
export interface Release {
	readonly version: string;
	readonly notesUrl: string; // the page of the release
	readonly vsix: ReleaseAsset;
	readonly signature: ReleaseAsset;
}

const numbersOf = (version: string): number[] | undefined => {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match ? match.slice(1).map(Number) : undefined;
};

// True if version is a higher version than the second version. A text that is not a version is never higher, also a
// version with a pre-release part. compareVersions of src/dataflow/version.ts is for the version of DataFlow
export function isNewer(version: string, than: string): boolean {
	const [a, b] = [numbersOf(version), numbersOf(than)];
	if (!a || !b) {
		return false;
	}
	const at = a.findIndex((n, i) => n !== b[i]);
	return at >= 0 && a[at] > b[at];
}

// The release in a reply of the GitHub API. Undefined if it is not a published release, or if it has no package
// shotgun-<version>.vsix or no signature for the package
export function readRelease(json: unknown): Release | undefined {
	const r = json as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; html_url?: unknown; assets?: unknown } | null;
	if (!r || typeof r !== 'object' || r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string'
		|| !numbersOf(r.tag_name) || !Array.isArray(r.assets)) {
		return undefined;
	}
	const assets = r.assets as { name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown; state?: unknown }[];
	const assetOf = (name: string): ReleaseAsset | undefined => {
		const a = assets.find((x) => x?.name === name);
		if (!a || (a.state !== undefined && a.state !== 'uploaded') || typeof a.browser_download_url !== 'string' || typeof a.size !== 'number') {
			return undefined;
		}
		return { name, url: a.browser_download_url, size: a.size, ...(typeof a.digest === 'string' ? { digest: a.digest } : {}) };
	};
	const version = r.tag_name.replace(/^v/, '');
	const name = `shotgun-${version}.vsix`;
	const vsix = assetOf(name);
	const signature = assetOf(`${name}.sig`);
	if (!vsix || !signature) {
		return undefined;
	}
	const notesUrl = typeof r.html_url === 'string' && r.html_url.startsWith('https://') ? r.html_url : RELEASES_PAGE;
	return { version, notesUrl, vsix, signature };
}

// The text that the signature of a package signs. The version is in the text, so an old package cannot come back as a
// new version. The first line is different from the text of DataFlow, so a signature of DataFlow is not correct for
// Shotgun. IMPORTANT: updateStatement in scripts/sign-vsix.mjs makes the same text
export const updateStatement = (name: string, version: string, sha256: string): string =>
	`shotgun-update-1\n${name}\n${version}\n${sha256}\n`;

// True if the signature, in base64, is a correct signature of the text
export function isSignatureValid(statement: string, signature: string, publicKey: string): boolean {
	try {
		const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
		return verify(null, Buffer.from(statement), key, Buffer.from(signature.trim(), 'base64'));
	} catch {
		return false;
	}
}
