import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { forwardRef } from "react";

/* ---- Intel Input ---- */
interface IntelInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const IntelInput = forwardRef<HTMLInputElement, IntelInputProps>(
  ({ className, label, hint, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {label}
        </label>
      )}
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm",
          "placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
          "transition-all duration-200 font-body",
          className
        )}
        {...props}
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
);
IntelInput.displayName = "IntelInput";

/* ---- Intel Textarea ---- */
interface IntelTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const IntelTextarea = forwardRef<HTMLTextAreaElement, IntelTextareaProps>(
  ({ className, label, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm",
          "placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
          "transition-all duration-200 font-body resize-none",
          className
        )}
        {...props}
      />
    </div>
  )
);
IntelTextarea.displayName = "IntelTextarea";

/* ---- Global Search Bar ---- */
interface GlobalSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function GlobalSearch({ value, onChange, placeholder = "Search investigations, entities, IOCs...", className }: GlobalSearchProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full h-10 pl-10 pr-4 rounded-lg",
          "glass-panel border-border/60",
          "text-sm placeholder:text-muted-foreground/50",
          "focus:outline-none focus:border-primary/40 focus:glow-blue",
          "transition-all duration-200"
        )}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
        ⌘K
      </kbd>
    </div>
  );
}
