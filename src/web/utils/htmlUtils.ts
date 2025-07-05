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
				
				// Skip parent directory links and empty names
				if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..') {
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
		
		if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..') {
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