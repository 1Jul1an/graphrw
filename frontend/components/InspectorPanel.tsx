import { bytesLabel, componentWeightLabel, formatSpaceLabel, shortId } from "../lib/format";
import type { PairDetail, Selection, SpaceKey, SubmissionDetail } from "../lib/types";
import { Card } from "./Card";
import { Metric } from "./Metric";
import { SectionBlock } from "./SectionBlock";
import { SimpleTable } from "./SimpleTable";

type Props = {
  activeSpace: SpaceKey;
  selection: Selection;
  submissionDetail: SubmissionDetail | null;
  pairDetail: PairDetail | null;
};

export function InspectorPanel({ activeSpace, selection, submissionDetail, pairDetail }: Props) {
  const currentSpace = selection?.space ?? activeSpace;

  if (!selection) {
    return (
      <Card
        eyebrow="Inspector"
        title="Kontext zum aktiven Raum"
      >
        <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 dark:border-mdn-dark-border dark:bg-mdn-dark-surface px-5 py-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-mdn-dark-text">Noch keine Auswahl</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-mdn-dark-muted">Aktiver Raum: <strong>{formatSpaceLabel(currentSpace)}</strong>.</p>
        </div>
      </Card>
    );
  }

  if (selection.kind === "node" && submissionDetail) {
    const spaceView = submissionDetail.spaces?.[currentSpace];

    return (
      <Card
        eyebrow={`Inspector · ${formatSpaceLabel(currentSpace)}`}
        title={submissionDetail.submission.submission_name}
        description={submissionDetail.submission.submission_id}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Metric label="Status" value={submissionDetail.submission.ingestion_status} tone="accent" />
          <Metric label="Java-Dateien" value={String(submissionDetail.submission.stats?.relevant_java_file_count ?? 0)} />
          <Metric label="Ignoriert" value={String(submissionDetail.submission.stats?.ignored_entry_count ?? 0)} />
          <Metric label="Graph-Grad" value={String(spaceView?.graph_degree ?? 0)} />
        </div>

        <div className="mt-5 space-y-5">
          <SectionBlock title={`Top-Dimensionen in ${formatSpaceLabel(currentSpace)}`}>
            <SimpleTable
              headers={["Feature", "Wert", "Anteil"]}
              rows={(spaceView?.top_dimensions ?? []).map((item) => [item.feature, String(item.value), `${(item.share * 100).toFixed(1)}%`])}
            />
          </SectionBlock>

          <SectionBlock title="Vergleichsdimensionen">
            <SimpleTable
              headers={["Feature", "Gewichteter Wert", "Anteil"]}
              rows={(spaceView?.comparison_dimensions ?? []).map((item) => [item.feature, String(item.value), `${(item.share * 100).toFixed(1)}%`])}
            />
          </SectionBlock>

          {currentSpace !== "fusion" ? (
            <SectionBlock title="Standardisierte Kontrastdimensionen">
              <SimpleTable
                headers={["Feature", "Z-Wert", "Anteil"]}
                rows={(spaceView?.standardized_dimensions ?? []).map((item) => [item.feature, String(item.value), `${(item.share * 100).toFixed(1)}%`])}
              />
            </SectionBlock>
          ) : null}

          <SectionBlock title="Top-Nachbarn im aktuellen Raum">
            <SimpleTable
              headers={["Kante", "Gewicht", "Typ"]}
              rows={(spaceView?.top_neighbors ?? []).map((edge) => {
                const other = edge.source === submissionDetail.submission.submission_id ? edge.target : edge.source;
                return [other, edge.weight.toFixed(3), edge.edge_type];
              })}
            />
          </SectionBlock>

          <SectionBlock title="Cluster-Zuordnung">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metric label="Cluster-ID" value={spaceView?.cluster_membership?.cluster_id ?? "-"} />
              <Metric label="Clustergröße" value={String(spaceView?.cluster_membership?.size ?? "-")} />
            </div>
          </SectionBlock>

          <SectionBlock title="Dateien, die in den Vektor eingeflossen sind">
            <div className="space-y-4">
              {submissionDetail.included_files.map((item) => (
                <article key={item.file.file_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
                  <div className="border-b border-slate-150 dark:border-mdn-dark-border px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">{item.file.basename}</h4>
                        <div className="mt-1 text-sm text-slate-600 dark:text-mdn-dark-muted">{item.file.relative_path}</div>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-muted">
                        {bytesLabel(item.file.size_bytes)}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-mdn-dark-muted">
                      <span>Hash {shortId(item.file.sha256)}</span>
                      {currentSpace === "struct" && item.ast ? (
                        <span>
                          AST {item.ast.provider ?? "-"} · Nodes {item.ast.node_count ?? 0} · Depth {item.ast.max_depth ?? 0}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <SimpleTable
                      headers={["Feature", "Wert"]}
                      rows={Object.entries(item.spaces?.[currentSpace] ?? {})
                        .sort((left, right) => Math.abs(Number(right[1])) - Math.abs(Number(left[1])))
                        .slice(0, 8)
                        .map(([feature, value]) => [feature, String(value)])}
                    />

                    {currentSpace === "struct" && item.ast?.top_paths?.length ? (
                      <SimpleTable
                        headers={["AST-Pfad", "Count"]}
                        rows={item.ast.top_paths.slice(0, 5).map((entry) => [entry.path, String(entry.count)])}
                      />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </SectionBlock>
        </div>
      </Card>
    );
  }

  if (selection.kind === "edge" && pairDetail) {
    return (
      <Card
        eyebrow={`Inspector · ${formatSpaceLabel(currentSpace)}`}
        title="Kanten-Inspector"
        description={`${pairDetail.submission_a.submission_name} ↔ ${pairDetail.submission_b.submission_name}`}
      >
        <div className="mb-4 text-sm text-slate-600 dark:text-mdn-dark-muted">
          Metrik <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{pairDetail.method}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Metric label="Similarity kalibriert" value={pairDetail.relation_cal.toFixed(3)} tone="accent" />
          <Metric label="Similarity roh" value={pairDetail.relation_raw.toFixed(3)} />
          <Metric label="Im Graph" value={pairDetail.graph_edge.is_present ? "ja" : "nein"} />
          <Metric label="Kantentyp" value={pairDetail.graph_edge.edge_type ?? "-"} />
        </div>

        <div className="mt-5 space-y-5">
          <SectionBlock title="Score-Komponenten">
            <SimpleTable
              headers={["Komponente", "Wert", "Gewicht"]}
              rows={Object.entries(pairDetail.score_components ?? {}).map(([key, value]) => [
                key,
                Number(value).toFixed(4),
                componentWeightLabel(key, pairDetail.score_weights),
              ])}
            />
          </SectionBlock>

          {currentSpace === "fusion" && pairDetail.source_scores ? (
            <SectionBlock title="Beiträge der Primärräume">
              <SimpleTable
                headers={["Raum", "Score"]}
                rows={Object.entries(pairDetail.source_scores).map(([key, value]) => [key, Number(value).toFixed(4)])}
              />
            </SectionBlock>
          ) : null}

          <SectionBlock title="Stärkste gemeinsame Signale">
            <SimpleTable
              headers={["Feature", "A", "B", "Beitrag"]}
              rows={pairDetail.top_common_signals.map((item) => [
                item.feature,
                String(item.left_value),
                String(item.right_value),
                item.contribution.toFixed(4),
              ])}
            />
          </SectionBlock>

          <SectionBlock title="Größte Unterschiede">
            <SimpleTable
              headers={["Feature", "A", "B", "Gap"]}
              rows={pairDetail.top_differing_signals.map((item) => [
                item.feature,
                String(item.left_value),
                String(item.right_value),
                item.absolute_gap.toFixed(4),
              ])}
            />
          </SectionBlock>
        </div>
      </Card>
    );
  }

  return (
    <Card eyebrow="Inspector" title="Daten werden geladen">
      <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 dark:border-mdn-dark-border dark:bg-mdn-dark-surface px-5 py-6 text-sm text-slate-600 dark:text-mdn-dark-muted">Lade Daten…</div>
    </Card>
  );
}
