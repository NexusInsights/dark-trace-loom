import { useState } from "react";
import { GlassPanel } from "@/components/intel";
import { allTools } from "@/components/tools/toolDefinitions";
import { ToolRunner } from "@/components/tools/ToolRunner";

export default function ToolSuitePage() {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const tool = allTools.find((t) => t.id === activeTool);

  const categories = Array.from(new Set(allTools.map((t) => t.category)));

  if (tool) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in">
        <ToolRunner tool={tool} onBack={() => setActiveTool(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-8">
      <div>
        <span className="intel-tag intel-tag-blue mb-3 inline-block">{allTools.length} MODULES</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">Tool Suite</h1>
        <p className="text-sm text-muted-foreground mt-1">Modular intelligence gathering and analysis tools</p>
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <h3 className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground mb-3 uppercase">{cat}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {allTools.filter((t) => t.category === cat).map((t) => (
              <GlassPanel
                key={t.id}
                className="p-4 group cursor-pointer hover:glow-blue transition-all duration-300"
              >
                <button onClick={() => setActiveTool(t.id)} className="w-full text-left">
                  <div className="flex items-center gap-3 mb-2">
                    <t.icon className="h-4 w-4 text-primary" />
                    <span className="font-display text-sm font-semibold">{t.name}</span>
                    <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-primary">
                      LAUNCH →
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </button>
              </GlassPanel>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
