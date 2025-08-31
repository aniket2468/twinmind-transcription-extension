# TwinMind Transcription Backend

This is the backend API for the TwinMind audio transcription Chrome extension, hosted on Vercel.

## 🚀 **Deployment Steps**

### **1. Install Vercel CLI**
```bash
npm install -g vercel
```

### **2. Login to Vercel**
```bash
vercel login
```

### **3. Set Environment Variables**

**Option A: Via Vercel Dashboard (Recommended)**
1. Go to [vercel.com](https://vercel.com) and login
2. Create a new project or select existing one
3. Go to **Settings** → **Environment Variables**
4. Add: `OPENAI_API_KEY` with your actual API key value
5. Select **Production**, **Preview**, and **Development** environments

**Option B: Via Vercel CLI**
```bash
vercel env add OPENAI_API_KEY
# Enter your OpenAI API key when prompted
```

### **4. Deploy to Vercel**
```bash
vercel --prod
```

### **5. Get Your Backend URL**
After deployment, you'll get a URL like:
```
https://your-app-name.vercel.app
```

### **6. Update Extension**
In `background.js`, replace:
```javascript
this.baseUrl = 'https://your-vercel-app.vercel.app/api';
```
with your actual Vercel URL.

## 🔧 **Configuration**

- **API Endpoint**: `/api/transcribe`
- **Method**: POST
- **Max Duration**: 30 seconds (configurable in vercel.json)
- **Environment Variables**: `OPENAI_API_KEY`

## 📝 **API Usage**

### **Request Body**
```json
{
  "audioData": "base64_encoded_audio",
  "format": "json",
  "customPrompt": "Optional custom prompt"
}
```

### **Response**
```json
{
  "success": true,
  "text": "Transcribed text",
  "language": "en",
  "duration": 10.5,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🔒 **Security**

- ✅ **API key hidden** from extension
- ✅ **Serverless functions** for scalability
- ✅ **Environment variables** for secrets
- ✅ **CORS enabled** for extension access

## 💡 **Benefits**

1. **Hide API Keys** - No more exposed secrets in extension
2. **Scalable** - Vercel handles traffic automatically
3. **Secure** - Environment variables keep secrets safe
4. **Fast** - Global CDN for low latency
5. **Free Tier** - Generous free hosting available
