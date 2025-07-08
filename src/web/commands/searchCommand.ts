import * as vscode from 'vscode';
import { Command } from './commandManager';
import { WebDAVCustomSearchProvider } from '../providers/customSearchProvider';

export class SearchFilesCommand implements Command {
	constructor(
		private customSearchProvider: WebDAVCustomSearchProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Search files command triggered');
		await this.customSearchProvider.showFileSearchQuickPick();
	}
}

export class SearchTextCommand implements Command {
	constructor(
		private customSearchProvider: WebDAVCustomSearchProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Search text command triggered');
		await this.customSearchProvider.showTextSearchQuickPick();
	}
}

export class SearchSymbolsCommand implements Command {
	constructor(
		private customSearchProvider: WebDAVCustomSearchProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Search symbols command triggered');
		await this.customSearchProvider.showSymbolSearchQuickPick();
	}
}