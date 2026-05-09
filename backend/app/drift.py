from __future__ import annotations

import heapq
import math
import shutil
from collections import Counter, defaultdict
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile

import numpy as np
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.decomposition import PCA

from .config import settings
from .embedding_models import normalize_embedding_model, profile_for_model
from .engine2_embeddings import OllamaEmbeddingClient, _embedding_document_text, _normalize_vector, _split_text, _weighted_average_vectors
from .ingestion import BundleError, SubmissionArchiveError, ingest_submission_archive, is_relevant_java_file, should_ignore_entry
from .normalization import ast_like_normalized
from .storage import storage
from .utils import atomic_write_bytes, atomic_write_json, new_id, now_iso, read_json, sha256_bytes, slugify

YEAR_SHAPES = ["circle", "square", "triangle", "diamond", "star", "x", "plus", "pentagon"]
DRIFT_SCHEMA_VERSION = 2
DRIFT_ARTIFACTS = {
    "overview": "overview.json",
    "projection": "projection.json",
    "clusters": "clusters.json",
    "year_stats": "year_stats.json",
    "year_similarity_matrix": "year_similarity_matrix.json",
    "neighbors": "neighbors.json",
}


def drift_root() -> Path:
    path = settings.data_root / "out" / "drift"
    path.mkdir(parents=True, exist_ok=True)
    return path


def assignment_dir_for_key(assignment_key: str) -> Path:
    path = drift_root() / "assignments" / slugify(assignment_key)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_assignment_key(assignment_key: str) -> str:
    value = slugify(assignment_key)
    if not value:
        raise ValueError("assignmentKey darf nicht leer sein.")
    return value


def list_drift_assignments() -> list[dict[str, Any]]:
    assignments_root = drift_root() / "assignments"
    if not assignments_root.exists():
        return []
    rows = []
    for meta_path in assignments_root.glob("*/assignment.json"):
        meta = read_json(meta_path, default={}) or {}
        if meta:
            rows.append(meta)
    return sorted(rows, key=lambda item: item.get("updatedAt") or item.get("createdAt") or "", reverse=True)


def _bundle_list_path(root: Path) -> Path:
    return root / "bundles.json"


def _bundle_manifest_path(root: Path, bundle_id: str) -> Path:
    return root / "bundles" / bundle_id / "manifest.json"


def _public_bundle_payload(payload: dict[str, Any], root: Path | None = None) -> dict[str, Any]:
    item = dict(payload)
    manifest = read_json(_bundle_manifest_path(root, item["bundleId"]), default=None) if root else None
    if manifest:
        item["manifest"] = manifest
    return item


def list_drift_bundles(assignment_key: str) -> list[dict[str, Any]]:
    assignment_key = _safe_assignment_key(assignment_key)
    root = assignment_dir_for_key(assignment_key)
    bundles = read_json(_bundle_list_path(root), default=[]) or []
    return [_public_bundle_payload(item, root) for item in sorted(bundles, key=lambda value: (value.get("year", 0), value.get("createdAt", "")))]


async def import_drift_bundle(*, assignment_key: str, year: int, filename: str | None, content: bytes) -> dict[str, Any]:
    assignment_key = _safe_assignment_key(assignment_key)
    if year < 1900 or year > 2200:
        raise ValueError("year muss ein plausibler Jahrgang sein.")

    scan = _scan_drift_bundle(content)
    root = assignment_dir_for_key(assignment_key)
    created_at = now_iso()
    assignment_meta_path = root / "assignment.json"
    assignment_meta = read_json(assignment_meta_path, default={}) or {
        "assignmentKey": assignment_key,
        "createdAt": created_at,
        "updatedAt": created_at,
        "bundleCount": 0,
        "years": [],
    }

    bundle_id = new_id("drift_bundle")
    bundle_dir = root / "bundles" / bundle_id
    bundle_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(bundle_dir / "bundle.zip", content)

    ignored_entries = scan["ignoredEntries"]
    ignored_archives = scan["ignoredArchives"]
    valid_archives = scan["validArchives"]
    manifest = {
        "bundleId": bundle_id,
        "assignmentKey": assignment_key,
        "year": int(year),
        "validSubmissionZipCount": len(valid_archives),
        "ignoredLooseFileCount": sum(1 for item in ignored_entries if item.get("kind") == "loose_file"),
        "ignoredZipWithoutJavaCount": sum(1 for item in ignored_archives if item.get("reason") == "zip_without_java"),
        "ignoredCorruptZipCount": sum(1 for item in ignored_archives if item.get("reason") == "invalid_zip"),
        "validSubmissionZips": valid_archives[:200],
        "ignoredFiles": ignored_entries[:300],
        "ignoredZips": ignored_archives[:300],
        "truncated": len(valid_archives) > 200 or len(ignored_entries) > 300 or len(ignored_archives) > 300,
        "createdAt": created_at,
    }

    payload = {
        "bundleId": bundle_id,
        "assignmentKey": assignment_key,
        "year": int(year),
        "originalFilename": filename or "bundle.zip",
        "sha256": sha256_bytes(content),
        "sizeBytes": len(content),
        "createdAt": created_at,
        "storageRoot": str(drift_root()),
        "validSubmissionZipCount": len(valid_archives),
        "ignoredLooseFileCount": manifest["ignoredLooseFileCount"],
        "ignoredZipWithoutJavaCount": manifest["ignoredZipWithoutJavaCount"],
        "ignoredCorruptZipCount": manifest["ignoredCorruptZipCount"],
        "importStatus": "ok" if valid_archives else "no_java_submissions",
    }
    atomic_write_json(bundle_dir / "bundle.json", payload)
    atomic_write_json(bundle_dir / "manifest.json", manifest)

    bundles = read_json(_bundle_list_path(root), default=[]) or []
    bundles = [item for item in bundles if item.get("bundleId") != bundle_id]
    bundles.append(payload)
    bundles.sort(key=lambda item: (item.get("year", 0), item.get("createdAt", "")))
    atomic_write_json(_bundle_list_path(root), bundles)
    _invalidate_drift_runs(root)
    _update_assignment_meta(root=root, assignment_key=assignment_key, created_at=assignment_meta.get("createdAt", created_at), updated_at=created_at)
    return _public_bundle_payload(payload, root)


def delete_drift_bundle(assignment_key: str, bundle_id: str) -> dict[str, Any]:
    assignment_key = _safe_assignment_key(assignment_key)
    root = assignment_dir_for_key(assignment_key)
    bundles = read_json(_bundle_list_path(root), default=[]) or []
    target = next((item for item in bundles if item.get("bundleId") == bundle_id), None)
    if not target:
        raise FileNotFoundError("Drift-Bundle nicht gefunden.")

    bundles = [item for item in bundles if item.get("bundleId") != bundle_id]
    atomic_write_json(_bundle_list_path(root), bundles)
    shutil.rmtree(root / "bundles" / bundle_id, ignore_errors=True)

    submissions_root = root / "submissions"
    if submissions_root.exists():
        for submission_json in submissions_root.glob("*/submission.json"):
            meta = read_json(submission_json, default={}) or {}
            if meta.get("drift_bundle_id") == bundle_id:
                shutil.rmtree(submission_json.parent, ignore_errors=True)

    _invalidate_drift_runs(root)

    _update_assignment_meta(root=root, assignment_key=assignment_key, updated_at=now_iso())
    return {"deleted": True, "bundleId": bundle_id, "assignmentKey": assignment_key, "remainingBundleCount": len(bundles)}


def _invalidate_drift_runs(root: Path) -> None:
    shutil.rmtree(root / "runs", ignore_errors=True)
    latest_path = root / "latest_run.json"
    if latest_path.exists():
        latest_path.unlink()


def _update_assignment_meta(*, root: Path, assignment_key: str, updated_at: str, created_at: str | None = None) -> None:
    assignment_meta_path = root / "assignment.json"
    previous = read_json(assignment_meta_path, default={}) or {}
    bundles = read_json(_bundle_list_path(root), default=[]) or []
    years = sorted({int(item.get("year")) for item in bundles if item.get("year") is not None})
    payload = {
        "assignmentKey": assignment_key,
        "createdAt": previous.get("createdAt") or created_at or updated_at,
        "updatedAt": updated_at,
        "bundleCount": len(bundles),
        "years": years,
        "validSubmissionZipCount": sum(int(item.get("validSubmissionZipCount") or 0) for item in bundles),
        "ignoredLooseFileCount": sum(int(item.get("ignoredLooseFileCount") or 0) for item in bundles),
        "ignoredZipWithoutJavaCount": sum(int(item.get("ignoredZipWithoutJavaCount") or 0) for item in bundles),
        "storageRoot": str(drift_root()),
    }
    atomic_write_json(assignment_meta_path, payload)


def _scan_drift_bundle(bundle_bytes: bytes) -> dict[str, Any]:
    try:
        with ZipFile(BytesIO(bundle_bytes)) as bundle_zip:
            valid_archives: list[dict[str, Any]] = []
            ignored_entries: list[dict[str, Any]] = []
            ignored_archives: list[dict[str, Any]] = []
            for info in bundle_zip.infolist():
                if info.is_dir():
                    continue
                path = PurePosixPath(info.filename)
                if should_ignore_entry(path):
                    continue
                suffix = path.suffix.lower()
                if suffix != ".zip":
                    ignored_entries.append({
                        "path": info.filename,
                        "filename": path.name,
                        "kind": "loose_file",
                        "reason": "loose_java_file" if suffix == ".java" else "not_a_submission_zip",
                        "sizeBytes": int(info.file_size),
                    })
                    continue
                archive_bytes = bundle_zip.read(info.filename)
                java_count = _count_relevant_java_files_in_zip(archive_bytes)
                if java_count <= 0:
                    ignored_archives.append({
                        "path": info.filename,
                        "filename": path.name,
                        "kind": "submission_zip",
                        "reason": "invalid_zip" if java_count < 0 else "zip_without_java",
                        "javaFileCount": max(0, java_count),
                        "sizeBytes": int(info.file_size),
                    })
                    continue
                valid_archives.append({
                    "path": info.filename,
                    "filename": path.name,
                    "submissionName": path.stem,
                    "javaFileCount": java_count,
                    "sizeBytes": int(info.file_size),
                })
    except BadZipFile as exc:
        raise BundleError("Bundle ZIP ist beschädigt oder kein gültiges ZIP.") from exc
    return {"validArchives": valid_archives, "ignoredEntries": ignored_entries, "ignoredArchives": ignored_archives}


def _extract_valid_drift_submission_archives(bundle_bytes: bytes) -> list[tuple[str, bytes, str, str]]:
    try:
        with ZipFile(BytesIO(bundle_bytes)) as bundle_zip:
            rows: list[tuple[str, bytes, str, str]] = []
            for info in bundle_zip.infolist():
                if info.is_dir():
                    continue
                path = PurePosixPath(info.filename)
                if should_ignore_entry(path) or path.suffix.lower() != ".zip":
                    continue
                archive_bytes = bundle_zip.read(info.filename)
                if _count_relevant_java_files_in_zip(archive_bytes) <= 0:
                    continue
                rows.append((path.stem, archive_bytes, path.name, info.filename))
    except BadZipFile as exc:
        raise BundleError("Bundle ZIP ist beschädigt oder kein gültiges ZIP.") from exc
    return rows


def _count_relevant_java_files_in_zip(archive_bytes: bytes) -> int:
    try:
        with ZipFile(BytesIO(archive_bytes)) as submission_zip:
            return sum(
                1
                for info in submission_zip.infolist()
                if not info.is_dir() and is_relevant_java_file(PurePosixPath(info.filename))
            )
    except BadZipFile:
        return -1


def create_drift_run(assignment_key: str, embedding_model: str | None = None, top_k: int | None = None) -> dict[str, Any]:
    assignment_key = _safe_assignment_key(assignment_key)
    root = assignment_dir_for_key(assignment_key)
    bundles = read_json(root / "bundles.json", default=[]) or []
    if not bundles:
        raise FileNotFoundError("Für diesen assignmentKey sind noch keine Drift-Bundles importiert.")
    if not any(int(item.get("validSubmissionZipCount") or 0) > 0 for item in bundles):
        raise FileNotFoundError("Für diesen assignmentKey gibt es noch keine Submission-ZIPs mit .java-Dateien.")
    model = normalize_embedding_model(embedding_model or settings.ollama_embed_model)
    run_id = new_id("drift_run")
    run_dir = root / "runs" / run_id
    created_at = now_iso()
    run_payload = {
        "runId": run_id,
        "assignmentKey": assignment_key,
        "status": "queued",
        "embeddingModel": model,
        "embeddingModelProfile": profile_for_model(model),
        "topK": int(top_k or max(settings.knn_k, 6)),
        "createdAt": created_at,
        "startedAt": None,
        "finishedAt": None,
        "pipelineStatus": {
            "ingestion": "pending",
            "embeddings": "pending",
            "projection": "pending",
            "cluster": "pending",
            "yearStats": "pending",
            "neighbors": "pending",
            "artifacts": "pending",
        },
    }
    atomic_write_json(run_dir / "run.json", run_payload)
    return run_payload


def process_drift_run(assignment_key: str, run_id: str) -> None:
    assignment_key = _safe_assignment_key(assignment_key)
    root = assignment_dir_for_key(assignment_key)
    run_dir = root / "runs" / run_id
    run_path = run_dir / "run.json"
    run_payload = read_json(run_path)
    if not run_payload:
        raise FileNotFoundError("Drift-Run nicht gefunden.")

    run_payload["status"] = "running"
    run_payload["startedAt"] = now_iso()
    atomic_write_json(run_path, run_payload)

    try:
        run_payload["pipelineStatus"]["ingestion"] = "running"
        atomic_write_json(run_path, run_payload)
        submission_results = _load_or_ingest_drift_submissions(root=root, assignment_key=assignment_key)
        run_payload["pipelineStatus"]["ingestion"] = "done"
        run_payload["pipelineStatus"]["embeddings"] = "running"
        atomic_write_json(run_path, run_payload)

        vectors, vector_rows, embedding_meta = _build_drift_vectors(
            root=root,
            run_dir=run_dir,
            assignment_key=assignment_key,
            submission_results=submission_results,
            embedding_model=run_payload.get("embeddingModel"),
        )
        run_payload["pipelineStatus"]["embeddings"] = "done"
        run_payload["pipelineStatus"]["projection"] = "running"
        atomic_write_json(run_path, run_payload)

        projection_xy = _project_vectors(vectors)
        run_payload["pipelineStatus"]["projection"] = "done"
        run_payload["pipelineStatus"]["cluster"] = "running"
        atomic_write_json(run_path, run_payload)

        labels = _cluster_vectors(vectors)
        cluster_ids = _cluster_id_map(labels)
        outlier_scores = _outlier_scores(vectors, labels)
        run_payload["pipelineStatus"]["cluster"] = "done"
        run_payload["pipelineStatus"]["yearStats"] = "running"
        atomic_write_json(run_path, run_payload)

        artifacts = _build_artifacts(
            assignment_key=assignment_key,
            run_id=run_id,
            run_dir=run_dir,
            submission_results=submission_results,
            vector_rows=vector_rows,
            vectors=vectors,
            projection_xy=projection_xy,
            labels=labels,
            cluster_ids=cluster_ids,
            outlier_scores=outlier_scores,
            embedding_meta=embedding_meta,
            top_k=int(run_payload.get("topK") or 6),
        )
        run_payload["pipelineStatus"]["yearStats"] = "done"
        run_payload["pipelineStatus"]["neighbors"] = "done"
        run_payload["pipelineStatus"]["artifacts"] = "running"
        atomic_write_json(run_path, run_payload)

        for key, filename in DRIFT_ARTIFACTS.items():
            atomic_write_json(run_dir / filename, artifacts[key])
        atomic_write_json(run_dir / "vectors.json", {"assignmentKey": assignment_key, "runId": run_id, "items": vector_rows})

        latest_payload = {"assignmentKey": assignment_key, "runId": run_id, "publishedAt": now_iso()}
        atomic_write_json(root / "latest_run.json", latest_payload)
        run_payload["status"] = "published"
        run_payload["finishedAt"] = now_iso()
        run_payload["pipelineStatus"]["artifacts"] = "done"
        atomic_write_json(run_path, run_payload)
    except Exception as exc:  # pragma: no cover
        run_payload["status"] = "failed"
        run_payload["finishedAt"] = now_iso()
        run_payload["error"] = str(exc)
        atomic_write_json(run_path, run_payload)
        atomic_write_json(run_dir / "errors.json", {"message": str(exc)})


def latest_drift_run(assignment_key: str | None = None) -> dict[str, Any]:
    if assignment_key:
        root = assignment_dir_for_key(_safe_assignment_key(assignment_key))
        latest = read_json(root / "latest_run.json", default=None)
        if latest:
            run = read_json(root / "runs" / latest["runId"] / "run.json", default=None)
            if run:
                return run
        run_files = sorted((root / "runs").glob("*/run.json"), key=lambda path: path.stat().st_mtime, reverse=True) if (root / "runs").exists() else []
        if run_files:
            return read_json(run_files[0])
        raise FileNotFoundError("Kein Drift-Run für diesen assignmentKey vorhanden.")

    candidates = sorted((drift_root() / "assignments").glob("*/latest_run.json"), key=lambda path: path.stat().st_mtime, reverse=True) if (drift_root() / "assignments").exists() else []
    for latest_path in candidates:
        latest = read_json(latest_path, default=None)
        if latest:
            run = read_json(latest_path.parent / "runs" / latest["runId"] / "run.json", default=None)
            if run:
                return run
    raise FileNotFoundError("Noch kein Drift-Run vorhanden.")


def drift_run_artifacts(run_id: str) -> dict[str, Any]:
    run_dir = _find_drift_run_dir(run_id)
    run = read_json(run_dir / "run.json", default={}) or {}
    artifacts = {key: read_json(run_dir / filename, default=None) for key, filename in DRIFT_ARTIFACTS.items()}
    missing = [key for key, payload in artifacts.items() if payload is None and key != "neighbors"]
    if missing:
        raise FileNotFoundError(f"Drift-Artefakte fehlen: {', '.join(missing)}")
    return {"run": run, **artifacts}


def _find_drift_run_dir(run_id: str) -> Path:
    assignments_root = drift_root() / "assignments"
    if not assignments_root.exists():
        raise FileNotFoundError("Drift-Run nicht gefunden.")
    for path in assignments_root.glob(f"*/runs/{run_id}/run.json"):
        return path.parent
    raise FileNotFoundError("Drift-Run nicht gefunden.")


def _load_or_ingest_drift_submissions(*, root: Path, assignment_key: str) -> list[dict[str, Any]]:
    bundles = read_json(root / "bundles.json", default=[]) or []
    if not bundles:
        raise BundleError("Keine Drift-Bundles vorhanden.")
    submissions_root = root / "submissions"
    submissions_root.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    for bundle in bundles:
        bundle_dir = root / "bundles" / bundle["bundleId"]
        bundle_bytes = (bundle_dir / "bundle.zip").read_bytes()
        archives = _extract_valid_drift_submission_archives(bundle_bytes)
        for index, (submission_name, archive_bytes, archive_filename, archive_path) in enumerate(archives, start=1):
            archive_hash = sha256_bytes(archive_bytes)
            base_id = f"sub_{int(bundle['year'])}_{archive_hash[:12]}"
            submission_id = base_id
            if (submissions_root / submission_id / "submission.json").exists():
                existing = read_json(submissions_root / submission_id / "submission.json", default={}) or {}
                if existing.get("source_zip_sha256") != archive_hash or existing.get("drift_bundle_id") != bundle["bundleId"]:
                    submission_id = f"{base_id}_{index}"
            submission_dir = submissions_root / submission_id
            submission_json = submission_dir / "submission.json"

            if submission_json.exists():
                submission_meta = read_json(submission_json)
                file_records = _read_file_records(submission_dir)
                file_feature_details = _read_file_feature_details(submission_dir)
            else:
                submission_dir.mkdir(parents=True, exist_ok=True)
                try:
                    result = ingest_submission_archive(
                        assignment_id=f"drift_{assignment_key}",
                        submission_id=submission_id,
                        submission_name=submission_name,
                        archive_filename=archive_filename,
                        archive_bytes=archive_bytes,
                        submission_dir=submission_dir,
                        extract_features=False,
                    )
                    submission_meta = result.submission_meta
                    file_records = result.file_records
                    file_feature_details = result.file_feature_details
                except SubmissionArchiveError as exc:
                    submission_meta = {
                        "submission_id": submission_id,
                        "assignment_id": f"drift_{assignment_key}",
                        "submission_name": submission_name,
                        "source_zip_filename": archive_filename,
                        "source_zip_sha256": archive_hash,
                        "ingestion_status": "error",
                        "created_at": now_iso(),
                        "error": str(exc),
                        "stats": {"relevant_java_file_count": 0, "ignored_entry_count": 0, "parseable_file_count": 0, "empty_submission": True},
                    }
                    atomic_write_json(submission_json, submission_meta)
                    file_records = []
                    file_feature_details = []
                submission_meta.update(
                    {
                        "assignmentKey": assignment_key,
                        "year": int(bundle["year"]),
                        "drift_bundle_id": bundle["bundleId"],
                        "bundle_filename": bundle.get("originalFilename"),
                        "bundle_archive_path": archive_path,
                    }
                )
                atomic_write_json(submission_json, submission_meta)

            submission_meta.update(
                {
                    "assignmentKey": assignment_key,
                    "year": int(bundle["year"]),
                    "drift_bundle_id": bundle["bundleId"],
                    "bundle_filename": bundle.get("originalFilename"),
                    "bundle_archive_path": archive_path,
                }
            )
            atomic_write_json(submission_json, submission_meta)
            results.append(
                {
                    "submission": submission_meta,
                    "files": file_records,
                    "feature_sets": [],
                    "file_feature_details": file_feature_details,
                    "submission_dir": str(submission_dir),
                }
            )
    if not results:
        raise BundleError("Keine Submission-ZIPs mit .java-Dateien vorhanden.")
    return results


def _read_file_records(submission_dir: Path) -> list[dict[str, Any]]:
    rows = []
    for file_json in sorted((submission_dir / "files").glob("*/file.json")):
        item = read_json(file_json, default=None)
        if item:
            rows.append(item)
    return rows


def _read_file_feature_details(submission_dir: Path) -> list[dict[str, Any]]:
    rows = []
    for features_json in sorted((submission_dir / "files").glob("*/features.json")):
        item = read_json(features_json, default=None)
        if item:
            rows.append(item)
    return rows


def _build_drift_vectors(
    *,
    root: Path,
    run_dir: Path,
    assignment_key: str,
    submission_results: list[dict[str, Any]],
    embedding_model: str | None,
) -> tuple[np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    client = OllamaEmbeddingClient(model=embedding_model)
    rows: list[dict[str, Any]] = []
    vectors: list[np.ndarray] = []
    for result in submission_results:
        submission = result["submission"]
        submission_dir = Path(result["submission_dir"])
        chunks = _normalized_submission_chunks(result=result, submission_dir=submission_dir)
        if chunks:
            chunk_vectors = [_cached_embed(client, chunk["text"]) for chunk in chunks]
            vector = _weighted_average_vectors(chunk_vectors, [chunk["weight"] for chunk in chunks])
        else:
            vector = np.zeros(1, dtype=float)
        vector = _normalize_vector(vector)
        vectors.append(vector)
        rows.append(
            {
                "assignmentKey": assignment_key,
                "year": int(submission.get("year")),
                "submissionId": submission["submission_id"],
                "submissionName": submission.get("submission_name", submission["submission_id"]),
                "vector": [round(float(value), 8) for value in vector.tolist()],
                "embeddingModel": client.model,
                "embeddingDimension": int(vector.shape[0]),
                "chunkCount": len(chunks),
            }
        )

    matrix = _pad_vectors(vectors)
    embedding_meta = {
        "model": client.model,
        "modelProfile": client.model_profile,
        "baseUrl": client.base_url,
        "dimension": int(matrix.shape[1]) if matrix.ndim == 2 else 0,
        "cache": "chunk_sha256_by_model",
    }
    atomic_write_json(run_dir / "embedding_meta.json", embedding_meta)
    return matrix, rows, embedding_meta


def _normalized_submission_chunks(*, result: dict[str, Any], submission_dir: Path) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for record in result.get("files", []):
        raw_path = submission_dir / "files" / record["file_id"] / "raw.java"
        if not raw_path.exists():
            continue
        raw = raw_path.read_text(encoding="utf-8", errors="replace")
        normalized = ast_like_normalized(raw)
        if not normalized.strip():
            normalized = raw
        for index, text in enumerate(_split_text(normalized, settings.embedding_chunk_chars), start=1):
            if not text.strip():
                continue
            relative_path = f"{record.get('relative_path', record.get('basename', 'File.java'))}#{index}"
            chunks.append(
                {
                    "relative_path": relative_path,
                    "text": _embedding_document_text(relative_path, text),
                    "weight": max(1.0, math.sqrt(len(text))),
                }
            )
    return chunks[: settings.embedding_max_chunks_per_submission]


def _cached_embed(client: OllamaEmbeddingClient, text: str) -> np.ndarray:
    model_slug = slugify(client.model)
    key = sha256_bytes(f"{client.model}\n{text}".encode("utf-8"))
    cache_path = settings.data_root / "embedding-cache" / model_slug / f"{key}.json"
    cached = read_json(cache_path, default=None)
    if cached and isinstance(cached.get("vector"), list):
        return np.asarray(cached["vector"], dtype=float)
    vector = client.embed_one(text)
    atomic_write_json(
        cache_path,
        {
            "model": client.model,
            "modelProfile": client.model_profile,
            "textSha256": sha256_bytes(text.encode("utf-8")),
            "dimension": int(vector.shape[0]),
            "vector": [float(value) for value in vector.tolist()],
            "createdAt": now_iso(),
        },
    )
    return vector


def _pad_vectors(vectors: list[np.ndarray]) -> np.ndarray:
    if not vectors:
        return np.zeros((0, 0), dtype=float)
    max_dim = max(int(vector.shape[0]) for vector in vectors)
    matrix = np.zeros((len(vectors), max_dim), dtype=float)
    for index, vector in enumerate(vectors):
        matrix[index, : int(vector.shape[0])] = vector
    return matrix


def _project_vectors(vectors: np.ndarray) -> np.ndarray:
    n = vectors.shape[0]
    if n == 0:
        return np.zeros((0, 2), dtype=float)
    if n == 1 or vectors.shape[1] == 0:
        return np.zeros((n, 2), dtype=float)
    if vectors.shape[1] == 1:
        x = vectors[:, 0]
        return np.column_stack([x, np.zeros(n)])
    components = min(2, n, vectors.shape[1])
    coords = PCA(n_components=components, random_state=42).fit_transform(vectors)
    if coords.shape[1] == 1:
        coords = np.column_stack([coords[:, 0], np.zeros(n)])
    return coords.astype(float)


def _cluster_vectors(vectors: np.ndarray) -> np.ndarray:
    n = vectors.shape[0]
    if n == 0:
        return np.asarray([], dtype=int)
    if n <= 3:
        return np.zeros(n, dtype=int)

    fallback = _kmeans_labels(vectors)
    min_cluster_size = max(4, settings.hdbscan_min_cluster_size or int(round(math.sqrt(n))))
    min_cluster_size = min(min_cluster_size, max(2, n // 2))
    min_samples = max(1, settings.hdbscan_min_samples or min_cluster_size // 2)

    try:
        labels = HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples, metric="euclidean").fit_predict(vectors).astype(int)
    except Exception:
        return fallback

    clustered_count = sum(1 for label in labels if int(label) >= 0)
    noise_count = n - clustered_count
    noise_fraction = noise_count / max(1, n)
    non_noise = sorted({int(label) for label in labels if int(label) >= 0})

    # Für History Drift derselben Aufgabe sind HDBSCAN-Noise-Punkte keine eigene
    # semantische Klasse. Wenn der Noise-Anteil hoch ist, verwenden wir robuste
    # KMeans-Lösungsmuster. Wenn er niedrig ist, ordnen wir Noise-Punkte dem
    # nächsten vorhandenen Muster zu und lassen die Randlage über outlierScore laufen.
    if len(non_noise) >= 2 and clustered_count >= max(3, int(round(n * 0.72))) and noise_fraction <= 0.28:
        return _assign_noise_to_nearest_cluster(vectors, labels)
    if len(non_noise) == 1 and noise_fraction <= 0.12:
        return _assign_noise_to_nearest_cluster(vectors, labels)
    return fallback


def _kmeans_labels(vectors: np.ndarray) -> np.ndarray:
    n = vectors.shape[0]
    if n == 0:
        return np.asarray([], dtype=int)
    if n <= 3:
        return np.zeros(n, dtype=int)
    cluster_count = min(max(2, int(round(math.sqrt(n) / 2))), min(6, n))
    try:
        return KMeans(n_clusters=cluster_count, random_state=42, n_init=10).fit_predict(vectors).astype(int)
    except Exception:
        return np.zeros(n, dtype=int)


def _assign_noise_to_nearest_cluster(vectors: np.ndarray, labels: np.ndarray) -> np.ndarray:
    result = labels.astype(int).copy()
    positive = sorted({int(label) for label in result if int(label) >= 0})
    if not positive:
        return _kmeans_labels(vectors)
    centroids: dict[int, np.ndarray] = {}
    for label in positive:
        indexes = np.where(result == label)[0]
        centroid = vectors[indexes].mean(axis=0)
        centroids[label] = _normalize_vector(centroid)
    for index, label in enumerate(result):
        if int(label) >= 0:
            continue
        result[index] = max(positive, key=lambda candidate: _safe_cosine(vectors[index], centroids[candidate]))
    return result


def _cluster_id_map(labels: np.ndarray) -> dict[int, str]:
    positive = sorted({int(label) for label in labels if int(label) >= 0})
    mapping = {label: f"cluster_{index:02d}" for index, label in enumerate(positive, start=1)}
    mapping[-1] = "unclustered"
    return mapping


def _outlier_scores(vectors: np.ndarray, labels: np.ndarray) -> np.ndarray:
    n = vectors.shape[0]
    if n == 0:
        return np.asarray([], dtype=float)

    distances = np.zeros(n, dtype=float)
    for label in sorted({int(value) for value in labels}):
        indexes = np.where(labels == label)[0]
        if len(indexes) == 0:
            continue
        if int(label) < 0:
            distances[indexes] = 1.0
            continue
        centroid = _normalize_vector(vectors[indexes].mean(axis=0))
        distances[indexes] = np.asarray([max(0.0, 1.0 - _safe_cosine(vectors[index], centroid)) for index in indexes], dtype=float)

    if not distances.size or float(distances.max()) <= 1e-12:
        return np.zeros(n, dtype=float)

    lower = float(np.percentile(distances, 50))
    upper = float(np.percentile(distances, 95))
    if upper <= lower + 1e-12:
        upper = float(distances.max())
    if upper <= lower + 1e-12:
        return np.zeros(n, dtype=float)
    return np.clip((distances - lower) / (upper - lower), 0.0, 1.0)


def _build_artifacts(
    *,
    assignment_key: str,
    run_id: str,
    run_dir: Path,
    submission_results: list[dict[str, Any]],
    vector_rows: list[dict[str, Any]],
    vectors: np.ndarray,
    projection_xy: np.ndarray,
    labels: np.ndarray,
    cluster_ids: dict[int, str],
    outlier_scores: np.ndarray,
    embedding_meta: dict[str, Any],
    top_k: int,
) -> dict[str, Any]:
    years = sorted({int(row["year"]) for row in vector_rows})
    year_shape = {year: YEAR_SHAPES[index % len(YEAR_SHAPES)] for index, year in enumerate(years)}
    submission_by_id = {result["submission"]["submission_id"]: result["submission"] for result in submission_results}

    points = []
    for index, row in enumerate(vector_rows):
        submission_id = row["submissionId"]
        cluster_id = cluster_ids.get(int(labels[index]), "unclustered")
        points.append(
            {
                "submissionId": submission_id,
                "x": round(float(projection_xy[index, 0]), 6),
                "y": round(float(projection_xy[index, 1]), 6),
                "year": int(row["year"]),
                "clusterId": cluster_id,
                "shapeKey": year_shape[int(row["year"])],
                "label": submission_by_id.get(submission_id, {}).get("submission_name", submission_id),
                "outlierScore": round(float(outlier_scores[index]), 6),
            }
        )

    neighbors = _top_k_neighbors(vectors=vectors, rows=vector_rows, labels=labels, cluster_ids=cluster_ids, top_k=top_k)
    clusters = _cluster_artifacts(points=points, vectors=vectors, labels=labels, cluster_ids=cluster_ids, years=years)
    year_stats = _year_stats(points=points, vectors=vectors, labels=labels, cluster_ids=cluster_ids, years=years)
    similarity_matrix = _year_similarity_matrix(vectors=vectors, rows=vector_rows, years=years)
    outlier_count = sum(1 for point in points if float(point.get("outlierScore", 0.0)) >= 0.9)

    overview = {
        "assignmentKey": assignment_key,
        "runId": run_id,
        "includedYears": years,
        "totalSubmissions": len(points),
        "submissionsPerYear": {str(year): sum(1 for row in vector_rows if int(row["year"]) == year) for year in years},
        "clusterCount": sum(1 for cluster in clusters["clusters"] if cluster["clusterId"] != "unclustered"),
        "outlierCount": outlier_count,
        "embeddingModel": embedding_meta.get("model"),
        "embeddingDimension": embedding_meta.get("dimension"),
        "createdAt": now_iso(),
        "driftSchemaVersion": DRIFT_SCHEMA_VERSION,
        "outlierDefinition": "points_with_outlierScore_at_least_0.9",
    }
    projection = {"assignmentKey": assignment_key, "runId": run_id, "points": points, "yearShapes": {str(k): v for k, v in year_shape.items()}}
    return {
        "overview": overview,
        "projection": projection,
        "clusters": clusters,
        "year_stats": year_stats,
        "year_similarity_matrix": similarity_matrix,
        "neighbors": neighbors,
    }


def _top_k_neighbors(*, vectors: np.ndarray, rows: list[dict[str, Any]], labels: np.ndarray, cluster_ids: dict[int, str], top_k: int) -> dict[str, Any]:
    n = vectors.shape[0]
    heaps: list[list[tuple[float, int]]] = [[] for _ in range(n)]
    block_size = 256
    for start in range(0, n, block_size):
        end = min(n, start + block_size)
        sims = vectors[start:end] @ vectors.T if vectors.size else np.zeros((end - start, n), dtype=float)
        for offset, row_sims in enumerate(sims):
            index = start + offset
            row_sims[index] = -np.inf
            if n <= 1:
                continue
            candidate_count = min(n - 1, max(top_k * 3, top_k))
            candidate_indexes = np.argpartition(row_sims, -candidate_count)[-candidate_count:]
            for candidate in candidate_indexes:
                score = float(row_sims[candidate])
                if not math.isfinite(score):
                    continue
                _heap_push(heaps[index], (score, int(candidate)), top_k)
    items = []
    for index, row in enumerate(rows):
        ordered = sorted(heaps[index], key=lambda item: item[0], reverse=True)
        items.append(
            {
                "submissionId": row["submissionId"],
                "neighbors": [
                    {
                        "submissionId": rows[candidate]["submissionId"],
                        "similarity": round(float(score), 6),
                        "year": int(rows[candidate]["year"]),
                        "clusterId": cluster_ids.get(int(labels[candidate]), "unclustered"),
                    }
                    for score, candidate in ordered
                ],
            }
        )
    return {"metric": "cosine_similarity", "topK": top_k, "items": items}


def _heap_push(heap: list[tuple[float, int]], item: tuple[float, int], limit: int) -> None:
    if len(heap) < limit:
        heapq.heappush(heap, item)
    elif item[0] > heap[0][0]:
        heapq.heapreplace(heap, item)


def _cluster_artifacts(*, points: list[dict[str, Any]], vectors: np.ndarray, labels: np.ndarray, cluster_ids: dict[int, str], years: list[int]) -> dict[str, Any]:
    rows = []
    for label in sorted({int(value) for value in labels}, key=lambda value: (value < 0, value)):
        cluster_id = cluster_ids.get(label, "unclustered")
        indexes = [index for index, value in enumerate(labels) if int(value) == label]
        cluster_points = [points[index] for index in indexes]
        distribution = Counter(int(point["year"]) for point in cluster_points)
        dominant_year = max(distribution.items(), key=lambda item: (item[1], item[0]))[0] if distribution else None
        centroid_x = sum(float(point["x"]) for point in cluster_points) / max(1, len(cluster_points))
        centroid_y = sum(float(point["y"]) for point in cluster_points) / max(1, len(cluster_points))
        counts = [distribution.get(year, 0) for year in years]
        first_seen = next((year for year in years if distribution.get(year, 0) > 0), None)
        last_year = years[-1] if years else None
        peak_count = max(counts) if counts else 0
        last_count = distribution.get(last_year, 0) if last_year is not None else 0
        rows.append(
            {
                "clusterId": cluster_id,
                "size": len(cluster_points),
                "dominantYear": dominant_year,
                "yearDistribution": {str(year): distribution.get(year, 0) for year in years},
                "centroidX": round(float(centroid_x), 6),
                "centroidY": round(float(centroid_y), 6),
                "isNewCluster": bool(first_seen is not None and years and first_seen > years[0]),
                "isDecliningCluster": bool(peak_count > 0 and last_count <= max(0, peak_count // 3) and last_year != first_seen),
                "exemplarSubmissions": [point["submissionId"] for point in cluster_points[:3]],
            }
        )
    return {"clusters": sorted(rows, key=lambda row: (row["clusterId"] == "unclustered", -row["size"], row["clusterId"]))}


def _year_stats(*, points: list[dict[str, Any]], vectors: np.ndarray, labels: np.ndarray, cluster_ids: dict[int, str], years: list[int]) -> dict[str, Any]:
    rows = []
    cluster_id_values = sorted({cluster_ids.get(int(label), "unclustered") for label in labels})
    for year in years:
        year_points = [point for point in points if int(point["year"]) == year]
        cluster_distribution = Counter(point["clusterId"] for point in year_points)
        centroid_x = sum(float(point["x"]) for point in year_points) / max(1, len(year_points))
        centroid_y = sum(float(point["y"]) for point in year_points) / max(1, len(year_points))
        rows.append(
            {
                "year": year,
                "submissionCount": len(year_points),
                "centroidX": round(float(centroid_x), 6),
                "centroidY": round(float(centroid_y), 6),
                "clusterDistribution": {cluster_id: cluster_distribution.get(cluster_id, 0) for cluster_id in cluster_id_values},
                "outlierCount": sum(1 for point in year_points if float(point.get("outlierScore", 0.0)) >= 0.9),
            }
        )
    return {"years": rows}


def _year_similarity_matrix(*, vectors: np.ndarray, rows: list[dict[str, Any]], years: list[int]) -> dict[str, Any]:
    centroids: dict[int, np.ndarray] = {}
    for year in years:
        indexes = [index for index, row in enumerate(rows) if int(row["year"]) == year]
        if indexes:
            centroid = vectors[indexes].mean(axis=0)
            centroids[year] = _normalize_vector(centroid)
    matrix = []
    for left_year in years:
        row = []
        for right_year in years:
            similarity = _safe_cosine(centroids.get(left_year), centroids.get(right_year))
            row.append(round(float(similarity), 6))
        matrix.append(row)
    return {"years": years, "matrix": matrix, "metric": "cosine_similarity_between_year_centroids"}


def _safe_cosine(left: np.ndarray | None, right: np.ndarray | None) -> float:
    if left is None or right is None or left.shape[0] != right.shape[0]:
        return 0.0
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 1e-12:
        return 0.0
    value = float(np.dot(left, right) / denominator)
    return max(-1.0, min(1.0, value))
