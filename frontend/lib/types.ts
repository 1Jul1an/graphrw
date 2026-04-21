export const SPACES = ["expr", "struct", "sem", "fusion"] as const;
export type SpaceKey = (typeof SPACES)[number];

export type RunPayload = {
  run_id: string;
  status: string;
  pipeline_status?: Record<string, string>;
};

export type GraphPayload = {
  nodes: {
    submission_id: string;
    label: string;
    cluster_id?: string | null;
    cluster_probability?: number | null;
    is_noise?: boolean;
  }[];
  edges: { source: string; target: string; weight: number; edge_type: string }[];
};

export type SubmissionDetail = {
  submission: {
    submission_id: string;
    submission_name: string;
    ingestion_status: string;
    stats?: {
      relevant_java_file_count?: number;
      ignored_entry_count?: number;
      parseable_file_count?: number;
      empty_submission?: boolean;
    };
  };
  included_files: {
    file: {
      file_id: string;
      relative_path: string;
      basename: string;
      size_bytes: number;
      sha256: string;
    };
    spaces: Record<string, Record<string, number>>;
    ast?: {
      provider?: string;
      node_count?: number;
      max_depth?: number;
      top_node_types?: { kind: string; count: number }[];
      top_paths?: { path: string; count: number }[];
    };
    normalizations_available: string[];
  }[];
  spaces: Record<
    string,
    {
      representation: Record<string, number | string | Record<string, number>>;
      top_dimensions: { feature: string; value: number; share: number }[];
      comparison_dimensions?: { feature: string; value: number; share: number }[];
      standardized_dimensions?: { feature: string; value: number; share: number }[];
      top_neighbors: { source: string; target: string; weight: number; edge_type: string }[];
      cluster_membership?: { cluster_id: string; size: number } | null;
      graph_degree: number;
      metadata?: Record<string, unknown>;
    }
  >;
};

export type PairDetail = {
  space: string;
  submission_a: { submission_id: string; submission_name: string };
  submission_b: { submission_id: string; submission_name: string };
  relation_raw: number;
  relation_cal: number;
  method: string;
  graph_edge: { is_present: boolean; edge_type?: string | null; weight?: number | null };
  score_components?: Record<string, number>;
  score_weights?: Record<string, number>;
  source_scores?: Record<string, number>;
  calibration?: Record<string, number | string>;
  top_common_signals: { feature: string; left_value: number; right_value: number; contribution: number }[];
  top_differing_signals: { feature: string; left_value: number; right_value: number; absolute_gap: number; dominant_submission_id: string }[];
};

export type Selection =
  | { space: SpaceKey; kind: "node"; submissionId: string }
  | { space: SpaceKey; kind: "edge"; source: string; target: string }
  | null;
