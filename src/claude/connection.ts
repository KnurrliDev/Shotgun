import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readText, SHOTGUN_DIR, writeTextAtomic } from '../session/files';
import { excludeFromGit } from './git';
import { pluginFiles, readSkills, removePlugin, writePlugin } from './plugin';
import {
	Connection, dataflowConnectionOf, isPluginOn, isSamePath, LOCAL_SETTINGS, localSettingsFile, marketplaceDir, marketplacePathOf,
	userSettingsFile, withMarketplace, withoutMarketplace, withoutPlugin, withPlugin,
} from './settings';

// The connection of Shotgun to Claude Code (proposal P15). Connect writes the plugin folder, adds the marketplace to
// the user settings of Claude Code, and turns the plugin on in the local settings of each workspace folder with a
// Shotgun task. Disconnect removes these settings and the plugin folder. Shotgun remembers the folders, so a disconnect
// also changes the folders that are not open.

export interface ClaudeState {
	readonly dataflow: Connection; // the plugin of DataFlow in the user settings. Its MCP server has the tools of Shotgun
	readonly marketplace: 'ok' | 'none' | 'other'; // the marketplace of Shotgun in the user settings. other: a different folder
	readonly plugin: 'on' | 'off'; // the plugin of Shotgun in the local settings of the folder
}

const FOLDERS_KEY = 'shotgun.claudeFolders';

export class ClaudeConnection {
	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {}

	// The state of the connection for a workspace folder
	state(folder: string | undefined): ClaudeState {
		const user = readText(userSettingsFile());
		const market = marketplacePathOf(user);
		return {
			dataflow: dataflowConnectionOf(user),
			marketplace: market === undefined ? 'none' : isSamePath(market, marketplaceDir()) ? 'ok' : 'other',
			plugin: folder && isPluginOn(readText(localSettingsFile(folder))) ? 'on' : 'off',
		};
	}

	// The command "Shotgun: Connect to Claude Code". The result: the folders that have the plugin on now
	connect(folders: readonly string[]): string[] {
		this.writePluginFiles();
		const file = userSettingsFile();
		writeTextAtomic(file, withMarketplace(readText(file), marketplaceDir()));
		this.log.info(`The user settings of Claude Code have the marketplace of Shotgun: ${file}`);
		const withTask = folders.filter((f) => existsSync(path.join(f, SHOTGUN_DIR)));
		withTask.forEach((f) => this.turnOn(f));
		return withTask;
	}

	// Turns the plugin of Shotgun on in the local settings of a folder, and adds the file to info/exclude of git
	turnOn(folder: string): void {
		const file = localSettingsFile(folder);
		const old = readText(file);
		if (!isPluginOn(old)) {
			writeTextAtomic(file, withPlugin(old));
			this.log.info(`The plugin of Shotgun is on in ${file}`);
		}
		if (excludeFromGit(folder, LOCAL_SETTINGS)) {
			this.log.info(`Git does not show ${LOCAL_SETTINGS} of ${folder} now: info/exclude has it.`);
		}
		const known = this.folders();
		if (!known.some((f) => isSamePath(f, folder))) {
			void this.context.globalState.update(FOLDERS_KEY, [...known, folder]);
		}
	}

	// The command "Shotgun: Disconnect from Claude Code". The result: the number of changed folders
	disconnect(folders: readonly string[]): number {
		const file = userSettingsFile();
		const user = withoutMarketplace(readText(file));
		if (user !== undefined) {
			writeTextAtomic(file, user);
		}
		let count = 0;
		const all = [...this.folders(), ...folders].filter((f, i, list) => list.findIndex((g) => isSamePath(f, g)) === i);
		for (const folder of all) {
			const local = localSettingsFile(folder);
			try {
				const text = withoutPlugin(readText(local));
				if (text !== undefined) {
					writeTextAtomic(local, text);
					count += 1;
				}
			} catch (error) {
				this.log.warn(`Shotgun did not change ${local}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		void this.context.globalState.update(FOLDERS_KEY, []);
		removePlugin(marketplaceDir());
		return count;
	}

	// At the start: a connected Shotgun writes the plugin files of its version. A new version can have new hooks
	refresh(): void {
		if (this.state(undefined).marketplace === 'ok') {
			this.writePluginFiles();
		}
	}

	private folders(): string[] {
		return this.context.globalState.get<string[]>(FOLDERS_KEY, []);
	}

	private writePluginFiles(): void {
		const version = String(this.context.extension.packageJSON.version);
		const changes = writePlugin(marketplaceDir(), pluginFiles(version, readSkills(this.context.extensionPath)));
		if (changes > 0) {
			this.log.info(`Shotgun wrote ${changes} files of its plugin into ${marketplaceDir()}.`);
		}
	}
}
