type Props = {
  label: string;
  value: string;
  tone?: "default" | "accent" | "success";
};

export function Metric({ label, value, tone = "default" }: Props) {
  const toneClass =
    tone === "accent"
      ? "border-brand-100 bg-brand-50 dark:border-brand-700 dark:bg-brand-700/15"
      : tone === "success"
        ? "border-emerald-100 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
        : "border-slate-200 bg-slate-25 dark:border-mdn-dark-border dark:bg-mdn-dark-surface";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-mdn-dark-muted">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-slate-900 dark:text-mdn-dark-text sm:text-base">{value}</div>
    </div>
  );
}
