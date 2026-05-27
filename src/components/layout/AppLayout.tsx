import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Outlet } from "react-router-dom";
import { GlobalSearch, CommandPalette } from "@/components/intel";
import { useState } from "react";

export function AppLayout() {
  const [search, setSearch] = useState("");

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="h-14 flex items-center gap-4 border-b border-border px-4 glass-panel-elevated sticky top-0 z-30 neon-line-top">
            <SidebarTrigger className="-ml-1" />
            <GlobalSearch value={search} onChange={setSearch} className="max-w-md flex-1" />
            <div className="ml-auto flex items-center gap-3">
              <div className="status-indicator status-active" />
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground hidden sm:inline">
                SYSTEM OPERATIONAL
              </span>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 overflow-auto grid-dots">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette />
    </SidebarProvider>
  );
}
