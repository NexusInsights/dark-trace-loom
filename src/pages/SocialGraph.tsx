import { useState, useRef, useEffect, useMemo } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useIdentityEntities } from "@/hooks/useIdentityResolution";
import { useSocialGraphEdges } from "@/hooks/useSocialGraph";
import { useInfrastructureLinks } from "@/hooks/useInfrastructure";
import { useQueryClient } from "@tanstack/react-query";
import { runSocialGraphMining } from "@/lib/socialGraphEngine";
import { runInfrastructureMining } from "@/lib/infrastructureEngine";
import { toast } from "sonner";
import {
  Loader2, Network, Mail, Globe, AtSign, Server, Phone, Share2,
  Zap, ArrowRight, Users, X, HardDrive, Wifi,
} from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  username: "hsl(35, 85%, 55%)",
  email: "hsl(270, 60%, 58%)",
  domain: "hsl(160, 60%, 45%)",
  ip: "hsl(0, 72%, 51%)",
  phone: "hsl(200, 70%, 50%)",
  social_profile: "hsl(320, 60%, 55%)",
  // Infrastructure node types
  infra_email_server: "hsl(280, 50%, 55%)",
  infra_hosting: "hsl(140, 55%, 40%)",
  infra_ip_range: "hsl(10, 65%, 50%)",
  infra_dns_record: "hsl(180, 50%, 45%)",
  infra_shared_subnet: "hsl(20, 70%, 50%)",
};

const EDGE_COLORS: Record<string, string> = {
  co_appearance: "hsl(270, 60%, 58%)",
  shared_infrastructure: "hsl(160, 60%, 45%)",
  shared_identifier: "hsl(35, 85%, 55%)",
  communication: "hsl(200, 70%, 50%)",
  infrastructure: "hsl(45, 80%, 50%)",
};

const TYPE_ICONS: Record<string, typeof Mail> = {
  username: AtSign,
  email: Mail,
  domain: Globe,
  ip: Server,
  phone: Phone,
  social_profile: Share2,
};

interface GNode {
  id: string; label: string; type: string;
  x: number; y: number; vx: number; vy: number;
  connections: number;
}

interface GEdge {
  source: string; target: string; type: string; confidence: number;
}

function useForceLayout(nodes: GNode[], edges: GEdge[], w: number, h: number) {
  const nodesRef = useRef<GNode[]>([]);
  const frameRef = useRef(0);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = nodes.map((n) => {
      const ex = existing.get(n.id);
      return ex
        ? { ...n, x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy }
        : { ...n, x: w / 2 + (Math.random() - 0.5) * 350, y: h / 2 + (Math.random() - 0.5) * 350, vx: 0, vy: 0 };
    });

    let running = true;
    const tick = () => {
      if (!running) return;
      const ns = nodesRef.current;
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[i].x - ns[j].x;
          const dy = ns[i].y - ns[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 5000 / (dist * dist);
          ns[i].vx += (dx / dist) * force;
          ns[i].vy += (dy / dist) * force;
          ns[j].vx -= (dx / dist) * force;
          ns[j].vy -= (dy / dist) * force;
        }
      }
      for (const e of edges) {
        const s = ns.find((n) => n.id === e.source);
        const t = ns.find((n) => n.id === e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 150) * 0.012;
        s.vx += (dx / dist) * force; s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force; t.vy -= (dy / dist) * force;
      }
      for (const n of ns) {
        n.vx += (w / 2 - n.x) * 0.003;
        n.vy += (h / 2 - n.y) * 0.003;
        n.vx *= 0.88; n.vy *= 0.88;
        n.x = Math.max(50, Math.min(w - 50, n.x + n.vx));
        n.y = Math.max(50, Math.min(h - 50, n.y + n.vy));
      }
      setPositions(new Map(ns.map((n) => [n.id, { x: n.x, y: n.y }])));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [nodes.length, edges.length, w, h]);

  return positions;
}

export default function SocialGraphPage() {
  const { user } = useAuth();
  const { data: entities = [], isLoading: loadingEntities } = useIdentityEntities();
  const { data: rawEdges = [], isLoading: loadingEdges } = useSocialGraphEdges();
  const { data: infraLinks = [] } = useInfrastructureLinks();
  const qc = useQueryClient();

  const [running, setRunning] = useState(false);
  const [miningInfra, setMiningInfra] = useState(false);
  const [progress, setProgress] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [filterEdgeType, setFilterEdgeType] = useState<string>("all");

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 550 });

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

  const { graphNodes, graphEdges } = useMemo(() => {
    const filteredEdges = filterEdgeType === "all"
      ? rawEdges
      : filterEdgeType === "infrastructure"
        ? [] // infra edges are synthetic
        : rawEdges.filter((e: any) => e.relationship_type === filterEdgeType);

    const nodeIds = new Set<string>();
    const edgeList: GEdge[] = [];

    for (const e of filteredEdges as any[]) {
      nodeIds.add(e.source_entity_id);
      nodeIds.add(e.target_entity_id);
      edgeList.push({
        source: e.source_entity_id,
        target: e.target_entity_id,
        type: e.relationship_type,
        confidence: e.confidence_score,
      });
    }

    // Build infrastructure nodes and edges
    // Group infra links by type+value to create shared infra nodes
    const infraGroups = new Map<string, { type: string; value: string; entityIds: string[] }>();
    const activeInfra = (filterEdgeType === "all" || filterEdgeType === "infrastructure") ? infraLinks : [];
    for (const link of activeInfra as any[]) {
      const key = `${link.infrastructure_type}:${link.value}`;
      if (!infraGroups.has(key)) {
        infraGroups.set(key, { type: link.infrastructure_type, value: link.value, entityIds: [] });
      }
      infraGroups.get(key)!.entityIds.push(link.entity_id);
    }

    // Only show infra nodes that connect 2+ entities (shared infrastructure)
    for (const [key, group] of infraGroups) {
      if (group.entityIds.length < 2) continue;
      const infraNodeId = `infra_${key}`;
      nodeIds.add(infraNodeId);
      for (const entityId of group.entityIds) {
        nodeIds.add(entityId);
        edgeList.push({
          source: entityId,
          target: infraNodeId,
          type: "infrastructure",
          confidence: 0.8,
        });
      }
    }

    // Count connections per node
    const connCount = new Map<string, number>();
    for (const e of edgeList) {
      connCount.set(e.source, (connCount.get(e.source) ?? 0) + 1);
      connCount.set(e.target, (connCount.get(e.target) ?? 0) + 1);
    }

    const nodeList: GNode[] = [];

    // Entity nodes
    for (const e of entities) {
      if (!nodeIds.has(e.id)) continue;
      nodeList.push({
        id: e.id,
        label: e.entity_value,
        type: e.entity_type,
        x: 0, y: 0, vx: 0, vy: 0,
        connections: connCount.get(e.id) ?? 0,
      });
    }

    // Infrastructure nodes
    for (const [key, group] of infraGroups) {
      if (group.entityIds.length < 2) continue;
      const infraNodeId = `infra_${key}`;
      nodeList.push({
        id: infraNodeId,
        label: group.value.length > 25 ? group.value.substring(0, 23) + "…" : group.value,
        type: `infra_${group.type}`,
        x: 0, y: 0, vx: 0, vy: 0,
        connections: connCount.get(infraNodeId) ?? 0,
      });
    }

    return { graphNodes: nodeList, graphEdges: edgeList };
  }, [entities, rawEdges, infraLinks, filterEdgeType]);

  const positions = useForceLayout(graphNodes, graphEdges, dims.w, dims.h);

  const handleRun = async () => {
    if (!user) return;
    setRunning(true);
    try {
      const result = await runSocialGraphMining(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["social_graph_edges"] });
      toast.success(`Mined ${result.edgesCreated} relationships from ${result.entitiesAnalyzed} entities`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mining failed");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const handleInfraMine = async () => {
    if (!user) return;
    setMiningInfra(true);
    try {
      const result = await runInfrastructureMining(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["infrastructure_links"] });
      toast.success(`Created ${result.linksCreated} infrastructure links from ${result.entitiesAnalyzed} entities`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Infrastructure mining failed");
    } finally {
      setMiningInfra(false);
      setProgress("");
    }
  };

  const edgeTypeStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const e of rawEdges as any[]) {
      stats.set(e.relationship_type, (stats.get(e.relationship_type) ?? 0) + 1);
    }
    return stats;
  }, [rawEdges]);

  // Selected node details
  const selectedEntity = selectedNode ? entities.find((e) => e.id === selectedNode) : null;
  const selectedEdges = selectedNode
    ? (rawEdges as any[]).filter((e) => e.source_entity_id === selectedNode || e.target_entity_id === selectedNode)
    : [];

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Intelligence</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Social Graph Mining</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Analyze relationships between entities — communication, shared infrastructure, identifiers, and co-appearances.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="neon" size="sm" className="gap-2" disabled={running || miningInfra || !entities.length} onClick={handleRun}>
          {running ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />MINING...</>
          ) : (
            <><Users className="h-3.5 w-3.5" />MINE SOCIAL GRAPH</>
          )}
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={running || miningInfra || !entities.length} onClick={handleInfraMine}>
          {miningInfra ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />MAPPING...</>
          ) : (
            <><HardDrive className="h-3.5 w-3.5" />MAP INFRASTRUCTURE</>
          )}
        </Button>
        {(running || miningInfra) && progress && (
          <span className="font-mono text-[10px] text-primary">{progress}</span>
        )}
        {(rawEdges.length > 0 || infraLinks.length > 0) && (
          <span className="font-mono text-[10px] text-muted-foreground ml-auto">
            {graphNodes.length} NODES • {graphEdges.length} EDGES • {infraLinks.length} INFRA LINKS
          </span>
        )}
      </div>

      {!entities.length && !running && (
        <GlassPanel className="p-4">
          <p className="text-xs text-muted-foreground font-mono text-center">
            Run Identity Resolution first to populate the entity database, then mine social connections here.
          </p>
        </GlassPanel>
      )}

      {/* Edge type filters & stats */}
      {(rawEdges.length > 0 || infraLinks.length > 0) && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {["co_appearance", "shared_infrastructure", "shared_identifier", "communication", "infrastructure"].map((type) => {
            const count = type === "infrastructure"
              ? infraLinks.length
              : edgeTypeStats.get(type) ?? 0;
            const isActive = filterEdgeType === type;
            return (
              <button
                key={type}
                onClick={() => setFilterEdgeType(isActive ? "all" : type)}
                className={`glass-panel p-3 text-center rounded-lg transition-all ${isActive ? "ring-1 ring-primary" : "hover:ring-1 hover:ring-border"}`}
              >
                <div className="w-3 h-3 rounded-full mx-auto mb-1.5" style={{ backgroundColor: EDGE_COLORS[type] }} />
                <span className="font-mono text-lg font-bold text-foreground block">{count}</span>
                <span className="font-mono text-[9px] text-muted-foreground block tracking-widest">
                  {type.replace(/_/g, " ").toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Graph */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Network className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-semibold">Social Relationship Graph</span>
          {filterEdgeType !== "all" && (
            <button onClick={() => setFilterEdgeType("all")} className="font-mono text-[10px] text-primary hover:underline ml-2">
              SHOW ALL
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 flex-wrap mb-2">
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground opacity-60">NODES:</div>
          {Object.entries(TYPE_COLORS).filter(([t]) => !t.startsWith("infra_")).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {type.replace("_", " ").toUpperCase()}
            </div>
          ))}
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground opacity-60 ml-2">INFRA:</div>
          {Object.entries(TYPE_COLORS).filter(([t]) => t.startsWith("infra_")).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-2.5 h-2.5 rotate-45 rounded-[1px]" style={{ backgroundColor: color }} />
              {type.replace("infra_", "").replace(/_/g, " ").toUpperCase()}
            </div>
          ))}
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground opacity-60 ml-2">EDGES:</div>
          {Object.entries(EDGE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
              {type.replace(/_/g, " ").toUpperCase()}
            </div>
          ))}
        </div>

        <div className="flex gap-4">
          <div
            ref={containerRef}
            className="glass-panel rounded-lg overflow-hidden relative flex-1"
            style={{ height: 550 }}
          >
            {loadingEntities || loadingEdges ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : graphNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-xs font-mono text-muted-foreground">MINE THE SOCIAL GRAPH TO DISCOVER RELATIONSHIPS</p>
              </div>
            ) : (
              <svg width={dims.w} height={dims.h} className="w-full h-full">
                <defs>
                  <pattern id="sg-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="hsl(222, 16%, 12%)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#sg-grid)" />

                {/* Edges */}
                {graphEdges.map((edge, i) => {
                  const s = positions.get(edge.source);
                  const t = positions.get(edge.target);
                  if (!s || !t) return null;
                  const isHighlight = hoveredNode === edge.source || hoveredNode === edge.target ||
                    selectedNode === edge.source || selectedNode === edge.target;
                  const color = EDGE_COLORS[edge.type] ?? "hsl(222, 16%, 28%)";
                  return (
                    <g key={i}>
                      <line
                        x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke={isHighlight ? color : "hsl(222, 16%, 22%)"}
                        strokeWidth={isHighlight ? 2.5 : 1}
                        strokeDasharray={edge.confidence < 0.6 ? "4 4" : undefined}
                        opacity={hoveredNode && !isHighlight ? 0.08 : 0.6}
                      />
                      {isHighlight && (
                        <text
                          x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 8}
                          textAnchor="middle" fill={color}
                          fontSize={8} fontFamily="monospace"
                        >
                          {edge.type.replace(/_/g, " ")} ({Math.round(edge.confidence * 100)}%)
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Nodes */}
                {graphNodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  const color = TYPE_COLORS[node.type] ?? "hsl(215, 12%, 48%)";
                  const isHovered = hoveredNode === node.id;
                  const isSelected = selectedNode === node.id;
                  const dimmed = (hoveredNode || selectedNode) && !isHovered && !isSelected &&
                    !graphEdges.some((e) =>
                      ((e.source === (hoveredNode ?? selectedNode)) && e.target === node.id) ||
                      ((e.target === (hoveredNode ?? selectedNode)) && e.source === node.id)
                    );
                  const isInfra = node.type.startsWith("infra_");
                  const baseR = Math.min(10 + node.connections * 1.5, 22);
                  const r = isHovered || isSelected ? baseR + 3 : baseR;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                      className="cursor-pointer"
                      opacity={dimmed ? 0.12 : 1}
                    >
                      {(isHovered || isSelected) && <circle r={r + 6} fill={color} opacity={0.12} />}
                      {isInfra ? (
                        /* Diamond shape for infrastructure nodes */
                        <rect
                          x={-r} y={-r} width={r * 2} height={r * 2}
                          fill={color}
                          stroke={isSelected ? "hsl(0, 0%, 100%)" : isHovered ? "hsl(0, 0%, 80%)" : "none"}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          transform="rotate(45)"
                          rx={3}
                          style={{ filter: isHovered || isSelected ? `drop-shadow(0 0 10px ${color})` : undefined }}
                        />
                      ) : (
                        <circle
                          r={r}
                          fill={color}
                          stroke={isSelected ? "hsl(0, 0%, 100%)" : isHovered ? "hsl(0, 0%, 80%)" : "none"}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          style={{ filter: isHovered || isSelected ? `drop-shadow(0 0 10px ${color})` : undefined }}
                        />
                      )}
                      <text
                        textAnchor="middle" dominantBaseline="central"
                        fill="white" fontSize={r > 14 ? 11 : 9} fontWeight="bold" fontFamily="monospace"
                      >
                        {isInfra ? "⬡" : node.type[0].toUpperCase()}
                      </text>
                      <text
                        y={r + 12} textAnchor="middle"
                        className="fill-foreground" fontSize={9} fontFamily="monospace"
                      >
                        {node.label.length > 20 ? node.label.substring(0, 18) + "…" : node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* Detail panel */}
          {(selectedEntity || selectedNode?.startsWith("infra_")) && (
            <div className="w-72 flex-shrink-0 space-y-3 animate-fade-in">
              <GlassPanel className="p-4 space-y-3" neonLine="left">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-primary uppercase">
                    {selectedNode?.startsWith("infra_") ? "Infrastructure Node" : "Entity Detail"}
                  </span>
                  <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {selectedEntity ? (
                  <>
                    <div className="flex items-center gap-2">
                      {(() => { const Icon = TYPE_ICONS[selectedEntity.entity_type] ?? Globe; return <Icon className="h-4 w-4" style={{ color: TYPE_COLORS[selectedEntity.entity_type] }} />; })()}
                      <span className="font-mono font-semibold text-sm text-foreground break-all">{selectedEntity.entity_value}</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="intel-tag intel-tag-blue">{selectedEntity.entity_type.replace("_", " ").toUpperCase()}</span>
                      <span className="intel-tag">{selectedEdges.length} CONNECTIONS</span>
                    </div>

                    {/* Infra links for this entity */}
                    {(() => {
                      const entityInfra = (infraLinks as any[]).filter((l) => l.entity_id === selectedNode);
                      if (!entityInfra.length) return null;
                      return (
                        <div className="space-y-1.5">
                          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                            Infrastructure ({entityInfra.length})
                          </span>
                          {entityInfra.map((l: any) => (
                            <div key={l.id} className="p-2 rounded bg-secondary/50 text-[10px] font-mono">
                              <div className="flex items-center gap-1.5">
                                <HardDrive className="h-3 w-3 text-primary" />
                                <span className="text-foreground font-semibold">{l.infrastructure_type.replace(/_/g, " ")}</span>
                                <span className="text-primary ml-auto">{Math.round(l.confidence_score * 100)}%</span>
                              </div>
                              <span className="text-muted-foreground block mt-0.5 truncate">{l.value}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                ) : selectedNode?.startsWith("infra_") ? (
                  <>
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-primary" />
                      <span className="font-mono font-semibold text-sm text-foreground break-all">
                        {graphNodes.find((n) => n.id === selectedNode)?.label ?? selectedNode}
                      </span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="intel-tag" style={{ borderColor: "hsl(45, 80%, 50%)" }}>INFRASTRUCTURE</span>
                      <span className="intel-tag">
                        {graphEdges.filter((e) => e.source === selectedNode || e.target === selectedNode).length} LINKED ENTITIES
                      </span>
                    </div>
                  </>
                ) : null}
              </GlassPanel>

              {selectedEntity && selectedEdges.length > 0 && (
                <GlassPanel className="p-3 space-y-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                    Relationships ({selectedEdges.length})
                  </span>
                  <div className="space-y-1.5 max-h-[350px] overflow-auto">
                    {selectedEdges.map((edge: any) => {
                      const isSource = edge.source_entity_id === selectedNode;
                      const other = isSource ? edge.target : edge.source;
                      if (!other) return null;
                      const OtherIcon = TYPE_ICONS[other.entity_type] ?? Globe;
                      return (
                        <div key={edge.id} className="p-2 rounded bg-secondary/50 space-y-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <OtherIcon className="h-3 w-3" style={{ color: TYPE_COLORS[other.entity_type] }} />
                            <span className="font-mono font-semibold text-foreground truncate">{other.entity_value}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: EDGE_COLORS[edge.relationship_type] ?? "hsl(215,12%,48%)" }} />
                            <span className="font-mono text-muted-foreground">
                              {edge.relationship_type.replace(/_/g, " ")}
                            </span>
                            <span className="font-mono text-primary ml-auto">
                              {Math.round(edge.confidence_score * 100)}%
                            </span>
                          </div>
                          {edge.evidence && (
                            <p className="text-[10px] text-muted-foreground/70 font-mono">{edge.evidence}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </GlassPanel>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edge list */}
      {rawEdges.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            All Relationships ({rawEdges.length})
          </span>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {(rawEdges as any[]).slice(0, 100).map((edge) => {
              const srcType = edge.source?.entity_type ?? "unknown";
              const tgtType = edge.target?.entity_type ?? "unknown";
              const SrcIcon = TYPE_ICONS[srcType] ?? Globe;
              const TgtIcon = TYPE_ICONS[tgtType] ?? Globe;
              return (
                <GlassPanel key={edge.id} className="p-3">
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5">
                      <SrcIcon className="h-3.5 w-3.5" style={{ color: TYPE_COLORS[srcType] }} />
                      <span className="font-mono font-semibold text-foreground">{edge.source?.entity_value ?? "?"}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: EDGE_COLORS[edge.relationship_type] ?? "hsl(215,12%,48%)" }} />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {edge.relationship_type.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[10px] text-primary">
                        {Math.round(edge.confidence_score * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <TgtIcon className="h-3.5 w-3.5" style={{ color: TYPE_COLORS[tgtType] }} />
                      <span className="font-mono font-semibold text-foreground">{edge.target?.entity_value ?? "?"}</span>
                    </div>
                  </div>
                  {edge.evidence && (
                    <p className="text-[10px] text-muted-foreground/70 font-mono mt-1.5">{edge.evidence}</p>
                  )}
                </GlassPanel>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
