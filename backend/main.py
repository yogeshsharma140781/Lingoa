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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Query
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

# Build/version info (useful for debugging deploys)
APP_BUILD_TAG = "translation-pending-gate-v3"

# Supported language codes used in the app
SUPPORTED_LANGUAGE_CODES = {"en", "es", "fr", "de", "nl", "it", "pt", "hi", "zh", "ja", "ko"}

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
    "en": "nova",     # Keep gender consistent with Lingoa's (female) persona
    "zh": "nova",
    "ja": "nova",
    "ko": "nova",
}

# AI persona configuration
# Important: keep assistant self-references consistent with the chosen TTS voice persona.
# We standardize on a female persona to match the default voice (ElevenLabs Rachel / OpenAI nova).
AI_PERSONA_GENDER = "female"

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

# Role-play scenarios - internal definitions (never shown to user)
ROLEPLAY_SCENARIOS = {
    # Daily Life
    "cafe_order": {
        "name": "Ordering coffee at a café",
        "ai_role": "café barista/server",
        "setting": "busy café",
        "tone": "friendly, efficient",
        "goal": "take order naturally"
    },
    "restaurant": {
        "name": "Eating at a restaurant",
        "ai_role": "restaurant server",
        "setting": "restaurant",
        "tone": "professional, helpful",
        "goal": "serve the customer"
    },
    "groceries": {
        "name": "Buying groceries",
        "ai_role": "store cashier or helpful shopper",
        "setting": "grocery store",
        "tone": "casual, friendly",
        "goal": "natural shopping interaction"
    },
    "neighbor": {
        "name": "Talking to a neighbor",
        "ai_role": "neighbor",
        "setting": "apartment building or street",
        "tone": "warm, casual",
        "goal": "friendly neighborly chat"
    },
    "directions": {
        "name": "Asking for directions",
        "ai_role": "local person",
        "setting": "street or public place",
        "tone": "helpful, patient",
        "goal": "give clear directions"
    },
    # Work & Admin
    "colleague": {
        "name": "Talking to a colleague",
        "ai_role": "work colleague",
        "setting": "office or workplace",
        "tone": "professional but friendly",
        "goal": "casual work conversation"
    },
    "manager": {
        "name": "One-on-one with a manager",
        "ai_role": "manager/supervisor",
        "setting": "office meeting",
        "tone": "supportive, professional",
        "goal": "discuss work matters"
    },
    "meeting_smalltalk": {
        "name": "Small talk before a meeting",
        "ai_role": "colleague or meeting participant",
        "setting": "meeting room or office",
        "tone": "casual, professional",
        "goal": "light conversation before meeting"
    },
    "job_interview": {
        "name": "Casual job interview",
        "ai_role": "interviewer",
        "setting": "interview room",
        "tone": "professional, encouraging",
        "goal": "conduct interview naturally"
    },
    "hr_admin": {
        "name": "Talking to HR / admin",
        "ai_role": "HR or admin staff",
        "setting": "office",
        "tone": "helpful, professional",
        "goal": "handle admin matters"
    },
    # Services & Errands
    "taxi": {
        "name": "Taxi / ride-share conversation",
        "ai_role": "taxi/ride-share driver",
        "setting": "vehicle",
        "tone": "friendly, conversational",
        "goal": "drive and chat naturally"
    },
    "customer_support": {
        "name": "Calling customer support",
        "ai_role": "customer support agent",
        "setting": "phone call",
        "tone": "helpful, patient",
        "goal": "resolve issue"
    },
    "pharmacy": {
        "name": "At the pharmacy",
        "ai_role": "pharmacist or pharmacy staff",
        "setting": "pharmacy",
        "tone": "professional, caring",
        "goal": "help with medication/pharmacy needs"
    },
    "bank": {
        "name": "At the bank",
        "ai_role": "bank teller or banker",
        "setting": "bank",
        "tone": "professional, helpful",
        "goal": "handle banking matters"
    },
    "post_office": {
        "name": "At the post office",
        "ai_role": "post office clerk",
        "setting": "post office",
        "tone": "efficient, friendly",
        "goal": "handle postal services"
    },
    # Social & Travel
    "meeting_new": {
        "name": "Meeting someone new",
        "ai_role": "new acquaintance",
        "setting": "social gathering or event",
        "tone": "friendly, curious",
        "goal": "get to know each other"
    },
    "friends_home": {
        "name": "Invited to a friend's home",
        "ai_role": "host friend",
        "setting": "friend's home",
        "tone": "warm, welcoming",
        "goal": "host and chat naturally"
    },
    "hotel_checkin": {
        "name": "Hotel check-in",
        "ai_role": "hotel receptionist",
        "setting": "hotel lobby",
        "tone": "professional, welcoming",
        "goal": "check in guest"
    },
    "travel_help": {
        "name": "Asking for help while traveling",
        "ai_role": "local person or tourist helper",
        "setting": "tourist area or public place",
        "tone": "helpful, friendly",
        "goal": "help traveler"
    },
    "phone_call": {
        "name": "Casual phone call",
        "ai_role": "friend or acquaintance",
        "setting": "phone call",
        "tone": "casual, friendly",
        "goal": "natural phone conversation"
    },
}

def get_roleplay_prompt(language: str, scenario_id: str, custom_scenario: str = None) -> str:
    """Get role-play prompt - AI speaks immediately in character"""
    if custom_scenario:
        # Custom scenario - infer role, setting, tone from user input
        if language == "hi":
            return f"""तुम एक real person हो जो इस situation में है: "{custom_scenario}"

CRITICAL RULES:
- तुरंत character में बोलो, बिना explanation के
- Situation को repeat मत करो
- Meta questions मत पूछो
- जैसे user ने तुम्हें real life में approach किया हो, वैसे बोलो
- Natural, casual Hindustani बोलो
- Short sentences (max 8-10 words)
- एक friendly person की तरह behave करो, teacher नहीं
- तुम एक महिला हो: अपने बारे में हमेशा स्त्रीलिंग में बोलो (गई/थी/करती हूँ), कभी पुल्लिंग नहीं (गया/था/करता हूँ)
- LANGUAGE REQUIREMENT - CRITICAL:
  - सिर्फ हिंदी में बोलो (देवनागरी)
  - English कभी मत बोलो

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- User language learner है; pronunciation गलत हो सकती है।
- Speech transcription में errors हो सकते हैं।
- Intent generously infer करो; words पे अटकना नहीं।
- User ने जानबूझकर weird बात नहीं कही — assume best.
- अगर transcript गलत लगे, उसे verbatim repeat मत करो; intended meaning पे respond करो।
- अगर सच में ambiguity हो, तो soft yes/no confirmation पूछो (never “समझ नहीं आया”).

START IMMEDIATELY IN CHARACTER - no setup, no explanation."""
        else:
            target_language_name = LANGUAGE_NAMES.get(language, "the target language")
            return f"""You are role-playing a real person in this situation: "{custom_scenario}"

CRITICAL RULES:
- Act naturally and immediately
- Do NOT explain the scenario
- Do NOT ask meta questions
- Speak as if the user has just approached you in real life
- Use casual, spoken language
- Short sentences (max 10-12 words)
- Behave like a real person, not a teacher
- Persona: you are a woman. Never refer to yourself as male.
- LANGUAGE REQUIREMENT - CRITICAL:
  - Speak ONLY in {target_language_name} ({language})
  - NEVER switch languages, even if user mixes languages

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- The user is a language learner. Their pronunciation may be inaccurate.
- Speech transcription may contain errors.
- Infer intent generously. Prefer meaningful interpretation over literal words.
- Never assume the user said something strange on purpose.
- If the transcript looks wrong, do NOT repeat it verbatim; respond to intended meaning.
- If genuinely ambiguous, ask a soft yes/no confirmation in the target language (never “I didn’t understand”).

START IMMEDIATELY IN CHARACTER - no setup, no explanation."""
    
    # Built-in scenario
    scenario = ROLEPLAY_SCENARIOS.get(scenario_id)
    if not scenario:
        scenario = ROLEPLAY_SCENARIOS["cafe_order"]  # Fallback
    
    ai_role = scenario["ai_role"]
    setting = scenario["setting"]
    tone = scenario["tone"]
    
    if language == "hi":
        return f"""तुम एक {ai_role} हो, {setting} में।

CRITICAL RULES:
- तुरंत character में बोलो
- "Let's role-play" या explanation मत दो
- जैसे user तुम्हारे पास आया हो, वैसे respond करो
- {tone} tone में बोलो
- Natural, casual Hindustani
- Short sentences (max 8-10 words)
- Real person की तरह behave करो
- तुम एक महिला हो: अपने बारे में हमेशा स्त्रीलिंग में बोलो (गई/थी/करती हूँ), कभी पुल्लिंग नहीं (गया/था/करता हूँ)
- LANGUAGE REQUIREMENT - CRITICAL:
  - सिर्फ हिंदी में बोलो (देवनागरी)
  - English कभी मत बोलो

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- User language learner है; pronunciation गलत हो सकती है।
- Speech transcription में errors हो सकते हैं।
- Intent generously infer करो; words पे अटकना नहीं।
- User ने जानबूझकर weird बात नहीं कही — assume best.
- अगर transcript गलत लगे, उसे verbatim repeat मत करो; intended meaning पे respond करो।
- अगर सच में ambiguity हो, तो soft yes/no confirmation पूछो (never “समझ नहीं आया”).

START IMMEDIATELY - no setup."""
    else:
        target_language_name = LANGUAGE_NAMES.get(language, "the target language")
        return f"""You are a {ai_role} in a {setting}.

CRITICAL RULES:
- Speak immediately in character
- Do NOT say "Let's role-play" or explain roles
- React as if the user just approached you
- Use a {tone} tone
- Use casual, spoken language
- Short sentences (max 10-12 words)
- Behave like a real person
- Persona: you are a woman. Never refer to yourself as male.
- LANGUAGE REQUIREMENT - CRITICAL:
  - Speak ONLY in {target_language_name} ({language})
  - NEVER switch languages, even if user mixes languages

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- The user is a language learner. Their pronunciation may be inaccurate.
- Speech transcription may contain errors.
- Infer intent generously. Prefer meaningful interpretation over literal words.
- Never assume the user said something strange on purpose.
- If the transcript looks wrong, do NOT repeat it verbatim; respond to intended meaning.
- If genuinely ambiguous, ask a soft yes/no confirmation in the target language (never “I didn’t understand”).

START IMMEDIATELY - no setup."""

def get_conversation_prompt(language: str, topic: str = "random", roleplay_id: str = None, custom_scenario: str = None) -> str:
    """Get the appropriate conversation prompt - handles both topics and role-play"""
    
    # Role-play mode
    if roleplay_id or custom_scenario:
        return get_roleplay_prompt(language, roleplay_id or "", custom_scenario)
    
    # Regular topic mode
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

PERSONA (CONSISTENCY RULE):
- You are a woman.
- Never refer to yourself as male.

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- The user is a language learner. Their pronunciation may be inaccurate.
- Speech transcription may contain errors.
- Infer intent generously. Prefer meaningful interpretation over literal words.
- Never assume the user said something strange on purpose.
- Do NOT punish, shame, or expose mistakes.
- Avoid repeating the user's incorrect transcript verbatim if it looks wrong; respond to intended meaning.
- If genuinely ambiguous, ask a soft yes/no confirmation in the target language (never say “I didn’t understand”).

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

PERSONA (CONSISTENCY RULE):
- तुम एक महिला हो।
- अपने बारे में हमेशा स्त्रीलिंग में बोलो: गई/थी/करती हूँ
- अपने बारे में पुल्लिंग कभी मत बोलो: गया/था/करता हूँ
- अगर gendered form avoid कर सकती हो, तो neutral बोलो (जैसे "मैं अभी यहाँ हूँ", "मैं अभी free हूँ", "मैंने किया", "मैं कर रही हूँ")

STYLE - ये सबसे ज़रूरी है:
- बोलचाल की हिंदी बोलो, किताबी नहीं
- Hindustani बोलो (Hindi + common Urdu words)
- बहुत छोटे sentences (max 8-10 words)
- Natural fillers हर बार: "अच्छा", "हम्म", "तो", "मतलब", "अरे", "यार"
- Formal words NEVER USE: "रोचक", "अनुभव", "कृपया", "वास्तव में", "अत्यंत", "अवश्य"
- Drop words जैसे लोग असली बातचीत में करते हैं
- Teacher या news anchor की तरह मत बोलो
- एक friendly Indian person की तरह बोलो

LEARNER SPEECH ROBUSTNESS (NON-NEGOTIABLE):
- User language learner है; pronunciation गलत हो सकती है।
- Speech transcription में errors हो सकते हैं।
- Intent generously infer करो; words पे अटकना नहीं।
- User ने जानबूझकर weird बात नहीं कही — assume best.
- User को शर्मिंदा/पकड़ने वाली correction मत करो।
- अगर transcript गलत लगे, उसे verbatim repeat मत करो; intended meaning पे respond करो।
- अगर सच में ambiguity हो, तो soft yes/no confirmation पूछो (कभी मत बोलो “समझ नहीं आया”).

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
    topic: str = "random"        # Conversation topic (or "roleplay" for role-play mode)
    roleplay_id: Optional[str] = None      # Role-play scenario ID (if topic is "roleplay")
    custom_scenario: Optional[str] = None   # Custom role-play scenario description
    
    model_config = {
        "extra": "forbid"  # Don't allow extra fields
    }

class SessionEnd(BaseModel):
    session_id: str
    total_speaking_time: float  # in seconds

class UserMessage(BaseModel):
    session_id: str
    transcript: str
    is_partial: bool = False
    # Client can echo a pending translation to make the flow resilient to stateless backends / instance changes
    translation_pending: Optional[dict] = None
    # Whisper-detected language for the user's utterance (from /api/transcribe verbose_json)
    detected_language: Optional[str] = None

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

class TranslateRequest(BaseModel):
    text: str
    source_language: str
    target_language: str = "en"

# ============ Session Management ============

@app.post("/api/session/start")
async def start_session(data: SessionStart):
    """Start a new speaking session"""
    session_id = str(uuid.uuid4())
    
    # Handle None values properly
    roleplay_id = data.roleplay_id if data.roleplay_id else None
    custom_scenario = data.custom_scenario if data.custom_scenario else None
    
    print(f"[SESSION START] Language: {data.target_language}, Topic: {data.topic}, Roleplay: {roleplay_id}, Custom: {custom_scenario}")
    
    try:
        # Generate greeting - role-play or topic-based
        if data.topic == "roleplay":
            print(f"[SESSION START] Generating role-play greeting...")
            greeting = await generate_roleplay_greeting(
                data.target_language, 
                roleplay_id, 
                custom_scenario
            )
            print(f"[SESSION START] Role-play greeting generated: {greeting[:50]}...")
        else:
            print(f"[SESSION START] Generating topic greeting...")
            greeting = await generate_greeting(data.target_language, data.topic)
            print(f"[SESSION START] Topic greeting generated: {greeting[:50]}...")
        
        sessions[session_id] = {
            "id": session_id,
            "user_id": data.user_id,
            "target_language": data.target_language,
            "topic": data.topic,
            "roleplay_id": roleplay_id,
            "custom_scenario": custom_scenario,
            "started_at": datetime.now().isoformat(),
            "messages": [
                {"role": "assistant", "content": greeting}
            ],
            "user_utterances": [],
            "completed": False
        }
        
        print(f"[SESSION START] Session created: {session_id}")
        
        return {
            "session_id": session_id,
            "greeting": greeting,
            "target_language": data.target_language,
            "topic": data.topic
        }
    except Exception as e:
        print(f"[SESSION START ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")

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

# ============ Sentence Matching and Improvement ============

async def improve_and_match_sentence(
    transcript: str,
    target_language: str,
    session: Optional[dict] = None,
    raw_transcript: Optional[str] = None
) -> dict:
    """
    Intelligently match unclear transcripts to plausible sentences and improve them.
    
    Uses conversation context to understand what the user likely meant to say,
    even if the audio was unclear or garbled. Makes a judgment call and improves
    the sentence to be more natural and correct.
    
    Args:
        transcript: The transcribed text (may be unclear/garbled)
        target_language: The target language code
        session: Optional session dict with conversation context
        raw_transcript: Optional original raw transcript for comparison
    
    Returns:
        dict with:
            - improved: str - The improved/interpreted sentence
            - confidence: float - Confidence level (0.0 to 1.0)
            - original: str - Original transcript
            - matched_to_context: bool - Whether it was matched to conversation context
    """
    if not transcript or not transcript.strip():
        return {
            "improved": "",
            "confidence": 0.0,
            "original": transcript or "",
            "matched_to_context": False
        }
    
    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    
    # Get conversation context if available
    conversation_context = ""
    last_ai_message = ""
    recent_user_messages = []
    topic = "random"
    
    if session:
        messages = session.get("messages", [])
        # Get last AI message
        for m in reversed(messages):
            if m.get("role") == "assistant" and (m.get("content") or "").strip():
                last_ai_message = (m.get("content") or "").strip()
                break
        
        # Get last few user messages for context
        user_msgs = [m.get("content", "") for m in messages if m.get("role") == "user"]
        recent_user_messages = user_msgs[-3:] if len(user_msgs) > 0 else []
        
        topic = session.get("topic", "random") or "random"
        topic_hint = TOPIC_CONTEXT.get(topic, TOPIC_CONTEXT["random"])
        conversation_context = f"Topic: {topic_hint}\n"
        
        if last_ai_message:
            conversation_context += f"Last AI message: {last_ai_message}\n"
        if recent_user_messages:
            conversation_context += f"Recent user messages: {' | '.join(recent_user_messages)}\n"
    
    learner_level = session.get("learner_level", "beginner") if session else "beginner"
    
    try:
        system_prompt = f"""You are an intelligent sentence interpreter for a language learning app.

TASK: Take an unclear or garbled transcript and determine what the user likely meant to say,
then improve it to be a natural, correct sentence in {target_name}.

CONTEXT AWARENESS:
- Use conversation context to understand what makes sense given the current topic and flow
- Match the transcript to plausible sentences that would fit the conversation
- Even if the audio was unclear, make your best judgment about the intended meaning

LEARNER CONSIDERATIONS:
- The user is a {learner_level} learner - be forgiving of pronunciation issues
- Speech transcription may contain errors due to unclear audio or accent
- Infer intent generously - prefer meaningful interpretation over literal words
- Never assume the user said something strange on purpose

IMPROVEMENT RULES:
1. If the transcript is already clear and correct, improve it minimally (just naturalize phrasing)
2. If the transcript is unclear but context suggests a meaning, interpret and improve it
3. If the transcript is garbled but sounds similar to common phrases, match to a plausible sentence
4. Always output in {target_name} using native script (Devanagari for Hindi, Hanzi for Chinese, etc.)
5. Make the sentence natural and idiomatic, but keep it simple for language learners

Return JSON only:
{{
    "improved": "The improved, natural sentence in {target_name}",
    "confidence": 0.0-1.0,
    "matched_to_context": true/false,
    "reasoning": "Brief explanation of what you matched/improved (for debugging)"
}}

Confidence guide:
- 0.9-1.0: Clear match, transcript was mostly correct or clearly interpretable
- 0.7-0.9: Good match, context strongly suggests this meaning
- 0.5-0.7: Reasonable guess based on context and similarity
- 0.3-0.5: Low confidence, but best guess from available clues
- <0.3: Very unclear, but still provide an improved version"""
        
        user_content = {
            "transcript": transcript,
            "raw_transcript": raw_transcript or transcript,
            "conversation_context": conversation_context.strip() if conversation_context else "No context available",
            "target_language": target_name
        }
        
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(user_content, ensure_ascii=False)
                }
            ],
            response_format={"type": "json_object"},
            max_tokens=300,
            temperature=0.3  # Lower temperature for more consistent matching
        )
        
        result = json.loads(response.choices[0].message.content or "{}")
        
        improved = (result.get("improved") or "").strip()
        confidence = float(result.get("confidence", 0.5))
        matched = bool(result.get("matched_to_context", False))
        reasoning = result.get("reasoning", "")
        
        # Safety fallback
        if not improved:
            improved = transcript.strip()
            confidence = 0.3
        
        # Ensure improved sentence is in target language
        if improved and target_language != "en":
            improved = await ensure_target_language(improved, target_language)
        
        print(f"[SENTENCE MATCH] transcript={transcript[:60]!r} -> improved={improved[:60]!r} confidence={confidence:.2f} reasoning={reasoning[:80]!r}")
        
        return {
            "improved": improved,
            "confidence": confidence,
            "original": transcript,
            "matched_to_context": matched
        }
        
    except Exception as e:
        print(f"[SENTENCE MATCH] Error: {e}")
        # Fallback to original transcript
        return {
            "improved": transcript.strip(),
            "confidence": 0.3,
            "original": transcript,
            "matched_to_context": False
        }

# ============ Streaming Endpoints ============

# Whisper is well known to "hallucinate" specific boilerplate phrases on silent or
# noisy audio - text memorized from its training data (crowd-sourced subtitle
# credits, video outros, etc), reproduced with deceptively high confidence. Because
# it's confident, it slips past the no_speech_prob/avg_logprob guard, and because
# it's produced correctly in the target language, it slips past language validation
# too. These markers are literal brand/domain names that don't get translated, so
# checking for them is language-agnostic and doesn't rely on us knowing every
# language's exact phrasing (e.g. "Ondertitels ingediend door de Amara.org
# gemeenschap" in Dutch, "Subtitles by the Amara.org community" in English, etc -
# all contain "amara.org" verbatim).
KNOWN_HALLUCINATION_MARKERS = [
    "amara.org",
]


def is_known_hallucination(text: str) -> bool:
    """Cheap text-based guard for well-documented Whisper hallucination phrases
    that a pure confidence-score guard (_likely_no_speech) won't catch."""
    if not text:
        return False
    t = text.lower()
    return any(marker in t for marker in KNOWN_HALLUCINATION_MARKERS)


@app.post("/api/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Query("es"),
    hint: Optional[str] = Query(None),
    fallback_language: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    improve_sentence: bool = Query(True)
):
    """
    Transcribe audio using Whisper with two-pass strategy:
    1. First try with target language hint (if provided)
    2. If result is garbled, retry with fallback language (user's preferred language, usually English)
    3. Optionally match and improve unclear sentences using conversation context
    
    Args:
        audio: Audio file to transcribe
        language: Default language code
        hint: Language hint for transcription
        fallback_language: Fallback language if hint fails
        session_id: Optional session ID for conversation context-based sentence matching
        improve_sentence: Whether to use intelligent sentence matching and improvement (default: True)
    """
    try:
        audio_data = await audio.read()

        # Preserve the real upload metadata (critical for Safari/WKWebView which often records audio/mp4).
        upload_filename = (getattr(audio, "filename", None) or "").strip() or "audio"
        upload_content_type = (getattr(audio, "content_type", None) or "").strip() or "application/octet-stream"
        
        # Check if audio file is empty or too small (likely recording issue)
        if not audio_data or len(audio_data) < 100:
            print(
                f"[TRANSCRIBE] ERROR: Audio file is empty or too small "
                f"({len(audio_data) if audio_data else 0} bytes) "
                f"filename={upload_filename!r} content_type={upload_content_type!r}"
            )
            return {
                "transcript": "",
                "detected_language": None,
                "used_hint": None,
                "valid_for_target": False
            }
        
        hint_code = normalize_lang_code(hint)
        use_hint = bool(hint_code) and is_supported_language_code(hint_code)
        fallback_code = normalize_lang_code(fallback_language)
        use_fallback = bool(fallback_code) and is_supported_language_code(fallback_code)
        
        print(
            f"[TRANSCRIBE] Request: language={language}, hint={hint!r} -> "
            f"hint_code={hint_code}, use_hint={use_hint}, "
            f"audio_size={len(audio_data)} bytes, "
            f"filename={upload_filename!r}, content_type={upload_content_type!r}"
        )

        # Heuristic: if we *hinted* a Latin-script language (nl/fr/de/etc) but Whisper returns
        # a clearly non‑Latin script (e.g. Devanagari), retry once without a hint.
        # This prevents rare cases where the user's utterance is shown in the wrong script.
        def _has_devanagari(s: str) -> bool:
            return bool(re.search(r"[\u0900-\u097F]", s or ""))

        def _has_arabic(s: str) -> bool:
            return bool(re.search(r"[\u0600-\u06FF]", s or ""))

        def _has_cjk(s: str) -> bool:
            return bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]", s or ""))

        def _looks_like_wrong_script_for_latin(s: str) -> bool:
            # Only trigger on meaningful text; avoid retries on empty/very short clips.
            if not s:
                return False
            s2 = s.strip()
            if len(s2) < 6:
                return False
            return _has_devanagari(s2) or _has_arabic(s2) or _has_cjk(s2)

        latin_langs = {"en", "es", "fr", "de", "nl", "it", "pt"}
        
        # Use Whisper auto-detect by default.
        # When the user is in the "repeat the target sentence" step, we pass hint=<target_language>
        # to prevent mis-detections like Arabic for Dutch pronunciation.
        def _extract_speech_metrics(transcription_obj) -> dict:
            """
            Best-effort extraction of Whisper confidence metrics from verbose_json.
            On many silent/near-silent clips Whisper can "hallucinate" common phrases.
            We use no_speech_prob + avg_logprob (when present) to guard against that.
            """
            segs = getattr(transcription_obj, "segments", None)
            if segs is None and isinstance(transcription_obj, dict):
                segs = transcription_obj.get("segments")
            if not segs or not isinstance(segs, list):
                return {}

            no_speech_probs = []
            avg_logprobs = []
            for s in segs:
                # segment can be a model or dict depending on client version
                nsp = getattr(s, "no_speech_prob", None)
                alp = getattr(s, "avg_logprob", None)
                if isinstance(s, dict):
                    nsp = s.get("no_speech_prob", nsp)
                    alp = s.get("avg_logprob", alp)
                if isinstance(nsp, (int, float)):
                    no_speech_probs.append(float(nsp))
                if isinstance(alp, (int, float)):
                    avg_logprobs.append(float(alp))

            out = {}
            if no_speech_probs:
                out["mean_no_speech_prob"] = sum(no_speech_probs) / len(no_speech_probs)
                out["max_no_speech_prob"] = max(no_speech_probs)
            if avg_logprobs:
                out["mean_avg_logprob"] = sum(avg_logprobs) / len(avg_logprobs)
            return out

        def _likely_no_speech(metrics: dict, text_out: str) -> bool:
            if not metrics:
                return False
            mean_nsp = metrics.get("mean_no_speech_prob")
            mean_alp = metrics.get("mean_avg_logprob")

            # NOTE: we intentionally do NOT use max_no_speech_prob here.
            # A normal recording spans from mic-open to the user tapping "Done", so it
            # almost always contains a leading/trailing silent segment that alone can
            # score >= 0.95 on no_speech_prob even when other segments contain clear
            # speech. Gating on a single segment's max would discard valid transcripts.
            # Instead we require the whole clip (mean across all segments) to look silent,
            # and only when there's no confident text to fall back on.
            if (text_out or "").strip():
                if isinstance(mean_nsp, (int, float)) and mean_nsp >= 0.85:
                    if mean_alp is None:
                        # If we don't have avg_logprob, still be conservative: require very high no_speech.
                        return mean_nsp >= 0.92
                    if isinstance(mean_alp, (int, float)) and mean_alp <= -1.0:
                        return True
            return False

        async def _transcribe_once(language_hint: Optional[str]) -> tuple[str, Optional[str], Optional[str], dict]:
            kwargs = {
                "model": "whisper-1",
                # IMPORTANT: pass through the actual recorded format (e.g. audio/mp4 from Safari).
                "file": (upload_filename, audio_data, upload_content_type),
                "response_format": "verbose_json",
                # Lower temperature reduces "hallucinations" on silence.
                "temperature": 0,
            }
            if language_hint:
                # Force transcription in the specified language - this is not just a hint, it forces the output language
                kwargs["language"] = language_hint
                print(f"[TRANSCRIBE] Forcing language={language_hint}")
            t = await client.audio.transcriptions.create(**kwargs)
            text_out = (getattr(t, "text", None) or "").strip()
            detected_out = getattr(t, "language", None)
            used_hint_out = language_hint
            metrics = _extract_speech_metrics(t)
            print(
                f"[TRANSCRIBE] Result: text={text_out[:80]!r}, detected={detected_out}, forced={language_hint}, "
                f"metrics={metrics}"
            )
            return text_out, detected_out, used_hint_out, metrics

        # When we have a hint (target language), force transcription in that language.
        # If Whisper ignores our language constraint and produces wrong-language text, we need to handle it.
        text, detected, used_hint, metrics = await _transcribe_once(hint_code if use_hint else None)

        # Guard against Whisper hallucinations on silence/background noise.
        if _likely_no_speech(metrics, text) or is_known_hallucination(text):
            print(f"[TRANSCRIBE] Likely no speech or known hallucination (metrics={metrics}, text={text[:80]!r}); treating transcript as empty")
            return {
                "transcript": "",
                "detected_language": detected,
                "used_hint": used_hint,
                "valid_for_target": False,
            }

        # Early return if no text - don't do validation on empty transcripts
        if not text or not text.strip():
            print(f"[TRANSCRIBE] Empty transcript returned from Whisper")
            return {
                "transcript": "",
                "detected_language": detected,
                "used_hint": used_hint,
                "valid_for_target": False
            }
        
        # Validation: if we forced a language, the transcript MUST be in that language.
        # If it's not, Whisper ignored our constraint - reject it and retry with stronger enforcement.
        if use_hint and text:
            # Check if transcript is clearly NOT in the target language
            is_wrong_language = False
            
            # First check: Whisper's detected language should match the forced language
            # Only reject if it's clearly wrong (e.g., English when we forced Dutch)
            # Be lenient with similar languages (e.g., Dutch vs German) since they can be confused
            if detected:
                detected_normalized = normalize_lang_code(detected)
                if detected_normalized and detected_normalized != hint_code:
                    # Only reject if it's clearly wrong - English when learning another language, or completely different script
                    if hint_code != "en" and detected_normalized == "en":
                        is_wrong_language = True
                        print(f"[TRANSCRIBE] ERROR: Forced {hint_code} but Whisper detected English: {text[:80]!r}")
                    elif hint_code in {"hi", "zh", "ja", "ko"} and detected_normalized not in {"hi", "zh", "ja", "ko"}:
                        # Script mismatch for non-Latin languages
                        is_wrong_language = True
                        print(f"[TRANSCRIBE] ERROR: Forced {hint_code} but Whisper detected {detected_normalized} (script mismatch): {text[:80]!r}")
                    # For similar Latin languages (nl/de, es/pt, etc.), be lenient - don't reject
                    # Whisper can confuse similar languages, but the text is likely still valid
            
            # For Latin-script languages: check if it looks like English when we forced Dutch/French/etc
            # BUT: When we force a language, Whisper should transcribe in that language, so we trust it
            # Only check for English if Whisper detected English (already handled above)
            # Skip this check when forcing - trust Whisper's transcription
            # if hint_code in latin_langs and hint_code != "en":
            #     if looks_like_english(text):
            #         is_wrong_language = True
            #         print(f"[TRANSCRIBE] ERROR: Forced {hint_code} but text looks like English: {text[:80]!r}")
            
            # For Hindi: check if transcript lacks Devanagari
            elif hint_code == "hi":
                if not bool(re.search(r"[\u0900-\u097F]", text)):
                    is_wrong_language = True
                    print(f"[TRANSCRIBE] ERROR: Forced Hindi but got non-Devanagari: {text[:80]!r}")
            
            # For Chinese: check if transcript lacks Hanzi
            elif hint_code == "zh":
                if not bool(re.search(r"[\u4E00-\u9FFF]", text)):
                    is_wrong_language = True
                    print(f"[TRANSCRIBE] ERROR: Forced Chinese but got non-Hanzi: {text[:80]!r}")
            
            # For Japanese: check if transcript lacks Japanese script
            elif hint_code == "ja":
                if not bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF]", text)):
                    is_wrong_language = True
                    print(f"[TRANSCRIBE] ERROR: Forced Japanese but got non-Japanese: {text[:80]!r}")
            
            # For Korean: check if transcript lacks Hangul
            elif hint_code == "ko":
                if not bool(re.search(r"[\uAC00-\uD7AF]", text)):
                    is_wrong_language = True
                    print(f"[TRANSCRIBE] ERROR: Forced Korean but got non-Hangul: {text[:80]!r}")
            
            # If wrong language detected, retry with auto-detect as fallback (better than wrong language)
            if is_wrong_language:
                print(f"[TRANSCRIBE] Retrying with auto-detect (forced {hint_code} failed)")
                text2, detected2, used_hint2, metrics2 = await _transcribe_once(None)
                if _likely_no_speech(metrics2, text2) or is_known_hallucination(text2):
                    print(f"[TRANSCRIBE] Retry likely no speech or known hallucination (metrics={metrics2}, text={text2[:80]!r}); treating transcript as empty")
                    text2 = ""
                # Only use auto-detect result if it's actually in the target language
                # Check both text content and detected language match
                detected2_normalized = normalize_lang_code(detected2) if detected2 else None
                # Be lenient: accept if text is valid for target language, even if detected language is slightly off
                # Only reject if it's clearly wrong (English when we want Dutch, or wrong script)
                text_is_valid = likely_in_target_language(text2, hint_code)
                detected_is_valid = (detected2_normalized == hint_code or not detected2_normalized or 
                                   (hint_code in latin_langs and detected2_normalized in latin_langs and detected2_normalized != "en"))
                
                if text2 and text_is_valid and (detected_is_valid or not detected2_normalized):
                    text, detected, used_hint = text2, detected2, None
                    print(f"[TRANSCRIBE] Auto-detect succeeded: {text[:80]!r}, detected={detected2_normalized}")
                else:
                    # Auto-detect retry failed - return empty
                    # Trust Whisper's detected language rather than text content analysis
                    print(f"[TRANSCRIBE] Auto-detect also failed (detected={detected2_normalized}, expected={hint_code}), returning empty transcript")
                    text = ""  # Return empty instead of wrong language text
                    # Mark as invalid so frontend knows this is a rejection, not just empty audio
                    is_valid = False
        
        # Script mismatch check (legacy, but keep for safety)
        # Only check for script mismatch if we forced a non-Latin language (Hindi, Chinese, etc.)
        # For Latin languages, script mismatch shouldn't happen, so skip this check
        if use_hint and hint_code not in latin_langs and _looks_like_wrong_script_for_latin(text):
            print(f"[TRANSCRIBE] Wrong script despite hint={hint_code}, retrying auto-detect")
            text2, detected2, used_hint2, metrics2 = await _transcribe_once(None)
            if _likely_no_speech(metrics2, text2) or is_known_hallucination(text2):
                print(f"[TRANSCRIBE] Retry likely no speech or known hallucination (metrics={metrics2}, text={text2[:80]!r}); treating transcript as empty")
                text2 = ""
            # Only use auto-detect result if it's valid for target language
            if text2 and not _looks_like_wrong_script_for_latin(text2):
                detected2_normalized = normalize_lang_code(detected2) if detected2 else None
                # Validate that detected language matches target, or at least text is valid
                if (detected2_normalized == hint_code or not detected2_normalized) and likely_in_target_language(text2, hint_code):
                    text, detected, used_hint = text2, detected2, used_hint2
                else:
                    print(f"[TRANSCRIBE] Auto-detect from script check failed (detected={detected2_normalized}, expected={hint_code})")
                    text = ""  # Reject wrong language
                    # Mark as invalid so frontend knows this is a rejection, not just empty audio
                    is_valid = False
        
        # Final validity check: is this transcript plausible for the target language?
        target_code = normalize_lang_code(hint_code or language)
        # Only reset is_valid if text is not empty - if text was set to empty earlier, keep is_valid as False
        if not text or not text.strip():
            # Text is empty - this means it was rejected earlier, so keep is_valid as False
            is_valid = False
        else:
            is_valid = True
        original_text = text
        if target_code and target_code in SUPPORTED_LANGUAGE_CODES:
            # Skip validation if text is already empty (was rejected earlier)
            if not text or not text.strip():
                print(f"[TRANSCRIBE] Skipping final validation - text already empty (was rejected earlier)")
            # When we forced a language, be very lenient - only reject if it clearly looks like English
            # Trust Whisper when we force a language - it should transcribe in that language
            elif use_hint and hint_code:
                # We forced the language - TRUST WHISPER!
                # When we force a language with Whisper's API, it should transcribe in that language
                # We already checked if detected language is English (rejected earlier)
                # So if we get here with non-empty text, accept it - trust that forcing worked
                # Only reject if Whisper detected English (already handled in early validation)
                print(f"[TRANSCRIBE] ACCEPTED (forced {target_code}): {text[:80]!r}, detected={detected}")
                is_valid = True
                # Don't check looks_like_english here - when forcing, trust Whisper's transcription
            else:
                # Auto-detect mode: check detected language more strictly
                if detected:
                    detected_normalized = normalize_lang_code(detected)
                    if detected_normalized and detected_normalized != target_code:
                        print(f"[TRANSCRIBE] INVALID: Expected {target_code} but detected {detected_normalized}: {text[:80]!r}")
                        is_valid = False
                        text = ""
                    elif not likely_in_target_language(text, target_code):
                        print(f"[TRANSCRIBE] INVALID for target={target_code}: {text[:80]!r}")
                        is_valid = False
                        text = ""
                elif not likely_in_target_language(text, target_code):
                    print(f"[TRANSCRIBE] INVALID for target={target_code}: {text[:80]!r}")
                    is_valid = False
                    # Treat invalid as no transcript so frontend can handle it like \"no speech\"
                    text = ""
        
        # Intelligent sentence matching and improvement
        improved_text = text
        improvement_result = None
        if improve_sentence and text and text.strip() and session_id and session_id in sessions:
            try:
                session = sessions[session_id]
                target_lang = session.get("target_language", target_code or language)
                
                # Use sentence matching to improve unclear transcripts
                improvement_result = await improve_and_match_sentence(
                    transcript=text,
                    target_language=target_lang,
                    session=session,
                    raw_transcript=original_text
                )
                
                improved_text = improvement_result.get("improved", text)
                confidence = improvement_result.get("confidence", 0.0)
                
                # Always use the improved version for display to the user
                # The improvement function intelligently matches unclear transcripts to plausible sentences
                # and makes judgment calls to improve them, so we trust its output
                original_for_display = text
                
                if improved_text and improved_text.strip():
                    text = improved_text  # Always use improved version for what user sees
                    if text.strip() != original_for_display.strip():
                        print(f"[TRANSCRIBE] Showing corrected version to user: {text[:80]!r} (confidence: {confidence:.2f}, original heard: {original_for_display[:80]!r})")
                    else:
                        print(f"[TRANSCRIBE] Improved version matches original: {text[:80]!r} (confidence: {confidence:.2f})")
                else:
                    print(f"[TRANSCRIBE] No improvement available, using original: {text[:80]!r}")
                    
            except Exception as e:
                print(f"[TRANSCRIBE] Sentence improvement failed: {e}")
                # Continue with original transcript
        
        # Build response
        response = {
            "transcript": text,
            "detected_language": detected,
            "used_hint": used_hint,
            "valid_for_target": is_valid
        }
        
        # Include improvement info if available and different from original
        if improvement_result:
            original_for_info = improvement_result.get("original", original_text)
            # Only include improvement info if there was a meaningful change
            if improved_text and improved_text.strip() != original_for_info.strip():
                response["improvement"] = {
                    "improved": improved_text if improved_text else text,
                    "original": original_for_info,
                    "confidence": improvement_result.get("confidence", 0.0),
                    "matched_to_context": improvement_result.get("matched_to_context", False),
                    "was_corrected": True
                }
            else:
                response["improvement"] = {
                    "improved": text,
                    "original": original_for_info,
                    "confidence": improvement_result.get("confidence", 0.0),
                    "matched_to_context": False,
                    "was_corrected": False
                }
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe_chunk")
async def transcribe_audio_chunk(
    audio: UploadFile = File(...),
    language: str = Query("es"),
    hint: Optional[str] = Query(None),
):
    """
    Transcribe a short audio chunk for "streaming" UX.
    This skips improvement and most validation to keep latency low.
    """
    try:
        audio_data = await audio.read()

        upload_filename = (getattr(audio, "filename", None) or "").strip() or "audio"
        upload_content_type = (getattr(audio, "content_type", None) or "").strip() or "application/octet-stream"

        if not audio_data or len(audio_data) < 200:
            return {"partial": ""}

        hint_code = normalize_lang_code(hint)
        use_hint = bool(hint_code) and is_supported_language_code(hint_code)

        kwargs = {
            "model": "whisper-1",
            "file": (upload_filename, audio_data, upload_content_type),
            "response_format": "verbose_json",
            "temperature": 0,
        }
        if use_hint:
            kwargs["language"] = hint_code

        t = await client.audio.transcriptions.create(**kwargs)
        text_out = (getattr(t, "text", None) or "").strip()

        # Basic no-speech guard (similar to /api/transcribe)
        segs = getattr(t, "segments", None)
        if segs is None and isinstance(t, dict):
            segs = t.get("segments")
        if segs and isinstance(segs, list):
            nsp = []
            alp = []
            for s in segs:
                n = getattr(s, "no_speech_prob", None)
                a = getattr(s, "avg_logprob", None)
                if isinstance(s, dict):
                    n = s.get("no_speech_prob", n)
                    a = s.get("avg_logprob", a)
                if isinstance(n, (int, float)):
                    nsp.append(float(n))
                if isinstance(a, (int, float)):
                    alp.append(float(a))
            if nsp:
                mean_nsp = sum(nsp) / len(nsp)
                mean_alp = (sum(alp) / len(alp)) if alp else None
                # Use the mean across all segments (not max of one segment) so a brief
                # silent moment inside a 2s chunk doesn't discard real speech in it.
                if text_out and mean_nsp >= 0.85 and (mean_alp is None or mean_alp <= -1.0):
                    return {"partial": ""}

        if is_known_hallucination(text_out):
            return {"partial": ""}

        return {"partial": text_out}
    except Exception as e:
        print(f"[TRANSCRIBE CHUNK ERROR] {e}")
        return {"partial": ""}

@app.post("/api/conversation/respond")
async def respond_to_user(data: UserMessage):
    """Generate streaming AI response"""
    if data.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = sessions[data.session_id]
    
    async def generate_stream():
        try:
            print(
                f"[RESPOND] session={data.session_id} "
                f"lang={session.get('target_language')} topic={session.get('topic')} "
                f"roleplay_id={session.get('roleplay_id')} custom={bool(session.get('custom_scenario'))}"
            )

            target_language = session.get("target_language", "en")
            print(
                f"[RESPOND] target_language={target_language!r} transcript={data.transcript!r}"
            )

            # If the client includes a pending translation (e.g. across instance restarts),
            # we keep it in session for reference, but we NO LONGER gate on \"say it again\".
            if data.translation_pending and not session.get("translation_pending"):
                session["translation_pending"] = data.translation_pending

            # Translation assist:
            # Only trigger on explicit translation requests ("How do you say...", etc.)
            # Do NOT trigger on language mismatch - we assume user is speaking target language.
            classified = await classify_translation_request(data.transcript, target_language, session)

            if classified.get("needs_translation"):
                try:
                    payload = classified.get("payload") or ""
                    # Fallback to regex-based extraction if classifier couldn't extract
                    if not payload:
                        payload = extract_translation_payload(data.transcript)
                        if re.search(r"\bhow\s+do\s+(?:you|i)\s+say\b", payload, flags=re.IGNORECASE):
                            payload = re.sub(r"^\s*how\s+do\s+(?:you|i)\s+say\b[\s:,\-\—\–…]*", "", payload, flags=re.IGNORECASE).strip()
                    # Final safety: strip wrapper even if classifier returned it
                    payload = re.sub(r"^\s*how\s+do\s+(?:you|i)\s+say\b[\s:,\-\—\–…]*", "", payload, flags=re.IGNORECASE).strip()
                    if not payload:
                        raise ValueError("Empty translation payload")
                    assist = await generate_translation_assist(payload, target_language, session)
                    assist = await ensure_translation_only(
                        payload=payload,
                        target_language=target_language,
                        translation=assist.get("translation", ""),
                        alternative=assist.get("alternative"),
                    )
                    # Final hard enforcement: translation text must be in the target language.
                    # This prevents weird cases where the model outputs Arabic (or other) despite instructions.
                    if assist.get("translation"):
                        assist["translation"] = await ensure_target_language(assist["translation"], target_language)
                    if assist.get("alternative"):
                        assist["alternative"] = await ensure_target_language(assist["alternative"], target_language)
                    if assist.get("translation"):
                        # Show translation card, but DO NOT set translation_pending or block flow.
                        print(f"[TRANSLATION ASSIST] on-the-fly lang={target_language} source={payload!r} translation={assist['translation'][:80]!r}")
                        yield f"data: {json.dumps({'type': 'translation', 'source': payload, 'translation': assist['translation'], 'alternative': assist.get('alternative')})}\n\n"
                except Exception as e:
                    print(f"[TRANSLATION ASSIST] failed: {e}")

            # Normal conversation: add user message to context
            raw_transcript = (data.transcript or "").strip()
            user_for_context = raw_transcript
            session["user_utterances"].append(raw_transcript)

            # Lazy-init learner confidence bucket (internal only)
            session.setdefault("learner_level", "beginner")

            # Pronunciation-tolerant intent inference: only when transcript is garbled (corrupted/wrong script).
            # We trust the transcription when we force the target language - even if pronunciation is imperfect,
            # Whisper should transcribe it in the target language.
            should_infer = False
            if raw_transcript:
                # Only trigger on garbled transcripts (corruption/wrong script), not language mismatches.
                # When we force target language, we trust that transcription.
                if likely_in_target_language(raw_transcript, target_language) and looks_garbled_transcript(raw_transcript, target_language):
                    should_infer = True
                    print(f"[INTENT INFERENCE] Trigger: garbled transcript")

            if should_infer:
                inferred = await infer_intended_user_utterance(raw_transcript, target_language, session)
                interpreted = (inferred.get("interpreted") or "").strip() or raw_transcript
                needs_clar = bool(inferred.get("needs_clarification"))
                clar_q = (inferred.get("clarification") or "").strip()
                visual = inferred.get("visual_you_meant")

                # Visual-only hint (never spoken automatically).
                # Show only if it differs meaningfully from the raw transcript.
                if isinstance(visual, str):
                    v = visual.strip()
                    if v and v != raw_transcript:
                        yield f"data: {json.dumps({'type': 'you_meant', 'text': v})}\n\n"

                # If truly ambiguous, ask a soft yes/no confirmation and stop here.
                if needs_clar and clar_q:
                    session["messages"].append({"role": "assistant", "content": clar_q})
                    yield f"data: {json.dumps({'text': clar_q, 'done': False})}\n\n"
                    yield f"data: {json.dumps({'text': '', 'done': True, 'full_response': clar_q, 'target_language': target_language})}\n\n"
                    return

                user_for_context = interpreted
                print(f"[INTENT INFERENCE] Interpreted: {raw_transcript[:60]!r} -> {interpreted[:60]!r}")

            session["messages"].append({"role": "user", "content": user_for_context})

            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": get_conversation_prompt(
                            session["target_language"], 
                            session.get("topic", "random"),
                            session.get("roleplay_id"),
                            session.get("custom_scenario")
                        )
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
                    if session["target_language"] == "hi":
                        content = enforce_hindi_female_self_reference(content)
                    full_response += content
                    yield f"data: {json.dumps({'text': content, 'done': False})}\n\n"
            
            if session["target_language"] == "hi":
                full_response = enforce_hindi_female_self_reference(full_response)
            elif session["target_language"] != "en":
                # Ensure final text is in the selected target language (role-play was slipping into English)
                before = full_response
                full_response = await ensure_target_language(full_response, session["target_language"])
                if before != full_response:
                    print(f"[LANG ENFORCER] rewrote {session['target_language']}: {before[:80]!r} -> {full_response[:80]!r}")

            # Save assistant response
            session["messages"].append({"role": "assistant", "content": full_response})
            yield f"data: {json.dumps({'text': '', 'done': True, 'full_response': full_response, 'target_language': session.get('target_language')})}\n\n"
            
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

def enforce_hindi_female_self_reference(text: str) -> str:
    """
    Best-effort safeguard to keep Hindi assistant self-references aligned with the (female) voice persona.
    We ONLY rewrite common first-person masculine forms ("मैं ... गया/था/करता हूँ") to feminine.
    This is intentionally narrow to avoid changing user/third-person references.
    """
    if not text:
        return text

    t = text

    # Identity/self-labels
    t = re.sub(r"\bमैं\s+एक\s+आदमी\s+हूँ\b", "मैं एक औरत हूँ", t)
    t = re.sub(r"\bमैं\s+आदमी\s+हूँ\b", "मैं औरत हूँ", t)
    t = re.sub(r"\bमैं\s+लड़का\s+हूँ\b", "मैं लड़की हूँ", t)

    # First-person past/perfect (gendered)
    t = re.sub(r"\bमैं\s+गया\s+हूँ\b", "मैं गई हूँ", t)
    t = re.sub(r"\bमैं\s+गया\b", "मैं गई", t)
    t = re.sub(r"\bमैं\s+आया\s+हूँ\b", "मैं आई हूँ", t)
    t = re.sub(r"\bमैं\s+आया\b", "मैं आई", t)
    t = re.sub(r"\bमैं\s+था\b", "मैं थी", t)

    # First-person habitual (gendered)
    t = re.sub(r"\bमैं\s+करता\s+हूँ\b", "मैं करती हूँ", t)
    t = re.sub(r"\bमैं\s+करता\s+था\b", "मैं करती थी", t)

    return t

# Lightweight language enforcement guard:
# If the model accidentally responds in English while the target language is not English,
# we rewrite the final response into the target language (keeps audio + text consistent).
#
# IMPORTANT:
# We use a *high-precision* English word set to avoid false positives for Dutch/German/etc.
# (Words like "in/is/to" occur across languages and are NOT reliable.)
_EN_HIGH_PRECISION_WORDS = {
    # High-signal English function words / pronouns
    "the", "and", "you", "your", "yours",
    "i", "me", "my", "mine",
    "are", "was", "were",
    "do", "does", "did",
    "what", "how", "why", "when", "where", "who",
    "can", "could", "would", "should",
    "please", "sorry", "thanks", "thank",
    # Common English negatives / fillers that show up in mixed utterances
    "no", "not", "dont", "can't", "cant", "won't", "wont", "didn't", "didnt",
}

def looks_like_english(text: str) -> bool:
    """
    Heuristic: detect English reliably even for short sentences.
    Uses high-precision English tokens to avoid false positives for other Latin-script languages.
    """
    if not text:
        return False
    lower = text.lower()
    tokens = re.findall(r"[a-z']+", lower)
    if not tokens:
        return False
    hits = sum(1 for t in tokens if t in _EN_HIGH_PRECISION_WORDS)
    # Extra signal: English negation contraction (often present in mixed utterances)
    has_nt = "n't" in lower or "dont" in tokens or "didnt" in tokens or "wont" in tokens or "cant" in tokens
    # For short replies (role-play), even 2 strong English tokens is enough.
    if hits >= 2 or (hits >= 1 and has_nt):
        return True
    # For slightly longer replies, use a ratio.
    if len(tokens) >= 6 and hits / len(tokens) >= 0.25:
        return True
    # For very short phrases (1-2 words), if it contains a high-precision English word, it's likely English
    # This catches cases like "the", "you", "what" etc. that are clearly English
    if len(tokens) <= 2 and hits >= 1:
        return True
    return False

def force_translation_needed(transcript: str, target_language: str) -> bool:
    """
    Deterministic mismatch detector used to drive the "translation pending" UX.
    If this returns True, we MUST enter translation assist and MUST NOT advance the conversation.
    """
    if not transcript:
        return False
    t = transcript.strip()
    if not t:
        return False

    # Removed automatic English detection - rely on explicit translation requests only
    # (User can still ask "How do you say..." explicitly)
    
    # Script mismatches for non-Latin languages
    if target_language == "hi" and not re.search(r"[\u0900-\u097F]", t):
        return True
    if target_language == "zh" and not re.search(r"[\u4E00-\u9FFF]", t):
        return True
    if target_language == "ja" and not re.search(r"[\u3040-\u30FF\u4E00-\u9FFF]", t):
        return True
    if target_language == "ko" and not re.search(r"[\uAC00-\uD7AF]", t):
        return True

    return False

def normalize_lang_code(code: Optional[str]) -> Optional[str]:
    """Normalize Whisper language outputs (sometimes 'en', sometimes 'english')."""
    if not code:
        return None
    c = str(code).strip().lower()
    if not c:
        return None
    # Common Whisper verbose_json language values are ISO-639-1, but be defensive.
    mapping = {
        "english": "en",
        "dutch": "nl",
        "spanish": "es",
        "french": "fr",
        "german": "de",
        "italian": "it",
        "portuguese": "pt",
        "hindi": "hi",
        "chinese": "zh",
        "japanese": "ja",
        "korean": "ko",
    }
    if c in mapping:
        return mapping[c]
    # If already looks like a code, keep first two letters
    if len(c) >= 2:
        return c[:2]
    return c

def is_supported_language_code(code: Optional[str]) -> bool:
    return bool(code) and code in SUPPORTED_LANGUAGE_CODES

def detect_translation_intent(transcript: str, target_language: str) -> bool:
    """
    Soft detection:
    - explicit phrases like "How do you say..." / "What's X in French"
    - or user clearly speaks in English while target language is not English
    - or Devanagari while target is English
    """
    if not transcript:
        return False
    t = transcript.strip().lower()

    # Explicit "how do you say" patterns (common user language = English)
    explicit_markers = [
        "how do you say",
        "how do i say",
        "what's",
        "what is",
        "in french",
        "in spanish",
        "in german",
        "in dutch",
        "in italian",
        "in portuguese",
        "in hindi",
        "in chinese",
        "in japanese",
        "in korean",
    ]
    if any(m in t for m in explicit_markers) and ("say" in t or "in " in t):
        return True

    # Removed automatic English detection - rely on explicit translation requests only
    # (User can still ask "How do you say..." explicitly)

    # If target is English and user uses Devanagari (Hindi), treat as translation assist
    if target_language == "en" and re.search(r"[\u0900-\u097F]", transcript):
        return True

    return False

def likely_in_target_language(text: str, target_language: str) -> bool:
    """
    Cheap heuristic gate:
    - For Hindi/Chinese/Japanese/Korean: check script presence.
    - For English: check looks_like_english.
    - For other Latin languages: if it looks like English, assume NOT target; otherwise assume maybe target.
    """
    if not text:
        return True
    t = text.strip()

    if target_language == "hi":
        # Devanagari should be present for Hindi
        return bool(re.search(r"[\u0900-\u097F]", t))
    if target_language == "zh":
        return bool(re.search(r"[\u4E00-\u9FFF]", t))
    if target_language == "ja":
        return bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF]", t))
    if target_language == "ko":
        return bool(re.search(r"[\uAC00-\uD7AF]", t))
    if target_language == "en":
        # Validate that English text is actually English
        return looks_like_english(t)

    # Latin-script target languages (es/fr/de/nl/it/pt):
    # Trust Whisper's transcription - don't reject based on English detection
    # (Removed looks_like_english check - trust the forced language)
    return True

def looks_garbled_transcript(text: str, target_language: str) -> bool:
    """
    Cheap trigger for "STT likely messed up".
    We only use this to decide whether to run intent inference/repair.
    """
    if not text:
        return False
    t = text.strip()
    if len(t) < 6:
        return False
    # Replacement char / obvious corruption
    if "�" in t:
        return True

    # Script mismatches are a strong signal.
    has_deva = bool(re.search(r"[\u0900-\u097F]", t))
    has_arab = bool(re.search(r"[\u0600-\u06FF]", t))
    has_cjk = bool(re.search(r"[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]", t))

    latin_targets = {"en", "es", "fr", "de", "nl", "it", "pt"}
    if target_language in latin_targets and (has_deva or has_arab or has_cjk):
        return True
    if target_language == "hi" and not has_deva:
        # Hindi should contain Devanagari; if it doesn't, transcript is likely off.
        return True

    # Low letter ratio often indicates garbage punctuation / fragments
    letters = len(re.findall(r"[^\W\d_]", t, flags=re.UNICODE))
    if letters / max(1, len(t)) < 0.55:
        return True

    # Too many mixed separators / fragments
    if len(re.findall(r"[/\\|_]+", t)) >= 2:
        return True

    return False

async def infer_intended_user_utterance(
    transcript: str,
    target_language: str,
    session: dict,
) -> dict:
    """
    Context-aware, confidence-safe intent inference for noisy STT.

    Returns dict:
      - interpreted: str (best-guess intended utterance; may equal transcript)
      - needs_clarification: bool
      - clarification: str (soft yes/no confirmation, target language)
      - visual_you_meant: Optional[str] (correct/natural phrasing to show visually only)
    """
    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    # Pull minimal context (last assistant line + topic) to bias interpretation.
    last_ai = ""
    try:
        for m in reversed(session.get("messages", [])):
            if m.get("role") == "assistant" and (m.get("content") or "").strip():
                last_ai = (m.get("content") or "").strip()
                break
    except Exception:
        last_ai = ""

    topic = session.get("topic", "random") or "random"
    topic_hint = TOPIC_CONTEXT.get(topic, TOPIC_CONTEXT["random"])

    learner_level = session.get("learner_level") or "beginner"

    try:
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intent inference engine for a speaking-first language app.\n"
                        "The user is a language learner. Their pronunciation may be inaccurate.\n"
                        "Speech transcription may contain errors.\n"
                        "Infer intent generously. Prefer meaningful interpretation over literal words.\n"
                        "Never assume the user said something strange on purpose.\n"
                        "Never mention pronunciation, 'STT', 'transcription', or mistakes.\n"
                        "If ambiguous, ask a soft yes/no confirmation (do NOT say 'I didn’t understand').\n\n"
                        f"TARGET LANGUAGE: {target_name} ({target_language}). Output must be in the target language and native script.\n"
                        f"LEARNER LEVEL (internal): {learner_level} (be extra forgiving for beginner).\n\n"
                        "Return JSON only with these keys:\n"
                        "{\"interpreted\": str, \"needs_clarification\": bool, \"clarification\": str, \"visual_you_meant\": str|null}\n\n"
                        "Rules:\n"
                        "- interpreted: best guess of what the user MEANT to say (1 sentence max).\n"
                        "- If transcript is already fine, set interpreted equal to transcript and visual_you_meant=null.\n"
                        "- If transcript looks wrong but intent is clear, set interpreted to the intended meaning.\n"
                        "- visual_you_meant: a clean, natural version of interpreted suitable for showing on screen as 'You meant:' (target language). Use null if no visual help needed.\n"
                        "- needs_clarification=true ONLY if there are 2+ plausible intents.\n"
                        "- clarification must be a short yes/no question that confirms the best guess.\n"
                        "- Never include English (unless target_language is en).\n"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "topic_hint": topic_hint,
                            "last_ai": last_ai,
                            "transcript": transcript,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            response_format={"type": "json_object"},
            max_tokens=220,
            temperature=0.0,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        interpreted = (data.get("interpreted") or "").strip()
        needs = bool(data.get("needs_clarification"))
        clarification = (data.get("clarification") or "").strip()
        visual = data.get("visual_you_meant")
        visual = (visual or "").strip() if isinstance(visual, str) else None

        # Safety fallbacks
        if not interpreted:
            interpreted = transcript.strip()
        if needs and not clarification:
            # Conservative fallback: don't block; just proceed with interpreted.
            needs = False
        # If visual is identical, suppress.
        if visual and interpreted and visual.strip() == interpreted.strip():
            # Still okay to show, but keep it minimal: show only if transcript differs.
            visual = visual.strip()
        return {
            "interpreted": interpreted,
            "needs_clarification": needs,
            "clarification": clarification,
            "visual_you_meant": visual,
        }
    except Exception as e:
        print(f"[INTENT INFER] failed: {e}")
        return {
            "interpreted": transcript.strip(),
            "needs_clarification": False,
            "clarification": "",
            "visual_you_meant": None,
        }

async def check_user_repeated_translation(user_text: str, target_language: str, expected: str) -> bool:
    """
    Gate for "translation pending" flow.
    Only return True if:
      1) The user's utterance is primarily in the target language, AND
      2) It matches the expected phrase meaning (lenient to small mistakes).
    This prevents clearing the translation when the user keeps speaking in English.
    """
    if not user_text or not expected:
        return False

    # If we deterministically detect mismatch, it cannot be a valid repeat.
    if force_translation_needed(user_text, target_language):
        return False

    # Fast deterministic accept for Latin-script targets when the user is very close to the expected phrase.
    # This prevents "stuck repeating forever" when Whisper has tiny differences.
    if target_language in {"es", "fr", "de", "nl", "it", "pt"}:
        from difflib import SequenceMatcher

        def _norm(s: str) -> str:
            s = s.lower()
            s = re.sub(r"[^a-zà-ž' ]+", " ", s, flags=re.IGNORECASE)
            s = re.sub(r"\s+", " ", s).strip()
            return s

        nu = _norm(user_text)
        ne = _norm(expected)
        if nu and ne:
            ratio = SequenceMatcher(None, nu, ne).ratio()
            # For short phrases, be more lenient
            if ratio >= (0.78 if len(ne) >= 18 else 0.70):
                return True

    # Deterministic accept for Hindi when mostly the same Devanagari string (minor Whisper noise).
    if target_language == "hi":
        from difflib import SequenceMatcher

        def _norm_hi(s: str) -> str:
            s = re.sub(r"[^\u0900-\u097F\s]", " ", s)  # keep Devanagari + spaces
            s = re.sub(r"\s+", " ", s).strip()
            return s

        nu = _norm_hi(user_text)
        ne = _norm_hi(expected)
        if nu and ne:
            ratio = SequenceMatcher(None, nu, ne).ratio()
            if ratio >= (0.80 if len(ne) >= 14 else 0.72):
                return True

    def _tokenize_latin(s: str) -> list[str]:
        # Keep unicode letters (incl accents) + apostrophes; drop punctuation.
        tokens = re.findall(r"[^\W\d_']+(?:'[^\W\d_']+)?", s.lower(), flags=re.UNICODE)
        # Drop very short tokens to reduce false positives ("a", "de", etc.)
        return [t for t in tokens if len(t) >= 3]

    # Deterministic guardrail for Latin-script target languages:
    # Require some lexical overlap with the expected target sentence.
    # This prevents clearing when the user keeps speaking English.
    if target_language in {"es", "fr", "de", "nl", "it", "pt", "en"}:
        u = set(_tokenize_latin(user_text))
        e = set(_tokenize_latin(expected))
        # If expected is too short, skip this check.
        if e:
            overlap = len(u & e)
            # For short expected phrases, require at least 1 shared content token; otherwise 2.
            min_overlap = 1 if len(e) <= 3 else 2
            if overlap < min_overlap:
                return False

    # Removed automatic English detection - rely on explicit translation requests only
    # (User can still ask "How do you say..." explicitly)

    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a strict but fair gate for a speaking practice app.\n\n"
                        f"TARGET LANGUAGE: {target_name} ({target_language})\n\n"
                        "Return JSON only: {\"in_target_language\": true/false, \"said_it\": true/false}.\n\n"
                        "Rules:\n"
                        "- in_target_language=true ONLY if the user's utterance is primarily in the target language.\n"
                        "- If target_language is not English, and the user utterance is English, in_target_language must be false.\n"
                        "- said_it=true ONLY if the user closely repeated the expected phrase (not just a related idea).\n"
                        "- Require that the user's utterance preserves the same core meaning AND includes at least two key content words from the expected phrase (or clear equivalents).\n"
                        "- If in_target_language is false, said_it must be false.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"expected": expected, "user": user_text},
                        ensure_ascii=False,
                    ),
                },
            ],
            response_format={"type": "json_object"},
            max_tokens=60,
            temperature=0.0,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        in_lang = bool(data.get("in_target_language"))
        said_it = bool(data.get("said_it"))
        return in_lang and said_it
    except Exception as e:
        print(f"[TRANSLATION ASSIST] repeat check failed: {e}")
        return False

def extract_translation_payload(transcript: str) -> str:
    """
    If the user says "How do you say ...?" we should translate ONLY the payload,
    not the wrapper phrase itself.
    Falls back to returning the original transcript if no payload can be extracted.
    """
    if not transcript:
        return transcript

    raw = transcript.strip()

    def _clean(s: str) -> str:
        s = s.strip()
        s = re.sub(r'^[\s"“”\'‘’]+', '', s)
        s = re.sub(r'[\s"“”\'‘’]+$', '', s)
        s = re.sub(r'^[\s:,-]+', '', s)
        s = re.sub(r'[\s\?\!\.]+$', '', s)
        return s.strip()

    # 1) "How do you say X" / "How do I say X"
    # Allow punctuation after "say" because Whisper often produces "How do you say: ..."
    m = re.search(r"\bhow\s+do\s+(?:you|i)\s+say\b[\s:,\-\—\–…]*([\s\S]+)$", raw, flags=re.IGNORECASE)
    if m:
        payload = m.group(1)
        # Remove trailing "in <language>" if present
        payload = re.sub(r"\s+in\s+[a-z\s\(\)]+$", "", payload, flags=re.IGNORECASE).strip()
        return _clean(payload) or raw

    # 2) "What's X in French" / "What is X in Spanish"
    m = re.search(r"\bwhat\s+(?:is|\'s)\b\s*(.+?)\s+\bin\s+[a-z\s\(\)]+$", raw, flags=re.IGNORECASE)
    if m:
        return _clean(m.group(1)) or raw

    # 3) Quoted payload anywhere: "... 'X' ..."
    m = re.search(r"[\"“”'‘’]([^\"“”'‘’]{1,200})[\"“”'‘’]", raw)
    if m:
        return _clean(m.group(1)) or raw

    return raw

async def classify_translation_request(transcript: str, target_language: str, session: dict) -> dict:
    """
    LLM-based intent + payload extraction (robust to varied phrasing).
    Returns:
      { "needs_translation": bool, "payload": str }
    Payload is what the user wants to express (without wrappers like "how do you say").
    """
    if not transcript:
        return {"needs_translation": False, "payload": ""}

    # Only trigger translation assist on explicit requests ("how do you say...", etc.)
    # Do NOT trigger just because user is speaking English - we assume they're trying to speak target language.
    # Check for explicit translation request patterns first
    has_translation_request_pattern = bool(
        re.search(r"\b(how\s+do\s+(?:you|i)\s+say|what'?s?\s+.+\s+in\s+\w+|translate)", transcript, flags=re.IGNORECASE)
    )
    if not has_translation_request_pattern:
        return {"needs_translation": False, "payload": ""}

    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    roleplay_id = session.get("roleplay_id")
    custom_scenario = session.get("custom_scenario")
    topic = session.get("topic", "random")

    context_bits = []
    if roleplay_id:
        scenario = ROLEPLAY_SCENARIOS.get(roleplay_id)
        if scenario:
            context_bits.append(f"Role-play: {scenario['name']} ({scenario['ai_role']} in a {scenario['setting']})")
    if custom_scenario:
        context_bits.append(f"Custom scenario: {custom_scenario}")
    if topic and topic != "roleplay":
        context_bits.append(f"Topic: {topic}")
    context_str = "\n".join(context_bits) if context_bits else "General conversation."

    system = (
        "You are an intent detector for a speaking practice app.\n"
        "Goal: detect when the user wants quick translation help, and extract ONLY the phrase they want to say.\n\n"
        f"TARGET LANGUAGE the user is learning: {target_name} ({target_language}).\n\n"
        "Return JSON only.\n\n"
        "Rules:\n"
        "- If the user is asking for translation help OR is clearly speaking in a different language than the target, set needs_translation=true.\n"
        "- Otherwise needs_translation=false.\n"
        "- payload must be ONLY what they want to say (e.g. 'I need an appointment'), not the wrapper.\n"
        "- Remove wrappers like: 'how do you say', 'what's X in', 'translate', 'in French', etc.\n"
        "- If there is no clear payload, set needs_translation=false.\n"
        "- Do NOT translate into the target language here. Only extract payload.\n"
    )

    async def _call(model_name: str) -> dict:
        resp = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": f"Context:\n{context_str}\n\nUser said:\n{transcript}"},
            ],
            response_format={"type": "json_object"},
            max_tokens=120,
            temperature=0.0,
        )
        return json.loads(resp.choices[0].message.content or "{}")

    try:
        # Prefer mini for cost/latency; fall back to gpt-4o for reliability.
        try:
            data = await _call("gpt-4o-mini")
        except Exception as e:
            print(f"[TRANSLATION ASSIST] classifier mini failed, falling back to gpt-4o: {e}")
            data = await _call("gpt-4o")

        needs = bool(data.get("needs_translation"))
        payload = (data.get("payload") or "").strip()

        # Safety: never let wrapper leak through as payload
        if payload and re.search(r"\bhow\s+do\s+(?:you|i)\s+say\b", payload, flags=re.IGNORECASE):
            payload = re.sub(r"^\s*how\s+do\s+(?:you|i)\s+say\b[\s:,\-\—\–…]*", "", payload, flags=re.IGNORECASE).strip()
        payload = re.sub(r"^\s*how\s+do\s+(?:you|i)\s+say\b[\s:,\-\—\–…]*", "", payload, flags=re.IGNORECASE).strip()

        if not payload:
            needs = False
        return {"needs_translation": needs, "payload": payload}
    except Exception as e:
        print(f"[TRANSLATION ASSIST] classify_translation_request failed: {e}")
        return {"needs_translation": False, "payload": ""}

async def generate_translation_assist(transcript: str, target_language: str, session: dict) -> dict:
    """
    Generate a natural spoken translation (on-screen only).
    Returns {translation, alternative?}.
    """
    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    roleplay_id = session.get("roleplay_id")
    custom_scenario = session.get("custom_scenario")
    topic = session.get("topic", "random")

    context_bits = []
    if roleplay_id:
        scenario = ROLEPLAY_SCENARIOS.get(roleplay_id)
        if scenario:
            context_bits.append(f"Role-play: {scenario['name']} ({scenario['ai_role']} in a {scenario['setting']})")
    if custom_scenario:
        context_bits.append(f"Custom scenario: {custom_scenario}")
    if topic and topic != "roleplay":
        context_bits.append(f"Topic: {topic}")
    context_str = "\n".join(context_bits) if context_bits else "General conversation."

    # Ask model for a spoken, context-aware translation (no lesson)
    resp = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": (
                    f"You generate quick 'How do you say…?' translations for a speaking app.\n"
                    f"TARGET LANGUAGE: {target_name} ({target_language})\n\n"
                    f"RULES:\n"
                    f"- Output JSON only.\n"
                    f"- Provide a natural SPOKEN translation (not literal/textbook).\n"
                    f"- Keep it short (<= 12 words for Hindi, <= 16 words otherwise).\n"
                    f"- No grammar explanations.\n"
                    f"- No word-by-word breakdown.\n"
                    f"- Optionally provide ONE alternative if it helps.\n"
                    f"- Use native script (Devanagari for Hindi, etc.).\n"
                    f"- Translate ONLY the phrase provided. Do NOT translate wrapper text like 'how do you say'.\n"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Context:\n{context_str}\n\n"
                    f"Phrase to translate (may be in another language):\n{transcript}\n\n"
                    f"Return JSON like:\n"
                    f'{{"translation":"...","alternative":"..."}}'
                ),
            },
        ],
        response_format={"type": "json_object"},
        max_tokens=180,
        temperature=0.2,
    )
    data = json.loads(resp.choices[0].message.content or "{}")
    translation = (data.get("translation") or "").strip()
    alternative = (data.get("alternative") or "").strip() if data.get("alternative") else None
    return {"translation": translation, "alternative": alternative}

async def ensure_translation_only(payload: str, target_language: str, translation: str, alternative: str | None = None) -> dict:
    """
    Hard guardrail: ensure the output is ONLY the translation of the payload,
    not meta text like "how do you say...".
    """
    if not translation or not payload or not target_language:
        return {"translation": translation, "alternative": alternative}

    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You clean translation-assist output for a speaking app.\n"
                        f"TARGET LANGUAGE: {target_name} ({target_language})\n\n"
                        f"RULES:\n"
                        f"- Output JSON only.\n"
                        f"- 'translation' MUST be ONLY the natural spoken translation of the payload.\n"
                        f"- NEVER include wrappers like 'how do you say', 'the translation is', 'in {target_name}', etc.\n"
                        f"- Keep it short and spoken.\n"
                        f"- Use native script.\n"
                        f"- Optionally keep ONE alternative.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "payload": payload,
                            "candidate_translation": translation,
                            "candidate_alternative": alternative,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            response_format={"type": "json_object"},
            max_tokens=180,
            temperature=0.0,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        cleaned_translation = (data.get("translation") or "").strip() or translation
        cleaned_alternative = (data.get("alternative") or "").strip() if data.get("alternative") else alternative
        return {"translation": cleaned_translation, "alternative": cleaned_alternative}
    except Exception as e:
        print(f"[TRANSLATION ASSIST] ensure_translation_only failed: {e}")
        return {"translation": translation, "alternative": alternative}

def translation_nudge(language: str) -> str:
    """Short spoken guidance (TTS) when translation assist is shown on-screen."""
    nudges = {
        # Keep this extremely short — it's spoken frequently during the "repeat" loop.
        "hi": "फिर से।",
        "es": "Otra vez.",
        "fr": "Encore.",
        "de": "Nochmal.",
        "nl": "Nog eens.",
        "it": "Ancora.",
        "pt": "De novo.",
        "zh": "再说一遍。",
        "ja": "もう一度。",
        "ko": "한 번 더.",
        "en": "Try again.",
    }
    return nudges.get(language, nudges["en"])

async def rewrite_into_target_language(text: str, target_language: str) -> str:
    """Rewrite text into the target language in a casual spoken style. Returns original text on failure."""
    if not text or not target_language or target_language == "en":
        return text

async def ensure_target_language(text: str, target_language: str) -> str:
    """
    Deterministic language enforcement.
    If the text is already in the target language, return it unchanged.
    Otherwise, rewrite it into the target language in the same casual spoken style.
    """
    if not text or not target_language or target_language == "en":
        return text
    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    try:
        resp = await client.chat.completions.create(
            # Use same family as main conversation to avoid “model not available” issues in production.
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a strict language enforcer.\n"
                        f"TARGET LANGUAGE: {target_name} ({target_language})\n\n"
                        f"RULES:\n"
                        f"- If the text is already entirely in {target_name}, output it EXACTLY unchanged.\n"
                        f"- If any part is not in {target_name}, rewrite the whole message into {target_name}.\n"
                        f"- Keep it short and spoken (max ~20 words).\n"
                        f"- Keep the same meaning and tone.\n"
                        f"- Ask at most ONE question.\n"
                        f"- Output ONLY the final message. No quotes. No explanations.\n"
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=140,
            temperature=0.0,
        )
        out = (resp.choices[0].message.content or "").strip()
        return out or text
    except Exception as e:
        print(f"[LANG ENFORCER] ensure_target_language failed: {e}")
        return text
    target_name = LANGUAGE_NAMES.get(target_language, "the target language")
    try:
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You rewrite assistant messages into {target_name}.\n"
                        f"RULES:\n"
                        f"- Output ONLY the rewritten message\n"
                        f"- Speak ONLY in {target_name}\n"
                        f"- Keep it short and spoken (max ~20 words)\n"
                        f"- Keep the same meaning and tone\n"
                        f"- Ask at most ONE question\n"
                        f"- Do not add explanations or meta commentary\n"
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=120,
            temperature=0.2,
        )
        out = (resp.choices[0].message.content or "").strip()
        return out or text
    except Exception as e:
        print(f"[LANG GUARD] Rewrite failed: {e}")
        return text

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
        # If the user didn't speak in the target language (translation assist case),
        # don't treat it as a "correction" card (it confuses the flow).
        if force_translation_needed(data.transcript, data.target_language):
            return {"has_correction": False}

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


@app.post("/api/translate")
async def translate_text(data: TranslateRequest):
    """
    Translate arbitrary text between languages (used for "tap to translate" on AI messages).
    Returns plain text translation.
    """
    try:
        text = (data.text or "").strip()
        if not text:
            return {"translation": ""}

        src = normalize_lang_code(data.source_language) or (data.source_language or "").strip()
        tgt = normalize_lang_code(data.target_language) or (data.target_language or "").strip() or "en"

        source_name = LANGUAGE_NAMES.get(src, src or "the source language")
        target_name = LANGUAGE_NAMES.get(tgt, tgt or "the target language")

        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You translate text for a language-learning app.\n"
                        "Rules:\n"
                        "- Output ONLY the translation text (no quotes, no extra commentary).\n"
                        "- Keep meaning faithful, but natural.\n"
                        "- If the input is already in the target language, return it unchanged.\n"
                    ),
                },
                {
                    "role": "user",
                    "content": f"Translate from {source_name} to {target_name}:\n\n{text}",
                },
            ],
            temperature=0.2,
            max_tokens=400,
        )

        translation = (resp.choices[0].message.content or "").strip()
        if translation and tgt and tgt != "en":
            translation = await ensure_target_language(translation, tgt)
        return {"translation": translation}
    except Exception as e:
        print(f"[TRANSLATE ERROR] {e}")
        return {"translation": ""}

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
                                "content": get_conversation_prompt(
                                    session["target_language"], 
                                    session.get("topic", "random"),
                                    session.get("roleplay_id"),
                                    session.get("custom_scenario")
                                )
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
                            if session["target_language"] == "hi":
                                content = enforce_hindi_female_self_reference(content)
                            full_response += content
                            await websocket.send_json({
                                "type": "response_chunk",
                                "text": content
                            })
                    
                    if session["target_language"] == "hi":
                        full_response = enforce_hindi_female_self_reference(full_response)
                    elif session["target_language"] != "en":
                        # Ensure final text is in the selected target language
                        full_response = await ensure_target_language(full_response, session["target_language"])

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

async def generate_roleplay_greeting(language: str, scenario_id: str = None, custom_scenario: str = None) -> str:
    """Generate role-play opening - AI speaks immediately in character"""
    if custom_scenario:
        # For custom scenarios, use a simple generic greeting
        # The conversation prompt will handle the in-character behavior
        print(f"[ROLEPLAY] Custom scenario: {custom_scenario[:50]}...")
        
        # Simple, natural greetings that work for any scenario
        if language == "hi":
            return "नमस्ते! कैसे मदद कर सकता हूँ?"
        elif language == "es":
            return "¡Hola! ¿En qué puedo ayudarte?"
        elif language == "fr":
            return "Bonjour! Comment puis-je vous aider?"
        elif language == "de":
            return "Hallo! Wie kann ich Ihnen helfen?"
        elif language == "nl":
            return "Hallo! Hoe kan ik je helpen?"
        elif language == "it":
            return "Ciao! Come posso aiutarti?"
        elif language == "pt":
            return "Olá! Como posso ajudar?"
        elif language == "zh":
            return "你好！我能帮你什么吗？"
        elif language == "ja":
            return "こんにちは！何かお手伝いできることはありますか？"
        elif language == "ko":
            return "안녕하세요! 어떻게 도와드릴까요?"
        else:
            return "Hello! How can I help you?"
    
    # Built-in scenario greetings (in-character, immediate)
    scenario = ROLEPLAY_SCENARIOS.get(scenario_id, ROLEPLAY_SCENARIOS["cafe_order"])
    
    # Language-specific in-character greetings
    roleplay_greetings = {
        "hi": {
            "cafe_order": ["नमस्ते! क्या लोगे?", "हाय! क्या चाहिए?", "क्या order करेंगे?"],
            "restaurant": ["नमस्ते! कितने लोग हैं?", "हाय! टेबल चाहिए?", "क्या order करेंगे?"],
            "groceries": ["नमस्ते! क्या चाहिए?", "हाय! कुछ खास?", "कैसे मदद करूँ?"],
            "neighbor": ["अरे! कैसे हो?", "हाय! क्या हाल है?", "कैसे चल रहा है?"],
            "directions": ["हाँ जी, बताइए?", "कहाँ जाना है?", "कैसे मदद करूँ?"],
            "colleague": ["हाय! कैसे हो?", "क्या चल रहा है?", "कैसा रहा दिन?"],
            "manager": ["नमस्ते। बैठिए।", "हाय! कैसे हो?", "क्या बात है?"],
            "meeting_smalltalk": ["हाय! कैसे हो?", "कैसा रहा?", "कुछ नया?"],
            "job_interview": ["नमस्ते! बैठिए।", "हाय! कैसे हो?", "चलिए शुरू करते हैं।"],
            "hr_admin": ["नमस्ते। बताइए?", "हाय! कैसे मदद करूँ?", "क्या चाहिए?"],
            "taxi": ["हाँ जी, कहाँ जाना है?", "कहाँ जाना है?", "चलिए, कहाँ?"],
            "customer_support": ["नमस्ते! कैसे मदद कर सकता हूँ?", "हाय! क्या problem है?", "बताइए, क्या हुआ?"],
            "pharmacy": ["नमस्ते! क्या चाहिए?", "हाय! कैसे मदद करूँ?", "क्या prescription है?"],
            "bank": ["नमस्ते! कैसे मदद कर सकता हूँ?", "हाय! क्या चाहिए?", "बताइए?"],
            "post_office": ["नमस्ते! क्या चाहिए?", "हाय! कैसे मदद करूँ?", "क्या send करना है?"],
            "meeting_new": ["हाय! मैं [name] हूँ।", "नमस्ते! कैसे हो?", "हाय! कैसे मिले?"],
            "friends_home": ["अरे! आ जाओ!", "हाय! कैसे हो?", "अंदर आ जाओ!"],
            "hotel_checkin": ["नमस्ते! check-in है?", "हाय! reservation है?", "कैसे मदद कर सकता हूँ?"],
            "travel_help": ["हाँ जी, बताइए?", "कैसे मदद करूँ?", "क्या problem है?"],
            "phone_call": ["हाय! कैसे हो?", "अरे! क्या हाल है?", "कैसे चल रहा है?"],
        },
        "es": {
            "cafe_order": ["¡Hola! ¿Qué te pongo?"],
            "restaurant": ["¡Hola! ¿Cuántos son?"],
            "groceries": ["¡Hola! ¿Buscas algo en particular?"],
            "neighbor": ["¡Hola! ¿Qué tal?"],
            "directions": ["¡Claro! ¿A dónde vas?"],
            "colleague": ["¡Hola! ¿Cómo va todo?"],
            "manager": ["Hola. Siéntate, por favor."],
            "meeting_smalltalk": ["¡Hola! ¿Qué tal todo?"],
            "job_interview": ["Hola, siéntate. Empezamos cuando quieras."],
            "hr_admin": ["Hola. ¿En qué puedo ayudarte?"],
            "taxi": ["Hola. ¿A dónde vamos?"],
            "customer_support": ["Hola. ¿Cuál es el problema?"],
            "pharmacy": ["Hola. ¿En qué te ayudo?"],
            "bank": ["Hola. ¿Qué necesitas hoy?"],
            "post_office": ["Hola. ¿Qué vas a enviar?"],
            "meeting_new": ["¡Hola! Encantada. ¿Cómo te llamas?"],
            "friends_home": ["¡Hola! Pasa, pasa."],
            "hotel_checkin": ["Hola. ¿Tienes una reserva?"],
            "travel_help": ["Hola. ¿Necesitas ayuda?"],
            "phone_call": ["¡Hola! ¿Qué tal?"],
        },
        "fr": {
            "cafe_order": ["Bonjour ! Je vous sers quoi ?"],
            "restaurant": ["Bonsoir ! Vous êtes combien ?"],
            "groceries": ["Bonjour ! Vous cherchez quelque chose ?"],
            "neighbor": ["Salut ! Ça va ?"],
            "directions": ["Oui ? Vous allez où ?"],
            "colleague": ["Salut ! Ça se passe comment ?"],
            "manager": ["Bonjour. Installez-vous."],
            "meeting_smalltalk": ["Salut ! Ça va ?"],
            "job_interview": ["Bonjour, installez-vous. On commence ?"],
            "hr_admin": ["Bonjour. Je peux vous aider ?"],
            "taxi": ["Bonjour ! On va où ?"],
            "customer_support": ["Bonjour. Quel est le problème ?"],
            "pharmacy": ["Bonjour. Vous cherchez quoi ?"],
            "bank": ["Bonjour. Je peux vous aider ?"],
            "post_office": ["Bonjour. Vous envoyez quoi ?"],
            "meeting_new": ["Salut ! Enchantée. Comment tu t'appelles ?"],
            "friends_home": ["Salut ! Entre !"],
            "hotel_checkin": ["Bonjour. Vous avez une réservation ?"],
            "travel_help": ["Salut ! Tu as besoin d'aide ?"],
            "phone_call": ["Salut ! Ça va ?"],
        },
        "de": {
            "cafe_order": ["Hallo! Was darf's sein?"],
            "restaurant": ["Hallo! Für wie viele Personen?"],
            "groceries": ["Hallo! Suchen Sie etwas Bestimmtes?"],
            "neighbor": ["Hi! Alles gut?"],
            "directions": ["Klar—wohin möchten Sie?"],
            "colleague": ["Hi! Wie läuft's?"],
            "manager": ["Hallo. Setzen Sie sich bitte."],
            "meeting_smalltalk": ["Hi! Wie geht's?"],
            "job_interview": ["Hallo, bitte setzen Sie sich. Wollen wir anfangen?"],
            "hr_admin": ["Hallo. Wie kann ich helfen?"],
            "taxi": ["Hallo! Wohin soll's gehen?"],
            "customer_support": ["Hallo. Worum geht's genau?"],
            "pharmacy": ["Hallo. Wie kann ich helfen?"],
            "bank": ["Hallo. Was kann ich für Sie tun?"],
            "post_office": ["Hallo. Was möchten Sie verschicken?"],
            "meeting_new": ["Hi! Freut mich. Wie heißt du?"],
            "friends_home": ["Hi! Komm rein!"],
            "hotel_checkin": ["Hallo. Haben Sie eine Reservierung?"],
            "travel_help": ["Hi! Brauchst du Hilfe?"],
            "phone_call": ["Hi! Wie geht's?"],
        },
        "nl": {
            "cafe_order": ["Hoi! Wat mag het zijn?"],
            "restaurant": ["Hoi! Met hoeveel zijn jullie?"],
            "groceries": ["Hoi! Kan ik je ergens mee helpen?"],
            "neighbor": ["Hoi! Alles goed?"],
            "directions": ["Tuurlijk—waar wil je heen?"],
            "colleague": ["Hoi! Hoe gaat het?"],
            "manager": ["Hoi. Ga even zitten."],
            "meeting_smalltalk": ["Hoi! Hoe is het?"],
            "job_interview": ["Hoi, ga zitten. Zullen we beginnen?"],
            "hr_admin": ["Hoi. Waar kan ik mee helpen?"],
            "taxi": ["Hoi! Waarheen?"],
            "customer_support": ["Hoi. Wat is het probleem?"],
            "pharmacy": ["Hoi. Waar kan ik mee helpen?"],
            "bank": ["Hoi. Wat kan ik voor je doen?"],
            "post_office": ["Hoi. Wat wil je versturen?"],
            "meeting_new": ["Hoi! Leuk je te ontmoeten. Hoe heet je?"],
            "friends_home": ["Hoi! Kom binnen!"],
            "hotel_checkin": ["Hoi. Heb je een reservering?"],
            "travel_help": ["Hoi! Heb je hulp nodig?"],
            "phone_call": ["Hoi! Hoe gaat het?"],
        },
        "it": {
            "cafe_order": ["Ciao! Cosa ti preparo?"],
            "restaurant": ["Ciao! In quanti siete?"],
            "groceries": ["Ciao! Cerchi qualcosa?"],
            "neighbor": ["Ciao! Tutto bene?"],
            "directions": ["Certo—dove devi andare?"],
            "colleague": ["Ciao! Come va?"],
            "manager": ["Ciao. Accomodati."],
            "meeting_smalltalk": ["Ciao! Come stai?"],
            "job_interview": ["Ciao, accomodati. Iniziamo?"],
            "hr_admin": ["Ciao. Come posso aiutarti?"],
            "taxi": ["Ciao! Dove andiamo?"],
            "customer_support": ["Ciao. Qual è il problema?"],
            "pharmacy": ["Ciao. Di cosa hai bisogno?"],
            "bank": ["Ciao. Come posso aiutarti?"],
            "post_office": ["Ciao. Cosa devi spedire?"],
            "meeting_new": ["Ciao! Piacere. Come ti chiami?"],
            "friends_home": ["Ciao! Entra!"],
            "hotel_checkin": ["Ciao. Hai una prenotazione?"],
            "travel_help": ["Ciao! Ti serve una mano?"],
            "phone_call": ["Ciao! Come va?"],
        },
        "pt": {
            "cafe_order": ["Olá! O que vai ser?"],
            "restaurant": ["Olá! Mesa para quantos?"],
            "groceries": ["Olá! Precisa de ajuda com algo?"],
            "neighbor": ["Oi! Tudo bem?"],
            "directions": ["Claro—pra onde você vai?"],
            "colleague": ["Oi! Como tá indo?"],
            "manager": ["Olá. Pode sentar, por favor."],
            "meeting_smalltalk": ["Oi! Tudo certo?"],
            "job_interview": ["Olá, pode sentar. Vamos começar?"],
            "hr_admin": ["Olá. Em que posso ajudar?"],
            "taxi": ["Oi! Pra onde?"],
            "customer_support": ["Olá. Qual é o problema?"],
            "pharmacy": ["Olá. Como posso ajudar?"],
            "bank": ["Olá. O que você precisa hoje?"],
            "post_office": ["Olá. O que você vai enviar?"],
            "meeting_new": ["Oi! Prazer. Como você se chama?"],
            "friends_home": ["Oi! Entra!"],
            "hotel_checkin": ["Olá. Você tem reserva?"],
            "travel_help": ["Oi! Precisa de ajuda?"],
            "phone_call": ["Oi! Tudo bem?"],
        },
        "zh": {
            "cafe_order": ["你好！想点什么？"],
            "restaurant": ["你好！几位？"],
            "groceries": ["你好！需要帮忙吗？"],
            "neighbor": ["你好！最近怎么样？"],
            "directions": ["可以，你要去哪里？"],
            "colleague": ["你好！今天怎么样？"],
            "manager": ["你好。请坐。"],
            "meeting_smalltalk": ["你好！最近忙吗？"],
            "job_interview": ["你好，请坐。我们开始吧？"],
            "hr_admin": ["你好。我能帮你什么？"],
            "taxi": ["你好！去哪里？"],
            "customer_support": ["你好。请问有什么问题？"],
            "pharmacy": ["你好。需要什么药？"],
            "bank": ["你好。要办理什么业务？"],
            "post_office": ["你好。你要寄什么？"],
            "meeting_new": ["你好！很高兴认识你。你叫什么？"],
            "friends_home": ["你好！快进来！"],
            "hotel_checkin": ["你好。你有预订吗？"],
            "travel_help": ["你好！需要帮忙吗？"],
            "phone_call": ["你好！最近怎么样？"],
        },
        "ja": {
            "cafe_order": ["こんにちは！ご注文は？"],
            "restaurant": ["こんにちは！何名様ですか？"],
            "groceries": ["こんにちは！何かお探しですか？"],
            "neighbor": ["こんにちは！元気？"],
            "directions": ["いいですよ。どこに行きたい？"],
            "colleague": ["こんにちは！調子どう？"],
            "manager": ["こんにちは。座ってください。"],
            "meeting_smalltalk": ["こんにちは！最近どう？"],
            "job_interview": ["こんにちは。どうぞ座って。始めますか？"],
            "hr_admin": ["こんにちは。ご用件は？"],
            "taxi": ["こんにちは！どちらまで？"],
            "customer_support": ["こんにちは。どうされましたか？"],
            "pharmacy": ["こんにちは。何が必要ですか？"],
            "bank": ["こんにちは。ご用件は？"],
            "post_office": ["こんにちは。何を送りますか？"],
            "meeting_new": ["こんにちは！はじめまして。お名前は？"],
            "friends_home": ["こんにちは！入って！"],
            "hotel_checkin": ["こんにちは。予約はありますか？"],
            "travel_help": ["こんにちは！大丈夫？手伝おうか？"],
            "phone_call": ["こんにちは！元気？"],
        },
        "ko": {
            "cafe_order": ["안녕하세요! 뭐 드릴까요?"],
            "restaurant": ["안녕하세요! 몇 분이세요?"],
            "groceries": ["안녕하세요! 뭐 찾으세요?"],
            "neighbor": ["안녕하세요! 잘 지냈어요?"],
            "directions": ["네, 어디로 가세요?"],
            "colleague": ["안녕하세요! 오늘 어때요?"],
            "manager": ["안녕하세요. 앉으세요."],
            "meeting_smalltalk": ["안녕하세요! 요즘 어때요?"],
            "job_interview": ["안녕하세요. 앉으세요. 시작할까요?"],
            "hr_admin": ["안녕하세요. 무엇을 도와드릴까요?"],
            "taxi": ["안녕하세요! 어디로 가요?"],
            "customer_support": ["안녕하세요. 어떤 문제가 있나요?"],
            "pharmacy": ["안녕하세요. 뭐 필요하세요?"],
            "bank": ["안녕하세요. 어떤 업무 보세요?"],
            "post_office": ["안녕하세요. 뭐 보내세요?"],
            "meeting_new": ["안녕하세요! 처음 뵙겠습니다. 이름이 뭐예요?"],
            "friends_home": ["안녕하세요! 들어와요!"],
            "hotel_checkin": ["안녕하세요. 예약하셨나요?"],
            "travel_help": ["안녕하세요! 도움 필요하세요?"],
            "phone_call": ["안녕하세요! 잘 지내요?"],
        },
        "en": {
            "cafe_order": ["Hi! What can I get you?", "Hey! What would you like?", "What can I get started for you?"],
            "restaurant": ["Hi! How many?", "Welcome! Table for how many?", "What can I get you?"],
            "groceries": ["Hi! What can I help you find?", "Hey! Need anything?", "What are you looking for?"],
            "neighbor": ["Hey! How's it going?", "Hi! What's up?", "How are you doing?"],
            "directions": ["Yes? Where are you headed?", "Where do you need to go?", "How can I help?"],
            "colleague": ["Hey! How's it going?", "Hi! What's up?", "How was your day?"],
            "manager": ["Hi! Have a seat.", "Hey! How are things?", "What's on your mind?"],
            "meeting_smalltalk": ["Hey! How's it going?", "Hi! How are you?", "What's new?"],
            "job_interview": ["Hi! Please have a seat.", "Hello! How are you?", "Let's get started."],
            "hr_admin": ["Hi! How can I help?", "Hello! What do you need?", "What can I do for you?"],
            "taxi": ["Where to?", "Where are you headed?", "Where do you need to go?"],
            "customer_support": ["Hi! How can I help you?", "Hello! What's the issue?", "How can I assist?"],
            "pharmacy": ["Hi! What can I help you with?", "Hello! Do you have a prescription?", "What do you need?"],
            "bank": ["Hi! How can I help you?", "Hello! What can I do for you?", "What do you need?"],
            "post_office": ["Hi! What can I help you with?", "Hello! What do you need to send?", "How can I help?"],
            "meeting_new": ["Hi! I'm [name].", "Hey! Nice to meet you!", "Hi! How are you?"],
            "friends_home": ["Hey! Come in!", "Hi! How are you?", "Welcome! Come on in!"],
            "hotel_checkin": ["Hi! Checking in?", "Hello! Do you have a reservation?", "Welcome! How can I help?"],
            "travel_help": ["Yes? How can I help?", "What do you need?", "What's the problem?"],
            "phone_call": ["Hey! How's it going?", "Hi! What's up?", "How are you doing?"],
        }
    }
    
    # Get greetings for this scenario and language
    lang_greetings = roleplay_greetings.get(language)
    # If we don't have a mapping for this language, fall back to a generic greeting in that language
    # (never return English for non-English target languages).
    if not lang_greetings:
        # Use the same per-language generic greeting path (non-LLM, fast).
        return await generate_roleplay_greeting(language, custom_scenario="generic")
    scenario_greetings = lang_greetings.get(scenario_id, lang_greetings.get("cafe_order", ["Hello!"]))
    
    return random.choice(scenario_greetings)

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

@app.get("/api/roleplay/scenarios")
async def get_roleplay_scenarios():
    """Get list of available role-play scenarios grouped by category"""
    categories = {
        "Daily Life": ["cafe_order", "restaurant", "groceries", "neighbor", "directions"],
        "Work & Admin": ["colleague", "manager", "meeting_smalltalk", "job_interview", "hr_admin"],
        "Services & Errands": ["taxi", "customer_support", "pharmacy", "bank", "post_office"],
        "Social & Travel": ["meeting_new", "friends_home", "hotel_checkin", "travel_help", "phone_call"],
    }
    
    scenarios_by_category = []
    for category_name, scenario_ids in categories.items():
        category_scenarios = []
        for scenario_id in scenario_ids:
            if scenario_id in ROLEPLAY_SCENARIOS:
                category_scenarios.append({
                    "id": scenario_id,
                    "name": ROLEPLAY_SCENARIOS[scenario_id]["name"]
                })
        if category_scenarios:
            scenarios_by_category.append({
                "category": category_name,
                "scenarios": category_scenarios
            })
    
    return {"categories": scenarios_by_category}

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
        "build_tag": APP_BUILD_TAG,
        "render_git_commit": os.getenv("RENDER_GIT_COMMIT"),
        "tts_provider": get_tts_provider_type(),
        "elevenlabs_key_present": bool(os.getenv("ELEVENLABS_API_KEY"))
    }

@app.get("/api/tts/status")
async def tts_status():
    """Check which TTS provider is active and test ElevenLabs if configured"""
    try:
        get_tts_provider(client)
        provider_type = get_tts_provider_type()
        elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        disable_flag = os.getenv("DISABLE_ELEVENLABS")
        
        result = {
            "provider": provider_type,
            "elevenlabs_configured": bool(elevenlabs_key and len(elevenlabs_key) > 10),
            "elevenlabs_disabled": disable_flag == "true",
            "key_preview": elevenlabs_key[:15] + "..." if elevenlabs_key else None
        }
        
        # Test ElevenLabs API if configured
        if elevenlabs_key and len(elevenlabs_key) > 10 and disable_flag != "true":
            try:
                import httpx
                async with httpx.AsyncClient() as http_client:
                    # Test by getting user info (lightweight check)
                    test_response = await http_client.get(
                        "https://api.elevenlabs.io/v1/user",
                        headers={"xi-api-key": elevenlabs_key},
                        timeout=5.0
                    )
                    if test_response.status_code == 200:
                        user_data = test_response.json()
                        result["elevenlabs_status"] = "active"
                        result["elevenlabs_subscription"] = user_data.get("subscription", {}).get("tier", "unknown")
                    elif test_response.status_code == 401:
                        result["elevenlabs_status"] = "blocked_or_invalid"
                        result["elevenlabs_error"] = "API key invalid or account blocked"
                    else:
                        result["elevenlabs_status"] = f"error_{test_response.status_code}"
            except Exception as e:
                result["elevenlabs_status"] = "test_failed"
                result["elevenlabs_error"] = str(e)[:100]
        
        return result
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

