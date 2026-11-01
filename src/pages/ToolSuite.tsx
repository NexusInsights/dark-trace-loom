import { Link, useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useInstalledTools } from "@/hooks/useInstalledTools";
import { marketplaceImplementation, marketplaceUnavailableReason } from "@/lib/marketplaceTools";
import { getMarketplaceStatuses } from "@/components/tools/marketplaceRemoteTools";
import type { ToolDefinition } from "@/components/tools/types";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/intel";
import { allTools } from "@/components/tools/toolDefinitions";
import { ToolRunner } from "@/components/tools/ToolRunner";

export default function ToolSuitePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTool = searchParams.get("tool");
  const setActiveTool = (id: string | null) => setSearchParams(id ? {tool:id} : {});
  const {data: installed = [], isLoading: loadingInstalled, error: installedError, refetch} = useInstalledTools();
  const tool = allTools.find((t) => t.id === activeTool);
  const selectedInstallation = installed.find(row => `marketplace:${row.tool_id}` === activeTool);
  const providers = useQuery({ queryKey: ["marketplace-provider-status", user?.id], enabled: Boolean(user) && !tool, queryFn: getMarketplaceStatuses, staleTime: 60000, retry: false });
  const readiness = (implementation: ToolDefinition): string => {
    if (!implementation.integration) return implementation.id === "geolocation-analyzer" || ["username-permutator", "email-permutator", "document-forensics", "network-forensics"].includes(implementation.id) ? "Runs on your supplied input" : "Existing implementation";
    if (providers.isLoading) return "Checking provider setup…";
    if (providers.error) return "Provider setup could not be checked";
    const status = providers.data?.[implementation.id];
    if (!status) return "Deployed provider integration is unavailable";
    return status.configured ? "Provider configured — access is checked on execution" : status.missing_secrets.length ? `Provider setup required: ${status.missing_secrets.join(", ")}` : "Provider configuration is unavailable; open tool for the exact error";
  };

  const categories = Array.from(new Set(allTools.map((t) => t.category)));

  if (tool) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in">
        <ToolRunner key={tool.id} tool={tool} onBack={() => setActiveTool(null)} />
      </div>
    );
  }

  if (selectedInstallation) {
    const listing = selectedInstallation.tool_marketplace;
    const implementation = listing ? marketplaceImplementation(listing) : undefined;
    return <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Button variant="outline" onClick={() => setActiveTool(null)}>Back to Tool Suite</Button>
      <GlassPanel className="p-5 space-y-3">
        <h1 className="text-xl font-semibold">{listing?.tool_name || "Unavailable catalog listing"}</h1>
        <p className="text-xs text-muted-foreground">Published catalog description</p>
        <p className="text-sm text-muted-foreground">{listing?.description}</p>
        {!selectedInstallation.enabled ? <p role="status">This installation is disabled.</p> : implementation ? <>
          <p className="text-sm font-semibold">Executable implementation: {implementation.name}</p>
          {implementation.integration && <p className="text-xs">Data source: {implementation.integration.provider}</p>}
          <p className="text-sm text-muted-foreground">{implementation.description}</p>
          <p className="text-xs" role="status">{readiness(implementation)}</p>
          <p className="text-xs text-muted-foreground">The implementation scope above determines what this tool actually returns. Broader catalog claims require additional integrations.</p>
          <Button onClick={() => setActiveTool(implementation.id)}>Open {implementation.name}</Button>
        </> : <p role="status" className="text-sm">{marketplaceUnavailableReason(listing?.slug || "")}</p>}
        <Button asChild variant="outline"><Link to="/marketplace">Manage marketplace installations</Link></Button>
      </GlassPanel>
    </div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-8">
      <div>
        <span className="intel-tag intel-tag-blue mb-3 inline-block">{allTools.length} MODULES</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">Tool Suite</h1>
        <p className="text-sm text-muted-foreground mt-1">Modular intelligence gathering and analysis tools</p>
      </div>

      <section className="space-y-3" aria-label="Installed marketplace tools">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Installed marketplace tools ({installed.length})</h2>
          <Button asChild variant="outline" size="sm"><Link to="/marketplace">Manage installations</Link></Button>
        </div>
        {loadingInstalled && <p role="status" className="text-sm">Loading installed tools…</p>}
        {installedError && <div role="alert" className="text-sm text-destructive">{installedError.message} <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>}
        {providers.error && <div role="alert" className="text-xs text-destructive">Provider readiness: {providers.error instanceof Error ? providers.error.message : "Configuration could not be verified"}. <Button variant="outline" size="sm" onClick={() => providers.refetch()}>Recheck providers</Button></div>}
        {!loadingInstalled && !installedError && !installed.length && <p className="text-sm text-muted-foreground">Save a marketplace tool to see it here.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {installed.map(row => {
            const listing = row.tool_marketplace;
            const implementation = listing ? marketplaceImplementation(listing) : undefined;
            return <GlassPanel key={row.tool_id} className="p-4 space-y-2">
              <div className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{listing?.tool_name || `Unavailable listing ${row.tool_id}`}</h3></div>
              <p className="text-xs text-muted-foreground">{!row.enabled ? "Disabled" : implementation ? readiness(implementation) : marketplaceUnavailableReason(listing?.slug || "")}</p>
              {implementation && <p className="text-xs text-muted-foreground">{implementation.description}</p>}
              <Button size="sm" variant="outline" onClick={() => setActiveTool(`marketplace:${row.tool_id}`)}>View scope and launch</Button>
            </GlassPanel>;
          })}
        </div>
      </section>
      <h2 className="text-lg font-semibold">Built-in tools ({allTools.length})</h2>

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
                  {t.integration && <p className="text-[10px] mt-2 text-muted-foreground">{t.integration.provider} · {readiness(t)}</p>}
                </button>
              </GlassPanel>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
