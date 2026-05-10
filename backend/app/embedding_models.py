from __future__ import annotations

from typing import Literal

EmbeddingModelProfile = Literal["quality", "balanced", "fast"]

EMBEDDING_MODEL_OPTIONS: dict[str, dict[str, str]] = {
    "quality": {
        "label": "Quality",
        "model": "qwen3-embedding:8b",
        "description": "Stärkste Qwen3-Embedding-Option, aber schwerer und langsamer.",
    },
    "balanced": {
        "label": "Balanced",
        "model": "qwen3-embedding:4b",
        "description": "Default für Qualität und lokale Laufbarkeit.",
    },
    "fast": {
        "label": "Fast",
        "model": "qwen3-embedding:0.6b",
        "description": "Leichteste lokale Engine2-Option.",
    },
}
DEFAULT_EMBEDDING_MODEL_PROFILE: EmbeddingModelProfile = "fast"
DEFAULT_EMBEDDING_MODEL = EMBEDDING_MODEL_OPTIONS[DEFAULT_EMBEDDING_MODEL_PROFILE]["model"]
ALLOWED_EMBEDDING_MODELS = tuple(option["model"] for option in EMBEDDING_MODEL_OPTIONS.values())


def normalize_embedding_model_profile(value: str | None) -> EmbeddingModelProfile:
    profile = (value or DEFAULT_EMBEDDING_MODEL_PROFILE).strip().lower()
    if profile not in EMBEDDING_MODEL_OPTIONS:
        allowed = ", ".join(EMBEDDING_MODEL_OPTIONS)
        raise ValueError(f"Unbekanntes Embedding-Profil '{value}'. Erlaubt sind: {allowed}.")
    return profile  # type: ignore[return-value]


def model_for_profile(profile: str | None) -> str:
    normalized = normalize_embedding_model_profile(profile)
    return EMBEDDING_MODEL_OPTIONS[normalized]["model"]


def profile_for_model(model: str | None) -> EmbeddingModelProfile:
    model_value = (model or DEFAULT_EMBEDDING_MODEL).strip()
    for profile, option in EMBEDDING_MODEL_OPTIONS.items():
        if option["model"] == model_value:
            return profile  # type: ignore[return-value]
    allowed = ", ".join(ALLOWED_EMBEDDING_MODELS)
    raise ValueError(f"Unbekanntes Embedding-Modell '{model}'. Erlaubt sind: {allowed}.")


def normalize_embedding_model(value: str | None) -> str:
    if value is None or not value.strip():
        return DEFAULT_EMBEDDING_MODEL
    model_value = value.strip()
    profile = EMBEDDING_MODEL_OPTIONS.get(model_value.lower())
    if profile:
        return profile["model"]
    # Also accept the actual Ollama model names, because this is what the frontend submits.
    profile_for_model(model_value)
    return model_value
