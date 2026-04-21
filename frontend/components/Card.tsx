import type { ReactNode } from "react";

type Props = {
  title?: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Card({ title, eyebrow, description, actions, className = "", children }: Props) {
  return (
    <section className={`docs-card p-5 sm:p-6 ${className}`.trim()}>
      {(title || eyebrow || description || actions) && (
        <header className="mb-5 flex flex-col gap-4 border-b border-slate-150 pb-5 dark:border-mdn-dark-border sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">{eyebrow}</div>
            ) : null}
            {title ? <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-900 dark:text-mdn-dark-text">{title}</h2> : null}
            {description ? <p className="mt-2 max-w-[72ch] text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
