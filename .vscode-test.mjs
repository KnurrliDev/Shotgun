import { defineConfig } from '@vscode/test-cli';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The "npm test" command reads this file. The "vscode-test" tool starts a test build of VS Code with Shotgun loaded,
// one time for each configuration. Then it runs the compiled Mocha tests that agree with the pattern of the
// configuration.
// - DataFlow is not in the Marketplace, so the tool does not install the extension dependencies. The tests load
//   DataFlow from its repository folder: the environment variable DATAFLOW_REPO, else ../DataFlow.
// - The tests use the test build of VS Code of DataFlow, if it is there. Else the tool downloads VS Code 1.146.0.
// - The files of Shotgun, the settings of Claude Code and the MCP registry of DataFlow go into the build folder, not
//   into the home folder of the user.
const root = import.meta.dirname;
const dataflow = path.resolve(process.env.DATAFLOW_REPO ?? path.join(root, '..', 'DataFlow'));
const hasDataFlow = existsSync(path.join(dataflow, 'out', 'extension.js'));
const testBuilds = path.join(dataflow, '.vscode-test');
const builds = existsSync(testBuilds)
	? readdirSync(testBuilds).filter((d) => d.startsWith('vscode-win32-x64-archive-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
	: [];
const code = builds.length > 0 ? path.join(testBuilds, builds[0], 'Code.exe') : undefined;

const common = {
	extensionDevelopmentPath: hasDataFlow ? [root, dataflow] : root,
	skipExtensionDependencies: true,
	...(code ? { useInstallation: { fromPath: code } } : { version: '1.146.0' }),
	launchArgs: ['--disable-workspace-trust'],
	mocha: { timeout: 60000 },
	env: {
		SHOTGUN_HOME: path.join(root, 'build', 'shotgun-home'),
		CLAUDE_CONFIG_DIR: path.join(root, 'build', 'claude-config'),
		DATAFLOW_MCP_REGISTRY: path.join(root, 'build', 'mcp-registry'),
	},
};

export default defineConfig([
	// Tests with no workspace
	{ label: 'unit', files: 'out/test/unit/**/*.test.js', ...common },
]);
