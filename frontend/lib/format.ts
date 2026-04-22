export function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function bytesLabel(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function componentWeightLabel(key: string, weights?: Record<string, number>) {
  if (!weights) return "0.00";
  const mapping: Record<string, string> = {
    profile_cosine: "profile",
    contrast_cosine: "contrast",
    overlap_jaccard: "overlap",
    size_similarity: "size",
    weighted_consensus: "expr",
    agreement: "struct",
    independent_support: "sem",
  };
  const weight = weights[mapping[key] ?? key] ?? 0;
  return Number(weight).toFixed(2);
}

export function formatSpaceLabel(space: string) {
  const labels: Record<string, string> = {
    expr: "Expression Space | Token-Ähnlichkeitsraum",
    struct: "Structural Space | AST-Strukturraum",
    sem: "Semantic Space | Semantiksignalraum",
    fusion: "Fusion Space | kombinierter Ähnlichkeitsraum",
  };
  return labels[space] ?? space;
}
