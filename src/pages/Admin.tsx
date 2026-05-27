import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel, StatDisplay, IntelCard } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Users, Shield, BarChart3, ScrollText, Loader2,
  ShieldCheck, ShieldAlert, User, Crown, Minus, Plus,
  Activity, FolderOpen, FileText, Wrench, BookOpen, GraduationCap,
  KeyRound, Lock, Unlock, Copy, Check,
} from "lucide-react";
import { allTools } from "@/components/tools/toolDefinitions";
import { extraTools } from "@/components/tools/extraTools";

type AdminUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  name: string | null;
  profile_role: string | null;
  roles: string[];
};

type SystemLog = {
  id: string;
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  level: string;
  created_at: string;
};

const TABS = ["users", "permissions", "analytics", "logs"] as const;
type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, { icon: typeof Users; label: string }> = {
  users: { icon: Users, label: "USER MANAGEMENT" },
  permissions: { icon: Lock, label: "TOOL PERMISSIONS" },
  analytics: { icon: BarChart3, label: "USAGE ANALYTICS" },
  logs: { icon: ScrollText, label: "SYSTEM LOGS" },
};

const ROLE_COLORS: Record<string, string> = {
  admin: "text-destructive border-destructive/30 bg-destructive/8",
  moderator: "intel-tag-purple",
  user: "intel-tag-blue",
};

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Admin access check ───
function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin");
      return (data ?? []).length > 0;
    },
  });
}

// ─── Data hooks ───
function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=list_users`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? "Failed to load users");
      }
      const json = await res.json();
      return (json.users ?? []) as AdminUser[];
    },
  });
}

function useAdminStats() {
  return useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=stats`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? "Failed to load stats");
      }
      return await res.json() as Record<string, number>;
    },
  });
}

function useSystemLogs() {
  return useQuery({
    queryKey: ["system-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as SystemLog[];
    },
  });
}

// ─── Users Tab ───
function UsersTab() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useAdminUsers();
  const [search, setSearch] = useState("");
  const [resetLink, setResetLink] = useState<{ email: string; link: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const setRole = useMutation({
    mutationFn: async ({ user_id, role, remove }: { user_id: string; role: string; remove: boolean }) => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=set_role`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id, role, remove }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Role updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: async (user_id: string) => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=reset_password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id }),
        }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Reset failed");
      return await res.json() as { email: string; action_link: string | null };
    },
    onSuccess: (data) => {
      setResetLink({ email: data.email, link: data.action_link });
      toast.success(`Password recovery generated for ${data.email}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = users.filter(
    (u) =>
      (u.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search users..."
        className="w-full max-w-sm bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">USER</th>
              <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">ROLES</th>
              <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">LAST SEEN</th>
              <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">JOINED</th>
              <th className="text-right px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium">{u.name || "—"}</p>
                    <p className="text-muted-foreground text-[10px]">{u.email}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 flex-wrap">
                    {u.roles.length === 0 && <span className="intel-tag intel-tag-muted">none</span>}
                    {u.roles.map((r) => (
                      <span key={r} className={`intel-tag ${ROLE_COLORS[r] ?? "intel-tag-muted"}`}>
                        {r.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{timeAgo(u.last_sign_in_at)}</td>
                <td className="px-4 py-3 font-mono text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={resetPassword.isPending}
                      onClick={() => {
                        if (confirm(`Generate password recovery link for ${u.email}?`)) {
                          resetPassword.mutate(u.id);
                        }
                      }}
                    >
                      <KeyRound className="h-2.5 w-2.5 mr-1" />
                      reset pw
                    </Button>
                    {(["admin", "moderator", "user"] as const).map((role) => {
                      const has = u.roles.includes(role);
                      return (
                        <Button
                          key={role}
                          variant={has ? "outline" : "ghost"}
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={setRole.isPending}
                          onClick={() => setRole.mutate({ user_id: u.id, role, remove: has })}
                        >
                          {has ? <Minus className="h-2.5 w-2.5 mr-1" /> : <Plus className="h-2.5 w-2.5 mr-1" />}
                          {role}
                        </Button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] font-mono text-muted-foreground">{filtered.length} user(s)</p>

      {resetLink && (
        <GlassPanel className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono tracking-wider text-primary">RECOVERY LINK · {resetLink.email}</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setResetLink(null)}>close</Button>
          </div>
          {resetLink.link ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] break-all bg-secondary/40 border border-border rounded px-2 py-1.5 font-mono">{resetLink.link}</code>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => {
                  navigator.clipboard.writeText(resetLink.link!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? "copied" : "copy"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Recovery email queued — link not returned.</p>
          )}
          <p className="text-[10px] text-muted-foreground">Share this link with the user over a secure channel. It expires per Supabase Auth defaults.</p>
        </GlassPanel>
      )}
    </div>
  );
}

// ─── Permissions Tab ───
type ToolPerm = { user_id: string; tool_id: string; allowed: boolean; updated_at: string };

function PermissionsTab() {
  const qc = useQueryClient();
  const { data: users = [] } = useAdminUsers();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [filter, setFilter] = useState("");

  const tools = [...allTools, ...extraTools]
    .map((t) => ({ id: t.id, name: t.name, category: t.category }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { data: perms = [], isLoading } = useQuery({
    queryKey: ["tool-permissions", selectedUserId],
    enabled: !!selectedUserId,
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=list_tool_permissions&user_id=${selectedUserId}`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) throw new Error("Failed to load permissions");
      const json = await res.json();
      return (json.permissions ?? []) as ToolPerm[];
    },
  });

  const setPerm = useMutation({
    mutationFn: async ({ tool_id, allowed }: { tool_id: string; allowed: boolean }) => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=set_tool_permission`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: selectedUserId, tool_id, allowed }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tool-permissions", selectedUserId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearPerm = useMutation({
    mutationFn: async (tool_id: string) => {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=clear_tool_permission`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: selectedUserId, tool_id }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tool-permissions", selectedUserId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const permMap = new Map(perms.map((p) => [p.tool_id, p.allowed]));
  const filtered = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.id.toLowerCase().includes(filter.toLowerCase()) ||
      (t.category ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">— Select a user —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
          ))}
        </select>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools by name, id, or category..."
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {!selectedUserId ? (
        <GlassPanel className="p-12 text-center">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">SELECT A USER TO MANAGE TOOL ACCESS</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Tools default to allowed unless an explicit deny rule exists.</p>
        </GlassPanel>
      ) : isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">TOOL</th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">CATEGORY</th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">STATUS</th>
                <th className="text-right px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const explicit = permMap.has(t.id);
                const allowed = explicit ? permMap.get(t.id)! : true;
                return (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{t.id}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.category ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`intel-tag ${allowed ? "intel-tag-blue" : "text-destructive border-destructive/30 bg-destructive/8"}`}>
                        {allowed ? "ALLOWED" : "DENIED"}{!explicit && " · default"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          variant={allowed && explicit ? "outline" : "ghost"}
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={setPerm.isPending}
                          onClick={() => setPerm.mutate({ tool_id: t.id, allowed: true })}
                        >
                          <Unlock className="h-2.5 w-2.5 mr-1" /> allow
                        </Button>
                        <Button
                          variant={!allowed ? "outline" : "ghost"}
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={setPerm.isPending}
                          onClick={() => setPerm.mutate({ tool_id: t.id, allowed: false })}
                        >
                          <Lock className="h-2.5 w-2.5 mr-1" /> deny
                        </Button>
                        {explicit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            disabled={clearPerm.isPending}
                            onClick={() => clearPerm.mutate(t.id)}
                          >
                            reset
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Analytics Tab ───
function AnalyticsTab() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: users = [] } = useAdminUsers();

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatDisplay label="Total Users" value={users.length} icon={Users} status="active" />
        <StatDisplay label="Cases" value={stats?.cases ?? 0} icon={FolderOpen} status="active" />
        <StatDisplay label="Artifacts" value={stats?.artifacts ?? 0} icon={FileText} status="active" />
        <StatDisplay label="Tool Runs" value={stats?.tool_results ?? 0} icon={Wrench} status="active" />
        <StatDisplay label="Articles" value={stats?.articles ?? 0} icon={BookOpen} status="active" />
        <StatDisplay label="Courses" value={stats?.courses ?? 0} icon={GraduationCap} status="active" />
      </div>

      <IntelCard icon={Activity} title="User Activity" badge="OVERVIEW">
        <div className="space-y-1">
          {users.slice(0, 10).map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-secondary/40 transition-colors">
              <div className={`status-indicator ${u.last_sign_in_at && Date.now() - new Date(u.last_sign_in_at).getTime() < 86400000 ? "status-active" : "status-inactive"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{u.name || u.email}</p>
                <p className="text-[10px] text-muted-foreground">{u.email}</p>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(u.last_sign_in_at)}</span>
            </div>
          ))}
        </div>
      </IntelCard>
    </div>
  );
}

// ─── Logs Tab ───
function LogsTab() {
  const { data: logs = [], isLoading } = useSystemLogs();

  const levelIcon: Record<string, typeof ShieldCheck> = {
    info: Activity,
    warning: ShieldAlert,
    error: ShieldAlert,
    critical: ShieldAlert,
  };
  const levelColor: Record<string, string> = {
    info: "text-primary",
    warning: "text-warning",
    error: "text-destructive",
    critical: "text-destructive",
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      {logs.length === 0 ? (
        <GlassPanel className="p-12 text-center">
          <ScrollText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">NO SYSTEM LOGS</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Logs will appear here as system events occur</p>
        </GlassPanel>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">LEVEL</th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">ACTION</th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">DETAILS</th>
                <th className="text-left px-4 py-2.5 font-mono text-[10px] tracking-widest text-muted-foreground">TIME</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const Icon = levelIcon[log.level] ?? Activity;
                return (
                  <tr key={log.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3.5 w-3.5 ${levelColor[log.level] ?? "text-muted-foreground"}`} />
                        <span className="font-mono uppercase">{log.level}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{log.action}</td>
                    <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                      {JSON.stringify(log.details)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{timeAgo(log.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main ───
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const { data: isAdmin, isLoading: checkingAdmin } = useIsAdmin();

  if (checkingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center p-6">
        <ShieldAlert className="h-12 w-12 text-destructive/50 mb-4" />
        <h1 className="text-xl font-display font-bold mb-2">Access Denied</h1>
        <p className="text-sm text-muted-foreground">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="intel-tag text-destructive border-destructive/30 bg-destructive/8 mb-3 inline-block">ADMIN</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">System Administration</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage users, roles, and monitor system activity</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const meta = TAB_META[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono tracking-wider transition-colors border-b-2 ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <meta.icon className="h-3.5 w-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="animate-fade-in">
        {tab === "users" && <UsersTab />}
        {tab === "permissions" && <PermissionsTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "logs" && <LogsTab />}
      </div>
    </div>
  );
}
