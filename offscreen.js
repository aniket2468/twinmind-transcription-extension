console.log('🎯 Offscreen Document Initialized');

// ============================================================================
// GLOBAL STATE & CONFIGURATION
// ============================================================================

const state = {
  isRecording: false,
  currentSession: null,
  audioSources: new Map(),
  activeStreams: new Set(),
  audioContext: null,
  mediaRecorder: null,
  chunkCounter: 0,
  sessionStartTime: null
};

const CONFIG = {
  CHUNK_DURATION: 30000, // 30 seconds
  OVERLAP_DURATION: 3000, // 3 seconds overlap
  SAMPLE_RATE: 16000, // Optimal for speech recognition
  CHANNELS: 1, // Mono for better transcription
  BIT_DEPTH: 16,
  PROCESSING_QUEUE_SIZE: 10,
  SIMPLE_MODE: true // Bypass complex audio processing for now
};

// Audio processing pipeline
const audioPipeline = {
  overlapBuffer: null,
  processingQueue: [],
  isProcessing: false,
  lastChunkTime: 0
};

// ============================================================================
// INITIALIZATION
// ============================================================================

// Test API availability
console.log('🔍 Testing API availability:');
console.log('- chrome.tabCapture:', !!chrome.tabCapture);
console.log('- chrome.tabCapture.getMediaStreamId:', !!chrome.tabCapture?.getMediaStreamId);
console.log('- chrome.tabCapture.capture:', !!chrome.tabCapture?.capture);
console.log('- navigator.mediaDevices:', !!navigator.mediaDevices);
console.log('- navigator.mediaDevices.getDisplayMedia:', !!navigator.mediaDevices?.getDisplayMedia);
console.log('- navigator.mediaDevices.getUserMedia:', !!navigator.mediaDevices?.getUserMedia);

// Initialize audio context
initializeAudioContext();

// Set up message listener
chrome.runtime.onMessage.addListener(handleMessage);

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

async function handleMessage(message, sender, sendResponse) {
  try {
    console.log('📨 Offscreen received message:', message.type);
    
    switch (message.type) {
      case 'start_tab_capture':
        await handleStartCapture(message, sendResponse);
        break;
        
      case 'stop_tab_capture':
        await handleStopCapture(sendResponse);
        break;
        
      default:
        console.warn('⚠️ Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
    }
    
  } catch (error) {
    console.error('❌ Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Keep message channel open for async response
}

// ============================================================================
// AUDIO CAPTURE MANAGEMENT
// ============================================================================

async function runAudioCaptureDiagnostics() {
  console.log('🔍 Running audio capture diagnostics...');
  
  // Check Chrome APIs
  console.log('📋 Chrome APIs available:');
  console.log('  - chrome.tabCapture:', !!chrome.tabCapture);
  console.log('  - chrome.tabCapture.getMediaStreamId:', !!(chrome.tabCapture?.getMediaStreamId));
  console.log('  - chrome.tabCapture.capture:', !!(chrome.tabCapture?.capture));
  
  // Check MediaDevices APIs
  console.log('📋 MediaDevices APIs available:');
  console.log('  - navigator.mediaDevices:', !!navigator.mediaDevices);
  console.log('  - getUserMedia:', !!(navigator.mediaDevices?.getUserMedia));
  console.log('  - getDisplayMedia:', !!(navigator.mediaDevices?.getDisplayMedia));
  
  // Check permissions
  try {
    const permissions = await navigator.permissions.query({ name: 'microphone' });
    console.log('📋 Microphone permission:', permissions.state);
  } catch (error) {
    console.log('📋 Microphone permission check failed:', error.message);
  }
  
  // Check if we're in an offscreen document
  console.log('📋 Document context:', {
    isOffscreen: !!window.chrome?.offscreen,
    documentType: document.constructor.name,
    url: window.location.href
  });
  
  console.log('✅ Diagnostics complete');
}

async function handleStartCapture(message, sendResponse) {
  try {
    console.log('🎬 Starting audio capture session...');
    
    // Run diagnostics first
    await runAudioCaptureDiagnostics();
    
    // Initialize session
    state.currentSession = {
      id: generateSessionId(),
      tabId: message.tabId,
      startTime: Date.now(),
      config: message.config || CONFIG
    };
    
    // Initialize audio context if needed
    if (!state.audioContext) {
      await initializeAudioContext();
    }
    
    // Start audio capture with fallback chain
    const stream = await captureAudioWithFallbacks(message.tabId);
    if (!stream) {
      throw new Error('All audio capture methods failed');
    }
    
    // Set up recording pipeline
    await setupRecordingPipeline(stream);
    
    // Update state
    state.isRecording = true;
    state.sessionStartTime = Date.now();
    state.chunkCounter = 0;
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'capture_started',
      data: {
        sessionId: state.currentSession.id,
        audioSources: Array.from(state.audioSources.values()),
        timestamp: Date.now()
      }
    });
    
    console.log('✅ Audio capture session started successfully');
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('❌ Failed to start capture:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStopCapture(sendResponse) {
  try {
    if (!state.isRecording) {
      throw new Error('No recording session in progress');
    }
    
    console.log('🛑 Stopping audio capture session...');
    
    // Stop media recorder
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    
    // Stop all audio streams
    state.activeStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    state.activeStreams.clear();
    
    // Close audio context
    if (state.audioContext && state.audioContext.state !== 'closed') {
      await state.audioContext.close();
    }
    
    // Clear state
    state.isRecording = false;
    state.currentSession = null;
    state.audioSources.clear();
    state.chunkCounter = 0;
    audioPipeline.overlapBuffer = null;
    audioPipeline.processingQueue = [];
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'capture_stopped',
      data: {
        sessionId: state.currentSession?.id,
        transcriptionCount: state.chunkCounter,
        timestamp: Date.now()
      }
    });
    
    console.log('✅ Audio capture session stopped successfully');
    sendResponse({ success: true });
    
  } catch (error) {
    console.error('❌ Failed to stop capture:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================================================
// AUDIO CAPTURE METHODS
// ============================================================================

async function captureAudioWithFallbacks(tabId) {
  console.log('🔍 Starting audio capture with fallback chain...');
  
  // Method 1: getMediaStreamId (most reliable)
  if (chrome.tabCapture?.getMediaStreamId) {
    console.log('🎯 Trying getMediaStreamId method...');
    const stream = await captureWithStreamId(tabId);
    if (stream) {
      console.log('✅ getMediaStreamId capture successful');
      return stream;
    }
  }
  
  // Method 2: Direct tab capture
  if (chrome.tabCapture?.capture) {
    console.log('🔄 Trying direct tab capture...');
    const stream = await captureDirect(tabId);
    if (stream) {
      console.log('✅ Direct tab capture successful');
      return stream;
    }
  }
  
  // Method 3: Display media (screen sharing)
  console.log('🔄 Trying display media capture...');
  const displayStream = await captureDisplayMedia();
  if (displayStream) {
    console.log('✅ Display media capture successful');
    return displayStream;
  }
  
  // Method 4: Microphone fallback
  console.log('🎤 Trying microphone capture as fallback...');
  const micStream = await captureMicrophone();
  if (micStream) {
    console.log('✅ Microphone capture successful');
    return micStream;
  }
  
  console.error('❌ All capture methods failed');
  return null;
}

async function captureWithStreamId(tabId) {
  return new Promise((resolve) => {
    console.log(`🎯 Requesting stream ID for tab ${tabId}...`);
    
    // Check if tabCapture API is available
    if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
      console.error('❌ tabCapture.getMediaStreamId not available');
      resolve(null);
      return;
    }
    
    chrome.tabCapture.getMediaStreamId(
      { consumerTabId: tabId },
      async (streamId) => {
        if (chrome.runtime.lastError) {
          console.error('❌ getMediaStreamId error:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        
        if (!streamId) {
          console.error('❌ No stream ID received');
          resolve(null);
          return;
        }
        
        console.log(`✅ Got stream ID: ${streamId}`);
        
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
              },
              optional: [
                { echoCancellation: false },
                { noiseSuppression: false },
                { autoGainControl: false },
                { sampleRate: CONFIG.SAMPLE_RATE },
                { channelCount: CONFIG.CHANNELS }
              ]
            }
          });
          
          console.log('✅ getUserMedia successful with stream ID');
          resolve(stream);
          
        } catch (error) {
          console.error('❌ getUserMedia failed with stream ID:', error);
          console.error('🔍 Error details:', {
            name: error.name,
            message: error.message,
            constraint: error.constraint
          });
          resolve(null);
        }
      }
    );
  });
}

async function captureDirect(tabId) {
  return new Promise((resolve) => {
    console.log('🔄 Attempting direct tab capture...');
    
    // Check if tabCapture API is available
    if (!chrome.tabCapture || !chrome.tabCapture.capture) {
      console.error('❌ tabCapture.capture not available');
      resolve(null);
      return;
    }
    
    chrome.tabCapture.capture({ 
      audio: true, 
      video: false 
    }, (stream) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Direct capture error:', chrome.runtime.lastError);
        resolve(null);
        return;
      }
      
      if (!stream) {
        console.error('❌ No stream from direct capture');
        resolve(null);
        return;
      }
      
      console.log('✅ Direct tab capture successful');
      resolve(stream);
    });
  });
}

async function captureDisplayMedia() {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      console.warn('⚠️ getDisplayMedia not supported');
      return null;
    }
    
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: false
    });
    
    return stream;
    
  } catch (error) {
    console.warn('⚠️ Display media capture failed:', error);
    return null;
  }
}

async function captureMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: CONFIG.SAMPLE_RATE,
        channelCount: CONFIG.CHANNELS
      }
    });
    
    // Add microphone source
    state.audioSources.set('microphone', {
      id: 'microphone',
      type: 'microphone',
      name: 'Microphone',
      active: true,
      timestamp: Date.now()
    });
    
    return stream;
    
  } catch (error) {
    console.warn('⚠️ Microphone capture failed:', error);
    return null;
  }
}

// ============================================================================
// RECORDING PIPELINE SETUP
// ============================================================================

async function setupRecordingPipeline(stream) {
  try {
    console.log('🔧 Setting up recording pipeline...');
    
    // Store stream
    state.activeStreams.add(stream);
    
    // Add tab audio source
    state.audioSources.set('tab', {
      id: 'tab',
      type: 'tab',
      name: 'Tab Audio',
      active: true,
      timestamp: Date.now()
    });
    
    // Create optimized MediaRecorder
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
      ? 'audio/webm;codecs=opus' 
      : 'audio/webm';
    
    state.mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    // Set up event handlers
    setupMediaRecorderHandlers();
    
    // Start recording with chunk timing
    state.mediaRecorder.start(CONFIG.CHUNK_DURATION);
    
    console.log(`✅ Recording pipeline started with ${CONFIG.CHUNK_DURATION/1000}s chunks`);
    
  } catch (error) {
    console.error('❌ Failed to setup recording pipeline:', error);
    throw error;
  }
}

function setupMediaRecorderHandlers() {
  // Handle data available
  state.mediaRecorder.ondataavailable = async (event) => {
    try {
      if (!event.data || event.data.size === 0) {
        console.warn(`⚠️ Empty audio chunk received for chunk ${state.chunkCounter}`);
        return;
      }
      
      console.log(`📦 Audio chunk ${state.chunkCounter} received: ${event.data.size} bytes`);
      
      // Validate the audio data
      if (!(event.data instanceof Blob)) {
        console.error(`❌ Invalid audio data type for chunk ${state.chunkCounter}:`, typeof event.data);
        return;
      }
      
      // Process audio chunk with overlap handling
      await processAudioChunk(event.data, state.chunkCounter);
      
      state.chunkCounter++;
      
    } catch (error) {
      console.error(`❌ Error processing audio chunk ${state.chunkCounter}:`, error);
    }
  };
  
  // Handle recording stop
  state.mediaRecorder.onstop = () => {
    console.log('🛑 MediaRecorder stopped');
    
    // Process any remaining audio
    if (audioPipeline.processingQueue.length > 0) {
      processAudioQueue();
    }
  };
  
  // Handle recording errors
  state.mediaRecorder.onerror = (event) => {
    console.error('❌ MediaRecorder error:', event.error);
    
    chrome.runtime.sendMessage({
      type: 'capture_error',
      data: {
        error: event.error.message,
        timestamp: Date.now()
      }
    });
  };
}

// ============================================================================
// AUDIO PROCESSING PIPELINE
// ============================================================================

async function processAudioChunk(audioBlob, chunkId) {
  try {
    console.log(`🔄 Processing audio chunk ${chunkId}...`);
    
    // Validate audio blob
    if (!audioBlob || !(audioBlob instanceof Blob)) {
      console.error(`❌ Invalid audio blob for chunk ${chunkId}:`, audioBlob);
      return;
    }
    
    // Simple mode: bypass complex processing
    if (CONFIG.SIMPLE_MODE) {
      console.log(`🔄 Simple mode: sending raw audio for chunk ${chunkId}`);
      await sendAudioForTranscription(audioBlob, chunkId);
      return;
    }
    
    // Add to processing queue
    audioPipeline.processingQueue.push({
      blob: audioBlob,
      chunkId: chunkId,
      timestamp: Date.now()
    });
    
    // Limit queue size
    if (audioPipeline.processingQueue.length > CONFIG.PROCESSING_QUEUE_SIZE) {
      audioPipeline.processingQueue.shift();
    }
    
    // Process queue if not already processing
    if (!audioPipeline.isProcessing) {
      processAudioQueue();
    }
    
  } catch (error) {
    console.error(`❌ Failed to process chunk ${chunkId}:`, error);
    
    // Fallback: send raw audio without processing
    try {
      console.log(`🔄 Fallback: sending raw audio for chunk ${chunkId}`);
      await sendAudioForTranscription(audioBlob, chunkId);
    } catch (fallbackError) {
      console.error(`❌ Fallback also failed for chunk ${chunkId}:`, fallbackError);
    }
  }
}

async function processAudioQueue() {
  if (audioPipeline.isProcessing || audioPipeline.processingQueue.length === 0) {
    return;
  }
  
  audioPipeline.isProcessing = true;
  console.log(`📋 Processing audio queue: ${audioPipeline.processingQueue.length} items`);
  
  try {
    while (audioPipeline.processingQueue.length > 0) {
      const item = audioPipeline.processingQueue.shift();
      
      // Process with overlap handling
      const processedAudio = await processWithOverlap(item.blob, item.chunkId);
      
      // Check if processing was successful
      if (!processedAudio) {
        console.warn(`⚠️ Skipping chunk ${item.chunkId} - processing failed`);
        continue;
      }
      
      // Send to background for transcription
      await sendAudioForTranscription(processedAudio, item.chunkId);
      
      // Add delay between processing to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
  } catch (error) {
    console.error('❌ Audio queue processing failed:', error);
  } finally {
    audioPipeline.isProcessing = false;
  }
}

async function processWithOverlap(audioBlob, chunkId) {
  try {
    let hasOverlap = false;
    let processedAudio = audioBlob;
    
    // Validate input audio blob
    if (!audioBlob || !(audioBlob instanceof Blob)) {
      console.error(`❌ Invalid audio blob for overlap processing: chunk ${chunkId}`, audioBlob);
      return null;
    }
    
    // Handle overlap for chunks after the first
    if (chunkId > 0 && audioPipeline.overlapBuffer) {
      console.log(`🔄 Creating overlapped audio for chunk ${chunkId}`);
      
      try {
        // Merge overlap buffer with current chunk
        processedAudio = await mergeAudioWithOverlap(audioPipeline.overlapBuffer, audioBlob);
        hasOverlap = true;
      } catch (mergeError) {
        console.warn(`⚠️ Overlap merge failed for chunk ${chunkId}:`, mergeError);
        // Fall back to original audio
        processedAudio = audioBlob;
      }
    }
    
    // Extract overlap buffer for next chunk (last 3 seconds)
    try {
      audioPipeline.overlapBuffer = await extractAudioTail(audioBlob, CONFIG.OVERLAP_DURATION);
    } catch (extractError) {
      console.warn(`⚠️ Failed to extract audio tail for chunk ${chunkId}:`, extractError);
      audioPipeline.overlapBuffer = null;
    }
    
    // Ensure processedAudio is a valid blob
    if (!processedAudio || !(processedAudio instanceof Blob)) {
      console.warn(`⚠️ Overlap processing failed, using original audio for chunk ${chunkId}`);
      processedAudio = audioBlob;
    }
    
    // Update overlap flag
    processedAudio.hasOverlap = hasOverlap;
    
    return processedAudio;
    
  } catch (error) {
    console.warn(`⚠️ Overlap processing failed for chunk ${chunkId}:`, error);
    // Return original audio if overlap processing fails
    if (audioBlob && audioBlob instanceof Blob) {
      audioBlob.hasOverlap = false;
      return audioBlob;
    }
    return null;
  }
}

async function mergeAudioWithOverlap(overlapBuffer, currentChunk) {
  try {
    if (!state.audioContext) {
      throw new Error('AudioContext not available');
    }
    
    // Decode both audio buffers
    const [overlapArrayBuffer, currentArrayBuffer] = await Promise.all([
      overlapBuffer.arrayBuffer(),
      currentChunk.arrayBuffer()
    ]);
    
    const [overlapAudioBuffer, currentAudioBuffer] = await Promise.all([
      state.audioContext.decodeAudioData(overlapArrayBuffer),
      state.audioContext.decodeAudioData(currentArrayBuffer)
    ]);
    
    // Calculate overlap samples
    const overlapSamples = Math.floor((CONFIG.OVERLAP_DURATION / 1000) * CONFIG.SAMPLE_RATE);
    const totalSamples = overlapSamples + currentAudioBuffer.length;
    
    // Create merged buffer
    const mergedBuffer = state.audioContext.createBuffer(
      CONFIG.CHANNELS,
      totalSamples,
      CONFIG.SAMPLE_RATE
    );
    
    // Get channel data
    const overlapData = overlapAudioBuffer.getChannelData(0);
    const currentData = currentAudioBuffer.getChannelData(0);
    const mergedData = mergedBuffer.getChannelData(0);
    
    // Copy overlap data
    for (let i = 0; i < Math.min(overlapSamples, overlapData.length); i++) {
      mergedData[i] = overlapData[i];
    }
    
    // Copy current data
    for (let i = 0; i < currentData.length; i++) {
      mergedData[overlapSamples + i] = currentData[i];
    }
    
    // Convert back to blob
    const mergedBlob = await audioBufferToBlob(mergedBuffer);
    mergedBlob.hasOverlap = true;
    
    return mergedBlob;
    
  } catch (error) {
    console.error('❌ Failed to merge audio with overlap:', error);
    throw error;
  }
}

async function extractAudioTail(audioBlob, durationMs) {
  try {
    if (!state.audioContext) {
      throw new Error('AudioContext not available');
    }
    
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
    
    const tailSamples = Math.floor((durationMs / 1000) * audioBuffer.sampleRate);
    const startSample = Math.max(0, audioBuffer.length - tailSamples);
    
    // Create buffer for tail
    const tailBuffer = state.audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      tailSamples,
      audioBuffer.sampleRate
    );
    
    // Copy tail data
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const tailData = tailBuffer.getChannelData(channel);
      
      for (let i = 0; i < tailSamples; i++) {
        tailData[i] = sourceData[startSample + i] || 0;
      }
    }
    
    return await audioBufferToBlob(tailBuffer);
    
  } catch (error) {
    console.error('❌ Failed to extract audio tail:', error);
    return null;
  }
}

async function audioBufferToBlob(audioBuffer) {
  try {
    // Create offline context for rendering
    const offlineContext = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    
    // Create buffer source
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();
    
    // Render audio
    const renderedBuffer = await offlineContext.startRendering();
    
    // Convert to WAV format
    const wavBlob = audioBufferToWav(renderedBuffer);
    
    return wavBlob;
    
  } catch (error) {
    console.error('❌ Failed to convert audio buffer to blob:', error);
    throw error;
  }
}

function audioBufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  
  // Create WAV file
  const arrayBuffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(arrayBuffer);
  
  // WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * numChannels * 2, true);
  
  // Convert audio data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = audioBuffer.getChannelData(channel)[i];
      const intSample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, intSample * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ============================================================================
// TRANSCRIPTION INTEGRATION
// ============================================================================

async function sendAudioForTranscription(audioBlob, chunkId) {
  try {
    console.log(`📤 Sending chunk ${chunkId} for transcription...`);
    
    // Validate audio blob before sending
    if (!audioBlob || !(audioBlob instanceof Blob)) {
      console.error(`❌ Invalid audio blob for chunk ${chunkId}:`, audioBlob);
      return;
    }
    
    // Ensure blob has content
    if (audioBlob.size === 0) {
      console.warn(`⚠️ Empty audio blob for chunk ${chunkId}`);
      return;
    }
    
    console.log(`📊 Chunk ${chunkId} blob validation:`, {
      size: audioBlob.size,
      type: audioBlob.type,
      constructor: audioBlob.constructor.name,
      hasOverlap: audioBlob.hasOverlap || false
    });
    
    // Send to background script
    chrome.runtime.sendMessage({
      type: 'audio_chunk_ready',
      data: {
        blob: audioBlob,
        chunkId: chunkId,
        tabId: state.currentSession?.tabId,
        timestamp: Date.now(),
        duration: CONFIG.CHUNK_DURATION,
        hasOverlap: audioBlob.hasOverlap || false,
        sessionId: state.currentSession?.id
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`❌ Failed to send chunk ${chunkId}:`, chrome.runtime.lastError);
      } else {
        console.log(`✅ Chunk ${chunkId} sent for transcription`);
      }
    });
    
  } catch (error) {
    console.error(`❌ Error sending chunk ${chunkId}:`, error);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function initializeAudioContext() {
  try {
    if (state.audioContext && state.audioContext.state !== 'closed') {
      return;
    }
    
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: CONFIG.SAMPLE_RATE
    });
    
    console.log('✅ AudioContext initialized');
    
  } catch (error) {
    console.error('❌ Failed to initialize AudioContext:', error);
    throw error;
  }
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// CLEANUP & ERROR HANDLING
// ============================================================================

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (state.isRecording) {
    console.log('🔄 Page unloading - stopping recording');
    handleStopCapture(() => {});
  }
});

// Handle errors
window.addEventListener('error', (event) => {
  console.error('❌ Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled promise rejection:', event.reason);
});

console.log('🎯 Offscreen Document Ready');
