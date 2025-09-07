// Offscreen document for audio capture and processing
const state = {
  isCapturing: false,
  isPaused: false,
  mediaRecorder: null,
  audioStream: null,
  chunkCounter: 0,
  sessionStartTime: null,
  overlapBuffer: null,
  audioSource: 'tab'
};

const CONFIG = {
  CHUNK_DURATION: 30000, // 30 seconds
  OVERLAP_DURATION: 3000, // 3 seconds overlap
  AUDIO_QUALITY: {
    sampleRate: 48000,
    channelCount: 2,
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false
  }
};

// Message handling
chrome.runtime.onMessage.addListener(handleMessage);

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'start_capture':
      handleStartCapture(message.data);
      break;
    case 'pause_capture':
      handlePauseCapture();
      break;
    case 'resume_capture':
      handleResumeCapture();
      break;
    case 'stop_capture':
      handleStopCapture();
      break;
    case 'transcribe_web_speech':
      handleTranscribeWebSpeech(message.data, sendResponse);
      return true; // Keep channel open for async response
    case 'health_check':
      sendResponse({ success: true, timestamp: Date.now() });
      break;
  }
  
  return true;
}

// ============================================================================
// AUDIO CAPTURE
// ============================================================================

async function handleStartCapture(data) {
  try {
    if (state.isCapturing) {
      console.log('Already capturing audio');
      return;
    }
    
    console.log('Starting audio capture for tab:', data.tabTitle);
    
    // Get audio stream
    const stream = await getAudioStream(data.streamId);
    state.audioStream = stream;
    
    // Setup media recorder
    await setupMediaRecorder(stream);
    
    state.isCapturing = true;
    state.isPaused = false;
    state.sessionStartTime = Date.now();
    state.chunkCounter = 0;
    state.overlapBuffer = null;
    state.audioSource = 'tab';
    
    console.log('Audio capture started successfully');
    
  } catch (error) {
    console.error('Failed to start audio capture:', error);
    sendErrorToBackground('Audio capture failed', error.message);
  }
}

async function handlePauseCapture() {
  try {
    if (!state.isCapturing || state.isPaused) {
      return;
    }
    
    console.log('Pausing audio capture');
    
    // Pause media recorder
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.pause();
    }
    
    state.isPaused = true;
    console.log('Audio capture paused');
    
  } catch (error) {
    console.error('Failed to pause audio capture:', error);
  }
}

async function handleResumeCapture() {
  try {
    if (!state.isCapturing || !state.isPaused) {
      return;
    }
    
    console.log('Resuming audio capture');
    
    // Resume media recorder
    if (state.mediaRecorder && state.mediaRecorder.state === 'paused') {
      state.mediaRecorder.resume();
    }
    
    state.isPaused = false;
    console.log('Audio capture resumed');
    
  } catch (error) {
    console.error('Failed to resume audio capture:', error);
  }
}

async function handleStopCapture() {
  try {
    if (!state.isCapturing) {
      return;
    }
    
    console.log('Stopping audio capture');
    
    // Stop media recorder
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.stop();
    }
    
    // Stop audio stream
    if (state.audioStream) {
      state.audioStream.getTracks().forEach(track => track.stop());
      state.audioStream = null;
    }
    
    state.isCapturing = false;
    state.isPaused = false;
    state.mediaRecorder = null;
    state.sessionStartTime = null;
    state.overlapBuffer = null;
    
    console.log('Audio capture stopped');
    
  } catch (error) {
    console.error('Failed to stop audio capture:', error);
  }
}

// ============================================================================
// AUDIO STREAM SETUP
// ============================================================================

async function getAudioStream(streamId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        },
        optional: [
          { echoCancellation: false },
          { autoGainControl: false },
          { noiseSuppression: false },
          { latency: 0 }
        ]
      }
    });
    
    console.log('Tab audio stream obtained successfully');
    return stream;
    
  } catch (error) {
    console.error('Failed to get tab audio stream:', error);
    
    // Fallback to microphone
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: CONFIG.AUDIO_QUALITY
      });
      
      console.log('Microphone stream obtained as fallback');
      return micStream;
      
    } catch (micError) {
      throw new Error(`Audio capture failed: ${error.message}. Microphone fallback also failed: ${micError.message}`);
    }
  }
}

async function setupMediaRecorder(stream) {
  try {
    // Determine best audio format
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/wav';
    }
    
    state.mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    // Setup event handlers
    state.mediaRecorder.ondataavailable = handleDataAvailable;
    state.mediaRecorder.onerror = handleRecorderError;
    state.mediaRecorder.onstop = handleRecorderStop;
    
    // Start recording
    state.mediaRecorder.start(CONFIG.CHUNK_DURATION);
    
    console.log('MediaRecorder setup complete, format:', mimeType);
    
  } catch (error) {
    console.error('Failed to setup MediaRecorder:', error);
    throw error;
  }
}

// ============================================================================
// MEDIA RECORDER EVENTS
// ============================================================================

async function handleDataAvailable(event) {
  try {
    if (!state.isCapturing || !event.data || event.data.size === 0) {
      return;
    }
    
    console.log(`Audio chunk ${state.chunkCounter} received, size: ${event.data.size} bytes`);
    
    // Process chunk with overlap
    await processAudioChunk(event.data);
    
    // Continue recording if still capturing
    if (state.isCapturing && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      const nextChunkDuration = CONFIG.CHUNK_DURATION - CONFIG.OVERLAP_DURATION;
      state.mediaRecorder.start(nextChunkDuration);
    }
    
  } catch (error) {
    console.error('Failed to process audio chunk:', error);
    sendErrorToBackground('Audio processing failed', error.message);
  }
}

function handleRecorderError(event) {
  console.error('MediaRecorder error:', event.error);
  sendErrorToBackground('Recording error', event.error.message);
}

function handleRecorderStop() {
  console.log('MediaRecorder stopped');
}

// ============================================================================
// AUDIO PROCESSING
// ============================================================================

async function processAudioChunk(audioBlob) {
  try {
    const chunkId = `chunk-${state.chunkCounter++}`;
    const timestamp = Date.now();
    
    // Convert blob to ArrayBuffer for transmission
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // Store overlap buffer for next chunk
    if (CONFIG.OVERLAP_DURATION > 0) {
      state.overlapBuffer = audioBlob;
    }
    
    // Send to background script for transcription
    await sendAudioChunkToBackground({
      audioData: arrayBuffer,
      mimeType: audioBlob.type,
      chunkId: chunkId,
      timestamp: timestamp,
      size: audioBlob.size
    });
    
  } catch (error) {
    console.error('Failed to process audio chunk:', error);
    throw error;
  }
}

async function sendAudioChunkToBackground(data) {
  try {
    await chrome.runtime.sendMessage({
      type: 'audio_chunk_ready',
      data: data
    });
  } catch (error) {
    console.error('Failed to send audio chunk to background:', error);
  }
}

function sendErrorToBackground(title, message) {
  chrome.runtime.sendMessage({
    type: 'error',
    data: {
      title: title,
      message: message
    }
  }).catch(error => {
    console.error('Failed to send error to background:', error);
  });
}

// ============================================================================
// WEB SPEECH API TRANSCRIPTION
// ============================================================================

async function handleTranscribeWebSpeech(data, sendResponse) {
  try {
    // Convert ArrayBuffer back to Blob
    const audioBlob = new Blob([data.audioData], { type: data.mimeType || 'audio/webm' });
    
    // Use Web Speech API for transcription
    const text = await transcribeWithWebSpeech(audioBlob);
    
    sendResponse({ success: true, text: text });
    
  } catch (error) {
    console.error('Web Speech API transcription failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function transcribeWithWebSpeech(audioBlob) {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio();
      const url = URL.createObjectURL(audioBlob);
      audio.src = url;
      
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reject(new Error('Web Speech API not supported'));
        return;
      }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      
      let transcriptionText = '';
      let isTranscribing = false;
      
      recognition.onstart = () => {
        isTranscribing = true;
      };
      
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcriptionText += event.results[i][0].transcript + ' ';
          }
        }
      };
      
      recognition.onend = () => {
        isTranscribing = false;
        URL.revokeObjectURL(url);
        if (transcriptionText.trim()) {
          resolve(transcriptionText.trim());
        } else {
          reject(new Error('No speech detected'));
        }
      };
      
      recognition.onerror = (event) => {
        isTranscribing = false;
        URL.revokeObjectURL(url);
        reject(new Error(`Speech recognition error: ${event.error}`));
      };
      
      recognition.start();
      audio.play();
      
      audio.onended = () => {
        if (isTranscribing) {
          setTimeout(() => recognition.stop(), 1000);
        }
      };
      
      setTimeout(() => {
        if (isTranscribing) {
          recognition.stop();
          audio.pause();
          URL.revokeObjectURL(url);
          if (transcriptionText.trim()) {
            resolve(transcriptionText.trim());
          } else {
            reject(new Error('Transcription timeout'));
          }
        }
      }, 30000);
      
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
  if (state.isCapturing) {
    handleStopCapture();
  }
});