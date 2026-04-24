from __future__ import annotations

from typing import Literal

from .features import DISPLAY_SPACE_KEYS

ENGINE1 = "engine1"
ENGINE2 = "engine2"
ENGINE3 = "engine3"
ENGINE_KEYS = (ENGINE1, ENGINE2, ENGINE3)
EngineKey = Literal["engine1", "engine2", "engine3"]

ENGINE_LABELS: dict[str, str] = {
    ENGINE1: "Engine 1 · Feature Extraction",
    ENGINE2: "Engine 2 · Ollama Embeddings",
    ENGINE3: "Engine 3 · Supervised Learning",
}

ENGINE_SPACES: dict[str, tuple[str, ...]] = {
    ENGINE1: tuple(DISPLAY_SPACE_KEYS),
    ENGINE2: ("embedding",),
    ENGINE3: ("supervised",),
}


def normalize_engine(value: str | None) -> str:
    engine = (value or ENGINE1).strip().lower()
    if engine not in ENGINE_KEYS:
        allowed = ", ".join(ENGINE_KEYS)
        raise ValueError(f"Unbekannte Engine '{value}'. Erlaubt sind: {allowed}.")
    return engine


def spaces_for_engine(engine: str) -> tuple[str, ...]:
    return ENGINE_SPACES[normalize_engine(engine)]
