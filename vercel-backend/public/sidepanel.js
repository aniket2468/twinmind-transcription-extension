console.log('🎯 Sidepanel Initialized');

class TranscriptionSidepanel {
  constructor() {
    this.port = null;
    this.isConnected = false;
    this.isRecording = false;
    this.currentSession = null;
    this.transcriptions = [];
    this.sessionStartTime = null;
    this.timerInterval = null;
    this.isOnline = true;
    this.audioSources = new Map();
    this.offlineQueue = [];
    this.retryAttempts = 0;
    
    this.initializeElements();
    this.setupEventListeners();
    this.connectToBackground();
    
    // Wait for connection before starting timer
    this.waitForConnection();
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  waitForConnection() {
    const checkConnection = () => {
      if (this.isConnected) {
        console.log('✅ Connection established, starting session timer');
        this.startSessionTimer();
        this.updateConnectionStatus(true);
      } else {
        console.log('⏳ Waiting for connection...');
        setTimeout(checkConnection, 100);
      }
    };
    
    checkConnection();
  }

  initializeElements() {
    // Core controls
    this.startButton = document.getElementById('startRecording');
    this.stopButton = document.getElementById('stopRecording');
    
    // Status indicators
    this.recordingStatus = document.getElementById('recordingStatus');
    this.connectionStatus = document.getElementById('connectionStatus');
    this.connectionDot = document.getElementById('connectionDot');
    this.connectionText = document.getElementById('connectionText');
    this.queuedRequests = document.getElementById('queuedRequests');
    
    // Session info
    this.sessionTimer = document.getElementById('sessionTimer');
    this.segmentCount = document.getElementById('segmentCount');
    
    // Audio sources
    this.audioSourcesContainer = document.getElementById('audioSources');
    this.tabAudioSource = document.getElementById('tabAudioSource');
    this.micAudioSource = document.getElementById('micAudioSource');
    
    // Transcription display
    this.transcriptionContainer = document.getElementById('transcriptionContainer');
    this.transcriptionList = document.getElementById('transcriptionList');
    
    // Export controls
    this.copyButton = document.getElementById('copyText');
    this.downloadButton = document.getElementById('downloadText');
    this.clearButton = document.getElementById('clearText');
    
    // Settings controls
    this.transcriptionMethodSelect = document.getElementById('transcriptionMethod');
    this.customPromptTextarea = document.getElementById('customPrompt');
    this.promptSetting = document.getElementById('promptSetting');
    
    // Audio detection controls
    this.refreshAudioDetectionButton = document.getElementById('refreshAudioDetection');
    
    // Error display
    this.errorContainer = document.getElementById('errorContainer');
  }

  setupEventListeners() {
    // Recording controls
    this.startButton.addEventListener('click', () => this.startRecording());
    this.stopButton.addEventListener('click', () => this.stopRecording());
    
    // Export controls
    this.copyButton.addEventListener('click', () => this.copyTranscript());
    this.downloadButton.addEventListener('click', () => this.downloadTranscript());
    this.clearButton.addEventListener('click', () => this.clearTranscript());
    
    // Settings controls
    this.transcriptionMethodSelect.addEventListener('change', () => this.handleTranscriptionMethodChange());
    this.customPromptTextarea.addEventListener('input', () => this.handleCustomPromptChange());
    
    // Audio detection controls
    this.refreshAudioDetectionButton.addEventListener('click', () => this.refreshAudioDetection());
    
    // Online/offline detection
    window.addEventListener('online', () => this.handleOnlineStatus(true));
    window.addEventListener('offline', () => this.handleOnlineStatus(false));
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  // ============================================================================
  // BACKGROUND CONNECTION
  // ============================================================================

  connectToBackground() {
    try {
      console.log('🔌 Attempting to connect to background script...');
      
      this.port = chrome.runtime.connect({ name: 'sidepanel' });

      // Set up message listener
      this.port.onMessage.addListener((message) => {
        try {
          console.log('📨 Sidepanel received message from background:', message.type);
        this.handleBackgroundMessage(message);
        } catch (error) {
          console.error('❌ Error handling background message:', error);
        }
      });

      // Set up disconnect listener
      this.port.onDisconnect.addListener(() => {
        console.log('🔌 Disconnected from background script');
        this.isConnected = false;
        this.updateConnectionStatus(false);
        
        // Try to reconnect after a delay
        setTimeout(() => {
          if (!this.isConnected) {
            console.log('🔄 Attempting to reconnect...');
            this.connectToBackground();
          }
        }, 2000);
      });
      
      // Wait for connection to be established
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          console.warn('⚠️ Connection timeout, marking as connected anyway');
          this.isConnected = true;
          this.updateConnectionStatus(true);
          this.startHeartbeat();
        }
      }, 5000);
      
      // Listen for connection establishment
      const connectionHandler = (message) => {
        if (message.type === 'connection_established') {
          clearTimeout(connectionTimeout);
          this.port.onMessage.removeListener(connectionHandler);
          this.isConnected = true;
          this.updateConnectionStatus(true);
          this.handleConnectionEstablished(message.data);
          this.startHeartbeat();
          console.log('✅ Connection established successfully');
        }
      };
      
      this.port.onMessage.addListener(connectionHandler);
      
    } catch (error) {
      console.error('❌ Failed to connect to background:', error);
      this.showError('Connection failed', error.message);
      
      // Retry connection after delay
      setTimeout(() => {
        this.connectToBackground();
      }, 3000);
    }
  }
  
  startHeartbeat() {
    // Send heartbeat every 60 seconds to keep connection alive
    this.heartbeatInterval = setInterval(() => {
      if (this.port && this.isConnected) {
        try {
          this.port.postMessage({ type: 'heartbeat', timestamp: Date.now() });
        } catch (error) {
          console.warn('⚠️ Heartbeat failed:', error);
          // Connection might be broken, but don't reconnect immediately
          // Let the disconnect handler handle reconnection
          this.isConnected = false;
        }
      }
    }, 60000); // 60 seconds - less frequent
  }
  
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  // Cleanup method
  cleanup() {
    this.stopHeartbeat();
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (error) {
        console.warn('⚠️ Error during cleanup:', error);
      }
    }
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  handleBackgroundMessage(message) {
    try {
      console.log('📨 Sidepanel received message:', message.type);

    switch (message.type) {
        case 'connection_established':
          this.handleConnectionEstablished(message.data);
          break;
          
      case 'recording_started':
          this.handleRecordingStarted(message.data);
        break;

      case 'recording_stopped':
          this.handleRecordingStopped(message.data);
          break;
          
        case 'recording_error':
          this.handleRecordingError(message.data);
          break;
          
        case 'recording_started_ack':
          console.log('✅ Recording start acknowledged by background');
          break;
          
        case 'recording_stopped_ack':
          console.log('✅ Recording stop acknowledged by background');
          break;
          
        case 'heartbeat_ack':
          console.log('💓 Heartbeat acknowledged by background');
          break;
          
        case 'settings_updated':
          console.log('✅ Transcription settings updated successfully');
          this.showNotification('Settings Updated', 'Transcription settings have been updated', 'success');
          break;
          
        case 'settings_error':
          console.error('❌ Failed to update transcription settings:', message.data.error);
          this.showError('Settings Error', message.data.error);
          break;
          
        case 'audio_detection_refreshed':
          console.log('✅ Audio detection refreshed:', message.data.audioInfo);
          this.updateAudioSourcesFromSession({ audioInfo: message.data.audioInfo });
          this.showNotification('Audio Detection', 'Audio detection refreshed successfully', 'success');
          break;
          
        case 'audio_detection_error':
          console.error('❌ Audio detection refresh failed:', message.data.error);
          this.showError('Audio Detection Error', message.data.error);
        break;

      case 'transcription_update':
        this.handleTranscriptionUpdate(message.data);
        break;

        case 'transcription_error':
          this.handleTranscriptionError(message.data);
          break;
          
        case 'capture_started':
          this.handleCaptureStarted(message.data);
          break;
          
        case 'capture_stopped':
          this.handleCaptureStopped(message.data);
          break;
          
        case 'capture_error':
          this.handleCaptureError(message.data);
          break;
          
        case 'audio_sources_update':
          this.handleAudioSourcesUpdate(message.data);
          break;
          
        case 'connectivity_change':
          this.handleConnectivityChange(message.data);
          break;
          
        case 'queue_status_update':
          this.handleQueueStatusUpdate(message.data);
          break;
          
        case 'export_success':
          this.handleExportSuccess(message.data);
          break;
          
        case 'export_error':
          this.handleExportError(message.data);
          break;
          
        case 'clear_success':
          this.handleClearSuccess(message.data);
          break;
          
        case 'clear_error':
          this.handleClearError(message.data);
        break;

              case 'heartbeat_response':
        case 'heartbeat_ack':
          // Ignore heartbeat responses silently
          break;
          
        default:
          console.warn('⚠️ Unknown message type:', message.type);
      }
      
    } catch (error) {
      console.error('❌ Error handling background message:', error);
    }
  }

  // ============================================================================
  // RECORDING CONTROL
  // ============================================================================

  async startRecording() {
    try {
      if (this.isRecording) {
        this.showError('Already Recording', 'A recording session is already in progress.');
        return;
      }
      
      if (!this.port || !this.isConnected) {
        this.showError('Connection Error', 'Not connected to background service. Please wait and try again.');
        return;
      }
      
      console.log('🎬 Starting recording...');
      this.updateRecordingStatus('starting');
      
      // Send start message to background and wait for response
      try {
        this.port.postMessage({ 
          type: 'start_recording',
          id: Date.now() // Add unique ID for tracking
        });
        
        // Wait a bit for the background to process
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (portError) {
        console.error('❌ Port communication error:', portError);
        this.showError('Communication Error', 'Failed to send message to background service');
        return;
      }
      
    } catch (error) {
      console.error('❌ Failed to start recording:', error);
      this.showError('Start Failed', error.message);
    }
  }

  async stopRecording() {
    try {
      if (!this.isRecording) {
        this.showError('Not Recording', 'No recording session is in progress.');
        return;
      }
      
      if (!this.port || !this.isConnected) {
        this.showError('Connection Error', 'Not connected to background service. Please wait and try again.');
        return;
      }
      
      console.log('🛑 Stopping recording...');
      this.updateRecordingStatus('stopping');
      
      // Send stop message to background and wait for response
      try {
        this.port.postMessage({ 
          type: 'stop_recording',
          id: Date.now() // Add unique ID for tracking
        });
        
        // Wait a bit for the background to process
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (portError) {
        console.error('❌ Port communication error:', portError);
        this.showError('Communication Error', 'Failed to send message to background service');
        return;
      }
      
    } catch (error) {
      console.error('❌ Failed to stop recording:', error);
      this.showError('Stop Failed', error.message);
    }
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  handleConnectionEstablished(data) {
    console.log('🔌 Connection established with background');
    
    // Update state from background
    this.isRecording = data.isRecording;
    this.currentSession = data.sessionInfo;
    this.audioSources = new Map(data.audioSources.map(s => [s.id, s]));
    this.isOnline = data.isOnline;
    
    // Update UI
    this.updateRecordingStatus(this.isRecording ? 'recording' : 'stopped');
    this.updateConnectionStatus(this.isOnline);
    this.updateAudioSources();
    this.updateQueueStatus(data.queueStatus);
    
    // Update audio sources from session info if available
    if (data.sessionInfo && data.sessionInfo.audioInfo) {
      this.updateAudioSourcesFromSession(data.sessionInfo);
    }
    
    // Start session timer if recording
    if (this.isRecording && this.currentSession) {
      this.startSessionTimer();
    }
    
    // Show success notification
    this.showNotification('Connected', 'Successfully connected to transcription service', 'success');
  }

  handleRecordingStarted(data) {
    console.log('✅ Recording started:', data);
    
    this.isRecording = true;
    this.currentSession = {
      id: data.sessionId,
      startTime: data.startTime,
      tabTitle: data.tabTitle
    };
    this.sessionStartTime = data.startTime;
    this.transcriptions = [];
    
    this.updateRecordingStatus('recording');
    this.startSessionTimer();
    this.updateAudioSources(data.audioSources);
    
    // Show success notification
    this.showNotification('Recording Started', `Now transcribing: ${data.tabTitle}`, 'success');
  }

  handleRecordingStopped(data) {
    console.log('🛑 Recording stopped:', data);
    
    this.isRecording = false;
    if (this.currentSession) {
      this.currentSession.endTime = data.endTime;
      this.currentSession.duration = data.duration;
    }
    
    this.updateRecordingStatus('stopped');
    this.stopSessionTimer();
    this.updateAudioSources([]);
    
    // Show completion notification
    this.showNotification('Recording Complete', 
      `Session ended with ${data.transcriptionCount} transcriptions`, 'success');
  }

  handleRecordingError(data) {
    console.error('❌ Recording error:', data);
    
    this.isRecording = false;
    this.updateRecordingStatus('error');
    this.showError('Recording Error', data.error);
  }

  handleTranscriptionUpdate(data) {
    console.log('📝 Transcription update:', data);
    
    // Add to transcriptions list
    this.transcriptions.push({
      id: data.chunkId,
      text: data.text,
      timestamp: data.timestamp,
      provider: data.provider,
      confidence: data.confidence,
      hasOverlap: data.hasOverlap,
      duration: data.duration
    });
    
    // Update UI
    this.addTranscriptionToUI(data);
    this.updateSegmentCount();
    this.scrollToBottom();
    
    // Enable export buttons
    this.updateExportButtons(true);
  }

  handleTranscriptionError(data) {
    console.error('❌ Transcription error:', data);
    
    // Add error to UI
    this.addTranscriptionErrorToUI(data);
    this.updateSegmentCount();
  }

  handleCaptureStarted(data) {
    console.log('🎬 Capture started:', data);
    this.updateAudioSources(data.audioSources);
  }

  handleCaptureStopped(data) {
    console.log('🛑 Capture stopped:', data);
    this.updateAudioSources([]);
  }

  handleCaptureError(data) {
    console.error('❌ Capture error:', data);
    this.showError('Capture Error', data.error);
  }

  handleAudioSourcesUpdate(data) {
    console.log('🔊 Audio sources update:', data);
    this.updateAudioSources(data);
  }

  handleConnectivityChange(data) {
    console.log('🌐 Connectivity changed:', data);
    this.isOnline = data.isOnline;
    this.updateConnectionStatus(this.isOnline);
    
    if (this.isOnline) {
      this.showNotification('Connection Restored', 'Processing offline queue...', 'info');
    } else {
      this.showNotification('Connection Lost', 'Transcriptions will be queued offline', 'warning');
    }
  }

  handleConnectionError(data) {
    console.error('❌ Connection error from background:', data);
    this.showError('Connection Error', data.message || 'Unknown connection error');
    
    // Try to reconnect
    setTimeout(() => {
      if (!this.isConnected) {
        console.log('🔄 Attempting to reconnect after error...');
        this.connectToBackground();
      }
    }, 3000);
  }

  handleQueueStatusUpdate(data) {
    console.log('📦 Queue status update:', data);
    this.updateQueueStatus(data);
  }

  // ============================================================================
  // UI UPDATES
  // ============================================================================

  updateRecordingStatus(status) {
    const statusMap = {
      'stopped': { text: 'Ready to Record', class: 'status-ready', icon: '🎙️' },
      'starting': { text: 'Starting...', class: 'status-starting', icon: '⏳' },
      'recording': { text: 'Recording...', class: 'status-recording', icon: '🔴' },
      'stopping': { text: 'Stopping...', class: 'status-stopping', icon: '⏳' },
      'error': { text: 'Error', class: 'status-error', icon: '❌' }
    };
    
    const statusInfo = statusMap[status] || statusMap['stopped'];
    
    this.recordingStatus.textContent = `${statusInfo.icon} ${statusInfo.text}`;
    this.recordingStatus.className = `status ${statusInfo.class}`;
    
    // Update button states
    this.startButton.disabled = status === 'recording' || status === 'starting';
    this.stopButton.disabled = status !== 'recording';
  }

  updateConnectionStatus(isOnline) {
    this.isOnline = isOnline;
    
    if (isOnline) {
      this.connectionDot.className = 'connection-dot online';
      this.connectionText.textContent = 'Online';
      this.connectionText.className = 'connection-text online';
    } else {
      this.connectionDot.className = 'connection-dot offline';
      this.connectionText.textContent = 'Offline';
      this.connectionText.className = 'connection-text offline';
    }
  }

  updateQueueStatus(queueStatus) {
    if (queueStatus.pending > 0) {
      this.queuedRequests.textContent = `${queueStatus.pending} pending`;
      this.queuedRequests.style.display = 'block';
    } else {
      this.queuedRequests.style.display = 'none';
    }
  }

  updateAudioSources(sources = []) {
    this.audioSources.clear();
    sources.forEach(source => {
      this.audioSources.set(source.id, source);
    });
    
    // Update tab audio source
    const tabSource = this.audioSources.get('tab');
    if (tabSource && tabSource.active) {
      this.tabAudioSource.className = 'audio-source active';
      this.tabAudioSource.querySelector('.source-text').textContent = 'Tab Audio: Active';
    } else {
      this.tabAudioSource.className = 'audio-source inactive';
      this.tabAudioSource.querySelector('.source-text').textContent = 'Tab Audio: No audio detected';
    }
    
    // Update microphone source
    const micSource = this.audioSources.get('microphone');
    if (micSource && micSource.active) {
      this.micAudioSource.className = 'audio-source active';
      this.micAudioSource.querySelector('.source-text').textContent = 'Microphone: Active';
    } else {
      this.micAudioSource.className = 'audio-source inactive';
      this.micAudioSource.querySelector('.source-text').textContent = 'Microphone: Inactive';
    }
  }

  updateAudioSourcesFromSession(session) {
    if (session && session.audioInfo) {
      const audioInfo = session.audioInfo;
      
      // Update tab audio source display
      if (audioInfo.detected) {
        this.tabAudioSource.className = 'audio-source active';
        this.tabAudioSource.querySelector('.source-text').textContent = 
          `Tab Audio: ${this.getAudioDetectionText(audioInfo)}`;
      } else {
        this.tabAudioSource.className = 'audio-source inactive';
        this.tabAudioSource.querySelector('.source-text').textContent = 
          `Tab Audio: No audio detected (${this.getAudioDetectionText(audioInfo)})`;
      }
      
      // Update microphone source
      this.micAudioSource.className = 'audio-source inactive';
      this.micAudioSource.querySelector('.source-text').textContent = 'Microphone: Inactive';
    }
  }

  getAudioDetectionText(audioInfo) {
    const methods = [];
    
    if (audioInfo.detectionMethods?.chromeAudible) methods.push('Chrome detected');
    if (audioInfo.detectionMethods?.streamIdAvailable) methods.push('Stream available');
    if (audioInfo.detectionMethods?.mediaElementsFound) methods.push('Media elements found');
    
    if (methods.length > 0) {
      return methods.join(', ');
    } else {
      return 'Detection failed';
    }
  }

  updateSegmentCount() {
    const count = this.transcriptions.length;
    this.segmentCount.textContent = `${count} segments`;
  }

  updateExportButtons(enabled) {
    this.copyButton.disabled = !enabled;
    this.downloadButton.disabled = !enabled;
    this.clearButton.disabled = !enabled;
  }

  // ============================================================================
  // TRANSCRIPTION DISPLAY
  // ============================================================================

  addTranscriptionToUI(data) {
    const transcriptionElement = document.createElement('div');
    transcriptionElement.className = 'transcription-item';
    transcriptionElement.dataset.chunkId = data.chunkId;
    transcriptionElement.setAttribute('role', 'article');
    transcriptionElement.setAttribute('aria-label', `Transcription segment ${data.chunkId}`);
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    const overlapBadge = data.hasOverlap ? '<span class="overlap-badge" aria-label="3-second overlap with previous segment">Overlap</span>' : '';
    const providerBadge = `<span class="provider-badge">${data.provider}</span>`;
    const confidenceBadge = data.confidence ? 
      `<span class="confidence-badge" aria-label="Confidence: ${Math.round(data.confidence * 100)}%">${Math.round(data.confidence * 100)}%</span>` : '';
    
    transcriptionElement.innerHTML = `
      <div class="transcription-header">
        <span class="timestamp">${timestamp}</span>
        <span class="chunk-id">Chunk ${data.chunkId}</span>
        ${overlapBadge}
        ${providerBadge}
        ${confidenceBadge}
      </div>
      <div class="transcription-text">${data.text}</div>
      <div class="transcription-meta">
        <span class="duration">${data.duration ? `${Math.round(data.duration/1000)}s` : ''}</span>
      </div>
    `;
    
    this.transcriptionList.appendChild(transcriptionElement);
    
    // Announce to screen readers
    this.announceToScreenReader(`New transcription segment ${data.chunkId} received`);
  }

  announceToScreenReader(message) {
    // Create a live region for screen reader announcements
    let liveRegion = document.getElementById('screen-reader-announcements');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'screen-reader-announcements';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.position = 'absolute';
      liveRegion.style.left = '-10000px';
      liveRegion.style.width = '1px';
      liveRegion.style.height = '1px';
      liveRegion.style.overflow = 'hidden';
      document.body.appendChild(liveRegion);
    }
    
    liveRegion.textContent = message;
    
    // Clear after a short delay
    setTimeout(() => {
      liveRegion.textContent = '';
    }, 1000);
  }

  addTranscriptionErrorToUI(data) {
    const errorElement = document.createElement('div');
    errorElement.className = 'transcription-item error';
    errorElement.dataset.chunkId = data.chunkId;
    errorElement.setAttribute('role', 'article');
    errorElement.setAttribute('aria-label', `Transcription error for segment ${data.chunkId}`);
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString();
    
    errorElement.innerHTML = `
      <div class="transcription-header">
        <span class="timestamp">${timestamp}</span>
        <span class="chunk-id">Chunk ${data.chunkId} - ERROR</span>
        <span class="error-badge" aria-label="Error occurred">ERROR</span>
      </div>
      <div class="transcription-text error">❌ ${data.error}</div>
      <div class="transcription-meta">
        <span class="error-note">This segment was not processed successfully</span>
      </div>
    `;
    
    this.transcriptionList.appendChild(errorElement);
    
    // Announce error to screen readers
    this.announceToScreenReader(`Error in transcription segment ${data.chunkId}: ${data.error}`);
  }

  // ============================================================================
  // SESSION TIMER
  // ============================================================================

  startSessionTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    
    this.timerInterval = setInterval(() => {
      this.updateSessionTimer();
    }, 1000);
  }

  stopSessionTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateSessionTimer() {
    if (!this.sessionStartTime) {
      this.sessionTimer.textContent = '00:00:00';
      return;
    }
    
    const elapsed = Date.now() - this.sessionStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    this.sessionTimer.textContent = 
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // ============================================================================
  // EXPORT FUNCTIONALITY
  // ============================================================================

  async copyTranscript() {
    try {
      if (!this.transcriptions.length) {
        this.showError('No Content', 'No transcriptions available to copy.');
        return;
      }
      
      const text = this.transcriptions
        .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.text}`)
        .join('\n\n');
      
      await navigator.clipboard.writeText(text);
      this.showNotification('Copied!', 'Transcript copied to clipboard', 'success');
      
    } catch (error) {
      console.error('❌ Copy failed:', error);
      this.showError('Copy Failed', error.message);
    }
  }

  async downloadTranscript() {
    try {
      if (!this.transcriptions.length) {
        this.showError('No Content', 'No transcriptions available to download.');
        return;
      }
      
      if (!this.port || !this.isConnected) {
        this.showError('Connection Error', 'Not connected to background service. Please wait and try again.');
        return;
      }
      
      // Send download request to background
      this.port.postMessage({ 
        type: 'export_transcript', 
        data: { format: 'txt' } 
      });
      
    } catch (error) {
      console.error('❌ Download failed:', error);
      this.showError('Download Failed', error.message);
    }
  }

  async clearTranscript() {
    try {
      if (!this.transcriptions.length) {
        this.showError('No Content', 'No transcriptions to clear.');
        return;
      }
      
      if (!this.port || !this.isConnected) {
        this.showError('Connection Error', 'Not connected to background service. Please wait and try again.');
        return;
      }
      
      // Send clear request to background
      this.port.postMessage({ type: 'clear_transcript' });
      
    } catch (error) {
      console.error('❌ Clear failed:', error);
      this.showError('Clear Failed', error.message);
    }
  }

  // ============================================================================
  // NOTIFICATIONS & ERRORS
  // ============================================================================

  showNotification(title, message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  showError(title, message) {
    this.showNotification(title, message, 'error');
  }

  showHelp() {
    const helpText = `
Keyboard Navigation:
• Tab: Navigate between elements
• Enter/Space: Activate buttons
• Escape: Stop recording
• Ctrl/Cmd + R: Quick start/stop recording
• Ctrl/Cmd + C: Copy transcript
• Ctrl/Cmd + S: Download transcript
• Ctrl/Cmd + H: Show this help

Accessibility Features:
• Screen reader support
• ARIA labels and roles
• Live region updates
• Focus indicators
• Skip link available
    `;
    
    this.showNotification('Keyboard Shortcuts & Accessibility', helpText, 'info');
  }

  // ============================================================================
  // SETTINGS MANAGEMENT
  // ============================================================================

  handleTranscriptionMethodChange() {
    const method = this.transcriptionMethodSelect.value;
    
    // Show/hide prompt setting based on method
    if (method === 'prompt') {
      this.promptSetting.style.display = 'block';
      this.announceToScreenReader('Prompt-based transcription selected. Custom prompt field is now visible.');
    } else {
      this.promptSetting.style.display = 'none';
      this.announceToScreenReader('Whisper transcription selected.');
    }
    
    // Send setting to background script
    this.updateTranscriptionSettings();
  }

  handleCustomPromptChange() {
    // Debounce the input to avoid too many updates
    clearTimeout(this.promptDebounceTimer);
    this.promptDebounceTimer = setTimeout(() => {
      this.updateTranscriptionSettings();
    }, 500);
  }

  async updateTranscriptionSettings() {
    try {
      if (this.port && this.isConnected) {
        this.port.postMessage({
          type: 'update_transcription_settings',
          data: {
            method: this.transcriptionMethodSelect.value,
            customPrompt: this.customPromptTextarea.value
          }
        });
      }
    } catch (error) {
      console.error('❌ Failed to update transcription settings:', error);
    }
  }

  async refreshAudioDetection() {
    try {
      console.log('🔄 Refreshing audio detection...');
      
      if (this.port && this.isConnected) {
        this.port.postMessage({
          type: 'refresh_audio_detection'
        });
        
        this.showNotification('Audio Detection', 'Refreshing audio detection...', 'info');
      } else {
        this.showError('Connection Error', 'Not connected to background service');
      }
    } catch (error) {
      console.error('❌ Failed to refresh audio detection:', error);
      this.showError('Detection Error', error.message);
    }
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  handleOnlineStatus(isOnline) {
    this.handleConnectivityChange({ isOnline });
  }

  handleKeyboardShortcuts(event) {
    // Enhanced keyboard navigation and shortcuts
    switch (event.key) {
      case 'Enter':
      case ' ':
        // Handle button activation
        if (document.activeElement === this.startButton && !this.isRecording) {
          event.preventDefault();
          this.startRecording();
        } else if (document.activeElement === this.stopButton && this.isRecording) {
          event.preventDefault();
          this.stopRecording();
        } else if (document.activeElement === this.copyButton && !this.copyButton.disabled) {
          event.preventDefault();
          this.copyTranscript();
        } else if (document.activeElement === this.downloadButton && !this.downloadButton.disabled) {
          event.preventDefault();
          this.downloadTranscript();
        } else if (document.activeElement === this.clearButton && !this.clearButton.disabled) {
          event.preventDefault();
          this.clearTranscript();
        }
        break;
        
      case 'Escape':
        // Close panel or stop recording
        if (this.isRecording) {
          this.stopRecording();
        }
        break;
        
      case 'r':
        // Quick start/stop recording
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (this.isRecording) {
            this.stopRecording();
          } else {
            this.startRecording();
          }
        }
        break;
        
      case 'c':
        // Copy transcript
        if ((event.ctrlKey || event.metaKey) && this.transcriptions.length > 0) {
          event.preventDefault();
          this.copyTranscript();
        }
        break;
        
      case 's':
        // Download transcript
        if ((event.ctrlKey || event.metaKey) && this.transcriptions.length > 0) {
          event.preventDefault();
          this.downloadTranscript();
        }
        break;
        
      case 'h':
        // Show help
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.showHelp();
        }
        break;
    }
  }

  scrollToBottom() {
    this.transcriptionContainer.scrollTop = this.transcriptionContainer.scrollHeight;
  }

  // ============================================================================
  // EXPORT SUCCESS/ERROR HANDLERS
  // ============================================================================

  handleExportSuccess(data) {
    this.showNotification('Export Successful', `File saved as: ${data.filename}`, 'success');
  }

  handleExportError(data) {
    this.showError('Export Failed', data.error);
  }

  handleClearSuccess(data) {
    // Clear UI
    this.transcriptions = [];
    this.transcriptionList.innerHTML = '';
    this.updateSegmentCount();
    this.updateExportButtons(false);
    
    this.showNotification('Cleared!', 'All transcriptions have been cleared', 'success');
  }

  handleClearError(data) {
    this.showError('Clear Failed', data.error);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('🎯 DOM ready - initializing sidepanel');
  window.transcriptionSidepanel = new TranscriptionSidepanel();
});

console.log('🎯 Sidepanel Script Loaded');
