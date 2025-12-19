"""
TTS Provider Abstraction Layer for Lingoa
Supports ElevenLabs (primary) and OpenAI (fallback)
"""

import os
import re
import random
import httpx
from abc import ABC, abstractmethod
from typing import AsyncGenerator, Optional, Dict, Any
from dataclasses import dataclass

# ============ Configuration ============

@dataclass
class ElevenLabsVoiceSettings:
    """Voice settings for natural conversational speech"""
    stability: float = 0.35          # Lower = more natural variation (30-45%)
    similarity_boost: float = 0.75   # Higher = consistent identity (65-80%)
    style: float = 0.25              # Adds warmth without exaggeration (20-35%)
    use_speaker_boost: bool = True   # Enhances clarity

# Default settings - can be tuned per language
DEFAULT_VOICE_SETTINGS = ElevenLabsVoiceSettings()

# More expressive settings for Hindi (needs natural variation)
HINDI_VOICE_SETTINGS = ElevenLabsVoiceSettings(
    stability=0.30,           # More variation for natural Hindi
    similarity_boost=0.70,
    style=0.30,               # More warmth
    use_speaker_boost=True
)

# Language-specific voice settings
LANGUAGE_VOICE_SETTINGS: Dict[str, ElevenLabsVoiceSettings] = {
    "hi": HINDI_VOICE_SETTINGS,
    # Add more language-specific settings as needed
}

# ElevenLabs Multilingual Voice IDs
# Using known multilingual voices that support multiple languages
# These are default ElevenLabs voices that work across languages
ELEVENLABS_VOICE_MAP = {
    # Using Rachel (21m00Tcm4TlvDq8ikWAM) - warm, multilingual, conversational
    # Alternative: Bella (EXAVITQu4vr4xnSDxMaL) or Domi (AZnzlk1XvdvUeBnXmlld)
    "hi": "21m00Tcm4TlvDq8ikWAM",  # Rachel - multilingual
    "es": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "fr": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "de": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "nl": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "it": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "pt": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "zh": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "ja": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "ko": "21m00Tcm4TlvDq8ikWAM",  # Rachel
    "en": "21m00Tcm4TlvDq8ikWAM",  # Rachel
}

# Alternative voices to try if default doesn't sound good
ELEVENLABS_ALTERNATIVE_VOICES = {
    "hi": "EXAVITQu4vr4xnSDxMaL",  # Sarah - also multilingual
    "en": "21m00Tcm4TlvDq8ikWAM",  # Rachel - warm English voice
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

# ============ ElevenLabs Provider ============

class ElevenLabsTTSProvider(TTSProvider):
    """ElevenLabs TTS implementation with streaming support"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY")
        if not self.api_key:
            raise ValueError("ElevenLabs API key not provided")
        self.base_url = "https://api.elevenlabs.io/v1"
        self.model_id = "eleven_multilingual_v2"  # Best for non-English
        print(f"[ELEVENLABS] Initialized with API key: {self.api_key[:10]}...{self.api_key[-4:]}")
        
    def _get_voice_id(self, language: str) -> str:
        """Get the voice ID for a language"""
        return ELEVENLABS_VOICE_MAP.get(language, ELEVENLABS_VOICE_MAP["en"])
    
    def _get_voice_settings(self, language: str) -> dict:
        """Get voice settings for a language"""
        settings = LANGUAGE_VOICE_SETTINGS.get(language, DEFAULT_VOICE_SETTINGS)
        return {
            "stability": settings.stability,
            "similarity_boost": settings.similarity_boost,
            "style": settings.style,
            "use_speaker_boost": settings.use_speaker_boost
        }
    
    async def generate_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> bytes:
        """Generate speech using ElevenLabs"""
        # Pre-process text for natural speech
        processed_text = preprocess_text_for_speech(text, language)
        
        voice_id = self._get_voice_id(language)
        voice_settings = self._get_voice_settings(language)
        
            async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                },
                json={
                    "text": processed_text,
                    "model_id": self.model_id,
                    "voice_settings": voice_settings
                },
                timeout=30.0
            )
            
            if response.status_code != 200:
                error_text = response.text[:500] if hasattr(response, 'text') else str(response.content[:500])
                print(f"[ELEVENLABS ERROR] Status {response.status_code}: {error_text}")
                
                # If it's a 401 (unauthorized/blocked), raise a specific exception
                if response.status_code == 401:
                    raise Exception(f"ElevenLabs account blocked or invalid API key. Status {response.status_code}: {error_text}")
                
                raise Exception(f"ElevenLabs API error: {response.status_code} - {error_text}")
            
            if not response.content or len(response.content) == 0:
                raise Exception("ElevenLabs returned empty audio")
            
            print(f"[ELEVENLABS] Generated {len(response.content)} bytes of audio")
            return response.content
    
    async def stream_speech(
        self, 
        text: str, 
        language: str,
        speed: float = 1.0
    ) -> AsyncGenerator[bytes, None]:
        """Stream speech using ElevenLabs streaming API"""
        # Pre-process text for natural speech
        processed_text = preprocess_text_for_speech(text, language)
        
        voice_id = self._get_voice_id(language)
        voice_settings = self._get_voice_settings(language)
        
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
                    "model_id": self.model_id,
                    "voice_settings": voice_settings,
                    "optimize_streaming_latency": 3  # Maximum optimization
                },
                timeout=60.0
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"ElevenLabs streaming error: {response.status_code} - {error_text}")
                
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    if chunk:
                        yield chunk
    
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
            "en": "echo",
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

