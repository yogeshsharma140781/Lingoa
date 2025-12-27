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
            print(
                f"[RESPOND] session={data.session_id} "
                f"lang={session.get('target_language')} topic={session.get('topic')} "
                f"roleplay_id={session.get('roleplay_id')} custom={bool(session.get('custom_scenario'))}"
            )
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
    "the", "and", "you", "your", "yours",
    "i", "me", "my", "mine",
    "are", "was", "were",
    "do", "does", "did",
    "what", "how", "why", "when", "where", "who",
    "can", "could", "would", "should",
    "please", "sorry", "thanks", "thank",
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
    # For short replies (role-play), even 2 strong English tokens is enough.
    if hits >= 2:
        return True
    # For slightly longer replies, use a ratio.
    if len(tokens) >= 6 and hits / len(tokens) >= 0.25:
        return True
    return False

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

