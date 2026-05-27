import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/* ---- Expandable Analysis Panel ---- */
interface AnalysisPanelProps {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AnalysisPanel({ title, badge, defaultOpen = false, children, className }: AnalysisPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("glass-panel rounded-lg overflow-hidden", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <h3 className="font-display text-sm font-semibold tracking-tight">{title}</h3>
          {badge && <span className="intel-tag intel-tag-purple">{badge}</span>}
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform duration-200",
          open && "rotate-180"
        )} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border/50 pt-4 animate-slide-down">
          {children}
        </div>
      )}
    </div>
  );
}

/* ---- Evidence Viewer ---- */
interface EvidenceItem {
  id: string;
  type: "text" | "image" | "link" | "code" | "file";
  label: string;
  content: string;
  timestamp?: string;
  source?: string;
}

interface EvidenceViewerProps {
  items: EvidenceItem[];
  className?: string;
}

const typeIcons: Record<string, string> = {
  text: "📄",
  image: "🖼️",
  link: "🔗",
  code: "💻",
  file: "📎",
};

export function EvidenceViewer({ items, className }: EvidenceViewerProps) {
  const [selected, setSelected] = useState<string | null>(items[0]?.id ?? null);
  const active = items.find((i) => i.id === selected);

  return (
    <div className={cn("glass-panel rounded-lg overflow-hidden grid grid-cols-[240px_1fr] min-h-[320px]", className)}>
      {/* Evidence list */}
      <div className="border-r border-border/50 overflow-auto">
        <div className="px-3 py-2 border-b border-border/50">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">EVIDENCE ({items.length})</span>
        </div>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelected(item.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors text-xs",
              selected === item.id
                ? "bg-primary/10 border-l-2 border-l-primary"
                : "hover:bg-secondary/40"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px]">{typeIcons[item.type]}</span>
              <span className="truncate font-medium">{item.label}</span>
            </div>
            {item.timestamp && (
              <p className="font-mono text-[10px] text-muted-foreground mt-0.5 ml-5">{item.timestamp}</p>
            )}
          </button>
        ))}
      </div>

      {/* Detail view */}
      <div className="p-5 overflow-auto">
        {active ? (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-display text-sm font-semibold">{active.label}</h4>
              <span className="intel-tag intel-tag-muted">{active.type.toUpperCase()}</span>
            </div>
            {active.source && (
              <p className="text-[11px] text-muted-foreground font-mono mb-3">Source: {active.source}</p>
            )}
            {active.type === "code" ? (
              <pre className="bg-background/60 border border-border rounded p-3 text-xs font-mono overflow-auto">
                {active.content}
              </pre>
            ) : (
              <p className="text-sm text-secondary-foreground leading-relaxed">{active.content}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground font-mono">
            SELECT EVIDENCE ITEM
          </div>
        )}
      </div>
    </div>
  );
}
