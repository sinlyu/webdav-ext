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
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		
		if (urlInput) {
			urlInput.addEventListener('input', handleCredentialsChange);
		}
		if (usernameInput) {
			usernameInput.addEventListener('input', handleCredentialsChange);
		}
		if (passwordInput) {
			passwordInput.addEventListener('input', handleCredentialsChange);
		}
		
		window.addEventListener('message', handleMessage);
	}
	
	function handleFormSubmit(e) {
		e.preventDefault();
		
		const urlInput = document.getElementById('url');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		const projectSelect = document.getElementById('project');
		
		if (!urlInput || !usernameInput || !passwordInput || !projectSelect) {
			console.error('Form elements not found');
			return;
		}
		
		const url = urlInput.value;
		const username = usernameInput.value;
		const password = passwordInput.value;
		const project = projectSelect.value;
		
		if (!project) {
			showError('Please select a project from the dropdown.');
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
	
	function handleCredentialsChange() {
		const urlInput = document.getElementById('url');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		const projectGroup = document.getElementById('projectGroup');
		const projectSelect = document.getElementById('project');
		const connectBtn = document.getElementById('connectBtn');
		
		if (!urlInput || !usernameInput || !passwordInput || !projectGroup || !projectSelect || !connectBtn) {
			return;
		}
		
		const url = urlInput.value.trim();
		const username = usernameInput.value.trim();
		const password = passwordInput.value.trim();
		
		// Check if all credentials are provided
		if (url && username && password) {
			// Enable project fetching
			projectGroup.style.display = 'block';
			projectSelect.disabled = true;
			connectBtn.disabled = true;
			
			// Clear previous projects
			projectSelect.innerHTML = '<option value="">Loading projects...</option>';
			
			// Fetch projects from server
			vscode.postMessage({
				type: 'fetchProjects',
				url: url,
				username: username,
				password: password
			});
		} else {
			// Hide project selection and disable connect button
			projectGroup.style.display = 'none';
			connectBtn.disabled = true;
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
			case 'projectList':
				handleProjectList(message.projects, message.error);
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
	
	function handleProjectList(projects, error) {
		const projectSelect = document.getElementById('project');
		const connectBtn = document.getElementById('connectBtn');
		
		if (!projectSelect || !connectBtn) {
			return;
		}
		
		if (error) {
			projectSelect.innerHTML = '<option value="">Failed to load projects</option>';
			projectSelect.disabled = true;
			connectBtn.disabled = true;
			showError(error);
			return;
		}
		
		if (!projects || projects.length === 0) {
			projectSelect.innerHTML = '<option value="">No projects found</option>';
			projectSelect.disabled = true;
			connectBtn.disabled = true;
			showError('No projects found on the server');
			return;
		}
		
		// Populate project dropdown
		projectSelect.innerHTML = '<option value="">Select a project...</option>';
		projects.forEach(project => {
			const option = document.createElement('option');
			option.value = project.name;
			option.textContent = project.name;
			projectSelect.appendChild(option);
		});
		
		projectSelect.disabled = false;
		
		// Enable connect button when a project is selected
		projectSelect.addEventListener('change', function() {
			connectBtn.disabled = !this.value;
		});
		
		hideError();
	}
	
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', setupEventHandlers);
	} else {
		setupEventHandlers();
	}
})();