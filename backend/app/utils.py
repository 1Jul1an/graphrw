from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


def sha256_bytes(data: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(data)
    return digest.hexdigest()


_slug_re = re.compile(r"[^a-zA-Z0-9_-]+")


def slugify(value: str) -> str:
    base = value.strip().replace(" ", "_")
    base = _slug_re.sub("_", base)
    return base.strip("_") or "assignment"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _replace_with_retry(tmp_path: Path, target_path: Path, *, attempts: int = 12, initial_delay: float = 0.04) -> None:
    """Replace a file atomically, with short retries for Windows file locks.

    On Windows, antivirus scanners, dev servers, or a concurrent status read can
    briefly hold a handle on ``run.json``. A plain ``Path.replace`` then raises
    ``PermissionError: [WinError 5] Zugriff verweigert`` even though retrying a
    moment later succeeds. The temporary file stays in the same directory, so the
    final successful replacement is still atomic.
    """
    delay = initial_delay
    last_error: PermissionError | None = None
    for _ in range(max(1, attempts)):
        try:
            tmp_path.replace(target_path)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(delay)
            delay = min(delay * 1.8, 0.75)
    if last_error is not None:
        raise last_error


def atomic_write_json(path: Path, payload: Any) -> None:
    ensure_parent(path)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
            json.dump(payload, tmp, indent=2, ensure_ascii=False)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        _replace_with_retry(tmp_path, path)
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def atomic_write_bytes(path: Path, content: bytes) -> None:
    ensure_parent(path)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as tmp:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        _replace_with_retry(tmp_path, path)
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))
