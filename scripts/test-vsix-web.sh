#!/bin/bash

# Test script for testing the extension from VSIX in VS Code Web
# This script builds the VSIX and runs it in a web environment for testing

set -e  # Exit on any error

echo "🌐 Starting VSIX Web Extension Test Process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Get package version
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="automate-webdav-web-${VERSION}.vsix"

print_step "Building VSIX package for version ${VERSION}..."

# Build the package
npm run package-vscode-dev

if [ ! -f "$VSIX_FILE" ]; then
    print_error "VSIX file not found: $VSIX_FILE"
    exit 1
fi

print_success "VSIX package built successfully: $VSIX_FILE"

# Create a temporary directory for web testing
TEST_DIR="test-workspace"
if [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
fi
mkdir -p "$TEST_DIR"

print_step "Starting VS Code Web with VSIX extension..."
print_warning "This will open VS Code in your browser. Close the browser tab when done testing."

echo ""
echo -e "${GREEN}🎯 Testing Instructions:${NC}"
echo "1. VS Code Web will open in your browser"
echo "2. Check that the extension is loaded in the Extensions view"
echo "3. Test WebDAV connection in the Activity Bar"
echo "4. Verify search functionality works"
echo "5. Test virtual file system and go-to-definition"
echo "6. Close the browser tab when testing is complete"
echo ""

# Start VS Code Web with the VSIX extension
vscode-test-web \
    --browserType=chromium \
    --browserOption=--disable-web-security \
    --browserOption=--disable-features=VizDisplayCompositor \
    --extensionPath="$VSIX_FILE" \
    "$TEST_DIR"

print_success "Web testing session completed"

# Cleanup
if [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
    print_success "Cleaned up test workspace"
fi

echo ""
echo -e "${GREEN}🎉 Web Extension Test Complete!${NC}"
echo ""
echo -e "${BLUE}Extension Details:${NC}"
echo "  Package: $VSIX_FILE"
echo "  Version: $VERSION"
echo "  Test Mode: Web Extension"
echo "  Browser: Chromium"