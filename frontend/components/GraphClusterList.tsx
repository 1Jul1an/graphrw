import { shortId } from "../lib/format";
import type { GraphPayload } from "../lib/types";

type GraphNode = GraphPayload["nodes"][number];
type GraphEdge = GraphPayload["edges"][number];

type ClusterGroup = {
  key: string;
  label: string;
  isNoise: boolean;
  color: string;
  borderColor: string;
  nodes: GraphNode[];
  internalEdges: GraphEdge[];
  externalEdges: GraphEdge[];
};

type Props = {
  graph: GraphPayload | null;
  onNodeSelect: (submissionId: string) => void;
  onEdgeSelect: (source: string, target: string) => void;
};

const FALLBACK_CLUSTER_COLOR = "#94a3b8";
const FALLBACK_CLUSTER_BORDER = "#64748b";
const NOISE_KEY = "__noise__";

export function GraphClusterList({ graph, onNodeSelect, onEdgeSelect }: Props) {
  const groups = buildClusterGroups(graph);
  const sortedEdges = [...(graph?.edges ?? [])].sort((left, right) => right.weight - left.weight);
  const nodeLookup = new Map((graph?.nodes ?? []).map((node) => [node.submission_id, node]));

  if (!graph) {
    return null;
  }

  return (
    <div className="mt-5 space-y-4 border-t border-slate-150 pt-5 dark:border-mdn-dark-border">
      <div>
        <div className="text-sm font-semibold text-slate-950 dark:text-mdn-dark-text">Cluster- und Kantenliste für diesen Raum</div>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-mdn-dark-muted">
          Diese Liste ist eine Prüfansicht: Sie ordnet Nodes pro Cluster und zeigt interne sowie externe Graph-Verbindungen. Kein Eintrag ist automatisch ein Urteil.
        </p>
      </div>

      <div className="space-y-3">
        {groups.length ? (
          groups.map((group) => (
            <details
              key={group.key}
              open={!group.isNoise}
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-mdn-dark-border dark:bg-mdn-dark-surface"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color, boxShadow: `0 0 0 1px ${group.borderColor}` }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">{group.label}</div>
                      <div className="text-xs text-slate-500 dark:text-mdn-dark-muted">
                        {group.nodes.length} Nodes · {group.internalEdges.length} interne Kanten · {group.externalEdges.length} Kanten nach außen
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-500 dark:text-mdn-dark-muted">aufklappen</div>
                </div>
              </summary>

              <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Mitglieder</div>
                  <div className="space-y-2">
                    {group.nodes.map((node) => (
                      <button
                        key={node.submission_id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onNodeSelect(node.submission_id);
                        }}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-150 bg-slate-25 px-3 py-2 text-left text-xs transition hover:border-brand-200 hover:bg-brand-50 dark:border-mdn-dark-border dark:bg-[#18191b] dark:hover:border-brand-700 dark:hover:bg-brand-700/15"
                      >
                        <span className="min-w-0 truncate font-medium text-slate-800 dark:text-mdn-dark-text">{node.label}</span>
                        <span className="shrink-0 text-slate-500 dark:text-mdn-dark-muted">{shortId(node.submission_id)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <EdgeList
                    title="Interne Verbindungen"
                    edges={group.internalEdges}
                    nodeLookup={nodeLookup}
                    getRelationLabel={() => "innerhalb"}
                    onEdgeSelect={onEdgeSelect}
                  />
                  <EdgeList
                    title="Verbindungen nach außen"
                    edges={group.externalEdges}
                    nodeLookup={nodeLookup}
                    getRelationLabel={(edge) => externalRelationLabel(edge, group, nodeLookup)}
                    onEdgeSelect={onEdgeSelect}
                  />
                </div>
              </div>
            </details>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 px-4 py-5 text-sm text-slate-500 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted">
            Keine Cluster im aktuellen Raum gefunden.
          </div>
        )}
      </div>

      <details className="rounded-2xl border border-slate-200 bg-slate-25 p-4 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">
          Alle Graph-Verbindungen ({sortedEdges.length})
        </summary>
        <div className="mt-3">
          <EdgeList
            title={null}
            edges={sortedEdges}
            nodeLookup={nodeLookup}
            getRelationLabel={(edge) => edgeRelationLabel(edge, nodeLookup)}
            onEdgeSelect={onEdgeSelect}
          />
        </div>
      </details>
    </div>
  );
}

function EdgeList({
  title,
  edges,
  nodeLookup,
  getRelationLabel,
  onEdgeSelect,
}: {
  title: string | null;
  edges: GraphEdge[];
  nodeLookup: Map<string, GraphNode>;
  getRelationLabel: (edge: GraphEdge) => string;
  onEdgeSelect: (source: string, target: string) => void;
}) {
  const sortedEdges = [...edges].sort((left, right) => right.weight - left.weight);

  return (
    <div>
      {title ? <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">{title}</div> : null}
      {sortedEdges.length ? (
        <div className="max-h-80 overflow-auto rounded-2xl border border-slate-150 bg-white dark:border-mdn-dark-border dark:bg-[#18191b]">
          <table className="docs-table text-xs">
            <thead>
              <tr>
                <th>Kante</th>
                <th>Gewicht</th>
                <th>Typ</th>
                <th>Bezug</th>
              </tr>
            </thead>
            <tbody>
              {sortedEdges.map((edge) => {
                const source = nodeLookup.get(edge.source);
                const target = nodeLookup.get(edge.target);
                const sourceLabel = source?.label ?? shortId(edge.source);
                const targetLabel = target?.label ?? shortId(edge.target);
                return (
                  <tr key={`${edge.source}-${edge.target}-${edge.edge_type}`}>
                    <td>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdgeSelect(edge.source, edge.target);
                        }}
                        className="text-left font-medium text-brand-700 hover:underline dark:text-brand-100"
                        title={`${edge.source} ↔ ${edge.target}`}
                      >
                        {sourceLabel} ↔ {targetLabel}
                      </button>
                    </td>
                    <td>{edge.weight.toFixed(3)}</td>
                    <td>{edge.edge_type}</td>
                    <td>{getRelationLabel(edge)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-250 bg-slate-25 px-4 py-4 text-xs text-slate-500 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted">
          Keine Kanten.
        </div>
      )}
    </div>
  );
}

function buildClusterGroups(graph: GraphPayload | null): ClusterGroup[] {
  if (!graph) return [];

  const groups = new Map<string, ClusterGroup>();

  for (const legendItem of graph.cluster_legend ?? []) {
    const key = legendItem.is_noise ? NOISE_KEY : legendItem.cluster_id ?? legendItem.label;
    groups.set(key, {
      key,
      label: legendItem.label,
      isNoise: Boolean(legendItem.is_noise),
      color: legendItem.color ?? FALLBACK_CLUSTER_COLOR,
      borderColor: legendItem.border_color ?? FALLBACK_CLUSTER_BORDER,
      nodes: [],
      internalEdges: [],
      externalEdges: [],
    });
  }

  for (const node of graph.nodes) {
    const key = clusterKeyForNode(node);
    const existing = groups.get(key);
    if (existing) {
      existing.nodes.push(node);
      continue;
    }
    groups.set(key, {
      key,
      label: clusterLabelForNode(node),
      isNoise: Boolean(node.is_noise) || !node.cluster_id,
      color: node.cluster_color ?? FALLBACK_CLUSTER_COLOR,
      borderColor: node.cluster_border_color ?? FALLBACK_CLUSTER_BORDER,
      nodes: [node],
      internalEdges: [],
      externalEdges: [],
    });
  }

  const nodeGroupKeys = new Map<string, string>();
  for (const group of groups.values()) {
    for (const node of group.nodes) {
      nodeGroupKeys.set(node.submission_id, group.key);
    }
  }

  for (const edge of graph.edges) {
    const sourceGroupKey = nodeGroupKeys.get(edge.source);
    const targetGroupKey = nodeGroupKeys.get(edge.target);
    if (!sourceGroupKey || !targetGroupKey) continue;

    if (sourceGroupKey === targetGroupKey) {
      groups.get(sourceGroupKey)?.internalEdges.push(edge);
      continue;
    }

    groups.get(sourceGroupKey)?.externalEdges.push(edge);
    groups.get(targetGroupKey)?.externalEdges.push(edge);
  }

  return [...groups.values()]
    .filter((group) => group.nodes.length > 0)
    .sort((left, right) => {
      if (left.isNoise !== right.isNoise) return left.isNoise ? 1 : -1;
      return left.label.localeCompare(right.label, "de", { numeric: true, sensitivity: "base" });
    });
}

function clusterKeyForNode(node: GraphNode) {
  if (node.is_noise || !node.cluster_id) return NOISE_KEY;
  return node.cluster_id;
}

function clusterLabelForNode(node: GraphNode) {
  if (node.is_noise || !node.cluster_id) return "Noise";
  return node.cluster_label ?? node.cluster_id;
}

function externalRelationLabel(edge: GraphEdge, group: ClusterGroup, nodeLookup: Map<string, GraphNode>) {
  const source = nodeLookup.get(edge.source);
  const target = nodeLookup.get(edge.target);
  const sourceInGroup = source ? clusterKeyForNode(source) === group.key : false;
  const other = sourceInGroup ? target : source;
  return `zu ${other ? clusterLabelForNode(other) : "unbekannt"}`;
}

function edgeRelationLabel(edge: GraphEdge, nodeLookup: Map<string, GraphNode>) {
  const source = nodeLookup.get(edge.source);
  const target = nodeLookup.get(edge.target);
  const sourceLabel = source ? clusterLabelForNode(source) : "unbekannt";
  const targetLabel = target ? clusterLabelForNode(target) : "unbekannt";
  return sourceLabel === targetLabel ? sourceLabel : `${sourceLabel} ↔ ${targetLabel}`;
}
