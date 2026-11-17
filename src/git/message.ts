import * as vscode from 'vscode';
import * as path from 'path';
import { isInside } from '../session/paths';

// The commit message of the user: the input box of the repository in Source Control, from the API of the Git extension
// of VS Code (P11). Shotgun only reads the message. It makes no commit and changes no message.

// The parts of the API of the Git extension that Shotgun uses
interface GitChange {
	readonly uri: vscode.Uri;
	readonly status: number;
}

interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: { readonly value: string };
	readonly state: {
		readonly HEAD?: { readonly commit?: string };
		readonly indexChanges: readonly GitChange[];
		readonly workingTreeChanges: readonly GitChange[];
	};
}

interface GitExtension {
	getAPI(version: 1): { readonly repositories: readonly GitRepository[] };
}

// The commit message, the folder of the repository, and its changed files with their state
export interface CommitMessage {
	readonly message: string;
	readonly repository: string;
	readonly files: readonly { readonly file: string; readonly status: string }[];
}

// The status of a change in the API of the Git extension
const STATUS: Readonly<Record<number, string>> = {
	0: 'modified, staged', 1: 'added, staged', 2: 'deleted, staged', 3: 'renamed, staged', 4: 'copied, staged',
	5: 'modified', 6: 'deleted', 7: 'untracked', 9: 'added',
};

// The repository of the first folder of the project: the repository with the deepest folder that contains it
function repositoryOf(root: string): GitRepository | undefined {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension?.isActive) {
		return undefined;
	}
	const repositories = extension.exports.getAPI(1).repositories.filter((r) => isInside(root, r.rootUri.fsPath));
	return repositories.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}

// The commit of HEAD and the files with changes that are not committed, relative to the first folder of the project:
// the base of the task at the gate "Accept the plan" (P17). undefined: no repository, or the Git extension of VS Code
// is off. The files of Shotgun are not in the list
export function headOf(root: string): { readonly commit?: string; readonly dirty: readonly string[] } | undefined {
	const repository = repositoryOf(root);
	if (!repository) {
		return undefined;
	}
	const dirty = new Set<string>();
	for (const change of [...repository.state.indexChanges, ...repository.state.workingTreeChanges]) {
		const file = path.relative(root, change.uri.fsPath).split(path.sep).join('/');
		if (file && !file.startsWith('..') && !file.startsWith('.shotgun/')) {
			dirty.add(file);
		}
	}
	const commit = repository.state.HEAD?.commit;
	return { ...(commit ? { commit } : {}), dirty: [...dirty].sort() };
}

// The commit message of the project. undefined: no repository, or the Git extension of VS Code is off
export function commitMessage(root: string): CommitMessage | undefined {
	const repository = repositoryOf(root);
	if (!repository) {
		return undefined;
	}
	const base = repository.rootUri.fsPath;
	const files = new Map<string, string>();
	for (const change of [...repository.state.indexChanges, ...repository.state.workingTreeChanges]) {
		const file = vscode.workspace.asRelativePath(change.uri, false);
		if (!files.has(file) && !file.startsWith('.shotgun/')) {
			files.set(file, STATUS[change.status] ?? 'changed');
		}
	}
	return { message: repository.inputBox.value, repository: base, files: [...files].map(([file, status]) => ({ file, status })) };
}
