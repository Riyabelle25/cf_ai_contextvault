/**
 * Frontend JavaScript for ContextVault chat interface
 */

// Configuration - Auto-detect API URL
// In production (Cloudflare Pages), the frontend and worker should be on the same domain
// For local development, update this to your Worker URL (e.g., 'http://localhost:8787')
let API_BASE_URL = window.location.origin;

// If running locally and worker is on a different port, uncomment and set:
// API_BASE_URL = 'http://localhost:8787';

// For production with separate worker domain, set your worker URL:
API_BASE_URL = 'http://localhost:8787'
// 'https://contextvault.riyabelle25.workers.dev';

// Generate a session ID for this user session
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadFileList();
});

/**
 * Initialize event listeners
 */
function initializeEventListeners() {
    // File upload
    document.getElementById('uploadBtn').addEventListener('click', handleFileUpload);
    
    // Paste text
    document.getElementById('pasteBtn').addEventListener('click', handlePasteText);
    
    // Send query
    document.getElementById('sendBtn').addEventListener('click', handleSendQuery);
    document.getElementById('queryInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendQuery();
        }
    });
    
    // Clear conversation
    document.getElementById('clearBtn').addEventListener('click', handleClearConversation);
    
    // Refresh file list
    document.getElementById('refreshFilesBtn').addEventListener('click', loadFileList);
    
    // Cleanup orphaned chunks
    document.getElementById('cleanupBtn').addEventListener('click', handleCleanupOrphaned);
    
    // Debug chunks
    document.getElementById('debugBtn').addEventListener('click', handleDebugChunks);
}

/**
 * Handle file upload
 */
async function handleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) {
        showUploadStatus('Please select a file', 'error');
        return;
    }
    
    // Check file type and size, show appropriate message
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
    const isLarge = file.size > 2 * 1024 * 1024; // > 2MB
    
    let statusMessage = 'Uploading...';
    if (isPDF) {
        statusMessage = isLarge 
            ? `Processing large PDF (${fileSizeMB}MB)... This may take up to 60 seconds.`
            : `Processing PDF (${fileSizeMB}MB)...`;
    } else if (isLarge) {
        statusMessage = `Uploading large file (${fileSizeMB}MB)...`;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    showUploadStatus(statusMessage, 'info');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData,
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showUploadStatus(
                `Success! Processed ${result.chunkCount} chunks.`, 
                'success'
            );
            fileInput.value = '';
            loadFileList();
        } else {
            showUploadStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        showUploadStatus(`Upload failed: ${error.message}`, 'error');
    }
}

/**
 * Handle paste text submission
 */
async function handlePasteText() {
    const pasteInput = document.getElementById('pasteInput');
    const content = pasteInput.value.trim();
    
    if (!content) {
        showUploadStatus('Please enter some text', 'error');
        return;
    }
    
    showUploadStatus('Processing...', 'info');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content,
                fileName: 'pasted_text.txt',
                fileType: 'text/plain',
            }),
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showUploadStatus(
                `Success! Processed ${result.chunkCount} chunks.`, 
                'success'
            );
            pasteInput.value = '';
            loadFileList();
        } else {
            showUploadStatus(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        showUploadStatus(`Processing failed: ${error.message}`, 'error');
    }
}

/**
 * Handle send query
 */
async function handleSendQuery() {
    const queryInput = document.getElementById('queryInput');
    const query = queryInput.value.trim();
    
    if (!query) {
        return;
    }
    
    // Add user message to UI
    addMessage('user', query);
    queryInput.value = '';
    
    // Show loading indicator
    const loadingId = addMessage('assistant', 'Thinking...', true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                sessionId: sessionId,
            }),
        });
        
        const result = await response.json();
        
        // Remove loading message
        removeMessage(loadingId);
        
        if (response.ok) {
            // Add assistant response
            addMessage('assistant', result.answer);
            
            // Show sources if available
            if (result.sources && result.sources.length > 0) {
                addSources(result.sources);
            }
        } else {
            addMessage('assistant', `Error: ${result.error}`, false, true);
        }
    } catch (error) {
        removeMessage(loadingId);
        addMessage('assistant', `Error: ${error.message}`, false, true);
    }
}

/**
 * Handle clear conversation
 */
async function handleClearConversation() {
    if (confirm('Are you sure you want to clear the conversation?')) {
        try {
            await fetch(`${API_BASE_URL}/api/conversation/clear`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: sessionId,
                }),
            });
            
            // Clear messages in UI
            document.getElementById('messages').innerHTML = `
                <div class="text-center text-gray-500 text-sm py-8">
                    Conversation cleared. Start a new conversation by asking a question.
                </div>
            `;
        } catch (error) {
            console.error('Failed to clear conversation:', error);
        }
    }
}

/**
 * Load file list
 */
async function loadFileList() {
    const fileList = document.getElementById('fileList');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/files`);
        const result = await response.json();
        
        if (response.ok && result.files && result.files.length > 0) {
            fileList.innerHTML = result.files.map(file => `
                <div class="file-item p-3 rounded border border-gray-200 flex justify-between items-start">
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm truncate">${file.fileName}</div>
                        <div class="text-xs text-gray-500">
                            ${file.chunkCount} chunks • 
                            ${formatDate(file.uploadedAt)} • 
                            <span class="text-${file.status === 'completed' ? 'green' : file.status === 'processing' ? 'yellow' : 'red'}-600">
                                ${file.status}
                            </span>
                            ${file.error ? `<br><span class="text-red-500">Error: ${file.error}</span>` : ''}
                        </div>
                    </div>
                    <button 
                        onclick="deleteFile('${file.fileId}', '${file.fileName}')" 
                        class="ml-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded p-1 transition-colors"
                        title="Delete file"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            `).join('');
        } else {
            fileList.innerHTML = '<p class="text-gray-500 text-sm">No files uploaded yet</p>';
        }
    } catch (error) {
        fileList.innerHTML = '<p class="text-red-500 text-sm">Failed to load files</p>';
        console.error('Failed to load file list:', error);
    }
}

/**
 * Add message to chat
 */
function addMessage(role, content, isLoading = false, isError = false) {
    const messagesDiv = document.getElementById('messages');
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const messageClass = role === 'user' 
        ? 'bg-blue-600 text-white ml-auto max-w-3xl' 
        : `bg-gray-100 text-gray-800 mr-auto max-w-3xl ${isError ? 'border border-red-300' : ''}`;
    
    const loadingClass = isLoading ? 'loading-dots' : '';
    
    const messageDiv = document.createElement('div');
    messageDiv.id = messageId;
    messageDiv.className = `message ${messageClass} p-4 rounded-lg ${loadingClass}`;
    messageDiv.textContent = content;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return messageId;
}

/**
 * Remove message from chat
 */
function removeMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
        message.remove();
    }
}

/**
 * Add sources to chat
 */
function addSources(sources) {
    const messagesDiv = document.getElementById('messages');
    
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'message bg-yellow-50 border border-yellow-200 p-3 rounded-lg mr-auto max-w-3xl';
    
    sourcesDiv.innerHTML = `
        <div class="text-sm font-semibold text-yellow-800 mb-2">Sources:</div>
        <div class="space-y-1">
            ${sources.map((source, idx) => `
                <div class="text-xs text-yellow-700">
                    ${idx + 1}. ${source.fileName} (score: ${source.score.toFixed(3)})
                </div>
            `).join('')}
        </div>
    `;
    
    messagesDiv.appendChild(sourcesDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Show upload status
 */
function showUploadStatus(message, type) {
    const statusDiv = document.getElementById('uploadStatus');
    statusDiv.className = `text-sm ${type === 'success' ? 'text-green-600' : type === 'error' ? 'text-red-600' : 'text-blue-600'}`;
    statusDiv.textContent = message;
    statusDiv.classList.remove('hidden');
    
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusDiv.classList.add('hidden');
        }, 5000);
    }
}

/**
 * Format date
 */
function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * Delete a file
 */
async function deleteFile(fileId, fileName) {
    if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        showUploadStatus('Deleting file...', 'info');
        
        const response = await fetch(`${API_BASE_URL}/api/files/delete?fileId=${fileId}`, {
            method: 'DELETE',
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showUploadStatus(`Successfully deleted "${fileName}"`, 'success');
            loadFileList(); // Refresh the file list
        } else {
            showUploadStatus(`Failed to delete file: ${result.error}`, 'error');
        }
    } catch (error) {
        showUploadStatus(`Delete failed: ${error.message}`, 'error');
        console.error('Delete error:', error);
    }
}

/**
 * Cleanup orphaned chunks (chunks from deleted files)
 */
async function handleCleanupOrphaned() {
    if (!confirm('This will remove all data chunks from deleted files. Continue?')) {
        return;
    }
    
    try {
        showUploadStatus('Cleaning up orphaned data...', 'info');
        
        const response = await fetch(`${API_BASE_URL}/api/admin/cleanup`, {
            method: 'POST',
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showUploadStatus(
                `Cleanup complete! ${result.orphanedChunksDeleted} orphaned chunks removed. ${result.remainingChunks} chunks remain.`, 
                'success'
            );
            console.log('Cleanup result:', result);
        } else {
            showUploadStatus(`Cleanup failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showUploadStatus(`Cleanup failed: ${error.message}`, 'error');
        console.error('Cleanup error:', error);
    }
}

/**
 * Debug chunks - show what's in storage
 */
async function handleDebugChunks() {
    try {
        showUploadStatus('Getting debug info...', 'info');
        
        const response = await fetch(`${API_BASE_URL}/api/debug/chunks`);
        const result = await response.json();
        
        if (response.ok) {
            console.log('Debug chunks result:', result);
            showUploadStatus(
                `Debug info logged to console. ${result.totalChunks} total chunks found.`, 
                'success'
            );
            
            // Also show a summary in an alert for quick viewing
            const fileIds = Object.keys(result.chunksByFile);
            alert(`Debug Info:\n\nTotal chunks: ${result.totalChunks}\nFiles with chunks: ${fileIds.length}\n\nFile IDs with chunks:\n${fileIds.join(', ')}\n\nCheck console for detailed breakdown.`);
        } else {
            showUploadStatus(`Debug failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showUploadStatus(`Debug failed: ${error.message}`, 'error');
        console.error('Debug error:', error);
    }
}

