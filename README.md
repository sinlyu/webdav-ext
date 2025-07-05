# edoc Automate WebDAV Extension for VS Code

Professional WebDAV integration for edoc Automate development with intelligent search, file indexing, and PHP IntelliSense. Navigate through edoc Automate apps and WebDAV resources directly within VS Code with comprehensive development features.

## ✨ Features

### 🚀 **PHP Development & IntelliSense**
- **Go to Definition**: Navigate to PHP function and class definitions across your edoc Automate project
- **PHP IntelliSense**: Enhanced autocompletion with edoc Automate plugin API stubs
- **AST-Based Analysis**: Advanced PHP parsing for accurate code navigation
- **Automatic Stub Generation**: Plugin API stubs are automatically created for comprehensive autocompletion
- **PHP Tools Integration**: Seamless integration with PHP Tools extension for enhanced development experience
- **Workspace Configuration**: Automatic PHP include path configuration for optimal IntelliSense

### 🔍 **Powerful Search Integration**
- **Lightning-Fast Performance**: Intelligent file indexing system provides instant search results
  - Automatic file indexing on connection for sub-second file name searches
  - Real-time index updates as files are created, modified, or deleted
  - Smart fallback to directory traversal when needed
- **Full VS Code Search Support**: Search through all files in your WebDAV workspace using VS Code's built-in search (Ctrl+Shift+F)
- **File Name Search**: Find files using glob patterns (e.g., `*.js`, `**/*.md`)
- **Content Search**: Search within text files with support for:
  - Plain text and regex patterns
  - Case-sensitive and case-insensitive search
  - Multiple file types including PHP (.php, .phtml, .inc), JavaScript (.js, .ts), web files (.html, .css, .json), and many more
- **Smart Exclusions**: Automatically excludes common directories (`.git`, `node_modules`, `dist`, `build`, etc.)
- **Live Results**: Real-time search results with match highlighting and preview

### 📁 **Complete File System Support**
- **File Operations**: Create, read, edit, delete, and rename files and folders
- **Directory Navigation**: Browse edoc Automate project structures seamlessly
- **VS Code Integration**: Full integration with VS Code's file explorer and editor
- **Virtual Files**: Support for stub files and configuration files
- **Error Handling**: Comprehensive error messages and recovery

### 🔧 **edoc Automate Connection Management**
- **Secure Authentication**: Basic authentication with credential management
- **edoc Automate Branding**: Professional interface designed for edoc Automate development
- **Connection Panel**: Dedicated activity bar panel with modern UI
- **Auto-Project Detection**: Automatic project name extraction from URLs
- **Debug Output**: Detailed logging for troubleshooting connections and operations
- **Auto-reconnect**: Automatic connection restoration with credential persistence

## 📋 Requirements

- **VS Code**: Version 1.101.0 or higher
- **edoc Automate Server**: Access to an edoc Automate WebDAV-enabled server
- **PHP Tools Extension**: Recommended for enhanced PHP development features
- **Network**: Stable internet connection for WebDAV operations

## 🚀 Getting Started

### 1. Installation
Install the extension from the VS Code marketplace or load the `.vsix` file.

### 2. Connect to edoc Automate Server
1. Click the "edoc Automate" icon in the activity bar
2. Enter your edoc Automate server details:
   - **Server URL**: Your edoc Automate server endpoint (e.g., https://your-edoc-server.com/apps/remote/project)
   - **Username**: Your authentication username
   - **Password**: Your authentication password
   - **Project**: Auto-detected from URL or manually entered

### 3. Browse, Search & Develop
- **File Explorer**: Browse files and folders in your edoc Automate project
- **Search**: Use Ctrl+Shift+F to search across all files
- **PHP Development**: Use F12 (Go to Definition) for PHP functions and classes
- **Edit Files**: Open and edit files directly in VS Code with full IntelliSense

## 🎯 Usage Examples

### Searching Files
```
# Search for all PHP files
*.php

# Search for edoc Automate functions
addAction

# Search for JavaScript files
*.js

# Regex search for PHP classes
^class\s+\w+

# Case-sensitive search
Search with "Match Case" enabled
```

### File Operations
- **Create File**: Right-click in explorer → "New File"
- **Create Folder**: Right-click in explorer → "New Folder"
- **Rename**: Right-click item → "Rename"
- **Delete**: Right-click item → "Delete"
- **Go to Definition**: F12 or right-click → "Go to Definition" (PHP functions/classes)

## ⚙️ Commands

This extension contributes the following commands:

| Command | Description |
|---------|-------------|
| `automate-webdav.showDebug` | Show edoc Automate Debug Output |
| `automate-webdav.refreshWorkspace` | Refresh edoc Automate Workspace |
| `automate-webdav.addStubFile` | Add edoc Automate PHP Plugin API Stubs |
| `automate-webdav.setupPhpStubs` | Setup edoc Automate PHP Stubs |

## 🔧 Configuration

The extension uses VS Code's experimental search provider APIs and integrates with PHP Tools for enhanced development. All features are automatically configured when the extension is installed.

### PHP Development Settings
```json
{
  "webdav.includeStubs": true,
  "php.suggest.basic": true,
  "php.stubs": []
}
```

### Excluded Directories
The following directories are automatically excluded from search operations:
- `.git`, `.svn`, `.hg` (version control)
- `node_modules` (Node.js dependencies)
- `dist`, `build`, `target`, `bin`, `obj` (build artifacts)
- `.vscode`, `.idea` (IDE configuration)
- `.cache`, `.tmp`, `temp` (temporary files)

## 🐛 Troubleshooting

### Search Not Working
1. Ensure VS Code version is 1.101.0 or higher
2. Check edoc Automate connection in the debug output
3. Verify experimental APIs are enabled (automatic)

### PHP IntelliSense Not Working
1. Install PHP Tools extension for enhanced PHP support
2. Ensure edoc Automate connection is established
3. Check that stub files are generated (automatic)

### Connection Issues
1. Verify edoc Automate server URL and credentials
2. Ensure URL follows format: https://server.com/apps/remote/project
3. Check network connectivity and CORS settings
4. Review debug output for detailed error messages

### Performance
- **Initial indexing**: Large directories are indexed automatically on connection (runs in background)
- **Lightning-fast search**: File name searches use cached index for instant results
- **Smart updates**: Index is updated automatically when files change
- **Optimized operations**: Excluded directories are skipped during indexing and search
- **Best practices**: Use specific search patterns for optimal performance

## 🔄 What's New

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and feature updates.

### 🎉 Latest Features
- 🚀 **PHP Development & IntelliSense** - Comprehensive PHP development features with Go to Definition
- 🎨 **edoc Automate Branding** - Professional interface designed for edoc Automate development
- ⚡ **Lightning-fast file indexing** - Revolutionary performance with instant search results
- 🔍 **Complete VS Code search integration** - Native search experience with full API support
- 🎯 **Smart directory exclusion** - Intelligent filtering for optimized performance
- 📁 **Enhanced file operations** - Complete WebDAV filesystem with real-time updates

## 📝 Known Issues

- Search providers use VS Code's experimental APIs (stable but marked as experimental)
- Very large edoc Automate projects may experience slower initial indexing
- Some edoc Automate servers may have specific authentication requirements
- PHP IntelliSense requires PHP Tools extension for optimal experience

## 🤝 Contributing

This extension is actively developed for edoc Automate development workflows. Please report issues or suggest features through the appropriate channels.

## 📜 License

This extension is provided as-is for edoc Automate WebDAV integration with VS Code.