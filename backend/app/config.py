from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class Settings:
    data_root: Path = field(default_factory=lambda: Path(os.getenv("DATA_ROOT", "./data")).resolve())
    pair_chunk_size: int = int(os.getenv("PAIR_CHUNK_SIZE", "5000"))
    knn_k: int = int(os.getenv("KNN_K", "4"))
    enable_mutual_knn: bool = os.getenv("ENABLE_MUTUAL_KNN", "true").lower() == "true"
    min_similarity_floor: float = float(os.getenv("MIN_SIMILARITY_FLOOR", "0.28"))
    neighbor_percentile: float = float(os.getenv("NEIGHBOR_PERCENTILE", "0.60"))
    cluster_method: str = os.getenv("CLUSTER_METHOD", "hdbscan_precomputed")
    hdbscan_min_cluster_size: int = int(os.getenv("HDBSCAN_MIN_CLUSTER_SIZE", "0"))
    hdbscan_min_samples: int = int(os.getenv("HDBSCAN_MIN_SAMPLES", "0"))
    hdbscan_cluster_selection_epsilon: float = float(os.getenv("HDBSCAN_CLUSTER_SELECTION_EPSILON", "0.03"))
    hdbscan_cluster_selection_method: str = os.getenv("HDBSCAN_CLUSTER_SELECTION_METHOD", "eom")
    hdbscan_alpha: float = float(os.getenv("HDBSCAN_ALPHA", "1.0"))
    hdbscan_single_cluster_similarity: float = float(os.getenv("HDBSCAN_SINGLE_CLUSTER_SIMILARITY", "0.82"))
    cors_origins: list[str] = field(
        default_factory=lambda: [
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
            if origin.strip()
        ]
    )


settings = Settings()
settings.data_root.mkdir(parents=True, exist_ok=True)
(settings.data_root / "index").mkdir(parents=True, exist_ok=True)
