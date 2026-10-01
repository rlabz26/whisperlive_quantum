import io
import logging
import os
from pathlib import Path
from threading import Lock

import torch
import torchaudio as ta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from chatterbox.mtl_tts import ChatterboxMultilingualTTS


# ============================================================
# Configuration
# ============================================================

HOST = os.getenv("TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("TTS_PORT", "8002"))

# Automatically use CUDA when available.
# Override with:
#   TTS_DEVICE=cuda
#   TTS_DEVICE=cpu
DEVICE = os.getenv(
    "TTS_DEVICE",
    "cuda" if torch.cuda.is_available() else "cpu",
)

# Optional voice reference.
#
# If set, Chatterbox will use this WAV file as the reference voice.
# Example:
#   TTS_VOICE=/absolute/path/to/voice.wav
#
VOICE_REFERENCE = os.getenv("TTS_VOICE", "").strip()

# Limit text sent to the TTS engine.
MAX_TEXT_LENGTH = int(os.getenv("TTS_MAX_TEXT_LENGTH", "2000"))


# ============================================================
# Logging
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

logger = logging.getLogger("chatterbox-tts")


# ============================================================
# Language mapping
# ============================================================

LANGUAGE_CODES = {
    "English": "en",
    "Swahili": "sw",
    "French": "fr",
    "German": "de",
    "Spanish": "es",
    "Portuguese": "pt",
    "Arabic": "ar",
    "Chinese": "zh",
    "Hindi": "hi",
    "Italian": "it",
    "Japanese": "ja",
    "Korean": "ko",
    "Polish": "pl",
    "Russian": "ru",
    "Turkish": "tr",
    "Dutch": "nl",
    "Danish": "da",
    "Greek": "el",
    "Finnish": "fi",
    "Hebrew": "he",
    "Malay": "ms",
    "Norwegian": "no",
    "Swedish": "sv",
}


# ============================================================
# FastAPI
# ============================================================

app = FastAPI(
    title="Local Chatterbox TTS",
    description="Local ResembleAI Chatterbox Multilingual V3 TTS server",
    version="1.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Request model
# ============================================================

class SynthesisRequest(BaseModel):
    text: str = Field(
        min_length=1,
        max_length=MAX_TEXT_LENGTH,
    )

    # Examples:
    # "English"
    # "Swahili"
    # "French"
    language: str = "Swahili"

    # Optional Chatterbox controls.
    exaggeration: float = Field(
        default=0.5,
        ge=0.0,
        le=1.5,
    )

    cfg: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
    )


# ============================================================
# Model loading
# ============================================================

logger.info("Starting local Chatterbox TTS server")
logger.info("Device: %s", DEVICE)

if DEVICE == "cuda" and not torch.cuda.is_available():
    raise RuntimeError(
        "TTS_DEVICE=cuda was requested, but CUDA is not available."
    )


logger.info("Loading Chatterbox Multilingual V3...")

tts_model = ChatterboxMultilingualTTS.from_pretrained(
    device=DEVICE,
    t3_model="v3",
)

logger.info("Chatterbox Multilingual V3 loaded successfully.")

if VOICE_REFERENCE:
    voice_path = Path(VOICE_REFERENCE)

    if not voice_path.exists():
        raise FileNotFoundError(
            f"TTS_VOICE was specified but does not exist: {voice_path}"
        )

    logger.info(
        "Voice reference enabled: %s",
        voice_path,
    )


# Chatterbox is a neural model and should not receive concurrent
# generation requests on the same model instance.
generation_lock = Lock()


# ============================================================
# Helpers
# ============================================================

def resolve_language(language: str) -> str:
    """
    Convert frontend language names to Chatterbox language IDs.

    Examples:
        Swahili -> sw
        English -> en
        French  -> fr
    """

    value = language.strip()

    if not value:
        raise HTTPException(
            status_code=400,
            detail="Language is required.",
        )

    # Frontend sends names such as "Swahili".
    if value in LANGUAGE_CODES:
        return LANGUAGE_CODES[value]

    # Also allow direct language IDs such as "sw".
    value_lower = value.lower()

    supported_codes = set(LANGUAGE_CODES.values())

    if value_lower in supported_codes:
        return value_lower

    raise HTTPException(
        status_code=400,
        detail=(
            f"Unsupported language '{language}'. "
            f"Supported languages: "
            f"{', '.join(LANGUAGE_CODES.keys())}"
        ),
    )


def generate_audio(
    text: str,
    language_id: str,
    exaggeration: float,
    cfg: float,
):
    """
    Generate WAV audio with Chatterbox.
    """

    kwargs = {
        "language_id": language_id,
        "exaggeration": exaggeration,
        "cfg_weight": cfg,
    }

    if VOICE_REFERENCE:
        kwargs["audio_prompt_path"] = VOICE_REFERENCE

    with generation_lock:
        with torch.inference_mode():
            wav = tts_model.generate(
                text,
                **kwargs,
            )

    return wav


def wav_to_bytes(wav) -> bytes:
    """
    Convert Chatterbox's waveform tensor into an in-memory WAV file.
    """

    if wav.dim() == 1:
        wav = wav.unsqueeze(0)

    wav = wav.detach().cpu()

    buffer = io.BytesIO()

    ta.save(
        buffer,
        wav,
        tts_model.sr,
        format="wav",
    )

    return buffer.getvalue()


# ============================================================
# Routes
# ============================================================

@app.get("/")
def root():
    return {
        "service": "local-chatterbox-tts",
        "model": "ResembleAI/chatterbox",
        "variant": "multilingual-v3",
        "device": DEVICE,
        "sample_rate": tts_model.sr,
        "voice_reference": bool(VOICE_REFERENCE),
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "ResembleAI/chatterbox",
        "variant": "multilingual-v3",
        "device": DEVICE,
        "sample_rate": tts_model.sr,
        "voice_reference": bool(VOICE_REFERENCE),
    }


@app.get("/languages")
def languages():
    return {
        "languages": LANGUAGE_CODES,
    }


@app.post("/synthesize")
def synthesize(request: SynthesisRequest):
    text = request.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty.",
        )

    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Text is too long. "
                f"Maximum length is {MAX_TEXT_LENGTH} characters."
            ),
        )

    language_id = resolve_language(request.language)

    logger.info(
        "TTS request: language=%s (%s), chars=%d",
        request.language,
        language_id,
        len(text),
    )

    try:
        wav = generate_audio(
            text=text,
            language_id=language_id,
            exaggeration=request.exaggeration,
            cfg=request.cfg,
        )

        audio_bytes = wav_to_bytes(wav)

        logger.info(
            "Generated %.2f seconds of audio",
            wav.shape[-1] / tts_model.sr,
        )

        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "X-TTS-Model": "chatterbox-multilingual-v3",
                "X-TTS-Language": language_id,
            },
        )

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception("TTS generation failed")

        raise HTTPException(
            status_code=500,
            detail=f"TTS generation failed: {exc}",
        ) from exc


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
    )