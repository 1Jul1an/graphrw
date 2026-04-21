"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DocsSidebar } from "../components/DocsSidebar";
import { GraphsGrid } from "../components/GraphsGrid";
import { InspectorPanel } from "../components/InspectorPanel";
import { PageHeader } from "../components/PageHeader";
import { StatusPanel } from "../components/StatusPanel";
import { TopBar } from "../components/TopBar";
import { UploadForm } from "../components/UploadForm";
import { WorkspaceSummary } from "../components/WorkspaceSummary";
import {
  SPACES,
  type GraphPayload,
  type PairDetail,
  type RunPayload,
  type Selection,
  type SpaceKey,
  type SubmissionDetail,
} from "../lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";

export default function Page() {
  const [assignmentName, setAssignmentName] = useState("Assignment MVP Demo");
  const [bundle, setBundle] = useState<File | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [run, setRun] = useState<RunPayload | null>(null);
  const [activeSpace, setActiveSpace] = useState<SpaceKey>("expr");
  const [graphs, setGraphs] = useState<Partial<Record<SpaceKey, GraphPayload>>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null);
  const [pairDetail, setPairDetail] = useState<PairDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!run?.run_id || !assignmentId) return;
    if (run.status === "published" || run.status === "failed") return;

    const handle = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE.replace(/\/$/, "")}/analysis-runs/${run.run_id}`);
        const nextRun = (await response.json()) as RunPayload;
        setRun(nextRun);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);

    return () => window.clearInterval(handle);
  }, [assignmentId, run?.run_id, run?.status]);

  useEffect(() => {
    if (!assignmentId || run?.status !== "published") return;

    let cancelled = false;

    async function loadAllGraphs() {
      try {
        const responses = await Promise.allSettled(
          SPACES.map(async (space) => {
            const response = await fetch(`${API_BASE.replace(/\/$/, "")}/assignments/${assignmentId}/graphs?space=${space}`);
            if (!response.ok) {
              throw new Error(`Graph ${space} konnte nicht geladen werden (${response.status}).`);
            }
            const payload = (await response.json()) as GraphPayload;
            return [space, payload] as const;
          }),
        );

        if (cancelled) return;

        const nextGraphs: Partial<Record<SpaceKey, GraphPayload>> = {};
        const graphErrors: string[] = [];

        responses.forEach((result) => {
          if (result.status === "fulfilled") {
            const [space, payload] = result.value;
            nextGraphs[space] = payload;
          } else {
            graphErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
          }
        });

        setGraphs(nextGraphs);
        setError(graphErrors.length ? graphErrors.join(" ") : null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    loadAllGraphs();

    return () => {
      cancelled = true;
    };
  }, [assignmentId, run?.status]);

  useEffect(() => {
    if (!assignmentId || !selection || run?.status !== "published") {
      setSubmissionDetail(null);
      setPairDetail(null);
      return;
    }

    const selectedSpace = selection.space;

    if (selection.kind === "node") {
      fetch(`${API_BASE.replace(/\/$/, "")}/assignments/${assignmentId}/submissions/${selection.submissionId}`)
        .then((response) => response.json())
        .then((payload) => {
          setSubmissionDetail(payload);
          setPairDetail(null);
          setActiveSpace(selectedSpace);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
      return;
    }

    fetch(
      `${API_BASE.replace(/\/$/, "")}/assignments/${assignmentId}/pairs/${selection.source}/${selection.target}?space=${selectedSpace}`,
    )
      .then((response) => response.json())
      .then((payload) => {
        setPairDetail(payload);
        setSubmissionDetail(null);
        setActiveSpace(selectedSpace);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [assignmentId, selection, run?.status]);

  const canStart = useMemo(() => Boolean(bundle) && !busy, [bundle, busy]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!bundle) return;

    setBusy(true);
    setError(null);
    setGraphs({});
    setSelection(null);
    setSubmissionDetail(null);
    setPairDetail(null);
    setActiveSpace("expr");

    try {
      const assignmentForm = new FormData();
      assignmentForm.append("name", assignmentName);
      const createAssignmentResponse = await fetch(`${API_BASE.replace(/\/$/, "")}/assignments`, {
        method: "POST",
        body: assignmentForm,
      });
      const assignment = await createAssignmentResponse.json();
      setAssignmentId(assignment.assignment_id);

      const uploadForm = new FormData();
      uploadForm.append("file", bundle);
      const uploadResponse = await fetch(`${API_BASE.replace(/\/$/, "")}/assignments/${assignment.assignment_id}/upload-bundle`, {
        method: "POST",
        body: uploadForm,
      });
      const upload = await uploadResponse.json();
      setUploadId(upload.upload_id);

      const runForm = new FormData();
      runForm.append("upload_id", upload.upload_id);
      runForm.append("auto_publish", "true");
      const runResponse = await fetch(`${API_BASE.replace(/\/$/, "")}/assignments/${assignment.assignment_id}/analysis-runs`, {
        method: "POST",
        body: runForm,
      });
      const runPayload = (await runResponse.json()) as RunPayload;
      setRun(runPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-75 text-slate-900 dark:bg-mdn-dark-bg dark:text-mdn-dark-text">
      <TopBar activeSpace={activeSpace} run={run} />

      <div className="w-full px-4 sm:px-6 lg:px-8 2xl:px-10">
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[272px_minmax(0,1fr)]">
          <aside className="hidden xl:block py-8">
            <DocsSidebar activeSpace={activeSpace} graphs={graphs} run={run} />
          </aside>

          <main className="min-w-0 py-8">
            <PageHeader activeSpace={activeSpace} hasGraphs={Object.keys(graphs).length > 0} />

            <div className="space-y-6">
              <section id="setup" className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
                <UploadForm
                  assignmentName={assignmentName}
                  bundleName={bundle?.name ?? null}
                  busy={busy}
                  canStart={canStart}
                  onSubmit={handleSubmit}
                  onAssignmentNameChange={setAssignmentName}
                  onBundleChange={setBundle}
                />
                <StatusPanel assignmentId={assignmentId} uploadId={uploadId} run={run} error={error} />
              </section>

              <section id="workspace">
                <WorkspaceSummary graphs={graphs} activeSpace={activeSpace} />
              </section>

              <section id="graphs" className="w-full">
                <GraphsGrid
                  graphs={graphs}
                  activeSpace={activeSpace}
                  selection={selection}
                  onActivateSpace={setActiveSpace}
                  onNodeSelect={(space, submissionId) => {
                    setActiveSpace(space);
                    setSelection({ space, kind: "node", submissionId });
                  }}
                  onEdgeSelect={(space, source, target) => {
                    setActiveSpace(space);
                    setSelection({ space, kind: "edge", source, target });
                  }}
                  onClearSelection={() => setSelection(null)}
                />
              </section>

              <section id="inspector">
                <InspectorPanel
                  activeSpace={activeSpace}
                  selection={selection}
                  submissionDetail={submissionDetail}
                  pairDetail={pairDetail}
                />
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
