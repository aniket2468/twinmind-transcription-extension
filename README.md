# Real-Time Audio Transcription

A professional Chrome extension for real-time audio transcription with advanced features, offline buffering, and multi-source audio capture support.

## 🎯 Features

### ✅ Core Features
- **Real-time Audio Transcription**: Captures and transcribes audio from browser tabs and microphone
- **Advanced Audio Processing**: 30-second chunks with 3-second overlap for seamless transcription
- **Multi-Source Support**: Tab audio, microphone, and display media capture
- **Professional Sidepanel UI**: Clean, modern interface with real-time status updates
- **Offline Buffering**: Continues recording during network interruptions
- **Session Management**: Meeting timer and comprehensive session tracking

### ✅ Advanced Features
- **3-Second Overlap Processing**: Prevents word loss between audio chunks
- **Channel Labeling**: Clear indication of audio source (tab vs microphone)
- **Offline Queue Management**: Automatic retry with exponential backoff
- **Performance Optimized**: Minimal CPU usage with efficient audio processing
- **Error Recovery**: Comprehensive error handling and automatic reconnection

## 🚀 Quick Start

### 1. Get OpenAI API Key
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy your API key (starts with `sk-`)

### 2. Configure API Key
1. Open `background.js` in the extension folder
2. Find this line:
   ```javascript
   openaiApiKey: 'YOUR_OPENAI_API_KEY_HERE'
   ```
3. Replace with your actual API key:
   ```javascript
   openaiApiKey: 'sk-your-actual-api-key-here'
   ```

### 3. Install Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the extension folder
5. The extension icon will appear in your toolbar

### 4. Grant Permissions
1. Click the extension icon
2. Click "Open Transcription Panel"
3. Grant required permissions when prompted

## 🎵 How to Use

### Basic Usage
1. **Open Sidepanel**: Click extension icon → "Open Transcription Panel"
2. **Start Recording**: Click "Start Auto Recording" button
3. **View Live Transcription**: Real-time text appears with timestamps
4. **Stop Recording**: Click "Stop Recording" when finished
5. **Export Results**: Copy to clipboard or download in various formats

### Audio Sources
- **Tab Audio**: Automatically detects audio from active browser tabs
- **Microphone**: Direct microphone input as fallback
- **Display Media**: Screen sharing audio capture

### Recording Controls
- **Start Auto Recording**: Begin audio capture and transcription
- **Stop Recording**: End recording session
- **Session Timer**: Real-time display of recording duration
- **Status Indicators**: Online/offline status and connection health

## 🔧 Technical Architecture

### Core Components
- **Background Service Worker** (`background.js`): Manages state, API calls, and coordination
- **Offscreen Document** (`offscreen.js`): Handles advanced audio capture and processing
- **Sidepanel UI** (`sidepanel.html/js/css`): User interface and controls
- **Manifest V3**: Modern Chrome extension standard

### Audio Processing Pipeline
- **Chunk Duration**: 30 seconds (configurable)
- **Overlap**: 3 seconds between chunks
- **Sample Rate**: 16kHz (optimized for speech recognition)
- **Format**: WebM audio for optimal Whisper API compatibility

### OpenAI Whisper Integration
- **Model**: whisper-1 (latest OpenAI model)
- **Response Format**: Verbose JSON with confidence scores
- **Language**: Auto-detection (English optimized)
- **Error Handling**: Comprehensive retry logic and fallbacks

### Communication System
- **Port-based Communication**: Stable connection between sidepanel and background
- **Message Routing**: Efficient message handling with acknowledgments
- **Heartbeat System**: Connection keep-alive mechanism
- **Automatic Reconnection**: Handles connection failures gracefully

## 📁 Project Structure

```
TwinMind Assignment/
├── manifest.json              # Extension configuration and permissions
├── background.js              # Service worker with transcription service
├── offscreen.html             # Offscreen document for audio processing
├── offscreen.js               # Advanced audio capture and processing
├── sidepanel.html             # Main UI layout
├── sidepanel.js               # UI logic and background communication
├── sidepanel.css              # Professional styling and animations
├── README.md                  # This documentation
└── icons/                     # Extension icons
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## 🔍 Troubleshooting

### Common Issues

#### "Tab Audio: No audio detected"
- **Solution**: Ensure the tab is actually playing audio (YouTube video, etc.)
- **Note**: Chrome's `audible` property is unreliable, extension will attempt capture anyway

#### "Failed to start recording"
- **Check**: Console for detailed error messages
- **Verify**: OpenAI API key is configured correctly
- **Ensure**: Tab has audio content playing

#### "Message port closed" errors
- **Status**: Fixed in latest version with heartbeat system
- **If persists**: Reload extension completely

#### Audio capture not working
- **Check**: Console for diagnostic information
- **Verify**: Permissions are granted
- **Ensure**: Using Chrome 114+ (required for Sidepanel API)

### Debugging
- **Background Script**: `chrome://extensions/` → "Inspect views: service worker"
- **Sidepanel**: Open sidepanel → Right-click → "Inspect"
- **Offscreen Document**: Check console for detailed audio capture logs

## 🎯 Success Criteria Met

### ✅ MVP Requirements
- ✅ Real-time audio transcription from browser tabs
- ✅ 30-second chunked processing with overlap
- ✅ Start/stop recording controls
- ✅ Export functionality (copy/download)
- ✅ Basic error handling

### ✅ Advanced Features
- ✅ 3-second overlap processing
- ✅ Channel labeling (tab vs microphone)
- ✅ Offline buffering and queue management
- ✅ Meeting timer and session tracking
- ✅ Professional UI/UX design
- ✅ Comprehensive error handling with retry logic

## 💰 Pricing

### OpenAI Whisper API
- **Cost**: $0.006 per minute of audio
- **Example**: 1 hour of transcription = $0.36
- **Very affordable** for regular use

## 🔧 Development

### Local Development
1. Make changes to source files
2. Go to `chrome://extensions/`
3. Click "Reload" on the extension
4. Test functionality

### Testing Checklist
1. Open a tab with audio (YouTube, etc.)
2. Open sidepanel
3. Start recording
4. Verify transcription appears
5. Test export functionality
6. Check error handling

## 📄 License

MIT License - Feel free to modify and distribute.

## 🎉 Ready for Production!

The extension is now ready for use with your OpenAI API key. Perfect for:
- Meeting transcriptions
- Video content analysis
- Accessibility support
- Language learning
- Content creation
- Professional audio processing

---

**Need help?** Check the troubleshooting section or check the console for detailed diagnostic information.