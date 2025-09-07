# Real-Time Audio Transcription Chrome Extension

A clean, reliable Chrome extension that captures audio from browser tabs and provides real-time transcription using Google Gemini 2.5 Flash API.

## Features

### ✅ Core Features
- **Tab Audio Capture**: Captures audio from active browser tabs (YouTube, Google Meet, etc.)
- **Real-time Transcription**: Updates transcript every 30 seconds
- **Clean UI**: Simple, intuitive sidepanel interface
- **Export Options**: Copy to clipboard or download as text file
- **Session Timer**: Shows current recording duration
- **Error Handling**: Comprehensive error handling with user-friendly messages

### ✅ Advanced Features
- **30-Second Chunks**: Processes audio in 30-second segments
- **3-Second Overlap**: Ensures no words are lost between chunks
- **Google Gemini Integration**: Uses Gemini 2.5 Flash for high-quality transcription
- **Web Speech API Fallback**: Falls back to browser speech recognition if Gemini fails
- **Microphone Fallback**: Falls back to microphone if tab audio fails
- **Offline Buffering**: Handles connection issues gracefully

## Installation

1. **Download the Extension**
   - Download the extension files
   - Extract to a folder

2. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extension folder

3. **Configure API Key (Optional)**
   - The extension works with Web Speech API by default
   - For better accuracy, configure Google Gemini API key:
     - Get API key from [Google AI Studio](https://aistudio.google.com/)
     - The extension will prompt for the key on first use

## Usage

1. **Start Recording**
   - Click the extension icon to open the sidepanel
   - Click "Start Recording" to begin capturing tab audio
   - The extension will automatically detect and capture audio from the current tab

2. **View Transcription**
   - Transcribed text appears in real-time
   - Each chunk shows timestamp and transcription source
   - Auto-scrolls to show latest content

3. **Export Results**
   - Use "Copy" to copy transcript to clipboard
   - Use "Download" to save as text file
   - Use "Clear" to start fresh

4. **Stop Recording**
   - Click "Stop Recording" to end the session
   - All transcriptions are preserved until cleared

## Technical Details

### Architecture
- **Manifest V3**: Modern Chrome extension architecture
- **Service Worker**: Background processing
- **Offscreen Document**: Audio capture and processing
- **Sidepanel**: User interface

### Audio Processing
- **Format**: WebM with Opus codec
- **Quality**: 48kHz, stereo, 128kbps
- **Chunking**: 30-second chunks with 3-second overlap
- **Fallback**: Microphone capture if tab audio fails

### Transcription Services
1. **Google Gemini 2.5 Flash** (Primary)
   - High accuracy transcription
   - Multi-modal LLM with audio support
   - Free tier available

2. **Web Speech API** (Fallback)
   - Browser-native speech recognition
   - Works offline
   - Good for basic transcription

3. **Basic Analysis** (Final Fallback)
   - Shows audio metadata
   - Ensures something is always displayed

## File Structure

```
extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── sidepanel.html         # Main UI
├── sidepanel.js           # UI logic
├── sidepanel.css          # Styling
├── offscreen.html         # Audio capture document
├── offscreen.js           # Audio processing
└── README.md              # This file
```

## Permissions

- `tabs`: Access to tab information
- `tabCapture`: Capture tab audio
- `activeTab`: Access current tab
- `sidePanel`: Sidepanel interface
- `offscreen`: Audio processing
- `storage`: Save settings and API keys

## Browser Compatibility

- **Chrome 88+**: Required for getDisplayMedia API
- **Modern Browsers**: Web Speech API support
- **Mobile**: Limited (sidepanel not supported on mobile)

## Troubleshooting

### Common Issues

1. **"No audio stream available"**
   - Ensure the tab is playing audio
   - Try refreshing the page
   - Check if audio is muted

2. **"Web Speech API not supported"**
   - Update Chrome to latest version
   - Check if microphone permissions are granted

3. **"Gemini API error"**
   - Check API key configuration
   - Verify internet connection
   - Check API quota limits

### Debug Mode

Open Chrome DevTools to see detailed logs:
1. Right-click extension icon → "Inspect popup"
2. Check Console tab for error messages
3. Check Network tab for API calls

## Development

### Setup
1. Clone the repository
2. Load extension in Chrome
3. Make changes to source files
4. Reload extension in Chrome

### Testing
1. Test with different audio sources
2. Test with poor network conditions
3. Test error scenarios
4. Verify all export functions

## License

This project is open source and available under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review Chrome DevTools console
3. Create an issue with detailed description