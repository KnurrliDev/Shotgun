import type { DiffFacts, MemberSitesFacts, OutlineFacts, RippleFacts } from '../dataflow/dataflow-api';
import { LooseFind, memberEnds, newMembers, rippleEnds, switchEnds } from '../session/loose';
import { absolutePath, IS_CASE_SENSITIVE, isCppFile, projectPath } from '../session/paths';

// The loose ends of a step at its gate (phase 9), from the facts of DataFlow: the functions that use most data members of
// a type with a new member, the switch statements that do not handle a new enumerator, and the callers that the changes
// reach. The gate deletes the base of the step, so Shotgun finds the loose ends before.

// The facts of DataFlow for the loose ends. The extension makes it from the API of DataFlow, and a test can fake it.
// scan: a new scan of the call graph and the wait for its end. false: the scan did not end in time. line: a line with
// the name of the type, for example "struct Settings {"
export interface LooseApi {
	readonly scan: () => Promise<boolean>;
	readonly outline: (file: string, line: number) => Promise<Pick<OutlineFacts, 'type' | 'members'>>;
	readonly memberSites: (file: string, line: number) => Promise<MemberSitesFacts>;
	readonly ripple: (base: string, paths: readonly string[]) => Promise<RippleFacts>;
}

// The maximum number of hunks that Shotgun asks DataFlow about new members for 1 step
const MAX_DECLARATION_HUNKS = 10;
// The maximum number of added lines of a hunk that the scan for the head of a type starts from
const MAX_SCAN_STARTS = 50;
// The maximum number of types of 1 hunk
const MAX_TYPES_OF_HUNK = 3;
// The maximum number of lines that the scan for the head of a type goes up
const MAX_SCAN_LINES = 3000;
// The maximum number of lines of the head of a block, for example "class Foo", ": public Base" and "{"
const MAX_HEAD_LINES = 4;
// The head of a class, a struct, a union or an enum. Words in capitals before the name can be macros, for example the
// export macro of a library
const TYPE_HEAD = /\b(?:class|struct|union|enum(?:\s+(?:class|struct))?)\s+(?:\[\[[^\]]*\]\]\s*)?(?:[A-Z][A-Z0-9_]*\s+)*[A-Za-z_]\w*/;
const TEMPLATE_HEAD = /\btemplate\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>/g;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The added lines of a hunk, from its diff in the format of DataFlow, for example "+  155 |   int planning_cycles = 0;"
export function addedLines(diff: string | undefined): { line: number; text: string }[] {
	return (diff ?? '').split('\n').flatMap((l) => {
		const m = /^\+\s*(\d+) \|(.*)$/.exec(l);
		return m ? [{ line: Number(m[1]), text: m[2].replace(/^ /, '') }] : [];
	});
}

// The hunks of C or C++ files with added lines, with the numbers of the added lines: such a hunk can declare a data
// member or an enumerator. A hunk with no function or with only new functions comes first, because a hunk in the body of
// an old function seldom declares a member. The files are relative to the first folder of the project
export function declarationHunks(diff: DiffFacts, root: string): { file: string; lines: number[] }[] {
	const first: { file: string; lines: number[] }[] = [];
	const last: { file: string; lines: number[] }[] = [];
	for (const f of diff.files) {
		const file = projectPath(absolutePath(f.file, diff.root), root, IS_CASE_SENSITIVE);
		if (!isCppFile(file)) {
			continue;
		}
		for (const h of f.hunks) {
			const lines = addedLines(h.diff).map((a) => a.line);
			if (lines.length > 0) {
				const isOld = (h.functions ?? []).some((fn) => !(h.newFunctions ?? []).includes(fn));
				(isOld ? last : first).push({ file, lines });
			}
		}
	}
	return [...first, ...last].slice(0, MAX_DECLARATION_HUNKS);
}

// The code of a line with no comment and no string, because a brace in a comment or in a string does not count
function codeOf(line: string | undefined): string {
	return (line ?? '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').replace(/\/\*.*?\*\//g, ' ').replace(/\/\/.*$/, '');
}

// The line of the head of the class, the struct, the union or the enum around a line, from the text of the file: a line
// with the name of the type, for DataFlow. The scan goes up from the line before the line, and counts the braces.
// undefined: the innermost block around the line is not a type, for example a function or a namespace
export function typeHeadLine(lines: readonly string[], line: number): number | undefined {
	let depth = 0;
	for (let i = line - 2; i >= 0 && i >= line - 1 - MAX_SCAN_LINES; i--) {
		const code = codeOf(lines[i]);
		for (let c = code.length - 1; c >= 0; c--) {
			if (code[c] === '}') {
				depth++;
			} else if (code[c] === '{' && depth > 0) {
				depth--;
			} else if (code[c] === '{') {
				// the open brace of the innermost block around the line. Its head ends at the brace, and starts after the
				// end of a statement or of a block
				let head = '';
				for (let j = i; j >= 0 && j > i - MAX_HEAD_LINES; j--) {
					const text = j === i ? code.slice(0, c) : codeOf(lines[j]);
					const end = Math.max(text.lastIndexOf(';'), text.lastIndexOf('{'), text.lastIndexOf('}'));
					head = `${text.slice(end + 1)} ${head}`;
					if (TYPE_HEAD.test(head.replace(TEMPLATE_HEAD, ' '))) {
						return j + 1;
					}
					if (end >= 0) {
						return undefined;
					}
				}
				return undefined;
			}
		}
	}
	return undefined;
}

// The loose ends of a step from the diff since its base. log: a note for the log of Shotgun, for example a failure of
// DataFlow. readLines: the lines of a file now, for the heads of the types and for the code of each place
export async function findLooseEnds(api: LooseApi, root: string, base: string, scope: readonly string[], diff: DiffFacts,
	readLines: (file: string) => readonly string[] | undefined, log: (message: string) => void): Promise<LooseFind[]> {
	const rel = (file: string) => projectPath(absolutePath(file, root), root, IS_CASE_SENSITIVE);
	const finds: LooseFind[] = [];

	// the index of the call graph does not see the changes that Claude Code or the user wrote on the disk. Thus a new scan
	// comes first. An old index gives false loose ends of the new members
	let isScanned = false;
	try {
		isScanned = await api.scan();
		if (!isScanned) {
			log('DataFlow did not end the scan of the call graph in time.');
		}
	} catch (error) {
		log(`DataFlow did not scan the call graph: ${messageOf(error)}`);
	}

	// the new data members and the new enumerators. DataFlow finds a type by a line with its name, so Shotgun finds the
	// head of the type around the added lines first. Then the outline of the type gives the line of each member
	for (const hunk of declarationHunks(diff, root)) {
		const file = absolutePath(hunk.file, root);
		const text = readLines(file) ?? [];
		const starts = hunk.lines.filter((l) => codeOf(text[l - 1]).trim()).slice(0, MAX_SCAN_STARTS);
		const heads = [...new Set(starts.flatMap((l) => typeHeadLine(text, l) ?? []))].slice(0, MAX_TYPES_OF_HUNK);
		for (const head of heads) {
			let outline: Pick<OutlineFacts, 'type' | 'members'>;
			try {
				outline = await api.outline(file, head);
			} catch (error) {
				log(`DataFlow gave no outline of the type on line ${head} of ${hunk.file}: ${messageOf(error)}`);
				continue;
			}
			const fresh = newMembers(outline.members, hunk.lines);
			if (fresh.fields.length + fresh.enumerators.length === 0) {
				continue;
			}
			if (!isScanned) {
				log(`Shotgun did not get the member sites of ${outline.type}, because the index of the call graph of DataFlow can be old.`);
				continue;
			}
			let sites: MemberSitesFacts;
			try {
				sites = await api.memberSites(file, head);
			} catch (error) {
				log(`DataFlow gave no member sites of ${outline.type}: ${messageOf(error)}`);
				continue;
			}
			if (!sites.isReachComplete) {
				log(`DataFlow gave no member sites of ${sites.type}, because the scan of the call graph is not complete.`);
				continue;
			}
			for (const member of fresh.fields.filter((m) => (sites.members ?? []).includes(m))) {
				finds.push(...memberEnds(sites, member, rel));
			}
			for (const enumerator of fresh.enumerators.filter((e) => (sites.enumerators ?? []).includes(e))) {
				finds.push(...switchEnds(sites, enumerator, rel));
			}
		}
	}

	// the callers that the changes reach
	const changed = new Map<string, [number, number][]>();
	for (const f of diff.files) {
		changed.set(projectPath(absolutePath(f.file, diff.root), root, IS_CASE_SENSITIVE).toLowerCase(), f.hunks.map((h) => [h.lines[0], h.lines[1]]));
	}
	const isChanged = (file: string, line: number) => (changed.get(file.toLowerCase()) ?? []).some(([a, b]) => line >= a && line <= b);
	try {
		const ripple = await api.ripple(`mark:${base}`, scope.map((f) => absolutePath(f, root)));
		if (ripple.state === 'ready') {
			finds.push(...rippleEnds(ripple, rel, isChanged));
		} else {
			log(`DataFlow gave no ripple of the changes: ${ripple.message ?? ripple.state}`);
		}
	} catch (error) {
		log(`DataFlow gave no ripple of the changes: ${messageOf(error)}`);
	}

	// the code of each place, so that the place moves with its code
	return finds.map((f) => {
		const code = f.file && f.lines ? readLines(absolutePath(f.file, root))?.[f.lines[0] - 1]?.trim() : undefined;
		return code ? { ...f, code } : f;
	});
}
