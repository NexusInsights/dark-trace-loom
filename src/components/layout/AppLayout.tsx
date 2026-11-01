import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet, Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { OperationalDataStatus } from "./OperationalDataStatus";

export function AppLayout() {
  const location=useLocation();
  useEffect(()=>{const titles:Record<string,string>={"/investigations":"Person investigations","/sources":"Research sources","/reports":"Investigation reports","/settings":"Workspace settings"};document.title=`${titles[location.pathname]||"Person investigation workspace"} | Insight Nexus`;},[location.pathname]);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-14 flex items-center gap-4 border-b border-border px-4 glass-panel-elevated sticky top-0 z-30 neon-line-top">
            <SidebarTrigger className="-ml-1" />
            <Link to="/investigations" className="font-medium text-sm">Person investigation workspace</Link>
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
