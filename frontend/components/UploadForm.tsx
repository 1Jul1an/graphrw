import type { ChangeEvent, FormEvent } from "react";
import { EMBEDDING_MODEL_OPTIONS, ENGINE_OPTIONS, type EmbeddingModelName, type EngineKey } from "../lib/types";
import { Card } from "./Card";

type Props = {
  assignmentName: string;
  bundleName?: string | null;
  busy: boolean;
  canStart: boolean;
  activeEngine: EngineKey;
  embeddingModel: EmbeddingModelName;
  onSubmit: (event: FormEvent) => void;
  onAssignmentNameChange: (value: string) => void;
  onBundleChange: (file: File | null) => void;
  onEngineChange: (engine: EngineKey) => void;
  onEmbeddingModelChange: (model: EmbeddingModelName) => void;
};

export function UploadForm({
  assignmentName,
  bundleName,
  busy,
  canStart,
  activeEngine,
  embeddingModel,
  onSubmit,
  onAssignmentNameChange,
  onBundleChange,
  onEngineChange,
  onEmbeddingModelChange,
}: Props) {
  return (
    <Card eyebrow="Setup" title="Assignment starten">
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <span className="mb-2 block text-sm font-medium text-slate-800 dark:text-mdn-dark-text">Analyse-Engine</span>
          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-25 p-2 dark:border-mdn-dark-border dark:bg-mdn-dark-surface sm:grid-cols-3">
            {ENGINE_OPTIONS.map((engine) => {
              const isActive = engine.key === activeEngine;
              const isFuture = engine.key === "engine3";
              return (
                <button
                  key={engine.key}
                  type="button"
                  disabled={busy}
                  onClick={() => onEngineChange(engine.key)}
                  className={`rounded-xl px-3 py-3 text-left transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-sm dark:bg-[#18191b]"
                      : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-[#212426] dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                  } ${busy ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <span className="block text-sm font-semibold">{engine.label}</span>
                  <span className={`mt-1 block text-xs ${isActive ? "text-slate-200" : "text-slate-500 dark:text-mdn-dark-muted"}`}>
                    {engine.description}{isFuture ? " · vorbereitet" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {activeEngine === "engine2" ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 dark:border-mdn-dark-border dark:bg-[#212426]">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-mdn-dark-text">Engine2 Embedding-Modell</span>
                <span className="text-xs text-slate-500 dark:text-mdn-dark-muted">Balanced ist der Default</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {EMBEDDING_MODEL_OPTIONS.map((option) => {
                  const isActive = option.model === embeddingModel;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={busy || activeEngine !== "engine2"}
                      onClick={() => onEmbeddingModelChange(option.model)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white dark:border-[#18191b] dark:bg-[#18191b]"
                          : "border-slate-200 bg-slate-25 text-slate-700 hover:bg-slate-100 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30]"
                      } ${busy ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={`mt-1 block font-mono text-xs ${isActive ? "text-slate-200" : "text-slate-500 dark:text-mdn-dark-muted"}`}>
                        {option.model}
                      </span>
                      <span className={`mt-1 block text-xs ${isActive ? "text-slate-200" : "text-slate-500 dark:text-mdn-dark-muted"}`}>
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : activeEngine === "engine3" ? (
            <p className="mt-2 text-sm leading-6 text-amber-700 dark:text-amber-300">
              Engine 3 ist der Slot für späteres Supervised Learning. Start ist deaktiviert, bis Labels und Training angebunden sind.
            </p>
          ) : null}
        </div>

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
          <p className="text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">
            Engine 1 lädt Expr, Struct, Sem und Fusion. Engine 2 lädt einen Embedding-Graphen mit dem gewählten Ollama-Modell.
          </p>
        </div>
      </form>
    </Card>
  );
}
