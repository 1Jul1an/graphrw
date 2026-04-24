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

function TextList({ items }: { items: string[] }) {
  if (!items.length) return <div className="text-sm text-slate-500 dark:text-mdn-dark-muted">-</div>;
  return (
    <div className="space-y-2 text-sm leading-7 text-slate-700 dark:text-mdn-dark-text">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="rounded-xl border border-slate-150 bg-slate-25 px-3 py-2 dark:border-mdn-dark-border dark:bg-[#18191b]">
          {item}
        </div>
      ))}
    </div>
  );
}

export function InspectorPanel({ activeSpace, selection, submissionDetail, pairDetail }: Props) {
  const currentSpace = selection?.space ?? activeSpace;

  if (!selection) {
    return (
      <Card eyebrow="Inspector" title="Kontext zum aktiven Raum">
        <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 px-5 py-6 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
          <h3 className="text-base font-semibold text-slate-900 dark:text-mdn-dark-text">Noch keine Auswahl</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-mdn-dark-muted">
            Aktiver Raum: <strong>{formatSpaceLabel(currentSpace)}</strong>.
          </p>
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
          {spaceView?.explanation ? (
            <SectionBlock title="Warum liegt diese Lösung hier?">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-150 bg-slate-25 px-4 py-4 text-sm leading-7 text-slate-700 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-text">
                  {spaceView.explanation.summary}
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">
                      stärkste Nachbarn
                    </div>
                    <TextList items={spaceView.explanation.neighbor_story ?? []} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">
                      was hier gleich ist
                    </div>
                    <TextList items={spaceView.explanation.why_here ?? []} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">
                      was sie vom Rest trennt
                    </div>
                    <TextList items={spaceView.explanation.why_not_else ?? []} />
                  </div>
                </div>
              </div>
            </SectionBlock>
          ) : null}

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Cluster" value={spaceView?.cluster_membership?.cluster_label ?? (spaceView?.cluster_membership?.is_noise ? "Noise" : "-")} />
              <Metric label="Clustergröße" value={String(spaceView?.cluster_membership?.size ?? "-")} />
              <Metric label="Mitgliedschaft" value={spaceView?.cluster_membership?.membership_strength?.toFixed(3) ?? "-"} />
              <Metric label="Methode" value={spaceView?.cluster_membership?.method ?? "-"} />
            </div>
          </SectionBlock>

          {spaceView?.cluster_diagnostics ? (
            <SectionBlock title="Cluster-Diagnostik">
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Dichte" value={Number(spaceView.cluster_diagnostics.summary_metrics?.internal_density ?? 0).toFixed(3)} />
                  <Metric label="Ø Similarity" value={Number(spaceView.cluster_diagnostics.summary_metrics?.avg_pair_similarity ?? 0).toFixed(3)} />
                  <Metric label="Ø Mitgliedschaft" value={Number(spaceView.cluster_diagnostics.summary_metrics?.mean_membership_strength ?? 0).toFixed(3)} />
                  <Metric label="Span" value={Number(spaceView.cluster_diagnostics.summary_metrics?.cluster_span ?? 0).toFixed(3)} />
                </div>

                {spaceView.cluster_diagnostics.explanation ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-150 bg-slate-25 px-4 py-4 text-sm leading-7 text-slate-700 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-text">
                      {spaceView.cluster_diagnostics.explanation.summary}
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">Kernbasis</div>
                        <TextList items={(spaceView.cluster_diagnostics.explanation.cohesion_basis ?? []).map((item) => item.label)} />
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">typische Vertreter</div>
                        <TextList items={spaceView.cluster_diagnostics.explanation.core_members ?? []} />
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">Rand zum Rest</div>
                        <TextList items={(spaceView.cluster_diagnostics.explanation.boundary_basis ?? []).map((item) => item.label)} />
                      </div>
                    </div>
                  </div>
                ) : null}

                <SimpleTable
                  headers={["Signatur-Feature", "Cluster", "Rest", "Lift"]}
                  rows={(spaceView.cluster_diagnostics.signature_features ?? []).map((item) => [item.feature, item.cluster_mean.toFixed(3), item.rest_mean.toFixed(3), item.lift.toFixed(3)])}
                />
                {(spaceView.cluster_diagnostics.contrast_features ?? []).length ? (
                  <SimpleTable
                    headers={["Kontrast-Feature", "Cluster", "Rest", "Lift"]}
                    rows={(spaceView.cluster_diagnostics.contrast_features ?? []).map((item) => [item.feature, item.cluster_mean.toFixed(3), item.rest_mean.toFixed(3), item.lift.toFixed(3)])}
                  />
                ) : null}
                <SimpleTable
                  headers={["Zentrale Mitglieder", "Ø intern"]}
                  rows={(spaceView.cluster_diagnostics.central_members ?? []).map((item) => [item.submission_name, item.mean_internal_similarity.toFixed(3)])}
                />
                <SimpleTable
                  headers={["Stärkste interne Kanten", "Gewicht"]}
                  rows={(spaceView.cluster_diagnostics.strongest_internal_pairs ?? []).map((item) => [`${item.source_name} ↔ ${item.target_name}`, item.weight.toFixed(3)])}
                />
                <SimpleTable
                  headers={["Nächste Außenkanten", "Gewicht"]}
                  rows={(spaceView.cluster_diagnostics.nearest_external_pairs ?? []).map((item) => [`${item.source_name} ↔ ${item.target_name}`, item.weight.toFixed(3)])}
                />
              </div>
            </SectionBlock>
          ) : null}

          <SectionBlock title="Dateien, die in den Vektor eingeflossen sind">
            <div className="space-y-4">
              {submissionDetail.included_files.map((item) => (
                <article key={item.file.file_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
                  <div className="border-b border-slate-150 px-5 py-4 dark:border-mdn-dark-border">
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
                      {currentSpace === "struct" && item.ast ? <span>AST {item.ast.provider ?? "-"} · Nodes {item.ast.node_count ?? 0} · Depth {item.ast.max_depth ?? 0}</span> : null}
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
                      <SimpleTable headers={["AST-Pfad", "Count"]} rows={item.ast.top_paths.slice(0, 5).map((entry) => [entry.path, String(entry.count)])} />
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
          {pairDetail.explanation ? (
            <SectionBlock title="Warum sind diese beiden ähnlich?">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-150 bg-slate-25 px-4 py-4 text-sm leading-7 text-slate-700 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-text">
                  {pairDetail.explanation.summary}
                </div>
                <SimpleTable
                  headers={["Dimension", "Stärke", "Urteil", "Belege"]}
                  rows={(pairDetail.explanation.agreement_profile ?? []).map((item) => [item.label, item.strength.toFixed(4), item.verdict, item.evidence.join(", ") || "-"])}
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">stärkste gemeinsame Muster</div>
                    <TextList items={(pairDetail.explanation.top_shared_patterns ?? []).map((item) => item.label)} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">größte Trennmuster</div>
                    <TextList items={(pairDetail.explanation.top_separating_patterns ?? []).map((item) => item.label)} />
                  </div>
                </div>
              </div>
            </SectionBlock>
          ) : null}

          <SectionBlock title="Score-Komponenten">
            <SimpleTable
              headers={["Komponente", "Wert", "Gewicht"]}
              rows={Object.entries(pairDetail.score_components ?? {}).map(([key, value]) => [key, Number(value).toFixed(4), componentWeightLabel(key, pairDetail.score_weights)])}
            />
          </SectionBlock>

          {pairDetail.diagnostics && Object.keys(pairDetail.diagnostics).length ? (
            <SectionBlock title="Diagnostik">
              <SimpleTable headers={["Signal", "Wert"]} rows={Object.entries(pairDetail.diagnostics).map(([key, value]) => [key, String(value)])} />
            </SectionBlock>
          ) : null}

          {currentSpace === "fusion" && pairDetail.source_scores ? (
            <SectionBlock title="Beiträge der Primärräume">
              <SimpleTable headers={["Raum", "Score"]} rows={Object.entries(pairDetail.source_scores).map(([key, value]) => [key, Number(value).toFixed(4)])} />
            </SectionBlock>
          ) : null}

          <SectionBlock title="Stärkste gemeinsame Signale">
            <SimpleTable
              headers={["Feature", "A", "B", "Beitrag"]}
              rows={pairDetail.top_common_signals.map((item) => [item.feature, String(item.left_value), String(item.right_value), item.contribution.toFixed(4)])}
            />
          </SectionBlock>

          <SectionBlock title="Größte Unterschiede">
            <SimpleTable
              headers={["Feature", "A", "B", "Gap"]}
              rows={pairDetail.top_differing_signals.map((item) => [item.feature, String(item.left_value), String(item.right_value), item.absolute_gap.toFixed(4)])}
            />
          </SectionBlock>
        </div>
      </Card>
    );
  }

  return (
    <Card eyebrow="Inspector" title="Daten werden geladen">
      <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 px-5 py-6 text-sm text-slate-600 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted">
        Lade Daten…
      </div>
    </Card>
  );
}
