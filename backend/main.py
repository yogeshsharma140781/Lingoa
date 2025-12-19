"""
Lingoa - Backend API
5-Minute Daily Speaking Practice with Streaming AI
"""

import os
import json
import asyncio
import base64
import uuid
import random
import re
from datetime import datetime
from typing import Optional, AsyncGenerator, List
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

# Import TTS provider (ElevenLabs primary, OpenAI fallback)
from tts_provider import (
    get_tts_provider, 
    get_tts_provider_type,
    preprocess_text_for_speech,
    chunk_text_for_streaming,
    ElevenLabsTTSProvider
)

# Check if we're in production (frontend is built)
FRONTEND_BUILD_PATH = Path(__file__).parent.parent / "frontend" / "dist"
IS_PRODUCTION = FRONTEND_BUILD_PATH.exists()

# Initialize OpenAI client
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# In-memory storage (replace with DB in production)
sessions = {}
user_streaks = {}
daily_completions = {}

# Language code to full name mapping
LANGUAGE_NAMES = {
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "nl": "Dutch",
    "it": "Italian",
    "pt": "Portuguese",
    "hi": "Hindi",
    "zh": "Chinese (Mandarin)",
    "ja": "Japanese",
    "ko": "Korean",
    "en": "English",
}

# TTS Voice mapping - OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
# shimmer = soft, natural | echo = warm, conversational | nova = warm female
VOICE_MAP = {
    "es": "nova",
    "fr": "nova",
    "de": "nova",
    "nl": "nova",
    "it": "nova",
    "pt": "nova",
    "hi": "nova",     # Back to nova for Hindi
    "en": "echo",     # Warm, conversational
    "zh": "nova",
    "ja": "nova",
    "ko": "nova",
}

# Topic descriptions for AI context (not announced to user)
TOPIC_CONTEXT = {
    "daily": "Guide the conversation around their day, activities, plans, and daily routine.",
    "food": "Guide the conversation around food, cooking, eating out, and meals.",
    "work": "Guide the conversation around work, school, career, and professional life.",
    "family": "Guide the conversation around family, friends, and relationships.",
    "travel": "Guide the conversation around travel, trips, vacations, and places.",
    "hobbies": "Guide the conversation around hobbies, interests, and free time activities.",
    "weekend": "Guide the conversation around weekend plans, leisure, and relaxation.",
    "random": "Let the conversation flow naturally to any topic.",
}

def get_conversation_prompt(language: str, topic: str = "random") -> str:
    """Get the appropriate conversation prompt for a language and topic"""
    topic_hint = TOPIC_CONTEXT.get(topic, TOPIC_CONTEXT["random"])
    
    # Use Hindi-specific prompt for Hindi
    if language == "hi":
        base_prompt = SYSTEM_PROMPTS["conversation_hi"]
        # Add topic context without being explicit
        return f"""{base_prompt}

TOPIC CONTEXT (use subtly, do NOT announce):
{topic_hint}
Start with questions related to this area, but let conversation drift naturally after 1-2 exchanges."""
    
    # Use generic prompt for other languages
    base_prompt = SYSTEM_PROMPTS["conversation"].format(
        target_language=language,
        target_language_name=LANGUAGE_NAMES.get(language, "the target language")
    )
    
    return f"""{base_prompt}

TOPIC CONTEXT (use subtly, do NOT announce):
{topic_hint}
Start with questions related to this area, but let conversation drift naturally after 1-2 exchanges."""

# Conversation fillers for perceived speed
FILLERS = {
    "es": ["Hmm...", "¡Qué interesante!", "Déjame pensar...", "¡Ah, sí!"],
    "fr": ["Hmm...", "Oh, intéressant!", "Laisse-moi réfléchir...", "Ah oui!"],
    "de": ["Hmm...", "Oh, interessant!", "Lass mich überlegen...", "Ach ja!"],
    "nl": ["Hmm...", "Oh, interessant!", "Laat me even denken...", "Ach ja!"],
    "it": ["Hmm...", "Oh, interessante!", "Fammi pensare...", "Ah sì!"],
    "pt": ["Hmm...", "Que interessante!", "Deixe-me pensar...", "Ah sim!"],
    "hi": ["अच्छा...", "हम्म...", "अरे...", "तो...", "मतलब..."],
    "zh": ["嗯...", "哦，有意思！", "让我想想...", "啊，对！"],
    "ja": ["ええと...", "おもしろい！", "ちょっと考えて...", "そうですね！"],
    "ko": ["음...", "오, 재미있네요!", "생각해 볼게요...", "아, 네!"],
    "en": ["Hmm...", "Oh, interesting!", "Let me think...", "Ah, yes!"],
}

SYSTEM_PROMPTS = {
    "conversation": """You are speaking out loud to a language learner in a casual conversation.

SPEAKING STYLE - YOU ARE TALKING, NOT WRITING:
- Speak like a real friend, NOT a teacher or narrator
- Use SHORT sentences (max 10-12 words each)
- Use casual, spoken language - the way people actually talk
- Sound spontaneous and natural, slightly imperfect is okay
- Ask only ONE question per turn
- Use natural fillers: "oh", "hmm", "ah", "well", "you know", "right"
- Vary your sentence length - mix short and medium
- React emotionally: surprise, interest, curiosity

LANGUAGE REQUIREMENT - CRITICAL:
- Speak ONLY in {target_language_name} ({target_language})
- NEVER switch languages, even if user mixes languages
- Use native script (Devanagari for Hindi, Hanzi for Chinese, etc.)

RESPONSE FORMAT:
- Start directly with a short comment or acknowledgment
- DO NOT start with fillers like "hmm", "oh", "ah" - those are added separately
- End with ONE simple question
- Keep total response under 20 words

EXAMPLES OF GOOD RESPONSES:
"Nice! The market. What did you buy?"
"Interesting! And how was it?"
"I see! Did you go alone?"

EXAMPLES OF BAD RESPONSES (TOO FORMAL/LONG):
"That sounds very interesting! I would love to hear more about your experience at the market. What kinds of items did you purchase there?"

Remember: You're chatting with a friend, keep it light and easy!""",

    # Hindi-specific prompt - casual Hindustani, NOT bookish Hindi
    "conversation_hi": """तुम एक दोस्त की तरह बात कर रहे हो। CASUAL SPOKEN HINDI बोलो।

STYLE - ये सबसे ज़रूरी है:
- बोलचाल की हिंदी बोलो, किताबी नहीं
- Hindustani बोलो (Hindi + common Urdu words)
- बहुत छोटे sentences (max 8-10 words)
- Natural fillers हर बार: "अच्छा", "हम्म", "तो", "मतलब", "अरे", "यार"
- Formal words NEVER USE: "रोचक", "अनुभव", "कृपया", "वास्तव में", "अत्यंत", "अवश्य"
- Drop words जैसे लोग असली बातचीत में करते हैं
- Teacher या news anchor की तरह मत बोलो
- एक friendly Indian person की तरह बोलो

RESPONSE FORMAT:
- Fillers (अच्छा, हम्म, तो) से शुरू मत करो - वो separately add होते हैं
- सीधे short comment से शुरू करो
- फिर ONE simple question
- Total 15 words से कम

GOOD EXAMPLES:
"बाज़ार गए थे? क्या लिया?"
"और फिर क्या हुआ?"
"मज़ा आया?"
"अकेले गए थे क्या?"

BAD EXAMPLES (NEVER SAY):
- Starting with fillers: "अच्छा! बाज़ार गए थे?" (filler added separately)
- Too formal: "यह तो बहुत रोचक अनुभव रहा होगा!"

EMOTIONAL PARTICLES (randomly use 20% of time):
- "यार" at end
- "ना?" for questions
- "है ना?" for confirmation

Remember: Sound like a real person chatting, not a formal speaker!""",

    "feedback": """You are a language learning assistant providing post-session feedback.

Analyze the user's speech from the conversation and provide 3-5 high-impact rephrasings.

RULES:
1. NO grammar explanations
2. NO judgmental language
3. NO red/green error marking
4. Simply show: what they said → a more natural way

Format your response as JSON:
{
    "improvements": [
        {
            "original": "what user said",
            "better": "more natural way to say it",
            "context": "brief, friendly note (optional)"
        }
    ]
}

Focus on the most impactful improvements that will help fluency, not minor errors."""
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Language Learning API starting up...")
    yield
    print("👋 Language Learning API shutting down...")

app = FastAPI(
    title="Language Learning API",
    description="5-Minute Daily Speaking Practice",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Static Files (Production) ============

# Serve frontend static files in production
if IS_PRODUCTION:
    # Serve static assets (JS, CSS, etc.)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_BUILD_PATH / "assets")), name="assets")

# ============ Models ============

class SessionStart(BaseModel):
    user_id: str
    target_language: str = "es"  # Default to Spanish
    topic: str = "random"        # Conversation topic

class SessionEnd(BaseModel):
    session_id: str
    total_speaking_time: float  # in seconds

class UserMessage(BaseModel):
    session_id: str
    transcript: str
    is_partial: bool = False

class TextToSpeechRequest(BaseModel):
    text: str
    language: str = "es"
    speed: float = 1.0

class FillerRequest(BaseModel):
    language: str = "es"
    speed: float = 1.0
    exclude: list[str] = []  # Recently used fillers to avoid

class CorrectionRequest(BaseModel):
    transcript: str           # What the user said
    target_language: str      # Language being learned (e.g., "hi")
    user_language: str = "en" # User's native language for explanations

# ============ Session Management ============

@app.post("/api/session/start")
async def start_session(data: SessionStart):
    """Start a new speaking session"""
    session_id = str(uuid.uuid4())
    
    # Get topic-aware opening greeting
    greeting = await generate_greeting(data.target_language, data.topic)
    
    sessions[session_id] = {
        "id": session_id,
        "user_id": data.user_id,
        "target_language": data.target_language,
        "topic": data.topic,  # Store topic for conversation context
        "started_at": datetime.now().isoformat(),
        "messages": [
            {"role": "assistant", "content": greeting}
        ],
        "user_utterances": [],
        "completed": False
    }
    
    return {
        "session_id": session_id,
        "greeting": greeting,
        "target_language": data.target_language,
        "topic": data.topic
    }

@app.post("/api/session/end")
async def end_session(data: SessionEnd):
    """End a session and generate feedback"""
    if data.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[data.session_id]
    session["completed"] = True
    session["total_speaking_time"] = data.total_speaking_time
    
    # Update streak
    user_id = session["user_id"]
    today = datetime.now().strftime("%Y-%m-%d")
    
    if data.total_speaking_time >= 300:  # 5 minutes = 300 seconds
        if user_id not in daily_completions:
            daily_completions[user_id] = set()
        daily_completions[user_id].add(today)
        
        # Update streak
        user_streaks[user_id] = user_streaks.get(user_id, 0) + 1
    
    # Generate feedback
    feedback = await generate_feedback(session)
    
    return {
        "session_id": data.session_id,
        "total_speaking_time": data.total_speaking_time,
        "completed": data.total_speaking_time >= 300,
        "feedback": feedback,
        "streak": user_streaks.get(user_id, 0)
    }

@app.get("/api/user/{user_id}/stats")
async def get_user_stats(user_id: str):
    """Get user statistics"""
    today = datetime.now().strftime("%Y-%m-%d")
    completed_today = user_id in daily_completions and today in daily_completions[user_id]
    
    return {
        "streak": user_streaks.get(user_id, 0),
        "completed_today": completed_today
    }

# ============ Streaming Endpoints ============

@app.post("/api/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = "es"
):
    """Transcribe audio using Whisper with language hint"""
    try:
        audio_data = await audio.read()
        
        # Map language codes to Whisper language codes
        whisper_lang_map = {
            "es": "es",  # Spanish
            "fr": "fr",  # French
            "de": "de",  # German
            "nl": "nl",  # Dutch
            "it": "it",  # Italian
            "pt": "pt",  # Portuguese
            "hi": "hi",  # Hindi
            "zh": "zh",  # Chinese
            "ja": "ja",  # Japanese
            "ko": "ko",  # Korean
            "en": "en",  # English
        }
        
        whisper_lang = whisper_lang_map.get(language, "en")
        
        # Use OpenAI Whisper with language hint
        transcript = await client.audio.transcriptions.create(
            model="whisper-1",
            file=("audio.webm", audio_data, "audio/webm"),
            response_format="text",
            language=whisper_lang  # Tell Whisper what language to expect
        )
        
        return {"transcript": transcript.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/conversation/respond")
async def respond_to_user(data: UserMessage):
    """Generate streaming AI response"""
    if data.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[data.session_id]
    
    # Add user message
    session["messages"].append({"role": "user", "content": data.transcript})
    session["user_utterances"].append(data.transcript)
    
    async def generate_stream():
        try:
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": get_conversation_prompt(session["target_language"], session.get("topic", "random"))
                    },
                    *session["messages"][-10:]  # Last 10 messages for context
                ],
                stream=True,
                max_tokens=150,
                temperature=0.9
            )
            
            full_response = ""
            async for chunk in response:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_response += content
                    yield f"data: {json.dumps({'text': content, 'done': False})}\n\n"
            
            # Save assistant response
            session["messages"].append({"role": "assistant", "content": full_response})
            yield f"data: {json.dumps({'text': '', 'done': True, 'full_response': full_response})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

# ============ Speech Formatting for Natural TTS ============

# Hindi fillers and emotional particles for random injection
HINDI_FILLERS = ["अच्छा", "हम्म", "तो", "मतलब", "अरे"]
HINDI_PARTICLES = ["यार", "ना", "है ना"]

def preprocess_hindi_for_tts(text: str) -> str:
    """
    Transform Hindi text into natural spoken form before TTS.
    SIMPLE version - just clean up formal words, don't over-process.
    """
    # Remove overly formal words and replace with casual alternatives
    formal_to_casual = {
        "रोचक": "मज़ेदार",
        "कृपया": "",
        "वास्तव में": "सच में",
        "अत्यंत": "बहुत",
        "अवश्य": "ज़रूर",
        "किन्तु": "पर",
        "परन्तु": "लेकिन",
        "तथा": "और",
        "एवं": "और",
        "अतः": "तो",
        "यदि": "अगर",
    }
    
    for formal, casual in formal_to_casual.items():
        text = text.replace(formal, casual)
    
    # Clean up extra spaces
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Simple split: only on sentence-ending punctuation
    # Keep ALL text, just split for better pausing
    sentences = re.split(r'(?<=[।?!])\s*', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    # Return joined with newlines (for format_for_natural_speech to chunk)
    return "\n".join(sentences) if sentences else text


def format_for_natural_speech(text: str, language: str) -> List[dict]:
    """
    Transform text into speech-optimized chunks with pauses.
    Returns list of {text: str, pause_after_ms: int}
    """
    chunks = []
    
    # Clean up the text
    text = text.strip()
    
    # For short text (< 100 chars), don't chunk - send as single piece
    # This avoids any text loss from chunking logic
    if len(text) < 100:
        return [{"text": text, "pause_after_ms": 0}]
    
    # HINDI-SPECIFIC PREPROCESSING
    if language == "hi":
        processed_text = preprocess_hindi_for_tts(text)
        
        # Split by newlines (our chunking markers)
        parts = processed_text.split('\n')
        parts = [p.strip() for p in parts if p.strip()]
        
        # Fallback: if preprocessing resulted in empty, use original text
        if not parts:
            parts = [text.strip()]
        
        for i, part in enumerate(parts):
            # Hindi needs more pauses
            if part in HINDI_FILLERS or part.endswith('...'):
                pause = 400  # Longer pause after fillers
            elif part.endswith('?'):
                pause = 500  # Pause after questions
            elif part.endswith('।') or part.endswith('!'):
                pause = 450  # Pause after statements
            else:
                pause = 350  # Default pause between chunks
            
            chunks.append({"text": part, "pause_after_ms": pause})
        
        print(f"[Hindi TTS] Input: {text[:100]}... -> {len(chunks)} chunks")
        return chunks
    
    # Split by sentence endings and natural breaks
    # Handle multiple punctuation types
    sentences = re.split(r'(?<=[.!?।。！？])\s*', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    for i, sentence in enumerate(sentences):
        # Further split long sentences by commas or conjunctions
        if len(sentence) > 50:
            parts = re.split(r'[,،、]\s*', sentence)
            for j, part in enumerate(parts):
                if part.strip():
                    pause = 150 if j < len(parts) - 1 else 250
                    chunks.append({"text": part.strip(), "pause_after_ms": pause})
        else:
            # Determine pause based on punctuation
            if sentence.endswith('?') or sentence.endswith('？'):
                pause = 300  # Longer pause after questions
            elif sentence.endswith('!') or sentence.endswith('！'):
                pause = 200
            elif sentence.endswith('...') or sentence.endswith('…'):
                pause = 350  # Thinking pause
            else:
                pause = 250
            
            chunks.append({"text": sentence, "pause_after_ms": pause})
    
    return chunks

def add_conversational_filler(text: str, language: str) -> str:
    """
    Randomly add conversational fillers to make speech more natural.
    Only adds ~20% of the time to avoid repetition.
    """
    if random.random() > 0.25:  # 75% of time, don't add filler
        return text
    
    fillers_by_lang = {
        "es": ["Hmm... ", "Ah, ", "Bueno, ", "Oye, "],
        "fr": ["Hmm... ", "Ah, ", "Bon, ", "Eh bien, "],
        "de": ["Hmm... ", "Ach, ", "Na, ", "Also, "],
        "nl": ["Hmm... ", "Ah, ", "Nou, ", "Ja, "],
        "it": ["Hmm... ", "Ah, ", "Beh, ", "Senti, "],
        "pt": ["Hmm... ", "Ah, ", "Bem, ", "Olha, "],
        "hi": ["हम्म... ", "अच्छा, ", "अरे, ", "देखो, "],
        "zh": ["嗯... ", "啊, ", "那个, ", "好, "],
        "ja": ["えーと... ", "あー, ", "そうね, ", "ねえ, "],
        "ko": ["음... ", "아, ", "그래, ", "저기, "],
        "en": ["Hmm... ", "Oh, ", "Well, ", "You know, "],
    }
    
    fillers = fillers_by_lang.get(language, fillers_by_lang["en"])
    
    # Don't add filler if text already starts with one
    text_lower = text.lower()
    if any(text_lower.startswith(f.lower().strip()) for f in fillers):
        return text
    
    return random.choice(fillers) + text

@app.post("/api/tts/filler")
async def get_thinking_filler(data: FillerRequest):
    """Get a random thinking filler audio to play while processing"""
    try:
        # Thinking fillers by language - short phrases that buy time
        thinking_fillers = {
            "es": ["Hmm...", "A ver...", "Pues...", "Bueno...", "Déjame pensar...", "Oye...", "Mira..."],
            "fr": ["Hmm...", "Alors...", "Bon...", "Eh bien...", "Voyons...", "Écoute...", "Tu vois..."],
            "de": ["Hmm...", "Also...", "Na ja...", "Moment mal...", "Lass mich überlegen...", "Schau mal...", "Weißt du..."],
            "nl": ["Hmm...", "Nou...", "Even denken...", "Laat me denken...", "Tja...", "Kijk...", "Weet je..."],
            "it": ["Hmm...", "Allora...", "Dunque...", "Vediamo...", "Fammi pensare...", "Senti...", "Guarda..."],
            "pt": ["Hmm...", "Então...", "Bem...", "Deixa eu pensar...", "Olha...", "Sabe...", "Veja..."],
            "hi": ["हम्म...", "अच्छा...", "देखो...", "सोचने दो...", "ठीक है...", "सुनो...", "बताओ..."],
            "zh": ["嗯...", "那个...", "让我想想...", "好的...", "这样啊...", "你看...", "是这样..."],
            "ja": ["えーと...", "そうですね...", "ちょっと...", "なるほど...", "うーん...", "あのね...", "ねえ..."],
            "ko": ["음...", "그러니까...", "잠깐만...", "생각해보면...", "아...", "있잖아...", "그게..."],
            "en": ["Hmm...", "Let me think...", "Well...", "So...", "Okay...", "You know...", "Right..."],
        }
        
        fillers = thinking_fillers.get(data.language, thinking_fillers["en"])
        
        # Filter out recently used fillers
        available_fillers = [f for f in fillers if f not in data.exclude]
        if not available_fillers:
            available_fillers = fillers  # Reset if all used
        
        filler_text = random.choice(available_fillers)
        
        # Use ElevenLabs if available, otherwise OpenAI
        try:
            tts = get_tts_provider(client)
            audio_content = await tts.generate_speech(filler_text, data.language, data.speed)
            response_content = audio_content
        except Exception as e:
            print(f"[FILLER] ElevenLabs failed, using OpenAI: {e}")
            voice = VOICE_MAP.get(data.language, "nova")
            response = await client.audio.speech.create(
                model="tts-1",
                voice=voice,
                input=filler_text,
                speed=data.speed,
                response_format="mp3"
            )
            response_content = response.content
        
        audio_base64 = base64.b64encode(response_content).decode('utf-8')
        
        return {
            "audio": audio_base64,
            "text": filler_text,
            "format": "mp3"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def add_pauses_for_hindi(text: str) -> str:
    """Add natural pauses to Hindi text for better TTS output (legacy, used by OpenAI fallback)"""
    # Add pause markers after sentence endings
    text = re.sub(r'([।?!])\s*', r'\1... ', text)
    # Add slight pause after commas
    text = re.sub(r',\s*', r', ', text)
    # Add pause before questions
    text = re.sub(r'\s+(क्या|कैसे|कहाँ|कब|क्यों|कौन)', r'... \1', text)
    return text.strip()

@app.post("/api/tts")
async def text_to_speech(data: TextToSpeechRequest):
    """Generate speech from text using ElevenLabs (primary) or OpenAI (fallback)"""
    print(f"[TTS] Generating audio for: {data.text[:80]}...")
    print(f"[TTS] Language: {data.language}, Speed: {data.speed}")
    
    # Try ElevenLabs first if configured, then fallback to OpenAI
    elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
    use_elevenlabs = elevenlabs_key and len(elevenlabs_key) > 10 and os.getenv("DISABLE_ELEVENLABS") != "true"
    
    if use_elevenlabs:
        try:
            print("[TTS] Attempting ElevenLabs...")
            tts = get_tts_provider(client)
            
            # Only try ElevenLabs if it's actually the provider
            if isinstance(tts, ElevenLabsTTSProvider):
                audio_content = await tts.generate_speech(
                    text=data.text,
                    language=data.language,
                    speed=data.speed
                )
                
                audio_base64 = base64.b64encode(audio_content).decode('utf-8')
                print(f"[TTS] ✅ ElevenLabs generated {len(audio_content)} bytes")
                return {"audio": audio_base64, "format": "mp3"}
            else:
                print("[TTS] Provider is not ElevenLabs, using OpenAI")
        except Exception as e:
            error_msg = str(e)
            print(f"[TTS ERROR] ElevenLabs failed: {error_msg}")
            
            # If it's a 401 (blocked account), suggest disabling ElevenLabs
            if "401" in error_msg or "blocked" in error_msg.lower() or "unusual activity" in error_msg.lower():
                print("[TTS] ⚠️ ElevenLabs account appears blocked. Set DISABLE_ELEVENLABS=true to skip ElevenLabs.")
            
            print("[TTS] Falling back to OpenAI...")
    
    # OpenAI fallback (always available)
    try:
        print("[TTS] Using OpenAI TTS...")
        text_to_speak = data.text
        if data.language == "hi":
            text_to_speak = add_pauses_for_hindi(data.text)
        
        voice = VOICE_MAP.get(data.language, "nova")
        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text_to_speak,
            speed=data.speed,
            response_format="mp3"
        )
        
        audio_base64 = base64.b64encode(response.content).decode('utf-8')
        print(f"[TTS] ✅ OpenAI generated {len(response.content)} bytes")
        return {"audio": audio_base64, "format": "mp3"}
    except Exception as fallback_error:
        print(f"[TTS FALLBACK ERROR] {fallback_error}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(fallback_error)}")

@app.post("/api/tts/elevenlabs/stream")
async def elevenlabs_stream_tts(data: TextToSpeechRequest):
    """Stream TTS using ElevenLabs for minimal latency - falls back to OpenAI if ElevenLabs fails"""
    print(f"[TTS STREAM] Starting stream for: {data.text[:80]}...")
    
    try:
        tts = get_tts_provider(client)
        
        # Only ElevenLabs supports true streaming
        if isinstance(tts, ElevenLabsTTSProvider):
            try:
                async def audio_stream():
                    async for chunk in tts.stream_speech(data.text, data.language, data.speed):
                        yield chunk
                
                return StreamingResponse(
                    audio_stream(),
                    media_type="audio/mpeg",
                    headers={
                        "Content-Type": "audio/mpeg",
                        "Transfer-Encoding": "chunked",
                        "Cache-Control": "no-cache",
                    }
                )
            except Exception as e:
                print(f"[TTS STREAM] ElevenLabs failed: {e}, falling back to OpenAI...")
                # Fall through to OpenAI fallback
        
        # Fallback to OpenAI (non-streaming)
        print("[TTS STREAM] Using OpenAI fallback (non-streaming)...")
        text_to_speak = data.text
        if data.language == "hi":
            text_to_speak = add_pauses_for_hindi(data.text)
        
        voice = VOICE_MAP.get(data.language, "nova")
        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text_to_speak,
            speed=data.speed,
            response_format="mp3"
        )
        
        async def single_chunk():
            yield response.content
        
        return StreamingResponse(
            single_chunk(),
            media_type="audio/mpeg"
        )
        
    except Exception as e:
        print(f"[TTS STREAM ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ============ Real-time Corrections ============

@app.post("/api/analyze-speech")
async def analyze_speech(data: CorrectionRequest):
    """
    Analyze user speech and provide corrections with explanations.
    Returns correction only if there's something to improve.
    """
    print(f"[ANALYZE] Checking: {data.transcript}")
    
    try:
        # Use GPT to analyze the speech
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are a helpful language tutor analyzing a learner's speech in {LANGUAGE_NAMES.get(data.target_language, 'the target language')}.

TASK: Check if the user's sentence has any grammar, vocabulary, or phrasing issues.

RULES:
1. Only respond if there's a REAL mistake worth correcting
2. Ignore minor issues or stylistic preferences
3. If the sentence is correct or only has trivial issues, respond with: {{"needs_correction": false}}
4. If there's a meaningful correction, provide it

For corrections, respond with JSON:
{{
    "needs_correction": true,
    "original": "what they said",
    "corrected": "correct way to say it in {LANGUAGE_NAMES.get(data.target_language, 'target language')}",
    "explanation": "Brief, friendly explanation in {LANGUAGE_NAMES.get(data.user_language, 'English')} (1-2 sentences max)"
}}

Keep explanations simple and encouraging. Focus on helping them learn, not pointing out errors."""
                },
                {
                    "role": "user",
                    "content": f"Check this {LANGUAGE_NAMES.get(data.target_language, 'target language')} sentence: \"{data.transcript}\""
                }
            ],
            response_format={"type": "json_object"},
            max_tokens=300,
            temperature=0.3
        )
        
        result = json.loads(response.choices[0].message.content)
        print(f"[ANALYZE] Result: {result}")
        
        if not result.get("needs_correction", False):
            return {"has_correction": False}
        
        # Generate audio for the corrected sentence
        voice = VOICE_MAP.get(data.target_language, "nova")
        speed = 0.85 if data.target_language == "hi" else 0.75  # Slower for learning
        
        audio_response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=result["corrected"],
            speed=speed,
            response_format="mp3"
        )
        
        audio_base64 = base64.b64encode(audio_response.content).decode('utf-8')
        
        return {
            "has_correction": True,
            "original": result.get("original", data.transcript),
            "corrected": result["corrected"],
            "explanation": result["explanation"],
            "audio": audio_base64
        }
        
    except Exception as e:
        print(f"[ANALYZE ERROR] {e}")
        return {"has_correction": False, "error": str(e)}

@app.post("/api/tts/natural")
async def text_to_speech_natural(data: TextToSpeechRequest):
    """Stream TTS chunks as they're generated using SSE for minimal latency"""
    
    voice = VOICE_MAP.get(data.language, "nova")
    
    # Format text into natural speech chunks (fillers are played separately)
    chunks = format_for_natural_speech(data.text, data.language)
    
    async def generate_chunks():
        """Generate and stream audio chunks as they're created"""
        print(f"[TTS] Generating {len(chunks)} chunks for: {data.text[:80]}...")
        
        for i, chunk in enumerate(chunks):
            chunk_text = chunk["text"]
            if not chunk_text or not chunk_text.strip():
                print(f"[TTS] Skipping empty chunk {i}")
                continue
                
            try:
                print(f"[TTS] Generating chunk {i+1}/{len(chunks)}: {chunk_text[:50]}...")
                response = await client.audio.speech.create(
                    model="tts-1",
                    voice=voice,
                    input=chunk_text,
                    speed=data.speed,
                    response_format="mp3"
                )
                
                audio_base64 = base64.b64encode(response.content).decode('utf-8')
                chunk_data = {
                    "audio": audio_base64,
                    "text": chunk_text,
                    "pause_after_ms": chunk["pause_after_ms"],
                    "index": i,
                    "total": len(chunks),
                    "done": i == len(chunks) - 1
                }
                yield f"data: {json.dumps(chunk_data)}\n\n"
            except Exception as e:
                print(f"[TTS ERROR] Chunk {i} failed: {e} - Text was: {chunk_text}")
                # Don't skip - send error info so frontend knows
                error_data = {
                    "error": str(e),
                    "text": chunk_text,
                    "index": i,
                    "total": len(chunks),
                    "done": i == len(chunks) - 1
                }
                yield f"data: {json.dumps(error_data)}\n\n"
    
    return StreamingResponse(
        generate_chunks(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

@app.post("/api/tts/stream")
async def text_to_speech_stream(data: TextToSpeechRequest):
    """Stream TTS audio for faster playback start"""
    try:
        voice = VOICE_MAP.get(data.language, "nova")
        
        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=data.text,
            speed=data.speed,
            response_format="mp3"
        )
        
        async def audio_stream():
            yield response.content
        
        return StreamingResponse(
            audio_stream(),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "inline",
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============ WebSocket for Real-time Communication ============

@app.websocket("/ws/conversation/{session_id}")
async def websocket_conversation(websocket: WebSocket, session_id: str):
    """WebSocket for real-time conversation flow"""
    await websocket.accept()
    
    if session_id not in sessions:
        await websocket.close(code=4004, reason="Session not found")
        return
    
    session = sessions[session_id]
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data["type"] == "transcript":
                # User sent a transcript
                transcript = data["text"]
                is_final = data.get("is_final", True)
                
                if is_final and transcript.strip():
                    # Add to session
                    session["messages"].append({"role": "user", "content": transcript})
                    session["user_utterances"].append(transcript)
                    
                    # Send filler immediately for perceived speed
                    import random
                    filler = random.choice(FILLERS.get(session["target_language"], FILLERS["en"]))
                    await websocket.send_json({
                        "type": "filler",
                        "text": filler
                    })
                    
                    # Generate response
                    response = await client.chat.completions.create(
                        model="gpt-4o",
                        messages=[
                            {
                                "role": "system",
                                "content": get_conversation_prompt(session["target_language"], session.get("topic", "random"))
                            },
                            *session["messages"][-10:]
                        ],
                        stream=True,
                        max_tokens=150,
                        temperature=0.9
                    )
                    
                    full_response = ""
                    async for chunk in response:
                        if chunk.choices[0].delta.content:
                            content = chunk.choices[0].delta.content
                            full_response += content
                            await websocket.send_json({
                                "type": "response_chunk",
                                "text": content
                            })
                    
                    session["messages"].append({"role": "assistant", "content": full_response})
                    
                    await websocket.send_json({
                        "type": "response_complete",
                        "full_text": full_response
                    })
            
            elif data["type"] == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for session {session_id}")

# ============ Helper Functions ============

# Topic-aware greetings by language and topic
TOPIC_GREETINGS = {
    "hi": {
        "daily": [
            "अच्छा... आज दिन कैसा जा रहा है?",
            "हम्म... आज कैसा रहा अब तक?",
            "तो... आज क्या चल रहा है?",
        ],
        "food": [
            "हम्म... आज कुछ अच्छा खाया?",
            "अच्छा... आज खाने में क्या बना?",
            "तो... आज क्या खाने का मन है?",
        ],
        "work": [
            "तो... आज काम में क्या चल रहा है?",
            "अच्छा... ऑफिस कैसा रहा आज?",
            "हम्म... आज काम पर कुछ interesting हुआ?",
        ],
        "family": [
            "अच्छा... घर पर सब कैसे हैं?",
            "तो... family में क्या चल रहा है?",
            "हम्म... कोई family news?",
        ],
        "travel": [
            "अरे... कहीं घूमने का प्लान है क्या?",
            "तो... last trip कहाँ गए थे?",
            "हम्म... कहाँ जाना है अगली बार?",
        ],
        "hobbies": [
            "अच्छा... आजकल क्या करते हो free time में?",
            "तो... कोई नया hobby?",
            "हम्म... weekend पे क्या करना पसंद है?",
        ],
        "weekend": [
            "तो... इस weekend क्या plan है?",
            "अच्छा... पिछला weekend कैसा रहा?",
            "हम्म... कुछ exciting plan है?",
        ],
        "random": [
            "अरे हाय! कैसे हो? आज क्या किया?",
            "हम्म... चलो कुछ बात करते हैं!",
            "अच्छा... आज कुछ नया?",
        ],
    },
    "es": {
        "daily": ["¡Hola! ¿Cómo va tu día?", "¿Qué tal? ¿Cómo estás hoy?"],
        "food": ["Hmm... ¿Qué has comido hoy?", "¿Cocinaste algo rico?"],
        "work": ["¿Qué tal el trabajo hoy?", "¿Cómo va todo en la oficina?"],
        "family": ["¿Cómo está tu familia?", "¿Qué tal en casa?"],
        "travel": ["¿Tienes planes de viaje?", "¿A dónde quieres ir?"],
        "hobbies": ["¿Qué haces en tu tiempo libre?", "¿Algún hobby nuevo?"],
        "weekend": ["¿Qué planes tienes para el fin de semana?", "¿Cómo fue tu fin de semana?"],
        "random": ["¡Hola! ¿Cómo estás?", "¿Qué tal? ¿Todo bien?"],
    },
    "nl": {
        "daily": ["Hoi! Hoe gaat je dag?", "Hé! Hoe gaat het vandaag?"],
        "food": ["Hmm... Wat heb je vandaag gegeten?", "Iets lekkers gekookt?"],
        "work": ["Hoe gaat het op het werk?", "Drukke dag gehad?"],
        "family": ["Hoe gaat het met je familie?", "Alles goed thuis?"],
        "travel": ["Heb je reisplannen?", "Waar wil je naartoe?"],
        "hobbies": ["Wat doe je in je vrije tijd?", "Nieuwe hobby's?"],
        "weekend": ["Wat zijn je weekendplannen?", "Hoe was je weekend?"],
        "random": ["Hoi! Hoe gaat het?", "Hé! Alles goed?"],
    },
    "fr": {
        "daily": ["Salut! Comment va ta journée?", "Ça va? Comment tu vas aujourd'hui?"],
        "food": ["Hmm... Qu'est-ce que tu as mangé aujourd'hui?", "Tu as cuisiné quelque chose de bon?"],
        "work": ["Comment ça va au travail?", "Journée chargée?"],
        "family": ["Comment va ta famille?", "Tout va bien à la maison?"],
        "travel": ["Tu as des projets de voyage?", "Où veux-tu aller?"],
        "hobbies": ["Qu'est-ce que tu fais pendant ton temps libre?", "De nouveaux hobbies?"],
        "weekend": ["Quels sont tes plans pour le week-end?", "C'était comment ton week-end?"],
        "random": ["Salut! Ça va?", "Quoi de neuf?"],
    },
    "de": {
        "daily": ["Hi! Wie läuft dein Tag?", "Hey! Wie geht's dir heute?"],
        "food": ["Hmm... Was hast du heute gegessen?", "Was Leckeres gekocht?"],
        "work": ["Wie läuft's bei der Arbeit?", "Stressiger Tag?"],
        "family": ["Wie geht's deiner Familie?", "Alles gut zu Hause?"],
        "travel": ["Hast du Reisepläne?", "Wohin möchtest du?"],
        "hobbies": ["Was machst du in deiner Freizeit?", "Neue Hobbys?"],
        "weekend": ["Was sind deine Wochenendpläne?", "Wie war dein Wochenende?"],
        "random": ["Hi! Wie geht's?", "Was gibt's Neues?"],
    },
    # Default English fallback
    "en": {
        "daily": ["Hey! How's your day going?", "What's up? How are you today?"],
        "food": ["Hmm... What did you eat today?", "Cook anything good lately?"],
        "work": ["How's work going?", "Busy day at work?"],
        "family": ["How's your family doing?", "What's happening at home?"],
        "travel": ["Any travel plans?", "Where do you want to go next?"],
        "hobbies": ["What do you do for fun?", "Any new hobbies?"],
        "weekend": ["What are your weekend plans?", "How was your weekend?"],
        "random": ["Hey! How are you?", "What's new?"],
    },
}

async def generate_greeting(language: str, topic: str = "random") -> str:
    """Generate a topic-aware opening greeting in the target language"""
    # Get greetings for this language, fallback to English
    lang_greetings = TOPIC_GREETINGS.get(language, TOPIC_GREETINGS["en"])
    
    # Get greetings for this topic, fallback to random
    topic_greetings = lang_greetings.get(topic, lang_greetings.get("random", ["Hello!"]))
    
    # Pick a random greeting from the pool
    return random.choice(topic_greetings)

async def generate_feedback(session: dict) -> dict:
    """Generate post-session feedback with improvements"""
    if not session["user_utterances"]:
        return {"improvements": []}
    
    try:
        # Combine user utterances
        user_speech = "\n".join([f"- {u}" for u in session["user_utterances"]])
        
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPTS["feedback"]},
                {
                    "role": "user",
                    "content": f"Target language: {session['target_language']}\n\nUser's speech:\n{user_speech}"
                }
            ],
            response_format={"type": "json_object"},
            max_tokens=500
        )
        
        feedback = json.loads(response.choices[0].message.content)
        return feedback
        
    except Exception as e:
        print(f"Feedback generation error: {e}")
        return {"improvements": []}

# ============ Health Check ============

@app.get("/health")
async def health_check():
    """Health check with TTS provider info"""
    # Initialize TTS provider to see which one is active
    try:
        get_tts_provider(client)
    except:
        pass
    
    return {
        "status": "healthy", 
        "service": "lingoa-api",
        "tts_provider": get_tts_provider_type(),
        "elevenlabs_key_present": bool(os.getenv("ELEVENLABS_API_KEY"))
    }

@app.get("/api/tts/status")
async def tts_status():
    """Check which TTS provider is active"""
    try:
        get_tts_provider(client)
        provider_type = get_tts_provider_type()
        elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        
        return {
            "provider": provider_type,
            "elevenlabs_configured": bool(elevenlabs_key and len(elevenlabs_key) > 10),
            "key_preview": elevenlabs_key[:15] + "..." if elevenlabs_key else None
        }
    except Exception as e:
        return {"error": str(e)}

# ============ Frontend SPA Routes (Production) ============

# Serve index.html for SPA routing - must be LAST
if IS_PRODUCTION:
    @app.get("/")
    async def serve_spa_root():
        return FileResponse(str(FRONTEND_BUILD_PATH / "index.html"))
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't catch API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        
        # Try to serve static file first
        file_path = FRONTEND_BUILD_PATH / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        
        # Otherwise serve index.html for SPA routing
        return FileResponse(str(FRONTEND_BUILD_PATH / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

