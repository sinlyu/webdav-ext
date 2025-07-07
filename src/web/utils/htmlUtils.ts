import { WebDAVFileItem } from '../types';

/**
 * Parses WebDAV HTML directory listings into structured file items
 * @param html The HTML string from WebDAV directory response
 * @returns Array of WebDAVFileItem objects
 */
export function parseDirectoryHTML(html: string): WebDAVFileItem[] {
	const items: WebDAVFileItem[] = [];
	
	try {
		// Use regex to parse the HTML since DOMParser is not available in web worker
		// Look for table rows in the nodeTable
		const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
		const rows = html.match(tableRowRegex) || [];
		
		for (const row of rows) {
			// Extract name column with link
			const nameMatch = row.match(/<td[^>]*class[^>]*nameColumn[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is);
			// Extract type column
			const typeMatch = row.match(/<td[^>]*class[^>]*typeColumn[^>]*>(.*?)<\/td>/is);
			// Extract size column
			const sizeMatch = row.match(/<td[^>]*class[^>]*sizeColumn[^>]*>(.*?)<\/td>/is);
			// Extract modified column
			const modifiedMatch = row.match(/<td[^>]*class[^>]*lastModifiedColumn[^>]*>(.*?)<\/td>/is);
			
			if (nameMatch && typeMatch) {
				const href = nameMatch[1]?.trim() || '';
				const name = stripHtmlTags(nameMatch[2]?.trim() || '');
				const type = stripHtmlTags(typeMatch[1]?.trim() || '');
				const size = sizeMatch ? stripHtmlTags(sizeMatch[1]?.trim() || '') : '';
				const modified = modifiedMatch ? stripHtmlTags(modifiedMatch[1]?.trim() || '') : '';
				
				// Skip parent directory links, empty names, and common directories that should be ignored
				if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..' && !shouldIgnoreDirectory(name)) {
					items.push({
						name,
						type,
						size,
						modified,
						path: href,
						isDirectory: type === 'Collection' || type.toLowerCase().includes('directory')
					});
				}
			}
		}
		
		return items;
		
	} catch (error) {
		// Fallback: try to extract any links as a last resort
		return parseDirectoryHTMLFallback(html);
	}
}

/**
 * Fallback HTML parsing method for when main parsing fails
 * @param html The HTML string from WebDAV directory response
 * @returns Array of WebDAVFileItem objects
 */
export function parseDirectoryHTMLFallback(html: string): WebDAVFileItem[] {
	const items: WebDAVFileItem[] = [];
	
	// Simple fallback: extract any links that look like files/directories
	const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
	const links = html.matchAll(linkRegex);
	
	for (const link of links) {
		const href = link[1]?.trim() || '';
		const name = stripHtmlTags(link[2]?.trim() || '');
		
		if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..' && !shouldIgnoreDirectory(name)) {
			const isDirectory = href.endsWith('/') || !href.includes('.');
			items.push({
				name,
				type: isDirectory ? 'Collection' : 'File',
				size: '',
				modified: '',
				path: href,
				isDirectory
			});
		}
	}
	
	return items;
}

/**
 * Strips HTML tags from a string
 * @param html The HTML string to clean
 * @returns Clean text without HTML tags
 */
export function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Determines if a directory should be ignored during indexing/caching
 * @param name The directory name to check
 * @returns True if the directory should be ignored, false otherwise
 */
export function shouldIgnoreDirectory(name: string): boolean {
	// Common directories that should be ignored
	const ignoredDirectories = [
		'.git',
		'.gitignore',
		'.svn',
		'.hg',
		'.bzr',
		'node_modules',
		'.npm',
		'.vscode-test',
		'.nyc_output',
		'coverage',
		'.DS_Store',
		'Thumbs.db',
		'__pycache__',
		'.pytest_cache',
		'.mypy_cache',
		'.tox',
		'.coverage',
		'.cache',
		'.tmp',
		'tmp',
		'temp',
		'.temp'
	];

	// Check if the directory name matches any ignored patterns
	return ignoredDirectories.includes(name) || 
		   name.startsWith('.') && (name.endsWith('.tmp') || name.endsWith('.temp') || name.endsWith('.cache'));
}