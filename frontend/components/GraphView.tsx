"use client";

import { useEffect, useMemo, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { GraphPayload, SpaceKey } from "../lib/types";

type Props = {
  graph: GraphPayload | null;
  space: SpaceKey;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeSelect?: (submissionId: string) => void;
  onEdgeSelect?: (source: string, target: string) => void;
  onClearSelection?: () => void;
};

const SPACE_COLORS: Record<SpaceKey, { node: string; edge: string; border: string; selection: string }> = {
  expr: { node: "#8ab4f8", edge: "#90caf9", border: "#2563eb", selection: "#f59e0b" },
  struct: { node: "#9fd5b3", edge: "#6fcf97", border: "#15803d", selection: "#d97706" },
  sem: { node: "#c4b5fd", edge: "#a78bfa", border: "#7c3aed", selection: "#d97706" },
  fusion: { node: "#f5c27b", edge: "#f59e0b", border: "#b45309", selection: "#dc2626" },
};

export function GraphView({ graph, space, selectedNodeId, selectedEdgeId, onNodeSelect, onEdgeSelect, onClearSelection }: Props) {
  const palette = SPACE_COLORS[space];
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const apply = () => setIsDark(root.classList.contains("dark"));
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const elements = useMemo(() => {
    if (!graph) return [];
    return [
      ...graph.nodes.map((node) => ({
        data: {
          id: node.submission_id,
          label: node.label,
          clusterId: node.cluster_id ?? null,
          clusterProbability: node.cluster_probability ?? null,
          clusterColor: node.cluster_color ?? palette.node,
          clusterBorderColor: node.cluster_border_color ?? palette.border,
          isNoise: node.is_noise ?? false,
        },
        classes: [node.submission_id === selectedNodeId ? "selected-node" : "", node.is_noise ? "noise-node" : ""]
          .filter(Boolean)
          .join(" "),
      })),
      ...graph.edges.map((edge) => {
        const edgeId = `${edge.source}::${edge.target}`;
        return {
          data: {
            id: edgeId,
            source: edge.source,
            target: edge.target,
            label: edge.weight.toFixed(3),
            weight: edge.weight,
            edgeType: edge.edge_type,
          },
          classes: edgeId === selectedEdgeId ? "selected-edge" : "",
        };
      }),
    ];
  }, [graph, selectedEdgeId, selectedNodeId]);

  if (!graph) {
    return <div className="cy-empty">Noch kein Graph geladen.</div>;
  }

  return (
    <div className="cy-shell">
      <CytoscapeComponent
        elements={elements}
        style={{ width: "100%", height: "100%" }}
        wheelSensitivity={0.15}
        minZoom={0.25}
        maxZoom={3}
        layout={{ name: "cose", animate: false, fit: true, padding: 28, idealEdgeLength: 96, nodeRepulsion: 800000 }}
        cy={(cy: any) => {
          cy.removeAllListeners("tap");
          cy.on("tap", "node", (event: any) => {
            const id = event.target.data("id");
            onNodeSelect?.(id);
          });
          cy.on("tap", "edge", (event: any) => {
            const source = event.target.data("source");
            const target = event.target.data("target");
            onEdgeSelect?.(source, target);
          });
          cy.on("tap", (event: any) => {
            if (event.target === cy) {
              onClearSelection?.();
            }
          });
        }}
        stylesheet={[
          {
            selector: "node",
            style: {
              label: "data(label)",
              color: isDark ? "#f5f7fa" : "#111827",
              "background-color": "data(clusterColor)",
              "text-valign": "center",
              "text-halign": "center",
              width: 42,
              height: 42,
              "font-size": 10,
              "font-family": "Inter, system-ui, sans-serif",
              "text-wrap": "wrap",
              "text-max-width": 96,
              "border-width": 1.75,
              "border-color": "data(clusterBorderColor)",
            },
          },
          {
            selector: "node.noise-node",
            style: {
              "background-color": isDark ? "#38404a" : "#dbe2ea",
              opacity: 0.95,
              "border-color": isDark ? "#7b8794" : "#94a3b8",
            },
          },
          {
            selector: "node.selected-node",
            style: {
              "background-color": "#fde68a",
              width: 50,
              height: 50,
              "border-width": 3,
              "border-color": palette.selection,
            },
          },
          {
            selector: "edge",
            style: {
              width: 1.8,
              label: "data(label)",
              color: isDark ? "#b7bec6" : "#475569",
              "curve-style": "bezier",
              "line-color": palette.edge,
              opacity: 0.82,
              "font-size": 8,
              "font-family": "Inter, system-ui, sans-serif",
            },
          },
          {
            selector: "edge.selected-edge",
            style: {
              width: 4,
              "line-color": palette.selection,
              color: isDark ? "#f5d38d" : "#92400e",
            },
          },
        ]}
      />
    </div>
  );
}
