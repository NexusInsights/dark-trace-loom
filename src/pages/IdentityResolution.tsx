import { useState, useRef, useEffect, useMemo } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useIdentityEntities, useIdentityLinks, useEntityObservations, useEntityScores } from "@/hooks/useIdentityResolution";
import { useCases } from "@/hooks/useInvestigationData";
import { useBreachRecords, useBreachStats } from "@/hooks/useBreachIntel";
import { useEntityTimeline } from "@/hooks/useEntityTimeline";
import { useQueryClient } from "@tanstack/react-query";
import { runIdentityResolution } from "@/lib/identityResolutionEngine";
import { computeEntityScores } from "@/lib/scoringEngine";
import { runBreachScan } from "@/lib/breachEngine";
import { reconstructTimeline } from "@/lib/timelineEngine";
import { toast } from "sonner";
import {
  Fingerprint, Loader2, Network, Mail, Globe, AtSign, Server, Phone, User,
  Zap, ArrowRight, RefreshCw, Share2, Shield, TrendingUp, AlertTriangle, Lock, Clock,
  Eye, EyeOff, Trash2, Bell, GitCompare, Expand,
} from "lucide-react";
import { useEntityMonitors, type MonitorType, type MonitorFrequency } from "@/hooks/useEntityMonitors";
import { MONITOR_TYPES, MONITOR_FREQUENCIES, runAllMonitors } from "@/lib/monitorEngine";
import { useIdentityClusters, useClusterMembers, useRunClustering } from "@/hooks/useIdentityClusters";
import { useSimilarityScores, useRunSimilarity } from "@/hooks/useSimilarityScores";
import { useRunExpansion, useExpansionLogs } from "@/hooks/useIdentityExpansion";

const TYPE_COLORS: Record<string, string> = {
  username: "hsl(35, 85%, 55%)",
  email: "hsl(270, 60%, 58%)",
  domain: "hsl(160, 60%, 45%)",
  ip: "hsl(0, 72%, 51%)",
  phone: "hsl(200, 70%, 50%)",
  social_profile: "hsl(320, 60%, 55%)",
};

const TYPE_ICONS: Record<string, typeof Mail> = {
  username: AtSign,
  email: Mail,
  domain: Globe,
  ip: Server,
  phone: Phone,
  social_profile: Share2,
};

// Force layout
interface GNode {
  id: string;
  label: string;
  type: string;
  score: number;
  x: number; y: number; vx: number; vy: number;
}

interface GEdge {
  source: string;
  target: string;
  label: string;
  confidence: number;
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
        : { ...n, x: w / 2 + (Math.random() - 0.5) * 300, y: h / 2 + (Math.random() - 0.5) * 300, vx: 0, vy: 0 };
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
          const force = 4000 / (dist * dist);
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
        const force = (dist - 130) * 0.015;
        s.vx += (dx / dist) * force; s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force; t.vy -= (dy / dist) * force;
      }
      for (const n of ns) {
        n.vx += (w / 2 - n.x) * 0.004;
        n.vy += (h / 2 - n.y) * 0.004;
        n.vx *= 0.9; n.vy *= 0.9;
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

export default function IdentityResolutionPage() {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { data: cases = [] } = useCases();
  const { data: entities = [], isLoading: loadingEntities } = useIdentityEntities();
  const { data: links = [], isLoading: loadingLinks } = useIdentityLinks();
  const { data: scores = [] } = useEntityScores();
  const qc = useQueryClient();

  const [running, setRunning] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scanningBreaches, setScanningBreaches] = useState(false);
  const [rebuildingTimeline, setRebuildingTimeline] = useState(false);
  const [progress, setProgress] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const { data: observations = [] } = useEntityObservations(selectedEntityId);
  const { data: entityBreaches = [] } = useBreachRecords(selectedEntityId);
  const { data: entityTimeline = [] } = useEntityTimeline(selectedEntityId);
  const { data: breachStats } = useBreachStats();
  const { data: clusters = [] } = useIdentityClusters();
  const { mutate: runClustering, isPending: clustering, progress: clusterProgress } = useRunClustering();
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const { data: clusterMembers = [] } = useClusterMembers(selectedClusterId);
  const { data: similarityScores = [] } = useSimilarityScores();
  const { mutate: runSimilarity, isPending: computingSimilarity, progress: similarityProgress } = useRunSimilarity();
  const { mutate: runExpansion, isPending: expanding } = useRunExpansion();
  const { data: expansionLogs = [] } = useExpansionLogs(selectedEntityId);

  const scoreMap = useMemo(() => {
    const m = new Map<string, { score: number; reasons: any[] }>();
    for (const s of scores as any[]) {
      m.set(s.entity_id, { score: s.score, reasons: s.score_reasons ?? [] });
    }
    return m;
  }, [scores]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

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

  // Build graph
  const { graphNodes, graphEdges } = useMemo(() => {
    const nodeMap = new Map<string, GNode>();
    const edgeList: GEdge[] = [];

    const filteredEntities = filterType === "all"
      ? entities
      : entities.filter((e) => e.entity_type === filterType);

    const entityIds = new Set(filteredEntities.map((e) => e.id));

    for (const e of filteredEntities) {
      nodeMap.set(e.id, {
        id: e.id,
        label: e.entity_value,
        type: e.entity_type,
        score: scoreMap.get(e.id)?.score ?? 0,
        x: 0, y: 0, vx: 0, vy: 0,
      });
    }

    for (const l of links) {
      if (entityIds.has(l.source_entity_id) && entityIds.has(l.target_entity_id)) {
        edgeList.push({
          source: l.source_entity_id,
          target: l.target_entity_id,
          label: l.relationship_type,
          confidence: l.confidence_score,
        });
      }
    }

    return { graphNodes: Array.from(nodeMap.values()), graphEdges: edgeList };
  }, [entities, links, filterType, scoreMap]);

  const positions = useForceLayout(graphNodes, graphEdges, dims.w, dims.h);

  const handleRun = async () => {
    if (!user) return;
    setRunning(true);
    try {
      const result = await runIdentityResolution(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["identity_entities"] });
      qc.invalidateQueries({ queryKey: ["identity_links"] });
      toast.success(`Resolved ${result.entitiesResolved} entities with ${result.linksCreated} links`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const handleScore = async () => {
    if (!user) return;
    setScoring(true);
    try {
      const result = await computeEntityScores(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["entity_scores"] });
      toast.success(`Scored ${result.entitiesScored} entities`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setScoring(false);
      setProgress("");
    }
  };

  const handleBreachScan = async () => {
    if (!user) return;
    setScanningBreaches(true);
    try {
      const result = await runBreachScan(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["breach_records"] });
      qc.invalidateQueries({ queryKey: ["breach_stats"] });
      if (result.notConfigured) {
        toast.error(`Breach lookup not configured: ${result.reason ?? "API keys missing"}`);
      } else {
        toast.success(`Found ${result.exposuresFound} exposure(s) across ${result.identifiersScanned} identifier(s)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Breach scan failed");
    } finally {
      setScanningBreaches(false);
      setProgress("");
    }
  };

  const handleReconstructTimeline = async () => {
    if (!user) return;
    setRebuildingTimeline(true);
    try {
      const result = await reconstructTimeline(user.id, setProgress);
      qc.invalidateQueries({ queryKey: ["entity_timeline"] });
      toast.success(`Created ${result.eventsCreated} timeline events across ${result.entitiesProcessed} entities`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Timeline reconstruction failed");
    } finally {
      setRebuildingTimeline(false);
      setProgress("");
    }
  };

  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const e of entities) {
      stats.set(e.entity_type, (stats.get(e.entity_type) ?? 0) + 1);
    }
    return stats;
  }, [entities]);

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Intelligence</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Identity Resolution</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Link multiple identifiers belonging to the same person across investigations.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="neon" size="sm" className="gap-2" disabled={running || !cases.length} onClick={handleRun}>
          {running ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />RESOLVING...</>
          ) : (
            <><Fingerprint className="h-3.5 w-3.5" />RUN IDENTITY RESOLUTION</>
          )}
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={scoring || !entities.length} onClick={handleScore}>
          {scoring ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />SCORING...</>
          ) : (
            <><TrendingUp className="h-3.5 w-3.5" />COMPUTE SCORES</>
          )}
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={scanningBreaches || !entities.length} onClick={handleBreachScan}>
          {scanningBreaches ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />SCANNING...</>
          ) : (
            <><AlertTriangle className="h-3.5 w-3.5" />BREACH SCAN</>
          )}
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={rebuildingTimeline || !entities.length} onClick={handleReconstructTimeline}>
          {rebuildingTimeline ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />REBUILDING...</>
          ) : (
            <><Clock className="h-3.5 w-3.5" />TIMELINE</>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={!user || !entities.length}
          onClick={async () => {
            if (!user) return;
            toast.info("Running monitors...");
            const result = await runAllMonitors(user.id);
            qc.invalidateQueries({ queryKey: ["entity-monitors"] });
            qc.invalidateQueries({ queryKey: ["entity_timeline"] });
            toast.success(`Checked ${result.checked} monitors — ${result.triggered} triggered`);
          }}
        >
          <Bell className="h-3.5 w-3.5" />RUN MONITORS
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={clustering || !entities.length}
          onClick={() => runClustering(undefined, {
            onSuccess: (res) => toast.success(`Created ${res.clustersCreated} clusters with ${res.entitiesClustered} members`),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Clustering failed"),
          })}
        >
          {clustering ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />CLUSTERING...</> : <><Network className="h-3.5 w-3.5" />CLUSTER IDENTITIES</>}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={computingSimilarity || !entities.length}
          onClick={() => runSimilarity(undefined, {
            onSuccess: (res) => toast.success(`Scored ${res.pairsScored} pairs, ${res.highSimilarity} high similarity`),
            onError: (e) => toast.error(e instanceof Error ? e.message : "Similarity analysis failed"),
          })}
        >
          {computingSimilarity ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />ANALYZING...</> : <><GitCompare className="h-3.5 w-3.5" />SIMILARITY SCORE</>}
        </Button>
        {(running || scoring || scanningBreaches || rebuildingTimeline || clustering || computingSimilarity) && (progress || clusterProgress || similarityProgress) && (
          <span className="font-mono text-[10px] text-primary">{progress || clusterProgress || similarityProgress}</span>
        )}
        {entities.length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground ml-auto">
            {entities.length} ENTITIES • {links.length} LINKS • {scores.length} SCORED
            {breachStats && breachStats.total > 0 && ` • ${breachStats.total} BREACHES`}
          </span>
        )}
      </div>

      {/* Breach stats */}
      {breachStats && breachStats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <GlassPanel className="p-3 text-center" neonLine="top">
            <span className="font-mono text-lg font-bold text-destructive block">{breachStats.total}</span>
            <span className="font-mono text-[9px] text-muted-foreground tracking-widest">TOTAL BREACHES</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="font-mono text-lg font-bold text-destructive block">{breachStats.critical}</span>
            <span className="font-mono text-[9px] text-muted-foreground tracking-widest">CRITICAL</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="font-mono text-lg font-bold text-yellow-400 block">{breachStats.high}</span>
            <span className="font-mono text-[9px] text-muted-foreground tracking-widest">HIGH</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="font-mono text-lg font-bold text-destructive block">{breachStats.credentialsLeaked}</span>
            <span className="font-mono text-[9px] text-muted-foreground tracking-widest">CREDENTIALS LEAKED</span>
          </GlassPanel>
          <GlassPanel className="p-3 text-center">
            <span className="font-mono text-lg font-bold text-destructive block">{breachStats.passwordReuse}</span>
            <span className="font-mono text-[9px] text-muted-foreground tracking-widest">PASSWORD REUSE</span>
          </GlassPanel>
        </div>
      )}

      {/* Stats */}
      {entities.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {["username", "email", "domain", "ip", "phone", "social_profile"].map((type) => {
            const Icon = TYPE_ICONS[type] ?? Globe;
            const count = typeStats.get(type) ?? 0;
            const isActive = filterType === type;
            return (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? "all" : type)}
                className={`glass-panel p-3 text-center rounded-lg transition-all ${isActive ? "ring-1 ring-primary" : "hover:ring-1 hover:ring-border"}`}
              >
                <Icon className="h-4 w-4 mx-auto mb-1" style={{ color: TYPE_COLORS[type] }} />
                <span className="font-mono text-lg font-bold text-foreground block">{count}</span>
                <span className="font-mono text-[9px] text-muted-foreground block tracking-widest">
                  {type.replace("_", " ").toUpperCase()}
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
          <span className="font-display text-sm font-semibold">Identity Graph</span>
          {filterType !== "all" && (
            <button
              onClick={() => setFilterType("all")}
              className="font-mono text-[10px] text-primary hover:underline ml-2"
            >
              CLEAR FILTER
            </button>
          )}
        </div>

        <div className="flex gap-4 flex-wrap mb-2">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {type.replace("_", " ").toUpperCase()}
            </div>
          ))}
        </div>

        <div ref={containerRef} className="glass-panel rounded-lg overflow-hidden relative" style={{ height: 500 }}>
          {loadingEntities || loadingLinks ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : graphNodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Fingerprint className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-xs font-mono text-muted-foreground">
                RUN THE ENGINE TO RESOLVE IDENTITIES
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                The engine extracts and links identifiers across all your cases
              </p>
            </div>
          ) : (
            <svg width={dims.w} height={dims.h} className="w-full h-full">
              <defs>
                <pattern id="id-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="hsl(222, 16%, 12%)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#id-grid)" />

              {graphEdges.map((edge, i) => {
                const s = positions.get(edge.source);
                const t = positions.get(edge.target);
                if (!s || !t) return null;
                const isHighlight = hoveredNode === edge.source || hoveredNode === edge.target;
                return (
                  <g key={i}>
                    <line
                      x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                      stroke={isHighlight ? "hsl(230, 80%, 62%)" : "hsl(222, 16%, 22%)"}
                      strokeWidth={isHighlight ? 2 : 1}
                      strokeDasharray={edge.confidence < 0.7 ? "4 4" : undefined}
                      opacity={hoveredNode && !isHighlight ? 0.1 : 0.6}
                    />
                    {isHighlight && (
                      <text
                        x={(s.x + t.x) / 2}
                        y={(s.y + t.y) / 2 - 8}
                        textAnchor="middle"
                        className="fill-primary"
                        fontSize={8}
                        fontFamily="monospace"
                      >
                        {edge.label} ({Math.round(edge.confidence * 100)}%)
                      </text>
                    )}
                  </g>
                );
              })}

              {graphNodes.map((node) => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                const color = TYPE_COLORS[node.type] ?? "hsl(215, 12%, 48%)";
                const isHovered = hoveredNode === node.id;
                const dimmed = hoveredNode && !isHovered &&
                  !graphEdges.some((e) =>
                    (e.source === hoveredNode && e.target === node.id) ||
                    (e.target === hoveredNode && e.source === node.id)
                  );

                // Score-based sizing: base 10, max 22
                const scoreVal = node.score;
                const baseR = Math.max(10, Math.min(10 + scoreVal * 0.12, 22));
                const r = isHovered ? baseR + 3 : baseR;

                // Score ring color: green < 30, yellow 30-60, red > 60
                const scoreColor = scoreVal >= 60 ? "hsl(0, 72%, 51%)" : scoreVal >= 30 ? "hsl(45, 90%, 50%)" : "hsl(160, 60%, 45%)";

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => setSelectedEntityId(selectedEntityId === node.id ? null : node.id)}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.15 : 1}
                  >
                    {isHovered && <circle r={r + 8} fill={color} opacity={0.12} />}
                    {/* Score ring */}
                    {scoreVal > 0 && (
                      <circle
                        r={r + 3}
                        fill="none"
                        stroke={scoreColor}
                        strokeWidth={2}
                        strokeDasharray={`${(scoreVal / 100) * (2 * Math.PI * (r + 3))} ${2 * Math.PI * (r + 3)}`}
                        strokeDashoffset={0}
                        transform="rotate(-90)"
                        opacity={0.8}
                      />
                    )}
                    <circle
                      r={r}
                      fill={color}
                      stroke={isHovered ? "hsl(0, 0%, 100%)" : "none"}
                      strokeWidth={1.5}
                      style={{ filter: isHovered ? `drop-shadow(0 0 8px ${color})` : undefined }}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="white"
                      fontSize={r > 14 ? 11 : 9}
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {scoreVal > 0 ? Math.round(scoreVal) : node.type[0].toUpperCase()}
                    </text>
                    <text
                      y={r + 12}
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

      {/* Links table */}
      {links.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Identity Links ({links.length})
          </span>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {links.map((l: any) => {
              const srcType = l.source?.entity_type ?? "unknown";
              const tgtType = l.target?.entity_type ?? "unknown";
              const SrcIcon = TYPE_ICONS[srcType] ?? Globe;
              const TgtIcon = TYPE_ICONS[tgtType] ?? Globe;

              return (
                <GlassPanel key={l.id} className="p-3">
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5">
                      <SrcIcon className="h-3.5 w-3.5" style={{ color: TYPE_COLORS[srcType] }} />
                      <span className="font-mono font-semibold text-foreground">
                        {l.source?.entity_value ?? "?"}
                      </span>
                      <span className="intel-tag" style={{ borderColor: TYPE_COLORS[srcType] }}>
                        {srcType.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-primary">
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-mono text-[10px]">
                        {l.relationship_type.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        ({Math.round(l.confidence_score * 100)}%)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <TgtIcon className="h-3.5 w-3.5" style={{ color: TYPE_COLORS[tgtType] }} />
                      <span className="font-mono font-semibold text-foreground">
                        {l.target?.entity_value ?? "?"}
                      </span>
                      <span className="intel-tag" style={{ borderColor: TYPE_COLORS[tgtType] }}>
                        {tgtType.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </GlassPanel>
              );
            })}
          </div>
        </div>
      )}

      {/* Entity observation detail panel */}
      {selectedEntityId && (() => {
        const entity = entities.find((e) => e.id === selectedEntityId);
        if (!entity) return null;
        const Icon = TYPE_ICONS[entity.entity_type] ?? Globe;
        return (
          <GlassPanel className="p-4 space-y-3" neonLine="top">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: TYPE_COLORS[entity.entity_type] }} />
                <span className="font-mono font-semibold text-sm text-foreground">{entity.entity_value}</span>
                <span className="intel-tag intel-tag-blue">{entity.entity_type.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-[10px] font-mono"
                  disabled={expanding}
                  onClick={() => runExpansion({
                    entity_id: entity.id,
                    entity_type: entity.entity_type,
                    entity_value: entity.entity_value,
                  })}
                >
                  {expanding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Expand className="h-3 w-3" />}
                  EXPAND
                </Button>
                <button
                  onClick={() => setSelectedEntityId(null)}
                  className="text-muted-foreground hover:text-foreground text-xs font-mono"
                >
                  CLOSE
                </button>
              </div>
            </div>

            {/* Score display */}
            {(() => {
              const s = scoreMap.get(entity.id);
              if (!s) return null;
              const scoreColor = s.score >= 60 ? "text-destructive" : s.score >= 30 ? "text-yellow-400" : "text-green-400";
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Risk Score</span>
                    <span className={`font-mono text-lg font-bold ${scoreColor}`}>{Math.round(s.score)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">/ 100</span>
                  </div>
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${s.score}%`,
                        backgroundColor: s.score >= 60 ? "hsl(0, 72%, 51%)" : s.score >= 30 ? "hsl(45, 90%, 50%)" : "hsl(160, 60%, 45%)",
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(s.reasons as { factor: string; value: number; contribution: number }[]).map((r, i) => (
                      <div key={i} className="p-1.5 rounded bg-secondary/50 text-[10px] font-mono">
                        <span className="text-muted-foreground">{r.factor}</span>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-foreground font-semibold">{r.value}</span>
                          <span className="text-primary">+{Math.round(r.contribution)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                Observations Across Cases ({observations.length})
              </span>
              {observations.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">No observations recorded yet.</p>
              ) : (
                <div className="space-y-1.5 mt-2 max-h-[200px] overflow-auto">
                  {observations.map((obs: any) => (
                    <div key={obs.id} className="flex items-center gap-3 text-xs font-mono p-2 rounded bg-secondary/50">
                      <span className="text-foreground font-semibold truncate max-w-[200px]">
                        {obs.case?.title ?? obs.case_id?.slice(0, 8) ?? "—"}
                      </span>
                      {obs.source_tool && (
                        <span className="intel-tag">{obs.source_tool}</span>
                      )}
                      <span className="text-muted-foreground ml-auto">
                        {new Date(obs.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Breach Intelligence */}
            {entityBreaches.length > 0 && (
              <div>
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  Breach Exposure ({entityBreaches.length})
                </span>
                <div className="space-y-1.5 mt-2 max-h-[200px] overflow-auto">
                  {(entityBreaches as any[]).map((breach) => {
                    const sevColor = breach.severity === "critical" ? "text-destructive"
                      : breach.severity === "high" ? "text-yellow-400" : "text-muted-foreground";
                    return (
                      <div key={breach.id} className="p-2 rounded bg-secondary/50 text-[10px] font-mono space-y-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`h-3 w-3 ${sevColor}`} />
                          <span className="text-foreground font-semibold">{breach.breach_source}</span>
                          <span className={`ml-auto uppercase font-bold ${sevColor}`}>{breach.severity}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {breach.breach_date && (
                            <span className="text-muted-foreground">{breach.breach_date}</span>
                          )}
                          {breach.credential_leaked && (
                            <span className="intel-tag" style={{ borderColor: "hsl(0, 72%, 51%)" }}>
                              <Lock className="h-2.5 w-2.5 inline mr-0.5" />CREDENTIAL LEAKED
                            </span>
                          )}
                          {breach.password_reuse_detected && (
                            <span className="intel-tag" style={{ borderColor: "hsl(0, 72%, 51%)" }}>
                              PASSWORD REUSE
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {(breach.data_exposed as string[])?.map((d: string) => (
                            <span key={d} className="intel-tag text-[8px]">{d}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Identity Timeline */}
            {entityTimeline.length > 0 && (
              <div>
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  Timeline ({entityTimeline.length} events)
                </span>
                <div className="relative mt-2 max-h-[250px] overflow-auto">
                  <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-accent/30 to-transparent" />
                  <div className="space-y-2">
                    {(entityTimeline as any[]).map((evt, i) => {
                      const date = new Date(evt.event_timestamp);
                      const label = evt.event_type?.replace(/_/g, " ") ?? "event";
                      return (
                        <div key={evt.id} className="relative pl-5 text-[10px] font-mono">
                          <div className="absolute left-0 top-1 w-[10px] h-[10px] rounded-full border-2 border-background bg-primary" />
                          <div className="p-2 rounded bg-secondary/50 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{date.toLocaleDateString()}</span>
                              <span className="uppercase text-foreground font-semibold">{label}</span>
                            </div>
                            {evt.description && (
                              <p className="text-muted-foreground">{evt.description}</p>
                            )}
                            {evt.source && (
                              <span className="intel-tag text-[8px]">{evt.source}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Entity Monitoring */}
            <EntityMonitorPanel entityId={selectedEntityId} userId={user?.id} />

            {/* Expansion Logs */}
            {expansionLogs.length > 0 && (
              <div>
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  Expansion History ({expansionLogs.length})
                </span>
                <div className="space-y-1 mt-2 max-h-[180px] overflow-auto">
                  {expansionLogs.map((log: any) => {
                    const statusColor = log.status === "completed" ? "text-green-400" : log.status === "failed" ? "text-destructive" : "text-yellow-400";
                    return (
                      <div key={log.id} className="flex items-center gap-2 font-mono text-[10px] p-1.5 rounded bg-muted/30">
                        <span className={`font-bold uppercase ${statusColor}`}>{log.status}</span>
                        <span className="text-foreground">{log.step.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground ml-auto">{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </GlassPanel>
        );
      })()}

      {/* Global Entity Database */}
      {entities.length > 0 && (
        <div className="space-y-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            Global Entity Database ({entities.length})
          </span>
          <div className="grid gap-2 max-h-[400px] overflow-auto">
            {entities
              .filter((e) => filterType === "all" || e.entity_type === filterType)
              .map((e) => {
                const Icon = TYPE_ICONS[e.entity_type] ?? Globe;
                const isSelected = selectedEntityId === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEntityId(isSelected ? null : e.id)}
                    className={`glass-panel p-3 text-left rounded-lg transition-all ${isSelected ? "ring-1 ring-primary" : "hover:ring-1 hover:ring-border"}`}
                  >
                    <div className="flex items-center gap-3 text-xs">
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: TYPE_COLORS[e.entity_type] }} />
                      <span className="font-mono font-semibold text-foreground truncate">{e.entity_value}</span>
                      <span className="intel-tag" style={{ borderColor: TYPE_COLORS[e.entity_type] }}>
                        {e.entity_type.replace("_", " ").toUpperCase()}
                      </span>
                      {(() => {
                        const s = scoreMap.get(e.id);
                        if (!s || s.score === 0) return null;
                        const sc = s.score;
                        const clr = sc >= 60 ? "text-destructive" : sc >= 30 ? "text-yellow-400" : "text-green-400";
                        return <span className={`font-mono text-[10px] font-bold ${clr}`}>{Math.round(sc)}</span>;
                      })()}
                      <span className="text-muted-foreground ml-auto font-mono text-[10px]">
                        {new Date(e.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Identity Clusters */}
      {clusters.length > 0 && (
        <GlassPanel className="p-4" neonLine="top">
          <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
            <Network className="h-3.5 w-3.5" /> IDENTITY CLUSTERS ({clusters.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clusters.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedClusterId(selectedClusterId === c.id ? null : c.id)}
                className={`text-left p-3 rounded border transition-colors ${selectedClusterId === c.id ? "border-primary bg-primary/10" : "border-border/50 hover:border-primary/40 bg-card/50"}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-medium truncate max-w-[180px]">{c.cluster_label}</span>
                  <span className="font-mono text-[10px] text-primary font-bold">{Math.round(Number(c.cluster_score))}%</span>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
              </button>
            ))}
          </div>

          {selectedClusterId && clusterMembers.length > 0 && (
            <div className="mt-4 border-t border-border/50 pt-3">
              <h4 className="font-mono text-[10px] tracking-widest text-muted-foreground mb-2">CLUSTER MEMBERS ({clusterMembers.length})</h4>
              <div className="space-y-1.5">
                {clusterMembers.map((m) => {
                  const entity = m.entity as any;
                  const Icon = TYPE_ICONS[entity?.entity_type] ?? User;
                  return (
                    <div key={m.id} className="flex items-center gap-2 font-mono text-xs p-1.5 rounded bg-muted/30">
                      <Icon className="h-3 w-3 shrink-0" style={{ color: TYPE_COLORS[entity?.entity_type] ?? "hsl(var(--muted-foreground))" }} />
                      <span className="truncate flex-1">{entity?.entity_value ?? "unknown"}</span>
                      <span className="text-[9px] text-muted-foreground uppercase">{entity?.entity_type}</span>
                      <span className="text-[9px] text-primary font-bold">{Math.round(m.confidence_score * 100)}%</span>
                      {m.join_reason && <span className="text-[8px] text-muted-foreground">{m.join_reason.replace(/_/g, " ")}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </GlassPanel>
      )}

      {/* Behavioral Similarity Scores */}
      {similarityScores.length > 0 && (
        <GlassPanel className="p-4" neonLine="top">
          <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
            <GitCompare className="h-3.5 w-3.5" /> BEHAVIORAL SIMILARITY ({similarityScores.length} pairs)
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {similarityScores.map((s: any) => {
              const entityA = entities.find((e) => e.id === s.entity_a);
              const entityB = entities.find((e) => e.id === s.entity_b);
              const pct = Math.round(Number(s.similarity_score) * 100);
              const barColor = pct >= 70 ? "bg-destructive" : pct >= 40 ? "bg-yellow-500" : "bg-primary";
              return (
                <div key={s.id} className="p-3 rounded border border-border/50 bg-card/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-mono text-xs truncate max-w-[140px]">{entityA?.entity_value ?? "?"}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs truncate max-w-[140px]">{entityB?.entity_value ?? "?"}</span>
                    </div>
                    <span className={`font-mono text-xs font-bold ${pct >= 70 ? "text-destructive" : pct >= 40 ? "text-yellow-500" : "text-primary"}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex gap-3 font-mono text-[9px] text-muted-foreground">
                    <span>USR: {Math.round(Number(s.username_similarity) * 100)}%</span>
                    <span>TMP: {Math.round(Number(s.temporal_similarity) * 100)}%</span>
                    <span>INF: {Math.round(Number(s.infrastructure_similarity) * 100)}%</span>
                    <span>META: {Math.round(Number(s.metadata_similarity) * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

function EntityMonitorPanel({ entityId, userId }: { entityId: string; userId?: string }) {
  const { monitors, createMonitor, toggleMonitor, deleteMonitor } = useEntityMonitors(entityId);
  const [addType, setAddType] = useState<string>("domain_registration");
  const [addFreq, setAddFreq] = useState<string>("daily");
  const [showAdd, setShowAdd] = useState(false);

  if (!userId) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase flex items-center gap-1.5">
          <Bell className="h-3 w-3" /> Monitors ({monitors.data?.length ?? 0})
        </span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="font-mono text-[10px] text-primary hover:underline"
        >
          {showAdd ? "CANCEL" : "+ ADD MONITOR"}
        </button>
      </div>

      {showAdd && (
        <div className="mt-2 p-3 rounded bg-secondary/50 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="font-mono text-[9px] text-muted-foreground block mb-1">TYPE</span>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-[10px] font-mono"
              >
                {MONITOR_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="font-mono text-[9px] text-muted-foreground block mb-1">FREQUENCY</span>
              <select
                value={addFreq}
                onChange={(e) => setAddFreq(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-[10px] font-mono"
              >
                {MONITOR_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => {
              createMonitor.mutate({
                entity_id: entityId,
                monitor_type: addType as MonitorType,
                frequency: addFreq as MonitorFrequency,
              });
              setShowAdd(false);
            }}
            className="w-full bg-primary text-primary-foreground rounded px-3 py-1.5 text-[10px] font-mono font-semibold hover:opacity-90 transition-opacity"
          >
            CREATE MONITOR
          </button>
        </div>
      )}

      {monitors.data && monitors.data.length > 0 && (
        <div className="space-y-1.5 mt-2 max-h-[200px] overflow-auto">
          {monitors.data.map((m) => {
            const typeInfo = MONITOR_TYPES.find((t) => t.value === m.monitor_type);
            return (
              <div key={m.id} className="flex items-center gap-2 p-2 rounded bg-secondary/50 text-[10px] font-mono">
                <button
                  onClick={() => toggleMonitor.mutate({ id: m.id, enabled: !m.enabled })}
                  className="shrink-0"
                >
                  {m.enabled ? (
                    <Eye className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <span className="text-foreground font-semibold">{typeInfo?.label ?? m.monitor_type}</span>
                  <span className="text-muted-foreground ml-2">{m.frequency}</span>
                </div>
                {m.last_triggered && (
                  <span className="text-primary shrink-0">TRIGGERED</span>
                )}
                <button
                  onClick={() => deleteMonitor.mutate(m.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
