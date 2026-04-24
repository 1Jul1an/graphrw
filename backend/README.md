# Python Backend

## Start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate / .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Data Root

Per Default schreibt der Server nach `./data`. Optional:

```bash
export DATA_ROOT=/absolute/path/to/data
```

## Wichtige Endpunkte

- `POST /api/assignments`
- `POST /api/assignments/{id}/upload-bundle`
- `POST /api/assignments/{id}/analysis-runs`
- `GET /api/analysis-runs/{id}`
- `GET /api/assignments/{id}/graphs?space=expr|struct|sem`
- `GET /api/assignments/{id}/clusters?space=expr|struct|sem`

## Exp-Entscheidungen

- JSON-only Persistenz

## Engine2 Ollama Embeddings

Engine2 kann beim Start eines Analysis-Runs eines von drei fest verdrahteten Profilen nutzen:

- `Fast`: `qwen3-embedding:0.6b`
- `Balanced`: `qwen3-embedding:4b` Default
- `Quality`: `qwen3-embedding:8b`

Das Frontend zeigt diese Auswahl nur, wenn Engine2 aktiv ist. Backend-seitig wird das gewählte Modell als `embedding_model` im Run gespeichert und für die Ollama-Requests verwendet. Ohne explizite Auswahl fällt das Backend auf `OLLAMA_EMBED_MODEL` zurück, dessen Default `qwen3-embedding:4b` ist.

```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_EMBED_MODEL=qwen3-embedding:4b
ollama pull qwen3-embedding:4b
```
