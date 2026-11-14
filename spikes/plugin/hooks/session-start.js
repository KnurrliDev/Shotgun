// The SessionStart hook of the spike. It reads .shotgun/active.json in the folder of the session, and gives the active
// task to Claude as context. It needs no VS Code window. VS Code runs it as Node.js, with ELECTRON_RUN_AS_NODE
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => {
	input += chunk;
});
process.stdin.on('end', () => {
	let cwd = process.cwd();
	try {
		cwd = JSON.parse(input).cwd || cwd;
	} catch {
		// no input: the folder of the process
	}
	let output = {};
	try {
		const active = JSON.parse(fs.readFileSync(path.join(cwd, '.shotgun', 'active.json'), 'utf8'));
		output = {
			hookSpecificOutput: {
				hookEventName: 'SessionStart',
				additionalContext: `Shotgun (from the SessionStart command hook): the active task is ${active.task}. Its stage is ${active.stage}.`,
			},
		};
	} catch {
		// no active task
	}
	process.stdout.write(JSON.stringify(output));
});
