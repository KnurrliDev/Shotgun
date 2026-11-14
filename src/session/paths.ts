import * as path from 'path';

// The paths of the project. These functions use no VS Code API.

// File systems of Windows and macOS do not tell the case of letters apart
export const IS_CASE_SENSITIVE = process.platform !== 'win32' && process.platform !== 'darwin';

// True if file is folder or a file in folder
export function isInside(file: string, folder: string, isCaseSensitive = IS_CASE_SENSITIVE): boolean {
	const a = isCaseSensitive ? file : file.toLowerCase();
	const b = isCaseSensitive ? folder : folder.toLowerCase();
	const rel = path.relative(b, a);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The path of a file for the stage files: relative to the first folder of the project with /, else absolute
export function projectPath(file: string, root: string, isCaseSensitive = IS_CASE_SENSITIVE): string {
	return isInside(file, root, isCaseSensitive) ? path.relative(root, file).split(path.sep).join('/') : file;
}

// The absolute path of a path of the stage files
export const absolutePath = (file: string, root: string): string => path.resolve(root, file);

// The files with C or C++ code. DataFlow has facts only for them
const CPP = /\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|inl|ipp|tpp|ixx|cppm)$/i;
export const isCppFile = (file: string): boolean => CPP.test(file);
