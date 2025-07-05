# Virtual File Path Resolution Test

## Issue
VS Code's "Go to Definition" was failing with:
```
Unable to read file '/webdav:/.stubs/plugin-api.stubs.php' (Unavailable (FileSystemError): Error: No file system handle registered (/webdav:))
```

## Root Cause
1. Virtual files were stored with `~` prefix: `~/.stubs/plugin-api.stubs.php`
2. VS Code requested files without `~` prefix: `/.stubs/plugin-api.stubs.php`
3. Path mapping between these formats was not handled correctly

## Fixes Applied

### 1. Updated `createWebdavUri()` method
- Now handles `~` prefix by removing it from URIs
- `~/.stubs/file.php` → `webdav:/.stubs/file.php`

### 2. Enhanced virtual file lookup in `stat()` and `readFile()`
- Added special handling for `.stubs` and `.vscode` paths
- When looking for `/.stubs/file.php`, also checks `~/.stubs/file.php`

### 3. Fixed `getParentPath()` method  
- Now properly handles `~` prefix in virtual file paths
- `~/.stubs/file.php` → parent path: `.stubs`

## Test Cases

| Storage Path | VS Code Request | Should Work |
|-------------|----------------|-------------|
| `~/.stubs/plugin-api.stubs.php` | `webdav:/.stubs/plugin-api.stubs.php` | ✅ Yes |
| `~/.vscode/settings.json` | `webdav:/.vscode/settings.json` | ✅ Yes |
| `~/test.txt` | `webdav:/test.txt` | ✅ Yes |

## Expected Behavior After Fix

1. **File Creation**: `createVirtualFile('~/.stubs/plugin-api.stubs.php', content)`
2. **URI Generation**: Creates `webdav:/.stubs/plugin-api.stubs.php` 
3. **VS Code Request**: Requests `/.stubs/plugin-api.stubs.php`
4. **Path Resolution**: Maps to stored path `~/.stubs/plugin-api.stubs.php`
5. **File Access**: ✅ Successfully returns file content

The fix ensures seamless mapping between tilde-prefixed internal storage and the clean paths that VS Code expects for language server operations.