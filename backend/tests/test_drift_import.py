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
