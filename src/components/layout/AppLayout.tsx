import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { OperationalDataStatus } from "./OperationalDataStatus";

export function AppLayout() {
  const location=useLocation();
  const titles: Record<string, string> = {
    "/dashboard": "Dashboard", "/tools": "Tool Suite", "/marketplace": "Marketplace",
    "/agents": "Agents", "/pipelines": "Pipelines", "/investigations": "Case Investigations",
    "/reports": "Reports", "/correlations": "Correlations", "/identity": "Identity Resolution",
    "/social-graph": "Social Graph", "/personas": "Persona Discovery", "/persona-profile": "Persona Profiles",
    "/persona-intel": "Persona Intel", "/person-investigations": "Person Investigations",
    "/person-reports": "Person Reports", "/sources": "Research Sources", "/research": "Research Workbench",
    "/intelligence": "Intelligence Lab", "/settings": "Workspace Settings", "/pdl-history": "PDL History",
    "/organizations": "Organizations", "/activity": "Activity Logs", "/alerts": "Alerts",
    "/monitoring": "Monitoring", "/evidence-export": "Evidence Export", "/training": "Training",
    "/knowledge": "Knowledge Base", "/api": "API", "/pricing": "Pricing", "/billing": "Billing", "/admin": "Admin",
  };
  const title = titles[location.pathname] || "Intelligence Platform";
  useEffect(() => { document.title = `${title} | Insight Nexus`; }, [title]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-14 flex items-center gap-4 border-b border-border px-4 glass-panel-elevated sticky top-0 z-30 neon-line-top">
            <SidebarTrigger className="-ml-1" />
            <Link to="/dashboard" className="font-medium text-sm">Insight Nexus</Link>
            <span className="text-sm text-muted-foreground truncate">{title}</span>
            <div className="ml-auto flex items-center gap-3">
              <div className="status-indicator status-active" />
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground hidden sm:inline">
                SIGNED-IN WORKSPACE
              </span>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 overflow-auto grid-dots">
            <OperationalDataStatus />
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
