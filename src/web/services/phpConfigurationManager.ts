/**
 * PHP Configuration Manager
 * 
 * Handles PHP-specific configuration updates for various PHP extensions
 * including PHP Tools (DEVSENSE), Intelephense, and standard php.stubs
 */

import * as vscode from 'vscode';
import { createChildLogger, ChildLogger } from '../utils/logger';

export class PHPConfigurationManager {
	private logger: ChildLogger;

	constructor() {
		this.logger = createChildLogger('PHPConfig');
	}

	/**
	 * Update PHP Tools workspace.includePath with all PHP directories
	 */
	async updateWorkspaceIncludePath(allPhpFiles: string[]): Promise<void> {
		try {
			// Create unique directories containing PHP files
			const phpDirectories = this.extractPhpDirectories(allPhpFiles);
			
			// Add stubs directory
			phpDirectories.add('.stubs');
			
			// Get current workspace.includePath - handle both array and string formats
			const phpConfig = vscode.workspace.getConfiguration('php');
			const currentIncludePaths = this.getCurrentIncludePaths(phpConfig);
			
			// Merge with existing paths
			const newIncludePaths = new Set([...currentIncludePaths]);
			phpDirectories.forEach(dir => newIncludePaths.add(dir));
			
			// Convert to semicolon-separated string as required by PHP Tools
			const finalIncludePaths = Array.from(newIncludePaths).filter(p => p.trim()).join(';');
			
			await phpConfig.update('workspace.includePath', finalIncludePaths, vscode.ConfigurationTarget.Workspace);
			
			this.logger.info('Updated PHP Tools workspace.includePath', { 
				includePath: finalIncludePaths,
				phpDirectoryCount: phpDirectories.size,
				totalPhpFiles: allPhpFiles.length,
				allDirectories: Array.from(phpDirectories)
			});
		} catch (error: any) {
			this.logger.error('Failed to update PHP Tools workspace.includePath', { error: error.message });
			throw error;
		}
	}

	/**
	 * Configure PHP stubs for autocompletion
	 */
	async configurePhpStubs(stubPath: string): Promise<void> {
		try {
			const phpConfig = vscode.workspace.getConfiguration('php');
			const currentStubs = phpConfig.get('stubs', []) as string[];
			
			// Ensure "*" is included (default stubs)
			const newStubs = [...new Set([...currentStubs, '*', stubPath])];
			
			await phpConfig.update('stubs', newStubs, vscode.ConfigurationTarget.Workspace);
			
			this.logger.info('Updated PHP stubs configuration', { 
				stubPath,
				allStubs: newStubs
			});
		} catch (error: any) {
			this.logger.error('Failed to update PHP stubs configuration', { error: error.message });
			throw error;
		}
	}

	/**
	 * Configure Intelephense include paths
	 */
	async configureIntelephense(allPhpFiles: string[]): Promise<void> {
		try {
			const intelephenseConfig = vscode.workspace.getConfiguration('intelephense');
			if (!intelephenseConfig) {
				this.logger.debug('Intelephense configuration not available');
				return;
			}

			// Extract PHP directories and add stubs
			const phpDirectories = this.extractPhpDirectories(allPhpFiles);
			phpDirectories.add('.stubs');

			// Add directories to environment.includePaths
			const includePaths = intelephenseConfig.get('environment.includePaths', []) as string[];
			const newIncludePaths = [...new Set([...includePaths, ...Array.from(phpDirectories)])];

			await intelephenseConfig.update('environment.includePaths', newIncludePaths, vscode.ConfigurationTarget.Workspace);

			this.logger.info('Updated Intelephense include paths', { 
				includePaths: newIncludePaths,
				phpDirectoryCount: phpDirectories.size
			});
		} catch (error: any) {
			this.logger.warn('Failed to update Intelephense include paths', { error: error.message });
			// Don't throw - Intelephense might not be installed
		}
	}

	/**
	 * Configure all PHP extensions with comprehensive settings
	 */
	async configureAllPhpExtensions(allPhpFiles: string[], stubPath: string): Promise<void> {
		try {
			await Promise.all([
				this.updateWorkspaceIncludePath(allPhpFiles),
				this.configurePhpStubs(stubPath),
				this.configureIntelephense(allPhpFiles)
			]);

			this.logger.info('Successfully configured all PHP extensions', {
				totalPhpFiles: allPhpFiles.length,
				stubPath
			});
		} catch (error: any) {
			this.logger.error('Failed to configure PHP extensions', { error: error.message });
			throw error;
		}
	}

	/**
	 * Extract unique directories from PHP file paths
	 */
	private extractPhpDirectories(allPhpFiles: string[]): Set<string> {
		const phpDirectories = new Set<string>();
		
		allPhpFiles.forEach(file => {
			const dir = file.substring(0, file.lastIndexOf('/'));
			if (dir && dir !== '.' && dir !== '') {
				phpDirectories.add(dir.startsWith('/') ? dir.substring(1) : dir);
			}
		});
		
		return phpDirectories;
	}

	/**
	 * Get current include paths from PHP configuration, handling both string and array formats
	 */
	private getCurrentIncludePaths(phpConfig: vscode.WorkspaceConfiguration): string[] {
		const currentConfig = phpConfig.get('workspace.includePath', [] as any);
		
		if (Array.isArray(currentConfig)) {
			return currentConfig;
		} else if (typeof currentConfig === 'string') {
			return currentConfig.split(';').filter((p: string) => p.trim());
		}
		
		return [];
	}
}