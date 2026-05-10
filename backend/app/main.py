from __future__ import annotations

from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .drift import create_drift_run, create_drift_workspace_runs, delete_drift_bundle, drift_run_artifacts, drift_workspace_overview, get_drift_run, import_drift_bundle, latest_drift_run, list_drift_assignments, list_drift_bundles, process_drift_run
from .embedding_models import normalize_embedding_model
from .engines import ENGINE2, normalize_engine
from .ingestion import BundleError
from .pipeline import create_run, process_run, publish_run
from .storage import storage
from .utils import atomic_write_bytes, atomic_write_json, new_id, now_iso, read_json, sha256_bytes, slugify

SPACE_PATTERN = "^(expr|struct|sem|fusion|embedding|supervised)$"

app = FastAPI(title="Java Graph MVP", version="0.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}




@app.get("/api/drift/assignments")
def list_drift_assignment_keys() -> list[dict[str, Any]]:
    return list_drift_assignments()


@app.post("/api/drift/bundles")
async def upload_drift_bundle(assignment_key: str = Form(...), year: int = Form(...), file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        return await import_drift_bundle(assignment_key=assignment_key, year=year, filename=file.filename, content=await file.read())
    except (ValueError, BundleError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc




@app.get("/api/drift/bundles")
def list_drift_assignment_bundles(assignment_key: str = Query(...)) -> list[dict[str, Any]]:
    try:
        return list_drift_bundles(assignment_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/drift/bundles/{bundle_id}")
def remove_drift_bundle(bundle_id: str, assignment_key: str = Query(...)) -> dict[str, Any]:
    try:
        return delete_drift_bundle(assignment_key, bundle_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/drift/runs")
def start_drift_run(
    background_tasks: BackgroundTasks,
    assignment_key: str = Form(...),
    embedding_model: str | None = Form(default=None),
    top_k: int | None = Form(default=None),
    force_recompute: bool = Form(default=False),
) -> dict[str, Any]:
    try:
        run_payload = create_drift_run(assignment_key=assignment_key, embedding_model=embedding_model, top_k=top_k, force_recompute=force_recompute)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    background_tasks.add_task(process_drift_run, run_payload["assignmentKey"], run_payload["runId"])
    return run_payload




@app.post("/api/drift/workspace/runs")
def start_drift_workspace_runs(
    background_tasks: BackgroundTasks,
    embedding_model: str | None = Form(default=None),
    top_k: int | None = Form(default=None),
    force_recompute: bool = Form(default=False),
    assignment_keys: str | None = Form(default=None),
) -> dict[str, Any]:
    try:
        payload = create_drift_workspace_runs(
            embedding_model=embedding_model,
            top_k=top_k,
            force_recompute=force_recompute,
            assignment_keys=assignment_keys,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for run_payload in payload.get("runs", []):
        background_tasks.add_task(process_drift_run, run_payload["assignmentKey"], run_payload["runId"])
    return payload


@app.get("/api/drift/workspace/overview")
def get_drift_workspace_overview(
    embedding_model: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        return drift_workspace_overview(embedding_model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.get("/api/drift/runs/latest")
def get_latest_drift_run(
    assignment_key: str | None = Query(default=None),
    embedding_model: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        return latest_drift_run(assignment_key, embedding_model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/drift/runs/{run_id}")
def read_drift_run(run_id: str) -> dict[str, Any]:
    try:
        return get_drift_run(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/drift/runs/{run_id}/artifacts")
def get_drift_run_artifacts(run_id: str) -> dict[str, Any]:
    try:
        return drift_run_artifacts(run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/assignments")
def create_assignment(name: str = Form(...), course_id: str | None = Form(default=None)) -> dict[str, Any]:
    assignment_id = new_id("asg")
    assignment_dir = storage.assignment_dir(assignment_id)
    payload = {
        "assignment_id": assignment_id,
        "name": name,
        "slug": slugify(name),
        "course_id": course_id,
        "created_at": now_iso(),
    }
    atomic_write_json(assignment_dir / "assignment.json", payload)
    storage.update_assignment_index(payload)
    return payload


@app.get("/api/assignments")
def list_assignments() -> list[dict[str, Any]]:
    return storage.list_assignments()


@app.post("/api/assignments/{assignment_id}/upload-bundle")
async def upload_bundle(assignment_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    assignment_dir = storage.assignment_dir(assignment_id)
    assignment_path = assignment_dir / "assignment.json"
    if not assignment_path.exists():
        raise HTTPException(status_code=404, detail="Assignment nicht gefunden.")
    upload_id = new_id("upl")
    upload_dir = assignment_dir / "uploads" / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    atomic_write_bytes(upload_dir / "bundle.zip", content)
    payload = {
        "upload_id": upload_id,
        "assignment_id": assignment_id,
        "original_filename": file.filename,
        "storage_path": str((upload_dir / "bundle.zip").relative_to(storage.root)),
        "sha256": sha256_bytes(content),
        "size_bytes": len(content),
        "created_at": now_iso(),
    }
    atomic_write_json(upload_dir / "upload.json", payload)
    return payload


@app.post("/api/assignments/{assignment_id}/analysis-runs")
def start_analysis_run(
    assignment_id: str,
    background_tasks: BackgroundTasks,
    upload_id: str = Form(...),
    auto_publish: bool = Form(default=True),
    engine: str = Form(default="engine1"),
    embedding_model: str | None = Form(default=None),
) -> dict[str, Any]:
    assignment_dir = storage.assignment_dir(assignment_id)
    if not (assignment_dir / "assignment.json").exists():
        raise HTTPException(status_code=404, detail="Assignment nicht gefunden.")
    if not (assignment_dir / "uploads" / upload_id / "upload.json").exists():
        raise HTTPException(status_code=404, detail="Upload nicht gefunden.")
    try:
        selected_engine = normalize_engine(engine)
        selected_embedding_model = normalize_embedding_model(embedding_model or settings.ollama_embed_model) if selected_engine == ENGINE2 else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if embedding_model and selected_engine != ENGINE2:
        raise HTTPException(status_code=400, detail="Ein Embedding-Modell kann nur mit Engine2 gesetzt werden.")
    run_payload = create_run(assignment_id, upload_id, selected_engine, selected_embedding_model)
    background_tasks.add_task(process_run, assignment_id, run_payload["run_id"])
    if auto_publish:
        run_payload["auto_publish"] = True
    return run_payload


@app.get("/api/analysis-runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    for assignment in storage.list_assignments():
        run_path = storage.assignment_dir(assignment["assignment_id"]) / "runs" / run_id / "run.json"
        if run_path.exists():
            return read_json(run_path)
    raise HTTPException(status_code=404, detail="Run nicht gefunden.")


@app.post("/api/analysis-runs/{run_id}/publish")
def publish_analysis_run(run_id: str) -> dict[str, Any]:
    for assignment in storage.list_assignments():
        run_path = storage.assignment_dir(assignment["assignment_id"]) / "runs" / run_id / "run.json"
        if run_path.exists():
            publish_run(assignment["assignment_id"], run_id)
            return read_json(run_path)
    raise HTTPException(status_code=404, detail="Run nicht gefunden.")


@app.get("/api/assignments/{assignment_id}")
def get_assignment_overview(assignment_id: str) -> dict[str, Any]:
    current = read_json(storage.published_pointer_path(assignment_id))
    if not current:
        assignment_path = storage.assignment_dir(assignment_id) / "assignment.json"
        if not assignment_path.exists():
            raise HTTPException(status_code=404, detail="Assignment nicht gefunden.")
        return {"assignment": read_json(assignment_path), "published": None}
    run_dir = storage.run_dir(assignment_id, current["run_id"])
    overview = read_json(run_dir / "read-models" / "overview.json")
    return {"assignment": read_json(storage.assignment_dir(assignment_id) / "assignment.json"), "published": current, "overview": overview}


@app.get("/api/assignments/{assignment_id}/runs/latest")
def get_latest_run(assignment_id: str) -> dict[str, Any]:
    current = read_json(storage.published_pointer_path(assignment_id))
    if current:
        return read_json(storage.run_dir(assignment_id, current["run_id"]) / "run.json")
    runs_root = storage.assignment_dir(assignment_id) / "runs"
    if not runs_root.exists():
        raise HTTPException(status_code=404, detail="Keine Runs vorhanden.")
    run_files = sorted(runs_root.glob("*/run.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not run_files:
        raise HTTPException(status_code=404, detail="Keine Runs vorhanden.")
    return read_json(run_files[0])


@app.get("/api/assignments/{assignment_id}/submissions")
def list_submissions(assignment_id: str) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    return read_json(storage.run_dir(assignment_id, run_id) / "read-models" / "submissions" / "index.json", default=[])


@app.get("/api/assignments/{assignment_id}/submissions/{submission_id}")
def get_submission_detail(assignment_id: str, submission_id: str) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    path = storage.run_dir(assignment_id, run_id) / "read-models" / "submissions" / f"{submission_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submission nicht gefunden.")
    return read_json(path)


@app.get("/api/assignments/{assignment_id}/graphs")
def get_graph(assignment_id: str, space: str = Query("expr", pattern=SPACE_PATTERN)) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    path = storage.run_dir(assignment_id, run_id) / "read-models" / "graphs" / f"{space}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Graph nicht gefunden.")
    return read_json(path)


@app.get("/api/assignments/{assignment_id}/clusters")
def get_clusters(assignment_id: str, space: str = Query("expr", pattern=SPACE_PATTERN)) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    path = storage.run_dir(assignment_id, run_id) / "read-models" / "clusters" / f"{space}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Cluster nicht gefunden.")
    return read_json(path)


@app.get("/api/assignments/{assignment_id}/pairs")
def get_pairs_index(assignment_id: str) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    path = storage.run_dir(assignment_id, run_id) / "read-models" / "pairs" / "index.json"
    return read_json(path, default={})


@app.get("/api/assignments/{assignment_id}/pairs/{submission_a}/{submission_b}")
def get_pair_detail(
    assignment_id: str,
    submission_a: str,
    submission_b: str,
    space: str = Query("expr", pattern=SPACE_PATTERN),
) -> Any:
    run_id = _published_or_latest_run_id(assignment_id)
    left, right = sorted((submission_a, submission_b))
    path = storage.run_dir(assignment_id, run_id) / "read-models" / "pairs" / space / f"{left}__{right}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Pair nicht gefunden.")
    return read_json(path)


def _published_or_latest_run_id(assignment_id: str) -> str:
    current = read_json(storage.published_pointer_path(assignment_id))
    if current:
        return current["run_id"]
    runs_root = storage.assignment_dir(assignment_id) / "runs"
    run_files = sorted(runs_root.glob("*/run.json"), key=lambda file_path: file_path.stat().st_mtime, reverse=True)
    if not run_files:
        raise HTTPException(status_code=404, detail="Keine Runs vorhanden.")
    return run_files[0].parent.name
