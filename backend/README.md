# Python Backend

## Start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
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
