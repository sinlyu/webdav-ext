import * as vscode from 'vscode';

export function createDebugLogger(debugOutput: vscode.OutputChannel) {
	return function debugLog(message: string, data?: any) {
		const timestamp = new Date().toISOString();
		const dataStr = data ? ` - ${JSON.stringify(data)}` : '';
		debugOutput.appendLine(`[${timestamp}] ${message}${dataStr}`);
	};
}