#!/bin/bash

echo "🚀 Deploying TwinMind Transcription Backend to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Check if logged in
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel..."
    vercel login
fi

# Check if environment variable is set
echo "🔍 Checking environment variables..."
if vercel env ls | grep -q "OPENAI_API_KEY"; then
    echo "✅ OpenAI API key already configured"
else
    echo "🔑 Setting OpenAI API key..."
    vercel env add OPENAI_API_KEY
fi

echo ""
echo "📝 Note: You can also set environment variables in the Vercel dashboard:"
echo "   1. Go to your project settings"
echo "   2. Navigate to Environment Variables"
echo "   3. Add OPENAI_API_KEY with your API key"
echo ""

# Deploy to production
echo "🌐 Deploying to production..."
vercel --prod

echo "✅ Deployment complete!"
echo "📝 Don't forget to update the baseUrl in background.js with your new Vercel URL"
