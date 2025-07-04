export interface WebDAVCredentials {
	url: string;
	username: string;
	password: string;
	project?: string;
}

export interface WebDAVFileItem {
	name: string;
	type: string;
	size: string;
	modified: string;
	path: string;
	isDirectory: boolean;
}