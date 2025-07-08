/**
 * Logger Utility
 * 
 * Centralized logging system for the WebDAV extension with multiple log levels
 * and configurable output channels
 */

import * as vscode from 'vscode';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3
}

export interface LogEntry {
	level: LogLevel;
	message: string;
	data?: any;
	timestamp: Date;
	category?: string;
}

export class Logger {
	private static instance: Logger;
	private outputChannel: vscode.OutputChannel;
	private logLevel: LogLevel = LogLevel.DEBUG;
	private enableConsoleOutput: boolean = false;

	private constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
	}

	/**
	 * Initialize the logger singleton
	 */
	static initialize(outputChannel: vscode.OutputChannel): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger(outputChannel);
		}
		return Logger.instance;
	}

	/**
	 * Get the logger instance
	 */
	static getInstance(): Logger {
		if (!Logger.instance) {
			throw new Error('Logger not initialized. Call Logger.initialize() first.');
		}
		return Logger.instance;
	}

	/**
	 * Set the minimum log level
	 */
	setLogLevel(level: LogLevel): void {
		this.logLevel = level;
		this.debug('Log level changed', { level: LogLevel[level] });
	}

	/**
	 * Enable/disable console output
	 */
	setConsoleOutput(enabled: boolean): void {
		this.enableConsoleOutput = enabled;
	}

	/**
	 * Log a debug message
	 */
	debug(message: string, data?: any, category?: string): void {
		this.log(LogLevel.DEBUG, message, data, category);
	}

	/**
	 * Log an info message
	 */
	info(message: string, data?: any, category?: string): void {
		this.log(LogLevel.INFO, message, data, category);
	}

	/**
	 * Log a warning message
	 */
	warn(message: string, data?: any, category?: string): void {
		this.log(LogLevel.WARN, message, data, category);
	}

	/**
	 * Log an error message
	 */
	error(message: string, data?: any, category?: string): void {
		this.log(LogLevel.ERROR, message, data, category);
	}

	/**
	 * Log an error with exception details
	 */
	exception(message: string, error: Error, data?: any, category?: string): void {
		this.log(LogLevel.ERROR, message, {
			...data,
			error: {
				message: error.message,
				name: error.name,
				stack: error.stack
			}
		}, category);
	}

	/**
	 * Create a child logger with a specific category
	 */
	createChild(category: string): ChildLogger {
		return new ChildLogger(this, category);
	}

	/**
	 * Show the output channel
	 */
	show(): void {
		this.outputChannel.show();
	}

	/**
	 * Clear the output channel
	 */
	clear(): void {
		this.outputChannel.clear();
	}

	/**
	 * Internal log method
	 */
	private log(level: LogLevel, message: string, data?: any, category?: string): void {
		if (level < this.logLevel) {
			return;
		}

		const entry: LogEntry = {
			level,
			message,
			data,
			timestamp: new Date(),
			category
		};

		this.writeToOutput(entry);
		
		if (this.enableConsoleOutput) {
			this.writeToConsole(entry);
		}
	}

	/**
	 * Write log entry to VS Code output channel
	 */
	private writeToOutput(entry: LogEntry): void {
		const timestamp = entry.timestamp.toISOString();
		const levelStr = LogLevel[entry.level].padEnd(5);
		const categoryStr = entry.category ? `[${entry.category}] ` : '';
		const dataStr = entry.data ? ` - ${JSON.stringify(entry.data)}` : '';
		
		const logLine = `[${timestamp}] ${levelStr} ${categoryStr}${entry.message}${dataStr}`;
		this.outputChannel.appendLine(logLine);
	}

	/**
	 * Write log entry to console
	 */
	private writeToConsole(entry: LogEntry): void {
		const categoryStr = entry.category ? `[${entry.category}] ` : '';
		const logMessage = `${categoryStr}${entry.message}`;
		
		switch (entry.level) {
			case LogLevel.DEBUG:
				console.debug(logMessage, entry.data);
				break;
			case LogLevel.INFO:
				console.info(logMessage, entry.data);
				break;
			case LogLevel.WARN:
				console.warn(logMessage, entry.data);
				break;
			case LogLevel.ERROR:
				console.error(logMessage, entry.data);
				break;
		}
	}
}

/**
 * Child logger that automatically includes a category
 */
export class ChildLogger {
	constructor(private parent: Logger, private category: string) {}

	debug(message: string, data?: any): void {
		this.parent.debug(message, data, this.category);
	}

	info(message: string, data?: any): void {
		this.parent.info(message, data, this.category);
	}

	warn(message: string, data?: any): void {
		this.parent.warn(message, data, this.category);
	}

	error(message: string, data?: any): void {
		this.parent.error(message, data, this.category);
	}

	exception(message: string, error: Error, data?: any): void {
		this.parent.exception(message, error, data, this.category);
	}
}

/**
 * Utility functions for getting loggers
 */
export function getLogger(): Logger {
	return Logger.getInstance();
}

export function createChildLogger(category: string): ChildLogger {
	return Logger.getInstance().createChild(category);
}