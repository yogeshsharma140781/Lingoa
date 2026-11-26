"""
TTS Provider Abstraction Layer for Lingoa
Supports ElevenLabs (primary) and OpenAI (fallback)
"""

import os
import re
import random
import asyncio
import time
import httpx
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Awaitable, Callable, Optional, Dict, Any
from dataclasses import dataclass

# ============ Configuration ============

@dataclass
class ElevenLabsVoiceSettings:
    """Voice settings for natural conversational speech"""
    # Higher stability and lower style make the voice sound the same from one sentence to the next
    # (pitch, pace, tone). With the earlier 0.35 / 0.25 every sentence was delivered differently, which
    # a learner hears as "a different person each turn". Tune by ear: lower stability = livelier, less even.
    stability: float = 0.65          # Higher = steadier delivery
    similarity_boost: float = 0.80   # Higher = consistent identity
    style: Optional[float] = 0.10    # Lower = less exaggeration from sentence to sentence (None = not sent)
    use_speaker_boost: Optional[bool] = True   # Enhances clarity (None = not sent)

# Every language uses the same model and settings as ElevenLabs' own page for Eleven v4: stability 0.50,
# similarity 0.75, and no style or speaker boost (they are not sent). A native Chinese speaker preferred this
# over the earlier multilingual_v2 setup in a blind test.
DEFAULT_VOICE_SETTINGS = ElevenLabsVoiceSettings(
    stability=0.50,
    similarity_boost=0.75,
    style=None,
    use_speaker_boost=None,
)

# The settings used with the fallback model if v4 fails (what every language used before v4)
FALLBACK_VOICE_SETTINGS = ElevenLabsVoiceSettings(
    stability=0.65,
    similarity_boost=0.80,
    style=0.10,
    use_speaker_boost=True,
)

# Language-specific voice settings: none, all languages share DEFAULT_VOICE_SETTINGS
LANGUAGE_VOICE_SETTINGS: Dict[str, ElevenLabsVoiceSettings] = {}

# ElevenLabs model: the same for every language, with a per-language override if one is ever needed.
DEFAULT_MODEL_ID = "eleven_v4"
LANGUAGE_MODEL_ID: Dict[str, str] = {}
# If the model fails (outage, quota, not available), try this one with FALLBACK_VOICE_SETTINGS.
FALLBACK_MODEL_ID = "eleven_multilingual_v2"

# ElevenLabs Voice IDs - one dedicated voice per target language (each added to
# this account's Voice Library), replacing the single shared voice used for
# every language before. Verified against the ElevenLabs API before wiring in.
ELEVENLABS_VOICE_MAP = {
    "hi": "sTuFDs5r9KT8f6JSiJbq",  # Monika Sogam - Persuasive Outbound Caller
    "nl": "OlBRrVAItyi00MuGMbna",  # Emma - Calm, Clear and Confident
    "es": "gD1IexrzCvsXPHUuT0s3",  # Sara Martin - Young and Reflective
    "en": "56AoDkrOh6qfVPDXZ7Pt",  # Cassidy - Crisp, Direct and Clear
    "fr": "YxrwjAKoUKULGd0g8K9Y",  # Lucie - Support Agent (female, replacing Adam which was male)
    "de": "NE7AIW5DoJ7lUosXV2KR",  # Ela - Cheerful and Happy
    "it": "QITiGyM4owEZrBEf0QV8",  # Ginevra - Rich, Cheerful and Grounded
    "pt": "cyD08lEy76q03ER1jZ7y",  # Scheila - Serious and Direct
    "zh": "bhJUNIXWQQ94l8eI2VUf",  # Amy - Friendly, Young and Natural
    "ja": "8PfKHL4nZToWC3pbz9U9",  # Rose - Inviting, Clear and Steady
    "ko": "8jHHF8rMqMlg8if2mOUe",  # Han - Conversational
}

# ============ Text Pre-processing ============

def preprocess_text_for_speech(text: str, language: str) -> str:
    """
    Transform LLM output into natural spoken language.
    - Adds pauses
    - Breaks long sentences  
    - Inserts appropriate fillers
    """
    if language == "hi":
        return preprocess_hindi_for_speech(text)
    else:
        return preprocess_generic_for_speech(text, language)

def preprocess_hindi_for_speech(text: str) -> str:
    """
    Transform Hindi text for natural TTS output.
    Hindi needs more pauses and casual markers.
    """
    # Clean up extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Add pauses after sentence-ending punctuation
    text = re.sub(r'([।?!])\s*', r'\1\n\n', text)
    
    # Add pauses after common conjunctions and particles
    pause_after = ['तो', 'और', 'लेकिन', 'क्योंकि', 'फिर', 'अब']
    for word in pause_after:
        text = re.sub(rf'\b{word}\b', f'{word}...', text)
    
    # Add slight pauses after fillers (if present)
    fillers = ['अच्छा', 'हम्म', 'अरे', 'यार', 'देखो', 'सुनो']
    for filler in fillers:
        text = re.sub(rf'\b{filler}\b', f'{filler}...', text)
    
    # Break long sentences at commas
    text = re.sub(r',\s*', ',\n', text)
    
    return text.strip()

def preprocess_generic_for_speech(text: str, language: str) -> str:
    """
    Transform text for natural TTS output (non-Hindi languages).
    """
    # Clean up extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    # Add pauses after sentence-ending punctuation
    text = re.sub(r'([.?!])\s*', r'\1\n\n', text)
    
    # Add slight pauses at commas for more natural rhythm
    text = re.sub(r',\s*', ', ', text)
    
    # Language-specific filler handling
    language_fillers = {
        "es": ['Hmm', 'Pues', 'Bueno', 'A ver'],
        "fr": ['Hmm', 'Alors', 'Bon', 'Eh bien'],
        "de": ['Hmm', 'Also', 'Na ja', 'Moment'],
        "nl": ['Hmm', 'Nou', 'Ja', 'Kijk'],
        "it": ['Hmm', 'Allora', 'Dunque', 'Senti'],
        "pt": ['Hmm', 'Então', 'Bem', 'Olha'],
        "en": ['Hmm', 'Well', 'So', 'You know'],
    }
    
    fillers = language_fillers.get(language, language_fillers["en"])
    for filler in fillers:
        # Add slight pause after fillers
        text = re.sub(rf'\b{filler}\b\.\.\.', f'{filler}... ', text, flags=re.IGNORECASE)
    
    return text.strip()

def chunk_text_for_streaming(text: str, language: str) -> list[dict]:
    """
    Split text into chunks for streaming TTS.
    Smaller chunks = faster first audio.
    """
    # Pre-process first
    processed = preprocess_text_for_speech(text, language)
    
    # Split on double newlines (paragraph breaks)
    chunks = re.split(r'\n\n+', processed)
    
    # Filter empty chunks and create chunk objects
    result = []
    for chunk in chunks:
        chunk = chunk.strip()
        if chunk:
            # Calculate pause after this chunk
            pause_ms = 300 if chunk.endswith('...') else 100
            if chunk.endswith(('?', '!', '।', '.')):
                pause_ms = 400
            
            result.append({
                "text": chunk,
                "pause_after_ms": pause_ms
            })
    
    # If only one chunk or empty, return original
    if len(result) <= 1:
        return [{"text": text, "pause_after_ms": 200}]
    
    return result

# ============ TTS Provider Interface ============

class TTSProvider(ABC):
    """Abstract base class for TTS providers"""
    
    @abstractmethod
    async def generate_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> bytes:
        """Generate speech audio from text"""
        pass
    
    @abstractmethod
    async def stream_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> AsyncGenerator[bytes, None]:
        """Stream speech audio chunks"""
        pass

# ============ ElevenLabs outage: cooldown and alert ============
# When ElevenLabs refuses because the credits are used up (or the key is bad), every line would otherwise
# try it, fail, and only then fall back to OpenAI. Instead the first refusal "pauses" ElevenLabs for a few
# minutes (speech goes straight to the fallback), then the next line tries it again. The first refusal also
# calls the outage handler (main.py emails the developer), at most once an hour.

ELEVENLABS_COOLDOWN_SECONDS = int(os.getenv("ELEVENLABS_COOLDOWN_SECONDS", "300"))
OUTAGE_ALERT_INTERVAL_SECONDS = 3600


class ElevenLabsUnavailable(Exception):
    """ElevenLabs will keep refusing for a while (out of credits, or the key is bad / blocked)."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason  # "quota", "key" or "paused"


_paused_until = 0.0
_pause_reason: Optional[str] = None
_last_alert_at = 0.0
_outage_handler: Optional[Callable[[str, str], Awaitable[None]]] = None
_alert_tasks: set = set()  # keeps a reference to running alert tasks


def set_outage_handler(handler: Optional[Callable[[str, str], Awaitable[None]]]) -> None:
    """handler(reason, detail) is awaited (in the background) when ElevenLabs first goes out."""
    global _outage_handler
    _outage_handler = handler


def elevenlabs_pause_status() -> Optional[dict]:
    """None when ElevenLabs is being used; otherwise why it is paused and for how many more seconds."""
    remaining = _paused_until - time.time()
    if remaining <= 0:
        return None
    return {"reason": _pause_reason, "seconds_left": int(remaining)}


def elevenlabs_paused() -> bool:
    return elevenlabs_pause_status() is not None


def _classify_failure(status_code: int, body: str) -> Optional[str]:
    """'quota' (credits used up), 'key' (invalid or blocked key), or None (a failure worth no pause)."""
    lowered = body.lower()
    if status_code == 402 or "quota_exceeded" in lowered or "exceeds your quota" in lowered:
        return "quota"
    if status_code == 401:
        return "key"
    return None


def _trip(reason: str, detail: str) -> None:
    """Pause ElevenLabs and, the first time (and at most hourly), call the outage handler."""
    global _paused_until, _pause_reason, _last_alert_at
    now = time.time()
    already_paused = now < _paused_until
    _paused_until = now + ELEVENLABS_COOLDOWN_SECONDS
    _pause_reason = reason
    if already_paused:
        return  # several requests failing together: one pause, one alert
    print(f"[ELEVENLABS] Pausing ElevenLabs for {ELEVENLABS_COOLDOWN_SECONDS}s ({reason}): {detail[:200]}")
    if _outage_handler and now - _last_alert_at >= OUTAGE_ALERT_INTERVAL_SECONDS:
        _last_alert_at = now
        try:
            task = asyncio.get_running_loop().create_task(_outage_handler(reason, detail))
            _alert_tasks.add(task)
            task.add_done_callback(_alert_tasks.discard)
        except Exception as e:
            print(f"[ELEVENLABS] Could not start the outage alert: {e}")


def _raise_if_paused() -> None:
    status = elevenlabs_pause_status()
    if status:
        raise ElevenLabsUnavailable("paused", f"ElevenLabs paused ({status['reason']}), {status['seconds_left']}s left")


# ============ ElevenLabs Provider ============

class ElevenLabsTTSProvider(TTSProvider):
    """ElevenLabs TTS implementation with streaming support"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY")
        if not self.api_key:
            raise ValueError("ElevenLabs API key not provided")
        self.base_url = "https://api.elevenlabs.io/v1"
        self.model_id = DEFAULT_MODEL_ID
        print(f"[ELEVENLABS] Initialized with API key: {self.api_key[:10]}...{self.api_key[-4:]}")
        
    def _get_voice_id(self, language: str) -> str:
        """Get the voice ID for a language"""
        return ELEVENLABS_VOICE_MAP.get(language, ELEVENLABS_VOICE_MAP["en"])
    
    def _get_voice_settings(self, language: str) -> dict:
        """Get voice settings for a language (keys left as None are not sent)"""
        settings = LANGUAGE_VOICE_SETTINGS.get(language, DEFAULT_VOICE_SETTINGS)
        result = {
            "stability": settings.stability,
            "similarity_boost": settings.similarity_boost,
            "style": settings.style,
            "use_speaker_boost": settings.use_speaker_boost
        }
        return {k: v for k, v in result.items() if v is not None}

    def _get_model_id(self, language: str) -> str:
        """The ElevenLabs model for a language"""
        return LANGUAGE_MODEL_ID.get(language, self.model_id)

    def _attempts(self, language: str) -> list[tuple[str, dict]]:
        """(model, voice settings) to try, in order: the language's own, then the safe fallback."""
        model = self._get_model_id(language)
        attempts = [(model, self._get_voice_settings(language))]
        if model != FALLBACK_MODEL_ID:
            fallback = FALLBACK_VOICE_SETTINGS
            attempts.append((FALLBACK_MODEL_ID, {
                "stability": fallback.stability,
                "similarity_boost": fallback.similarity_boost,
                "style": fallback.style,
                "use_speaker_boost": fallback.use_speaker_boost,
            }))
        return attempts
    
    async def _generate_once(self, text: str, voice_id: str, model_id: str, voice_settings: dict) -> bytes:
        """One ElevenLabs request with one model. Raises on any failure."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                },
                json={
                    "text": text,
                    "model_id": model_id,
                    "voice_settings": voice_settings
                },
                timeout=30.0
            )

            if response.status_code != 200:
                error_text = response.text[:500] if hasattr(response, 'text') else str(response.content[:500])
                print(f"[ELEVENLABS ERROR] Model {model_id}, status {response.status_code}: {error_text}")

                reason = _classify_failure(response.status_code, error_text)
                if reason == "quota":
                    _trip(reason, f"Status {response.status_code}: {error_text}")
                    raise ElevenLabsUnavailable(reason, f"ElevenLabs credits used up. Status {response.status_code}: {error_text}")
                if reason == "key":
                    _trip(reason, f"Status {response.status_code}: {error_text}")
                    raise ElevenLabsUnavailable(reason, f"ElevenLabs account blocked or invalid API key. Status {response.status_code}: {error_text}")

                raise Exception(f"ElevenLabs API error: {response.status_code} - {error_text}")

            if not response.content or len(response.content) == 0:
                raise Exception("ElevenLabs returned empty audio")

            print(f"[ELEVENLABS] Generated {len(response.content)} bytes of audio with {model_id}")
            return response.content

    async def generate_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> bytes:
        """Generate speech using ElevenLabs (the language's own model, then the fallback model)"""
        _raise_if_paused()
        # Pre-process text for natural speech
        processed_text = preprocess_text_for_speech(text, language)
        voice_id = self._get_voice_id(language)

        attempts = self._attempts(language)
        for index, (model_id, voice_settings) in enumerate(attempts):
            try:
                return await self._generate_once(processed_text, voice_id, model_id, voice_settings)
            except Exception as e:
                is_last = index == len(attempts) - 1
                # Used-up credits or a bad key fail with the other model too.
                if is_last or isinstance(e, ElevenLabsUnavailable):
                    raise
                print(f"[ELEVENLABS] {model_id} failed for {language}, falling back to {attempts[index + 1][0]}")
        raise Exception("ElevenLabs: no model attempted")  # unreachable: attempts is never empty

    async def stream_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> AsyncGenerator[bytes, None]:
        """Stream speech using ElevenLabs streaming API"""
        _raise_if_paused()
        # Pre-process text for natural speech
        processed_text = preprocess_text_for_speech(text, language)
        voice_id = self._get_voice_id(language)

        attempts = self._attempts(language)
        for index, (model_id, voice_settings) in enumerate(attempts):
            started = False  # once audio has been sent on, a retry would repeat the start of the line
            try:
                async with httpx.AsyncClient() as client:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/text-to-speech/{voice_id}/stream",
                        headers={
                            "xi-api-key": self.api_key,
                            "Content-Type": "application/json",
                            "Accept": "audio/mpeg"
                        },
                        json={
                            "text": processed_text,
                            "model_id": model_id,
                            "voice_settings": voice_settings,
                            "optimize_streaming_latency": 3  # Maximum optimization
                        },
                        timeout=60.0
                    ) as response:
                        if response.status_code != 200:
                            error_text = await response.aread()
                            reason = _classify_failure(response.status_code, error_text.decode("utf-8", "replace"))
                            if reason:
                                _trip(reason, f"Status {response.status_code}: {error_text[:300]!r}")
                                raise ElevenLabsUnavailable(reason, f"ElevenLabs streaming refused ({reason}). Status {response.status_code}")
                            raise Exception(f"ElevenLabs streaming error: {response.status_code} - {error_text}")

                        async for chunk in response.aiter_bytes(chunk_size=4096):
                            if chunk:
                                started = True
                                yield chunk
                return
            except Exception as e:
                if started or index == len(attempts) - 1 or isinstance(e, ElevenLabsUnavailable):
                    raise
                print(f"[ELEVENLABS] {model_id} stream failed for {language} ({e}), falling back to {attempts[index + 1][0]}")
    
    async def generate_filler(self, language: str) -> tuple[str, bytes]:
        """Generate a thinking filler audio"""
        fillers = {
            "hi": ["हम्म...", "अच्छा...", "देखो...", "सुनो...", "तो..."],
            "es": ["Hmm...", "A ver...", "Pues...", "Bueno..."],
            "fr": ["Hmm...", "Alors...", "Bon...", "Voyons..."],
            "de": ["Hmm...", "Also...", "Na ja...", "Moment..."],
            "nl": ["Hmm...", "Nou...", "Even denken...", "Kijk..."],
            "en": ["Hmm...", "Well...", "Let me think...", "So..."],
        }
        
        filler_options = fillers.get(language, fillers["en"])
        filler_text = random.choice(filler_options)
        
        audio = await self.generate_speech(filler_text, language)
        return filler_text, audio

# ============ OpenAI Fallback Provider ============

class OpenAITTSProvider(TTSProvider):
    """OpenAI TTS as fallback"""
    
    def __init__(self, client):
        self.client = client
        self.voice_map = {
            "hi": "nova",
            "es": "nova",
            "fr": "nova",
            "de": "nova",
            "nl": "nova",
            "en": "nova",   # keep the female persona (echo is a male voice)
            "default": "nova"
        }
    
    async def generate_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> bytes:
        """Generate speech using OpenAI"""
        voice = self.voice_map.get(language, self.voice_map["default"])
        
        response = await self.client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text,
            speed=speed,
            response_format="mp3"
        )
        
        return response.content
    
    async def stream_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> AsyncGenerator[bytes, None]:
        """OpenAI doesn't support true streaming, return full audio"""
        audio = await self.generate_speech(text, language, speed)
        yield audio

# ============ Provider Factory ============

_tts_provider: Optional[TTSProvider] = None
_provider_type: str = "none"

def get_tts_provider(openai_client=None) -> TTSProvider:
    """Get the configured TTS provider (singleton)"""
    global _tts_provider, _provider_type
    
    if _tts_provider is None:
        elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        
        print(f"[TTS INIT] ELEVENLABS_API_KEY present: {bool(elevenlabs_key)}")
        if elevenlabs_key:
            print(f"[TTS INIT] Key starts with: {elevenlabs_key[:10]}...")
        
        if elevenlabs_key and len(elevenlabs_key) > 10:
            print("[TTS] ✅ Using ElevenLabs provider")
            _tts_provider = ElevenLabsTTSProvider(elevenlabs_key)
            _provider_type = "elevenlabs"
        elif openai_client:
            print("[TTS] ⚠️ Using OpenAI provider (fallback - no ElevenLabs key)")
            _tts_provider = OpenAITTSProvider(openai_client)
            _provider_type = "openai"
        else:
            raise ValueError("No TTS provider configured. Set ELEVENLABS_API_KEY or provide OpenAI client.")
    
    return _tts_provider

def get_tts_provider_type() -> str:
    """Get the current TTS provider type"""
    return _provider_type

def reset_tts_provider():
    """Reset the TTS provider (for testing or re-initialization)"""
    global _tts_provider, _provider_type
    _tts_provider = None
    _provider_type = "none"

