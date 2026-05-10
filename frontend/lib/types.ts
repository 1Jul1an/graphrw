export const SPACES = ["expr", "struct", "sem", "fusion", "embedding", "supervised"] as const;
export type SpaceKey = (typeof SPACES)[number];

export const ENGINE_OPTIONS = [
  { key: "engine1", label: "Engine 1", description: "Feature Extraction" },
  { key: "engine2", label: "Engine 2", description: "Ollama Embeddings" },
  { key: "engine3", label: "Engine 3", description: "Supervised Learning" },
] as const;

export type EngineKey = (typeof ENGINE_OPTIONS)[number]["key"];

export const EMBEDDING_MODEL_OPTIONS = [
  { key: "quality", label: "Quality", model: "qwen3-embedding:8b", description: "Umfangreicher" },
  { key: "balanced", label: "Balanced", model: "qwen3-embedding:4b", description: "Default für Engine2" },
  { key: "fast", label: "Fast", model: "qwen3-embedding:0.6b", description: "Lightweight" },
] as const;

export type EmbeddingModelKey = (typeof EMBEDDING_MODEL_OPTIONS)[number]["key"];
export type EmbeddingModelName = (typeof EMBEDDING_MODEL_OPTIONS)[number]["model"];

export const ENGINE_SPACES = {
  engine1: ["expr", "struct", "sem", "fusion"],
  engine2: ["embedding"],
  engine3: ["supervised"],
} as const satisfies Record<EngineKey, readonly SpaceKey[]>;

export type RunPayload = {
  run_id: string;
  status: string;
  engine?: EngineKey;
  spaces?: SpaceKey[];
  embedding_model?: EmbeddingModelName | null;
  embedding_model_profile?: EmbeddingModelKey | null;
  pipeline_status?: Record<string, string>;
};

export type ClusterLegendItem = {
  cluster_id?: string | null;
  label: string;
  size: number;
  color: string;
  border_color: string;
  is_noise?: boolean;
};

export type ExplanationFacet = {
  feature?: string;
  label: string;
  family?: string;
  contribution?: number;
  gap?: number;
  lift?: number;
};

export type AgreementProfileRow = {
  dimension: string;
  label: string;
  strength: number;
  verdict: string;
  evidence: string[];
};

export type PairExplanation = {
  summary: string;
  dominant_families: string[];
  agreement_profile: AgreementProfileRow[];
  top_shared_patterns: ExplanationFacet[];
  top_separating_patterns: ExplanationFacet[];
};

export type ClusterExplanation = {
  summary: string;
  dominant_families: string[];
  cohesion_basis: ExplanationFacet[];
  boundary_basis: ExplanationFacet[];
  core_members: string[];
  internal_story: string[];
  boundary_story: string[];
};

export type SubmissionSpaceExplanation = {
  summary: string;
  neighbor_story: string[];
  why_here: string[];
  why_not_else: string[];
};

export type GraphPayload = {
  nodes: {
    submission_id: string;
    label: string;
    cluster_id?: string | null;
    cluster_label?: string | null;
    cluster_size?: number | null;
    cluster_probability?: number | null;
    cluster_color?: string | null;
    cluster_border_color?: string | null;
    is_noise?: boolean;
  }[];
  edges: { source: string; target: string; weight: number; raw_weight?: number; edge_type: string; shared_neighbor_count?: number; support_count?: number | null }[];
  cluster_legend?: ClusterLegendItem[];
  meta?: {
    k?: number;
    construction?: string;
    neighbor_strategy?: string;
    similarity_floor?: number;
    pair_count?: number;
    similarity_stats?: { count?: number; min?: number; max?: number; mean?: number; p10?: number; p25?: number; p50?: number; p75?: number; p90?: number; histogram?: { label: string; count: number }[] };
    degree_stats?: { min?: number; max?: number; mean?: number; isolated_count?: number };
    cluster_meta?: { cluster_count?: number; noise_count?: number; [key: string]: unknown };
    neighbor_meta?: { local_floor_mean?: number; local_floor_min?: number; local_floor_max?: number; max_neighbors_per_node?: number };
    [key: string]: unknown;
  };
};

export type SubmissionDetail = {
  submission: {
    submission_id: string;
    submission_name: string;
    ingestion_status: string;
    stats?: { relevant_java_file_count?: number; ignored_entry_count?: number; parseable_file_count?: number; empty_submission?: boolean };
  };
  included_files: { file: { file_id: string; relative_path: string; basename: string; size_bytes: number; sha256: string }; spaces: Record<string, Record<string, number>>; ast?: { provider?: string; node_count?: number; max_depth?: number; top_node_types?: { kind: string; count: number }[]; top_paths?: { path: string; count: number }[] }; normalizations_available: string[] }[];
  spaces: Record<string, {
    representation: Record<string, number | string | Record<string, number> | unknown[]>;
    top_dimensions: { feature: string; value: number; share: number }[];
    comparison_dimensions?: { feature: string; value: number; share: number }[];
    standardized_dimensions?: { feature: string; value: number; share: number }[];
    top_neighbors: { source: string; target: string; weight: number; edge_type: string; support_count?: number | null }[];
    cluster_membership?: { cluster_id?: string | null; cluster_label?: string | null; size: number; membership_strength?: number; method?: string; color?: string; is_noise?: boolean } | null;
    cluster_diagnostics?: {
      label?: string;
      size?: number;
      summary_metrics?: Record<string, number>;
      signature_features?: { feature: string; cluster_mean: number; rest_mean: number; lift: number }[];
      contrast_features?: { feature: string; cluster_mean: number; rest_mean: number; lift: number }[];
      central_members?: { submission_id: string; submission_name: string; mean_internal_similarity: number }[];
      strongest_internal_pairs?: { source: string; source_name: string; target: string; target_name: string; weight: number }[];
      nearest_external_pairs?: { source: string; source_name: string; target: string; target_name: string; weight: number }[];
      notes?: string[];
      explanation?: ClusterExplanation;
    } | null;
    explanation?: SubmissionSpaceExplanation;
    graph_degree: number;
    metadata?: Record<string, unknown>;
    space_meta?: GraphPayload["meta"];
  }>;
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
  diagnostics?: Record<string, number | string | null>;
  explanation?: PairExplanation;
  top_common_signals: { feature: string; left_value: number; right_value: number; contribution: number }[];
  top_differing_signals: { feature: string; left_value: number; right_value: number; absolute_gap: number; dominant_submission_id: string }[];
};

export type Selection = | { space: SpaceKey; kind: "node"; submissionId: string } | { space: SpaceKey; kind: "edge"; source: string; target: string } | null;


export type DriftIgnoredEntry = {
  path: string;
  filename: string;
  kind?: string;
  reason: string;
  sizeBytes?: number;
  javaFileCount?: number;
};

export type DriftBundleManifest = {
  bundleId: string;
  assignmentKey: string;
  year: number;
  validSubmissionZipCount: number;
  ignoredLooseFileCount: number;
  ignoredZipWithoutJavaCount: number;
  ignoredCorruptZipCount?: number;
  validSubmissionZips?: DriftIgnoredEntry[];
  ignoredFiles?: DriftIgnoredEntry[];
  ignoredZips?: DriftIgnoredEntry[];
  truncated?: boolean;
  createdAt?: string;
};

export type DriftBundle = {
  bundleId: string;
  assignmentKey: string;
  year: number;
  originalFilename: string;
  sha256?: string;
  sizeBytes?: number;
  createdAt?: string;
  storageRoot?: string;
  validSubmissionZipCount: number;
  ignoredLooseFileCount?: number;
  ignoredZipWithoutJavaCount?: number;
  ignoredCorruptZipCount?: number;
  importStatus?: string;
  manifest?: DriftBundleManifest;
};

export type DriftRunProgressEvent = {
  at?: string;
  stage?: string;
  message?: string;
};

export type DriftRunProgress = {
  stage?: string;
  stageLabel?: string;
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
  heartbeatAt?: string;
  updatedAt?: string;
  currentSubmissionId?: string | null;
  cache?: {
    requests?: number;
    hits?: number;
    misses?: number;
    stale?: number;
    writes?: number;
    bypassed?: number;
  };
  events?: DriftRunProgressEvent[];
};

export type DriftRunPayload = {
  runId: string;
  assignmentKey: string;
  status: string;
  embeddingModel?: string;
  embeddingModelProfile?: string | null;
  topK?: number;
  forceRecompute?: boolean;
  cachePolicy?: string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  pipelineStatus?: Record<string, string>;
  progress?: DriftRunProgress;
  error?: string;
};

export type DriftOverview = {
  assignmentKey: string;
  runId?: string;
  includedYears: number[];
  totalSubmissions: number;
  submissionsPerYear: Record<string, number>;
  clusterCount: number;
  outlierCount: number;
  embeddingModel: string;
  embeddingDimension?: number;
  embeddingCacheStats?: {
    requests?: number;
    hits?: number;
    misses?: number;
    stale?: number;
    writes?: number;
    bypassed?: number;
    mode?: string;
    model?: string;
  };
  embeddingCacheMode?: string;
  forceRecompute?: boolean;
  createdAt: string;
  driftSchemaVersion?: number;
  outlierDefinition?: string;
};

export type DriftProjectionPoint = {
  submissionId: string;
  x: number;
  y: number;
  year: number;
  clusterId: string;
  shapeKey: string;
  label: string;
  outlierScore?: number;
};

export type DriftProjection = {
  assignmentKey: string;
  runId: string;
  points: DriftProjectionPoint[];
  yearShapes: Record<string, string>;
};

export type DriftCluster = {
  clusterId: string;
  size: number;
  dominantYear: number | null;
  yearDistribution: Record<string, number>;
  centroidX: number;
  centroidY: number;
  isNewCluster?: boolean;
  isDecliningCluster?: boolean;
  exemplarSubmissions?: string[];
};

export type DriftClusters = {
  clusters: DriftCluster[];
};

export type DriftYearStat = {
  year: number;
  submissionCount: number;
  centroidX: number;
  centroidY: number;
  clusterDistribution: Record<string, number>;
  outlierCount: number;
};

export type DriftYearStats = {
  years: DriftYearStat[];
};

export type DriftYearSimilarityMatrix = {
  years: number[];
  matrix: number[][];
  metric: string;
};

export type DriftNeighbor = {
  submissionId: string;
  similarity: number;
  year: number;
  clusterId: string;
};

export type DriftNeighbors = {
  metric: string;
  topK: number;
  items: { submissionId: string; neighbors: DriftNeighbor[] }[];
};

export type DriftArtifacts = {
  run: DriftRunPayload;
  overview: DriftOverview;
  projection: DriftProjection;
  clusters: DriftClusters;
  year_stats: DriftYearStats;
  year_similarity_matrix: DriftYearSimilarityMatrix;
  neighbors?: DriftNeighbors;
};

export type DriftWorkspaceRunBatch = {
  embeddingModel: string;
  cachePolicy?: string;
  runCount: number;
  runs: DriftRunPayload[];
  skipped?: { assignmentKey: string; reason: string }[];
  createdAt?: string;
};


export type DriftWorkspaceCentroid = {
  year: number;
  x: number;
  y: number;
  submissionCount: number;
  outlierCount?: number;
};

export type DriftWorkspaceTransition = {
  fromYear: number;
  toYear: number;
  transition: string;
  distance2d: number;
  normalizedDistance: number;
  similarity?: number | null;
  dissimilarity?: number | null;
};

export type DriftWorkspaceLab = {
  assignmentKey: string;
  runId?: string;
  embeddingModel?: string;
  includedYears: number[];
  totalSubmissions: number;
  submissionsPerYear: Record<string, number>;
  clusterCount: number;
  boundaryPointCount: number;
  centroids: DriftWorkspaceCentroid[];
  transitions: DriftWorkspaceTransition[];
  pathLength: number;
  totalDrift: number;
  maxJump: number;
  maxJumpTransition?: string | null;
  meanAdjacentSimilarity?: number | null;
  clusterIds?: string[];
  createdAt?: string;
};

export type DriftWorkspaceOverview = {
  embeddingModel?: string | null;
  labCount: number;
  totalSubmissions: number;
  years: number[];
  transitions: string[];
  labs: DriftWorkspaceLab[];
  missingAssignments?: { assignmentKey: string; reason: string }[];
  generatedAt: string;
};
