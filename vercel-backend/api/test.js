export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check environment variables
    const envStatus = {
      openaiKey: process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not Set',
      nodeEnv: process.env.NODE_ENV || 'Not Set',
      vercel: process.env.VERCEL ? '✅ Yes' : '❌ No'
    };

    return res.status(200).json({
      success: true,
      message: 'Backend is running!',
      timestamp: new Date().toISOString(),
      environment: envStatus,
      instructions: process.env.OPENAI_API_KEY ? 
        'Ready to transcribe audio!' : 
        'Please set OPENAI_API_KEY in Vercel environment variables'
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Test endpoint failed',
      message: error.message
    });
  }
}
