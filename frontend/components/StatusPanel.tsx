import { compactEngineLabel } from "../lib/format";
import type { EngineKey, RunPayload } from "../lib/types";
import { Card } from "./Card";
import { Metric } from "./Metric";

type Props = {
  activeEngine: EngineKey;
  assignmentId: string | null;
  uploadId: string | null;
  run: RunPayload | null;
  error: string | null;
};

export function StatusPanel({ activeEngine, assignmentId, uploadId, run, error }: Props) {
  return (
    <Card eyebrow="Pipeline" title="Status und Laufdaten">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label="Engine" value={compactEngineLabel(run?.engine ?? activeEngine)} tone="accent" />
        <Metric label="Assignment" value={assignmentId ?? "-"} />
        <Metric label="Upload" value={uploadId ?? "-"} />
        <Metric label="Run" value={run?.run_id ?? "-"} />
        <Metric label="Run-Status" value={run?.status ?? "idle"} tone="accent" />
        {run?.engine === "engine2" ? <Metric label="Embedding-Modell" value={run.embedding_model ?? "-"} /> : null}
      </div>

      {run?.pipeline_status ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-slate-100 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-text">
          <div className="border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300 dark:border-mdn-dark-border dark:text-mdn-dark-muted">
            Pipeline-Status
          </div>
          <pre className="overflow-x-auto px-4 py-4 text-xs leading-6">{JSON.stringify(run.pipeline_status, null, 2)}</pre>
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      ) : null}
    </Card>
  );
}
