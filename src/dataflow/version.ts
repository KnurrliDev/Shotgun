// The version that Shotgun needs from DataFlow. This file uses no VS Code API, so the unit tests can call it directly.

export const DATAFLOW_ID = 'KnurrliDev.dataflow';
// DataFlow 0.6.1 has registerTools, the marks, the facts of the heat, and the fixes of the second gap list (decision 20)
export const MIN_DATAFLOW = '0.6.1';
// The name of Shotgun in DataFlow. The MCP names of the tools of Shotgun start with "shotgun_"
export const CLIENT = 'Shotgun';

// Compares 2 versions part by part, for example 0.10.0 is after 0.6.0. A pre-release part after - does not count
export function compareVersions(a: string, b: string): number {
	const parts = (version: string) => version.split('-')[0].split('.').map((p) => Number.parseInt(p, 10) || 0);
	const x = parts(a);
	const y = parts(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const difference = (x[i] ?? 0) - (y[i] ?? 0);
		if (difference !== 0) {
			return Math.sign(difference);
		}
	}
	return 0;
}
