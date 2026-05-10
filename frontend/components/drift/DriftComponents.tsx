"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card } from "../Card";
import type {
  DriftCluster,
  DriftClusters,
  DriftNeighbor,
  DriftNeighbors,
  DriftOverview,
  DriftProjectionPoint,
  DriftYearSimilarityMatrix,
  DriftYearStats,
  DriftWorkspaceOverview,
  DriftWorkspaceLab,
} from "../../lib/types";

const YEAR_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#4f46e5",
  "#65a30d",
];
const CLUSTER_COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#84cc16",
  "#f43f5e",
  "#6366f1",
  "#64748b",
];
const BOUNDARY_COLOR = "#94a3b8";

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

type MapProps = {
  points: DriftProjectionPoint[];
  allPoints: DriftProjectionPoint[];
  years: number[];
  clusters: DriftCluster[];
  selectedId: string | null;
  onSelect: (point: DriftProjectionPoint) => void;
  showNeighbors?: boolean;
  neighborIds?: Set<string>;
};



export function DriftWorkspaceOverviewCards({ workspace }: { workspace: DriftWorkspaceOverview }) {
  const values = [
    { label: "Labs", value: String(workspace.labCount) },
    { label: "Submissions", value: String(workspace.totalSubmissions) },
    { label: "Jahrgänge", value: workspace.years.join(", ") || "-" },
    { label: "Jahresübergänge", value: workspace.transitions.join(", ") || "-" },
    { label: "Embedding-Modell", value: workspace.embeddingModel || "alle Modelle" },
  ];
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {values.map((item) => (
        <div key={item.label} className="docs-card p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">
            {item.label}
          </div>
          <div className="mt-2 break-words text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-mdn-dark-text">
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}

export function DriftWorkspaceTransitionHeatmap({ workspace }: { workspace: DriftWorkspaceOverview }) {
  const labs = workspace.labs;
  const transitions = workspace.transitions;
  return (
    <Card
      title="Drift pro Lab und Jahresübergang"
      eyebrow="Lab-Vergleich"
      description="Jedes Lab wird aus seinem eigenen Drift-Run gelesen. Die Zellen zeigen den normierten Centroid-Sprung innerhalb dieses Labs."
    >
      {!labs.length ? (
        <EmptyWorkspaceMessage />
      ) : (
        <div className="overflow-x-auto">
          <div
            className="min-w-[860px] rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]"
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(180px, 1.2fr) repeat(${Math.max(1, transitions.length)}, minmax(110px, 1fr))`,
              gap: "8px",
            }}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              assignmentKey
            </div>
            {transitions.map((transition) => (
              <div key={transition} className="text-center text-xs font-semibold tabular-nums text-slate-600 dark:text-mdn-dark-muted">
                {transition}
              </div>
            ))}
            {labs.map((lab) => (
              <FragmentRow key={lab.assignmentKey}>
                <div className="flex items-center rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 dark:bg-[#18191b] dark:text-mdn-dark-text">
                  {lab.assignmentKey}
                </div>
                {transitions.map((transition) => {
                  const item = lab.transitions.find((row) => row.transition === transition);
                  const value = item?.normalizedDistance ?? null;
                  const label = item
                    ? `${item.distance2d.toFixed(3)} · sim ${item.similarity == null ? "-" : item.similarity.toFixed(3)}`
                    : "-";
                  return (
                    <div
                      key={`${lab.assignmentKey}-${transition}`}
                      className="flex min-h-[58px] items-center justify-center rounded-xl text-center text-xs font-semibold tabular-nums shadow-sm"
                      style={{
                        backgroundColor: value === null ? "transparent" : heatColor(value, 0, 1),
                        color: value === null ? undefined : heatTextColor(heatRatio(value, 0, 1)),
                        border: value === null ? "1px dashed rgba(148, 163, 184, 0.45)" : undefined,
                      }}
                      title={item ? `${lab.assignmentKey} · ${transition}: Distanz ${item.distance2d.toFixed(4)}, normiert ${item.normalizedDistance.toFixed(3)}` : `${lab.assignmentKey} · ${transition}: keine Daten`}
                    >
                      {label}
                    </div>
                  );
                })}
              </FragmentRow>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-mdn-dark-muted">
        <span>kleiner Sprung</span>
        <span className="h-3 w-40 rounded-full" style={{ background: "linear-gradient(90deg, #dbeafe, #1d4ed8)" }} />
        <span>größter Sprung im Lab</span>
      </div>
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "workspace_lab_transition_heatmap",
          embeddingModel: workspace.embeddingModel,
          transitions: workspace.transitions,
          labs: workspace.labs.map((lab) => ({
            assignmentKey: lab.assignmentKey,
            transitions: lab.transitions,
          })),
        }}
      />
    </Card>
  );
}

export function DriftWorkspaceCentroidSmallMultiples({ workspace }: { workspace: DriftWorkspaceOverview }) {
  const labs = workspace.labs;
  return (
    <Card
      title="Jahrgangs-Centroid-Drift pro Lab"
      eyebrow="Zeitlinien"
      description="Jede Karte zeigt die Bewegung der Jahrgangszentren innerhalb eines Labs. Die Achsen werden pro Lab skaliert."
    >
      {!labs.length ? (
        <EmptyWorkspaceMessage />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {labs.map((lab) => (
            <LabCentroidMiniChart key={lab.assignmentKey} lab={lab} allYears={workspace.years} />
          ))}
        </div>
      )}
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "workspace_centroid_small_multiples",
          labs: workspace.labs.map((lab) => ({
            assignmentKey: lab.assignmentKey,
            centroids: lab.centroids,
            totalDrift: lab.totalDrift,
            pathLength: lab.pathLength,
            maxJump: lab.maxJump,
            maxJumpTransition: lab.maxJumpTransition,
          })),
        }}
      />
    </Card>
  );
}

export function DriftWorkspaceSummaryTable({ workspace }: { workspace: DriftWorkspaceOverview }) {
  const rows = [...workspace.labs].sort((a, b) => b.maxJump - a.maxJump || b.totalDrift - a.totalDrift || a.assignmentKey.localeCompare(b.assignmentKey));
  return (
    <Card
      title="Lab Drift Summary"
      eyebrow="Vergleich"
      description="Diese Tabelle fasst pro Lab den Pfad der Jahrgangszentren zusammen. Große Sprünge markieren starke Veränderungen zwischen zwei Jahrgängen."
    >
      {!rows.length ? (
        <EmptyWorkspaceMessage />
      ) : (
        <div className="overflow-x-auto">
          <table className="docs-table min-w-[980px]">
            <thead>
              <tr>
                <th>assignmentKey</th>
                <th>Jahrgänge</th>
                <th>Submissions</th>
                <th>Cluster</th>
                <th>Randpunkte</th>
                <th>Gesamtdrift</th>
                <th>Pfadlänge</th>
                <th>Größter Sprung</th>
                <th>Ø Ähnlichkeit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lab) => (
                <tr key={lab.assignmentKey}>
                  <td className="font-semibold text-slate-950 dark:text-mdn-dark-text">{lab.assignmentKey}</td>
                  <td>{lab.includedYears.join(", ")}</td>
                  <td className="tabular-nums">{lab.totalSubmissions}</td>
                  <td className="tabular-nums">{lab.clusterCount}</td>
                  <td className="tabular-nums">{lab.boundaryPointCount}</td>
                  <td className="tabular-nums">{lab.totalDrift.toFixed(4)}</td>
                  <td className="tabular-nums">{lab.pathLength.toFixed(4)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-[#2a2d30]">
                      {lab.maxJumpTransition ?? "-"} · {lab.maxJump.toFixed(4)}
                    </span>
                  </td>
                  <td className="tabular-nums">{lab.meanAdjacentSimilarity == null ? "-" : lab.meanAdjacentSimilarity.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {workspace.missingAssignments?.length ? (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
            Labs ohne veröffentlichte Artefakte
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {workspace.missingAssignments.map((item) => (
              <span key={`${item.assignmentKey}-${item.reason}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-muted">
                {item.assignmentKey} · {item.reason}
              </span>
            ))}
          </div>
        </details>
      ) : null}
      <JsonDisclosure
        title="Daten dieser Tabelle als JSON"
        data={{ view: "workspace_lab_drift_summary", ...workspace }}
      />
    </Card>
  );
}

function EmptyWorkspaceMessage() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 p-6 text-sm text-slate-500 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted">
      Noch keine veröffentlichten Drift-Runs für diese Auswahl vorhanden.
    </div>
  );
}

function LabCentroidMiniChart({ lab, allYears }: { lab: DriftWorkspaceLab; allYears: number[] }) {
  const width = 420;
  const height = 260;
  const margin = { top: 26, right: 26, bottom: 32, left: 36 };
  const points = lab.centroids.map((point) => ({ x: point.x, y: point.y, year: point.year, submissionCount: point.submissionCount }));
  const bounds = boundsFor(points);
  const sx = (x: number) => scale(x, bounds.minX, bounds.maxX, margin.left, width - margin.right);
  const sy = (y: number) => scale(y, bounds.minY, bounds.maxY, height - margin.bottom, margin.top);
  const polyline = points.map((point) => `${sx(point.x)},${sy(point.y)}`).join(" ");
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-950 dark:text-mdn-dark-text">{lab.assignmentKey}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-mdn-dark-muted">
            {lab.totalSubmissions} Submissions · größter Sprung {lab.maxJumpTransition ?? "-"}
          </div>
        </div>
        <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums dark:bg-[#2a2d30]">
          {lab.maxJump.toFixed(3)}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-xl border border-slate-100 bg-slate-50 dark:border-mdn-dark-border dark:bg-[#18191b]">
        <Grid width={width} height={height} margin={margin} />
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth={2} className="text-slate-400 dark:text-mdn-dark-muted" />
        {points.map((point) => (
          <g key={`${lab.assignmentKey}-${point.year}`}>
            <circle cx={sx(point.x)} cy={sy(point.y)} r={7} fill={yearColor(point.year, allYears)} stroke="white" strokeWidth={2}>
              <title>{`${lab.assignmentKey} · ${point.year}: (${point.x.toFixed(4)}, ${point.y.toFixed(4)}) · ${point.submissionCount} Submissions`}</title>
            </circle>
            <text x={sx(point.x) + 10} y={sy(point.y) - 8} className="fill-slate-700 text-[11px] font-semibold dark:fill-mdn-dark-text">
              {point.year}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function DriftOverviewCards({ overview }: { overview: DriftOverview }) {
  const cache = overview.embeddingCacheStats;
  const values = [
    { label: "Assignment Key", value: overview.assignmentKey },
    { label: "Submissions", value: String(overview.totalSubmissions) },
    { label: "Jahrgänge", value: overview.includedYears.join(", ") || "-" },
    { label: "Cluster", value: String(overview.clusterCount) },
    { label: "Randpunkte", value: String(overview.outlierCount) },
    { label: "Embedding-Modell", value: overview.embeddingModel || "-" },
    cache
      ? {
          label: "Embedding Cache",
          value: overview.forceRecompute || overview.embeddingCacheMode === "bypass_embedding_cache"
            ? `${cache.bypassed ?? 0} umgangen · ${cache.writes ?? 0} geschrieben`
            : `${cache.hits ?? 0} Treffer · ${cache.misses ?? 0} neu`,
        }
      : null,
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {values.map((item) => (
        <div key={item.label} className="docs-card p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">
            {item.label}
          </div>
          <div className="mt-2 break-words text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-mdn-dark-text">
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}

export function DriftEmbeddingMapByYear(props: MapProps) {
  return (
    <Card
      title="Embedding Map nach Jahrgang"
      eyebrow="Lösungsraum"
      description="Diese Ansicht zeigt, ob Jahrgänge räumlich zusammenliegen oder auseinanderdriften."
    >
      <ScatterPlot
        mode="year"
        points={props.points}
        allPoints={props.allPoints}
        years={props.years}
        clusters={props.clusters}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        showNeighbors={props.showNeighbors}
        neighborIds={props.neighborIds}
      />
      <DriftLegend
        title="Jahrgänge"
        items={props.years.map((year) => ({
          label: String(year),
          color: yearColor(year, props.years),
          shape: yearShapeForPoint(props.allPoints, year),
        }))}
      />
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "embedding_map_by_year",
          pointCount: props.points.length,
          points: props.points.map(pointJson),
        }}
      />
    </Card>
  );
}

export function DriftEmbeddingMapByCluster(props: MapProps) {
  return (
    <Card
      title="Embedding Map nach Cluster"
      eyebrow="Lösungsmuster"
      description="Diese Ansicht zeigt, welche Lösungsmuster unabhängig vom Jahr entstehen."
    >
      <ScatterPlot
        mode="cluster"
        points={props.points}
        allPoints={props.allPoints}
        years={props.years}
        clusters={props.clusters}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        showNeighbors={props.showNeighbors}
        neighborIds={props.neighborIds}
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <DriftLegend
          title="Clusterfarben"
          items={orderedClusters(props.clusters).map((cluster) => ({
            label: cluster.clusterId,
            color: clusterColor(cluster.clusterId, props.clusters),
          }))}
        />
        <DriftLegend
          title="Jahrgang-Shapes"
          items={props.years.map((year) => ({
            label: String(year),
            color: yearColor(year, props.years),
            shape: yearShapeForPoint(props.allPoints, year),
          }))}
        />
      </div>
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "embedding_map_by_cluster",
          pointCount: props.points.length,
          points: props.points.map(pointJson),
        }}
      />
    </Card>
  );
}

export function DriftClusterDistributionChart({
  stats,
  clusters,
}: {
  stats: DriftYearStats;
  clusters: DriftClusters;
}) {
  const ordered = orderedClusters(clusters.clusters);
  const clusterIds = ordered.map((cluster) => cluster.clusterId);

  return (
    <Card
      title="Cluster-Verteilung pro Jahr"
      eyebrow="Jahrgangsmix"
      description="Diese Ansicht zeigt, welche Cluster über die Jahre wachsen, verschwinden oder neu entstehen."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
        <div className="overflow-x-auto">
          <div className="flex min-w-[680px] items-end gap-4 border-b border-slate-200 pb-4 dark:border-mdn-dark-border">
            {stats.years.map((yearStat) => {
              const total = Math.max(
                1,
                Object.values(yearStat.clusterDistribution).reduce(
                  (sum, value) => sum + value,
                  0,
                ),
              );
              return (
                <div
                  key={yearStat.year}
                  className="flex min-w-[96px] flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-56 w-14 flex-col-reverse overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-mdn-dark-border dark:bg-[#18191b]">
                    {clusterIds.map((clusterId) => {
                      const value =
                        yearStat.clusterDistribution[clusterId] ?? 0;
                      const height = `${(value / total) * 100}%`;
                      return value > 0 ? (
                        <div
                          key={clusterId}
                          className="w-full"
                          style={{
                            height,
                            backgroundColor: clusterColor(clusterId, ordered),
                          }}
                          title={`${yearStat.year} · ${clusterId}: ${value} von ${total}`}
                        />
                      ) : null;
                    })}
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-semibold tabular-nums text-slate-800 dark:text-mdn-dark-text">
                      {yearStat.year}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-mdn-dark-muted">
                      {total} Submissions
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500 dark:text-mdn-dark-muted">
          y-Achse: Anteil innerhalb des jeweiligen Jahrgangs.
        </div>
      </div>
      <DriftLegend
        title="Cluster"
        items={ordered.map((cluster) => ({
          label: cluster.clusterId,
          color: clusterColor(cluster.clusterId, ordered),
        }))}
      />
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "cluster_distribution_by_year",
          years: stats.years.map((yearStat) => ({
            year: yearStat.year,
            submissionCount: yearStat.submissionCount,
            clusterDistribution: yearStat.clusterDistribution,
          })),
        }}
      />
    </Card>
  );
}

export function DriftCentroidTimelineChart({
  stats,
  years,
}: {
  stats: DriftYearStats;
  years: number[];
}) {
  const width = 760;
  const height = 400;
  const margin = { top: 28, right: 28, bottom: 40, left: 46 };
  const points = stats.years.map((item) => ({
    x: item.centroidX,
    y: item.centroidY,
    year: item.year,
  }));
  const bounds = boundsFor(points);
  const sx = (x: number) =>
    scale(x, bounds.minX, bounds.maxX, margin.left, width - margin.right);
  const sy = (y: number) =>
    scale(y, bounds.minY, bounds.maxY, height - margin.bottom, margin.top);
  const polyline = points
    .map((point) => `${sx(point.x)},${sy(point.y)}`)
    .join(" ");

  return (
    <Card
      title="Jahrgangs-Centroid-Drift"
      eyebrow="Zeitlinie"
      description="Diese Ansicht zeigt die Bewegung des durchschnittlichen Lösungsmusters über Zeit."
    >
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[720px] rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-[#202326]"
        >
          <Grid width={width} height={height} margin={margin} />
          <polyline
            points={polyline}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-slate-400 dark:text-mdn-dark-muted"
          />
          {points.map((point) => (
            <g key={point.year}>
              <circle
                cx={sx(point.x)}
                cy={sy(point.y)}
                r={8}
                fill={yearColor(point.year, years)}
                stroke="white"
                strokeWidth={2}
              >
                <title>{`${point.year} · Zentrum (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`}</title>
              </circle>
              <text
                x={sx(point.x) + 12}
                y={sy(point.y) - 10}
                className="fill-slate-700 text-xs font-semibold dark:fill-mdn-dark-text"
              >
                {point.year}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <DriftLegend
        title="Jahrgänge"
        items={years.map((year) => ({
          label: String(year),
          color: yearColor(year, years),
        }))}
      />
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{ view: "year_centroid_drift", centroids: points }}
      />
    </Card>
  );
}

export function DriftYearSimilarityHeatmap({
  matrix,
}: {
  matrix: DriftYearSimilarityMatrix;
}) {
  const years = matrix.years;
  const values = matrix.matrix.flat();
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  return (
    <Card
      title="Jahrgangs-Ähnlichkeitsmatrix"
      eyebrow="Nähe zwischen Jahrgängen"
      description="Diese Ansicht zeigt, welche Jahrgänge sich insgesamt ähnlich sind."
    >
      <div className="overflow-x-auto">
        <div
          className="min-w-[680px] rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]"
          style={{
            display: "grid",
            gridTemplateColumns: `84px repeat(${years.length}, minmax(72px, 1fr))`,
            gap: "8px",
          }}
        >
          <div aria-hidden="true" />
          {years.map((year) => (
            <div
              key={`x-${year}`}
              className="text-center text-xs font-semibold tabular-nums text-slate-600 dark:text-mdn-dark-muted"
            >
              {year}
            </div>
          ))}
          {matrix.matrix.map((row, yIndex) => (
            <FragmentRow key={`row-${years[yIndex]}`}>
              <div className="flex items-center justify-end pr-2 text-xs font-semibold tabular-nums text-slate-600 dark:text-mdn-dark-muted">
                {years[yIndex]}
              </div>
              {row.map((value, xIndex) => {
                const t = heatRatio(value, min, max);
                return (
                  <div
                    key={`${xIndex}-${yIndex}`}
                    className="flex h-16 items-center justify-center rounded-2xl text-sm font-semibold tabular-nums shadow-sm"
                    style={{
                      backgroundColor: heatColor(value, min, max),
                      color: heatTextColor(t),
                    }}
                    title={`${years[yIndex]} ↔ ${years[xIndex]}: ${value.toFixed(3)}`}
                  >
                    {value.toFixed(2)}
                  </div>
                );
              })}
            </FragmentRow>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-mdn-dark-muted">
        <span>niedrig</span>
        <span
          className="h-3 w-40 rounded-full"
          style={{ background: "linear-gradient(90deg, #dbeafe, #1d4ed8)" }}
        />
        <span>hoch</span>
      </div>
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "year_similarity_matrix",
          metric: matrix.metric,
          years: matrix.years,
          matrix: matrix.matrix,
        }}
      />
    </Card>
  );
}

export function DriftOutlierChart({ stats }: { stats: DriftYearStats }) {
  const maxValue = Math.max(1, ...stats.years.map((year) => year.outlierCount));
  return (
    <Card
      title="Randpunkte pro Jahr"
      eyebrow="Clusterbindung"
      description="Diese Ansicht zeigt, in welchen Jahrgängen besonders viele Lösungen am Rand bestehender Lösungsmuster liegen."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
        <div className="overflow-x-auto">
          <div className="flex min-w-[680px] items-end gap-4 border-b border-slate-200 pb-4 dark:border-mdn-dark-border">
            {stats.years.map((yearStat) => {
              const height = `${Math.max(4, (yearStat.outlierCount / maxValue) * 100)}%`;
              return (
                <div
                  key={yearStat.year}
                  className="flex min-w-[96px] flex-1 flex-col items-center gap-2"
                >
                  <div className="flex h-52 items-end">
                    <div
                      className="w-16 rounded-t-2xl bg-slate-400 dark:bg-slate-500"
                      style={{ height }}
                      title={`${yearStat.year}: ${yearStat.outlierCount} Randpunkte`}
                    />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-mdn-dark-text">
                      {yearStat.outlierCount}
                    </div>
                    <div className="text-xs font-medium tabular-nums text-slate-500 dark:text-mdn-dark-muted">
                      {yearStat.year}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500 dark:text-mdn-dark-muted">
          y-Achse: Anzahl der Randpunkte.
        </div>
      </div>
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "boundary_points_by_year",
          years: stats.years.map((yearStat) => ({
            year: yearStat.year,
            outlierCount: yearStat.outlierCount,
            submissionCount: yearStat.submissionCount,
          })),
        }}
      />
    </Card>
  );
}

export function DriftClusterSummaryTable({
  clusters,
  years,
}: {
  clusters: DriftClusters;
  years: number[];
}) {
  const ordered = orderedClusters(clusters.clusters);
  return (
    <Card
      title="Cluster Summary"
      eyebrow="Cluster und Jahrgänge"
      description="Diese Tabelle fasst die wichtigsten Cluster und ihre Jahresverteilung zusammen."
    >
      <div className="overflow-x-auto">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Cluster</th>
              <th>Größe</th>
              <th>Dominanter Jahrgang</th>
              <th>Jahresverteilung</th>
              <th>Status</th>
              <th>Beispiele</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((cluster) => (
              <tr key={cluster.clusterId}>
                <td>
                  <span className="inline-flex items-center gap-2 font-semibold text-slate-900 dark:text-mdn-dark-text">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{
                        backgroundColor: clusterColor(
                          cluster.clusterId,
                          ordered,
                        ),
                      }}
                    />
                    {cluster.clusterId}
                  </span>
                </td>
                <td>{cluster.size}</td>
                <td>{cluster.dominantYear ?? "-"}</td>
                <td>
                  <YearDistributionBars cluster={cluster} years={years} />
                </td>
                <td>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-[#2a2d30] dark:text-mdn-dark-muted">
                    {clusterStatus(cluster)}
                  </span>
                </td>
                <td>
                  <div className="max-w-[360px] break-words text-xs leading-5 text-slate-600 dark:text-mdn-dark-muted">
                    {cluster.exemplarSubmissions?.slice(0, 3).join(", ") || "-"}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <JsonDisclosure
        title="Daten dieser Tabelle als JSON"
        data={{
          view: "cluster_summary",
          clusters: ordered.map((cluster) => ({
            clusterId: cluster.clusterId,
            size: cluster.size,
            dominantYear: cluster.dominantYear,
            yearDistribution: cluster.yearDistribution,
            status: clusterStatus(cluster),
            centroidX: roundNumber(cluster.centroidX),
            centroidY: roundNumber(cluster.centroidY),
            exemplarSubmissions: cluster.exemplarSubmissions ?? [],
          })),
        }}
      />
    </Card>
  );
}

export function DriftSubmissionDetailPanel({
  point,
  neighbors,
}: {
  point: DriftProjectionPoint | null;
  neighbors?: DriftNeighbor[];
}) {
  return (
    <Card
      title="Submission Detail"
      eyebrow="Punktauswahl"
      description="Beim Klick auf einen Punkt erscheinen hier Jahrgang, Cluster und nächste Nachbarn."
    >
      {!point ? (
        <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 p-6 text-sm text-slate-500 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted">
          Noch kein Punkt ausgewählt.
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
              <dl className="space-y-3 text-sm">
                <DetailRow label="submissionId" value={point.submissionId} />
                <DetailRow label="year" value={String(point.year)} />
                <DetailRow label="clusterId" value={point.clusterId} />
                <DetailRow label="Position" value={`(${point.x.toFixed(4)}, ${point.y.toFixed(4)})`} />
                <DetailRow
                  label="Randwert"
                  value={(point.outlierScore ?? 0).toFixed(3)}
                />
              </dl>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">
                Nächste Nachbarn
              </div>
              {neighbors?.length ? (
                <div className="space-y-2">
                  {neighbors.map((neighbor, index) => (
                    <div
                      key={`${neighbor.submissionId}-${neighbor.year}-${neighbor.clusterId}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-[#2a2d30]"
                    >
                      <span className="font-medium text-slate-900 dark:text-mdn-dark-text">
                        {neighbor.submissionId}
                      </span>
                      <span className="text-slate-600 dark:text-mdn-dark-muted">
                        {neighbor.year} · {neighbor.clusterId} ·{" "}
                        {neighbor.similarity.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500 dark:text-mdn-dark-muted">
                  Keine Nachbarn gespeichert.
                </div>
              )}
            </div>
          </div>
          <JsonDisclosure
            title="Daten dieser Submission als JSON"
            data={{
              view: "submission_detail",
              submission: pointJson(point),
              neighbors: (neighbors ?? []).map((neighbor) => ({
                submissionId: neighbor.submissionId,
                year: neighbor.year,
                clusterId: neighbor.clusterId,
                similarity: roundNumber(neighbor.similarity),
              })),
            }}
          />
        </>
      )}
    </Card>
  );
}


export function DriftYearClusterSubmissionMatrix({
  points,
  years,
  clusters,
  selectedId,
  onSelect,
}: {
  points: DriftProjectionPoint[];
  years: number[];
  clusters: DriftCluster[];
  selectedId: string | null;
  onSelect: (point: DriftProjectionPoint) => void;
}) {
  const ordered = orderedClusters(clusters);
  const grouped = useMemo(() => {
    const byKey = new Map<string, DriftProjectionPoint[]>();
    for (const point of points) {
      const key = `${point.year}::${point.clusterId}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push(point);
      byKey.set(key, bucket);
    }
    for (const bucket of byKey.values()) {
      bucket.sort(compareProjectionPoints);
    }
    return byKey;
  }, [points]);

  return (
    <Card
      title="Submission-Matrix nach Jahrgang und Cluster"
      eyebrow="Submission-Orte"
      description="Diese Ansicht zeigt, welche Submission in welchem Jahrgang und Cluster liegt. Die Listen in den Zellen sind ausklappbar."
    >
      <div className="overflow-x-auto">
        <table className="docs-table min-w-[900px]">
          <thead>
            <tr>
              <th>Jahrgang</th>
              {ordered.map((cluster) => (
                <th key={cluster.clusterId}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: clusterColor(cluster.clusterId, ordered) }}
                    />
                    {cluster.clusterId}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year}>
                <td className="font-semibold tabular-nums text-slate-900 dark:text-mdn-dark-text">
                  {year}
                </td>
                {ordered.map((cluster) => {
                  const bucket = grouped.get(`${year}::${cluster.clusterId}`) ?? [];
                  return (
                    <td key={`${year}-${cluster.clusterId}`} className="align-top">
                      {bucket.length ? (
                        <details className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-mdn-dark-border dark:bg-[#202326]">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-mdn-dark-text">
                            {bucket.length} Submission{bucket.length === 1 ? "" : "s"}
                          </summary>
                          <div className="mt-2 max-h-48 space-y-1 overflow-auto pr-1">
                            {bucket.map((point, index) => (
                              <button
                                key={`${point.submissionId}-${point.year}-${point.clusterId}-${index}`}
                                type="button"
                                onClick={() => onSelect(point)}
                                className={`block w-full rounded-lg px-2 py-1 text-left text-[11px] transition ${
                                  selectedId === point.submissionId
                                    ? "bg-slate-950 text-white dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                                    : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-[#18191b] dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                                }`}
                                title={`${point.submissionId} · x=${point.x.toFixed(3)} · y=${point.y.toFixed(3)}`}
                              >
                                <span className="font-semibold">{point.submissionId}</span>
                                <span className="ml-1 opacity-70">
                                  ({point.x.toFixed(3)}, {point.y.toFixed(3)})
                                </span>
                              </button>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-mdn-dark-muted">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <JsonDisclosure
        title="Daten dieser Ansicht als JSON"
        data={{
          view: "submission_matrix_by_year_and_cluster",
          years,
          clusters: ordered.map((cluster) => cluster.clusterId),
          cells: years.flatMap((year) =>
            ordered.map((cluster) => {
              const bucket = grouped.get(`${year}::${cluster.clusterId}`) ?? [];
              return {
                year,
                clusterId: cluster.clusterId,
                count: bucket.length,
                submissions: bucket.map((point) => pointJson(point)),
              };
            }),
          ),
        }}
      />
    </Card>
  );
}

export function DriftSubmissionExplorer({
  points,
  selectedId,
  onSelect,
}: {
  points: DriftProjectionPoint[];
  selectedId: string | null;
  onSelect: (point: DriftProjectionPoint) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...points]
      .sort(compareProjectionPoints)
      .filter((point) => {
        if (!needle) return true;
        return (
          point.submissionId.toLowerCase().includes(needle) ||
          String(point.year).includes(needle) ||
          point.clusterId.toLowerCase().includes(needle)
        );
      });
  }, [points, query]);

  return (
    <Card
      title="Submission Explorer"
      eyebrow="Punkte im Lösungsraum"
      description="Diese Tabelle macht jeden Punkt explizit sichtbar: Submission, Jahrgang, Cluster und 2D-Position. Ein Klick wählt die Submission in den Maps aus."
      actions={
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Submission, Jahrgang oder Cluster suchen"
          className="w-72 max-w-full rounded-2xl border border-slate-250 bg-white px-4 py-2.5 text-xs outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
        />
      }
    >
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-mdn-dark-border">
        <div className="max-h-[520px] overflow-auto">
          <table className="docs-table min-w-[900px]">
            <thead className="sticky top-0 z-10 bg-white dark:bg-[#202326]">
              <tr>
                <th>Submission</th>
                <th>Jahrgang</th>
                <th>Cluster</th>
                <th>x</th>
                <th>y</th>
                <th>Randwert</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((point, index) => (
                <tr
                  key={`${point.submissionId}-${point.year}-${point.clusterId}-${index}`}
                  className={selectedId === point.submissionId ? "bg-slate-50 dark:bg-[#202326]" : undefined}
                >
                  <td>
                    <button
                      type="button"
                      onClick={() => onSelect(point)}
                      className="break-all text-left font-semibold text-slate-950 underline-offset-2 hover:underline dark:text-mdn-dark-text"
                    >
                      {point.submissionId}
                    </button>
                  </td>
                  <td className="tabular-nums">{point.year}</td>
                  <td>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-[#2a2d30]">
                      {point.clusterId}
                    </span>
                  </td>
                  <td className="tabular-nums">{point.x.toFixed(4)}</td>
                  <td className="tabular-nums">{point.y.toFixed(4)}</td>
                  <td className="tabular-nums">{(point.outlierScore ?? 0).toFixed(3)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="text-sm text-slate-500 dark:text-mdn-dark-muted">
                    Keine Submissions für diese Filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <JsonDisclosure
        title="Daten dieser Tabelle als JSON"
        data={{
          view: "submission_explorer",
          count: rows.length,
          submissions: rows.map(pointJson),
        }}
      />
    </Card>
  );
}



export function DriftSubmissionDeepDiveDashboard({
  artifacts,
  selectedId,
  onSelect,
}: {
  artifacts: {
    overview: DriftOverview;
    projection: { points: DriftProjectionPoint[] };
    clusters: DriftClusters;
    neighbors?: DriftNeighbors;
  };
  selectedId: string | null;
  onSelect: (point: DriftProjectionPoint) => void;
}) {
  const years = artifacts.overview.includedYears;
  const clusters = orderedClusters(artifacts.clusters.clusters);
  const [focusYearValue, setFocusYearValue] = useState<string>(String(years[0] ?? ""));
  const [comparisonYears, setComparisonYears] = useState<Set<number>>(new Set());
  const [activeClusters, setActiveClusters] = useState<Set<string>>(new Set());
  const [labelMode, setLabelMode] = useState<"focus" | "selected" | "all" | "none">("focus");
  const [showNeighborLines, setShowNeighborLines] = useState(true);
  const [query, setQuery] = useState("");

  const focusYear = years.includes(Number(focusYearValue)) ? Number(focusYearValue) : years[0] ?? null;
  const selectedPoint = selectedId
    ? artifacts.projection.points.find((point) => point.submissionId === selectedId) ?? null
    : null;
  const neighborRows = selectedId
    ? artifacts.neighbors?.items.find((item) => item.submissionId === selectedId)?.neighbors ?? []
    : [];
  const neighborIds = new Set(neighborRows.map((neighbor) => neighbor.submissionId));

  const visibleYearSet = useMemo(() => {
    const next = new Set<number>();
    if (focusYear !== null) next.add(focusYear);
    for (const item of comparisonYears) {
      if (years.includes(item)) next.add(item);
    }
    return next;
  }, [focusYear, comparisonYears, years.join(",")]);

  const visiblePoints = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return artifacts.projection.points
      .filter((point) => (visibleYearSet.size ? visibleYearSet.has(point.year) : true))
      .filter((point) => (activeClusters.size ? activeClusters.has(point.clusterId) : true))
      .filter((point) => {
        if (!needle) return true;
        return (
          point.submissionId.toLowerCase().includes(needle) ||
          point.label.toLowerCase().includes(needle) ||
          String(point.year).includes(needle) ||
          point.clusterId.toLowerCase().includes(needle)
        );
      })
      .sort(compareProjectionPoints);
  }, [artifacts.projection.points, visibleYearSet, activeClusters, query]);

  const focusPoints = useMemo(
    () => visiblePoints.filter((point) => focusYear === null || point.year === focusYear),
    [visiblePoints, focusYear],
  );

  function toggleComparisonYear(year: number) {
    setComparisonYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  function toggleCluster(clusterId: string) {
    setActiveClusters((current) => {
      const next = new Set(current);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }

  function addAllComparisonYears() {
    setComparisonYears(new Set(years.filter((year) => year !== focusYear)));
  }

  function clearComparisonYears() {
    setComparisonYears(new Set());
  }

  return (
    <div className="space-y-6">
      <Card
        title="Jahrgang Deep Dive"
        eyebrow="Submission-Perspektive"
        description="Wähle einen Fokus-Jahrgang und schalte andere Jahrgänge als Vergleich dazu. Jede Submission bleibt als eigener Punkt mit Name, Jahrgang, Cluster und Position sichtbar."
      >
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Fokus-Jahrgang
            </span>
            <select
              value={focusYearValue}
              onChange={(event) => setFocusYearValue(event.target.value)}
              className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
            >
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Vergleichsjahrgänge
            </div>
            <div className="flex flex-wrap gap-2">
              {years.map((year) => {
                const isFocus = year === focusYear;
                const active = isFocus || comparisonYears.has(year);
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={isFocus}
                    onClick={() => toggleComparisonYear(year)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-default ${
                      active
                        ? "border-slate-950 bg-slate-950 text-white dark:border-mdn-dark-text dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                        : "border-slate-250 bg-white text-slate-600 hover:bg-slate-100 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                    }`}
                    title={isFocus ? "Fokus-Jahrgang ist immer sichtbar" : undefined}
                  >
                    {year}{isFocus ? " · Fokus" : ""}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addAllComparisonYears}
                className="rounded-xl border border-slate-250 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
              >
                Alle dazu
              </button>
              <button
                type="button"
                onClick={clearComparisonYears}
                className="rounded-xl border border-slate-250 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
              >
                Nur Fokus
              </button>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Punktlabels
            </div>
            <select
              value={labelMode}
              onChange={(event) => setLabelMode(event.target.value as "focus" | "selected" | "all" | "none")}
              className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
            >
              <option value="focus">Fokus-Jahrgang beschriften</option>
              <option value="selected">Nur Auswahl beschriften</option>
              <option value="all">Alle sichtbaren Punkte beschriften</option>
              <option value="none">Keine Labels</option>
            </select>
            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-mdn-dark-border dark:bg-[#202326]">
              <input
                type="checkbox"
                checked={showNeighborLines}
                onChange={(event) => setShowNeighborLines(event.target.checked)}
              />
              Nachbarschaften der Auswahl anzeigen
            </label>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Cluster ein-/ausblenden
            </div>
            <div className="flex flex-wrap gap-2">
              {clusters.map((cluster) => {
                const active = !activeClusters.size || activeClusters.has(cluster.clusterId);
                return (
                  <button
                    key={cluster.clusterId}
                    type="button"
                    onClick={() => toggleCluster(cluster.clusterId)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-slate-950 bg-white text-slate-900 dark:border-mdn-dark-text dark:bg-[#212426] dark:text-mdn-dark-text"
                        : "border-slate-250 bg-slate-50 text-slate-400 opacity-60 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-muted"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: clusterColor(cluster.clusterId, clusters) }} />
                    {cluster.clusterId}
                  </button>
                );
              })}
              {activeClusters.size ? (
                <button
                  type="button"
                  onClick={() => setActiveClusters(new Set())}
                  className="rounded-full border border-slate-250 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                >
                  Alle Cluster
                </button>
              ) : null}
            </div>
          </div>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
              Submission suchen
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, ID, Jahrgang oder Cluster"
              className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-300 dark:border-mdn-dark-border dark:bg-[#202326]"
            />
          </label>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <DeepDiveMetric label="Fokusjahr" value={focusYear === null ? "-" : String(focusYear)} />
          <DeepDiveMetric label="Fokus-Submissions" value={String(focusPoints.length)} />
          <DeepDiveMetric label="sichtbare Punkte" value={String(visiblePoints.length)} />
          <DeepDiveMetric label="Cluster sichtbar" value={String(activeClusters.size || clusters.length)} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <Card
          title="Deep-Dive Map nach Jahrgang"
          eyebrow="Submission-Orte"
          description="Fokusjahrgang und Vergleichsjahrgänge liegen in derselben Projektion. Labels zeigen die Submission-Namen direkt am Punkt."
        >
          <DeepDiveScatterPlot
            mode="year"
            points={visiblePoints}
            allPoints={artifacts.projection.points}
            years={years}
            clusters={clusters}
            focusYear={focusYear}
            selectedId={selectedId}
            selectedPoint={selectedPoint}
            neighborIds={neighborIds}
            onSelect={onSelect}
            labelMode={labelMode}
            showNeighborLines={showNeighborLines}
          />
          <DriftLegend
            title="Jahrgänge"
            items={years.map((year) => ({
              label: String(year),
              color: yearColor(year, years),
              shape: yearShapeForPoint(artifacts.projection.points, year),
            }))}
          />
          <JsonDisclosure
            title="Daten dieser Deep-Dive-Map als JSON"
            data={{
              view: "deep_dive_map_by_year",
              assignmentKey: artifacts.overview.assignmentKey,
              focusYear,
              visibleYears: [...visibleYearSet],
              labelMode,
              points: visiblePoints.map(pointJson),
            }}
          />
        </Card>

        <Card
          title="Deep-Dive Map nach Cluster"
          eyebrow="Lösungsmuster"
          description="Dieselbe Projektion, aber nach Cluster gefärbt. So sieht man, welche Submissions den jeweiligen Lösungsmustern zugeordnet sind."
        >
          <DeepDiveScatterPlot
            mode="cluster"
            points={visiblePoints}
            allPoints={artifacts.projection.points}
            years={years}
            clusters={clusters}
            focusYear={focusYear}
            selectedId={selectedId}
            selectedPoint={selectedPoint}
            neighborIds={neighborIds}
            onSelect={onSelect}
            labelMode={labelMode}
            showNeighborLines={showNeighborLines}
          />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <DriftLegend
              title="Clusterfarben"
              items={clusters.map((cluster) => ({
                label: cluster.clusterId,
                color: clusterColor(cluster.clusterId, clusters),
              }))}
            />
            <DriftLegend
              title="Jahrgang-Shapes"
              items={years.map((year) => ({
                label: String(year),
                color: yearColor(year, years),
                shape: yearShapeForPoint(artifacts.projection.points, year),
              }))}
            />
          </div>
          <JsonDisclosure
            title="Daten dieser Cluster-Map als JSON"
            data={{
              view: "deep_dive_map_by_cluster",
              assignmentKey: artifacts.overview.assignmentKey,
              focusYear,
              visibleYears: [...visibleYearSet],
              points: visiblePoints.map(pointJson),
            }}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <DeepDiveClusterBuckets
          points={focusPoints}
          clusters={clusters}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <DeepDiveSubmissionTable
          points={visiblePoints}
          selectedId={selectedId}
          selectedPoint={selectedPoint}
          neighborRows={neighborRows}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function DeepDiveMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-mdn-dark-border dark:bg-[#202326]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-mdn-dark-text">
        {value}
      </div>
    </div>
  );
}

function DeepDiveScatterPlot({
  mode,
  points,
  allPoints,
  years,
  clusters,
  focusYear,
  selectedId,
  selectedPoint,
  neighborIds,
  onSelect,
  labelMode,
  showNeighborLines,
}: {
  mode: "year" | "cluster";
  points: DriftProjectionPoint[];
  allPoints: DriftProjectionPoint[];
  years: number[];
  clusters: DriftCluster[];
  focusYear: number | null;
  selectedId: string | null;
  selectedPoint: DriftProjectionPoint | null;
  neighborIds: Set<string>;
  onSelect: (point: DriftProjectionPoint) => void;
  labelMode: "focus" | "selected" | "all" | "none";
  showNeighborLines: boolean;
}) {
  const width = 920;
  const height = 560;
  const margin = { top: 28, right: 36, bottom: 46, left: 52 };
  const bounds = boundsFor(allPoints.length ? allPoints : points);
  const sx = (x: number) => scale(x, bounds.minX, bounds.maxX, margin.left, width - margin.right);
  const sy = (y: number) => scale(y, bounds.minY, bounds.maxY, height - margin.bottom, margin.top);
  const selectedIsVisible = Boolean(selectedPoint && points.some((point) => point.submissionId === selectedPoint.submissionId));

  function shouldLabel(point: DriftProjectionPoint) {
    if (labelMode === "none") return false;
    if (labelMode === "all") return true;
    if (labelMode === "selected") return point.submissionId === selectedId || neighborIds.has(point.submissionId);
    return point.year === focusYear || point.submissionId === selectedId;
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[860px] rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-[#202326]"
      >
        <Grid width={width} height={height} margin={margin} />
        {showNeighborLines && selectedPoint && selectedIsVisible
          ? points
              .filter((point) => neighborIds.has(point.submissionId))
              .map((point, index) => (
                <line
                  key={`${selectedPoint.submissionId}-${point.submissionId}-${index}`}
                  x1={sx(selectedPoint.x)}
                  y1={sy(selectedPoint.y)}
                  x2={sx(point.x)}
                  y2={sy(point.y)}
                  stroke="currentColor"
                  strokeWidth={1.4}
                  strokeDasharray="5 5"
                  className="text-slate-400 dark:text-mdn-dark-muted"
                />
              ))
          : null}
        {points.map((point, index) => {
          const isSelected = selectedId === point.submissionId;
          const isNeighbor = neighborIds.has(point.submissionId);
          const isFocus = focusYear === null || point.year === focusYear;
          const color = mode === "year" ? yearColor(point.year, years) : clusterColor(point.clusterId, clusters);
          const pointOpacity = isFocus || isSelected || isNeighbor ? 1 : 0.34;
          return (
            <g
              key={`${point.submissionId}-${point.year}-${point.clusterId}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(point)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(point);
              }}
              className="cursor-pointer outline-none"
            >
              <Shape
                shape={point.shapeKey}
                x={sx(point.x)}
                y={sy(point.y)}
                size={isSelected ? 10 : isNeighbor ? 8.5 : isFocus ? 7 : 5.5}
                fill={color}
                stroke={isSelected ? "#0f172a" : isNeighbor ? "#111827" : "#ffffff"}
                opacity={pointOpacity}
              />
              {shouldLabel(point) ? (
                <g opacity={isFocus || isSelected || isNeighbor ? 1 : 0.62}>
                  <rect
                    x={sx(point.x) + 9}
                    y={sy(point.y) - 15}
                    width={Math.min(168, Math.max(52, deepDiveLabel(point).length * 6.3 + 10))}
                    height={18}
                    rx={8}
                    fill="rgba(255,255,255,0.82)"
                    stroke="rgba(148,163,184,0.45)"
                  />
                  <text
                    x={sx(point.x) + 14}
                    y={sy(point.y) - 2}
                    className="fill-slate-800 text-[10px] font-semibold dark:fill-mdn-dark-text"
                  >
                    {truncateLabel(deepDiveLabel(point), 24)}
                  </text>
                </g>
              ) : null}
              <title>{`${point.label}\nsubmissionId: ${point.submissionId}\nyear: ${point.year}\nclusterId: ${point.clusterId}\nPosition: (${point.x.toFixed(4)}, ${point.y.toFixed(4)})\nRandwert: ${(point.outlierScore ?? 0).toFixed(3)}`}</title>
            </g>
          );
        })}
        <text x={margin.left} y={height - 14} className="fill-slate-500 text-xs dark:fill-mdn-dark-muted">
          Projektion X
        </text>
        <text x={14} y={margin.top + 6} className="fill-slate-500 text-xs dark:fill-mdn-dark-muted">
          Y
        </text>
      </svg>
    </div>
  );
}

function DeepDiveClusterBuckets({
  points,
  clusters,
  selectedId,
  onSelect,
}: {
  points: DriftProjectionPoint[];
  clusters: DriftCluster[];
  selectedId: string | null;
  onSelect: (point: DriftProjectionPoint) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, DriftProjectionPoint[]>();
    for (const point of points) {
      const bucket = map.get(point.clusterId) ?? [];
      bucket.push(point);
      map.set(point.clusterId, bucket);
    }
    for (const bucket of map.values()) bucket.sort(compareProjectionPoints);
    return map;
  }, [points]);
  const ordered = orderedClusters(clusters).filter((cluster) => grouped.has(cluster.clusterId));

  return (
    <Card
      title="Fokus-Jahrgang nach Cluster"
      eyebrow="Submission-Buckets"
      description="Diese Liste zeigt, welche Submissions des Fokus-Jahrgangs in welchem Cluster liegen. Ein Klick springt zur Submission in den Maps."
    >
      {ordered.length ? (
        <div className="space-y-3">
          {ordered.map((cluster) => {
            const bucket = grouped.get(cluster.clusterId) ?? [];
            return (
              <details key={cluster.clusterId} open className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-mdn-dark-border dark:bg-[#202326]">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: clusterColor(cluster.clusterId, clusters) }} />
                    {cluster.clusterId} · {bucket.length} Submission{bucket.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {bucket.map((point, index) => (
                    <button
                      key={`${point.submissionId}-${index}`}
                      type="button"
                      onClick={() => onSelect(point)}
                      className={`rounded-xl px-3 py-2 text-left text-xs transition ${
                        selectedId === point.submissionId
                          ? "bg-slate-950 text-white dark:bg-mdn-dark-text dark:text-mdn-dark-bg"
                          : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-[#18191b] dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                      }`}
                    >
                      <div className="font-semibold">{deepDiveLabel(point)}</div>
                      <div className="mt-0.5 opacity-70">{point.submissionId}</div>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 p-6 text-sm text-slate-500 dark:border-mdn-dark-border dark:bg-[#202326] dark:text-mdn-dark-muted">
          Keine Submissions für diese Filter.
        </div>
      )}
      <JsonDisclosure
        title="Fokus-Buckets als JSON"
        data={{
          view: "deep_dive_focus_cluster_buckets",
          clusters: ordered.map((cluster) => ({
            clusterId: cluster.clusterId,
            submissions: (grouped.get(cluster.clusterId) ?? []).map(pointJson),
          })),
        }}
      />
    </Card>
  );
}

function DeepDiveSubmissionTable({
  points,
  selectedId,
  selectedPoint,
  neighborRows,
  onSelect,
}: {
  points: DriftProjectionPoint[];
  selectedId: string | null;
  selectedPoint: DriftProjectionPoint | null;
  neighborRows: DriftNeighbor[];
  onSelect: (point: DriftProjectionPoint) => void;
}) {
  const neighborRank = new Map(neighborRows.map((neighbor, index) => [neighbor.submissionId, index + 1]));
  return (
    <Card
      title="Submission-Liste mit Nachbarschaft"
      eyebrow="Deep Dive"
      description="Die Tabelle zeigt die sichtbaren Submissions mit Position, Cluster und Markierung, ob sie nächste Nachbarn der aktuellen Auswahl sind."
    >
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-mdn-dark-border">
        <div className="max-h-[620px] overflow-auto">
          <table className="docs-table min-w-[1040px]">
            <thead className="sticky top-0 z-10 bg-white dark:bg-[#202326]">
              <tr>
                <th>Submission</th>
                <th>Jahr</th>
                <th>Cluster</th>
                <th>x</th>
                <th>y</th>
                <th>Randwert</th>
                <th>Nachbarschaft</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => {
                const rank = neighborRank.get(point.submissionId);
                return (
                  <tr
                    key={`${point.submissionId}-${point.year}-${point.clusterId}-${index}`}
                    className={selectedId === point.submissionId ? "bg-slate-50 dark:bg-[#202326]" : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        onClick={() => onSelect(point)}
                        className="break-all text-left font-semibold text-slate-950 underline-offset-2 hover:underline dark:text-mdn-dark-text"
                      >
                        {deepDiveLabel(point)}
                      </button>
                      <div className="mt-1 break-all text-[11px] text-slate-500 dark:text-mdn-dark-muted">
                        {point.submissionId}
                      </div>
                    </td>
                    <td className="tabular-nums">{point.year}</td>
                    <td>
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-[#2a2d30]">
                        {point.clusterId}
                      </span>
                    </td>
                    <td className="tabular-nums">{point.x.toFixed(4)}</td>
                    <td className="tabular-nums">{point.y.toFixed(4)}</td>
                    <td className="tabular-nums">{(point.outlierScore ?? 0).toFixed(3)}</td>
                    <td>
                      {selectedPoint?.submissionId === point.submissionId ? (
                        <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white dark:bg-mdn-dark-text dark:text-mdn-dark-bg">
                          Auswahl
                        </span>
                      ) : rank ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-[#2a2d30] dark:text-mdn-dark-muted">
                          Nachbar #{rank}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-mdn-dark-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!points.length ? (
                <tr>
                  <td colSpan={7} className="text-sm text-slate-500 dark:text-mdn-dark-muted">
                    Keine Submissions für diese Filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <JsonDisclosure
        title="Deep-Dive-Tabelle als JSON"
        data={{
          view: "deep_dive_submission_table",
          selected: selectedPoint ? pointJson(selectedPoint) : null,
          neighborRows: neighborRows.map((neighbor) => ({
            submissionId: neighbor.submissionId,
            year: neighbor.year,
            clusterId: neighbor.clusterId,
            similarity: roundNumber(neighbor.similarity),
          })),
          submissions: points.map(pointJson),
        }}
      />
    </Card>
  );
}

function deepDiveLabel(point: DriftProjectionPoint) {
  const value = point.label && point.label !== point.submissionId ? point.label : point.submissionId;
  return truncateLabel(value, 36);
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function DriftLegend({
  title,
  items,
}: {
  title: string;
  items: { label: string; color: string; shape?: string }[];
}) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${item.label}-${item.shape ?? "swatch"}`}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <Shape
                shape={item.shape ?? "circle"}
                x={9}
                y={9}
                size={7}
                fill={item.color}
                stroke={item.color}
              />
            </svg>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScatterPlot({
  mode,
  points,
  allPoints,
  years,
  clusters,
  selectedId,
  onSelect,
  showNeighbors,
  neighborIds,
}: MapProps & { mode: "year" | "cluster" }) {
  const width = 760;
  const height = 460;
  const margin = { top: 24, right: 26, bottom: 42, left: 46 };
  const bounds = boundsFor(allPoints.length ? allPoints : points);
  const sx = (x: number) =>
    scale(x, bounds.minX, bounds.maxX, margin.left, width - margin.right);
  const sy = (y: number) =>
    scale(y, bounds.minY, bounds.maxY, height - margin.bottom, margin.top);
  const neighborPairs =
    showNeighbors && selectedId && neighborIds
      ? points.filter(
          (point) =>
            point.submissionId === selectedId ||
            neighborIds.has(point.submissionId),
        )
      : [];
  const selected =
    points.find((point) => point.submissionId === selectedId) ?? null;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[720px] rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-[#202326]"
      >
        <Grid width={width} height={height} margin={margin} />
        {showNeighbors && selected
          ? neighborPairs
              .filter((point) => point.submissionId !== selected.submissionId)
              .map((point, index) => (
                <line
                  key={`${selected.submissionId}-${point.submissionId}-${index}`}
                  x1={sx(selected.x)}
                  y1={sy(selected.y)}
                  x2={sx(point.x)}
                  y2={sy(point.y)}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="5 5"
                  className="text-slate-400 dark:text-mdn-dark-muted"
                />
              ))
          : null}
        {points.map((point, index) => {
          const isSelected = selectedId === point.submissionId;
          const isNeighbor = Boolean(
            showNeighbors && neighborIds?.has(point.submissionId),
          );
          const color =
            mode === "year"
              ? yearColor(point.year, years)
              : clusterColor(point.clusterId, clusters);
          return (
            <g
              key={`${point.submissionId}-${point.year}-${point.clusterId}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(point)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(point);
              }}
              className="cursor-pointer outline-none"
            >
              <Shape
                shape={point.shapeKey}
                x={sx(point.x)}
                y={sy(point.y)}
                size={isSelected ? 9 : isNeighbor ? 8 : 6}
                fill={color}
                stroke={
                  isSelected ? "#0f172a" : isNeighbor ? "#111827" : "#ffffff"
                }
                opacity={isSelected || isNeighbor ? 1 : 0.76}
              />
              <title>{`${point.label}\nsubmissionId: ${point.submissionId}\nyear: ${point.year}\nclusterId: ${point.clusterId}\nRandwert: ${(point.outlierScore ?? 0).toFixed(3)}`}</title>
            </g>
          );
        })}
        <text
          x={margin.left}
          y={height - 12}
          className="fill-slate-500 text-xs dark:fill-mdn-dark-muted"
        >
          Projektion X
        </text>
        <text
          x={12}
          y={margin.top + 6}
          className="fill-slate-500 text-xs dark:fill-mdn-dark-muted"
        >
          Y
        </text>
      </svg>
    </div>
  );
}

function Shape({
  shape,
  x,
  y,
  size,
  fill,
  stroke,
  opacity = 1,
}: {
  shape: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  stroke: string;
  opacity?: number;
}) {
  const strokeWidth = 1.8;
  if (shape === "square")
    return (
      <rect
        x={x - size}
        y={y - size}
        width={size * 2}
        height={size * 2}
        rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  if (shape === "triangle")
    return (
      <polygon
        points={`${x},${y - size - 2} ${x - size - 1},${y + size} ${x + size + 1},${y + size}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  if (shape === "diamond")
    return (
      <polygon
        points={`${x},${y - size - 2} ${x + size + 2},${y} ${x},${y + size + 2} ${x - size - 2},${y}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  if (shape === "star")
    return (
      <polygon
        points={starPoints(x, y, size + 3, size * 0.5)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  if (shape === "x") {
    return (
      <g
        opacity={opacity}
        stroke={fill}
        strokeWidth={2.5}
        strokeLinecap="round"
      >
        <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} />
        <line x1={x + size} y1={y - size} x2={x - size} y2={y + size} />
      </g>
    );
  }
  if (shape === "plus") {
    return (
      <g
        opacity={opacity}
        stroke={fill}
        strokeWidth={2.5}
        strokeLinecap="round"
      >
        <line x1={x - size} y1={y} x2={x + size} y2={y} />
        <line x1={x} y1={y - size} x2={x} y2={y + size} />
      </g>
    );
  }
  if (shape === "pentagon")
    return (
      <polygon
        points={regularPolygonPoints(x, y, size + 2, 5, -Math.PI / 2)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    );
  return (
    <circle
      cx={x}
      cy={y}
      r={size}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
    />
  );
}

function Grid({
  width,
  height,
  margin,
}: {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}) {
  const vertical = Array.from(
    { length: 6 },
    (_, index) =>
      margin.left + (index * (width - margin.left - margin.right)) / 5,
  );
  const horizontal = Array.from(
    { length: 5 },
    (_, index) =>
      margin.top + (index * (height - margin.top - margin.bottom)) / 4,
  );
  return (
    <g>
      {vertical.map((x) => (
        <line
          key={`v-${x}`}
          x1={x}
          x2={x}
          y1={margin.top}
          y2={height - margin.bottom}
          stroke="currentColor"
          className="text-slate-100 dark:text-[#2a2d30]"
        />
      ))}
      {horizontal.map((y) => (
        <line
          key={`h-${y}`}
          x1={margin.left}
          x2={width - margin.right}
          y1={y}
          y2={y}
          stroke="currentColor"
          className="text-slate-100 dark:text-[#2a2d30]"
        />
      ))}
      <line
        x1={margin.left}
        x2={width - margin.right}
        y1={height - margin.bottom}
        y2={height - margin.bottom}
        stroke="currentColor"
        className="text-slate-300 dark:text-mdn-dark-border"
      />
      <line
        x1={margin.left}
        x2={margin.left}
        y1={margin.top}
        y2={height - margin.bottom}
        stroke="currentColor"
        className="text-slate-300 dark:text-mdn-dark-border"
      />
    </g>
  );
}


function JsonDisclosure({ title, data }: { title: string; data: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-mdn-dark-border dark:bg-[#202326]">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
        {title}
      </summary>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500 dark:text-mdn-dark-muted">
          Aufklappen, kopieren oder direkt markieren.
        </div>
        <button
          type="button"
          onClick={copyJson}
          className="rounded-xl border border-slate-250 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-mdn-dark-border dark:bg-[#18191b] dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
        >
          {copied ? "Kopiert" : "JSON kopieren"}
        </button>
      </div>
      <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-50">
        {json}
      </pre>
    </details>
  );
}

function pointJson(point: DriftProjectionPoint) {
  return {
    submissionId: point.submissionId,
    year: point.year,
    clusterId: point.clusterId,
    x: roundNumber(point.x),
    y: roundNumber(point.y),
    shapeKey: point.shapeKey,
    label: point.label,
    outlierScore: roundNumber(point.outlierScore ?? 0),
  };
}

function roundNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}

function compareProjectionPoints(a: DriftProjectionPoint, b: DriftProjectionPoint) {
  return (
    a.year - b.year ||
    a.clusterId.localeCompare(b.clusterId, undefined, { numeric: true }) ||
    a.submissionId.localeCompare(b.submissionId)
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">
        {label}
      </dt>
      <dd className="mt-1 break-words font-medium text-slate-900 dark:text-mdn-dark-text">
        {value}
      </dd>
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function YearDistributionBars({
  cluster,
  years,
}: {
  cluster: DriftCluster;
  years: number[];
}) {
  const counts = years.map(
    (year) => cluster.yearDistribution[String(year)] ?? 0,
  );
  const maxValue = Math.max(1, ...counts);
  return (
    <div className="min-w-[300px] space-y-1.5">
      {years.map((year) => {
        const value = cluster.yearDistribution[String(year)] ?? 0;
        const width =
          value > 0 ? `${Math.max(4, (value / maxValue) * 100)}%` : "0%";
        return (
          <div
            key={year}
            className="grid grid-cols-[76px_minmax(130px,1fr)] items-center gap-3 text-xs"
            title={`${year}: ${value}`}
          >
            <span className="whitespace-nowrap font-semibold tabular-nums text-slate-500 dark:text-mdn-dark-muted">
              {year} · {value}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#2a2d30]">
              <span
                className="block h-full rounded-full"
                style={{
                  width,
                  backgroundColor: yearColor(year, years),
                  opacity: value > 0 ? 0.9 : 0.2,
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function boundsFor(items: { x: number; y: number }[]): Bounds {
  if (!items.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const xs = items.map((item) => item.x);
  const ys = items.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = Math.max(0.08, (maxX - minX) * 0.08);
  const padY = Math.max(0.08, (maxY - minY) * 0.08);
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

function scale(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
) {
  if (Math.abs(domainMax - domainMin) < 1e-9) return (rangeMin + rangeMax) / 2;
  return (
    rangeMin +
    ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin)
  );
}

function yearColor(year: number, years: number[]) {
  const index = Math.max(0, years.indexOf(year));
  return YEAR_COLORS[index % YEAR_COLORS.length];
}

function clusterColor(clusterId: string, clusters: DriftCluster[]) {
  if (clusterId === "unclustered") return BOUNDARY_COLOR;
  const ordered = orderedClusters(clusters);
  const index = Math.max(
    0,
    ordered.findIndex((cluster) => cluster.clusterId === clusterId),
  );
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

function orderedClusters(clusters: DriftCluster[]) {
  return [...clusters].sort((a, b) =>
    a.clusterId.localeCompare(b.clusterId, undefined, { numeric: true }),
  );
}

function yearShapeForPoint(points: DriftProjectionPoint[], year: number) {
  return points.find((point) => point.year === year)?.shapeKey ?? "circle";
}

function clusterStatus(cluster: DriftCluster) {
  if (cluster.clusterId === "unclustered") return "mixed";
  if (cluster.isNewCluster) return "new";
  if (cluster.isDecliningCluster) return "declining";
  const nonZeroYears = Object.values(cluster.yearDistribution).filter(
    (value) => value > 0,
  ).length;
  return nonZeroYears >= 3 ? "stable" : "mixed";
}

function heatRatio(value: number, min: number, max: number) {
  return max - min < 1e-9
    ? 1
    : Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function heatColor(value: number, min: number, max: number) {
  const t = heatRatio(value, min, max);
  const light = Math.round(226 - t * 150);
  const mid = Math.round(232 - t * 120);
  const dark = Math.round(255 - t * 80);
  return `rgb(${light}, ${mid}, ${dark})`;
}

function heatTextColor(t: number) {
  return t > 0.55 ? "#ffffff" : "#1e293b";
}

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(
      `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
    );
  }
  return points.join(" ");
}

function regularPolygonPoints(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  offset = 0,
) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = offset + (index * Math.PI * 2) / sides;
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
  }).join(" ");
}
