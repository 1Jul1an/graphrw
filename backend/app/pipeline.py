from __future__ import annotations

import traceback
from typing import Any

from .analysis import build_neighbors_graphs_and_clusters, build_pair_chunks, build_representations
from .config import settings
from .features import DISPLAY_SPACE_KEYS
from .ingestion import BundleError, SubmissionArchiveError, extract_submission_archives, ingest_submission_archive
from .read_models import materialize_read_models
from .storage import storage
from .utils import atomic_write_json, new_id, now_iso, read_json, sha256_bytes


def create_run(assignment_id: str, upload_id: str) -> dict[str, Any]:
    run_id = new_id("run")
    run_dir = storage.run_dir(assignment_id, run_id)
    config = {
        "spaces": list(DISPLAY_SPACE_KEYS),
        "knn_k": settings.knn_k,
        "mutual_knn": settings.enable_mutual_knn,
        "pair_chunk_size": settings.pair_chunk_size,
        "cluster_method": settings.cluster_method,
        "hdbscan": {
            "min_cluster_size": settings.hdbscan_min_cluster_size,
            "min_samples": settings.hdbscan_min_samples,
            "cluster_selection_epsilon": settings.hdbscan_cluster_selection_epsilon,
            "cluster_selection_method": settings.hdbscan_cluster_selection_method,
            "alpha": settings.hdbscan_alpha,
            "single_cluster_similarity": settings.hdbscan_single_cluster_similarity,
        },
    }
    run_payload = {
        "run_id": run_id,
        "assignment_id": assignment_id,
        "upload_id": upload_id,
        "status": "queued",
        "config_version": "v4-real-ast",
        "code_version": "python-mvp-tree-sitter-ast-hdbscan",
        "started_at": None,
        "finished_at": None,
        "pipeline_status": {
            "ingestion": "pending",
            "representations": "pending",
            "pairwise": "pending",
            "fusion": "pending",
            "graph": "pending",
            "cluster": "pending",
            "read_models": "pending",
            "publish": "pending",
        },
    }
    atomic_write_json(run_dir / "run.json", run_payload)
    atomic_write_json(run_dir / "config.json", config)
    return run_payload


def process_run(assignment_id: str, run_id: str) -> None:
    run_dir = storage.run_dir(assignment_id, run_id)
    run_path = run_dir / "run.json"
    run_payload = read_json(run_path)
    assignment_dir = storage.assignment_dir(assignment_id)
    upload_dir = assignment_dir / "uploads" / run_payload["upload_id"]
    bundle_path = upload_dir / "bundle.zip"

    run_payload["status"] = "running"
    run_payload["started_at"] = now_iso()
    atomic_write_json(run_path, run_payload)

    try:
        bundle_bytes = bundle_path.read_bytes()
        submission_archives = extract_submission_archives(bundle_bytes)
        run_payload["pipeline_status"]["ingestion"] = "running"
        atomic_write_json(run_path, run_payload)

        submissions_root = assignment_dir / "submissions"
        submissions_root.mkdir(parents=True, exist_ok=True)
        submission_results: list[dict[str, Any]] = []

        for submission_name, archive_bytes, archive_filename in submission_archives:
            submission_id = new_id("sub")
            submission_dir = submissions_root / submission_id
            submission_dir.mkdir(parents=True, exist_ok=True)
            try:
                result = ingest_submission_archive(
                    assignment_id=assignment_id,
                    submission_id=submission_id,
                    submission_name=submission_name,
                    archive_filename=archive_filename,
                    archive_bytes=archive_bytes,
                    submission_dir=submission_dir,
                )
                submission_results.append(
                    {
                        "submission": result.submission_meta,
                        "files": result.file_records,
                        "feature_sets": result.feature_sets,
                        "file_feature_details": result.file_feature_details,
                    }
                )
            except SubmissionArchiveError as exc:
                failed_meta = {
                    "submission_id": submission_id,
                    "assignment_id": assignment_id,
                    "submission_name": submission_name,
                    "source_zip_filename": archive_filename,
                    "source_zip_sha256": sha256_bytes(archive_bytes),
                    "ingestion_status": "error",
                    "created_at": now_iso(),
                    "error": str(exc),
                    "stats": {"relevant_java_file_count": 0, "ignored_entry_count": 0, "parseable_file_count": 0, "empty_submission": True},
                }
                atomic_write_json(submission_dir / "submission.json", failed_meta)
                submission_results.append({"submission": failed_meta, "files": [], "feature_sets": [], "file_feature_details": []})

        run_payload["pipeline_status"]["ingestion"] = "done"
        run_payload["pipeline_status"]["representations"] = "running"
        atomic_write_json(run_path, run_payload)

        raw_features_by_space, comparison_models = build_representations(run_dir, run_id, submission_results)

        run_payload["pipeline_status"]["representations"] = "done"
        run_payload["pipeline_status"]["pairwise"] = "running"
        atomic_write_json(run_path, run_payload)

        pair_items_by_space, fusion_meta = build_pair_chunks(
            run_dir=run_dir,
            run_id=run_id,
            submission_results=submission_results,
            raw_features_by_space=raw_features_by_space,
            comparison_models=comparison_models,
            chunk_size=settings.pair_chunk_size,
        )

        run_payload["pipeline_status"]["pairwise"] = "done"
        run_payload["pipeline_status"]["fusion"] = "done"
        run_payload["pipeline_status"]["graph"] = "running"
        run_payload["pipeline_status"]["cluster"] = "running"
        atomic_write_json(run_path, run_payload)

        build_neighbors_graphs_and_clusters(
            run_dir=run_dir,
            run_id=run_id,
            submission_results=submission_results,
            pair_items_by_space=pair_items_by_space,
            k=settings.knn_k,
        )

        run_payload["pipeline_status"]["graph"] = "done"
        run_payload["pipeline_status"]["cluster"] = "done"
        run_payload["pipeline_status"]["read_models"] = "running"
        atomic_write_json(run_path, run_payload)

        materialize_read_models(
            run_dir=run_dir,
            assignment_id=assignment_id,
            run_id=run_id,
            submission_results=submission_results,
            raw_features_by_space=raw_features_by_space,
            comparison_models=comparison_models,
            pair_items_by_space=pair_items_by_space,
            fusion_meta=fusion_meta,
        )

        run_payload["pipeline_status"]["read_models"] = "done"
        atomic_write_json(run_path, run_payload)
        publish_run(assignment_id, run_id)
    except BundleError as exc:
        run_payload["status"] = "failed"
        run_payload["finished_at"] = now_iso()
        run_payload["error"] = str(exc)
        atomic_write_json(run_path, run_payload)
    except Exception as exc:  # pragma: no cover
        run_payload["status"] = "failed"
        run_payload["finished_at"] = now_iso()
        run_payload["error"] = str(exc)
        atomic_write_json(run_path, run_payload)
        atomic_write_json(
            run_dir / "logs" / "errors.json",
            {"message": str(exc), "traceback": traceback.format_exc().splitlines()},
        )


def publish_run(assignment_id: str, run_id: str) -> None:
    run_dir = storage.run_dir(assignment_id, run_id)
    read_models_dir = run_dir / "read-models"
    required = [
        read_models_dir / "overview.json",
        *(read_models_dir / "graphs" / f"{space}.json" for space in DISPLAY_SPACE_KEYS),
        *(read_models_dir / "clusters" / f"{space}.json" for space in DISPLAY_SPACE_KEYS),
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Pflichtartefakte fehlen vor Publish: {missing}")

    published_payload = {
        "assignment_id": assignment_id,
        "run_id": run_id,
        "published_at": now_iso(),
        "published_by": "system",
    }
    atomic_write_json(storage.published_pointer_path(assignment_id), published_payload)

    run_path = run_dir / "run.json"
    run_payload = read_json(run_path)
    run_payload["status"] = "published"
    run_payload["finished_at"] = now_iso()
    run_payload["pipeline_status"]["publish"] = "done"
    atomic_write_json(run_path, run_payload)
