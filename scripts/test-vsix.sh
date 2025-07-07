#!/bin/bash

# Test script for installing and testing the extension from VSIX
# This script builds the VSIX and installs it in VS Code for production testing

set -e  # Exit on any error

echo "🚀 Starting VSIX Extension Test Process..."

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

# Check if extension is already installed
print_step "Checking for existing extension installation..."

if code --list-extensions | grep -q "Sinlyu.automate-webdav"; then
    print_warning "Extension already installed. Uninstalling first..."
    code --uninstall-extension Sinlyu.automate-webdav
    print_success "Previous installation removed"
fi

# Install the extension from VSIX
print_step "Installing extension from VSIX file..."
code --install-extension "$VSIX_FILE" --force

if [ $? -eq 0 ]; then
    print_success "Extension installed successfully!"
else
    print_error "Failed to install extension"
    exit 1
fi

# Verify installation
print_step "Verifying installation..."
if code --list-extensions | grep -q "Sinlyu.automate-webdav"; then
    print_success "Extension verified as installed"
    
    echo ""
    echo -e "${GREEN}🎉 Extension Test Setup Complete!${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Open VS Code"
    echo "2. Check that the extension is loaded (should appear in Extensions list)"
    echo "3. Test the WebDAV connection functionality"
    echo "4. Verify that search providers work correctly"
    echo "5. Test go-to-definition on virtual stub files"
    echo ""
    echo -e "${BLUE}To uninstall after testing:${NC}"
    echo "  npm run uninstall-vsix"
    echo ""
    echo -e "${BLUE}Extension Details:${NC}"
    echo "  Package: $VSIX_FILE"
    echo "  Version: $VERSION"
    echo "  Publisher: Sinlyu"
    echo "  ID: Sinlyu.automate-webdav"
    
else
    print_error "Extension installation verification failed"
    exit 1
fi