import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatDisplay, IntelCard, GlassPanel } from "@/components/intel";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import {
  FolderOpen, FileText, Wrench, Activity,
  Clock, ChevronRight, Search, Network, Shield,
  AlertTriangle, TrendingUp, Fingerprint, Globe, Zap,
} from "lucide-react";

// ─── Realtime invalidation hook ───
function useRealtimeInvalidation() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cases" }, () => qc.invalidateQueries({ queryKey: ["dash"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "artifacts" }, () => qc.invalidateQueries({ queryKey: ["dash"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => qc.invalidateQueries({ queryKey: ["dash"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "tool_results" }, () => qc.invalidateQueries({ queryKey: ["dash"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}

// ─── Data hooks ───
function useDashCases() {
  return useQuery({
    queryKey: ["dash", "cases"],
    queryFn: async () => {
      const { data } = await supabase.from("cases").select("*").order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });
}

function useDashCounts() {
  return useQuery({
    queryKey: ["dash", "counts"],
    queryFn: async () => {
      const [cases, artifacts, toolResults, subjects, entities, links, breaches] = await Promise.all([
        supabase.from("cases").select("*", { count: "exact", head: true }),
        supabase.from("artifacts").select("*", { count: "exact", head: true }),
        supabase.from("tool_results").select("*", { count: "exact", head: true }),
        supabase.from("subjects").select("*", { count: "exact", head: true }),
        supabase.from("identity_entities").select("*", { count: "exact", head: true }),
        supabase.from("identity_entity_links").select("*", { count: "exact", head: true }),
        supabase.from("breach_records").select("*", { count: "exact", head: true }),
      ]);
      return {
        cases: cases.count ?? 0,
        artifacts: artifacts.count ?? 0,
        toolResults: toolResults.count ?? 0,
        subjects: subjects.count ?? 0,
        entities: entities.count ?? 0,
        links: links.count ?? 0,
        breaches: breaches.count ?? 0,
      };
    },
  });
}

function useDashEntities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dash", "entities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("identity_entities")
        .select("id, entity_type, entity_value, confidence_score, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });
}

function useDashScores() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dash", "scores", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("entity_scores")
        .select("*, entity:identity_entities!entity_scores_entity_id_fkey(entity_type, entity_value)")
        .eq("user_id", user!.id)
        .order("score", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });
}

function useDashLinks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dash", "links", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("identity_entity_links")
        .select("id, relationship_type, confidence_score, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });
}

function useDashToolResults() {
  return useQuery({
    queryKey: ["dash", "tool_results"],
    queryFn: async () => {
      const { data } = await supabase.from("tool_results").select("*").order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });
}

function useDashBreachStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dash", "breach-stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("breach_records")
        .select("severity, credential_leaked")
        .eq("user_id", user!.id);
      const records = data ?? [];
      return {
        total: records.length,
        critical: records.filter((r) => r.severity === "critical").length,
        high: records.filter((r) => r.severity === "high").length,
        medium: records.filter((r) => r.severity === "medium").length,
        credentials: records.filter((r) => r.credential_leaked).length,
      };
    },
  });
}

function useDashActivity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dash", "activity", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("action, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });
}

// ─── Helpers ───
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(210, 70%, 55%)",
  "hsl(35, 85%, 55%)",
  "hsl(280, 60%, 55%)",
  "hsl(150, 60%, 45%)",
  "hsl(0, 72%, 51%)",
];

export default function DashboardPage() {
  const navigate = useNavigate();
  useRealtimeInvalidation();

  const { data: cases = [] } = useDashCases();
  const { data: counts } = useDashCounts();
  const { data: entities = [] } = useDashEntities();
  const { data: scores = [] } = useDashScores();
  const { data: linkRecords = [] } = useDashLinks();
  const { data: toolResults = [] } = useDashToolResults();
  const { data: breachStats } = useDashBreachStats();
  const { data: activityLogs = [] } = useDashActivity();

  // Entity type distribution for pie chart
  const entityTypeData = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entities) m.set(e.entity_type, (m.get(e.entity_type) ?? 0) + 1);
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [entities]);

  // Investigation activity over last 14 days
  const activityData = useMemo(() => {
    const days: { date: string; actions: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = activityLogs.filter((l) => l.created_at.startsWith(key)).length;
      days.push({ date: d.toLocaleDateString("en", { month: "short", day: "numeric" }), actions: count });
    }
    return days;
  }, [activityLogs]);

  // Entity discovery over last 14 days
  const discoveryData = useMemo(() => {
    const days: { date: string; entities: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = entities.filter((e) => e.created_at.startsWith(key)).length;
      days.push({ date: d.toLocaleDateString("en", { month: "short", day: "numeric" }), entities: count });
    }
    return days;
  }, [entities]);

  // Relationship type distribution
  const relTypeData = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linkRecords) m.set(l.relationship_type, (m.get(l.relationship_type) ?? 0) + 1);
    return Array.from(m.entries()).map(([type, count]) => ({ type: type.replace(/_/g, " "), count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [linkRecords]);

  // Risk score distribution
  const riskDistribution = useMemo(() => {
    const buckets = [
      { range: "0-20", count: 0 },
      { range: "21-40", count: 0 },
      { range: "41-60", count: 0 },
      { range: "61-80", count: 0 },
      { range: "81-100", count: 0 },
    ];
    for (const s of scores) {
      const score = Number(s.score);
      if (score <= 20) buckets[0].count++;
      else if (score <= 40) buckets[1].count++;
      else if (score <= 60) buckets[2].count++;
      else if (score <= 80) buckets[3].count++;
      else buckets[4].count++;
    }
    return buckets;
  }, [scores]);

  // Radar data for intelligence overview
  const radarData = useMemo(() => [
    { metric: "Entities", value: Math.min(entities.length * 5, 100) },
    { metric: "Links", value: Math.min(linkRecords.length * 8, 100) },
    { metric: "Cases", value: Math.min((counts?.cases ?? 0) * 15, 100) },
    { metric: "Breaches", value: Math.min((breachStats?.total ?? 0) * 10, 100) },
    { metric: "Tools", value: Math.min((counts?.toolResults ?? 0) * 5, 100) },
    { metric: "Artifacts", value: Math.min((counts?.artifacts ?? 0) * 8, 100) },
  ], [entities, linkRecords, counts, breachStats]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <span className="intel-tag intel-tag-purple mb-3 inline-block">CLASSIFIED</span>
        <h1 className="text-2xl font-display font-bold tracking-tight">Intelligence Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time intelligence metrics and pattern analysis</p>
      </div>

      {/* Primary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatDisplay label="Investigations" value={counts?.cases ?? 0} icon={FolderOpen} status="active" />
        <StatDisplay label="Entities" value={counts?.entities ?? 0} icon={Fingerprint} status="active" />
        <StatDisplay label="Links" value={counts?.links ?? 0} icon={Network} status="active" />
        <StatDisplay label="Artifacts" value={counts?.artifacts ?? 0} icon={FileText} status="active" />
        <StatDisplay label="Tool Runs" value={counts?.toolResults ?? 0} icon={Wrench} status="active" />
        <StatDisplay label="Subjects" value={counts?.subjects ?? 0} icon={Search} status="active" />
        <StatDisplay label="Breaches" value={counts?.breaches ?? 0} icon={AlertTriangle} status={counts?.breaches ? "warning" : "active"} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Investigation Activity */}
        <IntelCard icon={Activity} title="Investigation Activity" badge="14D" className="lg:col-span-2">
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Area type="monotone" dataKey="actions" stroke="hsl(var(--primary))" fill="url(#actGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </IntelCard>

        {/* Intelligence Radar */}
        <IntelCard icon={Shield} title="Intelligence Overview">
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <PolarRadiusAxis tick={false} axisLine={false} />
                <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </IntelCard>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Entity Clustering */}
        <IntelCard icon={Globe} title="Entity Clustering">
          <div className="h-[220px] mt-2">
            {entityTypeData.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono text-center py-8">No entity data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={entityTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {entityTypeData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </IntelCard>

        {/* Relationship Density */}
        <IntelCard icon={Network} title="Relationship Density">
          <div className="h-[220px] mt-2">
            {relTypeData.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono text-center py-8">No relationship data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={relTypeData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="type" type="category" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </IntelCard>

        {/* Risk Score Distribution */}
        <IntelCard icon={TrendingUp} title="Risk Distribution">
          <div className="h-[220px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskDistribution}>
                <XAxis dataKey="range" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {riskDistribution.map((_, i) => (
                    <Cell key={i} fill={["hsl(150,60%,45%)", "hsl(150,50%,50%)", "hsl(45,80%,55%)", "hsl(25,80%,50%)", "hsl(0,72%,51%)"][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </IntelCard>
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Entity Discovery Trend */}
        <IntelCard icon={Zap} title="Entity Discovery Trend" badge="14D">
          <div className="h-[180px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={discoveryData}>
                <defs>
                  <linearGradient id="discGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                />
                <Area type="monotone" dataKey="entities" stroke="hsl(var(--accent))" fill="url(#discGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </IntelCard>

        {/* Breach Exposure */}
        <IntelCard icon={AlertTriangle} title="Breach Exposure">
          {breachStats && breachStats.total > 0 ? (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <GlassPanel className="p-3 text-center">
                <span className="font-mono text-2xl font-bold text-destructive block">{breachStats.total}</span>
                <span className="font-mono text-[9px] text-muted-foreground tracking-widest">TOTAL</span>
              </GlassPanel>
              <GlassPanel className="p-3 text-center">
                <span className="font-mono text-2xl font-bold text-destructive block">{breachStats.critical}</span>
                <span className="font-mono text-[9px] text-muted-foreground tracking-widest">CRITICAL</span>
              </GlassPanel>
              <GlassPanel className="p-3 text-center">
                <span className="font-mono text-2xl font-bold text-yellow-400 block">{breachStats.high}</span>
                <span className="font-mono text-[9px] text-muted-foreground tracking-widest">HIGH</span>
              </GlassPanel>
              <GlassPanel className="p-3 text-center">
                <span className="font-mono text-2xl font-bold text-destructive block">{breachStats.credentials}</span>
                <span className="font-mono text-[9px] text-muted-foreground tracking-widest">CREDENTIALS</span>
              </GlassPanel>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground font-mono text-center py-8">No breach data — run a breach scan</p>
          )}
        </IntelCard>
      </div>

      {/* Bottom Row: Top Entities & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Highest Risk Entities */}
        <IntelCard icon={TrendingUp} title="Highest Risk Entities" badge="TOP 10" className="lg:col-span-2">
          {scores.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono py-4 text-center">No scored entities — run scoring engine</p>
          ) : (
            <div className="space-y-1 mt-1">
              {(scores as any[]).slice(0, 10).map((s, i) => {
                const score = Number(s.score);
                const color = score > 60 ? "text-destructive" : score > 30 ? "text-yellow-400" : "text-green-400";
                const barColor = score > 60 ? "bg-destructive" : score > 30 ? "bg-yellow-400" : "bg-green-400";
                return (
                  <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-secondary/40 transition-colors">
                    <span className="font-mono text-[10px] text-muted-foreground w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{s.entity?.entity_value ?? "Unknown"}</span>
                        <span className="intel-tag text-[8px]">{s.entity?.entity_type ?? ""}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${score}%` }} />
                      </div>
                    </div>
                    <span className={`font-mono text-sm font-bold ${color}`}>{score}</span>
                  </div>
                );
              })}
            </div>
          )}
        </IntelCard>

        {/* Recent Activity & Quick Actions */}
        <div className="space-y-4">
          <IntelCard icon={Wrench} title="Recent Tool Runs" badge="LIVE">
            {toolResults.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono py-4 text-center">No tool runs yet</p>
            ) : (
              <div className="space-y-1">
                {toolResults.map((tr) => {
                  const resultData = tr.result_data as Record<string, unknown> | null;
                  const summary = resultData?.summary as string | undefined;
                  return (
                    <div key={tr.id} className="px-3 py-2.5 rounded-md hover:bg-secondary/40 transition-colors">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Activity className="h-3 w-3 text-primary/60" />
                        <span className="text-xs font-medium font-mono">{tr.tool_name}</span>
                        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{timeAgo(tr.created_at)}</span>
                      </div>
                      {summary && <p className="text-[10px] text-muted-foreground truncate pl-5">{summary}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </IntelCard>

          <GlassPanel className="p-4">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground mb-3">QUICK ACTIONS</p>
            <div className="space-y-2">
              {[
                { label: "New Investigation", path: "/investigations" },
                { label: "Identity Resolution", path: "/identity" },
                { label: "Social Graph", path: "/social-graph" },
                { label: "Run Tool", path: "/tools" },
              ].map((action) => (
                <button
                  key={action.label}
                  onClick={() => navigate(action.path)}
                  className="w-full text-left px-3 py-2 rounded-md text-xs hover:bg-secondary/60 transition-colors border border-transparent hover:border-border flex items-center justify-between"
                >
                  {action.label}
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* Recent Cases */}
      <IntelCard icon={FolderOpen} title="Recent Investigations" badge="LIVE">
        {cases.length === 0 ? (
          <p className="text-xs text-muted-foreground font-mono py-4 text-center">No cases yet</p>
        ) : (
          <div className="space-y-1">
            {cases.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate("/investigations")}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left hover:bg-secondary/40 transition-colors group"
              >
                <div className="status-indicator status-active" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{c.title}</p>
                  {c.description && (
                    <p className="text-[10px] text-muted-foreground truncate">{c.description}</p>
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{timeAgo(c.created_at)}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </IntelCard>
    </div>
  );
}
