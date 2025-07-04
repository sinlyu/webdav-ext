# WebDAV Extension for VS Code

Navigate through edoc automate apps and WebDAV resources directly within VS Code with full search and file management capabilities.

## ✨ Features

### 🔍 **Powerful Search Integration**
- **Full VS Code Search Support**: Search through all files in your WebDAV workspace using VS Code's built-in search (Ctrl+Shift+F)
- **File Name Search**: Find files using glob patterns (e.g., `*.js`, `**/*.md`)
- **Content Search**: Search within text files with support for:
  - Plain text and regex patterns
  - Case-sensitive and case-insensitive search
  - Multiple file types (.txt, .js, .ts, .json, .css, .html, .md, .py, .java, .c, .cpp, .cs, .php, .rb, .go, .rs, .swift, .kt)
- **Smart Exclusions**: Automatically excludes common directories (`.git`, `node_modules`, `dist`, `build`, etc.)
- **Live Results**: Real-time search results with match highlighting and preview

### 📁 **Complete File System Support**
- **File Operations**: Create, read, edit, delete, and rename files and folders
- **Directory Navigation**: Browse WebDAV directory structures seamlessly
- **VS Code Integration**: Full integration with VS Code's file explorer and editor
- **Error Handling**: Comprehensive error messages and recovery

### 🔧 **WebDAV Connection Management**
- **Secure Authentication**: Basic authentication with credential management
- **Connection Panel**: Dedicated activity bar panel for connection management
- **Debug Output**: Detailed logging for troubleshooting connections and operations
- **Auto-reconnect**: Automatic connection restoration

## 📋 Requirements

- **VS Code**: Version 1.101.0 or higher
- **WebDAV Server**: Access to a WebDAV-enabled server
- **Network**: Stable internet connection for WebDAV operations

## 🚀 Getting Started

### 1. Installation
Install the extension from the VS Code marketplace or load the `.vsix` file.

### 2. Connect to WebDAV Server
1. Click the WebDAV icon in the activity bar
2. Enter your WebDAV server details:
   - **Server URL**: Your WebDAV server endpoint
   - **Username**: Your authentication username
   - **Password**: Your authentication password
   - **Project** (optional): Specific project or path

### 3. Browse and Search
- **File Explorer**: Browse files and folders in the WebDAV workspace
- **Search**: Use Ctrl+Shift+F to search across all files
- **Edit Files**: Open and edit files directly in VS Code

## 🎯 Usage Examples

### Searching Files
```
# Search for all JavaScript files
*.js

# Search for files containing "function"
function

# Regex search for specific patterns
^class\s+\w+

# Case-sensitive search
Search with "Match Case" enabled
```

### File Operations
- **Create File**: Right-click in explorer → "New File"
- **Create Folder**: Right-click in explorer → "New Folder"
- **Rename**: Right-click item → "Rename"
- **Delete**: Right-click item → "Delete"

## ⚙️ Commands

This extension contributes the following commands:

| Command | Description |
|---------|-------------|
| `automate-webdav.showDebug` | Show WebDAV Debug Output |
| `automate-webdav.refreshWorkspace` | Refresh WebDAV Workspace |

## 🔧 Configuration

The extension uses VS Code's experimental search provider APIs. These are automatically enabled when the extension is installed.

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
2. Check WebDAV connection in the debug output
3. Verify experimental APIs are enabled (automatic)

### Connection Issues
1. Verify WebDAV server URL and credentials
2. Check network connectivity
3. Review debug output for detailed error messages

### Performance
- Large directories may take time to index
- Search operations are optimized to skip excluded directories
- Use specific search patterns for better performance

## 🔄 What's New

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes and feature updates.

### Latest Features
- ✅ Full VS Code search integration
- ✅ Smart directory exclusion
- ✅ Enhanced file operations
- ✅ Modular code architecture
- ✅ Comprehensive error handling

## 📝 Known Issues

- Search providers use VS Code's experimental APIs (stable but marked as experimental)
- Very large WebDAV directories may experience slower initial indexing
- Some WebDAV servers may have specific authentication requirements

## 🤝 Contributing

This extension is actively developed. Please report issues or suggest features through the appropriate channels.

## 📜 License

This extension is provided as-is for WebDAV integration with VS Code.