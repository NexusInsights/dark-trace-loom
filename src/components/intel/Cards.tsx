import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  neonLine?: "top" | "left" | "none";
  glow?: "blue" | "purple" | "none";
}

export function GlassPanel({ children, className, neonLine = "none", glow = "none" }: GlassPanelProps) {
  return (
    <div
      className={cn(
        "glass-panel rounded-lg",
        neonLine === "top" && "neon-line-top",
        neonLine === "left" && "neon-line-left",
        glow === "blue" && "glow-blue",
        glow === "purple" && "glow-purple",
        className
      )}
    >
      {children}
    </div>
  );
}

interface IntelCardProps {
  children: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
  title?: string;
  badge?: string;
  interactive?: boolean;
}

export function IntelCard({ children, className, icon: Icon, title, badge, interactive = false }: IntelCardProps) {
  return (
    <div
      className={cn(
        "glass-panel rounded-lg p-5 group",
        interactive && "cursor-pointer hover:glow-blue transition-all duration-300 hover:border-primary/30",
        className
      )}
    >
      {(Icon || title || badge) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon className="h-4 w-4 text-primary" />}
            {title && <h3 className="font-display text-sm font-semibold tracking-tight">{title}</h3>}
          </div>
          {badge && <span className="intel-tag intel-tag-blue">{badge}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

interface StatDisplayProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  status?: "active" | "warning" | "critical";
}

export function StatDisplay({ label, value, icon: Icon, trend, status = "active" }: StatDisplayProps) {
  return (
    <div className="glass-panel rounded-lg p-4 hover:glow-blue transition-all duration-300">
      <div className="flex items-start justify-between mb-3">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <div className={`status-indicator status-${status}`} />
      </div>
      <p className="font-display text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {trend && (
        <p className={cn(
          "text-[11px] font-mono mt-2",
          trend.positive ? "text-success" : "text-muted-foreground"
        )}>
          {trend.value}
        </p>
      )}
    </div>
  );
}
