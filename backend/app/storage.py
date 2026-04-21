from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import settings
from .utils import atomic_write_json, read_json


class Storage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or settings.data_root).resolve()
        self.index_dir = self.root / "index"
        self.assignments_dir = self.root / "assignments"
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.assignments_dir.mkdir(parents=True, exist_ok=True)

    def assignment_dir(self, assignment_id: str) -> Path:
        path = self.assignments_dir / assignment_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def update_assignment_index(self, item: dict[str, Any]) -> None:
        index_path = self.index_dir / "assignments.json"
        items = read_json(index_path, default=[])
        items = [entry for entry in items if entry.get("assignment_id") != item["assignment_id"]]
        items.append(item)
        items.sort(key=lambda entry: entry.get("created_at", ""), reverse=True)
        atomic_write_json(index_path, items)

    def list_assignments(self) -> list[dict[str, Any]]:
        return read_json(self.index_dir / "assignments.json", default=[])

    def run_dir(self, assignment_id: str, run_id: str) -> Path:
        path = self.assignment_dir(assignment_id) / "runs" / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def published_pointer_path(self, assignment_id: str) -> Path:
        path = self.assignment_dir(assignment_id) / "published" / "current.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path


storage = Storage()
