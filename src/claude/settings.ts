import * as os from 'os';
import * as path from 'path';

// The settings of Claude Code for the plugin of Shotgun (proposal P15). The user settings declare the marketplace of
// Shotgun, and the local settings of each project with a Shotgun task turn the plugin on. Thus the hooks of Shotgun run
// only in these projects. Claude Code does not load a marketplace from the project settings before the user trusts it,
// so the marketplace goes into the user settings. The other keys of the settings stay as they are. These functions use
// no VS Code API, so the unit tests can call them directly. src/mcp/claude.ts of DataFlow is the model for this code.

export const MARKETPLACE_NAME = 'shotgun-vscode';
export const PLUGIN_NAME = 'shotgun';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
// The plugin of DataFlow. Its MCP server has the tools of Shotgun
export const DATAFLOW_MARKETPLACE = 'dataflow-vscode';
export const DATAFLOW_PLUGIN_ID = `dataflow@${DATAFLOW_MARKETPLACE}`;

// The folder of Shotgun in the home folder. SHOTGUN_HOME moves it, for example for the tests
export const shotgunHome = (): string => process.env.SHOTGUN_HOME || path.join(os.homedir(), '.shotgun');
// The folder of the marketplace of Shotgun
export const marketplaceDir = (): string => path.join(shotgunHome(), 'claude');
// The folder of the settings of Claude Code. CLAUDE_CONFIG_DIR moves it
export const claudeConfigDir = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const userSettingsFile = (): string => path.join(claudeConfigDir(), 'settings.json');
// The local settings of a project. Git does not keep this file: Shotgun adds it to info/exclude
export const LOCAL_SETTINGS = '.claude/settings.local.json';
export const localSettingsFile = (folder: string): string => path.join(folder, ...LOCAL_SETTINGS.split('/'));

// connected: the plugin is on. disabled: the user turned the plugin off, or removed a part of the connection. none: no
// connection
export type Connection = 'connected' | 'disabled' | 'none';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// The settings as an object. No text gives an empty object, and text that is not a JSON object throws
export function parseSettings(text: string | undefined): Json {
	if (!text || text.trim() === '') {
		return {};
	}
	const value: unknown = JSON.parse(text);
	if (!isObject(value)) {
		throw new Error('The settings of Claude Code are not a JSON object.');
	}
	return value;
}

// The text of the settings with the indent and the line ends of the old text
export function formatSettings(settings: Json, old: string | undefined): string {
	const indent = old ? /\n([ \t]+)"/.exec(old)?.[1] ?? '  ' : '  ';
	const eol = old?.includes('\r\n') ? '\r\n' : '\n';
	const text = JSON.stringify(settings, null, indent).replace(/\n/g, eol);
	return old && !/\r?\n$/.test(old) ? text : text + eol;
}

// The settings without a key of an object. A key that has no other value then goes away. undefined: no change
function withoutKey(text: string | undefined, key: string, name: string): string | undefined {
	const settings = parseSettings(text);
	const values = settings[key];
	if (!isObject(values) || !(name in values)) {
		return undefined;
	}
	delete values[name];
	if (Object.keys(values).length === 0) {
		delete settings[key];
	}
	return formatSettings(settings, text);
}

// The path of the marketplace of Shotgun in the settings, if they declare it
export function marketplacePathOf(text: string | undefined): string | undefined {
	try {
		const markets = parseSettings(text).extraKnownMarketplaces;
		const market = isObject(markets) ? markets[MARKETPLACE_NAME] : undefined;
		const source = isObject(market) ? market.source : undefined;
		return isObject(source) && typeof source.path === 'string' ? source.path : undefined;
	} catch {
		return undefined;
	}
}

// The user settings with the marketplace of Shotgun in a local folder
export function withMarketplace(text: string | undefined, dir: string): string {
	const settings = parseSettings(text);
	const markets = isObject(settings.extraKnownMarketplaces) ? settings.extraKnownMarketplaces : {};
	markets[MARKETPLACE_NAME] = { source: { source: 'directory', path: dir } };
	settings.extraKnownMarketplaces = markets;
	return formatSettings(settings, text);
}

export const withoutMarketplace = (text: string | undefined): string | undefined => withoutKey(text, 'extraKnownMarketplaces', MARKETPLACE_NAME);

export function isPluginOn(text: string | undefined): boolean {
	try {
		const plugins = parseSettings(text).enabledPlugins;
		return isObject(plugins) && plugins[PLUGIN_ID] === true;
	} catch {
		return false;
	}
}

// The local settings of a project with the plugin of Shotgun on
export function withPlugin(text: string | undefined): string {
	const settings = parseSettings(text);
	const plugins = isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};
	plugins[PLUGIN_ID] = true;
	settings.enabledPlugins = plugins;
	return formatSettings(settings, text);
}

export const withoutPlugin = (text: string | undefined): string | undefined => withoutKey(text, 'enabledPlugins', PLUGIN_ID);

// The connection of DataFlow to Claude Code in the user settings, as DataFlow reads it
export function dataflowConnectionOf(text: string | undefined): Connection {
	let settings: Json;
	try {
		settings = parseSettings(text);
	} catch {
		return 'none';
	}
	const isDeclared = isObject(settings.extraKnownMarketplaces) && DATAFLOW_MARKETPLACE in settings.extraKnownMarketplaces;
	const enabled = isObject(settings.enabledPlugins) ? settings.enabledPlugins[DATAFLOW_PLUGIN_ID] : undefined;
	if (isDeclared && enabled === true) {
		return 'connected';
	}
	return isDeclared || enabled === false ? 'disabled' : 'none';
}

// True if the 2 paths are the same folder. Windows and macOS do not tell the case of letters apart
export function isSamePath(a: string, b: string): boolean {
	const x = path.resolve(a);
	const y = path.resolve(b);
	return process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
