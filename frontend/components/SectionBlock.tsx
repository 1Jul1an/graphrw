import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function SectionBlock({ title, description, children }: Props) {
  return (
    <section className="docs-subtle overflow-hidden">
      <div className="border-b border-slate-150 dark:border-mdn-dark-border px-5 py-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-mdn-dark-muted">{description}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
