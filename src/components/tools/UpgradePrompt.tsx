import { useNavigate } from "react-router-dom";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Zap } from "lucide-react";
import type { SubscriptionPlan } from "@/hooks/useSubscription";

interface Props {
  reason: string;
  requiredPlan: SubscriptionPlan;
}

export function UpgradePrompt({ reason, requiredPlan }: Props) {
  const navigate = useNavigate();

  return (
    <GlassPanel className="p-5 border-destructive/30" neonLine="left">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-3">
          <div>
            <span className="font-mono text-[10px] tracking-widest text-destructive">PLAN RESTRICTION</span>
            <p className="text-sm text-foreground mt-1">{reason}</p>
          </div>
          <Button
            variant="neon"
            size="sm"
            onClick={() => navigate("/pricing")}
            className="gap-2"
          >
            <Zap className="h-3.5 w-3.5" />
            UPGRADE TO {requiredPlan.toUpperCase()}
          </Button>
        </div>
      </div>
    </GlassPanel>
  );
}
