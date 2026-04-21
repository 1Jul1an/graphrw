import type { ChangeEvent, FormEvent } from "react";
import { Card } from "./Card";

type Props = {
  assignmentName: string;
  bundleName?: string | null;
  busy: boolean;
  canStart: boolean;
  onSubmit: (event: FormEvent) => void;
  onAssignmentNameChange: (value: string) => void;
  onBundleChange: (file: File | null) => void;
};

export function UploadForm({
  assignmentName,
  bundleName,
  busy,
  canStart,
  onSubmit,
  onAssignmentNameChange,
  onBundleChange,
}: Props) {
  return (
    <Card
      eyebrow="Setup"
      title="Assignment starten"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800 dark:text-mdn-dark-text">Assignment-Name</span>
            <input
              value={assignmentName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onAssignmentNameChange(event.target.value)}
              type="text"
              className="w-full rounded-2xl border border-slate-250 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-text dark:focus:ring-brand-700/20"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-800 dark:text-mdn-dark-text">Bundle-ZIP</span>
            <input
              type="file"
              accept=".zip"
              onChange={(event: ChangeEvent<HTMLInputElement>) => onBundleChange(event.target.files?.[0] ?? null)}
              className="block w-full rounded-2xl border border-slate-250 bg-white px-4 py-[0.8rem] text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted dark:file:bg-[#18191b] dark:hover:file:bg-[#2a2d30]"
            />
            <span className="mt-2 block text-sm text-slate-500 dark:text-mdn-dark-muted">{bundleName ?? "Noch keine Datei gewählt"}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!canStart}
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-[#18191b] dark:hover:bg-[#2a2d30] dark:disabled:bg-[#3a3f45]"
          >
            {busy ? "Analyse startet…" : "Upload + Analyse starten"}
          </button>
          <p className="text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">Nach dem Publish werden Expr, Struct, Sem und Fusion gemeinsam geladen.</p>
        </div>
      </form>
    </Card>
  );
}
