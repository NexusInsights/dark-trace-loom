import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Activity, Search, Filter, LogIn, Wrench, Upload, FolderOpen,
  FileText, UserPlus, Key, Building2, Download, Clock, ChevronLeft, ChevronRight,
} from "lucide-react";

const ACTION_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  login: { label: "Login", icon: LogIn, color: "intel-tag-blue" },
  logout: { label: "Logout", icon: LogIn, color: "intel-tag-muted" },
  tool_execution: { label: "Tool Executed", icon: Wrench, color: "intel-tag-purple" },
  artifact_upload: { label: "Artifact Uploaded", icon: Upload, color: "intel-tag-amber" },
  case_created: { label: "Case Created", icon: FolderOpen, color: "intel-tag-blue" },
  case_modified: { label: "Case Modified", icon: FolderOpen, color: "intel-tag-muted" },
  case_deleted: { label: "Case Deleted", icon: FolderOpen, color: "intel-tag-red" },
  report_generated: { label: "Report Generated", icon: FileText, color: "intel-tag-purple" },
  subject_added: { label: "Subject Added", icon: UserPlus, color: "intel-tag-blue" },
  event_added: { label: "Event Added", icon: Clock, color: "intel-tag-muted" },
  analysis_run: { label: "AI Analysis Run", icon: Activity, color: "intel-tag-amber" },
  api_key_created: { label: "API Key Created", icon: Key, color: "intel-tag-purple" },
  api_key_revoked: { label: "API Key Revoked", icon: Key, color: "intel-tag-red" },
  org_created: { label: "Org Created", icon: Building2, color: "intel-tag-blue" },
  member_invited: { label: "Member Invited", icon: UserPlus, color: "intel-tag-blue" },
  tool_installed: { label: "Tool Installed", icon: Download, color: "intel-tag-purple" },
};

const PAGE_SIZE = 50;

interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function ActivityLogsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["activity-logs", page, actionFilter],
    queryFn: async () => {
      let query = supabase
        .from("activity_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { logs: data as unknown as ActivityLog[], total: count ?? 0 };
    },
    enabled: !!user,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filtered = search
    ? logs.filter(
        (l) =>
          l.action.includes(search.toLowerCase()) ||
          l.entity_type?.toLowerCase().includes(search.toLowerCase()) ||
          l.entity_id?.toLowerCase().includes(search.toLowerCase())
      )
    : logs;

  const actions = Object.keys(ACTION_CONFIG);

  return (
    <div className="p-6 max-w-5xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <span className="intel-tag intel-tag-amber mb-3 inline-block">AUDIT TRAIL</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">Activity Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track all actions performed across the platform
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Events", value: total },
          { label: "This Page", value: filtered.length },
          { label: "Page", value: `${page + 1} / ${Math.max(totalPages, 1)}` },
          { label: "Actions Tracked", value: actions.length },
        ].map((s) => (
          <GlassPanel key={s.label} className="p-3">
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase block mb-1">
              {s.label}
            </span>
            <span className="text-lg font-display font-bold">{s.value}</span>
          </GlassPanel>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search actions, entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>{ACTION_CONFIG[a].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Log Entries */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <GlassPanel key={i} className="p-4 animate-pulse h-16"><div /></GlassPanel>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassPanel className="p-10 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No activity logs found.</p>
        </GlassPanel>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((log) => {
            const config = ACTION_CONFIG[log.action] || {
              label: log.action,
              icon: Activity,
              color: "intel-tag-muted",
            };
            const Icon = config.icon;

            return (
              <GlassPanel key={log.id} className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-md bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`intel-tag ${config.color} text-[9px]`}>
                        {config.label.toUpperCase()}
                      </span>
                      {log.entity_type && (
                        <span className="text-xs text-muted-foreground">
                          {log.entity_type}
                          {log.entity_id && (
                            <span className="font-mono text-[10px] ml-1 text-foreground/60">
                              {log.entity_id.length > 12
                                ? log.entity_id.slice(0, 8) + "..."
                                : log.entity_id}
                            </span>
                          )}
                        </span>
                      )}
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {Object.entries(log.metadata)
                            .slice(0, 2)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(log.created_at)}
                  </span>
                </div>
              </GlassPanel>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
