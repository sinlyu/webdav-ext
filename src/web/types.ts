export interface WebDAVCredentials {
	url: string;
	username: string;
	password: string;
	project?: string;
	protocol?: string; // 'http' or 'webdav'
}

export interface WebDAVWorkspace {
	id: string;
	name: string; // Custom workspace name
	credentials: WebDAVCredentials;
	isActive: boolean;
	dateAdded: number;
}

export interface MultiWorkspaceState {
	workspaces: WebDAVWorkspace[];
	activeWorkspaceId?: string;
}

export interface WebDAVFileItem {
	name: string;
	type: string;
	size: string;
	modified: string;
	path: string;
	isDirectory: boolean;
}