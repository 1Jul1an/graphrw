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
  DriftWorkspaceCentroidSmallMultiples,
  DriftWorkspaceOverviewCards,
  DriftWorkspaceSummaryTable,
  DriftWorkspaceTransitionHeatmap,
  DriftSubmissionDetailPanel,
  DriftSubmissionExplorer,
  DriftYearClusterSubmissionMatrix,
  DriftYearSimilarityHeatmap,
} from "../../components/drift/DriftComponents";
import {
  EMBEDDING_MODEL_OPTIONS,
  type DriftArtifacts,
  type DriftBundle,
  type DriftIgnoredEntry,
  type DriftProjectionPoint,
  type DriftRunPayload,
  type DriftWorkspaceOverview,
  type DriftWorkspaceRunBatch,
  type EmbeddingModelName,
} from "../../lib/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";
const api = (path: string) => `${API_BASE.replace(/\/$/, "")}${path}`;

const DRIFT_RUN_POLL_INITIAL_MS = 2_000;
const DRIFT_RUN_POLL_MAX_MS = 20_000;
const DRIFT_RUN_POLL_BACKOFF_MS = 4_000;

type WorkspaceTabKey = "lab" | "all";

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

type WorkspaceBundleDraft = BundleDraft & {
  assignmentKey: string;
};

export default function DriftPage() {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>("lab");
  const [assignmentKey, setAssignmentKey] = useState("prog2_lab2");
  const [year, setYear] = useState("2026");
  const [bundleDrafts, setBundleDrafts] = useState<BundleDraft[]>([]);
  const [storedBundles, setStoredBundles] = useState<DriftBundle[]>([]);
  const [importReports, setImportReports] = useState<DriftBundle[]>([]);
  const [embeddingModel, setEmbeddingModel] =
    useState<EmbeddingModelName>("qwen3-embedding:0.6b");
  const [assignments, setAssignments] = useState<DriftAssignment[]>([]);
  const [run, setRun] = useState<DriftRunPayload | null>(null);
  const [artifacts, setArtifacts] = useState<DriftArtifacts | null>(null);
  const [workspaceOverview, setWorkspaceOverview] = useState<DriftWorkspaceOverview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceDrafts, setWorkspaceDrafts] = useState<WorkspaceBundleDraft[]>([]);
  const [workspaceImportReports, setWorkspaceImportReports] = useState<DriftBundle[]>([]);
  const [workspaceBatch, setWorkspaceBatch] = useState<DriftWorkspaceRunBatch | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceRunning, setWorkspaceRunning] = useState(false);
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
    loadLatest(assignmentKey, embeddingModel);
  }, [assignmentKey, embeddingModel]);

  useEffect(() => {
    if (activeTab !== "all") return;
    loadWorkspaceOverview();
  }, [activeTab, embeddingModel]);

  useEffect(() => {
    if (!run?.runId || run.status === "published" || run.status === "failed") {
      return;
    }

    let cancelled = false;
    let timeoutHandle: number | null = null;
    let nextDelayMs = DRIFT_RUN_POLL_INITIAL_MS;

    const scheduleNextPoll = () => {
      if (cancelled) return;
      timeoutHandle = window.setTimeout(pollRunStatus, nextDelayMs);
      nextDelayMs = Math.min(
        nextDelayMs + DRIFT_RUN_POLL_BACKOFF_MS,
        DRIFT_RUN_POLL_MAX_MS,
      );
    };

    const pollRunStatus = async () => {
      try {
        const response = await fetch(
          api(`/drift/runs/${encodeURIComponent(run.runId)}`),
          { cache: "no-store" },
        );
        if (!response.ok) {
          scheduleNextPoll();
          return;
        }
        const latest = (await response.json()) as DriftRunPayload;
        if (cancelled) return;
        setRun(latest);
        if (latest.status === "published") {
          await loadArtifacts(latest.runId, false);
          if (!cancelled) setRunning(false);
          return;
        }
        if (latest.status === "failed") {
          setRunning(false);
          return;
        }
        scheduleNextPoll();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          scheduleNextPoll();
        }
      }
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [run?.runId, run?.status]);

  useEffect(() => {
    const runs = workspaceBatch?.runs ?? [];
    if (!runs.length) return;
    if (runs.every((item) => item.status === "published" || item.status === "failed")) {
      setWorkspaceRunning(false);
      loadWorkspaceOverview();
      return;
    }

    let cancelled = false;
    const timeoutHandle = window.setTimeout(async () => {
      try {
        const updated = await Promise.all(
          runs.map(async (item) => {
            if (item.status === "published" || item.status === "failed") return item;
            const response = await fetch(api(`/drift/runs/${encodeURIComponent(item.runId)}`), { cache: "no-store" });
            return response.ok ? ((await response.json()) as DriftRunPayload) : item;
          }),
        );
        if (cancelled) return;
        setWorkspaceBatch((current) => current ? { ...current, runs: updated } : current);
        if (updated.some((item) => item.status === "published")) {
          await loadWorkspaceOverview();
        }
      } catch (err) {
        if (!cancelled) setWorkspaceError(err instanceof Error ? err.message : String(err));
      }
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutHandle);
    };
  }, [workspaceBatch?.runs.map((item) => `${item.runId}:${item.status}:${item.progress?.heartbeatAt ?? ""}`).join("|")]);


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

  async function loadLatest(key: string, model: EmbeddingModelName = embeddingModel) {
    setError(null);
    try {
      const params = new URLSearchParams({
        assignment_key: key.trim(),
        embedding_model: model,
      });
      const response = await fetch(api(`/drift/runs/latest?${params.toString()}`));
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

  async function loadWorkspaceOverview() {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const params = new URLSearchParams({ embedding_model: embeddingModel });
      const response = await fetch(api(`/drift/workspace/overview?${params.toString()}`), { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Workspace-Daten konnten nicht geladen werden (${response.status}).`);
      }
      setWorkspaceOverview((await response.json()) as DriftWorkspaceOverview);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceOverview(null);
    } finally {
      setWorkspaceLoading(false);
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

  function handleWorkspaceFiles(files: FileList | null) {
    if (!files?.length) return;
    const drafts = Array.from(files).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-workspace-${index}`,
      file,
      year: deriveYear(file.name) ?? year,
      assignmentKey: deriveAssignmentKey(file.name),
    }));
    setWorkspaceDrafts((current) => [...current, ...drafts]);
  }

  function updateWorkspaceDraft(id: string, patch: Partial<Pick<WorkspaceBundleDraft, "assignmentKey" | "year">>) {
    setWorkspaceDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  }

  function removeWorkspaceDraft(id: string) {
    setWorkspaceDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  async function handleWorkspaceImport(event: FormEvent) {
    event.preventDefault();
    if (!workspaceDrafts.length) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    setWorkspaceImportReports([]);
    try {
      const reports: DriftBundle[] = [];
      for (const draft of workspaceDrafts) {
        if (!draft.assignmentKey.trim() || !draft.year.trim()) {
          throw new Error("Jedes Bundle braucht assignmentKey und Jahrgang.");
        }
        const uploadForm = new FormData();
        uploadForm.append("assignment_key", draft.assignmentKey.trim());
        uploadForm.append("year", draft.year.trim());
        uploadForm.append("file", draft.file);
        const response = await fetch(api("/drift/bundles"), { method: "POST", body: uploadForm });
        const payload = (await response.json()) as DriftBundle & { detail?: string };
        if (!response.ok) {
          throw new Error(payload.detail ?? `Bundle konnte nicht importiert werden (${response.status}).`);
        }
        reports.push(payload);
      }
      setWorkspaceImportReports(reports);
      setWorkspaceDrafts([]);
      await loadAssignments();
      await loadWorkspaceOverview();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function handleWorkspaceRun(forceRecompute = false) {
    setWorkspaceRunning(true);
    setWorkspaceError(null);
    try {
      const runForm = new FormData();
      runForm.append("embedding_model", embeddingModel);
      runForm.append("top_k", "8");
      runForm.append("force_recompute", forceRecompute ? "true" : "false");
      const response = await fetch(api("/drift/workspace/runs"), { method: "POST", body: runForm });
      const payload = (await response.json()) as DriftWorkspaceRunBatch & { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? `Workspace-Runs konnten nicht gestartet werden (${response.status}).`);
      }
      setWorkspaceBatch(payload);
      if (!payload.runs.length) {
        setWorkspaceRunning(false);
      }
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceRunning(false);
    }
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

  async function handleRun(forceRecompute = false) {
    if (!assignmentKey.trim()) return;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const runForm = new FormData();
      runForm.append("assignment_key", assignmentKey.trim());
      runForm.append("embedding_model", embeddingModel);
      runForm.append("top_k", "8");
      runForm.append("force_recompute", forceRecompute ? "true" : "false");
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
      setMessage(
        forceRecompute
          ? `Drift-Berechnung mit ${embeddingModel} gestartet. Der Embedding-Cache wird für diesen Run umgangen.`
          : `Drift-Berechnung mit ${embeddingModel} gestartet.`,
      );
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

  const visibleYears = useMemo(
    () => years.filter((item) => selectedYears.has(item)),
    [years, selectedYears],
  );
  const visibleClusters = useMemo(
    () => clusters.filter((cluster) => selectedClusters.has(cluster.clusterId)),
    [clusters, selectedClusters],
  );

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
              Drift-Workspace
            </h1>
            <p className="mt-3 max-w-[78ch] text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">
              Einzelne Labs werden pro Jahrgang ausgewertet. Die Workspace-Ansicht
              vergleicht veröffentlichte Lab-Drifts nebeneinander, ohne alle Labs
              in einen gemeinsamen Vektorraum zu werfen.
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

        <div className="mb-6 flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white/70 p-2 dark:border-mdn-dark-border dark:bg-[#202326]">
          <TabButton
            active={activeTab === "lab"}
            onClick={() => setActiveTab("lab")}
            label="Drift Lab pro Jahr"
          />
          <TabButton
            active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
            label="Drift all Labs aller Jahre"
          />
        </div>

        {activeTab === "lab" ? (
          <>
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
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleRun(false)}
                    disabled={
                      running ||
                      validSubmissionZipCount === 0 ||
                      !assignmentKey.trim()
                    }
                    className="rounded-2xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                  >
                    {running ? "Berechnung läuft" : "Drift berechnen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRun(true)}
                    disabled={
                      running ||
                      validSubmissionZipCount === 0 ||
                      !assignmentKey.trim()
                    }
                    title="Berechnet die Embeddings neu und ignoriert vorhandene Embedding-Cache-Treffer. Die neuen Werte werden danach wieder in den Cache geschrieben."
                    className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100 dark:hover:bg-amber-950/35"
                  >
                    Frisch berechnen
                  </button>
                </div>
              }
            >
              <StoredBundleList
                bundles={storedBundles}
                deletingId={deletingId}
                onDelete={handleDeleteBundle}
              />
            </Card>

            {run ? <DriftRunStatusCard run={run} /> : null}

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
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <DriftYearClusterSubmissionMatrix
                points={filteredPoints}
                years={visibleYears}
                clusters={visibleClusters}
                selectedId={selectedId}
                onSelect={selectPoint}
              />
              <DriftSubmissionExplorer
                points={filteredPoints}
                selectedId={selectedId}
                onSelect={selectPoint}
              />
            </div>
            <DriftSubmissionDetailPanel
              point={selectedPoint}
              neighbors={neighborRows}
            />
          </div>
        )}
          </>
        ) : (
          <DriftAllLabsWorkspace
            embeddingModel={embeddingModel}
            onEmbeddingModelChange={setEmbeddingModel}
            workspace={workspaceOverview}
            loading={workspaceLoading}
            error={workspaceError}
            onRefresh={loadWorkspaceOverview}
            drafts={workspaceDrafts}
            importReports={workspaceImportReports}
            batch={workspaceBatch}
            busy={workspaceBusy}
            running={workspaceRunning}
            onFiles={handleWorkspaceFiles}
            onDraftChange={updateWorkspaceDraft}
            onDraftRemove={removeWorkspaceDraft}
            onImport={handleWorkspaceImport}
            onRun={handleWorkspaceRun}
          />
        )}
      </main>
    </div>
  );
}


function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-slate-950 text-white shadow-sm dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
          : "text-slate-600 hover:bg-slate-100 dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
      }`}
    >
      {label}
    </button>
  );
}

function DriftAllLabsWorkspace({
  embeddingModel,
  onEmbeddingModelChange,
  workspace,
  loading,
  error,
  onRefresh,
  drafts,
  importReports,
  batch,
  busy,
  running,
  onFiles,
  onDraftChange,
  onDraftRemove,
  onImport,
  onRun,
}: {
  embeddingModel: EmbeddingModelName;
  onEmbeddingModelChange: (model: EmbeddingModelName) => void;
  workspace: DriftWorkspaceOverview | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  drafts: WorkspaceBundleDraft[];
  importReports: DriftBundle[];
  batch: DriftWorkspaceRunBatch | null;
  busy: boolean;
  running: boolean;
  onFiles: (files: FileList | null) => void;
  onDraftChange: (id: string, patch: Partial<Pick<WorkspaceBundleDraft, "assignmentKey" | "year">>) => void;
  onDraftRemove: (id: string) => void;
  onImport: (event: FormEvent) => void;
  onRun: (forceRecompute?: boolean) => void;
}) {
  const finishedRuns = batch?.runs.filter((item) => item.status === "published" || item.status === "failed").length ?? 0;
  const totalRuns = batch?.runs.length ?? 0;
  return (
    <div className="space-y-6">
      <Card
        title="Alle Labs hochladen"
        eyebrow="Workspace"
        description="Lade hier die Bundles für mehrere Labs und Jahrgänge hoch. Jede Datei bekommt einen assignmentKey und einen Jahrgang. Danach werden pro Lab eigene Drift-Runs berechnet; die Labs werden nicht in einen gemeinsamen Vektorraum gemischt."
      >
        <form className="space-y-5" onSubmit={onImport}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                Bundle ZIPs
              </span>
              <input
                type="file"
                multiple
                accept=".zip,application/zip"
                onChange={(event) => onFiles(event.target.files)}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm dark:border-mdn-dark-border dark:bg-[#202326]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
                Embedding-Modell
              </span>
              <select
                value={embeddingModel}
                onChange={(event) => onEmbeddingModelChange(event.target.value as EmbeddingModelName)}
                className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
              >
                {EMBEDDING_MODEL_OPTIONS.map((option) => (
                  <option key={option.model} value={option.model}>
                    {option.label} · {option.model}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {drafts.length ? (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-mdn-dark-border dark:bg-[#202326]">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="grid gap-2 rounded-xl bg-white p-3 text-sm dark:bg-[#18191b] lg:grid-cols-[minmax(0,1fr)_220px_110px_auto] lg:items-center"
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
                    value={draft.assignmentKey}
                    onChange={(event) => onDraftChange(draft.id, { assignmentKey: event.target.value })}
                    className="rounded-xl border border-slate-250 bg-white px-3 py-2 text-sm outline-none dark:border-mdn-dark-border dark:bg-[#202326]"
                    aria-label="assignmentKey"
                    placeholder="prog2_lab2"
                  />
                  <input
                    value={draft.year}
                    onChange={(event) => onDraftChange(draft.id, { year: event.target.value })}
                    className="rounded-xl border border-slate-250 bg-white px-3 py-2 text-sm outline-none dark:border-mdn-dark-border dark:bg-[#202326]"
                    inputMode="numeric"
                    aria-label="Jahrgang"
                    placeholder="2026"
                  />
                  <button
                    type="button"
                    onClick={() => onDraftRemove(draft.id)}
                    className="rounded-xl border border-slate-250 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                  >
                    Entfernen
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !drafts.length}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
            >
              {busy ? "Import läuft" : "Workspace-Bundles speichern"}
            </button>
            <button
              type="button"
              onClick={() => onRun(false)}
              disabled={running || busy}
              className="rounded-2xl border border-slate-250 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
            >
              {running ? "Berechnung läuft" : "Alle Labs berechnen"}
            </button>
            <button
              type="button"
              onClick={() => onRun(true)}
              disabled={running || busy}
              title="Berechnet die Embeddings neu und ignoriert vorhandene Embedding-Cache-Treffer."
              className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
            >
              Frisch berechnen
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="rounded-2xl border border-slate-250 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
            >
              {loading ? "Lädt" : "Übersicht aktualisieren"}
            </button>
          </div>
        </form>

        {error ? (
          <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-[#202326] dark:text-mdn-dark-muted">
            Workspace-Daten werden geladen.
          </p>
        ) : null}
        <ImportWarnings bundles={importReports} />
      </Card>

      {batch ? (
        <Card
          title="Workspace-Berechnung"
          eyebrow="Runs"
          description="Für jedes Lab wird ein eigener Drift-Run gestartet. Die Übersicht füllt sich, sobald einzelne Labs veröffentlicht sind."
        >
          <div className="mb-4 flex flex-wrap gap-3 text-sm text-slate-600 dark:text-mdn-dark-muted">
            <StatusMetric label="Gestartet" value={`${totalRuns}`} />
            <StatusMetric label="Fertig oder Fehler" value={`${finishedRuns}/${totalRuns}`} />
            <StatusMetric label="Cache-Modus" value={batch.cachePolicy === "bypass_embedding_cache" ? "Cache wird umgangen" : "Cache wird genutzt"} />
          </div>
          {batch.runs.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {batch.runs.map((item) => (
                <div key={item.runId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-mdn-dark-border dark:bg-[#202326]">
                  <div className="font-semibold text-slate-950 dark:text-mdn-dark-text">{item.assignmentKey}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-mdn-dark-muted">
                    {item.status} · {item.progress?.stageLabel ?? "Wartet"}
                  </div>
                  {item.progress?.percent !== undefined ? (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#2a2d30]">
                      <div className="h-full rounded-full bg-slate-950 dark:bg-mdn-dark-text" style={{ width: `${Math.max(0, Math.min(100, Number(item.progress.percent ?? 0)))}%` }} />
                    </div>
                  ) : null}
                  {item.error ? <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">{item.error}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
              Keine Labs gestartet. Wahrscheinlich gibt es noch kein Lab mit mindestens zwei Jahrgängen und gültigen Student-ZIPs.
            </div>
          )}
          {batch.skipped?.length ? (
            <details className="mt-4 text-sm text-slate-600 dark:text-mdn-dark-muted">
              <summary className="cursor-pointer font-semibold">Übersprungene Labs anzeigen</summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {batch.skipped.map((item) => (
                  <div key={`${item.assignmentKey}-${item.reason}`} className="rounded-xl bg-white px-3 py-2 dark:bg-[#18191b]">
                    {item.assignmentKey}: {item.reason}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </Card>
      ) : null}

      {workspace && workspace.labCount > 0 ? (
        <>
          <DriftWorkspaceOverviewCards workspace={workspace} />
          <DriftWorkspaceTransitionHeatmap workspace={workspace} />
          <DriftWorkspaceCentroidSmallMultiples workspace={workspace} />
          <DriftWorkspaceSummaryTable workspace={workspace} />
        </>
      ) : !loading ? (
        <Card
          title="Noch keine Workspace-Auswertung"
          eyebrow="Alle Labs"
          description="Lade mehrere Lab/Jahrgang-Bundles hoch und starte danach die Berechnung. Die Ansicht nutzt pro assignmentKey den neuesten veröffentlichten Drift-Run des gewählten Modells."
        >
          <div className="text-sm text-slate-600 dark:text-mdn-dark-muted">
            Direktes Hochladen ist jetzt der Standardweg für diese Ansicht. Einzelne Labs musst du nicht vorher manuell im anderen Tab vorbereiten.
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function DriftRunStatusCard({ run }: { run: DriftRunPayload }) {
  const progress = run.progress;
  const percent = Math.max(0, Math.min(100, Number(progress?.percent ?? 0)));
  const total = Number(progress?.total ?? 0);
  const current = Number(progress?.current ?? 0);
  const heartbeatAge = heartbeatAgeSeconds(progress?.heartbeatAt);
  const heartbeatState =
    run.status === "running" && heartbeatAge !== null && heartbeatAge > 120
      ? "stale"
      : "fresh";
  const cache = progress?.cache;
  const pipelineEntries = Object.entries(run.pipelineStatus ?? {});

  return (
    <Card
      title="Berechnungsstatus"
      eyebrow="Drift-Run"
      description="Der Status kommt direkt aus dem Backend-Run. Solange sich Phase, Zähler oder Lebenszeichen ändern, arbeitet die Berechnung weiter."
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Aktuelle Phase
            </div>
            <div className="mt-1 text-base font-semibold text-slate-950 dark:text-mdn-dark-text">
              {progress?.stageLabel ?? run.status}
            </div>
          </div>
          <div
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              run.status === "published"
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                : run.status === "failed"
                  ? "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
                  : "bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200"
            }`}
          >
            {run.status}
          </div>
        </div>

        {progress?.message ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted">
            {progress.message}
          </div>
        ) : null}

        {total > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-mdn-dark-muted">
              <span>
                {current}/{total}
              </span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#2a2d30]">
              <div
                className="h-full rounded-full bg-slate-950 transition-all dark:bg-mdn-dark-text"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <StatusMetric
            label="Lebenszeichen"
            value={progress?.heartbeatAt ? formatDateTime(progress.heartbeatAt) : "noch nicht"}
            tone={heartbeatState === "stale" ? "warn" : "default"}
          />
          <StatusMetric
            label="Modell"
            value={run.embeddingModel ?? "nicht gesetzt"}
          />
          {progress?.currentSubmissionId ? (
            <StatusMetric
              label="Aktuelle Submission"
              value={progress.currentSubmissionId}
            />
          ) : null}
          {cache ? (
            <StatusMetric
              label="Embedding Cache"
              value={
                run.forceRecompute || run.cachePolicy === "bypass_embedding_cache"
                  ? `${cache.bypassed ?? 0} umgangen · ${cache.writes ?? 0} geschrieben`
                  : `${cache.hits ?? 0} Treffer · ${cache.misses ?? 0} neu · ${cache.writes ?? 0} geschrieben`
              }
              tone={run.forceRecompute || run.cachePolicy === "bypass_embedding_cache" ? "warn" : "default"}
            />
          ) : null}
          <StatusMetric
            label="Cache-Modus"
            value={
              run.forceRecompute || run.cachePolicy === "bypass_embedding_cache"
                ? "Embedding-Cache wird umgangen"
                : "Embedding-Cache wird genutzt"
            }
            tone={run.forceRecompute || run.cachePolicy === "bypass_embedding_cache" ? "warn" : "default"}
          />
        </div>

        {heartbeatState === "stale" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            Seit mehr als zwei Minuten kam kein neues Lebenszeichen. Das kann ein sehr langer Ollama-Request sein, sollte aber beobachtet werden.
          </div>
        ) : null}

        {pipelineEntries.length ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Pipeline
            </div>
            <div className="flex flex-wrap gap-2">
              {pipelineEntries.map(([name, status]) => (
                <span
                  key={name}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${pipelineTone(status)}`}
                >
                  {name}: {status}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {progress?.events?.length ? (
          <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-mdn-dark-border dark:bg-[#202326]">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Letzte Schritte
            </summary>
            <div className="mt-3 space-y-2">
              {[...progress.events].reverse().map((event, index) => (
                <div key={`${event.at}-${index}`} className="text-xs text-slate-600 dark:text-mdn-dark-muted">
                  <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">
                    {event.at ? formatDateTime(event.at) : "Zeit offen"}
                  </span>{" "}
                  · {event.message ?? event.stage ?? "Status aktualisiert"}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function StatusMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
        {label}
      </div>
      <div className="mt-1 break-words text-xs font-semibold">{value}</div>
    </div>
  );
}

function pipelineTone(status: string) {
  if (status === "done") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200";
  }
  if (status === "running") {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-200";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted";
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

function deriveAssignmentKey(filename: string) {
  const base = filename
    .replace(/\.zip$/i, "")
    .replace(/(?:^|[_\-\s])((?:19|20)\d{2})(?:$|[_\-\s])/g, "_")
    .replace(/(?:^|[_\-\s])jahr(?:gang)?[_\-\s]*((?:19|20)\d{2})(?:$|[_\-\s])/gi, "_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "assignment";
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function heartbeatAgeSeconds(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
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
