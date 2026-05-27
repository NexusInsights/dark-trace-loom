import { useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Shield, Search, Globe, Database, Zap, Lock, ArrowRight, Network,
  Fingerprint, Users, FileText, Code2, Bot, Briefcase, Eye, Server,
  Activity, CheckCircle, ChevronRight, Layers, Target, MapPin, Radio,
  Cpu, BarChart3, Award, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════
   ANIMATED NETWORK GRAPH (Canvas)
   ═══════════════════════════════════════════ */

interface Node {
  x: number; y: number; vx: number; vy: number; r: number; pulse: number; pulseSpeed: number;
}

function useNetworkCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const nodesRef = useRef<Node[]>([]);
  const animRef = useRef<number>(0);

  const init = useCallback((canvas: HTMLCanvasElement) => {
    const count = Math.min(Math.floor((canvas.width * canvas.height) / 25000), 60);
    nodesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 2 + 1,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.02,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
      init(canvas);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      const nodes = nodesRef.current;

      // Update positions
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += n.pulseSpeed;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      // Draw edges
      const maxDist = 120;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.15;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(124, 92, 252, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        const glow = 0.4 + Math.sin(n.pulse) * 0.3;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 145, 255, ${glow})`;
        ctx.fill();
        // outer glow
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 145, 255, ${glow * 0.15})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef, init]);
}

/* ═══════════════════════════════════════════
   GLASS CARD COMPONENT
   ═══════════════════════════════════════════ */

function GlassCard({ children, className, highlight }: { children: React.ReactNode; className?: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "relative rounded-lg border border-border/50 bg-card/60 backdrop-blur-md p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_20px_hsl(var(--neon-blue)/0.08)] group",
      highlight && "border-primary/40 shadow-[0_0_24px_hsl(var(--neon-blue)/0.1)]",
      className
    )}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════ */

const capabilities = [
  { icon: Fingerprint, title: "Identity Resolution Engine", desc: "Resolve and link identities across platforms, domains, and data sources." },
  { icon: Eye, title: "Persona Discovery", desc: "Uncover connected online personas and aliases through behavioral analysis." },
  { icon: Network, title: "Entity Correlation Graph", desc: "Map relationships between entities with interactive graph visualization." },
  { icon: Server, title: "Infrastructure Mapping", desc: "Trace digital infrastructure including DNS, IPs, certificates, and hosting." },
  { icon: Bot, title: "Automated OSINT Agents", desc: "Deploy autonomous agents to continuously collect and process intelligence." },
  { icon: Search, title: "Investigation Workspace", desc: "Unified workspace for managing multi-source investigations at scale." },
  { icon: Briefcase, title: "Evidence Management", desc: "Chain-of-custody evidence tracking with cryptographic verification." },
  { icon: FileText, title: "Legal Intelligence Reporting", desc: "Generate court-ready reports with proper evidence attribution." },
  { icon: Code2, title: "Enterprise API", desc: "Full REST API for custom integrations and automated workflows." },
];

const workflowSteps = [
  { icon: Radio, title: "Collect Intelligence", desc: "Ingest data from surface, deep, and dark web sources." },
  { icon: Cpu, title: "Analyze Entities", desc: "Extract and classify entities, personas, and infrastructure." },
  { icon: Layers, title: "Correlate Infrastructure", desc: "Cross-reference findings across disparate data points." },
  { icon: Target, title: "Investigate Relationships", desc: "Map entity connections and uncover hidden networks." },
  { icon: FileText, title: "Generate Evidence", desc: "Produce verified, exportable intelligence packages." },
];

const useCases = [
  { icon: Shield, title: "Cyber Threat Intelligence", desc: "Track threat actors, infrastructure, and attack patterns across the cyber landscape." },
  { icon: Search, title: "Fraud Investigation", desc: "Identify fraudulent entities, financial networks, and deceptive operations." },
  { icon: Briefcase, title: "Corporate Due Diligence", desc: "Comprehensive background investigations for M&A, partnerships, and compliance." },
  { icon: Fingerprint, title: "Digital Identity Attribution", desc: "Attribute online identities to real-world entities through behavioral correlation." },
  { icon: Globe, title: "Infrastructure Mapping", desc: "Map hosting, DNS, certificate, and network relationships at scale." },
];

const securityFeatures = [
  { icon: Lock, title: "Encrypted Evidence Storage", desc: "AES-256 encryption for all evidence artifacts and investigation data." },
  { icon: Activity, title: "Chain-of-Custody Tracking", desc: "Cryptographic audit trails for every evidence interaction." },
  { icon: BarChart3, title: "Audit Logging", desc: "Comprehensive activity logging for compliance and forensics." },
  { icon: Shield, title: "Secure Investigation Environment", desc: "Isolated investigation environments with zero-trust architecture." },
  { icon: KeyRound, title: "Role-Based Access Control", desc: "Granular permissions with organizational role hierarchies." },
];

const pricingPlans = [
  {
    name: "Free", price: "$0", period: "", desc: "Get started with basic tools",
    features: ["5 tool executions / day", "Basic search tools", "Community support", "Knowledge base access"],
    cta: "Get Started", variant: "outline" as const, priceId: null,
  },
  {
    name: "Professional", price: "$29", period: "/mo", desc: "For serious investigators",
    features: ["Unlimited tool executions", "Full investigation workspace", "Artifact storage & export", "Report generation", "Priority support"],
    cta: "Subscribe", variant: "neon" as const, highlight: true, priceId: "price_1T9NC1Q4s8rfSgucApe67wQN",
  },
  {
    name: "Team", price: "$99", period: "/mo", desc: "Collaborate across your org",
    features: ["Everything in Professional", "Shared investigations", "Team collaboration", "Role management", "Organization workspace"],
    cta: "Subscribe", variant: "outline" as const, priceId: "price_1T9NDKQ4s8rfSgucPdmpOZlN",
  },
  {
    name: "Enterprise", price: "Custom", period: "", desc: "Mission-critical operations",
    features: ["Everything in Team", "Dedicated infrastructure", "Enterprise API", "SLA guarantee", "Dedicated account manager", "Advanced correlation engine"],
    cta: "Contact Sales", variant: "outline" as const, priceId: "price_1T9NDeQ4s8rfSguceUqxqqHh",
  },
];

const footerLinks = [
  { label: "Platform", to: "/dashboard" },
  { label: "Tools", to: "/tools" },
  { label: "Training", to: "/training" },
  { label: "Knowledge Base", to: "/knowledge" },
  { label: "API", to: "/api" },
  { label: "Pricing", to: "/pricing" },
];

/* ═══════════════════════════════════════════
   MAIN LANDING PAGE
   ═══════════════════════════════════════════ */

export default function LandingPage() {
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  useNetworkCanvas(heroCanvasRef);

  useEffect(() => {
    document.title = "Insight Nexus — Intelligence Correlation";
    return () => { document.title = "Insight Nexus — Intelligence Correlation Platform"; };
  }, []);

  return (
    <div className="min-h-full overflow-x-hidden bg-background">

      {/* ─── TOP NAV ─── */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/70 border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Insight Nexus" width={28} height={28} className="rounded-sm" />
            <span className="font-display font-bold tracking-tight text-foreground">Insight Nexus</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-xs font-mono tracking-wider text-muted-foreground">
            <a href="#capabilities" className="hover:text-foreground transition-colors">CAPABILITIES</a>
            <Link to="/pricing" className="hover:text-foreground transition-colors">PRICING</Link>
            <Link to="/api" className="hover:text-foreground transition-colors">API</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="font-mono text-xs tracking-wider">
              <Link to="/auth">LOGIN</Link>
            </Button>
            <Button asChild variant="neon" size="sm" className="font-mono text-xs tracking-wider">
              <Link to="/auth?mode=signup">GET STARTED <ArrowRight className="ml-1.5 h-3 w-3" /></Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--neon-purple)/0.12),transparent)]" />
        <div className="absolute inset-0 grid-pattern opacity-20" />
        <canvas ref={heroCanvasRef} className="absolute inset-0 w-full h-full opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
          {/* Left — Copy */}
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
                Intelligence Correlation Platform
              </span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold tracking-tight leading-[1.08] mb-6">
              <span className="text-foreground">Insight Nexus</span>
              <br />
              <span className="bg-gradient-to-r from-primary via-accent to-neon-cyan bg-clip-text text-transparent">
                Intelligence Platform
              </span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground max-w-lg mb-10 leading-relaxed">
              Discover digital identities, correlate infrastructure, and automate intelligence investigations at enterprise scale.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="neon" size="lg" className="font-mono text-xs tracking-wider">
                <Link to="/dashboard">
                  LAUNCH PLATFORM <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="#capabilities" className="font-mono text-xs tracking-wider">
                  EXPLORE CAPABILITIES
                </Link>
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="flex items-center gap-6 mt-10 pt-8 border-t border-border/30">
              {[
                { label: "Investigations", value: "10K+" },
                { label: "Data Sources", value: "250+" },
                { label: "Uptime SLA", value: "99.9%" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-display text-xl font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] font-mono text-muted-foreground tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Visual */}
          <div className="hidden lg:block relative">
            <div className="relative w-full aspect-square max-w-[480px] mx-auto">
              {/* Concentric rings */}
              {[1, 0.7, 0.45].map((scale, i) => (
                <div
                  key={i}
                  className="absolute inset-0 rounded-full border border-primary/10"
                  style={{
                    transform: `scale(${scale})`,
                    animation: `pulse-glow ${3 + i}s ease-in-out infinite`,
                    animationDelay: `${i * 0.5}s`,
                  }}
                />
              ))}
              {/* Center emblem */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_hsl(var(--neon-blue)/0.2)]">
                  <Shield className="h-8 w-8 text-primary" />
                </div>
              </div>
              {/* Orbiting nodes */}
              {[
                { angle: 30, icon: Network, color: "text-accent" },
                { angle: 90, icon: Fingerprint, color: "text-primary" },
                { angle: 150, icon: Globe, color: "text-neon-cyan" },
                { angle: 210, icon: Database, color: "text-accent" },
                { angle: 270, icon: Eye, color: "text-primary" },
                { angle: 330, icon: Zap, color: "text-neon-cyan" },
              ].map((node, i) => {
                const rad = (node.angle * Math.PI) / 180;
                const radius = 42;
                return (
                  <div
                    key={i}
                    className="absolute"
                    style={{
                      left: `${50 + radius * Math.cos(rad)}%`,
                      top: `${50 + radius * Math.sin(rad)}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-lg bg-card/80 border border-border/60 flex items-center justify-center backdrop-blur-sm",
                      "shadow-[0_0_16px_hsl(var(--neon-blue)/0.08)]"
                    )}>
                      <node.icon className={cn("h-4 w-4", node.color)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── CAPABILITIES ─── */}
      <section id="capabilities" className="relative px-6 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Capabilities</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Intelligence Capabilities</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            Comprehensive toolkit for intelligence professionals — from data collection to evidence production.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {capabilities.map((cap) => (
            <GlassCard key={cap.title}>
              <div className="w-9 h-9 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <cap.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-display text-sm font-semibold mb-2">{cap.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{cap.desc}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* ─── WORKFLOW PIPELINE ─── */}
      <section className="relative px-6 py-24 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_50%,hsl(var(--neon-blue)/0.04),transparent)]" />
        <div className="relative max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <span className="font-mono text-[10px] tracking-[0.3em] text-accent uppercase">Workflow</span>
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Intelligence Pipeline</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              End-to-end workflow from raw data collection to court-ready evidence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {workflowSteps.map((step, i) => (
              <div key={step.title} className="relative flex flex-col items-center text-center">
                {/* Connector line */}
                {i < workflowSteps.length - 1 && (
                  <div className="hidden md:block absolute top-7 left-[60%] w-[80%] h-px bg-gradient-to-r from-primary/30 to-accent/20" />
                )}
                <div className="w-14 h-14 rounded-full bg-card border border-border/60 flex items-center justify-center mb-4 relative z-10 shadow-[0_0_20px_hsl(var(--neon-blue)/0.06)]">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="font-mono text-[9px] tracking-widest text-muted-foreground mb-1">STEP {i + 1}</span>
                <h3 className="font-display text-xs font-semibold mb-1.5">{step.title}</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[180px]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── INTERFACE PREVIEW ─── */}
      <section className="px-6 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Interface</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Operations Interface</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            Purpose-built for intelligence professionals. Every pixel designed for operational efficiency.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: "Operations Dashboard", desc: "Real-time operational overview with active case metrics, threat alerts, and team activity.", icon: BarChart3 },
            { title: "Investigation Workspace", desc: "Unified workspace for multi-source investigations with artifact management and timeline views.", icon: Search },
            { title: "Entity Graph", desc: "Interactive relationship visualization with force-directed graphs and entity clustering.", icon: Network },
          ].map((panel) => (
            <GlassCard key={panel.title} className="overflow-hidden">
              {/* Mock UI */}
              <div className="bg-background/60 rounded-md border border-border/40 p-3 mb-4 min-h-[140px] flex flex-col">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="w-2 h-2 rounded-full bg-destructive/60" />
                  <div className="w-2 h-2 rounded-full bg-warning/60" />
                  <div className="w-2 h-2 rounded-full bg-success/60" />
                  <span className="ml-2 font-mono text-[9px] text-muted-foreground">{panel.title.toLowerCase().replace(/ /g, "-")}</span>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-secondary/40 rounded-sm" style={{ height: `${20 + Math.random() * 30}px` }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <panel.icon className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm font-semibold">{panel.title}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{panel.desc}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* ─── USE CASES ─── */}
      <section className="px-6 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <span className="font-mono text-[10px] tracking-[0.3em] text-accent uppercase">Use Cases</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Investigation Use Cases</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {useCases.map((uc) => (
            <GlassCard key={uc.title}>
              <uc.icon className="h-5 w-5 text-accent mb-3" />
              <h3 className="font-display text-sm font-semibold mb-2">{uc.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{uc.desc}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="px-6 py-24 max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Pricing</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Intelligence at Every Scale</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            From individual analysts to enterprise security teams.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {pricingPlans.map((plan) => (
            <GlassCard key={plan.name} highlight={plan.highlight} className="flex flex-col">
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="intel-tag intel-tag-purple flex items-center gap-1">
                    <Award className="h-2.5 w-2.5" /> RECOMMENDED
                  </span>
                </div>
              )}
              <h3 className="font-display text-lg font-bold">{plan.name}</h3>
              <p className="text-xs text-muted-foreground mt-1 mb-4">{plan.desc}</p>
              <div className="mb-5">
                <span className="text-3xl font-display font-bold">{plan.price}</span>
                {plan.period && <span className="text-xs text-muted-foreground">{plan.period}</span>}
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                variant={plan.variant === "neon" ? "neon" : "outline"}
                size="sm"
                className="w-full font-mono text-[11px] tracking-wider"
              >
                <Link to="/pricing">{plan.cta.toUpperCase()}</Link>
              </Button>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* ─── SECURITY ─── */}
      <section className="relative px-6 py-24 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_50%,hsl(var(--neon-purple)/0.04),transparent)]" />
        <div className="relative max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <span className="font-mono text-[10px] tracking-[0.3em] text-accent uppercase">Security</span>
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-3">Enterprise Intelligence Security</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
              Military-grade security for sensitive intelligence operations.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {securityFeatures.map((feat) => (
              <GlassCard key={feat.title}>
                <feat.icon className="h-5 w-5 text-accent mb-3" />
                <h3 className="font-display text-sm font-semibold mb-2">{feat.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{feat.desc}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="px-6 py-24 max-w-4xl mx-auto">
        <div className="relative rounded-xl border border-border/50 bg-card/40 backdrop-blur-md p-12 md:p-16 text-center overflow-hidden neon-line-top">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,hsl(var(--neon-blue)/0.08),transparent)]" />
          <div className="relative z-10">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_hsl(var(--neon-blue)/0.15)]">
              <MapPin className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-4">Start Your First Investigation</h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
              Deploy the Insight Nexus platform and begin correlating intelligence in minutes.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Button asChild variant="neon" size="lg" className="font-mono text-xs tracking-wider">
                <Link to="/auth">CREATE ACCOUNT <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/dashboard" className="font-mono text-xs tracking-wider">LAUNCH PLATFORM</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-border/30 px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <span className="font-display font-bold text-sm tracking-wider">
                  Insight<span className="text-primary">Nexus</span>
                </span>
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground">INTELLIGENCE PLATFORM</p>
              </div>
            </div>

            {/* Links */}
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              {footerLinks.map((link) => (
                <Link
                  key={link.label}
                  to={link.to}
                  className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors tracking-wider"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-8 pt-6 border-t border-border/20 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="font-mono text-[10px] text-muted-foreground">
              © {new Date().getFullYear()} Insight Nexus. All rights reserved.
            </p>
            <div className="flex gap-6">
              <span className="font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">Security</span>
              <span className="font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">Terms</span>
              <span className="font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">Privacy</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
