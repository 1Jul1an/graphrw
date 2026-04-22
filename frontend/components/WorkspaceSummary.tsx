import { compactSpaceLabel } from "../lib/format";
import { SPACES, type GraphPayload, type SpaceKey } from "../lib/types";
import { Card } from "./Card";
import { Metric } from "./Metric";

type Props = { graphs: Partial<Record<SpaceKey, GraphPayload>>; activeSpace: SpaceKey };

export function WorkspaceSummary({ graphs, activeSpace }: Props) {
  return (
    <Card eyebrow="Workspace" title="Graphen im Überblick">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SPACES.map((space) => {
          const graph = graphs[space];
          const clusterCount = graph?.meta?.cluster_meta?.cluster_count ?? graph?.cluster_legend?.filter((item) => !item.is_noise).length ?? 0;
          const noiseCount = graph?.meta?.cluster_meta?.noise_count ?? graph?.cluster_legend?.find((item) => item.is_noise)?.size ?? 0;
          return <Metric key={space} label={`${compactSpaceLabel(space)}${space === activeSpace ? " · aktiv" : ""}`} value={graph ? `${graph.nodes.length} N · ${graph.edges.length} E · ${clusterCount} C · ${noiseCount} Noise` : "Wartet auf Daten"} tone={space === activeSpace ? "accent" : "default"} />;
        })}
      </div>
    </Card>
  );
}
