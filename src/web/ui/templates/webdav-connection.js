(function() {
	'use strict';
	
	const vscode = acquireVsCodeApi();
	let workspaces = [];
	let availableProjects = [];
	
	// Get previous state
	const previousState = vscode.getState() || {};
	
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
		
		const availableProjectsSelect = document.getElementById('availableProjects');
		if (availableProjectsSelect) {
			availableProjectsSelect.addEventListener('change', handleProjectSelection);
		}
		
		const urlInput = document.getElementById('url');
		const protocolSelect = document.getElementById('protocol');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		
		if (urlInput) {
			urlInput.addEventListener('input', handleCredentialsChange);
		}
		if (protocolSelect) {
			protocolSelect.addEventListener('change', handleProtocolChange);
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
		const protocolSelect = document.getElementById('protocol');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		
		if (!urlInput || !protocolSelect || !usernameInput || !passwordInput) {
			console.error('Form elements not found');
			return;
		}
		
		const url = urlInput.value;
		const protocol = protocolSelect.value;
		const username = usernameInput.value;
		const password = passwordInput.value;
		
		if (!url || !username || !password) {
			showError('Please fill in all fields.');
			return;
		}
		
		hideError();
		setLoadingState(true);
		
		vscode.postMessage({
			type: 'connect',
			url: url,
			protocol: protocol,
			username: username,
			password: password
		});
	}
	
	function handleDisconnect() {
		vscode.postMessage({ type: 'disconnect' });
	}
	
	function handleAddWorkspace() {
		const availableProjectsSelect = document.getElementById('availableProjects');
		const workspaceNameInput = document.getElementById('workspaceName');
		
		const selectedProject = availableProjectsSelect ? availableProjectsSelect.value : '';
		const customName = workspaceNameInput ? workspaceNameInput.value.trim() : '';
		
		if (!selectedProject) {
			alert('Please select a project to add to workspace');
			return;
		}
		
		vscode.postMessage({ 
			type: 'addProjectToWorkspace',
			project: selectedProject,
			customName: customName || undefined
		});
	}
	
	function handleProjectSelection() {
		const availableProjectsSelect = document.getElementById('availableProjects');
		const addWorkspaceBtn = document.getElementById('addWorkspaceBtn');
		const workspaceNameInput = document.getElementById('workspaceName');
		
		if (availableProjectsSelect && addWorkspaceBtn) {
			const selectedProject = availableProjectsSelect.value;
			addWorkspaceBtn.disabled = !selectedProject;
			
			// Auto-generate workspace name if none provided
			if (selectedProject && workspaceNameInput && !workspaceNameInput.value.trim()) {
				const connectedUrl = document.getElementById('connectedUrl');
				if (connectedUrl) {
					try {
						const hostname = new URL(connectedUrl.textContent || '').hostname;
						workspaceNameInput.value = `${selectedProject} (${hostname})`;
					} catch {
						workspaceNameInput.value = selectedProject;
					}
				}
			}
		}
	}
	
	function handleWorkspaceAction(action, workspaceId, data = {}) {
		console.log('handleWorkspaceAction called:', { action, workspaceId, data });
		vscode.postMessage({
			type: 'workspaceAction',
			action: action,
			workspaceId: workspaceId,
			...data
		});
		console.log('Message sent to backend');
	}
	
	function renameWorkspace(workspaceId) {
		console.log('renameWorkspace called with ID:', workspaceId);
		const workspace = workspaces.find(w => w.id === workspaceId);
		if (!workspace) {
			console.error('Workspace not found:', workspaceId);
			return;
		}

		console.log('Found workspace:', workspace);
		
		// Use VS Code's input box as primary method
		vscode.postMessage({
			type: 'showInputBox',
			prompt: 'Enter new workspace name:',
			value: workspace.name,
			workspaceId: workspaceId
		});
	}
	
	function handleCredentialsChange() {
		const urlInput = document.getElementById('url');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		const connectBtn = document.getElementById('connectBtn');
		
		if (!urlInput || !usernameInput || !passwordInput || !connectBtn) {
			return;
		}
		
		const url = urlInput.value.trim();
		const username = usernameInput.value.trim();
		const password = passwordInput.value.trim();
		
		// Enable connect button when all credentials are provided
		connectBtn.disabled = !(url && username && password);
	}
	
	function handleProtocolChange() {
		const protocolSelect = document.getElementById('protocol');
		if (!protocolSelect) {
			return;
		}
		
		const selectedProtocol = protocolSelect.value;
		console.log('Protocol changed to:', selectedProtocol);
		
		// Could add protocol-specific validation or UI changes here
		// For example, show different help text or warnings
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
			case 'workspaceList':
				updateWorkspaceList(message.workspaces);
				break;
			case 'clearWorkspaceName':
				const workspaceNameInput = document.getElementById('workspaceName');
				if (workspaceNameInput) {
					workspaceNameInput.value = '';
				}
				break;
			case 'clearWorkspaceForm':
				const workspaceNameInput2 = document.getElementById('workspaceName');
				const availableProjectsSelect = document.getElementById('availableProjects');
				const addWorkspaceBtn = document.getElementById('addWorkspaceBtn');
				if (workspaceNameInput2) {
					workspaceNameInput2.value = '';
				}
				if (availableProjectsSelect) {
					availableProjectsSelect.selectedIndex = 0;
				}
				if (addWorkspaceBtn) {
					addWorkspaceBtn.disabled = true;
				}
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
		if (connectedUrl) {
			connectedUrl.textContent = message.url || '';
		}
		if (connectedUser) {
			connectedUser.textContent = message.username || '';
		}
		
		console.log('Connection status message received', {
			availableProjects: message.availableProjects,
			projectListError: message.projectListError,
			projectCount: message.availableProjects?.length || 0
		});
		
		// Handle project list errors
		if (message.projectListError) {
			console.error('Project list error:', message.projectListError);
			showProjectError(message.projectListError);
			return;
		}
		
		// Populate available projects if provided
		if (message.availableProjects) {
			updateAvailableProjects(message.availableProjects);
			hideProjectError();
		} else {
			console.warn('No availableProjects in connection status message');
			updateAvailableProjects([]);
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
			connectBtn.textContent = loading ? 'Connecting...' : 'Connect to edoc Automate';
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
	
	function showProjectError(message) {
		const projectError = document.getElementById('projectError') || createProjectErrorElement();
		if (projectError) {
			projectError.textContent = `Project Error: ${message}`;
			projectError.className = 'project-message project-error';
			projectError.classList.remove('hidden');
		}
	}
	
	function showProjectWarning(message) {
		const projectError = document.getElementById('projectError') || createProjectErrorElement();
		if (projectError) {
			projectError.textContent = message;
			projectError.className = 'project-message project-warning';
			projectError.classList.remove('hidden');
		}
	}
	
	function showProjectSuccess(message) {
		const projectError = document.getElementById('projectError') || createProjectErrorElement();
		if (projectError) {
			projectError.textContent = message;
			projectError.className = 'project-message project-success';
			projectError.classList.remove('hidden');
			// Auto-hide success message after 3 seconds
			setTimeout(() => hideProjectError(), 3000);
		}
	}
	
	function hideProjectError() {
		const projectError = document.getElementById('projectError');
		if (projectError) {
			projectError.classList.add('hidden');
		}
	}
	
	function createProjectErrorElement() {
		let projectError = document.getElementById('projectError');
		if (!projectError) {
			projectError = document.createElement('div');
			projectError.id = 'projectError';
			projectError.className = 'project-message hidden';
			
			// Insert after the availableProjects select
			const availableProjectsSelect = document.getElementById('availableProjects');
			if (availableProjectsSelect && availableProjectsSelect.parentNode) {
				availableProjectsSelect.parentNode.insertBefore(projectError, availableProjectsSelect.nextSibling);
			}
		}
		return projectError;
	}
	
	
	function updateAvailableProjects(projects) {
		const availableProjectsSelect = document.getElementById('availableProjects');
		if (!availableProjectsSelect) {
			console.error('availableProjects select element not found');
			return;
		}
		
		console.log('Updating available projects', { projects, count: projects?.length || 0, type: typeof projects });
		
		// Store projects in global variable and webview state
		availableProjects = projects || [];
		vscode.setState({ ...vscode.getState(), availableProjects: availableProjects });
		
		availableProjectsSelect.innerHTML = '<option value="">Select a project to add...</option>';
		
		if (projects && projects.length > 0) {
			projects.forEach(project => {
				const option = document.createElement('option');
				// Handle both string arrays and object arrays
				const projectName = typeof project === 'string' ? project : (project.name || project);
				option.value = projectName;
				option.textContent = projectName;
				availableProjectsSelect.appendChild(option);
				console.log('Added project option', projectName);
			});
			showProjectSuccess(`Found ${projects.length} project(s)`);
		} else {
			console.warn('No projects provided or empty array');
			showProjectWarning('No projects found on the server');
		}
	}
	
	function updateWorkspaceList(workspaceData) {
		workspaces = workspaceData || [];
		const workspaceList = document.getElementById('workspaceList');
		
		if (!workspaceList) {
			return;
		}
		
		if (workspaces.length === 0) {
			workspaceList.innerHTML = `
				<div class="workspace-empty">
					No workspaces added yet. Connect to a project and add it to your workspace.
				</div>
			`;
			return;
		}

		workspaceList.innerHTML = workspaces.map(workspace => `
			<div class="workspace-item ${workspace.isActive ? 'active' : ''}">
				<div class="workspace-header">
					<div class="workspace-info">
						<div class="workspace-name">${workspace.name}</div>
						<div class="workspace-details">
							<div>Project: ${workspace.credentials.project}</div>
							<div>Server: ${new URL(workspace.credentials.url).hostname}</div>
							<div>Added: ${new Date(workspace.dateAdded).toLocaleDateString()}</div>
						</div>
					</div>
					${workspace.isActive ? '<div class="workspace-status">Active</div>' : ''}
				</div>
				<div class="workspace-actions">
					<button class="workspace-btn workspace-btn-secondary" onclick="renameWorkspace('${workspace.id}')">
						Rename
					</button>
					${workspace.isActive 
						? `<button class="workspace-btn workspace-btn-secondary" onclick="handleWorkspaceAction('deactivate', '${workspace.id}')">Remove</button>`
						: `<button class="workspace-btn workspace-btn-primary" onclick="handleWorkspaceAction('activate', '${workspace.id}')">Add</button>`
					}
					<button class="workspace-btn workspace-btn-danger" onclick="handleWorkspaceAction('delete', '${workspace.id}')">
						Delete
					</button>
				</div>
			</div>
		`).join('');
	}
	
	// Make functions available globally for onclick handlers
	window.handleWorkspaceAction = handleWorkspaceAction;
	window.renameWorkspace = renameWorkspace;
	
	// Request workspace list on load
	function requestWorkspaceList() {
		vscode.postMessage({ type: 'getWorkspaces' });
	}
	
	// Restore state from previous session
	function restoreState() {
		console.log('Restoring webview state', previousState);
		
		if (previousState.availableProjects && previousState.availableProjects.length > 0) {
			console.log('Restoring cached projects', previousState.availableProjects);
			updateAvailableProjects(previousState.availableProjects);
		}
	}
	
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function() {
			setupEventHandlers();
			requestWorkspaceList();
			restoreState();
		});
	} else {
		setupEventHandlers();
		requestWorkspaceList();
		restoreState();
	}
})();