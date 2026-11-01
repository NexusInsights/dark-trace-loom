import {
  Search, Shield, Radar, FileText, Database, Settings, Brain, BookOpen,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Investigations", url: "/investigations", icon: Search },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Sources", url: "/sources", icon: Database },
  { title: "Intelligence Lab", url: "/intelligence", icon: Brain },
  { title: "Research Workbench", url: "/research", icon: BookOpen },
];

const resourceNav = [
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border neon-line-left">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
           <div className="relative">
            <Shield className="h-6 w-6 text-primary flex-shrink-0" />
            <Radar className="h-3 w-3 text-accent absolute -bottom-0.5 -right-0.5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-display font-bold text-sm tracking-wider text-foreground truncate">
                Insight<span className="text-primary">Nexus</span>
              </span>
              <span className="font-mono text-[9px] tracking-widest text-muted-foreground">
                PERSON INVESTIGATIONS
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground px-2 mb-1">
            WORKSPACE
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className="rounded-md h-9 transition-all duration-200"
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-primary/10 text-primary border-l-2 border-primary"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span className="text-[13px]">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground px-2 mb-1">
            ACCOUNT
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {resourceNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className="rounded-md h-9 transition-all duration-200"
                  >
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-primary/10 text-primary border-l-2 border-primary"
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span className="text-[13px]">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
            <span>v1.0.0</span>
            <span className="intel-tag intel-tag-purple">BETA</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
