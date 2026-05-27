import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  CreditCard, ExternalLink, Loader2, Crown, Calendar, ArrowUpRight,
  XCircle, RefreshCw, FileText, Zap, Shield, CheckCircle, AlertTriangle,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  active: { label: "Active", color: "text-emerald-400", icon: CheckCircle },
  trialing: { label: "Trial", color: "text-primary", icon: Zap },
  past_due: { label: "Past Due", color: "text-warning", icon: AlertTriangle },
  canceled: { label: "Canceled", color: "text-destructive", icon: XCircle },
  inactive: { label: "Inactive", color: "text-muted-foreground", icon: XCircle },
};

export default function BillingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { plan, subscribed, subscriptionEnd, loading: subLoading, refreshSubscription } = useSubscription();
  const [portalLoading, setPortalLoading] = useState<string | null>(null);

  // Fetch full subscription record from DB
  const { data: subRecord, isLoading: recordLoading } = useQuery({
    queryKey: ["subscription-record", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const openPortal = async (flow?: string) => {
    setPortalLoading(flow ?? "portal");
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to open billing portal");
    } finally {
      setPortalLoading(null);
    }
  };

  const loading = subLoading || recordLoading;
  const status = subRecord?.status ?? (subscribed ? "active" : "inactive");
  const statusConfig = STATUS_CONFIG[status] ?? STATUS_CONFIG.inactive;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Billing</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Subscription & Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your plan, payment method, and invoices</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Active Subscription Card */}
          <GlassPanel className="p-6" neonLine="top">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="space-y-3">
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CURRENT PLAN</span>
                <div className="flex items-center gap-3">
                  <Crown className="h-6 w-6 text-primary" />
                  <h2 className="font-display text-2xl font-bold capitalize">{plan}</h2>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border border-border ${statusConfig.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                </div>

                {subscriptionEnd && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {status === "canceled" ? "Access until" : "Renews"}{" "}
                      <span className="text-foreground font-mono">
                        {new Date(subscriptionEnd).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                  </div>
                )}

                {subRecord?.stripe_customer_id && (
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    Customer: {subRecord.stripe_customer_id}
                  </p>
                )}
              </div>

              {/* Quick action */}
              {plan === "free" ? (
                <Button variant="neon" size="sm" onClick={() => navigate("/pricing")} className="gap-2">
                  <Zap className="h-3.5 w-3.5" />
                  UPGRADE PLAN
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshSubscription()}
                  className="gap-2 font-mono text-[10px]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  REFRESH
                </Button>
              )}
            </div>
          </GlassPanel>

          {/* Action Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Upgrade / Change Plan */}
            <GlassPanel className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-primary" />
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CHANGE PLAN</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {subscribed
                  ? "Switch to a different plan or downgrade."
                  : "Upgrade to unlock unlimited tools, investigations, and more."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono text-[10px] gap-2"
                onClick={() => navigate("/pricing")}
              >
                <Zap className="h-3.5 w-3.5" />
                {subscribed ? "VIEW PLANS" : "UPGRADE NOW"}
              </Button>
            </GlassPanel>

            {/* Payment Method */}
            <GlassPanel className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">PAYMENT METHOD</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Update your credit card or payment details via the secure billing portal.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono text-[10px] gap-2"
                disabled={!subscribed || portalLoading === "payment"}
                onClick={() => openPortal("payment")}
              >
                {portalLoading === "payment" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <><ExternalLink className="h-3.5 w-3.5" />UPDATE PAYMENT</>
                )}
              </Button>
            </GlassPanel>

            {/* Invoices */}
            <GlassPanel className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">INVOICES</span>
              </div>
              <p className="text-xs text-muted-foreground">
                View and download past invoices and payment receipts.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono text-[10px] gap-2"
                disabled={!subscribed || portalLoading === "invoices"}
                onClick={() => openPortal("invoices")}
              >
                {portalLoading === "invoices" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <><ExternalLink className="h-3.5 w-3.5" />VIEW INVOICES</>
                )}
              </Button>
            </GlassPanel>

            {/* Cancel Subscription */}
            <GlassPanel className="p-5 space-y-3 border-destructive/20">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground">CANCEL SUBSCRIPTION</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cancel your subscription. You'll retain access until the current billing period ends.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono text-[10px] gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                disabled={!subscribed || status === "canceled" || portalLoading === "cancel"}
                onClick={() => openPortal("cancel")}
              >
                {portalLoading === "cancel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : status === "canceled" ? (
                  "ALREADY CANCELED"
                ) : (
                  <><XCircle className="h-3.5 w-3.5" />CANCEL PLAN</>
                )}
              </Button>
            </GlassPanel>
          </div>

          {/* Billing Portal CTA */}
          {subscribed && (
            <GlassPanel className="p-5" glow="blue">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Full Billing Portal</p>
                    <p className="text-xs text-muted-foreground">
                      Manage everything in one place — payment history, subscriptions, and tax info.
                    </p>
                  </div>
                </div>
                <Button
                  variant="neon"
                  size="sm"
                  className="gap-2 font-mono text-[10px]"
                  disabled={portalLoading === "portal"}
                  onClick={() => openPortal()}
                >
                  {portalLoading === "portal" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <><ExternalLink className="h-3.5 w-3.5" />OPEN PORTAL</>
                  )}
                </Button>
              </div>
            </GlassPanel>
          )}
        </>
      )}
    </div>
  );
}
