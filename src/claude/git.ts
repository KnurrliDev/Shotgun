import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { readText } from '../session/files';

// Adds a file of a folder to the file info/exclude of its git repository, so that git does not show the file. Only this
// clone of the repository has the change. file: a path relative to the folder, with / between the parts. The result:
// true if the file is new in info/exclude. With no git, or with no repository, nothing changes
export function excludeFromGit(folder: string, file: string): boolean {
	let excludeFile: string;
	let prefix: string;
	try {
		// the path of info/exclude, then the path of the folder in the repository, for example "src/" or an empty line
		const out = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude', '--show-prefix'], {
			cwd: folder, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
		});
		const [gitPath, showPrefix = ''] = out.split(/\r?\n/);
		if (!gitPath.trim()) {
			return false;
		}
		excludeFile = path.resolve(folder, gitPath.trim());
		prefix = showPrefix.trim();
	} catch {
		return false;
	}
	const pattern = `/${prefix}${file}`;
	const old = readText(excludeFile) ?? '';
	if (old.split(/\r?\n/).some((line) => line.trim() === pattern)) {
		return false;
	}
	mkdirSync(path.dirname(excludeFile), { recursive: true });
	appendFileSync(excludeFile, `${old && !old.endsWith('\n') ? '\n' : ''}# Shotgun: the local settings of Claude Code\n${pattern}\n`);
	return true;
}
