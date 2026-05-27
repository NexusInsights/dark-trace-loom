import { cn } from "@/lib/utils";

interface IntelTableColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface IntelTableProps<T> {
  columns: IntelTableColumn<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  className?: string;
}

export function IntelTable<T extends Record<string, unknown>>({
  columns, data, onRowClick, className,
}: IntelTableProps<T>) {
  return (
    <div className={cn("glass-panel rounded-lg overflow-hidden", className)}>
      {/* Header */}
      <div
        className="grid gap-4 px-4 py-2.5 border-b border-border bg-secondary/30"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => (
          <span
            key={col.key}
            className={cn(
              "font-mono text-[10px] tracking-widest text-muted-foreground uppercase",
              col.className
            )}
          >
            {col.header}
          </span>
        ))}
      </div>

      {/* Rows */}
      {data.map((item, i) => (
        <div
          key={i}
          onClick={() => onRowClick?.(item)}
          className={cn(
            "grid gap-4 px-4 py-3 border-b border-border/50 last:border-0 text-sm transition-colors",
            onRowClick && "cursor-pointer hover:bg-secondary/40"
          )}
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((col) => (
            <div key={col.key} className={cn("flex items-center min-w-0", col.className)}>
              {col.render ? col.render(item) : (
                <span className="truncate text-xs">{String(item[col.key] ?? "")}</span>
              )}
            </div>
          ))}
        </div>
      ))}

      {data.length === 0 && (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground font-mono">
          NO DATA AVAILABLE
        </div>
      )}
    </div>
  );
}
