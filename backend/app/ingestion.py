from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any
from zipfile import BadZipFile, ZipFile

from .features import extract_file_space_features, file_normalizations, write_normalization_files
from .utils import atomic_write_bytes, atomic_write_json, new_id, now_iso, sha256_bytes

IGNORED_DIRS = {"__MACOSX", "target", "build", "out", "bin", "dist", ".gradle", ".idea", ".git", "node_modules"}
IGNORED_FILES = {".DS_Store", "Thumbs.db"}


@dataclass(slots=True)
class SubmissionExtractionResult:
    submission_meta: dict[str, Any]
    file_records: list[dict[str, Any]]
    feature_sets: list[dict[str, dict[str, float]]]
    file_feature_details: list[dict[str, Any]]


class BundleError(Exception):
    pass


class SubmissionArchiveError(Exception):
    pass


def extract_submission_archives(bundle_bytes: bytes) -> list[tuple[str, bytes, str]]:
    try:
        with ZipFile(BytesIO(bundle_bytes)) as bundle_zip:
            found: list[tuple[str, bytes, str]] = []
            for info in bundle_zip.infolist():
                if info.is_dir():
                    continue
                path = PurePosixPath(info.filename)
                if should_ignore_entry(path):
                    continue
                if path.suffix.lower() != ".zip":
                    continue
                data = bundle_zip.read(info.filename)
                submission_name = path.stem
                found.append((submission_name, data, path.name))
    except BadZipFile as exc:
        raise BundleError("Bundle ZIP ist beschädigt oder kein gültiges ZIP.") from exc

    if not found:
        raise BundleError("Bundle enthält keine gültige Submission-ZIP.")
    return found


def _coerce_path(path: PurePosixPath | str) -> PurePosixPath:
    return path if isinstance(path, PurePosixPath) else PurePosixPath(path)


def should_ignore_entry(path: PurePosixPath | str) -> bool:
    path = _coerce_path(path)
    parts = [part for part in path.parts if part not in {".", ""}]
    for part in parts:
        if part in IGNORED_DIRS:
            return True
        if part in IGNORED_FILES:
            return True
        if part.startswith("._"):
            return True
    basename = path.name
    if basename in IGNORED_FILES or basename.startswith("._"):
        return True
    return False


def is_relevant_java_file(path: PurePosixPath | str) -> bool:
    path = _coerce_path(path)
    if should_ignore_entry(path):
        return False
    basename = path.name
    if not basename.lower().endswith(".java"):
        return False
    stem = path.stem
    if not stem or stem.startswith(".") or stem.startswith("_"):
        return False
    return True


def ingest_submission_archive(
    assignment_id: str,
    submission_id: str,
    submission_name: str,
    archive_filename: str,
    archive_bytes: bytes,
    submission_dir,
    extract_features: bool = True,
) -> SubmissionExtractionResult:
    atomic_write_bytes(submission_dir / "source.zip", archive_bytes)
    file_records: list[dict[str, Any]] = []
    feature_sets: list[dict[str, dict[str, float]]] = []
    file_feature_details: list[dict[str, Any]] = []
    ignored_entry_count = 0
    ast_ok_file_count = 0
    ast_recovered_file_count = 0
    try:
        with ZipFile(BytesIO(archive_bytes)) as submission_zip:
            for info in submission_zip.infolist():
                if info.is_dir():
                    continue
                path = PurePosixPath(info.filename)
                if should_ignore_entry(path):
                    ignored_entry_count += 1
                    continue
                if not is_relevant_java_file(path):
                    ignored_entry_count += 1
                    continue
                raw_bytes = submission_zip.read(info.filename)
                raw_text = raw_bytes.decode("utf-8", errors="replace")
                file_id = new_id("file")
                file_dir = submission_dir / "files" / file_id
                file_dir.mkdir(parents=True, exist_ok=True)
                atomic_write_bytes(file_dir / "raw.java", raw_bytes)
                if extract_features:
                    normalizations = file_normalizations(raw_text)
                    write_normalization_files(normalizations, file_dir / "normalized")
                    features = extract_file_space_features(raw_text)
                    feature_sets.append(features)
                    ast_meta = features.get("_meta", {}).get("ast", {})
                    parse_status = ast_meta.get("parse_status", "ok")
                    if parse_status == "ok":
                        ast_ok_file_count += 1
                    else:
                        ast_recovered_file_count += 1
                else:
                    normalizations = {}
                    features = {"expr": {}, "struct": {}, "sem": {}, "_meta": {"ast": {"provider": "skipped", "parse_status": "skipped"}}}
                    ast_meta = features["_meta"]["ast"]
                    parse_status = "skipped"
                record = {
                    "file_id": file_id,
                    "submission_id": submission_id,
                    "assignment_id": assignment_id,
                    "relative_path": info.filename,
                    "basename": path.name,
                    "sha256": sha256_bytes(raw_bytes),
                    "size_bytes": len(raw_bytes),
                    "language": "java",
                    "is_ignored": False,
                    "ignore_reason": None,
                    "parse_status": parse_status,
                    "created_at": now_iso(),
                }
                feature_detail = {
                    "file": record,
                    "spaces": {space: features[space] for space in ("expr", "struct", "sem")},
                    "ast": ast_meta,
                    "normalizations_available": list(normalizations.keys()),
                }
                atomic_write_json(file_dir / "file.json", record)
                atomic_write_json(file_dir / "features.json", feature_detail)
                file_records.append(record)
                file_feature_details.append(feature_detail)
    except BadZipFile as exc:
        raise SubmissionArchiveError(f"Submission-ZIP '{archive_filename}' ist beschädigt.") from exc

    submission_meta = {
        "submission_id": submission_id,
        "assignment_id": assignment_id,
        "submission_name": submission_name,
        "source_zip_filename": archive_filename,
        "source_zip_sha256": sha256_bytes(archive_bytes),
        "ingestion_status": "empty" if not file_records else "ok",
        "created_at": now_iso(),
        "stats": {
            "relevant_java_file_count": len(file_records),
            "ignored_entry_count": ignored_entry_count,
            "parseable_file_count": len(file_records),
            "ast_ok_file_count": ast_ok_file_count,
            "ast_recovered_file_count": ast_recovered_file_count,
            "empty_submission": not bool(file_records),
        },
    }
    atomic_write_json(submission_dir / "submission.json", submission_meta)
    return SubmissionExtractionResult(
        submission_meta=submission_meta,
        file_records=file_records,
        feature_sets=feature_sets,
        file_feature_details=file_feature_details,
    )
