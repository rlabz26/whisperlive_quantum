from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openai import OpenAI
import logging
import uvicorn


# ============================================================
# Docker Model Runner
# ============================================================

MODEL_RUNNER_BASE_URL = (
    "http://localhost:12434/engines/v1"
)

MODEL = (
    "huggingface.co/"
    "qvac/translatepsy-afrislm-0.8b-q8-gguf"
)

client = OpenAI(
    base_url=MODEL_RUNNER_BASE_URL,
    api_key="not-needed",
)


# ============================================================
# FastAPI
# ============================================================

app = FastAPI(
    title="WhisperLive Real-Time Translation API"
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
# Request / response models
# ============================================================

class TranslationRequest(BaseModel):
    text: str = Field(min_length=1)
    source_lang: str = "English"
    target_lang: str = "Swahili"


class TranslationResponse(BaseModel):
    translation: str
    source_text: str
    source_lang: str
    target_lang: str


# ============================================================
# Translation
# ============================================================

def translate(
    source_text: str,
    source_lang: str,
    target_lang: str,
) -> str:
    source_text = source_text.strip()

    if not source_text:
        return ""

    messages = [
        {
            "role": "system",
            "content": (
                f"You are a professional {source_lang} to "
                f"{target_lang} translator. "

                f"Translate the input accurately while preserving "
                f"meaning, tone, names, numbers, and important details. "

                f"Use natural {target_lang} grammar, vocabulary, "
                f"and punctuation. "

                f"Do not explain the translation. "
                f"Do not add commentary. "
                f"Produce ONLY the {target_lang} translation."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Translate the following {source_lang} text into "
                f"{target_lang}:\n\n"
                f"{source_text}"
            ),
        },
    ]

    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.0,
        max_tokens=256,
    )

    content = response.choices[0].message.content

    if content is None:
        return ""

    return content.strip()


# ============================================================
# HTTP endpoints
# ============================================================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL,
        "model_runner": MODEL_RUNNER_BASE_URL,
    }


@app.post(
    "/translate",
    response_model=TranslationResponse,
)
def translate_endpoint(
    request: TranslationRequest,
):
    try:
        result = translate(
            source_text=request.text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
        )

        return TranslationResponse(
            translation=result,
            source_text=request.text,
            source_lang=request.source_lang,
            target_lang=request.target_lang,
        )

    except Exception as exc:
        logging.exception(
            "Translation request failed"
        )

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )


# ============================================================
# Main
# ============================================================

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO
    )

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8001,
    )
