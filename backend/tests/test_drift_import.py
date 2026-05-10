from __future__ import annotations

import asyncio
from io import BytesIO
from zipfile import ZipFile

from app.config import settings
from app.drift import delete_drift_bundle, import_drift_bundle, list_drift_bundles


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as zip_file:
        for name, data in files.items():
            zip_file.writestr(name, data)
    return buffer.getvalue()


def test_drift_bundle_import_keeps_nested_student_zips_and_reports_ignored_entries(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "data_root", tmp_path)
    student_with_java = _zip_bytes({"src/Main.java": b"public class Main {}"})
    student_without_java = _zip_bytes({"README.md": b"no java"})
    bundle = _zip_bytes(
        {
            "exports/2021/alice.zip": student_with_java,
            "exports/2021/bob.zip": student_without_java,
            "exports/2021/Loose.java": b"class Loose {}",
            "exports/2021/notes.txt": b"notes",
        }
    )

    payload = asyncio.run(import_drift_bundle(assignment_key="prog2_lab2", year=2021, filename="prog2_lab2_2021.zip", content=bundle))

    assert payload["validSubmissionZipCount"] == 1
    assert payload["ignoredLooseFileCount"] == 2
    assert payload["ignoredZipWithoutJavaCount"] == 1
    assert payload["manifest"]["validSubmissionZips"][0]["path"] == "exports/2021/alice.zip"
    assert {item["reason"] for item in payload["manifest"]["ignoredFiles"]} == {"loose_java_file", "not_a_submission_zip"}
    assert payload["manifest"]["ignoredZips"][0]["reason"] == "zip_without_java"

    stored = list_drift_bundles("prog2_lab2")
    assert len(stored) == 1
    assert stored[0]["manifest"]["ignoredZips"][0]["filename"] == "bob.zip"

    result = delete_drift_bundle("prog2_lab2", payload["bundleId"])
    assert result["remainingBundleCount"] == 0


def test_drift_clustering_assigns_solution_patterns_without_outlier_cluster() -> None:
    import numpy as np

    from app.drift import _cluster_id_map, _cluster_vectors, _outlier_scores

    rng = np.random.default_rng(42)
    left = np.column_stack([rng.normal(1.0, 0.02, 18), rng.normal(0.0, 0.02, 18)])
    right = np.column_stack([rng.normal(0.0, 0.02, 18), rng.normal(1.0, 0.02, 18)])
    bridge = np.asarray([[0.55, 0.45], [0.50, 0.50], [0.45, 0.55]], dtype=float)
    vectors = np.vstack([left, right, bridge])
    vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

    labels = _cluster_vectors(vectors)
    cluster_ids = _cluster_id_map(labels)
    scores = _outlier_scores(vectors, labels)

    assert all(label >= 0 for label in labels)
    assert "outlier" not in set(cluster_ids.values())
    assert scores.min() >= 0.0
    assert scores.max() <= 1.0


def test_latest_drift_run_prefers_new_running_run_and_can_filter_model(tmp_path, monkeypatch) -> None:
    from app.config import settings
    from app.drift import assignment_dir_for_key, latest_drift_run
    from app.utils import atomic_write_json

    monkeypatch.setattr(settings, "data_root", tmp_path)
    root = assignment_dir_for_key("prog2_lab2")
    old_dir = root / "runs" / "drift_run_old"
    new_dir = root / "runs" / "drift_run_new"
    atomic_write_json(
        old_dir / "run.json",
        {
            "runId": "drift_run_old",
            "assignmentKey": "prog2_lab2",
            "status": "published",
            "embeddingModel": "qwen3-embedding:0.6b",
            "createdAt": "2026-05-10T10:00:00Z",
        },
    )
    atomic_write_json(root / "latest_run.json", {"assignmentKey": "prog2_lab2", "runId": "drift_run_old"})
    atomic_write_json(
        new_dir / "run.json",
        {
            "runId": "drift_run_new",
            "assignmentKey": "prog2_lab2",
            "status": "running",
            "embeddingModel": "qwen3-embedding:4b",
            "createdAt": "2026-05-10T10:01:00Z",
        },
    )

    assert latest_drift_run("prog2_lab2")["runId"] == "drift_run_new"
    assert latest_drift_run("prog2_lab2", "qwen3-embedding:0.6b")["runId"] == "drift_run_old"
    assert latest_drift_run("prog2_lab2", "qwen3-embedding:4b")["runId"] == "drift_run_new"


def test_drift_embedding_cache_is_model_and_text_safe(tmp_path, monkeypatch) -> None:
    import numpy as np

    from app.config import settings
    from app.drift import _cached_embed

    monkeypatch.setattr(settings, "data_root", tmp_path)

    class DummyClient:
        def __init__(self, model: str, value: float) -> None:
            self.model = model
            self.model_profile = "fast"
            self.base_url = "http://localhost:11434"
            self.value = value
            self.calls = 0

        def embed_one(self, text: str) -> np.ndarray:
            self.calls += 1
            return np.asarray([self.value, 0.0, 0.0], dtype=float)

    cache_stats_a: dict[str, object] = {}
    client_a = DummyClient("qwen3-embedding:0.6b", 1.0)
    first = _cached_embed(client_a, "class A {}", cache_stats=cache_stats_a)
    second = _cached_embed(client_a, "class A {}", cache_stats=cache_stats_a)

    assert client_a.calls == 1
    assert first.tolist() == second.tolist()
    assert cache_stats_a["hits"] == 1
    assert cache_stats_a["misses"] == 1

    cache_stats_b: dict[str, object] = {}
    client_b = DummyClient("qwen3-embedding:4b", 2.0)
    third = _cached_embed(client_b, "class A {}", cache_stats=cache_stats_b)

    assert client_b.calls == 1
    assert third.tolist() == [2.0, 0.0, 0.0]
    assert cache_stats_b["misses"] == 1
    assert cache_stats_b.get("hits", 0) == 0



def test_drift_embedding_cache_can_be_bypassed_for_debug_runs(tmp_path, monkeypatch) -> None:
    import numpy as np

    from app.config import settings
    from app.drift import _cached_embed

    monkeypatch.setattr(settings, "data_root", tmp_path)

    class DummyClient:
        def __init__(self) -> None:
            self.model = "qwen3-embedding:0.6b"
            self.model_profile = "fast"
            self.base_url = "http://localhost:11434"
            self.calls = 0

        def embed_one(self, text: str) -> np.ndarray:
            self.calls += 1
            return np.asarray([float(self.calls), 0.0, 0.0], dtype=float)

    client = DummyClient()
    cache_stats: dict[str, object] = {}

    first = _cached_embed(client, "class Force {}", cache_stats=cache_stats)
    second = _cached_embed(client, "class Force {}", cache_stats=cache_stats, force_recompute=True)

    assert client.calls == 2
    assert first.tolist() == [1.0, 0.0, 0.0]
    assert second.tolist() == [2.0, 0.0, 0.0]
    assert cache_stats.get("hits", 0) == 0
    assert cache_stats["misses"] == 2
    assert cache_stats["bypassed"] == 1
    assert cache_stats["writes"] == 2

def test_drift_run_contains_backend_progress_state(tmp_path, monkeypatch) -> None:
    from app.config import settings
    from app.drift import create_drift_run, import_drift_bundle

    monkeypatch.setattr(settings, "data_root", tmp_path)
    student = _zip_bytes({"src/Main.java": b"public class Main {}"})
    bundle = _zip_bytes({"exports/alice.zip": student})
    asyncio.run(import_drift_bundle(assignment_key="prog2_lab2", year=2026, filename="prog2_lab2_2026.zip", content=bundle))

    run = create_drift_run("prog2_lab2", embedding_model="qwen3-embedding:0.6b")

    assert run["progress"]["stage"] == "queued"
    assert run["progress"]["heartbeatAt"]
    assert run["progress"]["cache"]["hits"] == 0
    assert "normalization" in run["pipelineStatus"]


def test_drift_submission_ids_include_bundle_location_to_avoid_ui_key_collisions() -> None:
    from app.drift import _drift_submission_id, _ensure_unique_submission_id

    archive_hash = "40ed995f57f1abcdef"
    first = _drift_submission_id(
        year=2026,
        bundle_id="drift_bundle_a",
        archive_hash=archive_hash,
        archive_path="exports/a/Abgabe.zip",
        archive_index=1,
    )
    second = _drift_submission_id(
        year=2026,
        bundle_id="drift_bundle_b",
        archive_hash=archive_hash,
        archive_path="exports/b/Abgabe.zip",
        archive_index=1,
    )

    assert first != second
    assert first.startswith("sub_2026_40ed995f57f1_")
    seen: set[str] = set()
    assert _ensure_unique_submission_id(first, seen) == first
    assert _ensure_unique_submission_id(first, seen) != first
