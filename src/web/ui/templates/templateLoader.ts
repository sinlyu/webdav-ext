/**
 * Template Loader for WebDAV Extension
 * 
 * Loads HTML templates and JavaScript files from the file system
 * and combines them into a complete webview HTML string.
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class TemplateLoader {
  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Load and combine HTML template with JavaScript
   */
  async loadWebviewTemplate(templateName: string): Promise<string> {
    try {
      // Load HTML template
      const htmlContent = await this.loadTemplate(`${templateName}.html`);
      
      // Load JavaScript content
      const jsContent = await this.loadTemplate(`${templateName}.js`);
      
      // Inject JavaScript into HTML
      const scriptTag = `<script>${jsContent}</script>`;
      const combinedHtml = htmlContent.replace('</body>', `${scriptTag}\n</body>`);
      
      return combinedHtml;
      
    } catch (error) {
      console.error(`Failed to load template ${templateName}:`, error);
      throw new Error(`Template loading failed: ${templateName}`);
    }
  }

  /**
   * Load a single template file
   */
  private async loadTemplate(fileName: string): Promise<string> {
    const templatePath = vscode.Uri.joinPath(
      this.extensionUri, 
      'dist', 
      'web', 
      'templates', 
      fileName
    );

    try {
      const content = await vscode.workspace.fs.readFile(templatePath);
      return new TextDecoder().decode(content);
    } catch (error) {
      // If dist version doesn't exist, try source version (for development)
      const srcTemplatePath = vscode.Uri.joinPath(
        this.extensionUri,
        'src',
        'web', 
        'ui',
        'templates',
        fileName
      );
      
      try {
        const content = await vscode.workspace.fs.readFile(srcTemplatePath);
        return new TextDecoder().decode(content);
      } catch (srcError) {
        throw new Error(`Template file not found: ${fileName}`);
      }
    }
  }

  /**
   * Load template with custom variable substitution
   */
  async loadWebviewTemplateWithVariables(
    templateName: string, 
    variables: Record<string, string> = {}
  ): Promise<string> {
    let html = await this.loadWebviewTemplate(templateName);
    
    // Replace variables in the format {{variableName}}
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      html = html.replace(new RegExp(placeholder, 'g'), value);
    }
    
    return html;
  }

  /**
   * Get template resource URI for referencing assets
   */
  getTemplateResourceUri(resourcePath: string): vscode.Uri {
    return vscode.Uri.joinPath(
      this.extensionUri,
      'dist',
      'web', 
      'templates',
      resourcePath
    );
  }

  /**
   * Load CSS file as string
   */
  async loadStylesheet(cssFileName: string): Promise<string> {
    return this.loadTemplate(cssFileName);
  }
}