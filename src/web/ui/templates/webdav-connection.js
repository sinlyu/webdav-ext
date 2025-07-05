(function() {
	'use strict';
	
	const vscode = acquireVsCodeApi();
	
	function setupEventHandlers() {
		const webdavForm = document.getElementById('webdavForm');
		if (webdavForm) {
			webdavForm.addEventListener('submit', handleFormSubmit);
		}
		
		const disconnectBtn = document.getElementById('disconnectBtn');
		if (disconnectBtn) {
			disconnectBtn.addEventListener('click', handleDisconnect);
		}
		
		const addWorkspaceBtn = document.getElementById('addWorkspaceBtn');
		if (addWorkspaceBtn) {
			addWorkspaceBtn.addEventListener('click', handleAddWorkspace);
		}
		
		const urlInput = document.getElementById('url');
		if (urlInput) {
			urlInput.addEventListener('input', handleUrlChange);
		}
		
		window.addEventListener('message', handleMessage);
	}
	
	function handleFormSubmit(e) {
		e.preventDefault();
		
		const urlInput = document.getElementById('url');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		const projectInput = document.getElementById('project');
		
		if (!urlInput || !usernameInput || !passwordInput || !projectInput) {
			console.error('Form elements not found');
			return;
		}
		
		const url = urlInput.value;
		const username = usernameInput.value;
		const password = passwordInput.value;
		let project = projectInput.value;
		
		if (!project) {
			const match = url.match(/\/apps\/remote\/([^\/\?#]+)/);
			project = match ? match[1] : '';
		}
		
		if (!project) {
			showError('Project name required. Please add it to the URL or enter manually.');
			return;
		}
		
		hideError();
		setLoadingState(true);
		
		vscode.postMessage({
			type: 'connect',
			url: url,
			username: username,
			password: password,
			project: project
		});
	}
	
	function handleDisconnect() {
		vscode.postMessage({ type: 'disconnect' });
	}
	
	function handleAddWorkspace() {
		vscode.postMessage({ type: 'addToWorkspace' });
	}
	
	function handleUrlChange(e) {
		const url = e.target.value;
		const projectField = document.getElementById('project');
		
		if (url && projectField && !projectField.value) {
			const match = url.match(/\/apps\/remote\/([^\/\?#]+)/);
			if (match) {
				projectField.value = match[1];
			}
		}
	}
	
	function handleMessage(event) {
		const message = event.data;
		console.log('WebView received message:', message);
		
		switch (message.type) {
			case 'connectionStatus':
				if (message.connected) {
					showConnectionStatus(message);
				} else {
					showConnectionForm();
				}
				break;
			case 'connectionError':
				console.log('Connection error received:', message.error);
				setLoadingState(false);
				showError(message.error || 'Connection failed');
				break;
		}
	}
	
	function showConnectionStatus(message) {
		const connectionForm = document.getElementById('connectionForm');
		const connectionStatus = document.getElementById('connectionStatus');
		if (connectionForm) {
			connectionForm.classList.add('hidden');
		}
		if (connectionStatus) {
			connectionStatus.classList.remove('hidden');
		}
		
		const connectedUrl = document.getElementById('connectedUrl');
		const connectedUser = document.getElementById('connectedUser');
		const connectedProject = document.getElementById('connectedProject');
		if (connectedUrl) {
			connectedUrl.textContent = message.url || '';
		}
		if (connectedUser) {
			connectedUser.textContent = message.username || '';
		}
		if (connectedProject) {
			connectedProject.textContent = message.project || '';
		}
	}
	
	function showConnectionForm() {
		const connectionForm = document.getElementById('connectionForm');
		const connectionStatus = document.getElementById('connectionStatus');
		if (connectionForm) {
			connectionForm.classList.remove('hidden');
		}
		if (connectionStatus) {
			connectionStatus.classList.add('hidden');
		}
		setLoadingState(false);
	}
	
	function setLoadingState(loading) {
		const connectBtn = document.getElementById('connectBtn');
		if (connectBtn) {
			connectBtn.textContent = loading ? 'Connecting...' : 'Connect to WebDAV';
			connectBtn.disabled = loading;
		}
		const connectionForm = document.querySelector('.connection-form');
		if (connectionForm) {
			if (loading) {
				connectionForm.classList.add('loading');
			} else {
				connectionForm.classList.remove('loading');
			}
		}
	}
	
	function showError(message) {
		const urlError = document.getElementById('urlError');
		if (urlError) {
			urlError.textContent = message;
			urlError.classList.remove('hidden');
		}
	}
	
	function hideError() {
		const urlError = document.getElementById('urlError');
		if (urlError) {
			urlError.classList.add('hidden');
		}
	}
	
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', setupEventHandlers);
	} else {
		setupEventHandlers();
	}
})();