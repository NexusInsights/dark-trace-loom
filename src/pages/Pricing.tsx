import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription, SubscriptionPlan } from "@/hooks/useSubscription";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Check, X, Crown, Loader2, Zap, Users, Building2, Sparkles, ExternalLink,
} from "lucide-react";

/* ─── Plan Configuration ─── */

interface PlanConfig {
  name: string;
  price: number;
  priceId: string | null;
  icon: typeof Zap;
  tagline: string;
  highlight?: boolean;
}

const PLANS: Record<SubscriptionPlan, PlanConfig> = {
  free: {
    name: "Free",
    price: 0,
    priceId: null,
    icon: Sparkles,
    tagline: "Get started with the basics",
  },
  professional: {
    name: "Professional",
    price: 29,
    priceId: "price_1T9NC1Q4s8rfSgucApe67wQN",
    icon: Zap,
    tagline: "For serious investigators",
    highlight: true,
  },
  team: {
    name: "Team",
    price: 79,
    priceId: "price_1T9NDKQ4s8rfSgucPdmpOZlN",
    icon: Users,
    tagline: "Collaborate across your org",
  },
  enterprise: {
    name: "Enterprise",
    price: 199,
    priceId: "price_1T9NDeQ4s8rfSguceUqxqqHh",
    icon: Building2,
    tagline: "Mission-critical operations",
  },
};

const PLAN_ORDER: SubscriptionPlan[] = ["free", "professional", "team", "enterprise"];

/* ─── Feature Comparison Data ─── */

interface FeatureRow {
  label: string;
  category: string;
  values: Record<SubscriptionPlan, boolean | string>;
}

const FEATURES: FeatureRow[] = [
  // Tools
  { label: "Tool suite access", category: "Tools", values: { free: "Basic (5/day)", professional: "Unlimited", team: "Unlimited", enterprise: "Unlimited" } },
  { label: "Save tool results", category: "Tools", values: { free: false, professional: true, team: true, enterprise: true } },
  { label: "Priority processing", category: "Tools", values: { free: false, professional: false, team: false, enterprise: true } },
  // Investigations
  { label: "Create investigations", category: "Investigations", values: { free: false, professional: true, team: true, enterprise: true } },
  { label: "Artifact storage", category: "Investigations", values: { free: false, professional: true, team: true, enterprise: true } },
  { label: "Report export", category: "Investigations", values: { free: false, professional: true, team: true, enterprise: true } },
  { label: "Advanced correlation engine", category: "Investigations", values: { free: false, professional: false, team: false, enterprise: true } },
  // Collaboration
  { label: "Shared cases", category: "Collaboration", values: { free: false, professional: false, team: true, enterprise: true } },
  { label: "Team collaboration", category: "Collaboration", values: { free: false, professional: false, team: true, enterprise: true } },
  { label: "Role management", category: "Collaboration", values: { free: false, professional: false, team: true, enterprise: true } },
  // Platform
  { label: "Knowledge base", category: "Platform", values: { free: true, professional: true, team: true, enterprise: true } },
  { label: "Training courses", category: "Platform", values: { free: true, professional: true, team: true, enterprise: true } },
  { label: "API access", category: "Platform", values: { free: false, professional: false, team: false, enterprise: true } },
  // Support
  { label: "Community support", category: "Support", values: { free: true, professional: true, team: true, enterprise: true } },
  { label: "Priority support", category: "Support", values: { free: false, professional: true, team: true, enterprise: true } },
  { label: "Dedicated account manager", category: "Support", values: { free: false, professional: false, team: false, enterprise: true } },
  { label: "SLA guarantee", category: "Support", values: { free: false, professional: false, team: false, enterprise: true } },
];

const featureCategories = Array.from(new Set(FEATURES.map((f) => f.category)));

/* ─── Component ─── */

export default function PricingPage() {
  const { plan: currentPlan, subscribed, subscriptionEnd, loading, refreshSubscription } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("canceled") === "true") {
      toast.info("Checkout canceled");
    }
  }, [searchParams]);

  const handleCheckout = async (priceId: string) => {
    setCheckoutLoading(priceId);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManage = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to open portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const renderCellValue = (value: boolean | string) => {
    if (typeof value === "string") {
      return <span className="text-xs text-foreground font-mono">{value}</span>;
    }
    return value ? (
      <Check className="h-4 w-4 text-primary mx-auto" />
    ) : (
      <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-10">
      {/* Header */}
      <div className="text-center space-y-3 pt-4">
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Pricing</span>
        <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">
          Intelligence at every scale
        </h1>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          From individual analysts to enterprise security teams. Choose the plan that fits your mission.
        </p>
        {subscribed && subscriptionEnd && (
          <p className="text-xs text-muted-foreground font-mono">
            Current period ends {new Date(subscriptionEnd).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Manage button */}
      {subscribed && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={handleManage} disabled={portalLoading}>
            {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <ExternalLink className="h-3.5 w-3.5 mr-2" />}
            MANAGE SUBSCRIPTION
          </Button>
        </div>
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLAN_ORDER.map((planKey) => {
          const plan = PLANS[planKey];
          const isCurrentPlan = currentPlan === planKey;
          const Icon = plan.icon;

          return (
            <GlassPanel
              key={planKey}
              className={`p-6 flex flex-col relative transition-all duration-300 ${
                plan.highlight ? "glow-blue border-primary/30" : ""
              } ${isCurrentPlan ? "ring-2 ring-primary" : ""}`}
              neonLine={plan.highlight ? "top" : undefined}
            >
              {isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="intel-tag intel-tag-blue flex items-center gap-1">
                    <Crown className="h-2.5 w-2.5" /> YOUR PLAN
                  </span>
                </div>
              )}

              {plan.highlight && !isCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="intel-tag intel-tag-purple flex items-center gap-1">
                    MOST POPULAR
                  </span>
                </div>
              )}

              <Icon className="h-6 w-6 text-primary mb-3" />
              <h3 className="font-display text-lg font-bold">{plan.name}</h3>
              <p className="text-xs text-muted-foreground mt-1 mb-4">{plan.tagline}</p>

              <div className="mb-6">
                <span className="text-3xl font-display font-bold">${plan.price}</span>
                {plan.price > 0 && <span className="text-xs text-muted-foreground">/mo</span>}
              </div>

              <div className="mt-auto">
                {loading ? (
                  <Button variant="outline" size="sm" disabled className="w-full">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </Button>
                ) : isCurrentPlan ? (
                  <Button variant="outline" size="sm" disabled className="w-full font-mono text-[11px]">CURRENT PLAN</Button>
                ) : planKey === "free" ? (
                  subscribed ? (
                    <Button variant="outline" size="sm" onClick={handleManage} disabled={portalLoading} className="w-full font-mono text-[11px]">DOWNGRADE</Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled className="w-full font-mono text-[11px]">CURRENT PLAN</Button>
                  )
                ) : (
                  <Button
                    variant={plan.highlight ? "neon" : "outline"}
                    size="sm"
                    className="w-full font-mono text-[11px]"
                    disabled={!!checkoutLoading}
                    onClick={() => plan.priceId && handleCheckout(plan.priceId)}
                  >
                    {checkoutLoading === plan.priceId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : subscribed ? "SWITCH PLAN" : "SUBSCRIBE"}
                  </Button>
                )}
              </div>
            </GlassPanel>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="space-y-4">
        <div className="text-center">
          <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Feature comparison</span>
        </div>

        <GlassPanel className="overflow-hidden" neonLine="top">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Table Header */}
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 font-mono text-[10px] tracking-widest text-muted-foreground w-[240px] min-w-[200px]">
                    FEATURE
                  </th>
                  {PLAN_ORDER.map((planKey) => {
                    const plan = PLANS[planKey];
                    return (
                      <th
                        key={planKey}
                        className={`p-4 text-center font-display text-sm font-semibold min-w-[120px] ${
                          planKey === currentPlan ? "text-primary" : "text-foreground"
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <plan.icon className="h-4 w-4 text-primary" />
                          <span>{plan.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground font-normal">
                            ${plan.price}{plan.price > 0 ? "/mo" : ""}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Table Body */}
              <tbody>
                {featureCategories.map((category) => (
                  <>
                    {/* Category header */}
                    <tr key={`cat-${category}`} className="bg-secondary/30">
                      <td
                        colSpan={PLAN_ORDER.length + 1}
                        className="px-4 py-2.5 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase"
                      >
                        {category}
                      </td>
                    </tr>
                    {/* Feature rows */}
                    {FEATURES.filter((f) => f.category === category).map((feature) => (
                      <tr key={feature.label} className="border-b border-border/40 hover:bg-secondary/20 transition-colors">
                        <td className="p-4 text-xs text-foreground">{feature.label}</td>
                        {PLAN_ORDER.map((planKey) => (
                          <td
                            key={planKey}
                            className={`p-4 text-center ${
                              planKey === currentPlan ? "bg-primary/5" : ""
                            }`}
                          >
                            {renderCellValue(feature.values[planKey])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>

              {/* Table Footer — CTA row */}
              <tfoot>
                <tr className="border-t border-border">
                  <td className="p-4" />
                  {PLAN_ORDER.map((planKey) => {
                    const plan = PLANS[planKey];
                    const isCurrentPlan = currentPlan === planKey;
                    return (
                      <td key={planKey} className="p-4 text-center">
                        {loading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto text-muted-foreground" />
                        ) : isCurrentPlan ? (
                          <span className="font-mono text-[10px] text-primary">CURRENT</span>
                        ) : planKey === "free" ? null : (
                          <Button
                            variant={plan.highlight ? "neon" : "outline"}
                            size="sm"
                            className="font-mono text-[10px]"
                            disabled={!!checkoutLoading}
                            onClick={() => plan.priceId && handleCheckout(plan.priceId)}
                          >
                            {checkoutLoading === plan.priceId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : "SELECT"}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </GlassPanel>
      </div>

      {/* Footer */}
      <div className="text-center space-y-2 pb-6">
        <Button variant="ghost" size="sm" onClick={refreshSubscription} disabled={loading} className="font-mono text-[10px]">
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
          REFRESH STATUS
        </Button>
        <p className="text-[11px] text-muted-foreground">
          All plans include 256-bit encryption · SOC 2 compliant · Cancel anytime
        </p>
      </div>
    </div>
  );
}
