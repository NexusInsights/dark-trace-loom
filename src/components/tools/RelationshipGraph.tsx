import { useRef, useEffect, useState, useCallback } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import {
  useEntities, useEntityRelationships,
  useCreateEntity, useCreateRelationship,
} from "@/hooks/useGraphData";
import {
  Plus, X, Loader2, Network, User, Mail, Globe, AtSign, Server,
} from "lucide-react";

// ─── Node colors by type ───
const TYPE_COLORS: Record<string, string> = {
  subject: "hsl(230, 80%, 62%)",
  email: "hsl(270, 60%, 58%)",
  domain: "hsl(160, 60%, 45%)",
  username: "hsl(35, 85%, 55%)",
  ip: "hsl(0, 72%, 51%)",
};

const TYPE_ICONS: Record<string, typeof User> = {
  subject: User,
  email: Mail,
  domain: Globe,
  username: AtSign,
  ip: Server,
};

const ENTITY_TYPES = ["subject", "email", "domain", "username", "ip"];
const REL_TYPES = ["owns", "uses", "resolves_to", "linked", "communicates"];

// ─── Simple force simulation ───
interface SimNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  source: string;
  target: string;
  type: string;
}

function useForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number
) {
  const nodesRef = useRef<SimNode[]>([]);
  const frameRef = useRef<number>(0);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    // Initialize or merge positions
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = nodes.map((n) => {
      const ex = existing.get(n.id);
      return ex
        ? { ...n, x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy }
        : { ...n, x: width / 2 + (Math.random() - 0.5) * 200, y: height / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 };
    });

    let running = true;
    const tick = () => {
      if (!running) return;
      const ns = nodesRef.current;
      const damping = 0.92;
      const repulsion = 3000;
      const springLen = 120;
      const springK = 0.02;
      const centerK = 0.005;

      // Repulsion
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

      // Springs
      for (const e of edges) {
        const s = ns.find((n) => n.id === e.source);
        const t = ns.find((n) => n.id === e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - springLen) * springK;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }

      // Center gravity + update
      for (const n of ns) {
        n.vx += (width / 2 - n.x) * centerK;
        n.vy += (height / 2 - n.y) * centerK;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(30, Math.min(width - 30, n.x));
        n.y = Math.max(30, Math.min(height - 30, n.y));
      }

      setPositions(new Map(ns.map((n) => [n.id, { x: n.x, y: n.y }])));
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [nodes.length, edges.length, width, height]);

  return positions;
}

// ─── Graph Component ───
interface Props {
  caseId: string;
}

export function RelationshipGraph({ caseId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 400 });
  const [showAddEntity, setShowAddEntity] = useState(false);
  const [showAddRel, setShowAddRel] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const { data: entities = [], isLoading: loadingEntities } = useEntities(caseId);
  const { data: relationships = [] } = useEntityRelationships(caseId);
  const createEntity = useCreateEntity();
  const createRelationship = useCreateRelationship();

  // Form state
  const [entityForm, setEntityForm] = useState({ type: "subject", label: "" });
  const [relForm, setRelForm] = useState({ source_id: "", target_id: "", type: "linked", notes: "" });

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

  const simNodes: SimNode[] = entities.map((e) => ({
    id: e.id, label: e.label, type: e.entity_type,
    x: 0, y: 0, vx: 0, vy: 0,
  }));

  const simEdges: SimEdge[] = relationships.map((r) => ({
    source: r.source_id, target: r.target_id, type: r.relationship_type,
  }));

  const positions = useForceSimulation(simNodes, simEdges, dims.w, dims.h);

  const handleAddEntity = (e: React.FormEvent) => {
    e.preventDefault();
    createEntity.mutate(
      { case_id: caseId, entity_type: entityForm.type, label: entityForm.label },
      { onSuccess: () => { setEntityForm({ type: "subject", label: "" }); setShowAddEntity(false); } }
    );
  };

  const handleAddRel = (e: React.FormEvent) => {
    e.preventDefault();
    createRelationship.mutate(
      { case_id: caseId, source_id: relForm.source_id, target_id: relForm.target_id, relationship_type: relForm.type, notes: relForm.notes || undefined },
      { onSuccess: () => { setRelForm({ source_id: "", target_id: "", type: "linked", notes: "" }); setShowAddRel(false); } }
    );
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Network className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-semibold">Entity Graph</span>
          <span className="intel-tag intel-tag-blue">{entities.length} NODES</span>
          <span className="intel-tag intel-tag-purple">{relationships.length} EDGES</span>
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => { setShowAddEntity(!showAddEntity); setShowAddRel(false); }}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              showAddEntity ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
          >
            + ENTITY
          </button>
          <button
            onClick={() => { setShowAddRel(!showAddRel); setShowAddEntity(false); }}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              showAddRel ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
            disabled={entities.length < 2}
          >
            + LINK
          </button>
        </div>
      </div>

      {/* Add Entity Form */}
      {showAddEntity && (
        <GlassPanel className="p-3" neonLine="top">
          <form onSubmit={handleAddEntity} className="flex gap-2 items-end flex-wrap">
            <div className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TYPE</label>
              <select
                value={entityForm.type}
                onChange={(e) => setEntityForm((f) => ({ ...f, type: e.target.value }))}
                className="bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="flex-1 space-y-1 min-w-[150px]">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">LABEL</label>
              <input
                required
                value={entityForm.label}
                onChange={(e) => setEntityForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. admin@shadow.net"
                className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button type="submit" variant="neon" size="sm" disabled={createEntity.isPending}>
              {createEntity.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "ADD"}
            </Button>
          </form>
        </GlassPanel>
      )}

      {/* Add Relationship Form */}
      {showAddRel && (
        <GlassPanel className="p-3" neonLine="top">
          <form onSubmit={handleAddRel} className="flex gap-2 items-end flex-wrap">
            <div className="space-y-1 min-w-[120px]">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">FROM</label>
              <select
                required
                value={relForm.source_id}
                onChange={(e) => setRelForm((f) => ({ ...f, source_id: e.target.value }))}
                className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select...</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">RELATION</label>
              <select
                value={relForm.type}
                onChange={(e) => setRelForm((f) => ({ ...f, type: e.target.value }))}
                className="bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {REL_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1 min-w-[120px]">
              <label className="font-mono text-[10px] tracking-widest text-muted-foreground">TO</label>
              <select
                required
                value={relForm.target_id}
                onChange={(e) => setRelForm((f) => ({ ...f, target_id: e.target.value }))}
                className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select...</option>
                {entities.filter((en) => en.id !== relForm.source_id).map((en) => (
                  <option key={en.id} value={en.id}>{en.label}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="neon" size="sm" disabled={createRelationship.isPending}>
              {createRelationship.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "LINK"}
            </Button>
          </form>
        </GlassPanel>
      )}

      {/* Legend */}
      <div className="flex gap-3 flex-wrap">
        {ENTITY_TYPES.map((t) => (
          <div key={t} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] }} />
            {t.toUpperCase()}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="glass-panel rounded-lg overflow-hidden relative"
        style={{ height: 420 }}
      >
        {loadingEntities ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : entities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Network className="h-10 w-10 text-muted-foreground/30 mb-2" />
            <p className="text-xs font-mono text-muted-foreground">ADD ENTITIES TO BUILD THE GRAPH</p>
          </div>
        ) : (
          <svg width={dims.w} height={dims.h} className="w-full h-full">
            {/* Grid */}
            <defs>
              <pattern id="graph-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="hsl(222, 16%, 12%)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#graph-grid)" />

            {/* Edges */}
            {simEdges.map((edge, i) => {
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
                    strokeDasharray={edge.type === "linked" ? "4 4" : undefined}
                    opacity={hoveredNode && !isHighlight ? 0.15 : 0.7}
                  />
                  {/* Edge label */}
                  <text
                    x={(s.x + t.x) / 2}
                    y={(s.y + t.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={9}
                    fontFamily="monospace"
                    opacity={isHighlight ? 1 : 0.4}
                  >
                    {edge.type}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {entities.map((entity) => {
              const pos = positions.get(entity.id);
              if (!pos) return null;
              const color = TYPE_COLORS[entity.entity_type] ?? "hsl(215, 12%, 48%)";
              const isHovered = hoveredNode === entity.id;
              const isSelected = selectedNode === entity.id;
              const dimmed = hoveredNode && !isHovered &&
                !simEdges.some((e) =>
                  (e.source === hoveredNode && e.target === entity.id) ||
                  (e.target === hoveredNode && e.source === entity.id)
                );

              return (
                <g
                  key={entity.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseEnter={() => setHoveredNode(entity.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(selectedNode === entity.id ? null : entity.id)}
                  className="cursor-pointer"
                  opacity={dimmed ? 0.2 : 1}
                >
                  {/* Glow */}
                  {(isHovered || isSelected) && (
                    <circle r={22} fill={color} opacity={0.15} />
                  )}
                  {/* Node circle */}
                  <circle
                    r={isHovered ? 16 : 14}
                    fill={color}
                    stroke={isSelected ? "hsl(0, 0%, 100%)" : color}
                    strokeWidth={isSelected ? 2 : 0}
                    style={{
                      filter: isHovered ? `drop-shadow(0 0 8px ${color})` : undefined,
                      transition: "r 0.15s ease",
                    }}
                  />
                  {/* Icon (using first letter as fallback) */}
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={11}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {entity.entity_type[0].toUpperCase()}
                  </text>
                  {/* Label */}
                  <text
                    y={24}
                    textAnchor="middle"
                    className="fill-foreground"
                    fontSize={10}
                    fontFamily="monospace"
                  >
                    {entity.label.length > 18 ? entity.label.substring(0, 16) + "…" : entity.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {/* Selected node detail */}
        {selectedNode && (() => {
          const entity = entities.find((e) => e.id === selectedNode);
          if (!entity) return null;
          const connectedEdges = relationships.filter(
            (r) => r.source_id === selectedNode || r.target_id === selectedNode
          );
          return (
            <div className="absolute top-3 right-3 w-56 glass-panel rounded-lg p-3 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[entity.entity_type] }} />
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{entity.entity_type.toUpperCase()}</span>
                </div>
                <button onClick={() => setSelectedNode(null)}>
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
              <p className="text-xs font-medium break-all">{entity.label}</p>
              <div>
                <span className="font-mono text-[10px] text-muted-foreground">CONNECTIONS ({connectedEdges.length})</span>
                <div className="mt-1 space-y-1 max-h-[120px] overflow-auto">
                  {connectedEdges.map((r) => {
                    const otherId = r.source_id === selectedNode ? r.target_id : r.source_id;
                    const other = entities.find((e) => e.id === otherId);
                    return (
                      <div key={r.id} className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-primary font-mono">{r.relationship_type}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground truncate">{other?.label ?? "?"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="font-mono text-[9px] text-muted-foreground/60">{entity.id.substring(0, 12)}...</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
