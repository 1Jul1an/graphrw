# GraphRW

## In Exp. enthalten:

- JSON-only Persistenz für Assignments, Runs und materialisierte Read-Models
- Upload und Verarbeitung von Assignment-Bundle-ZIPs
- robuste Erkennung und Extraktion von Submission-ZIPs
- rekursive Sammlung relevanter Java-Dateien
- Ignore-Regeln für System-, Build- und temporäre Artefakte
- getrennte Analyse-Räume `expr`, `struct`, `sem`
- Similarity-Berechnung über paarweise Cosine Similarity
- mutual-kNN-Graphen pro Raum
- Clusterbildung auf Basis der Graph-Komponenten
- JSON-Read-Models für Backend und Frontend
- Frontend für Upload, Status-Polling und Graphvisualisierung
- gleichzeitige Anzeige aller Graphräume im Frontend
- komponentenbasierte UI-Struktur
- Light-/Dark-Theme mit manuellem Toggle
- Inspector für Auswahl- und Detailansichten

## Projektstruktur

- `backend/`: FastAPI + Analysepipeline
- `frontend/`: NextJS + Cytoscape Viewer
- `examples/`: Demo-Bundle

## Schnellstart

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000/api npm run dev
```

Dann im Browser `http://localhost:3000` öffnen.
