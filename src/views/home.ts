import * as vscode from 'vscode';
import type { ClaudeState } from '../claude/connection';
import { isSamePath } from '../claude/settings';

// The sidebar of Shotgun in the activity bar, as the sidebar of DataFlow (decision 23): the tasks of the project, the
// page, the panel, the brief and the ledger, the guard, a folder to open, the recent projects, the connection to Claude
// Code and the log. homeItems and withRecent use no VS Code API, so the unit tests can call them directly.

export const HOME_ID = 'shotgun.home';
// The key of the recent projects in the global state of VS Code, for all windows
export const RECENT_KEY = 'shotgun.recentProjects';
export const MAX_RECENT = 10;

// An item of the sidebar: a command, or a group of items
export interface HomeItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly tooltip?: string;
	readonly icon: string; // the name of a codicon
	readonly command?: string;
	readonly arguments?: readonly unknown[];
	readonly children?: readonly HomeItem[];
}

export interface HomeTask {
	readonly id: string;
	readonly title: string;
	readonly stage: string; // the short form, as the stage chips of the panel, for example "2 Survey", or "done"
	readonly stageText: string; // the full form for the tooltip, for example "stage 2 of 5, the survey"
	readonly isActive: boolean;
	readonly isDone: boolean;
}

export interface Project {
	readonly name: string;
	readonly root: string;
}

export interface HomeState {
	readonly project?: Project; // the first folder of the workspace
	readonly tasks: readonly HomeTask[];
	readonly hasLedger: boolean; // the active task is in stage 5, or it is done
	readonly canReturn: boolean; // the active task can return to an earlier stage (decision 24)
	readonly isPaused: boolean;
	readonly claude: string; // the state of the connection to Claude Code, for example "connected"
	readonly recent: readonly Project[]; // the last projects with tasks of Shotgun, the last first
}

export const EMPTY_HOME: HomeState = { tasks: [], hasLedger: false, canReturn: false, isPaused: false, claude: '', recent: [] };

export function homeItems(state: HomeState): HomeItem[] {
	const { project } = state;
	const active = state.tasks.find((t) => t.isActive);
	const recent = state.recent.filter((p) => !project || !isSamePath(p.root, project.root));
	return [
		...(project ? [{
			id: 'newTask', label: 'New Task…', icon: 'add', command: 'shotgun.newTask', description: project.name,
			tooltip: `Make a task in ${project.name}, with its brief`,
		}] : []),
		...(state.tasks.length > 0 ? [{
			id: 'tasks', label: 'Tasks', icon: 'tasklist',
			children: state.tasks.map((t) => ({
				id: `task:${t.id}`, label: t.title, description: t.stage,
				tooltip: t.isActive ? `The active task: ${t.title}, ${t.stageText}` : `Make ${t.title} the active task: ${t.stageText}`,
				icon: t.isDone ? 'pass' : t.isActive ? 'circle-filled' : 'circle-outline',
				command: 'shotgun.openTask', arguments: [t.id],
			})),
		}] : []),
		...(active ? [
			{ id: 'showPage', label: 'Show Page', icon: 'open-preview', command: 'shotgun.showPage', tooltip: 'Open the page of the active task beside the text editor' },
			{ id: 'openBrief', label: 'Open Brief', icon: 'note', command: 'shotgun.openBrief', description: active.title },
			...(state.hasLedger ? [{ id: 'showLedger', label: 'Show the Ledger', icon: 'checklist', command: 'shotgun.showLedger' }] : []),
			...(state.canReturn ? [{
				id: 'returnToStage', label: 'Return to a Stage…', icon: 'arrow-left', command: 'shotgun.returnToStage', description: `from ${active.stage}`,
				tooltip: 'Return the active task to an earlier stage. The work of the later stages stays',
			}] : []),
			state.isPaused
				? { id: 'continue', label: 'Continue', icon: 'debug-continue', command: 'shotgun.continue', description: 'the guard is off' }
				: { id: 'pause', label: 'Pause', icon: 'debug-pause', command: 'shotgun.pause', description: 'the guard is on' },
		] : []),
		...(project ? [{ id: 'showPanel', label: 'Show Panel', icon: 'layout-sidebar-right', command: 'shotgun.showPanel', tooltip: 'Show the panel of Shotgun' }] : []),
		{
			id: 'openFolder', label: 'Open Project Folder…', icon: 'folder-opened', command: 'shotgun.openProjectFolder',
			tooltip: 'Open the folder of a project in this window. Shotgun keeps its tasks in the folder .shotgun of the project.',
		},
		...(recent.length > 0 ? [{
			id: 'recent', label: 'Recent Projects', icon: 'history',
			children: recent.map((p) => ({
				id: `recent:${p.root}`, label: p.name, description: p.root, tooltip: p.root, icon: 'folder', command: 'shotgun.openRecentProject', arguments: [p.root],
			})),
		}] : []),
		{
			id: 'claude', label: 'Claude Code', icon: 'plug', command: 'shotgun.connectClaude', ...(state.claude ? { description: state.claude } : {}),
			tooltip: 'Connect Shotgun to Claude Code: the plugin of Shotgun gives the guard and the context of the task to Claude',
		},
		{ id: 'log', label: 'Show Log', icon: 'output', command: 'shotgun.showLog' },
	];
}

// The state of the connection to Claude Code in a few words, as the setup of the panel tells it
export function claudeText(claude: Pick<ClaudeState, 'dataflow' | 'marketplace' | 'plugin'>, hasTask: boolean): string {
	if (claude.marketplace === 'none') {
		return 'not connected';
	}
	if (claude.marketplace === 'other') {
		return 'a different plugin folder';
	}
	if (hasTask && claude.plugin !== 'on') {
		return 'the plugin is off in this folder';
	}
	return claude.dataflow === 'connected' ? 'connected' : 'DataFlow is not connected';
}

// The recent projects with a project at the top, with no copy of it, and a maximum of MAX_RECENT
export function withRecent(recent: readonly Project[], project: Project): Project[] {
	return [project, ...recent.filter((p) => !isSamePath(p.root, project.root))].slice(0, MAX_RECENT);
}

// The recent projects from the global state. A wrong value gives no projects
export function parseRecent(value: unknown): Project[] {
	return Array.isArray(value)
		? value.filter((p): p is Project => typeof p?.name === 'string' && typeof p?.root === 'string').slice(0, MAX_RECENT)
		: [];
}

export class HomeView implements vscode.TreeDataProvider<HomeItem>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private state: HomeState = EMPTY_HOME;
	private key = '';

	// The view changes only when its state changes, because the extension updates its views often
	update(state: HomeState): void {
		const key = JSON.stringify(state);
		if (key !== this.key) {
			this.key = key;
			this.state = state;
			this.emitter.fire();
		}
	}

	getChildren(item?: HomeItem): HomeItem[] {
		return item ? [...(item.children ?? [])] : homeItems(this.state);
	}

	getTreeItem(item: HomeItem): vscode.TreeItem {
		const tree = new vscode.TreeItem(item.label, item.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
		tree.id = item.id;
		tree.description = item.description;
		tree.tooltip = item.tooltip;
		tree.iconPath = new vscode.ThemeIcon(item.icon);
		if (item.command) {
			tree.command = { command: item.command, title: item.label, ...(item.arguments ? { arguments: [...item.arguments] } : {}) };
		}
		return tree;
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
