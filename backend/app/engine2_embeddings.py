from __future__ import annotations

import itertools
import json
import math
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np

from .analysis import build_neighbors_graphs_and_clusters
from .config import settings
from .embedding_models import normalize_embedding_model, profile_for_model
from .storage import storage
from .utils import atomic_write_json, read_json

EMBEDDING_SPACE = "embedding"


def process_embedding_engine(*, run_dir: Path, assignment_id: str, run_id: str, submission_results: list[dict[str, Any]], embedding_model: str | None = None) -> None:
    embeddings, metadata = build_embedding_representations(
        run_dir=run_dir,
        assignment_id=assignment_id,
        run_id=run_id,
        submission_results=submission_results,
        embedding_model=embedding_model,
    )
    pair_items = build_embedding_pairs(
        run_dir=run_dir,
        run_id=run_id,
        submission_results=submission_results,
        embeddings=embeddings,
        embedding_metadata=metadata,
        chunk_size=settings.pair_chunk_size,
    )
    pair_items_by_space = {EMBEDDING_SPACE: pair_items}
    build_neighbors_graphs_and_clusters(
        run_dir=run_dir,
        run_id=run_id,
        submission_results=submission_results,
        pair_items_by_space=pair_items_by_space,
        k=settings.knn_k,
    )
    materialize_embedding_read_models(
        run_dir=run_dir,
        assignment_id=assignment_id,
        run_id=run_id,
        submission_results=submission_results,
        pair_items=pair_items,
        embedding_metadata=metadata,
    )


def build_embedding_representations(
    *,
    run_dir: Path,
    assignment_id: str,
    run_id: str,
    submission_results: list[dict[str, Any]],
    embedding_model: str | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, dict[str, Any]]]:
    client = OllamaEmbeddingClient(model=embedding_model)
    embeddings: dict[str, np.ndarray] = {}
    metadata: dict[str, dict[str, Any]] = {}

    for result in submission_results:
        submission = result["submission"]
        submission_id = submission["submission_id"]
        chunks = _submission_code_chunks(assignment_id=assignment_id, result=result)
        if not chunks:
            vector = np.zeros(1, dtype=float)
            chunk_meta: list[dict[str, Any]] = []
        else:
            texts = [_embedding_document_text(chunk["relative_path"], chunk["text"]) for chunk in chunks]
            vectors = client.embed_many(texts)
            vector = _weighted_average_vectors(vectors, [chunk["weight"] for chunk in chunks])
            chunk_meta = [
                {
                    "relative_path": chunk["relative_path"],
                    "char_count": chunk["char_count"],
                    "weight": round(float(chunk["weight"]), 6),
                }
                for chunk in chunks
            ]

        vector = _normalize_vector(vector)
        embeddings[submission_id] = vector
        metadata[submission_id] = {
            "model": client.model,
            "base_url": client.base_url,
            "model_profile": client.model_profile,
            "dimension": int(vector.shape[0]),
            "chunk_count": len(chunks),
            "file_count": len(result.get("files", [])),
            "chunks": chunk_meta,
            "method": "ollama_dense_embedding_weighted_mean_v1",
        }
        atomic_write_json(
            run_dir / "representations" / EMBEDDING_SPACE / "submissions" / f"{submission_id}.json",
            {
                "run_id": run_id,
                "submission_id": submission_id,
                "space": EMBEDDING_SPACE,
                "version": "embedding-v1",
                "feature_stats": {
                    "model": client.model,
                    "dimension": int(vector.shape[0]),
                    "model_profile": client.model_profile,
                    "chunk_count": len(chunks),
                    "file_count": len(result.get("files", [])),
                    "note": "Dense Ollama-Embedding. Keine handgebauten Feature-Dimensionen.",
                },
                "top_dimensions": [],
                "comparison_dimensions": [],
                "standardized_dimensions": [],
                "metadata": metadata[submission_id],
            },
        )

    atomic_write_json(
        run_dir / "representations" / EMBEDDING_SPACE / "index.json",
        {
            "run_id": run_id,
            "space": EMBEDDING_SPACE,
            "model": client.model,
            "base_url": client.base_url,
            "model_profile": client.model_profile,
            "submission_count": len(embeddings),
            "note": "Engine2 nutzt ausschließlich dichte Ollama-Vektoren für Pairwise Similarity, Graph und Clustering.",
        },
    )
    return embeddings, metadata


def build_embedding_pairs(
    *,
    run_dir: Path,
    run_id: str,
    submission_results: list[dict[str, Any]],
    embeddings: dict[str, np.ndarray],
    embedding_metadata: dict[str, dict[str, Any]],
    chunk_size: int,
) -> list[dict[str, Any]]:
    submission_ids = [item["submission"]["submission_id"] for item in submission_results]
    items: list[dict[str, Any]] = []
    for left_id, right_id in itertools.combinations(submission_ids, 2):
        left = embeddings.get(left_id)
        right = embeddings.get(right_id)
        cosine = _cosine(left, right) if left is not None and right is not None else 0.0
        relation = max(0.0, min(1.0, cosine))
        items.append(
            {
                "submission_i": left_id,
                "submission_j": right_id,
                "relation_raw": round(relation, 6),
                "relation_cal": round(relation, 6),
                "meta": {
                    "method": "ollama_embedding_cosine_v1",
                    "model": embedding_metadata.get(left_id, {}).get("model") or embedding_metadata.get(right_id, {}).get("model"),
                    "components": {"cosine_similarity": round(cosine, 6)},
                    "normalization_profile": "l2_normalized_weighted_chunk_mean",
                    "left_embedding": {
                        "dimension": embedding_metadata.get(left_id, {}).get("dimension"),
                        "chunk_count": embedding_metadata.get(left_id, {}).get("chunk_count"),
                    },
                    "right_embedding": {
                        "dimension": embedding_metadata.get(right_id, {}).get("dimension"),
                        "chunk_count": embedding_metadata.get(right_id, {}).get("chunk_count"),
                    },
                },
            }
        )
    _write_pair_chunks(run_dir, run_id, EMBEDDING_SPACE, items, chunk_size)
    return items


def materialize_embedding_read_models(
    *,
    run_dir: Path,
    assignment_id: str,
    run_id: str,
    submission_results: list[dict[str, Any]],
    pair_items: list[dict[str, Any]],
    embedding_metadata: dict[str, dict[str, Any]],
) -> None:
    read_models_dir = run_dir / "read-models"
    graph = read_json(run_dir / "graphs" / EMBEDDING_SPACE / "graph.json", default={})
    clusters = read_json(run_dir / "clusters" / EMBEDDING_SPACE / "clusters.json", default={})
    submission_lookup = {result["submission"]["submission_id"]: result["submission"]["submission_name"] for result in submission_results}
    pair_lookup = {_pair_key(item["submission_i"], item["submission_j"]): item for item in pair_items}
    graph_edge_lookup = {_pair_key(edge["source"], edge["target"]): edge for edge in graph.get("edges", [])}

    _enrich_embedding_clusters(clusters, submission_lookup, pair_lookup)

    submissions_index = []
    for result in submission_results:
        submission = result["submission"]
        submission_id = submission["submission_id"]
        top_neighbors = [
            edge
            for edge in graph.get("edges", [])
            if edge.get("source") == submission_id or edge.get("target") == submission_id
        ]
        top_neighbors = sorted(top_neighbors, key=lambda edge: edge.get("weight", 0.0), reverse=True)[:5]
        cluster_membership = _cluster_membership_for_submission(clusters, submission_id)
        representation = read_json(run_dir / "representations" / EMBEDDING_SPACE / "submissions" / f"{submission_id}.json", default={})
        detail = {
            "assignment_id": assignment_id,
            "run_id": run_id,
            "submission": submission,
            "included_files": result.get("file_feature_details", []),
            "spaces": {
                EMBEDDING_SPACE: {
                    "representation": representation.get("feature_stats", {}),
                    "top_dimensions": [],
                    "comparison_dimensions": [],
                    "standardized_dimensions": [],
                    "top_neighbors": top_neighbors,
                    "cluster_membership": cluster_membership,
                    "cluster_diagnostics": None,
                    "explanation": _embedding_submission_explanation(submission_id, submission["submission_name"], top_neighbors, cluster_membership),
                    "graph_degree": len(top_neighbors),
                    "metadata": embedding_metadata.get(submission_id, {}),
                    "space_meta": graph.get("meta", {}),
                }
            },
        }
        submissions_index.append(
            {
                "submission_id": submission_id,
                "submission_name": submission["submission_name"],
                "status": submission["ingestion_status"],
                "detail_path": f"submissions/{submission_id}.json",
            }
        )
        atomic_write_json(read_models_dir / "submissions" / f"{submission_id}.json", detail)

    atomic_write_json(read_models_dir / "submissions" / "index.json", submissions_index)

    pairs_written = 0
    for pair in pair_items:
        left_id = pair["submission_i"]
        right_id = pair["submission_j"]
        payload = _embedding_pair_detail_payload(
            assignment_id=assignment_id,
            run_id=run_id,
            left_id=left_id,
            right_id=right_id,
            left_name=submission_lookup.get(left_id, left_id),
            right_name=submission_lookup.get(right_id, right_id),
            relation=pair,
            graph_edge=graph_edge_lookup.get(_pair_key(left_id, right_id)),
        )
        atomic_write_json(read_models_dir / "pairs" / EMBEDDING_SPACE / f"{left_id}__{right_id}.json", payload)
        pairs_written += 1

    chunk_files = sorted((run_dir / "pairs" / EMBEDDING_SPACE / "chunks").glob("*.json"))
    atomic_write_json(
        read_models_dir / "pairs" / "index.json",
        {
            "assignment_id": assignment_id,
            "run_id": run_id,
            "spaces": {EMBEDDING_SPACE: {"pair_count": pairs_written, "base_path": f"pairs/{EMBEDDING_SPACE}"}},
            "chunk_files": [path.name for path in chunk_files],
        },
    )

    ast_ok_files = sum(item["submission"].get("stats", {}).get("ast_ok_file_count", 0) for item in submission_results)
    ast_recovered_files = sum(item["submission"].get("stats", {}).get("ast_recovered_file_count", 0) for item in submission_results)
    overview = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "engine": "engine2",
        "engine_label": "Engine 2 · Ollama Embeddings",
        "submission_count": len(submission_results),
        "valid_submission_count": sum(1 for item in submission_results if item["submission"]["ingestion_status"] == "ok"),
        "ast_parse_coverage": {
            "ok_file_count": ast_ok_files,
            "recovered_file_count": ast_recovered_files,
            "total_java_files": ast_ok_files + ast_recovered_files,
        },
        "spaces": [EMBEDDING_SPACE],
        "embedding": {
            "model": next((meta.get("model") for meta in embedding_metadata.values() if meta.get("model")), settings.ollama_embed_model),
            "base_url": settings.ollama_base_url,
            "model_profile": next((meta.get("model_profile") for meta in embedding_metadata.values() if meta.get("model_profile")), None),
            "method": "weighted mean over Java file chunks + cosine similarity",
        },
        "graph_overview": {
            EMBEDDING_SPACE: {
                "nodes": len(graph.get("nodes", [])),
                "edges": len(graph.get("edges", [])),
                "clusters": len(clusters.get("clusters", [])),
                "noise": len(clusters.get("noise", [])),
                "similarity_stats": graph.get("meta", {}).get("similarity_stats", {}),
            }
        },
        "links": {
            "submissions": "submissions/index.json",
            "graphs": {EMBEDDING_SPACE: f"graphs/{EMBEDDING_SPACE}.json"},
            "clusters": {EMBEDDING_SPACE: f"clusters/{EMBEDDING_SPACE}.json"},
            "pairs": "pairs/index.json",
        },
    }
    atomic_write_json(read_models_dir / "overview.json", overview)
    atomic_write_json(read_models_dir / "graphs" / f"{EMBEDDING_SPACE}.json", graph)
    atomic_write_json(read_models_dir / "clusters" / f"{EMBEDDING_SPACE}.json", clusters)
    atomic_write_json(read_models_dir / "stability.json", {"run_id": run_id, "variants": []})
    atomic_write_json(read_models_dir / "embedding.json", {"run_id": run_id, **overview["embedding"]})


class OllamaEmbeddingClient:
    def __init__(self, model: str | None = None) -> None:
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = normalize_embedding_model(model or settings.ollama_embed_model)
        self.model_profile = profile_for_model(self.model)
        self.timeout = settings.ollama_timeout_seconds

    def embed_many(self, texts: list[str]) -> list[np.ndarray]:
        if not texts:
            return []
        try:
            response = self._post_json("/api/embed", {"model": self.model, "input": texts})
            embeddings = response.get("embeddings")
            if isinstance(embeddings, list) and len(embeddings) == len(texts):
                return [np.asarray(vector, dtype=float) for vector in embeddings]
        except RuntimeError:
            raise
        except Exception:
            # Older Ollama versions only had /api/embeddings. Fall through to one-by-one fallback.
            pass
        return [self.embed_one(text) for text in texts]

    def embed_one(self, text: str) -> np.ndarray:
        response = self._post_json("/api/embeddings", {"model": self.model, "prompt": text})
        embedding = response.get("embedding")
        if not isinstance(embedding, list):
            raise RuntimeError("Ollama hat keine Embedding-Liste zurückgegeben.")
        return np.asarray(embedding, dtype=float)

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Ollama Embedding fehlgeschlagen ({exc.code}). Model '{self.model}' vorhanden? Versuche: ollama pull {self.model}. Antwort: {body[:300]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Ollama ist unter {self.base_url} nicht erreichbar. Starte Ollama und lade das Modell mit: ollama pull {self.model}. Detail: {exc.reason}"
            ) from exc
        except TimeoutError as exc:
            raise RuntimeError(f"Ollama Embedding Timeout nach {self.timeout}s für Modell '{self.model}'.") from exc


def _submission_code_chunks(*, assignment_id: str, result: dict[str, Any]) -> list[dict[str, Any]]:
    submission_id = result["submission"]["submission_id"]
    submission_dir = storage.assignment_dir(assignment_id) / "submissions" / submission_id
    chunks: list[dict[str, Any]] = []
    for record in result.get("files", []):
        raw_path = submission_dir / "files" / record["file_id"] / "raw.java"
        if not raw_path.exists():
            continue
        source = raw_path.read_text(encoding="utf-8", errors="replace")
        for index, text in enumerate(_split_text(source, settings.embedding_chunk_chars), start=1):
            if not text.strip():
                continue
            chunks.append(
                {
                    "relative_path": f"{record.get('relative_path', record.get('basename', 'File.java'))}#{index}",
                    "text": text,
                    "char_count": len(text),
                    "weight": max(1.0, math.sqrt(len(text))),
                }
            )
    return chunks[: settings.embedding_max_chunks_per_submission]


def _split_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    lines = text.splitlines()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        line_len = len(line) + 1
        if current and current_len + line_len > max_chars:
            chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += line_len
    if current:
        chunks.append("\n".join(current))
    return chunks or [text[:max_chars]]


def _embedding_document_text(relative_path: str, source: str) -> str:
    """Return the exact semantic payload sent to the embedding model.

    Keep this intentionally minimal: the embedding vector should represent the
    submitted code, not archive layout, filenames, prompt text, markdown fences,
    or other metadata. ``relative_path`` is retained only for caller/API
    compatibility and must not be embedded.
    """
    _ = relative_path
    return source.strip()


def _weighted_average_vectors(vectors: list[np.ndarray], weights: list[float]) -> np.ndarray:
    if not vectors:
        return np.zeros(1, dtype=float)
    dimension = int(vectors[0].shape[0])
    total = np.zeros(dimension, dtype=float)
    weight_sum = 0.0
    for vector, weight in zip(vectors, weights, strict=False):
        if vector.shape[0] != dimension:
            continue
        total += vector * float(weight)
        weight_sum += float(weight)
    if weight_sum <= 0.0:
        return total
    return total / weight_sum


def _normalize_vector(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-12:
        return vector
    return vector / norm


def _cosine(left: np.ndarray, right: np.ndarray) -> float:
    if left.shape[0] != right.shape[0]:
        return 0.0
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 1e-12:
        return 0.0
    return float(np.dot(left, right) / denominator)


def _write_pair_chunks(run_dir: Path, run_id: str, space: str, items: list[dict[str, Any]], chunk_size: int) -> None:
    chunks = [items[index : index + chunk_size] for index in range(0, len(items), chunk_size)] or [[]]
    for chunk_index, chunk in enumerate(chunks, start=1):
        atomic_write_json(
            run_dir / "pairs" / space / "chunks" / f"{chunk_index:06d}.json",
            {"run_id": run_id, "space": space, "chunk_index": chunk_index, "items": chunk},
        )


def _embedding_pair_detail_payload(
    *,
    assignment_id: str,
    run_id: str,
    left_id: str,
    right_id: str,
    left_name: str,
    right_name: str,
    relation: dict[str, Any],
    graph_edge: dict[str, Any] | None,
) -> dict[str, Any]:
    meta = relation.get("meta", {})
    score = float(relation.get("relation_cal", 0.0))
    payload = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "space": EMBEDDING_SPACE,
        "submission_a": {"submission_id": left_id, "submission_name": left_name},
        "submission_b": {"submission_id": right_id, "submission_name": right_name},
        "relation_raw": relation["relation_raw"],
        "relation_cal": relation["relation_cal"],
        "method": meta.get("method", "ollama_embedding_cosine_v1"),
        "score_components": meta.get("components", {}),
        "score_weights": {},
        "calibration": {},
        "diagnostics": {
            "model": meta.get("model"),
            "left_chunk_count": meta.get("left_embedding", {}).get("chunk_count"),
            "right_chunk_count": meta.get("right_embedding", {}).get("chunk_count"),
            "dimension": meta.get("left_embedding", {}).get("dimension"),
        },
        "graph_edge": {
            "is_present": bool(graph_edge),
            "edge_type": graph_edge.get("edge_type") if graph_edge else None,
            "weight": graph_edge.get("weight") if graph_edge else None,
        },
        "top_common_signals": [
            {
                "feature": "embedding_cosine_similarity",
                "left_value": score,
                "right_value": score,
                "contribution": score,
            }
        ],
        "top_differing_signals": [],
        "explanation": {
            "summary": f"Diese Paarung erreicht im Embedding-Raum einen Cosine-Score von {score:.3f}. Das ist ein semantischer Vektorvergleich, keine Feature-Erklärung.",
            "dominant_families": ["Embedding-Nähe"],
            "agreement_profile": [
                {
                    "dimension": "embedding",
                    "label": "Dense Java-Code-Vektor",
                    "strength": score,
                    "verdict": "hoch" if score >= 0.82 else "mittel" if score >= 0.6 else "schwach",
                    "evidence": [meta.get("model", "Ollama embedding")],
                }
            ],
            "top_shared_patterns": [],
            "top_separating_patterns": [],
        },
    }
    return payload


def _enrich_embedding_clusters(clusters: dict[str, Any], submission_lookup: dict[str, str], pair_lookup: dict[str, dict[str, Any]]) -> None:
    for cluster in clusters.get("clusters", []):
        member_ids = [member["submission_id"] for member in cluster.get("members", [])]
        cluster["space"] = EMBEDDING_SPACE
        cluster["diagnostics"] = {
            "central_members": _central_members(member_ids, pair_lookup, submission_lookup),
            "strongest_internal_pairs": _pair_summaries(member_ids, pair_lookup, submission_lookup, external=False),
            "nearest_external_pairs": _pair_summaries(member_ids, pair_lookup, submission_lookup, external=True),
            "signature_features": [],
            "contrast_features": [],
            "notes": ["Engine2 kann Cluster nicht auf einzelne Feature-Dimensionen zurückführen; Grundlage ist der dichte Embedding-Vektor."],
        }


def _central_members(member_ids: list[str], pair_lookup: dict[str, dict[str, Any]], submission_lookup: dict[str, str], limit: int = 3) -> list[dict[str, Any]]:
    rows = []
    for member_id in member_ids:
        scores = [
            float(pair_lookup.get(_pair_key(member_id, other_id), {}).get("relation_cal", 0.0))
            for other_id in member_ids
            if other_id != member_id
        ]
        rows.append(
            {
                "submission_id": member_id,
                "submission_name": submission_lookup.get(member_id, member_id),
                "mean_internal_similarity": round(sum(scores) / len(scores), 6) if scores else 1.0,
            }
        )
    return sorted(rows, key=lambda item: item["mean_internal_similarity"], reverse=True)[:limit]


def _pair_summaries(member_ids: list[str], pair_lookup: dict[str, dict[str, Any]], submission_lookup: dict[str, str], *, external: bool, limit: int = 5) -> list[dict[str, Any]]:
    rows = []
    member_set = set(member_ids)
    for pair_key, pair in pair_lookup.items():
        left_id, right_id = pair_key.split("::")
        is_internal = left_id in member_set and right_id in member_set
        is_external = (left_id in member_set) ^ (right_id in member_set)
        if external and not is_external:
            continue
        if not external and not is_internal:
            continue
        rows.append(
            {
                "source": left_id,
                "source_name": submission_lookup.get(left_id, left_id),
                "target": right_id,
                "target_name": submission_lookup.get(right_id, right_id),
                "weight": round(float(pair.get("relation_cal", 0.0)), 6),
            }
        )
    return sorted(rows, key=lambda item: item["weight"], reverse=True)[:limit]


def _cluster_membership_for_submission(clusters: dict[str, Any], submission_id: str) -> dict[str, Any] | None:
    for cluster in clusters.get("clusters", []):
        for member in cluster.get("members", []):
            if member.get("submission_id") == submission_id:
                return {
                    "cluster_id": cluster.get("cluster_id"),
                    "cluster_label": cluster.get("label"),
                    "size": cluster.get("size", 0),
                    "membership_strength": member.get("membership_strength", 1.0),
                    "method": clusters.get("method"),
                    "color": cluster.get("color"),
                }
    if any(item.get("submission_id") == submission_id for item in clusters.get("noise", [])):
        return {
            "cluster_id": None,
            "cluster_label": "Noise",
            "size": 1,
            "membership_strength": 0.0,
            "method": clusters.get("method"),
            "is_noise": True,
        }
    return None


def _embedding_submission_explanation(submission_id: str, submission_name: str, top_neighbors: list[dict[str, Any]], cluster_membership: dict[str, Any] | None) -> dict[str, Any]:
    neighbor_story = [
        f"{edge.get('target') if edge.get('source') == submission_id else edge.get('source')} ({float(edge.get('weight', 0.0)):.3f})"
        for edge in top_neighbors[:3]
    ]
    if not cluster_membership:
        summary = f"Für {submission_name} liegt im Embedding-Raum noch keine stabile Einordnung vor."
    elif cluster_membership.get("is_noise"):
        summary = f"{submission_name} ist im Embedding-Raum aktuell Noise. Die Vektor-Nachbarschaft reicht nicht für ein stabiles Cluster."
    else:
        summary = f"{submission_name} liegt im Embedding-Cluster {cluster_membership.get('cluster_label')} mit {cluster_membership.get('size')} Mitgliedern."
    return {
        "summary": summary,
        "neighbor_story": neighbor_story,
        "why_here": ["Nähe im dichten Ollama-Code-Embedding"],
        "why_not_else": [],
    }


def _pair_key(left: str, right: str) -> str:
    return "::".join(sorted((left, right)))
