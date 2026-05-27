import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Trash2, ChevronDown, ChevronRight, Database } from "lucide-react";

type Lookup = {
  id: string;
  lookup_type: "person-enrich" | "person-search" | "company-enrich";
  label: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
};

const TYPE_LABEL: Record<Lookup["lookup_type"], string> = {
  "person-enrich": "Person Enrichment",
  "person-search": "Person Search",
  "company-enrich": "Company Enrichment",
};

export default function PdlHistory() {
  const [items, setItems] = useState<Lookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | Lookup["lookup_type"]>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pdl_lookups")
      .select("id,lookup_type,label,inputs,result,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setItems((data || []) as unknown as Lookup[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    document.title = "PDL History — Insight Nexus";
  }, []);

  const remove = async (id: string) => {
    const { error } = await supabase.from("pdl_lookups").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.filter((x) => x.id !== id));
    toast.success("Deleted");
  };

  const visible = filter === "all" ? items : items.filter((i) => i.lookup_type === filter);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="intel-tag intel-tag-blue">DATA LIBRARY</span>
          <h1 className="text-2xl font-display font-bold tracking-tight text-foreground mt-2 flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" /> PDL Lookup History
          </h1>
          <p className="text-sm text-muted-foreground">Saved People Data Labs enrichment and search results.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="flex gap-1 p-1 bg-secondary rounded-md w-fit">
        {(["all", "person-enrich", "person-search", "company-enrich"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded text-xs font-mono tracking-wider transition-colors ${
              filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "all" ? "ALL" : TYPE_LABEL[k].toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <GlassPanel className="p-8 text-center text-sm text-muted-foreground">
          No saved lookups yet. Run a PDL tool from the marketplace to start building history.
        </GlassPanel>
      ) : (
        <div className="space-y-2">
          {visible.map((it) => {
            const open = !!expanded[it.id];
            return (
              <GlassPanel key={it.id} className="p-4">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [it.id]: !open }))}
                    className="mt-1 text-muted-foreground hover:text-foreground"
                    aria-label={open ? "Collapse" : "Expand"}
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="intel-tag intel-tag-blue text-[10px]">{TYPE_LABEL[it.lookup_type]}</span>
                      <span className="text-sm font-medium text-foreground truncate">{it.label || "(unlabeled)"}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(it.created_at).toLocaleString()}
                      </span>
                    </div>
                    {open && (
                      <div className="mt-3 grid md:grid-cols-2 gap-3">
                        <div>
                          <div className="font-mono text-[10px] tracking-widest text-muted-foreground mb-1">INPUTS</div>
                          <pre className="text-[11px] bg-secondary/50 border border-border rounded p-2 overflow-auto max-h-72">
{JSON.stringify(it.inputs, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] tracking-widest text-muted-foreground mb-1">RESULT</div>
                          <pre className="text-[11px] bg-secondary/50 border border-border rounded p-2 overflow-auto max-h-72">
{JSON.stringify(it.result, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(it.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}
    </div>
  );
}