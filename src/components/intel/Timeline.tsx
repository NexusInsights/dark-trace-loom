import { cn } from "@/lib/utils";

/* ---- Timeline ---- */
interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  description?: string;
  type?: "info" | "alert" | "success" | "critical";
}

interface InvestigationTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const typeColor: Record<string, string> = {
  info: "bg-primary",
  alert: "bg-warning",
  success: "bg-success",
  critical: "bg-destructive",
};

export function InvestigationTimeline({ events, className }: InvestigationTimelineProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-accent/30 to-transparent" />

      <div className="space-y-4">
        {events.map((event, i) => (
          <div
            key={event.id}
            className="relative pl-7 animate-fade-in"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Dot */}
            <div
              className={cn(
                "absolute left-0 top-1.5 w-[14px] h-[14px] rounded-full border-2 border-background",
                typeColor[event.type ?? "info"]
              )}
              style={{
                boxShadow: `0 0 8px ${event.type === "critical" ? "hsl(var(--destructive) / 0.5)" : "hsl(var(--neon-blue) / 0.3)"}`,
              }}
            />

            <div className="glass-panel rounded-lg p-3.5 hover:glow-blue transition-all duration-200">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[10px] text-muted-foreground tracking-wider">{event.time}</span>
                {event.type && event.type !== "info" && (
                  <span className={cn(
                    "intel-tag",
                    event.type === "critical" && "text-destructive border-destructive/30 bg-destructive/8",
                    event.type === "alert" && "text-warning border-warning/30 bg-warning/8",
                    event.type === "success" && "text-success border-success/30 bg-success/8",
                  )}>
                    {event.type.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium">{event.title}</p>
              {event.description && (
                <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
