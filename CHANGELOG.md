# Change Log

All notable changes to the "edoc Automate WebDAV" extension will be documented in this file.

## [Unreleased]

## [0.2.1] - 2025-01-07

### 🐛 Bug Fixes
- **🔗 Fixed Go-to-Definition for Virtual Files**: Resolved filesystem provider URI issues
  - Fixed malformed URI error when navigating to virtual stub files (`webdav:~/.stubs/plugin-api.stubs.php`)
  - Added proper path normalization for virtual file URIs in all providers
  - Updated PHP definition providers (both regex and AST-based) to handle virtual file paths correctly
  - Fixed URI generation in file search and text search providers for virtual files
  - Go-to-definition now works seamlessly for both real WebDAV files and virtual stub files

- **📁 Improved Virtual File System**: Enhanced virtual file visibility and caching
  - Fixed virtual files not appearing in VS Code file explorer
  - Enhanced virtual file path matching logic for consistent directory listings
  - Improved parent path calculation for virtual files with `~` prefix
  - Added flexible path matching for root directory virtual files
  - Better debugging and logging for virtual file resolution

- **⚡ Enhanced Directory Filtering**: Optimized indexing performance
  - Added comprehensive directory filtering to exclude common development directories
  - Automatically filters `.git`, `.svn`, `.hg`, `node_modules`, `.cache`, `.tmp`, and other system directories
  - Reduces unnecessary cache entries and improves indexing performance
  - Configurable ignore patterns for future extensibility

- **🔄 Fixed Cache Performance Issues**: Resolved server requests after cache warming
  - Fixed folders still requesting server on first access after cache warming
  - Improved path normalization consistency between cache warming and actual requests
  - Enhanced cache key normalization for consistent cache hits/misses
  - Better validation of cached directory entries to prevent empty cache issues
  - Optimized URL path building with proper cleaning and normalization

- **🔧 Fixed API Proposals Registration**: Resolved extension loading error for web extensions
  - Fixed "Extension CANNOT use API proposal: fileSearchProvider" error
  - Corrected enabledApiProposals field position in package.json for proper VS Code recognition
  - Ensures file and text search providers register correctly in web environments

### 🏗️ Technical Improvements
- **URI Normalization**: Added `normalizeFilePathForUri()` method across all providers
- **Path Consistency**: Unified path handling between virtual and real files
- **Cache Optimization**: Enhanced cache key generation and validation
- **Debug Logging**: Improved debugging for virtual file operations and cache performance

## [0.2.0] - 2025-01-05

### 🚀 PHP Development Features
- **📝 PHP IntelliSense & Type Definitions**: Enhanced development experience
  - Added comprehensive PHP definition provider with AST parsing support
  - Implemented "Go to Definition" functionality for PHP functions and classes
  - Automatic PHP plugin API stub file generation for autocompletion
  - Integration with PHP Tools extension for enhanced IntelliSense
  - Support for both simple text-based and AST-based definition lookup
  - Automatic workspace.includePath configuration for PHP development

### 🎨 UI & Branding Improvements
- **🏷️ edoc Automate Branding**: Complete rebrand for edoc Automate integration
  - Updated extension display name to "edoc Automate WebDAV"
  - Enhanced activity bar with edoc Automate branding and server environment icon
  - Updated all user-facing messages to reference edoc Automate
  - Improved command titles and descriptions for clarity
- **✨ Modern UI Enhancements**: Professional interface design
  - Enhanced connection form with modern styling and better visual hierarchy
  - Added custom brand icon with gradient styling
  - Improved button interactions with hover effects and smooth transitions
  - Enhanced input focus states with subtle animations
  - Better error styling with colored accent borders and improved readability
- **🔧 User Experience Improvements**: Better usability
  - Fixed emoji display compatibility issues in VS Code webview
  - Replaced problematic emoji with custom CSS-based info icons
  - Enhanced status cards with visual accent borders
  - Improved form spacing and typography for better readability
  - Added loading animations and better visual feedback

## [0.1.0] - 2024-07-04

### 🚀 Major Features
- **⚡ Lightning-Fast File Indexing**: Performance optimization
  - Automatic file indexing on connection with real-time updates
  - In-memory file index providing instant file name lookups
  - Smart index updates on file create, delete, rename operations
  - Intelligent fallback to directory traversal when needed
- **🔍 Complete VS Code Search Integration**: Native search experience
  - File name search with full glob pattern support (`*.js`, `**/*.md`, etc.)
  - Content search within text files (supports 20+ file types)
  - Advanced regex search with proper error handling
  - Case-sensitive and case-insensitive search modes
  - Real-time search result preview with match highlighting
  - Full search cancellation support
- **🎯 Smart Directory Exclusion**: Optimized search performance
  - Auto-excludes `.git`, `.svn`, `.hg` (version control directories)
  - Skips `node_modules`, `dist`, `build`, `target` (build artifacts)
  - Ignores `.vscode`, `.idea` (IDE configuration)
  - Excludes `.cache`, `.tmp`, `temp` (temporary directories)

### 📁 Enhanced File Management
- **Complete WebDAV File System**: Full-featured file operations
  - File reading, writing, creating, and deleting
  - Directory creation and navigation
  - File and folder renaming with real-time updates
  - Comprehensive error handling with user-friendly messages
  - CORS error detection and helpful troubleshooting guidance

### 🏗️ Architecture & Code Quality
- **Modular Code Architecture**: Better organization
  - Separated filesystem provider into dedicated module
  - Isolated search providers for better maintainability
  - Shared type definitions for consistency
  - Clean dependency injection pattern
  - Comprehensive error boundaries

### 🔧 Technical Improvements
- **Advanced Search APIs**: Cutting-edge VS Code integration
  - Uses VS Code's experimental `fileSearchProvider` and `textSearchProvider` APIs
  - Runtime API detection with graceful fallbacks
  - Proper search result progress reporting
- **Performance Optimizations**: Enterprise-level efficiency
  - Sub-second file searches using intelligent caching
  - Reduced network requests through smart indexing
  - Optimized memory usage with efficient data structures
- **Developer Experience**: Enhanced debugging and monitoring
  - Comprehensive debug logging with structured data
  - Real-time connection status monitoring
  - Detailed error reporting with actionable solutions

### 🐛 Fixes & Stability
- **Search Provider Registration**: Bulletproof API integration
- **Connection Stability**: Robust WebDAV connection handling
- **File System Integration**: Seamless VS Code file explorer experience
- **TypeScript Compliance**: Eliminated all compilation warnings

### 🔄 Breaking Changes
None - Fully backward compatible with existing configurations

## [0.0.1] - Initial Release

### Added
- Basic WebDAV server connectivity
- File system provider for WebDAV resources
- Activity bar integration with connection panel
- Debug output for WebDAV operations
- Basic file and directory browsing