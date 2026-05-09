"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card } from "../../components/Card";
import { TopBar } from "../../components/TopBar";
import {
  DriftCentroidTimelineChart,
  DriftClusterDistributionChart,
  DriftClusterSummaryTable,
  DriftEmbeddingMapByCluster,
  DriftEmbeddingMapByYear,
  DriftOutlierChart,
  DriftOverviewCards,
  DriftSubmissionDetailPanel,
  DriftYearSimilarityHeatmap,
} from "../../components/drift/DriftComponents";
import {
  EMBEDDING_MODEL_OPTIONS,
  type DriftArtifacts,
  type DriftBundle,
  type DriftIgnoredEntry,
  type DriftProjectionPoint,
  type DriftRunPayload,
  type EmbeddingModelName,
} from "../../lib/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";
const api = (path: string) => `${API_BASE.replace(/\/$/, "")}${path}`;

type DriftAssignment = {
  assignmentKey: string;
  years?: number[];
  bundleCount?: number;
  validSubmissionZipCount?: number;
  ignoredLooseFileCount?: number;
  ignoredZipWithoutJavaCount?: number;
  updatedAt?: string;
};

type BundleDraft = {
  id: string;
  file: File;
  year: string;
};

export default function DriftPage() {
  const [assignmentKey, setAssignmentKey] = useState("prog2_lab2");
  const [year, setYear] = useState("2026");
  const [bundleDrafts, setBundleDrafts] = useState<BundleDraft[]>([]);
  const [storedBundles, setStoredBundles] = useState<DriftBundle[]>([]);
  const [importReports, setImportReports] = useState<DriftBundle[]>([]);
  const [embeddingModel, setEmbeddingModel] =
    useState<EmbeddingModelName>("qwen3-embedding:4b");
  const [assignments, setAssignments] = useState<DriftAssignment[]>([]);
  const [run, setRun] = useState<DriftRunPayload | null>(null);
  const [artifacts, setArtifacts] = useState<DriftArtifacts | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(
    new Set(),
  );
  const [showNeighbors, setShowNeighbors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignments();
  }, []);

  useEffect(() => {
    if (!assignmentKey.trim()) return;
    loadBundles(assignmentKey);
    loadLatest(assignmentKey);
  }, [assignmentKey]);

  useEffect(() => {
    if (!run?.runId || run.status === "published" || run.status === "failed")
      return;
    const handle = window.setInterval(async () => {
      try {
        const response = await fetch(
          api(
            `/drift/runs/latest?assignment_key=${encodeURIComponent(run.assignmentKey)}`,
          ),
        );
        if (!response.ok) return;
        const latest = (await response.json()) as DriftRunPayload;
        setRun(latest);
        if (latest.status === "published") {
          await loadArtifacts(latest.runId, false);
          setRunning(false);
        }
        if (latest.status === "failed") setRunning(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRunning(false);
      }
    }, 1800);
    return () => window.clearInterval(handle);
  }, [run?.runId, run?.status, run?.assignmentKey]);

  async function loadAssignments() {
    try {
      const response = await fetch(api("/drift/assignments"));
      const items = response.ok
        ? ((await response.json()) as DriftAssignment[])
        : [];
      setAssignments(items);
      if (items.length && assignmentKey === "prog2_lab2") {
        setAssignmentKey(items[0].assignmentKey);
      }
    } catch {
      setAssignments([]);
    }
  }

  async function loadBundles(key: string) {
    try {
      const response = await fetch(
        api(`/drift/bundles?assignment_key=${encodeURIComponent(key.trim())}`),
      );
      const items = response.ok
        ? ((await response.json()) as DriftBundle[])
        : [];
      setStoredBundles(items);
    } catch {
      setStoredBundles([]);
    }
  }

  async function loadLatest(key: string) {
    setError(null);
    try {
      const response = await fetch(
        api(
          `/drift/runs/latest?assignment_key=${encodeURIComponent(key.trim())}`,
        ),
      );
      if (!response.ok) {
        setRun(null);
        setArtifacts(null);
        return;
      }
      const latest = (await response.json()) as DriftRunPayload;
      setRun(latest);
      if (latest.status === "published") {
        await loadArtifacts(latest.runId, false);
      } else {
        setArtifacts(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadArtifacts(runId: string, cancelled: boolean) {
    const response = await fetch(api(`/drift/runs/${runId}/artifacts`));
    if (!response.ok)
      throw new Error(
        `Drift-Artefakte konnten nicht geladen werden (${response.status}).`,
      );
    const payload = (await response.json()) as DriftArtifacts;
    if (!cancelled) {
      setArtifacts(payload);
      setSelectedId((current) =>
        current &&
        payload.projection.points.some(
          (point) => point.submissionId === current,
        )
          ? current
          : null,
      );
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const drafts = Array.from(files).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      year: deriveYear(file.name) ?? year,
    }));
    setBundleDrafts((current) => [...current, ...drafts]);
  }

  function updateDraftYear(id: string, nextYear: string) {
    setBundleDrafts((current) =>
      current.map((draft) =>
        draft.id === id ? { ...draft, year: nextYear } : draft,
      ),
    );
  }

  function removeDraft(id: string) {
    setBundleDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  async function handleImport(event: FormEvent) {
    event.preventDefault();
    if (!bundleDrafts.length || !assignmentKey.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setImportReports([]);
    try {
      const reports: DriftBundle[] = [];
      for (const draft of bundleDrafts) {
        const uploadForm = new FormData();
        uploadForm.append("assignment_key", assignmentKey.trim());
        uploadForm.append("year", draft.year.trim());
        uploadForm.append("file", draft.file);
        const uploadResponse = await fetch(api("/drift/bundles"), {
          method: "POST",
          body: uploadForm,
        });
        const uploadPayload = (await uploadResponse.json()) as DriftBundle & {
          detail?: string;
        };
        if (!uploadResponse.ok)
          throw new Error(
            uploadPayload.detail ??
              `Bundle konnte nicht importiert werden (${uploadResponse.status}).`,
          );
        reports.push(uploadPayload);
      }
      setImportReports(reports);
      setBundleDrafts([]);
      setArtifacts(null);
      setRun(null);
      setMessage(
        `${reports.length} Bundle${reports.length === 1 ? "" : "s"} importiert. Starte danach die Drift-Berechnung.`,
      );
      await loadBundles(assignmentKey.trim());
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    if (!assignmentKey.trim()) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const runForm = new FormData();
      runForm.append("assignment_key", assignmentKey.trim());
      runForm.append("embedding_model", embeddingModel);
      runForm.append("top_k", "8");
      const runResponse = await fetch(api("/drift/runs"), {
        method: "POST",
        body: runForm,
      });
      const runPayload = (await runResponse.json()) as DriftRunPayload & {
        detail?: string;
      };
      if (!runResponse.ok)
        throw new Error(
          runPayload.detail ??
            `Drift-Run konnte nicht gestartet werden (${runResponse.status}).`,
        );
      setRun(runPayload);
      setArtifacts(null);
      setMessage("Drift-Berechnung gestartet.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  async function handleDeleteBundle(bundleId: string) {
    if (!assignmentKey.trim()) return;
    setDeletingId(bundleId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        api(
          `/drift/bundles/${encodeURIComponent(bundleId)}?assignment_key=${encodeURIComponent(assignmentKey.trim())}`,
        ),
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.detail ??
            `Bundle konnte nicht gelöscht werden (${response.status}).`,
        );
      setArtifacts(null);
      setRun(null);
      setMessage(
        "Bundle gelöscht. Bestehende Drift-Artefakte für diesen assignmentKey wurden verworfen.",
      );
      await loadBundles(assignmentKey.trim());
      await loadAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const years = artifacts?.overview.includedYears ?? [];
  const clusters = useMemo(
    () => [...(artifacts?.clusters.clusters ?? [])].sort(compareClusterItems),
    [artifacts?.clusters.clusters],
  );
  const validSubmissionZipCount = storedBundles.reduce(
    (sum, item) => sum + Number(item.validSubmissionZipCount ?? 0),
    0,
  );

  useEffect(() => {
    if (!years.length) return;
    setSelectedYears((current) => {
      const available = new Set(years);
      const kept = [...current].filter((item) => available.has(item));
      return new Set(kept.length ? kept : years);
    });
  }, [years.join(",")]);

  useEffect(() => {
    if (!clusters.length) return;
    setSelectedClusters((current) => {
      const clusterIds = clusters.map((cluster) => cluster.clusterId);
      const available = new Set(clusterIds);
      const kept = [...current].filter((item) => available.has(item));
      return new Set(kept.length ? kept : clusterIds);
    });
  }, [clusters.map((cluster) => cluster.clusterId).join(",")]);

  const filteredPoints = useMemo(() => {
    const points = artifacts?.projection.points ?? [];
    return points.filter(
      (point) =>
        (selectedYears.size ? selectedYears.has(point.year) : true) &&
        (selectedClusters.size ? selectedClusters.has(point.clusterId) : true),
    );
  }, [artifacts?.projection.points, selectedYears, selectedClusters]);

  const selectedPoint = useMemo(
    () =>
      artifacts?.projection.points.find(
        (point) => point.submissionId === selectedId,
      ) ?? null,
    [artifacts?.projection.points, selectedId],
  );
  const neighborRows = useMemo(
    () =>
      artifacts?.neighbors?.items.find(
        (item) => item.submissionId === selectedId,
      )?.neighbors ?? [],
    [artifacts?.neighbors, selectedId],
  );
  const neighborIds = useMemo(
    () => new Set(neighborRows.map((neighbor) => neighbor.submissionId)),
    [neighborRows],
  );

  function toggleYear(item: number) {
    setSelectedYears((current) => {
      const next = new Set(current);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  function toggleCluster(item: string) {
    setSelectedClusters((current) => {
      const next = new Set(current);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  function selectPoint(point: DriftProjectionPoint) {
    setSelectedId(point.submissionId);
  }

  return (
    <div className="min-h-screen bg-slate-75 text-slate-900 dark:bg-mdn-dark-bg dark:text-mdn-dark-text">
      <TopBar />
      <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 2xl:px-10">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">
              Drift
            </div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-mdn-dark-text">
              History Drift im Lösungsraum
            </h1>
            <p className="mt-3 max-w-[78ch] text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">
              Jahrgänge derselben Aufgabe werden gemeinsam projiziert. Die Seite
              lädt gespeicherte Drift-Artefakte und zeigt Jahrgänge, Cluster,
              Distanzen und Randbereiche als Dashboard.
            </p>
          </div>
          {run ? (
            <div className="rounded-2xl border border-slate-250 bg-white/70 px-4 py-3 text-sm text-slate-600 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
              Status:{" "}
              <span className="font-semibold text-slate-950 dark:text-mdn-dark-text">
                {run.status}
              </span>
            </div>
          ) : null}
        </header>

        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card
            title="Bundles importieren"
            eyebrow="Jahrgänge"
            description="Ein Bundle erhält genau ein Jahrgangslabel. Student-ZIPs werden auch in Unterordnern gefunden. Lose Dateien im Bundle werden ignoriert; nur Student-ZIPs mit mindestens einer Java-Datei werden als Submission übernommen."
          >
            <form className="space-y-5" onSubmit={handleImport}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                    assignmentKey
                  </span>
                  <input
                    value={assignmentKey}
                    onChange={(event) => setAssignmentKey(event.target.value)}
                    list="drift-assignment-keys"
                    className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
                    placeholder="prog2_lab2"
                  />
                  <datalist id="drift-assignment-keys">
                    {assignments.map((item) => (
                      <option
                        key={item.assignmentKey}
                        value={item.assignmentKey}
                      />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                    Default-Jahr
                  </span>
                  <input
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
                    placeholder="2026"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                  Bundle ZIPs
                </span>
                <input
                  type="file"
                  multiple
                  accept=".zip,application/zip"
                  onChange={(event) => handleFiles(event.target.files)}
                  className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm dark:border-mdn-dark-border dark:bg-[#202326]"
                />
              </label>

              {bundleDrafts.length ? (
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-mdn-dark-border dark:bg-[#202326]">
                  {bundleDrafts.map((draft) => (
                    <div
                      key={draft.id}
                      className="grid gap-2 rounded-xl bg-white p-3 text-sm dark:bg-[#18191b] md:grid-cols-[minmax(0,1fr)_110px_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 dark:text-mdn-dark-text">
                          {draft.file.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-mdn-dark-muted">
                          {formatBytes(draft.file.size)}
                        </div>
                      </div>
                      <input
                        value={draft.year}
                        onChange={(event) =>
                          updateDraftYear(draft.id, event.target.value)
                        }
                        className="rounded-xl border border-slate-250 bg-white px-3 py-2 text-sm outline-none dark:border-mdn-dark-border dark:bg-[#202326]"
                        inputMode="numeric"
                        aria-label="Jahrgang"
                      />
                      <button
                        type="button"
                        onClick={() => removeDraft(draft.id)}
                        className="rounded-xl border border-slate-250 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                      >
                        Entfernen
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                    Embedding-Modell
                  </span>
                  <select
                    value={embeddingModel}
                    onChange={(event) =>
                      setEmbeddingModel(
                        event.target.value as EmbeddingModelName,
                      )
                    }
                    className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
                  >
                    {EMBEDDING_MODEL_OPTIONS.map((option) => (
                      <option key={option.model} value={option.model}>
                        {option.label} · {option.model}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={
                    busy || !bundleDrafts.length || !assignmentKey.trim()
                  }
                  className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                >
                  {busy ? "Import läuft" : "Bundles speichern"}
                </button>
              </div>
            </form>
            {message ? (
              <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
                {error}
              </p>
            ) : null}
            <ImportWarnings bundles={importReports} />
          </Card>

          <div className="space-y-6">
            <Card
              title="Gespeicherte Bundles"
              eyebrow="Lokal"
              description="Diese Bundles liegen im Drift-Out-Verzeichnis. Wenn ein Jahrgang falsch ist, lösche das Bundle und berechne den Drift neu."
              actions={
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={
                    running ||
                    validSubmissionZipCount === 0 ||
                    !assignmentKey.trim()
                  }
                  className="rounded-2xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                >
                  {running ? "Berechnung läuft" : "Drift berechnen"}
                </button>
              }
            >
              <StoredBundleList
                bundles={storedBundles}
                deletingId={deletingId}
                onDelete={handleDeleteBundle}
              />
            </Card>

            <Card
              title="Filter"
              eyebrow="Ansicht"
              description="Jahrgänge und Cluster lassen sich ausblenden, ohne neue Artefakte zu berechnen."
            >
              <div className="space-y-5">
                <FilterGroup
                  title="Jahrgänge"
                  values={years.map(String)}
                  selected={new Set([...selectedYears].map(String))}
                  onToggle={(value) => toggleYear(Number(value))}
                />
                <FilterGroup
                  title="Cluster"
                  values={clusters.map((cluster) => cluster.clusterId)}
                  selected={selectedClusters}
                  onToggle={toggleCluster}
                />
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-mdn-dark-border dark:bg-[#202326]">
                  <input
                    type="checkbox"
                    checked={showNeighbors}
                    onChange={(event) => setShowNeighbors(event.target.checked)}
                  />
                  Nachbarschaften anzeigen
                </label>
              </div>
            </Card>
          </div>
        </div>

        {!artifacts ? (
          <Card
            title="Kein Drift-Dashboard geladen"
            eyebrow="Artefakte"
            description="Importiere Bundles, speichere sie lokal und starte danach die Drift-Berechnung."
          >
            <div className="text-sm text-slate-600 dark:text-mdn-dark-muted">
              {run?.status && run.status !== "published"
                ? `Aktueller Run: ${run.status}`
                : "Noch keine gespeicherten Drift-Artefakte für diese Auswahl gefunden."}
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <DriftOverviewCards overview={artifacts.overview} />
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <DriftEmbeddingMapByYear
                points={filteredPoints}
                allPoints={artifacts.projection.points}
                years={years}
                clusters={clusters}
                selectedId={selectedId}
                onSelect={selectPoint}
                showNeighbors={showNeighbors}
                neighborIds={neighborIds}
              />
              <DriftEmbeddingMapByCluster
                points={filteredPoints}
                allPoints={artifacts.projection.points}
                years={years}
                clusters={clusters}
                selectedId={selectedId}
                onSelect={selectPoint}
                showNeighbors={showNeighbors}
                neighborIds={neighborIds}
              />
            </div>
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <DriftClusterDistributionChart
                stats={artifacts.year_stats}
                clusters={artifacts.clusters}
              />
              <DriftCentroidTimelineChart
                stats={artifacts.year_stats}
                years={years}
              />
            </div>
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <DriftYearSimilarityHeatmap
                matrix={artifacts.year_similarity_matrix}
              />
              <DriftOutlierChart stats={artifacts.year_stats} />
            </div>
            <DriftClusterSummaryTable
              clusters={artifacts.clusters}
              years={years}
            />
            <DriftSubmissionDetailPanel
              point={selectedPoint}
              neighbors={neighborRows}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function StoredBundleList({
  bundles,
  deletingId,
  onDelete,
}: {
  bundles: DriftBundle[];
  deletingId: string | null;
  onDelete: (bundleId: string) => void;
}) {
  if (!bundles.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted">
        Keine Bundles gespeichert.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {bundles.map((bundle) => (
        <div
          key={bundle.bundleId}
          className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-mdn-dark-border dark:bg-[#202326]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-950 dark:text-mdn-dark-text">
                {bundle.originalFilename}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-mdn-dark-muted">
                Jahrgang {bundle.year} · {bundle.validSubmissionZipCount ?? 0}{" "}
                Student-ZIPs · {formatBytes(bundle.sizeBytes ?? 0)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDelete(bundle.bundleId)}
              disabled={deletingId === bundle.bundleId}
              className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-45 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              {deletingId === bundle.bundleId ? "Löscht" : "Löschen"}
            </button>
          </div>
          <IgnoredSummary bundle={bundle} />
        </div>
      ))}
    </div>
  );
}

function ImportWarnings({ bundles }: { bundles: DriftBundle[] }) {
  if (!bundles.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {bundles.map((bundle) => (
        <div
          key={bundle.bundleId}
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
        >
          <div className="font-semibold">{bundle.originalFilename}</div>
          <IgnoredSummary bundle={bundle} />
        </div>
      ))}
    </div>
  );
}

function IgnoredSummary({ bundle }: { bundle: DriftBundle }) {
  const ignoredFiles = bundle.manifest?.ignoredFiles ?? [];
  const ignoredZips = bundle.manifest?.ignoredZips ?? [];
  const ignoredCount = ignoredFiles.length + ignoredZips.length;
  if (!ignoredCount && bundle.importStatus === "ok") return null;
  return (
    <div className="mt-3 space-y-2 text-xs text-slate-600 dark:text-mdn-dark-muted">
      <div>
        Ignorierte Dateien: {bundle.ignoredLooseFileCount ?? 0} · Zips ohne
        Java-Dateien: {bundle.ignoredZipWithoutJavaCount ?? 0}
        {bundle.ignoredCorruptZipCount
          ? ` · beschädigte Zips: ${bundle.ignoredCorruptZipCount}`
          : ""}
      </div>
      {bundle.importStatus === "no_java_submissions" ? (
        <div className="font-semibold text-amber-800 dark:text-amber-200">
          Dieses Bundle enthält keine verwertbare Student-ZIP mit Java-Dateien.
        </div>
      ) : null}
      {ignoredCount ? (
        <details>
          <summary className="cursor-pointer font-semibold">
            Ignorierte Einträge anzeigen
          </summary>
          <div className="mt-2 max-h-36 space-y-1 overflow-auto rounded-xl bg-white/70 p-2 dark:bg-[#18191b]">
            {[...ignoredFiles, ...ignoredZips].slice(0, 80).map((item) => (
              <div key={`${item.reason}-${item.path}`} className="truncate">
                {item.path} · {reasonLabel(item)}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FilterGroup({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
        {title}
      </div>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                selected.has(value)
                  ? "border-slate-950 bg-slate-950 text-white dark:border-mdn-dark-text dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                  : "border-slate-250 bg-white text-slate-600 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500 dark:text-mdn-dark-muted">
          Keine Werte geladen.
        </div>
      )}
    </div>
  );
}

function deriveYear(filename: string) {
  const match = filename.match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
  return match?.[1] ?? null;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function reasonLabel(item: DriftIgnoredEntry) {
  if (item.reason === "loose_java_file") return "lose Java-Datei";
  if (item.reason === "zip_without_java") return "Zip ohne Java-Dateien";
  if (item.reason === "invalid_zip") return "beschädigte Zip";
  return "keine Submission-ZIP";
}

function compareClusterItems(
  a: { clusterId: string },
  b: { clusterId: string },
) {
  return a.clusterId.localeCompare(b.clusterId, undefined, { numeric: true });
}
