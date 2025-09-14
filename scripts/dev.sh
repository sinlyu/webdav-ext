#!/bin/bash

# Script to run extension development with VS Code Insiders (preferred) or stable fallback

EXTENSION_PATH="$(pwd)"
DEV_ARGS="--extensionDevelopmentPath=\"$EXTENSION_PATH\" --new-window --disable-extensions"

echo "Starting VS Code Extension Development..."
echo "Extension path: $EXTENSION_PATH"

# Try VS Code Insiders first
if command -v code-insiders &> /dev/null; then
    echo "Using VS Code Insiders"
    eval "code-insiders $DEV_ARGS"
elif command -v code &> /dev/null; then
    echo "VS Code Insiders not found, falling back to VS Code stable"
    eval "code $DEV_ARGS"
else
    echo "Error: Neither VS Code Insiders nor VS Code stable found in PATH"
    echo "Please install VS Code Insiders or VS Code stable"
    exit 1
fi