import * as vscode from 'vscode';
import type { DataFlowApi, DataFlowExports } from './dataflow-api';
import { CLIENT, compareVersions, DATAFLOW_ID, MIN_DATAFLOW } from './version';

// The link to DataFlow. Shotgun needs the API of DataFlow 0.6.1 or a later version. extensionDependencies in
// package.json makes VS Code activate DataFlow before Shotgun.

export type DataFlowLink =
	| { readonly state: 'missing' }
	| { readonly state: 'old'; readonly version: string }
	| { readonly state: 'failed'; readonly version: string; readonly reason: string }
	| { readonly state: 'ready'; readonly version: string; readonly api: DataFlowApi };

export async function linkDataFlow(): Promise<DataFlowLink> {
	const extension = vscode.extensions.getExtension<DataFlowExports>(DATAFLOW_ID);
	if (!extension) {
		return { state: 'missing' };
	}
	const version = String(extension.packageJSON?.version ?? '0.0.0');
	if (compareVersions(version, MIN_DATAFLOW) < 0) {
		return { state: 'old', version };
	}
	try {
		const exports = await extension.activate();
		return { state: 'ready', version, api: exports.getApi(1, { client: CLIENT }) };
	} catch (error) {
		return { state: 'failed', version, reason: error instanceof Error ? error.message : String(error) };
	}
}
