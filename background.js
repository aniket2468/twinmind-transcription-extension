// ============================================================================
// OFFLINE QUEUE PROCESSOR
// ============================================================================

function startOfflineQueueProcessor() {
  setInterval(async () => {
    if (state.isOnline && state.offlineQueue.length > 0) {
      await processOfflineQueue();
    }
  }, 30000); // every 30 seconds
}
// Global state
const state = {
  isRecording: false,
  isPaused: false,
  currentSession: null,
  connectedPorts: new Set(),
  offscreenDocumentId: null,
  chunkCounter: 0,
  sessionStartTime: null,
  retryAttempts: new Map(),
  audioSource: 'tab', // 'tab' or 'microphone'
  offlineQueue: [],
  isOnline: navigator.onLine
};

// Configuration
const CONFIG = {
  CHUNK_DURATION: 30000, // 30 seconds
  OVERLAP_DURATION: 3000, // 3 seconds overlap
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  GEMINI_API_KEY: null, // Will be loaded from storage
  OFFLINE_BUFFER_SIZE: 100,
  RETRY_BACKOFF_MULTIPLIER: 2
};

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  (async () => { await initializeExtension(); })();
});
chrome.runtime.onStartup.addListener(() => {
  (async () => { await initializeExtension(); })();
});

// Keep service worker alive
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Always respond to keep connection alive
  if (message.type === 'ping') {
    sendResponse({ success: true, message: 'pong' });
    return true;
  }
  // Handle other messages asynchronously
  (async () => {
    try {
      await handleMessage(message, sender, sendResponse);
    } catch (err) {
      // Always respond, even on error
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true;
});

// Connection handling
chrome.runtime.onConnect.addListener(handleConnection);

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initializeExtension() {
  try {
    // Load configuration from storage
    await loadConfiguration();
    
    // Create offscreen document if needed
    await ensureOffscreenDocument();
    
    // Setup connectivity monitoring
    setupConnectivityMonitoring();
    
    // Start offline queue processor
    startOfflineQueueProcessor();
    
    console.log('Extension initialized successfully');
  } catch (error) {
    console.error('Extension initialization failed:', error);
  }
}

async function loadConfiguration() {
  try {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    CONFIG.GEMINI_API_KEY = result.geminiApiKey || null;
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
}

function ensureOffscreenDocument() {
  return new Promise(async (resolve) => {
    try {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (existingContexts.length === 0) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Audio transcription requires offscreen document for audio processing'
        });
        // Wait a moment for the offscreen document to initialize
        setTimeout(() => {
          state.offscreenDocumentId = null;
          resolve(true);
        }, 500);
      } else {
        state.offscreenDocumentId = existingContexts[0]?.documentId;
        resolve(true);
      }
    } catch (error) {
      console.error('Failed to create offscreen document:', error);
      resolve(false);
    }
  });
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'start_recording':
      handleStartRecording(sendResponse);
      break;
    case 'pause_recording':
      handlePauseRecording(sendResponse);
      break;
    case 'resume_recording':
      handleResumeRecording(sendResponse);
      break;
    case 'stop_recording':
      handleStopRecording(sendResponse);
      break;
    case 'audio_chunk_ready':
      handleAudioChunkReady(message.data, sendResponse);
      break;
    case 'get_config':
      sendResponse({ config: CONFIG });
      break;
    case 'set_gemini_key':
      handleSetGeminiKey(message.apiKey, sendResponse);
      break;
  }
  
  return true; // Keep message channel open for async responses
}

function handleConnection(port) {
  if (port.name === 'sidepanel') {
    state.connectedPorts.add(port);
    console.log('Sidepanel port connected');
    
    port.onMessage.addListener((message) => {
      switch (message.type) {
        case 'test_connection':
          port.postMessage({
            type: 'connection_test_response',
            data: { status: 'connected' }
          });
          break;
        case 'start_recording':
          handleStartRecording((response) => port.postMessage({ type: 'recording_started_ack', ...response }));
          break;
        case 'pause_recording':
          handlePauseRecording((response) => port.postMessage({ type: 'recording_paused_ack', ...response }));
          break;
        case 'resume_recording':
          handleResumeRecording((response) => port.postMessage({ type: 'recording_resumed_ack', ...response }));
          break;
        case 'stop_recording':
          handleStopRecording((response) => port.postMessage({ type: 'recording_stopped_ack', ...response }));
          break;
        // Add more cases as needed for other controls
        default:
          // Optionally handle unknown messages
          break;
      }
    });
    
    port.onDisconnect.addListener(() => {
      state.connectedPorts.delete(port);
      console.log('Sidepanel port disconnected');
    });
  }
}

function handleSidepanelConnected(sender) {
  console.log('Sidepanel connected');
  
  // Send connection confirmation
  sendToSidepanels({
    type: 'connection_confirmed',
    data: { status: 'connected' }
  });
  
  // Send current state to newly connected sidepanel
  if (state.isRecording) {
    sendToSidepanels({
      type: 'recording_started',
      data: {
        tabTitle: state.currentSession?.tabTitle,
        startTime: state.sessionStartTime
      }
    });
  }
}

// ============================================================================
// RECORDING CONTROL
// ============================================================================

async function handleStartRecording(sendResponse) {
  try {
    if (state.isRecording) {
      sendResponse({ success: false, error: 'Already recording' });
      return;
    }
    
    // Get current tab info
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }
    
    const activeTab = tabs[0];
    
    // Create new session
    state.currentSession = {
      id: Date.now().toString(),
      tabId: activeTab.id,
      tabTitle: activeTab.title,
      startTime: Date.now()
    };
    
    state.isRecording = true;
    state.sessionStartTime = Date.now();
    state.chunkCounter = 0;
    
    // Start audio capture in offscreen document
    await startAudioCapture(activeTab);
    
    // Notify sidepanels
    sendToSidepanels({
      type: 'recording_started',
      data: {
        tabTitle: activeTab.title,
        startTime: state.sessionStartTime
      }
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('Start recording failed:', error);
    sendResponse({ success: false, error: error.message });
    
    sendToSidepanels({
      type: 'error',
      data: {
        title: 'Recording Failed',
        message: error.message
      }
    });
  }
}

async function handlePauseRecording(sendResponse) {
  try {
    if (!state.isRecording || state.isPaused) {
      sendResponse({ success: false, error: 'Not recording or already paused' });
      return;
    }
    
    state.isPaused = true;
    
    // Pause audio capture
    await pauseAudioCapture();
    
    // Notify sidepanels
    sendToSidepanels({
      type: 'recording_paused',
      data: { pauseTime: Date.now() }
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('Pause recording failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleResumeRecording(sendResponse) {
  try {
    if (!state.isRecording || !state.isPaused) {
      sendResponse({ success: false, error: 'Not recording or not paused' });
      return;
    }
    
    state.isPaused = false;
    
    // Resume audio capture
    await resumeAudioCapture();
    
    // Notify sidepanels
    sendToSidepanels({
      type: 'recording_resumed',
      data: { resumeTime: Date.now() }
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('Resume recording failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStopRecording(sendResponse) {
  try {
    if (!state.isRecording) {
      sendResponse({ success: false, error: 'Not recording' });
      return;
    }
    
    state.isRecording = false;
    state.isPaused = false;
    state.currentSession = null;
    state.sessionStartTime = null;
    
    // Stop audio capture
    await stopAudioCapture();
    
    // Process any remaining offline queue
    await processOfflineQueue();
    
    // Notify sidepanels
    sendToSidepanels({
      type: 'recording_stopped',
      data: { stopTime: Date.now() }
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('Stop recording failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================================
// AUDIO CAPTURE
// ============================================================================

async function startAudioCapture(tab) {
  try {
    // Request tab audio stream
    const streamId = await requestTabAudioStream(tab.id);
    
    // Send start command to offscreen document
    await sendToOffscreen({
      type: 'start_capture',
      data: {
        streamId: streamId,
        tabId: tab.id,
        tabTitle: tab.title
      }
    });
    
  } catch (error) {
    console.error('Audio capture start failed:', error);
    throw error;
  }
}

async function pauseAudioCapture() {
  try {
    await sendToOffscreen({
      type: 'pause_capture',
      data: {}
    });
  } catch (error) {
    console.error('Audio capture pause failed:', error);
  }
}

async function resumeAudioCapture() {
  try {
    await sendToOffscreen({
      type: 'resume_capture',
      data: {}
    });
  } catch (error) {
    console.error('Audio capture resume failed:', error);
  }
}

async function stopAudioCapture() {
  try {
    await sendToOffscreen({
      type: 'stop_capture',
      data: {}
    });
  } catch (error) {
    console.error('Audio capture stop failed:', error);
  }
}

async function requestTabAudioStream(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({
      consumerTabId: tabId,
      targetTabId: tabId
    }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
      } else if (!streamId) {
        reject(new Error('No audio stream available - tab may not have audio or permission denied'));
      } else {
        resolve(streamId);
      }
    });
  });
}

// ============================================================================
// AUDIO PROCESSING
// ============================================================================

async function handleAudioChunkReady(data, sendResponse) {
  try {
    if (!state.isRecording) {
      sendResponse({ success: true });
      return;
    }
    
    // Convert ArrayBuffer back to Blob
    const audioBlob = new Blob([data.audioData], { type: data.mimeType || 'audio/webm' });
    
    // Process transcription
    const transcription = await processTranscription(audioBlob, data);
    
    // Send to sidepanels
    sendToSidepanels({
      type: 'transcription_update',
      data: transcription
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('Audio chunk processing failed:', error);
    
    sendToSidepanels({
      type: 'transcription_error',
      data: {
        chunkId: data.chunkId,
        error: error.message
      }
    });
    
    sendResponse({ success: false, error: error.message });
  }
}

async function processTranscription(audioBlob, metadata) {
  const chunkId = `chunk-${state.chunkCounter++}`;
  const timestamp = Date.now();
  
  // If offline, queue for later processing
  if (!state.isOnline) {
    state.offlineQueue.push({
      chunkId,
      audioBlob,
      metadata,
      timestamp
    });
    
    return {
      chunkId,
      text: `[Queued for offline processing - ${audioBlob.size} bytes]`,
      timestamp,
      provider: 'offline-queue',
      confidence: 0.1
    };
  }
  
  try {
    // Try Gemini API first if available
    if (CONFIG.GEMINI_API_KEY) {
      const text = await transcribeWithRetry(() => transcribeWithGemini(audioBlob), chunkId);
      return {
        chunkId,
        text,
        timestamp,
        provider: 'gemini',
        confidence: 0.9,
        audioSource: state.audioSource
      };
    }
    
    // Fallback to Web Speech API via offscreen document
    const text = await transcribeWithRetry(() => transcribeWithWebSpeechOffscreen(audioBlob), chunkId);
    return {
      chunkId,
      text,
      timestamp,
      provider: 'web-speech',
      confidence: 0.7,
      audioSource: state.audioSource
    };
    
  } catch (error) {
    // Final fallback to basic analysis
    const text = `[Audio chunk ${state.chunkCounter} - ${audioBlob.size} bytes from ${state.audioSource}]`;
    return {
      chunkId,
      text,
      timestamp,
      provider: 'fallback',
      confidence: 0.3,
      audioSource: state.audioSource
    };
  }
}

// ============================================================================
// TRANSCRIPTION SERVICES
// ============================================================================

async function transcribeWithGemini(audioBlob) {
  if (!CONFIG.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }
  
  try {
    // Convert audio to base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${CONFIG.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Transcribe the following audio to text. Return only the transcribed text without any additional commentary or formatting."
          }, {
            inline_data: {
              mime_type: audioBlob.type,
              data: base64
            }
          }]
        }]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text.trim()) {
      throw new Error('No transcription returned from Gemini');
    }
    
    return text.trim();
    
  } catch (error) {
    console.error('Gemini transcription failed:', error);
    throw error;
  }
}

async function transcribeWithWebSpeechOffscreen(audioBlob) {
  try {
    // Convert blob to ArrayBuffer for transmission
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // Send to offscreen document for Web Speech API processing
    const response = await sendToOffscreen({
      type: 'transcribe_web_speech',
      data: {
        audioData: arrayBuffer,
        mimeType: audioBlob.type
      }
    });
    
    if (response && response.success) {
      return response.text;
    } else {
      throw new Error(response?.error || 'Web Speech API transcription failed');
    }
    
  } catch (error) {
    throw new Error(`Web Speech API error: ${error.message}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function sendToOffscreen(message, attempt = 1) {
  try {
    // Ensure offscreen document exists before sending
    const ready = await ensureOffscreenDocument();
    if (!ready) throw new Error('Offscreen document not available');

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // Retry once if receiving end does not exist
          if (chrome.runtime.lastError.message.includes('Receiving end does not exist') && attempt < 2) {
            setTimeout(() => {
              sendToOffscreen(message, attempt + 1).then(resolve).catch(reject);
            }, 500);
          } else {
            reject(new Error(chrome.runtime.lastError.message));
          }
        } else {
          resolve(response);
        }
      });
    });
  } catch (error) {
    console.error('Failed to send message to offscreen:', error);
    throw error;
  }
}

function sendToSidepanels(message) {
  state.connectedPorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch (error) {
      console.error('Failed to send message to sidepanel:', error);
      state.connectedPorts.delete(port);
    }
  });
}

async function handleSetGeminiKey(apiKey, sendResponse) {
  try {
    CONFIG.GEMINI_API_KEY = apiKey;
    await chrome.storage.local.set({ geminiApiKey: apiKey });
    
    // Send response to sidepanels
    sendToSidepanels({
      type: 'api_key_response',
      data: { success: true }
    });
    
    sendResponse({ success: true });
  } catch (error) {
    // Send error to sidepanels
    sendToSidepanels({
      type: 'api_key_response',
      data: { success: false, error: error.message }
    });
    
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================================
// RETRY LOGIC & OFFLINE FUNCTIONALITY
// ============================================================================

async function transcribeWithRetry(transcriptionFn, chunkId) {
  const maxRetries = CONFIG.MAX_RETRIES;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await transcriptionFn();
    } catch (error) {
      lastError = error;
      console.warn(`Transcription attempt ${attempt} failed for chunk ${chunkId}:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = CONFIG.RETRY_DELAY * Math.pow(CONFIG.RETRY_BACKOFF_MULTIPLIER, attempt - 1);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

function setupConnectivityMonitoring() {
  // Service workers don't have window object, use navigator.onLine
  state.isOnline = navigator.onLine;
  // Listen for online/offline events via message passing
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'connectivity_change') {
      state.isOnline = message.isOnline;
      if (state.isOnline) {
        console.log('Connection restored');
        processOfflineQueue();
      } else {
        console.log('Connection lost - switching to offline mode');
      }
    }
  });
}

// ============================================================================
// CLEANUP
// ============================================================================

chrome.runtime.onSuspend.addListener(async () => {
  if (state.isRecording) {
    await stopAudioCapture();
  }
});