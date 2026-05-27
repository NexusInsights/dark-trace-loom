import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { GlassPanel, StatDisplay } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Fingerprint, Network, AlertTriangle, TrendingUp, Users, Clock,
  ChevronRight, Shield, Radar, Activity, Link2, Eye,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

// ─── Data hooks ───
function usePersonaDashData() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["persona-dash", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const uid = user!.id;
      const [
        { data: personas },
        { data: identifiers },
        { data: clusters },
        { data: clusterMembers },
        { data: entities },
        { data: scores },
        { data: crossLinks },
        { data: platformAccounts },
        { data: personaEvents },
      ] = await Promise.all([
        supabase.from("personas").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("persona_identifiers").select("*").eq("user_id", uid),
        supabase.from("identity_clusters").select("*").eq("user_id", uid),
        supabase.from("cluster_members").select("*, entity:identity_entities(id, entity_type, entity_value)").eq("user_id", uid),
        supabase.from("identity_entities").select("id, entity_type, entity_value, created_at").eq("user_id", uid),
        supabase.from("entity_scores").select("*").eq("user_id", uid).order("score", { ascending: false }),
        supabase.from("cross_case_links").select("*, case:cases!cross_case_links_case_id_fkey(id, title), linked_case:cases!cross_case_links_linked_case_id_fkey(id, title)").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
        supabase.from("platform_accounts").select("*").eq("user_id", uid),
        supabase.from("persona_events").select("*").eq("user_id", uid).order("event_timestamp", { ascending: false }).limit(30),
      ]);
      return {
        personas: personas ?? [],
        identifiers: identifiers ?? [],
        clusters: clusters ?? [],
        clusterMembers: clusterMembers ?? [],
        entities: entities ?? [],
        scores: scores ?? [],
        crossLinks: crossLinks ?? [],
        platformAccounts: platformAccounts ?? [],
        personaEvents: personaEvents ?? [],
      };
    },
  });
}

// ─── Graph Canvas ───
interface GraphNode { id: string; label: string; type: string; x: number; y: number; vx: number; vy: number; }
interface GraphEdge { source: string; target: string; label: string; }

function PersonaGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const nodesRef = useRef(nodes);
  const animRef = useRef<number>(0);

  useEffect(() => {
    nodesRef.current = nodes.map((n, i) => ({
      ...n,
      x: n.x || 300 + Math.cos(i * 2.4) * 120 + Math.random() * 60,
      y: n.y || 200 + Math.sin(i * 2.4) * 120 + Math.random() * 60,
      vx: 0, vy: 0,
    }));
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const typeColors: Record<string, string> = {
      persona: "#7c6df0",
      cluster: "#3b82f6",
      entity: "#22c55e",
      platform: "#f59e0b",
    };

    function tick() {
      const ns = nodesRef.current;
      const W = canvas!.width, H = canvas!.height;

      // Simple force simulation
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x;
          const dy = ns[j].y - ns[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const repel = 800 / (dist * dist);
          ns[i].vx -= (dx / dist) * repel;
          ns[i].vy -= (dy / dist) * repel;
          ns[j].vx += (dx / dist) * repel;
          ns[j].vy += (dy / dist) * repel;
        }
      }

      for (const edge of edges) {
        const a = ns.find((n) => n.id === edge.source);
        const b = ns.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const pull = (dist - 100) * 0.005;
        a.vx += (dx / dist) * pull;
        a.vy += (dy / dist) * pull;
        b.vx -= (dx / dist) * pull;
        b.vy -= (dy / dist) * pull;
      }

      // Center gravity
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.001;
        n.vy += (H / 2 - n.y) * 0.001;
        n.vx *= 0.9; n.vy *= 0.9;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      }

      // Draw
      ctx!.clearRect(0, 0, W, H);

      // Edges
      ctx!.lineWidth = 1;
      for (const edge of edges) {
        const a = ns.find((n) => n.id === edge.source);
        const b = ns.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        ctx!.strokeStyle = "rgba(120, 120, 180, 0.2)";
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // Nodes
      for (const n of ns) {
        const r = n.type === "persona" ? 10 : n.type === "cluster" ? 8 : 5;
        const color = typeColors[n.type] ?? "#666";
        const isHovered = hoveredNode === n.id;

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r + (isHovered ? 3 : 0), 0, Math.PI * 2);
        ctx!.fillStyle = color;
        ctx!.globalAlpha = isHovered ? 1 : 0.8;
        ctx!.fill();
        ctx!.globalAlpha = 1;

        if (n.type === "persona" || n.type === "cluster" || isHovered) {
          ctx!.font = "9px 'JetBrains Mono', monospace";
          ctx!.fillStyle = "rgba(200, 200, 220, 0.8)";
          ctx!.textAlign = "center";
          ctx!.fillText(n.label.slice(0, 16), n.x, n.y + r + 12);
        }
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [edges, hoveredNode]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const found = nodesRef.current.find((n) => {
      const dx = n.x - mx, dy = n.y - my;
      return dx * dx + dy * dy < 200;
    });
    setHoveredNode(found?.id ?? null);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={700}
      height={400}
      className="w-full h-[400px] rounded border border-border/30 bg-background/50 cursor-crosshair"
      onMouseMove={handleMouseMove}
    />
  );
}

// ─── Colors ───
const PIE_COLORS = ["hsl(230, 80%, 62%)", "hsl(270, 60%, 58%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(0, 72%, 51%)"];

export default function PersonaIntelDashboard() {
  const { data, isLoading } = usePersonaDashData();
  const navigate = useNavigate();

  // Derived metrics
  const metrics = useMemo(() => {
    if (!data) return null;
    const { personas, identifiers, clusters, clusterMembers, scores, crossLinks, platformAccounts, entities } = data;

    // High-risk personas: personas with identifiers matching high-score entities
    const highScoreEntityValues = new Set(
      scores.filter((s: any) => Number(s.score) >= 60).map((s: any) => {
        const ent = entities.find((e: any) => e.id === s.entity_id);
        return ent?.entity_value?.toLowerCase();
      }).filter(Boolean)
    );

    const highRiskPersonas = personas.filter((p: any) => {
      const pIds = identifiers.filter((i: any) => i.persona_id === p.id);
      return pIds.some((i: any) => highScoreEntityValues.has(i.identifier_value?.toLowerCase()));
    });

    // Recent discoveries (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentPersonas = personas.filter((p: any) => p.created_at > weekAgo);

    // Type distribution
    const typeCounts: Record<string, number> = {};
    identifiers.forEach((i: any) => {
      typeCounts[i.identifier_type] = (typeCounts[i.identifier_type] || 0) + 1;
    });
    const typeDistribution = Object.entries(typeCounts).map(([name, value]) => ({ name, value }));

    // Cluster sizes
    const clusterSizes = clusters.map((c: any) => ({
      name: c.cluster_label?.slice(0, 12) || c.id.slice(0, 8),
      members: clusterMembers.filter((m: any) => m.cluster_id === c.id).length,
      score: Number(c.cluster_score),
    }));

    // Platform distribution
    const platCounts: Record<string, number> = {};
    platformAccounts.forEach((a: any) => {
      platCounts[a.platform_category] = (platCounts[a.platform_category] || 0) + 1;
    });
    const platformDistribution = Object.entries(platCounts).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));

    return {
      totalPersonas: personas.length,
      totalIdentifiers: identifiers.length,
      totalClusters: clusters.length,
      totalCrossLinks: crossLinks.length,
      highRiskPersonas,
      recentPersonas,
      typeDistribution,
      clusterSizes,
      platformDistribution,
    };
  }, [data]);

  // Build graph data
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const { personas, identifiers, clusters, clusterMembers, entities } = data;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Add persona nodes
    for (const p of personas.slice(0, 20)) {
      nodes.push({ id: `p-${p.id}`, label: p.persona_label, type: "persona", x: 0, y: 0, vx: 0, vy: 0 });
      nodeIds.add(`p-${p.id}`);
    }

    // Add cluster nodes
    for (const c of clusters.slice(0, 15)) {
      nodes.push({ id: `c-${c.id}`, label: c.cluster_label || "Cluster", type: "cluster", x: 0, y: 0, vx: 0, vy: 0 });
      nodeIds.add(`c-${c.id}`);
    }

    // Connect personas to entities & clusters
    const personaEntityMap = new Map<string, string[]>();
    for (const id of identifiers) {
      const ent = entities.find((e: any) => e.entity_value?.toLowerCase() === id.identifier_value?.toLowerCase());
      if (ent) {
        const eNodeId = `e-${ent.id}`;
        if (!nodeIds.has(eNodeId) && nodes.length < 80) {
          nodes.push({ id: eNodeId, label: ent.entity_value.slice(0, 20), type: "entity", x: 0, y: 0, vx: 0, vy: 0 });
          nodeIds.add(eNodeId);
        }
        if (nodeIds.has(eNodeId)) {
          edges.push({ source: `p-${id.persona_id}`, target: eNodeId, label: "identifier" });
        }

        // Check if entity is in a cluster
        const membership = clusterMembers.find((m: any) => m.entity_id === ent.id);
        if (membership && nodeIds.has(`c-${membership.cluster_id}`)) {
          edges.push({ source: eNodeId, target: `c-${membership.cluster_id}`, label: "member" });
        }
      }
    }

    return { nodes, edges };
  }, [data]);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Radar className="h-10 w-10 text-primary animate-spin mx-auto mb-3" />
          <p className="font-mono text-xs text-muted-foreground">Loading persona intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-display font-bold flex items-center gap-2.5">
            <Radar className="h-6 w-6 text-primary" />
            Persona Intelligence
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            Cross-persona analysis • Cluster intelligence • Risk assessment
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="font-mono text-[10px] gap-1.5" onClick={() => navigate("/personas")}>
            <Fingerprint className="h-3 w-3" /> Discovery
          </Button>
          <Button variant="outline" size="sm" className="font-mono text-[10px] gap-1.5" onClick={() => navigate("/persona-profile")}>
            <Eye className="h-3 w-3" /> Profiles
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassPanel className="p-4" neonLine="top">
          <StatDisplay label="PERSONAS" value={metrics?.totalPersonas ?? 0} icon={Users} />
        </GlassPanel>
        <GlassPanel className="p-4" neonLine="top">
          <StatDisplay label="IDENTIFIERS" value={metrics?.totalIdentifiers ?? 0} icon={Fingerprint} />
        </GlassPanel>
        <GlassPanel className="p-4" neonLine="top">
          <StatDisplay label="CLUSTERS" value={metrics?.totalClusters ?? 0} icon={Network} />
        </GlassPanel>
        <GlassPanel className="p-4" neonLine="top">
          <StatDisplay label="CROSS-LINKS" value={metrics?.totalCrossLinks ?? 0} icon={Link2} />
        </GlassPanel>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Relationship Graph */}
        <div className="lg:col-span-3">
          <GlassPanel className="p-4" neonLine="left">
            <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
              <Network className="h-3.5 w-3.5" /> PERSONA RELATIONSHIP GRAPH
            </h3>
            {graphData.nodes.length > 0 ? (
              <>
                <PersonaGraph nodes={graphData.nodes} edges={graphData.edges} />
                <div className="flex gap-4 mt-2 justify-center">
                  {[
                    { color: "bg-[hsl(270,60%,58%)]", label: "Persona" },
                    { color: "bg-[hsl(217,91%,60%)]", label: "Cluster" },
                    { color: "bg-[hsl(142,71%,45%)]", label: "Entity" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                      <span className="font-mono text-[9px] text-muted-foreground">{l.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[400px]">
                <div className="text-center">
                  <Network className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-30" />
                  <p className="text-xs text-muted-foreground font-mono">No relationship data yet</p>
                </div>
              </div>
            )}
          </GlassPanel>
        </div>

        {/* Side panels */}
        <div className="lg:col-span-2 space-y-4">
          {/* High-Risk Personas */}
          <GlassPanel className="p-4" neonLine="left">
            <h3 className="font-mono text-xs tracking-widest text-destructive mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5" /> HIGH-RISK PERSONAS ({metrics?.highRiskPersonas.length ?? 0})
            </h3>
            <ScrollArea className="h-[160px]">
              {metrics?.highRiskPersonas.length ? (
                <div className="space-y-2">
                  {metrics.highRiskPersonas.map((p: any) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-2.5 rounded bg-destructive/5 border border-destructive/20 cursor-pointer hover:bg-destructive/10 transition-colors"
                      onClick={() => navigate(`/persona-profile?id=${p.id}`)}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs truncate">{p.persona_label}</div>
                        <div className="font-mono text-[9px] text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground font-mono text-center py-6">No high-risk personas detected</p>
              )}
            </ScrollArea>
          </GlassPanel>

          {/* Recent Discoveries */}
          <GlassPanel className="p-4" neonLine="left">
            <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> RECENT DISCOVERIES ({metrics?.recentPersonas.length ?? 0})
            </h3>
            <ScrollArea className="h-[160px]">
              {metrics?.recentPersonas.length ? (
                <div className="space-y-2">
                  {metrics.recentPersonas.map((p: any) => {
                    const idCount = data?.identifiers.filter((i: any) => i.persona_id === p.id).length ?? 0;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 p-2.5 rounded bg-muted/30 border border-border/30 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => navigate(`/persona-profile?id=${p.id}`)}
                      >
                        <Fingerprint className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs truncate">{p.persona_label}</div>
                          <div className="font-mono text-[9px] text-muted-foreground">
                            {idCount} identifiers • {new Date(p.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground font-mono text-center py-6">No recent discoveries</p>
              )}
            </ScrollArea>
          </GlassPanel>
        </div>
      </div>

      {/* Bottom section: Charts & Cross-links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Identifier Type Distribution */}
        <GlassPanel className="p-4">
          <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
            <Fingerprint className="h-3.5 w-3.5" /> IDENTIFIER TYPES
          </h3>
          {metrics?.typeDistribution.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={metrics.typeDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  innerRadius={35}
                  strokeWidth={0}
                >
                  {metrics.typeDistribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(222,22%,9%)", border: "1px solid hsl(222,16%,16%)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground font-mono text-center py-12">No data</p>
          )}
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            {metrics?.typeDistribution.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="font-mono text-[8px] text-muted-foreground">{d.name} ({d.value})</span>
              </div>
            ))}
          </div>
        </GlassPanel>

        {/* Cluster Sizes */}
        <GlassPanel className="p-4">
          <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
            <Network className="h-3.5 w-3.5" /> CLUSTER SIZES
          </h3>
          {metrics?.clusterSizes.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.clusterSizes} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 8, fontFamily: "JetBrains Mono", fill: "hsl(215,12%,48%)" }} />
                <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono", fill: "hsl(215,12%,48%)" }} />
                <Tooltip contentStyle={{ background: "hsl(222,22%,9%)", border: "1px solid hsl(222,16%,16%)", borderRadius: 6, fontSize: 11, fontFamily: "JetBrains Mono" }} />
                <Bar dataKey="members" fill="hsl(230, 80%, 62%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground font-mono text-center py-12">No clusters yet</p>
          )}
        </GlassPanel>

        {/* Cross-Investigation Links */}
        <GlassPanel className="p-4">
          <h3 className="font-mono text-xs tracking-widest text-destructive mb-3 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5" /> CROSS-CASE LINKS
          </h3>
          <ScrollArea className="h-[240px]">
            {data?.crossLinks.length ? (
              <div className="space-y-2">
                {data.crossLinks.map((link: any) => {
                  const sevColor = link.severity === "critical" ? "text-destructive" : link.severity === "high" ? "text-yellow-500" : "text-muted-foreground";
                  return (
                    <div key={link.id} className="p-2.5 rounded bg-muted/30 border border-border/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[10px] truncate max-w-[120px]">{link.case?.title ?? "Case"}</span>
                        <Badge variant="outline" className={`text-[7px] font-mono ${sevColor}`}>{link.severity}</Badge>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
                        <span>↔</span>
                        <span className="truncate max-w-[120px]">{link.linked_case?.title ?? "Linked case"}</span>
                      </div>
                      <div className="font-mono text-[8px] text-muted-foreground mt-1">{link.link_reason}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground font-mono text-center py-12">No cross-case links</p>
            )}
          </ScrollArea>
        </GlassPanel>
      </div>

      {/* Activity Feed */}
      <GlassPanel className="p-4">
        <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" /> RECENT PERSONA ACTIVITY
        </h3>
        {data?.personaEvents.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.personaEvents.slice(0, 12).map((ev: any) => {
              const persona = data.personas.find((p: any) => p.id === ev.persona_id);
              return (
                <div key={ev.id} className="flex items-start gap-2.5 p-2.5 rounded bg-muted/20 border border-border/20">
                  <Activity className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] truncate">{ev.event_label}</div>
                    <div className="font-mono text-[8px] text-muted-foreground">
                      {persona?.persona_label ?? "Unknown"} • {new Date(ev.event_timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground font-mono text-center py-6">No recent activity. Build persona timelines to populate this feed.</p>
        )}
      </GlassPanel>
    </div>
  );
}
