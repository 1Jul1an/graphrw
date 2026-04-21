type Props = {
  headers: string[];
  rows: string[][];
  emptyLabel?: string;
};

export function SimpleTable({ headers, rows, emptyLabel = "Keine Daten." }: Props) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-250 bg-white px-4 py-6 text-sm text-slate-500 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
      <table className="docs-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row.join("-")}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
