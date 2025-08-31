console.log('🎯 Background Service Worker Initialized');

// Global state management
const state = {
  isRecording: false,
  currentSession: null,
  connectedPorts: new Set(),
  offscreenDocumentCreated: false,
  transcriptionQueue: [],
  retryAttempts: new Map(),
  isOnline: navigator.onLine,
  audioSources: new Map(), // Track active audio sources
  sessionStartTime: null
};

// Global service instances
let transcriptionService = null;

// Service status tracking
let transcriptionServiceInitialized = false;

// Helper function to check if transcription service is ready
function isTranscriptionServiceReady() {
  return transcriptionServiceInitialized && transcriptionService && typeof transcriptionService.transcribeAudio === 'function';
}

// Configuration
const CONFIG = {
  CHUNK_DURATION: 30000, // 30 seconds
  OVERLAP_DURATION: 3000, // 3 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  QUEUE_PROCESS_INTERVAL: 5000,
  OFFLINE_BUFFER_SIZE: 100 // Max offline transcriptions to store
};

// ============================================================================
// TRANSCRIPTION SERVICE CLASS
// ============================================================================

class TranscriptionService {
  constructor() {
    // Use Vercel backend URL (you'll get this after deployment)
    this.baseUrl = 'https://twinmind-transcription-extension.vercel.app/api';
    this.config = {
      preferredProvider: 'whisper',
      transcriptionMethod: 'whisper', // 'whisper' or 'prompt'
      customPrompt: 'Please transcribe this audio accurately, preserving all words and maintaining proper punctuation.',
      maxRetries: 3,
      retryDelay: 1000
    };
    this.isInitialized = false;
  }
  
  async testConnection() {
    try {
      console.log('🔍 Testing transcription service connection...');
      
      // Test connection to Vercel backend
      const response = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioData: 'dGVzdA==', // base64 for "test"
          format: 'json'
        })
      });
      
      if (response.ok) {
        this.isInitialized = true;
        console.log('✅ Backend connection successful');
        return { success: true };
      } else {
        throw new Error(`Backend connection failed: ${response.status}`);
      }
      
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      return { success: false, error: error.message };
    }
  }
  
  async transcribeAudio(audioBlob, options = {}) {
    const { chunkId, tabId, hasOverlap, sessionId } = options;
    
    try {
      console.log(`🎯 Starting transcription for chunk ${chunkId} using ${this.config.transcriptionMethod}`);
      
      let result;
      
      // Choose transcription method based on configuration
      if (this.config.transcriptionMethod === 'prompt') {
        result = await this.transcribeWithPrompt(audioBlob, {
          ...options,
          prompt: this.config.customPrompt
        });
      } else {
        result = await this.transcribeWithWhisper(audioBlob, options);
      }
      
      return {
        success: true,
        text: result.text,
        chunkId,
        tabId,
        sessionId,
        timestamp: Date.now(),
        provider: this.config.transcriptionMethod,
        confidence: result.confidence || null,
        hasOverlap
      };
      
    } catch (error) {
      console.error(`❌ Transcription failed for chunk ${chunkId}:`, error);
      throw error;
    }
  }
  
  async transcribeWithWhisper(audioBlob, options = {}) {
    const { chunkId } = options;
    
    // Validate audio blob
    if (!audioBlob || !(audioBlob instanceof Blob)) {
      console.error('❌ Invalid audio blob:', audioBlob);
      throw new Error('Invalid audio data received');
    }
    
    console.log(`📁 Audio blob: size=${audioBlob.size}, type=${audioBlob.type}`);
    
    // Ensure blob is valid and has content
    if (audioBlob.size === 0) {
      throw new Error('Audio blob is empty');
    }
    
    // Convert blob to base64 for Vercel backend
    const base64Audio = await this.blobToBase64(audioBlob);
    
    try {
      // Send to Vercel backend
      const response = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioData: base64Audio,
          format: 'json',
          customPrompt: this.config.customPrompt
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      return {
        text: result.text,
        confidence: result.confidence || null
      };
      
    } catch (error) {
      console.error('❌ Transcription request failed:', error);
      throw error;
    }
  }

  // Helper method to convert blob to base64
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Multi-modal LLM approach with prompt-based transcription
  async transcribeWithPrompt(audioBlob, options = {}) {
    const { chunkId, prompt = "Please transcribe this audio accurately, preserving all words and maintaining proper punctuation." } = options;
    
    try {
      console.log(`🤖 Using prompt-based transcription for chunk ${chunkId}`);
      console.log(`📝 Prompt: "${prompt}"`);
      
      // Convert audio to base64 for Vercel backend
      const base64Audio = await this.blobToBase64(audioBlob);
      
      // Send to Vercel backend with custom prompt
      const response = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioData: base64Audio,
          format: 'json',
          customPrompt: prompt
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const result = await response.json();
      console.log(`✅ Prompt-based transcription completed: "${result.text.substring(0, 100)}..."`);
      
      return {
        text: result.text,
        confidence: 0.95, // Backend doesn't provide confidence scores
        duration: result.duration || null,
        segments: [{ text: result.text, start: 0, end: 0 }]
      };
      
    } catch (error) {
      console.error(`❌ Prompt-based transcription failed:`, error);
      // Fall back to Whisper if prompt-based fails
      console.log(`🔄 Falling back to Whisper transcription...`);
      return await this.transcribeWithWhisper(audioBlob, options);
    }
  }

  // Helper method to convert blob to base64
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

// Initialize the service
initializeService();

// ============================================================================
// SERVICE INITIALIZATION
// ============================================================================

async function initializeService() {
  try {
    console.log('🚀 Initializing Real-Time Audio Transcription...');
    
    // Set up event listeners
    setupEventListeners();
    
    // Initialize transcription service
    await initializeTranscriptionService();
    
    // Start offline queue processor
    startOfflineQueueProcessor();
    
    // Monitor online/offline status
    monitorConnectivity();
    
    console.log('✅ Service initialization complete');
    
  } catch (error) {
    console.error('❌ Service initialization failed:', error);
  }
}

function setupEventListeners() {
  // Handle port connections from sidepanel
  chrome.runtime.onConnect.addListener(handlePortConnection);
  
  // Handle messages from offscreen document
  chrome.runtime.onMessage.addListener(handleOffscreenMessage);
  
  // Handle online/offline events (service worker context)
  self.addEventListener('online', () => handleConnectivityChange(true));
  self.addEventListener('offline', () => handleConnectivityChange(false));
  
  // Handle extension installation/update
  chrome.runtime.onInstalled.addListener(handleExtensionInstalled);
}

// ============================================================================
// PORT CONNECTION MANAGEMENT
// ============================================================================

function handlePortConnection(port) {
  console.log('🔌 New sidepanel connection established');
  
  // Set port name for identification
  port.name = 'sidepanel';
  
  state.connectedPorts.add(port);
  
  // Send current state to new connection
  try {
    port.postMessage({
      type: 'connection_established',
      data: {
        isRecording: state.isRecording,
        sessionInfo: state.currentSession,
        audioSources: Array.from(state.audioSources.values()),
        isOnline: state.isOnline,
        transcriptionServiceReady: transcriptionServiceInitialized,
        queueStatus: {
          pending: state.transcriptionQueue.length,
          retryAttempts: state.retryAttempts.size
        }
      }
    });
    console.log('✅ Connection state sent to sidepanel');
  } catch (error) {
    console.error('❌ Failed to send connection state:', error);
  }
  
  // Handle port disconnection
  port.onDisconnect.addListener(() => {
    console.log('🔌 Sidepanel connection closed');
    state.connectedPorts.delete(port);
  });
  
  // Handle messages from sidepanel
  port.onMessage.addListener((message) => {
    try {
      console.log('📨 Port message received:', message.type);
      handleSidepanelMessage(message, port);
    } catch (error) {
      console.error('❌ Error handling port message:', error);
      // Send error response back to sidepanel
      try {
        port.postMessage({
          type: 'error',
          data: { message: error.message }
        });
      } catch (sendError) {
        console.error('❌ Failed to send error response:', sendError);
        // If we can't send error response, the port is likely broken
        state.connectedPorts.delete(port);
            }
          }
        });

  // Send heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      if (state.connectedPorts.has(port)) {
        port.postMessage({ type: 'heartbeat', timestamp: Date.now() });
      } else {
        clearInterval(heartbeatInterval);
      }
    } catch (error) {
      console.warn('⚠️ Heartbeat failed, clearing interval:', error);
      clearInterval(heartbeatInterval);
      state.connectedPorts.delete(port);
    }
  }, 30000); // Every 30 seconds
}

async function handleSidepanelMessage(message, port) {
  try {
    console.log('📨 Sidepanel message received:', message.type);
    
    switch (message.type) {
      case 'start_recording':
        await handleStartRecording(port);
        break;
        
      case 'stop_recording':
        await handleStopRecording(port);
        break;
        
      case 'get_session_info':
        port.postMessage({
          type: 'session_info',
          data: state.currentSession
        });
        break;
        
      case 'export_transcript':
        handleExportTranscript(message.data.format, port);
        break;
        
      case 'clear_transcript':
        handleClearTranscript(port);
        break;
        
      case 'update_transcription_settings':
        handleUpdateTranscriptionSettings(message.data, port);
        break;
        
      case 'refresh_audio_detection':
        handleRefreshAudioDetection(port);
        break;
        
      case 'get_audio_sources':
          port.postMessage({
            type: 'audio_sources_update',
            data: Array.from(state.audioSources.values())
          });
          break;
          
        case 'heartbeat':
          // Respond to heartbeat to keep connection alive
          try {
            port.postMessage({ type: 'heartbeat_ack', timestamp: Date.now() });
          } catch (error) {
            console.warn('⚠️ Failed to send heartbeat acknowledgment:', error);
          }
          break;
          
        default:
          console.warn('⚠️ Unknown sidepanel message type:', message.type);
          // Send response for unknown message types
          port.postMessage({
            type: 'error',
            data: { message: `Unknown message type: ${message.type}` }
          });
          break;
    }
    
  } catch (error) {
    console.error('❌ Error handling sidepanel message:', error);
    port.postMessage({
      type: 'error',
      data: { message: error.message }
    });
  }
}

// ============================================================================
// RECORDING CONTROL
// ============================================================================

async function handleStartRecording(port) {
  try {
    if (state.isRecording) {
      throw new Error('Recording already in progress');
    }
    
    console.log('🎬 Starting recording session...');
    
    // Get current tab information
    const currentTab = await getCurrentTab();
    if (!currentTab) {
      throw new Error('No active tab found');
    }
    
    // Enhanced audio detection results
    const audioInfo = currentTab.audioInfo || {};
    console.log(`📱 Tab info: ${currentTab.title}`);
    console.log(`🔍 Audio detection:`, audioInfo);
    
    // Check if we have any indication of audio
    if (!audioInfo.detected) {
      console.warn('⚠️ No audio detected, but attempting capture anyway...');
    }
    
    // Initialize session
    state.currentSession = {
      id: generateSessionId(),
      startTime: Date.now(),
      tabId: currentTab.id,
      tabTitle: currentTab.title,
      tabUrl: currentTab.url,
      audioInfo: audioInfo,
      audioSources: new Set(),
      transcriptions: [],
      status: 'starting'
    };
    
    // Ensure offscreen document is available
    const offscreenAvailable = await ensureOffscreenDocument();
    if (!offscreenAvailable) {
      console.warn('⚠️ Offscreen document not available, trying direct capture...');
      // Continue without offscreen document
    }
    
    // Start audio capture with smart fallback
    const captureResult = await startAudioCapture(currentTab.id);
    if (!captureResult.success) {
      // Try one more time with different approach
      console.log('🔄 First capture attempt failed, trying alternative method...');
      
      // Reset offscreen document flag and try again
      if (state.offscreenDocumentCreated) {
        state.offscreenDocumentCreated = false;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
        
        const retryResult = await startAudioCapture(currentTab.id);
        if (!retryResult.success) {
          throw new Error(`All capture methods failed: ${captureResult.error}, Retry: ${retryResult.error}`);
        }
        
        // Use retry result
        captureResult = retryResult;
      } else {
        throw new Error(captureResult.error || 'Failed to start audio capture');
      }
    }
    
    // Update state
    state.isRecording = true;
    state.sessionStartTime = Date.now();
    state.currentSession.status = 'recording';
    
    // Notify all connected sidepanels
    broadcastToSidepanels({
      type: 'recording_started',
      data: {
        sessionId: state.currentSession.id,
        tabTitle: currentTab.title,
        startTime: state.sessionStartTime,
        audioSources: Array.from(state.audioSources.values()),
        captureMethod: captureResult.method || 'unknown'
      }
    });
    
    // Send immediate acknowledgment to the requesting port
    try {
      port.postMessage({
        type: 'recording_started_ack',
        data: { success: true, sessionId: state.currentSession.id }
      });
    } catch (ackError) {
      console.warn('⚠️ Failed to send acknowledgment:', ackError);
    }
    
    console.log('✅ Recording session started successfully');
    
  } catch (error) {
    console.error('❌ Failed to start recording:', error);
    port.postMessage({
      type: 'recording_error',
      data: { error: error.message }
    });
  }
}

async function handleStopRecording(port) {
  try {
    if (!state.isRecording) {
      throw new Error('No recording session in progress');
    }
    
    console.log('🛑 Stopping recording session...');
    
    // Stop audio capture
    await stopAudioCapture();
    
    // Update state
    state.isRecording = false;
    if (state.currentSession) {
      state.currentSession.status = 'stopped';
      state.currentSession.endTime = Date.now();
      state.currentSession.duration = Date.now() - state.sessionStartTime;
    }
    
    // Notify all connected sidepanels
    broadcastToSidepanels({
      type: 'recording_stopped',
      data: {
        sessionId: state.currentSession?.id,
        endTime: Date.now(),
        duration: state.currentSession?.duration,
        transcriptionCount: state.currentSession?.transcriptions.length || 0
      }
    });
    
    // Send immediate acknowledgment to the requesting port
    try {
      port.postMessage({
        type: 'recording_stopped_ack',
        data: { success: true, sessionId: state.currentSession?.id }
      });
    } catch (ackError) {
      console.warn('⚠️ Failed to send acknowledgment:', ackError);
    }
    
    console.log('✅ Recording session stopped successfully');
    
  } catch (error) {
    console.error('❌ Failed to stop recording:', error);
    port.postMessage({
      type: 'recording_error',
      data: { error: error.message }
    });
  }
}

// ============================================================================
// AUDIO CAPTURE MANAGEMENT
// ============================================================================

async function startAudioCapture(tabId) {
  try {
    console.log(`🎵 Starting audio capture for tab ${tabId}`);
    
    // Check if offscreen document is ready
    if (!state.offscreenDocumentCreated) {
      console.error('❌ Offscreen document not ready');
      return { success: false, error: 'Audio capture system not initialized' };
    }
    
    // Try offscreen capture first
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'start_tab_capture',
          tabId: tabId,
          config: {
            chunkDuration: CONFIG.CHUNK_DURATION,
            overlapDuration: CONFIG.OVERLAP_DURATION,
            enableMultiSource: true
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        console.log('✅ Offscreen audio capture started successfully');
        return { success: true, method: 'offscreen' };
      } else {
        throw new Error(response?.error || 'Offscreen capture failed');
      }
      
    } catch (offscreenError) {
      console.warn('⚠️ Offscreen capture failed, trying alternative method:', offscreenError.message);
      
      // Fall back to direct capture
      return await tryAlternativeCapture(tabId);
    }
    
  } catch (error) {
    console.error('❌ Audio capture start failed:', error);
    
    // Try alternative capture method as last resort
    try {
      console.log('🔄 Trying alternative capture method...');
      return await tryAlternativeCapture(tabId);
    } catch (altError) {
      console.error('❌ Alternative capture method also failed:', altError);
      return { success: false, error: `All methods failed: ${error.message}, ${altError.message}` };
    }
  }
}

async function tryAlternativeCapture(tabId) {
  try {
    console.log('🔄 Attempting alternative capture method...');
    
    // Method 1: Use chrome.tabCapture.capture with proper constraints
    try {
      const stream = await new Promise((resolve, reject) => {
        chrome.tabCapture.capture({
          audio: true,
          video: false,
          audioConstraints: {
            mandatory: {
              chromeMediaSource: 'tab',
              echoCancellation: true,
              noiseSuppression: true
            }
          }
        }, (stream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (stream) {
            resolve(stream);
          } else {
            reject(new Error('No stream returned'));
          }
        });
      });
      
      console.log('✅ Alternative capture method succeeded with direct capture');
      return { success: true, stream, method: 'direct_capture' };
      
    } catch (captureError) {
      console.log('⚠️ Direct capture method failed:', captureError.message);
      
      // Method 2: Try with getMediaStreamId as fallback
      try {
        const streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ 
            consumerTabId: tabId,
            audio: true,
            video: false
          }, (streamId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (streamId) {
              resolve(streamId);
            } else {
              reject(new Error('No stream ID returned'));
            }
          });
        });
        
        console.log('✅ Alternative capture method succeeded with stream ID');
        return { success: true, streamId, method: 'stream_id' };
        
      } catch (streamError) {
        console.log('⚠️ Stream ID method failed:', streamError.message);
        throw new Error(`All capture methods failed: Direct: ${captureError.message}, StreamID: ${streamError.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Alternative capture methods failed:', error);
    throw error;
  }
}

async function stopAudioCapture() {
  try {
    console.log('🛑 Stopping audio capture...');
    
    // Send stop capture message to offscreen document
    return new Promise((resolve) => {
  chrome.runtime.sendMessage({
        type: 'stop_tab_capture'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('⚠️ Error stopping capture:', chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
    
  } catch (error) {
    console.error('❌ Audio capture stop failed:', error);
  }
}

// ============================================================================
// TRANSCRIPTION SERVICE
// ============================================================================

async function initializeTranscriptionService() {
  try {
    console.log('🔧 Initializing transcription service...');
    
    // Create new instance
    transcriptionService = new TranscriptionService();
    
    // Test the service
    const testResult = await transcriptionService.testConnection();
    if (testResult.success) {
      console.log('✅ Transcription service initialized successfully');
      transcriptionServiceInitialized = true;
      return true;
    } else {
      console.warn('⚠️ Transcription service test failed:', testResult.error);
      transcriptionService = null; // Reset on failure
      transcriptionServiceInitialized = false;
      return false;
    }
    
  } catch (error) {
    console.error('❌ Transcription service initialization failed:', error);
    transcriptionService = null; // Reset on failure
    transcriptionServiceInitialized = false;
    return false;
  }
}

async function handleTranscriptionRequest(audioData) {
  try {
    console.log(`🎯 Processing transcription request for chunk ${audioData.chunkId}`);
    
    // Check if we're online
    if (!state.isOnline) {
      console.log('📱 Offline - queuing transcription for later processing');
      queueTranscription(audioData);
      return { success: true, queued: true };
    }
    
    // Ensure transcription service is initialized
    if (!transcriptionService) {
      console.warn('⚠️ Transcription service not initialized, attempting to initialize...');
      try {
        const initSuccess = await initializeTranscriptionService();
        if (!initSuccess) {
          throw new Error('Transcription service initialization failed');
        }
      } catch (initError) {
        console.error('❌ Failed to initialize transcription service:', initError);
        throw new Error('Transcription service unavailable');
      }
    }
    
    // Double-check service is ready
    if (!isTranscriptionServiceReady()) {
      throw new Error('Transcription service not properly initialized');
    }
    
    // Process transcription
    const result = await transcriptionService.transcribeAudio(audioData.blob, {
      chunkId: audioData.chunkId,
      tabId: audioData.tabId,
      hasOverlap: audioData.hasOverlap,
      sessionId: state.currentSession?.id
    });
    
    // Add to session transcriptions
    if (state.currentSession) {
      state.currentSession.transcriptions.push({
        chunkId: audioData.chunkId,
        text: result.text,
        timestamp: Date.now(),
        provider: result.provider,
        confidence: result.confidence,
        hasOverlap: audioData.hasOverlap,
        duration: audioData.duration
      });
    }
    
    // Broadcast to sidepanels
    broadcastToSidepanels({
      type: 'transcription_update',
      data: {
        chunkId: audioData.chunkId,
    text: result.text,
        timestamp: Date.now(),
        provider: result.provider,
        confidence: result.confidence,
        hasOverlap: audioData.hasOverlap,
        duration: audioData.duration,
        sessionId: state.currentSession?.id
      }
    });
    
    console.log(`✅ Transcription completed for chunk ${audioData.chunkId}`);
    return { success: true, result };
    
  } catch (error) {
    console.error(`❌ Transcription failed for chunk ${audioData.chunkId}:`, error);
    
    // Queue for retry if appropriate
    if (shouldRetryTranscription(audioData.chunkId)) {
      queueTranscription(audioData);
    }
    
    // Broadcast error to sidepanels
    broadcastToSidepanels({
      type: 'transcription_error',
      data: {
        chunkId: audioData.chunkId,
        error: error.message,
        timestamp: Date.now()
      }
    });
    
    return { success: false, error: error.message };
  }
}

// ============================================================================
// OFFLINE BUFFERING & QUEUE MANAGEMENT
// ============================================================================

function queueTranscription(audioData) {
  try {
    // Add to queue
    state.transcriptionQueue.push({
      ...audioData,
      timestamp: Date.now(),
      retryCount: 0
    });
    
    // Limit queue size
    if (state.transcriptionQueue.length > CONFIG.OFFLINE_BUFFER_SIZE) {
      state.transcriptionQueue.shift();
    }
    
    console.log(`📦 Transcription queued. Queue size: ${state.transcriptionQueue.length}`);
    
    // Update sidepanels
    broadcastToSidepanels({
      type: 'queue_status_update',
      data: {
        queueSize: state.transcriptionQueue.length,
        isOnline: state.isOnline
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to queue transcription:', error);
  }
}

function shouldRetryTranscription(chunkId) {
  const retryCount = state.retryAttempts.get(chunkId) || 0;
  return retryCount < CONFIG.MAX_RETRIES;
}

function startOfflineQueueProcessor() {
  setInterval(async () => {
    if (state.isOnline && state.transcriptionQueue.length > 0) {
      console.log(`🔄 Processing offline queue: ${state.transcriptionQueue.length} items`);
      await processOfflineQueue();
    }
  }, CONFIG.QUEUE_PROCESS_INTERVAL);
}

async function processOfflineQueue() {
  try {
    const queueCopy = [...state.transcriptionQueue];
    state.transcriptionQueue = [];
    
    for (const item of queueCopy) {
      try {
        // Increment retry count
        const retryCount = (state.retryAttempts.get(item.chunkId) || 0) + 1;
        state.retryAttempts.set(item.chunkId, retryCount);
        
        // Process with exponential backoff
        const delay = CONFIG.RETRY_DELAY * Math.pow(2, retryCount - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Attempt transcription
        await handleTranscriptionRequest(item);
        
        // Remove from retry attempts on success
        state.retryAttempts.delete(item.chunkId);
        
      } catch (error) {
        console.error(`❌ Failed to process queued item ${item.chunkId}:`, error);
        
        // Re-queue if still under retry limit
        if (retryCount < CONFIG.MAX_RETRIES) {
          state.transcriptionQueue.push({
            ...item,
            retryCount
          });
        }
      }
    }
    
    // Update sidepanels
    broadcastToSidepanels({
      type: 'queue_status_update',
      data: {
        queueSize: state.transcriptionQueue.length,
        isOnline: state.isOnline
      }
    });
    
  } catch (error) {
    console.error('❌ Offline queue processing failed:', error);
  }
}

// ============================================================================
// CONNECTIVITY MONITORING
// ============================================================================

function monitorConnectivity() {
  // Initial check
  handleConnectivityChange(navigator.onLine);
  
  // Monitor changes (service worker context)
  self.addEventListener('online', () => handleConnectivityChange(true));
  self.addEventListener('offline', () => handleConnectivityChange(false));
}

function handleConnectivityChange(isOnline) {
  const wasOnline = state.isOnline;
  state.isOnline = isOnline;
  
  console.log(`🌐 Connectivity changed: ${isOnline ? 'Online' : 'Offline'}`);
  
  // Notify sidepanels
  broadcastToSidepanels({
    type: 'connectivity_change',
    data: { isOnline }
  });
  
  // Process queue if coming back online
  if (!wasOnline && isOnline && state.transcriptionQueue.length > 0) {
    console.log('🔄 Connection restored - processing offline queue');
    processOfflineQueue();
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab) {
      // Enhanced audio detection
      const audioInfo = await detectTabAudio(tab);
      console.log(`📱 Tab audio info:`, audioInfo);
      
      return {
        ...tab,
        audioInfo
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Failed to get current tab:', error);
    return null;
  }
}

async function detectTabAudio(tab) {
  try {
    // Method 1: Check tab.audible (basic Chrome detection)
    const basicAudible = tab.audible;
    
    // Method 2: Try to get media stream ID (more reliable)
    let streamId = null;
    try {
      streamId = await new Promise((resolve) => {
        chrome.tabCapture.getMediaStreamId({ consumerTabId: tab.id }, (streamId) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(streamId);
          }
        });
      });
    } catch (error) {
      console.log('⚠️ Stream ID detection failed:', error.message);
    }
    
    // Method 3: Check if tab has media elements
    let hasMediaElements = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const videoElements = document.querySelectorAll('video');
          const audioElements = document.querySelectorAll('audio');
          const hasPlayingMedia = Array.from(videoElements).some(v => !v.paused) ||
                                 Array.from(audioElements).some(a => !a.paused);
          return { hasMediaElements: videoElements.length > 0 || audioElements.length > 0, hasPlayingMedia };
        }
      });
      
      if (results && results[0] && results[0].result) {
        hasMediaElements = results[0].result.hasMediaElements;
      }
    } catch (error) {
      console.log('⚠️ Media element detection failed:', error.message);
    }
    
    const audioInfo = {
      basicAudible,
      hasStreamId: !!streamId,
      hasMediaElements,
      detected: basicAudible || !!streamId || hasMediaElements,
      detectionMethods: {
        chromeAudible: basicAudible,
        streamIdAvailable: !!streamId,
        mediaElementsFound: hasMediaElements
      }
    };
    
    console.log(`🔍 Audio detection results for tab ${tab.id}:`, audioInfo);
    return audioInfo;
    
  } catch (error) {
    console.error('❌ Audio detection failed:', error);
    return { detected: false, error: error.message };
  }
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function broadcastToSidepanels(message) {
  state.connectedPorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch (error) {
      console.warn('⚠️ Failed to send message to port:', error);
      state.connectedPorts.delete(port);
    }
  });
}

async function ensureOffscreenDocument() {
  try {
    if (state.offscreenDocumentCreated) {
      return true;
    }
    
    // Check if offscreen API is available
    if (!chrome.offscreen) {
      console.warn('⚠️ Offscreen API not available');
      return false;
    }
    
    // Check if document already exists
    try {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        state.offscreenDocumentCreated = true;
        console.log('✅ Offscreen document already exists');
        return true;
      }
    } catch (error) {
      console.log('ℹ️ Could not check existing document:', error.message);
    }
    
    // Try to close any existing document first
    try {
      await chrome.offscreen.closeDocument();
      console.log('🔄 Closed existing offscreen document');
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (closeError) {
      // Ignore errors if no document exists
      console.log('ℹ️ No existing offscreen document to close');
    }
    
    // Create new offscreen document
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['USER_MEDIA'],
      justification: 'Advanced audio capture and processing for real-time transcription'
    });
    
    state.offscreenDocumentCreated = true;
    console.log('✅ Offscreen document created');
    
    // Wait for document to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return true;
    
  } catch (error) {
    console.error('❌ Failed to create offscreen document:', error);
    
    // If it's already created, mark as such
    if (error.message.includes('Only a single offscreen document may be created')) {
      state.offscreenDocumentCreated = true;
      console.log('ℹ️ Offscreen document already exists');
      return true;
    }
    
    // Try to use existing document as fallback
    try {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        state.offscreenDocumentCreated = true;
        console.log('✅ Using existing offscreen document as fallback');
        return true;
      }
    } catch (checkError) {
      console.log('ℹ️ Could not check existing document:', checkError.message);
    }
    
    return false;
  }
}

function handleExtensionInstalled(details) {
  console.log('📦 Extension installed/updated:', details.reason);
  
  // Initialize storage with default settings
  chrome.storage.local.set({
    settings: {
      chunkDuration: CONFIG.CHUNK_DURATION,
      overlapDuration: CONFIG.OVERLAP_DURATION,
      maxRetries: CONFIG.MAX_RETRIES,
      preferredProvider: 'whisper'
    }
  });
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

async function handleOffscreenMessage(message, sender, sendResponse) {
  try {
    console.log('📨 Offscreen message received:', message.type);
    
    switch (message.type) {
      case 'capture_started':
        handleCaptureStarted(message.data);
        sendResponse({ success: true });
        break;
        
      case 'capture_stopped':
        handleCaptureStopped(message.data);
        sendResponse({ success: true });
        break;
        
      case 'capture_error':
        handleCaptureError(message.data);
        sendResponse({ success: true });
        break;
        
      case 'audio_chunk_ready':
        await handleAudioChunkReady(message.data);
        sendResponse({ success: true });
        break;
        
      case 'audio_source_update':
        handleAudioSourceUpdate(message.data);
        sendResponse({ success: true });
        break;
        
      case 'health_check':
        // Simple health check response
        sendResponse({ success: true, timestamp: Date.now() });
        break;
        
      default:
        // Don't log unknown message types to reduce noise
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    
  } catch (error) {
    console.error('❌ Error handling offscreen message:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Keep message channel open for async response
}

function handleCaptureStarted(data) {
  console.log('🎬 Audio capture started:', data);
  
  // Update audio sources
  if (data.audioSources) {
    data.audioSources.forEach(source => {
      state.audioSources.set(source.id, source);
    });
  }
  
  // Notify sidepanels
  broadcastToSidepanels({
    type: 'capture_started',
    data: {
      audioSources: Array.from(state.audioSources.values()),
      timestamp: Date.now()
    }
  });
}

function handleCaptureStopped(data) {
  console.log('🛑 Audio capture stopped:', data);
  
  // Clear audio sources
  state.audioSources.clear();
  
  // Notify sidepanels
  broadcastToSidepanels({
    type: 'capture_stopped',
    data: {
      timestamp: Date.now(),
      finalTranscriptionCount: data.transcriptionCount || 0
    }
  });
}

function handleCaptureError(data) {
  console.error('❌ Audio capture error:', data);
  
  // Notify sidepanels
  broadcastToSidepanels({
    type: 'capture_error',
    data: {
      error: data.error,
      timestamp: Date.now()
    }
  });
}

async function handleAudioChunkReady(data) {
  console.log(`📦 Audio chunk ready: ${data.chunkId}`);
  
  // Validate audio data
  if (!data.blob || !(data.blob instanceof Blob)) {
    console.error(`❌ Invalid audio blob for chunk ${data.chunkId}:`, data.blob);
    
    // Send error to sidepanels
    broadcastToSidepanels({
      type: 'transcription_error',
      data: {
        chunkId: data.chunkId,
        error: 'Invalid audio data received',
        timestamp: Date.now()
      }
    });
    return;
  }
  
  // Log blob details for debugging
  console.log(`📊 Chunk ${data.chunkId} blob details:`, {
    size: data.blob.size,
    type: data.blob.type,
    constructor: data.blob.constructor.name,
    hasOverlap: data.hasOverlap
  });
  
  // Process transcription
  await handleTranscriptionRequest(data);
}

function handleAudioSourceUpdate(data) {
  console.log('🔊 Audio source update:', data);
  
  // Update audio sources
  if (data.audioSources) {
    data.audioSources.forEach(source => {
      state.audioSources.set(source.id, source);
    });
  }
  
  // Notify sidepanels
  broadcastToSidepanels({
    type: 'audio_sources_update',
    data: Array.from(state.audioSources.values())
  });
}

// ============================================================================
// EXPORT & UTILITY HANDLERS
// ============================================================================

function handleExportTranscript(format, port) {
  try {
    if (!state.currentSession || !state.currentSession.transcriptions.length) {
      throw new Error('No transcriptions available for export');
    }
    
    let exportData;
    let mimeType;
    let filename;
    
    switch (format) {
      case 'json':
        exportData = JSON.stringify(state.currentSession, null, 2);
        mimeType = 'application/json';
        filename = `transcript_${state.currentSession.id}.json`;
        break;
        
      case 'txt':
        exportData = state.currentSession.transcriptions
          .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.text}`)
          .join('\n\n');
        mimeType = 'text/plain';
        filename = `transcript_${state.currentSession.id}.txt`;
        break;
        
      default:
        throw new Error('Unsupported export format');
    }
    
    // Create download
    const blob = new Blob([exportData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
    
    port.postMessage({
      type: 'export_success',
      data: { format, filename }
    });
    
  } catch (error) {
    console.error('❌ Export failed:', error);
    port.postMessage({
      type: 'export_error',
      data: { error: error.message }
    });
  }
}

function handleClearTranscript(port) {
  try {
    if (state.currentSession) {
      state.currentSession.transcriptions = [];
    }
    
    // Clear queue and retry attempts
    state.transcriptionQueue = [];
    state.retryAttempts.clear();
    
    // Notify sidepanels
    broadcastToSidepanels({
      type: 'transcript_cleared',
      data: { timestamp: Date.now() }
    });
    
    port.postMessage({
      type: 'clear_success',
      data: { timestamp: Date.now() }
    });
    
  } catch (error) {
    console.error('❌ Clear transcript failed:', error);
    port.postMessage({
      type: 'clear_error',
      data: { error: error.message }
    });
  }
}

function handleUpdateTranscriptionSettings(settings, port) {
  try {
    console.log('⚙️ Updating transcription settings:', settings);
    
    // Update transcription service configuration
    if (transcriptionService) {
      transcriptionService.config.transcriptionMethod = settings.method;
      transcriptionService.config.customPrompt = settings.customPrompt;
      
      console.log('✅ Transcription settings updated:', {
        method: transcriptionService.config.transcriptionMethod,
        customPrompt: transcriptionService.config.customPrompt
      });
    }
    
    // Send confirmation
    port.postMessage({
      type: 'settings_updated',
      data: { success: true, timestamp: Date.now() }
    });
    
  } catch (error) {
    console.error('❌ Failed to update transcription settings:', error);
    port.postMessage({
      type: 'settings_error',
      data: { error: error.message }
    });
  }
}

async function handleRefreshAudioDetection(port) {
  try {
    console.log('🔄 Refreshing audio detection...');
    
    // Get current tab and detect audio
    const currentTab = await getCurrentTab();
    if (!currentTab) {
      throw new Error('No active tab found');
    }
    
    const audioInfo = currentTab.audioInfo || await detectTabAudio(currentTab);
    
    // Update current session if exists
    if (state.currentSession) {
      state.currentSession.audioInfo = audioInfo;
    }
    
    // Send updated audio info to sidepanel
    port.postMessage({
      type: 'audio_detection_refreshed',
      data: { audioInfo, timestamp: Date.now() }
    });
    
    console.log('✅ Audio detection refreshed:', audioInfo);
    
  } catch (error) {
    console.error('❌ Failed to refresh audio detection:', error);
    port.postMessage({
      type: 'audio_detection_error',
      data: { error: error.message }
    });
  }
}

console.log('🎯 Background Service Worker Ready');

// Error recovery and monitoring
chrome.runtime.onSuspend.addListener(() => {
  console.log('🔄 Extension suspending, cleaning up...');
  // Clean up any ongoing processes
});

// Periodic health check - only if offscreen document exists
let healthCheckInterval = null;

function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(async () => {
    try {
      if (state.offscreenDocumentCreated) {
        // Simple document existence check - no messages needed
        const hasDoc = await chrome.offscreen.hasDocument();
        if (!hasDoc) {
          console.warn('⚠️ Offscreen document lost, resetting...');
          state.offscreenDocumentCreated = false;
        }
      }
    } catch (error) {
      // Silent fail - don't spam console
      if (error.message !== 'Extension context invalidated.') {
        console.warn('⚠️ Health check failed:', error.message);
      }
    }
  }, 120000); // Every 2 minutes - less frequent
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// Start health check when extension initializes
startHealthCheck();
