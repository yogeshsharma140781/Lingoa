# Lingoa - 5-Minute Daily Speaking Practice

A language learning app focused entirely on spoken conversation. No lessons, no typing, no grammar drills. Just 5 minutes of speaking practice every day.

## 🎯 Core Concept

Users speak to an AI conversation partner for 5 minutes daily. The timer only runs while actively speaking, encouraging continuous conversation.

## ✨ Features

- **Voice Activity Detection** - Timer pauses during silence
- **Streaming AI Responses** - Fast, natural conversation flow
- **Audio Speed Control** - 0.8×, 0.9×, or 1.0× for beginners
- **Real-time Corrections** - Inline suggestions without interrupting flow
- **Topic Selection** - Choose conversation topics to avoid repetition
- **Post-Session Feedback** - Natural rephrasings without judgmental corrections
- **Daily Streak Tracking** - Gamification to build habits
- **10 Languages** - Spanish, French, German, Dutch, Italian, Portuguese, Hindi, Chinese, Japanese, Korean

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- OpenAI API key

### Backend Setup

> **Note:** This project directory is synced by Google Drive. Google Drive does not
> preserve symlinks and can rename/move synced folders (e.g. appending `(1)`), both of
> which break a Python venv's internal binary symlinks and hardcoded shebang paths.
> Keep the venv **outside** this folder (e.g. `~/.venvs/lingoa-backend`) instead of the
> `backend/venv` path used in older setups.

```bash
cd backend

# Create virtual environment OUTSIDE this Drive-synced folder
python3 -m venv ~/.venvs/lingoa-backend
source ~/.venvs/lingoa-backend/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo "OPENAI_API_KEY=your_key_here" > .env

# Run server
uvicorn main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

The app will be available at `http://localhost:3000`

## 🌐 Deployment (Render)

### Option 1: Using render.yaml (Blueprint)

1. Push code to GitHub
2. In Render dashboard, click "New" → "Blueprint"
3. Connect your repository
4. Render will automatically detect `render.yaml`
5. Set `OPENAI_API_KEY` environment variable in Render dashboard

### Option 2: Manual Setup

1. Create a new "Web Service" in Render
2. Connect your repository
3. Configure:
   - **Build Command**: `cd frontend && npm install && npm run build && cd .. && pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add environment variable: `OPENAI_API_KEY`

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Voice      │  │  Timer      │  │  UI Components      │  │
│  │  Activity   │  │  (client    │  │  (Home, Conversation,│  │
│  │  Detection  │  │   side)     │  │   Topics, etc.)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  STT        │  │  LLM        │  │  TTS                │  │
│  │  (Whisper)  │  │  (GPT-4o)   │  │  (OpenAI TTS)       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 📱 Screens

### 1. Home
- Start button
- Daily streak display
- Language selector

### 2. Topic Selection
- Choose conversation topic
- Random option available
- Remembers last topic

### 3. Conversation
- Speaking visualization (reactive to voice)
- Live speaking timer (client-side)
- Audio speed control
- Real-time corrections

### 4. Completion
- Celebration animation
- Speaking time stats
- Streak update

### 5. Improvements
- 3-5 natural rephrasings
- Audio playback for each

## 🗣️ AI Conversation Style

The AI acts as a friendly conversation partner:
- Short, natural turns (1-2 sentences)
- Open-ended follow-up questions
- Emotionally responsive
- Implicit error correction

Example:
```
User: "Yesterday I go to market"
AI: "Oh nice! What did you buy at the market?"
```

## 🛠️ Tech Stack

**Frontend:**
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Zustand (state)
- Web Audio API (VAD)

**Backend:**
- FastAPI
- OpenAI (Whisper, GPT-4o, TTS)

## 📁 Project Structure

```
language-learning/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── TopicSelectionScreen.tsx
│   │   │   ├── ConversationScreen.tsx
│   │   │   ├── CorrectionCard.tsx
│   │   │   ├── CompletionScreen.tsx
│   │   │   └── ImprovementsScreen.tsx
│   │   ├── hooks/
│   │   │   ├── useVoiceActivity.ts
│   │   │   └── useApi.ts
│   │   ├── store.ts
│   │   ├── App.tsx
│   │   └── index.css
│   └── package.json
├── backend/
│   ├── main.py
│   └── requirements.txt
├── render.yaml
└── README.md
```

## 📄 License

MIT
