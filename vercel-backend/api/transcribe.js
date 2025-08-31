import OpenAI from 'openai';

// Initialize OpenAI with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Check if API key is configured
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable not set');
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if API key is configured
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ 
      error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable in Vercel.' 
    });
  }

  try {
    const { audioData, format = 'json', customPrompt } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Convert base64 audio to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    // Create transcription request
    const transcriptionRequest = {
      file: audioBuffer,
      model: 'whisper-1',
      response_format: format === 'json' ? 'json' : 'text',
      language: 'en', // Can be made configurable
    };

    // Add custom prompt if provided
    if (customPrompt) {
      transcriptionRequest.prompt = customPrompt;
    }

    // Call OpenAI API
    const transcription = await openai.audio.transcriptions.create(transcriptionRequest);

    // Return the transcription
    return res.status(200).json({
      success: true,
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Transcription error:', error);
    
    // Handle specific OpenAI errors
    if (error.response) {
      return res.status(error.response.status).json({
        error: `OpenAI API Error: ${error.response.data?.error?.message || error.message}`,
        code: error.response.status
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
