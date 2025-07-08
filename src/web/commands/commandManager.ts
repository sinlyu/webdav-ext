/**
 * Command Manager
 * 
 * Centralized command registration and execution for WebDAV extension
 */

import * as vscode from 'vscode';

export interface Command {
	execute(...args: any[]): Promise<void> | void;
}

export class CommandManager {
	private commands = new Map<string, Command>();
	private registeredCommands: vscode.Disposable[] = [];

	/**
	 * Register a command with VS Code
	 */
	registerCommand(commandId: string, command: Command): vscode.Disposable {
		this.commands.set(commandId, command);
		
		const disposable = vscode.commands.registerCommand(commandId, (...args) => {
			return command.execute(...args);
		});
		
		this.registeredCommands.push(disposable);
		return disposable;
	}

	/**
	 * Execute a command programmatically
	 */
	async executeCommand(commandId: string, ...args: any[]): Promise<void> {
		const command = this.commands.get(commandId);
		if (!command) {
			throw new Error(`Command ${commandId} not found`);
		}
		
		return command.execute(...args);
	}

	/**
	 * Check if a command is registered
	 */
	hasCommand(commandId: string): boolean {
		return this.commands.has(commandId);
	}

	/**
	 * Get all registered command IDs
	 */
	getRegisteredCommands(): string[] {
		return Array.from(this.commands.keys());
	}

	/**
	 * Dispose all registered commands
	 */
	dispose(): void {
		this.registeredCommands.forEach(disposable => disposable.dispose());
		this.registeredCommands = [];
		this.commands.clear();
	}
}