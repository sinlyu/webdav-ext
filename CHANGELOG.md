# Change Log

All notable changes to the "automate-webdav" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- **VS Code Search Integration**: Full support for VS Code's built-in search functionality
  - File name search with glob pattern support
  - Content search within text files (supports .txt, .js, .ts, .json, .css, .html, .md, .py, and more)
  - Regex search support with proper error handling
  - Case-sensitive search options
  - Search result preview with match highlighting
  - Search cancellation support
- **Smart Directory Exclusion**: Automatically excludes common directories from search
  - `.git`, `.svn`, `.hg` (version control)
  - `node_modules`, `dist`, `build`, `target` (build artifacts)
  - `.vscode`, `.idea` (IDE files)
  - `.cache`, `.tmp`, `temp` (temporary files)
- **Enhanced File Operations**: Complete WebDAV file system support
  - File reading, writing, creating, and deleting
  - Directory creation and navigation
  - File and folder renaming
  - Comprehensive error handling with user-friendly messages
- **Improved Code Architecture**: Modular and maintainable codebase
  - Separated search providers into dedicated files
  - Shared type definitions for better consistency
  - Clean separation of concerns for easier maintenance

### Fixed
- **Search Provider Registration**: Properly registers with VS Code's experimental search APIs
- **Connection Stability**: Improved WebDAV connection handling and error recovery
- **File System Integration**: Better integration with VS Code's file explorer
- **Debug Logging**: Comprehensive logging for troubleshooting connection and search issues

### Technical Improvements
- Uses VS Code's experimental `fileSearchProvider` and `textSearchProvider` APIs
- Modular code structure with separated concerns
- TypeScript strict type checking
- Comprehensive error handling and logging
- Support for VS Code web extensions

## [0.0.1] - Initial Release

### Added
- Basic WebDAV server connectivity
- File system provider for WebDAV resources
- Activity bar integration with connection panel
- Debug output for WebDAV operations
- Basic file and directory browsing