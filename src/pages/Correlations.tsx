import { useState, useRef, useEffect, useMemo } from "react";
import { GlassPanel, IntelCard } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useCases } from "@/hooks/useInvestigationData";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkFeatureGate } from "@/lib/planGating";
import { UpgradePrompt } from "@/components/tools/UpgradePrompt";
import { runCorrelationEngine } from "@/lib/correlationEngine";
import { toast } from "sonner";
import {
  Network, Loader2, Radar, Mail, Globe, AtSign, Server, Phone,
  Zap, ArrowRight, RefreshCw,
} from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  username: "hsl(35, 85%, 55%)",
  email: "hsl(270, 60%, 58%)",
  domain: "hsl(160, 60%, 45%)",
  ip: "hsl(0, 72%, 51%)",
  phone: "hsl(200, 70%, 50%)",
};

const TYPE_ICONS: Record<string, typeof Mail> = {
  username: AtSign,
  email: Mail,
  domain: Globe,
  ip: Server,
  phone: Phone,
};

// ─── Force simulation for correlation graph ───
interface GraphNode {
  id: string;
  label: string;
  type: "case" | "identifier";
  subType?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
  confidence: number;
}

function useForceLayout(nodes: GraphNode[], edges: GraphEdge[], w: number, h: number) {
  const nodesRef = useRef<GraphNode[]>([]);
  const frameRef = useRef(0);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = nodes.map((n) => {
      const ex = existing.get(n.id);
      return ex
        ? { ...n, x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy }
        : { ...n, x: w / 2 + (Math.random() - 0.5) * 300, y: h / 2 + (Math.random() - 0.5) * 300, vx: 0, vy: 0 };
    });

    let running = true;
    const tick = () => {
      if (!running) return;
      const ns = nodesRef.current;
      const damping = 0.9;
      const repulsion = 4000;
      const springLen = 140;
      const springK = 0.015;
      const centerK = 0.004;

      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[i].x - ns[j].x;
          const dy = ns[i].y - ns[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          ns[i].vx += fx; ns[i].vy += fy;
          ns[j].vx -= fx; ns[j].vy -= fy;
        }
      }

      for (const e of edges) {
        const s = ns.find((n) => n.id === e.source);
        const t = ns.find((n) => n.id === e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - springLen) * springK;
        s.vx += (dx / dist) * force;
        s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force;
        t.vy -= (dy / dist) * force;
      }

      for (const n of ns) {
        n.vx += (w / 2 - n.x) * centerK;
        n.vy += (h / 2 - n.y) * centerK;
        n.vx *= damping;
        n.vy *= damping;
        n.x = Math.max(40, Math.min(w - 40, n.x + n.vx));
        n.y = Math.max(40, Math.min(h - 40, n.y + n.vy));
      }

      setPositions(new Map(ns.map((n) => [n.id, { x: n.x, y: n.y }])));
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [nodes.length, edges.length, w, h]);

  return positions;
}

export default function CorrelationsPage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { data: cases = [] } = useCases();
  const qc = useQueryClient();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  const gate = checkFeatureGate(plan, "hasAdvancedCorrelation");

  const { data: correlations = [], isLoading } = useQuery({
    queryKey: ["correlations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cross_case_correlations")
        .select("*")
        .eq("user_id", user!.id)
        .order("confidence", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const caseMap = useMemo(() => new Map(cases.map((c) => [c.id, c.title])), [cases]);

  // Build graph from correlations
  const { graphNodes, graphEdges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    for (const c of correlations) {
      // Case nodes
      if (!nodeMap.has(c.source_case_id)) {
        nodeMap.set(c.source_case_id, {
          id: c.source_case_id,
          label: caseMap.get(c.source_case_id) ?? c.source_case_id.slice(0, 8),
          type: "case",
          x: 0, y: 0, vx: 0, vy: 0,
        });
      }
      if (!nodeMap.has(c.target_case_id)) {
        nodeMap.set(c.target_case_id, {
          id: c.target_case_id,
          label: caseMap.get(c.target_case_id) ?? c.target_case_id.slice(0, 8),
          type: "case",
          x: 0, y: 0, vx: 0, vy: 0,
        });
      }

      // Identifier node (shared value)
      const idNodeKey = `${c.source_type}:${c.source_value}`;
      if (!nodeMap.has(idNodeKey)) {
        nodeMap.set(idNodeKey, {
          id: idNodeKey,
          label: c.source_value,
          type: "identifier",
          subType: c.source_type,
          x: 0, y: 0, vx: 0, vy: 0,
        });
      }

      // Edges: case → identifier → case
      const srcEdgeKey = `${c.source_case_id}-${idNodeKey}`;
      if (!edgeList.some((e) => `${e.source}-${e.target}` === srcEdgeKey)) {
        edgeList.push({
          source: c.source_case_id,
          target: idNodeKey,
          label: c.relationship_type,
          confidence: c.confidence,
        });
      }
      const tgtEdgeKey = `${idNodeKey}-${c.target_case_id}`;
      if (!edgeList.some((e) => `${e.source}-${e.target}` === tgtEdgeKey)) {
        edgeList.push({
          source: idNodeKey,
          target: c.target_case_id,
          label: c.relationship_type,
          confidence: c.confidence,
        });
      }
    }

    return { graphNodes: Array.from(nodeMap.values()), graphEdges: edgeList };
  }, [correlations, caseMap]);

  const positions = useForceLayout(graphNodes, graphEdges, dims.w, dims.h);

  const handleRun = async () => {
    if (!user) return;
    setRunning(true);
    try {
      const result = await runCorrelationEngine(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["correlations", user.id] });
      toast.success(`Found ${result.correlationsFound} correlations across ${result.identifiersScanned} identifiers`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Correlation failed");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  // Group correlations by type for stats
  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const c of correlations) {
      stats.set(c.source_type, (stats.get(c.source_type) ?? 0) + 1);
    }
    return stats;
  }, [correlations]);

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Intelligence</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Correlation Engine</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Detect relationships across investigations by correlating usernames, emails, domains, IPs, and phone numbers.
        </p>
      </div>

      {!gate.allowed && (
        <UpgradePrompt reason={gate.reason!} requiredPlan={gate.requiredPlan!} />
      )}

      <div className={!gate.allowed ? "opacity-50 pointer-events-none" : ""}>
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="neon"
            size="sm"
            className="gap-2"
            disabled={running || cases.length < 2}
            onClick={handleRun}
          >
            {running ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />SCANNING...</>
            ) : (
              <><Radar className="h-3.5 w-3.5" />RUN CORRELATION ENGINE</>
            )}
          </Button>

          {running && progress && (
            <span className="font-mono text-[10px] text-primary">{progress}</span>
          )}

          {correlations.length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground ml-auto">
              {correlations.length} CORRELATIONS FOUND
            </span>
          )}
        </div>

        {cases.length < 2 && (
          <GlassPanel className="p-4 mt-4">
            <p className="text-xs text-muted-foreground font-mono text-center">
              You need at least 2 cases to run cross-case correlation analysis.
            </p>
          </GlassPanel>
        )}

        {/* Stats */}
        {correlations.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            {["username", "email", "domain", "ip", "phone"].map((type) => {
              const Icon = TYPE_ICONS[type] ?? Globe;
              const count = typeStats.get(type) ?? 0;
              return (
                <GlassPanel key={type} className="p-3 text-center">
                  <Icon className="h-4 w-4 mx-auto mb-1" style={{ color: TYPE_COLORS[type] }} />
                  <span className="font-mono text-lg font-bold text-foreground">{count}</span>
                  <span className="font-mono text-[9px] text-muted-foreground block tracking-widest">
                    {type.toUpperCase()}
                  </span>
                </GlassPanel>
              );
            })}
          </div>
        )}

        {/* Graph visualization */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <Network className="h-4 w-4 text-primary" />
            <span className="font-display text-sm font-semibold">Correlation Graph</span>
          </div>

          {/* Legend */}
          <div className="flex gap-4 flex-wrap mb-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-3 h-3 rounded bg-primary" />
              CASE
            </div>
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                {type.toUpperCase()}
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            className="glass-panel rounded-lg overflow-hidden relative"
            style={{ height: 500 }}
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : graphNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Radar className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-xs font-mono text-muted-foreground">
                  RUN THE ENGINE TO DISCOVER CORRELATIONS
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  The engine scans all your cases for shared identifiers
                </p>
              </div>
            ) : (
              <svg width={dims.w} height={dims.h} className="w-full h-full">
                <defs>
                  <pattern id="corr-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="hsl(222, 16%, 12%)" strokeWidth="0.5" />
                  </pattern>
                  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="hsl(222, 16%, 28%)" />
                  </marker>
                </defs>
                <rect width="100%" height="100%" fill="url(#corr-grid)" />

                {/* Edges */}
                {graphEdges.map((edge, i) => {
                  const s = positions.get(edge.source);
                  const t = positions.get(edge.target);
                  if (!s || !t) return null;
                  const isHighlight = hoveredNode === edge.source || hoveredNode === edge.target;
                  return (
                    <line
                      key={i}
                      x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                      stroke={isHighlight ? "hsl(230, 80%, 62%)" : "hsl(222, 16%, 22%)"}
                      strokeWidth={isHighlight ? 2 : 1}
                      opacity={hoveredNode && !isHighlight ? 0.1 : 0.6}
                      markerEnd="url(#arrowhead)"
                    />
                  );
                })}

                {/* Nodes */}
                {graphNodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  const isCase = node.type === "case";
                  const color = isCase ? "hsl(230, 80%, 62%)" : (TYPE_COLORS[node.subType ?? ""] ?? "hsl(215, 12%, 48%)");
                  const isHovered = hoveredNode === node.id;
                  const dimmed = hoveredNode && !isHovered &&
                    !graphEdges.some((e) =>
                      (e.source === hoveredNode && e.target === node.id) ||
                      (e.target === hoveredNode && e.source === node.id)
                    );

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      className="cursor-pointer"
                      opacity={dimmed ? 0.15 : 1}
                    >
                      {isHovered && <circle r={isCase ? 26 : 20} fill={color} opacity={0.15} />}
                      {isCase ? (
                        <rect
                          x={-18} y={-12} width={36} height={24} rx={4}
                          fill={color}
                          stroke={isHovered ? "hsl(0, 0%, 100%)" : "none"}
                          strokeWidth={1.5}
                          style={{ filter: isHovered ? `drop-shadow(0 0 8px ${color})` : undefined }}
                        />
                      ) : (
                        <circle
                          r={isHovered ? 14 : 12}
                          fill={color}
                          stroke={isHovered ? "hsl(0, 0%, 100%)" : "none"}
                          strokeWidth={1.5}
                          style={{ filter: isHovered ? `drop-shadow(0 0 8px ${color})` : undefined }}
                        />
                      )}
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="white"
                        fontSize={isCase ? 9 : 10}
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {isCase ? "C" : (node.subType?.[0] ?? "?").toUpperCase()}
                      </text>
                      <text
                        y={isCase ? 22 : 22}
                        textAnchor="middle"
                        className="fill-foreground"
                        fontSize={9}
                        fontFamily="monospace"
                      >
                        {node.label.length > 20 ? node.label.substring(0, 18) + "…" : node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* Correlation list */}
        {correlations.length > 0 && (
          <div className="mt-6 space-y-3">
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
              Correlation Details ({correlations.length})
            </span>
            <div className="space-y-2 max-h-[400px] overflow-auto">
              {correlations.map((c) => {
                const Icon = TYPE_ICONS[c.source_type] ?? Globe;
                return (
                  <GlassPanel key={c.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" style={{ color: TYPE_COLORS[c.source_type] }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold truncate">{c.source_value}</span>
                          <span className="intel-tag intel-tag-blue text-[8px]">{c.source_type.toUpperCase()}</span>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {c.relationship_type.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <span>{caseMap.get(c.source_case_id) ?? c.source_case_id.slice(0, 8)}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span>{caseMap.get(c.target_case_id) ?? c.target_case_id.slice(0, 8)}</span>
                          <span className="ml-auto font-mono">
                            {Math.round(c.confidence * 100)}% confidence
                          </span>
                        </div>
                      </div>
                    </div>
                  </GlassPanel>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
