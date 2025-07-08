/**
 * Show Debug Command
 * 
 * Shows the WebDAV debug output channel
 */

import * as vscode from 'vscode';
import { Command } from './commandManager';

export class ShowDebugCommand implements Command {
	constructor(private debugOutput: vscode.OutputChannel) {}

	execute(): void {
		this.debugOutput.show();
	}
}