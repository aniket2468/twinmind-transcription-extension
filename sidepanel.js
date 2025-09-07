class TranscriptionSidepanel {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessionStartTime = null;
    this.pausedTime = 0;
    this.timerInterval = null;
    this.transcriptions = [];
    this.port = null;
    
    this.initializeElements();
    this.setupEventListeners();
    this.setupConnectivityMonitoring();
    this.connectToBackground();
  }

  initializeElements() {
    // Main controls
    this.startBtn = document.getElementById('startBtn');
    this.pauseBtn = document.getElementById('pauseBtn');
    this.resumeBtn = document.getElementById('resumeBtn');
    this.stopBtn = document.getElementById('stopBtn');
    
    // Status elements
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    
    // API configuration
    this.apiConfig = document.getElementById('apiConfig');
    this.configContent = document.getElementById('configContent');
    this.toggleConfig = document.getElementById('toggleConfig');
    this.geminiKey = document.getElementById('geminiKey');
    this.saveKey = document.getElementById('saveKey');
    
    // Session info
    this.sessionInfo = document.getElementById('sessionInfo');
    this.timer = document.getElementById('timer');
    this.tabTitle = document.getElementById('tabTitle');
    
    // Transcription elements
    this.transcriptionContent = document.getElementById('transcriptionContent');
    this.placeholder = document.getElementById('placeholder');
    
    // Export controls
    this.copyBtn = document.getElementById('copyBtn');
    this.downloadBtn = document.getElementById('downloadBtn');
    this.downloadJsonBtn = document.getElementById('downloadJsonBtn');
    this.clearBtn = document.getElementById('clearBtn');
    
    // Error elements
    this.errorContainer = document.getElementById('errorContainer');
    this.errorText = document.getElementById('errorText');
    this.errorClose = document.getElementById('errorClose');
  }

  setupEventListeners() {
    // Recording controls
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.pauseBtn.addEventListener('click', () => this.pauseRecording());
    this.resumeBtn.addEventListener('click', () => this.resumeRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    
    // API configuration
    this.toggleConfig.addEventListener('click', () => this.toggleConfigPanel());
    this.saveKey.addEventListener('click', () => this.saveApiKey());
    
    // Export controls
    this.copyBtn.addEventListener('click', () => this.copyTranscript());
    this.downloadBtn.addEventListener('click', () => this.downloadTranscript());
    this.downloadJsonBtn.addEventListener('click', () => this.downloadTranscriptJson());
    this.clearBtn.addEventListener('click', () => this.clearTranscript());
    
    // Error handling
    this.errorClose.addEventListener('click', () => this.hideError());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'r') {
          e.preventDefault();
          if (this.isRecording) {
            this.stopRecording();
          } else {
            this.startRecording();
          }
        }
      }
    });
  }

  connectToBackground() {
    // Use a persistent port connection for all control messages
    this.port = chrome.runtime.connect({ name: 'sidepanel' });
    this.port.onMessage.addListener((msg) => this.handleBackgroundMessage(msg));
    this.port.onDisconnect.addListener(() => {
      this.updateStatus('disconnected', 'Background script disconnected');
      this.showError('Connection Error', 'Background script disconnected. Please reload the extension.');
    });
    // Optionally, send a ping or handshake message if needed
    this.updateStatus('ready', 'Ready');
    console.log('✅ Persistent port connection established');
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case 'connection_test_response':
        this.updateStatus('ready', 'Ready');
        break;
      case 'recording_started':
        this.handleRecordingStarted(message.data);
        break;
      case 'recording_paused':
        this.handleRecordingPaused(message.data);
        break;
      case 'recording_resumed':
        this.handleRecordingResumed(message.data);
        break;
      case 'recording_stopped':
        this.handleRecordingStopped(message.data);
        break;
      case 'transcription_update':
        this.handleTranscriptionUpdate(message.data);
        break;
      case 'transcription_error':
        this.handleTranscriptionError(message.data);
        break;
      case 'tab_info':
        this.updateTabInfo(message.data);
        break;
      case 'error':
        this.showError(message.data.title, message.data.message);
        break;
    }
  }

  async startRecording() {
    try {
      if (this.isRecording) return;
      this.updateStatus('processing', 'Starting...');
      if (!this.port) {
        this.showError('Connection Error', 'Not connected to background script.');
        this.updateStatus('disconnected', 'Disconnected');
        return;
      }
      // Debug: Log current tab info
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) {
          console.log('[DEBUG] Attempting to start recording on tab:', tabs[0].id, tabs[0].url);
        } else {
          console.log('[DEBUG] No active tab found.');
        }
      } catch (e) {
        console.log('[DEBUG] Could not query tabs:', e);
      }
      this.port.postMessage({ type: 'start_recording' });
    } catch (error) {
      this.showError('Start Failed', error.message);
    }
  }

  async pauseRecording() {
    try {
      if (!this.isRecording || this.isPaused) return;
      this.isPaused = true;
      this.pausedTime = Date.now();
      this.updateStatus('paused', 'Paused');
      this.updateControls('paused');
      if (this.port) {
        this.port.postMessage({ type: 'pause_recording' });
      }
    } catch (error) {
      this.showError('Pause Failed', error.message);
    }
  }

  async resumeRecording() {
    try {
      if (!this.isRecording || !this.isPaused) return;
      this.isPaused = false;
      const pauseDuration = Date.now() - this.pausedTime;
      this.sessionStartTime += pauseDuration; // Adjust start time
      this.updateStatus('recording', 'Recording');
      this.updateControls('recording');
      if (this.port) {
        this.port.postMessage({ type: 'resume_recording' });
      }
    } catch (error) {
      this.showError('Resume Failed', error.message);
    }
  }

  async stopRecording() {
    try {
      if (!this.isRecording) return;
      this.updateStatus('processing', 'Stopping...');
      if (this.port) {
        this.port.postMessage({ type: 'stop_recording' });
      }
    } catch (error) {
      this.showError('Stop Failed', error.message);
    }
  }

  handleRecordingStarted(data) {
    this.isRecording = true;
    this.sessionStartTime = Date.now();
    
    this.updateStatus('recording', 'Recording');
    this.updateControls(true);
    this.startTimer();
    this.showSessionInfo();
    this.hidePlaceholder();
    
    if (data.tabTitle) {
      this.updateTabInfo({ title: data.tabTitle });
    }
  }

  handleRecordingPaused(data) {
    this.isPaused = true;
    this.pausedTime = Date.now();
    
    this.updateStatus('paused', 'Paused');
    this.updateControls('paused');
  }

  handleRecordingResumed(data) {
    this.isPaused = false;
    const pauseDuration = Date.now() - this.pausedTime;
    this.sessionStartTime += pauseDuration; // Adjust start time
    
    this.updateStatus('recording', 'Recording');
    this.updateControls('recording');
  }

  handleRecordingStopped(data) {
    this.isRecording = false;
    this.isPaused = false;
    this.sessionStartTime = null;
    this.pausedTime = 0;
    
    this.updateStatus('ready', 'Ready');
    this.updateControls('stopped');
    this.stopTimer();
    this.hideSessionInfo();
    
    if (this.transcriptions.length === 0) {
      this.showPlaceholder();
    }
  }

  handleTranscriptionUpdate(data) {
    // Add to transcriptions array
    this.transcriptions.push({
      id: data.chunkId,
      text: data.text,
      timestamp: data.timestamp,
      provider: data.provider,
      confidence: data.confidence
    });
    
    // Add to UI
    this.addTranscriptionItem(data);
    
    // Enable export controls
    this.updateExportControls(true);
    
    // Scroll to bottom
    this.scrollToBottom();
  }

  handleTranscriptionError(data) {
    this.addErrorItem(data);
    // User-friendly error for tab capture issues
    if (data && data.error && data.error.includes('Extension has not been invoked for the current page')) {
      this.showError(
        'Tab Capture Not Allowed',
        'Chrome is blocking audio capture for this tab.\n\nHow to fix:\n' +
        '- Make sure you are on a regular website (not a chrome:// or extension page).\n' +
        '- Open the sidepanel or click the extension icon while on the tab you want to record.\n' +
        '- Set site access to "On all sites" in chrome://extensions/.\n' +
        '- Reload the tab and extension, then try again.\n' +
        '- If you still see this error, try a new Chrome profile or another device.\n\n' +
        'See the extension README for more troubleshooting tips.'
      );
      console.log('[DEBUG] Tab capture error details:', data.error);
    }
  }

  addTranscriptionItem(data) {
    const item = document.createElement('div');
    item.className = 'transcription-item';
    item.dataset.id = data.chunkId;
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    const provider = this.getProviderText(data.provider);
    
    item.innerHTML = `
      <div class="transcription-text">${data.text}</div>
      <div class="transcription-meta">
        <span class="transcription-timestamp">${timestamp}</span>
        <span class="badge provider">${provider}</span>
      </div>
    `;
    
    this.transcriptionContent.appendChild(item);
  }

  addErrorItem(data) {
    const item = document.createElement('div');
    item.className = 'transcription-item error';
    
    item.innerHTML = `
      <div class="transcription-text">❌ ${data.error}</div>
      <div class="transcription-meta">
        <span class="transcription-timestamp">${new Date().toLocaleTimeString()}</span>
      </div>
    `;
    
    this.transcriptionContent.appendChild(item);
  }

  getProviderText(provider) {
    switch (provider) {
      case 'gemini': return '🤖 Gemini';
      case 'web-speech': return '🎤 Web Speech';
      case 'fallback': return '📊 Analysis';
      case 'offline-queue': return '⏳ Queued';
      default: return '🎤 Audio';
    }
  }

  updateStatus(type, text) {
    this.statusDot.className = `status-dot ${type}`;
    this.statusText.textContent = text;
  }

  updateControls(state) {
    switch (state) {
      case 'recording':
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        this.resumeBtn.disabled = true;
        this.stopBtn.disabled = false;
        break;
      case 'paused':
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = true;
        this.resumeBtn.disabled = false;
        this.stopBtn.disabled = false;
        break;
      case 'stopped':
      default:
        this.startBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.resumeBtn.disabled = true;
        this.stopBtn.disabled = true;
        break;
    }
  }

  updateExportControls(enabled) {
    this.copyBtn.disabled = !enabled;
    this.downloadBtn.disabled = !enabled;
    this.downloadJsonBtn.disabled = !enabled;
    this.clearBtn.disabled = !enabled;
  }

  updateTabInfo(data) {
    this.tabTitle.textContent = data.title || 'Current Tab';
  }

  showSessionInfo() {
    this.sessionInfo.style.display = 'flex';
  }

  hideSessionInfo() {
    this.sessionInfo.style.display = 'none';
  }

  showPlaceholder() {
    this.placeholder.style.display = 'flex';
  }

  hidePlaceholder() {
    this.placeholder.style.display = 'none';
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      if (this.sessionStartTime) {
        const elapsed = Date.now() - this.sessionStartTime;
        this.timer.textContent = this.formatTime(elapsed);
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.timer.textContent = '00:00:00';
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    return [
      hours.toString().padStart(2, '0'),
      (minutes % 60).toString().padStart(2, '0'),
      (seconds % 60).toString().padStart(2, '0')
    ].join(':');
  }

  scrollToBottom() {
    this.transcriptionContent.scrollTop = this.transcriptionContent.scrollHeight;
  }

  async copyTranscript() {
    try {
      const text = this.transcriptions.map(t => t.text).join('\n\n');
      await navigator.clipboard.writeText(text);
      this.showNotification('Copied to clipboard');
    } catch (error) {
      this.showError('Copy Failed', error.message);
    }
  }

  async downloadTranscript() {
    try {
      const text = this.transcriptions.map(t => t.text).join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showNotification('Download started');
    } catch (error) {
      this.showError('Download Failed', error.message);
    }
  }

  async downloadTranscriptJson() {
    try {
      const jsonData = {
        session: {
          startTime: this.sessionStartTime,
          endTime: Date.now(),
          duration: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0,
          totalChunks: this.transcriptions.length
        },
        transcriptions: this.transcriptions.map(t => ({
          id: t.id,
          text: t.text,
          timestamp: t.timestamp,
          provider: t.provider,
          confidence: t.confidence,
          formattedTime: new Date(t.timestamp).toLocaleTimeString()
        }))
      };
      
      const jsonString = JSON.stringify(jsonData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showNotification('JSON download started');
    } catch (error) {
      this.showError('JSON Download Failed', error.message);
    }
  }

  clearTranscript() {
    this.transcriptions = [];
    this.transcriptionContent.innerHTML = '';
    this.showPlaceholder();
    this.updateExportControls(false);
    this.showNotification('Transcript cleared');
  }

  showError(title, message) {
    this.errorText.textContent = `${title}: ${message}`;
    this.errorContainer.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => this.hideError(), 5000);
  }

  hideError() {
    this.errorContainer.style.display = 'none';
  }

  showNotification(message) {
    // Simple notification - could be enhanced with a proper notification system
    console.log('Notification:', message);
  }

  // ============================================================================
  // API CONFIGURATION
  // ============================================================================

  toggleConfigPanel() {
    const isVisible = this.configContent.style.display !== 'none';
    this.configContent.style.display = isVisible ? 'none' : 'block';
    this.toggleConfig.innerHTML = isVisible ? 
      '<span class="btn-icon">⚙️</span> Configure' : 
      '<span class="btn-icon">✖️</span> Close';
  }

  async saveApiKey() {
    try {
      const apiKey = this.geminiKey.value.trim();
      
      chrome.runtime.sendMessage({
        type: 'set_gemini_key',
        apiKey: apiKey
      }, (response) => {
        if (chrome.runtime.lastError) {
          this.showError('Save Failed', chrome.runtime.lastError.message);
        } else if (response && response.success) {
          this.showNotification('API key saved successfully');
          this.toggleConfigPanel();
        } else {
          this.showError('Save Failed', response?.error || 'Unknown error');
        }
      });
      
    } catch (error) {
      this.showError('Save Failed', error.message);
    }
  }

  setupConnectivityMonitoring() {
    // Monitor online/offline status and notify background
    window.addEventListener('online', () => {
      this.sendMessageToBackground({
        type: 'connectivity_change',
        isOnline: true
      });
    });
    
    window.addEventListener('offline', () => {
      this.sendMessageToBackground({
        type: 'connectivity_change',
        isOnline: false
      });
    });
  }

  async sendMessageToBackground(message) {
    return new Promise((resolve) => {
      if (this.port) {
        // Set up a one-time listener for the response
        const responseHandler = (response) => {
          if (response.type === 'api_key_response') {
            this.port.onMessage.removeListener(responseHandler);
            resolve(response.data);
          }
        };
        
        this.port.onMessage.addListener(responseHandler);
        this.port.postMessage(message);
        
        // Timeout after 5 seconds
        setTimeout(() => {
          this.port.onMessage.removeListener(responseHandler);
          resolve({ success: false, error: 'Request timeout' });
        }, 5000);
      } else {
        resolve({ success: false, error: 'Not connected' });
      }
    });
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new TranscriptionSidepanel();
});