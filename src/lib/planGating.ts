import type { SubscriptionPlan } from "@/hooks/useSubscription";

// ─── Feature Flags per Plan ───

export interface PlanPermissions {
  maxToolRunsPerDay: number;       // -1 = unlimited
  canSaveInvestigations: boolean;
  canExportReports: boolean;
  canShareCases: boolean;
  canCollaborate: boolean;
  canManageRoles: boolean;
  hasApiAccess: boolean;
  hasAdvancedCorrelation: boolean;
  hasPriorityProcessing: boolean;
  canUploadArtifacts: boolean;
}

const PLAN_PERMISSIONS: Record<SubscriptionPlan, PlanPermissions> = {
  free: {
    maxToolRunsPerDay: 5,
    canSaveInvestigations: false,
    canExportReports: false,
    canShareCases: false,
    canCollaborate: false,
    canManageRoles: false,
    hasApiAccess: false,
    hasAdvancedCorrelation: false,
    hasPriorityProcessing: false,
    canUploadArtifacts: false,
  },
  professional: {
    maxToolRunsPerDay: -1,
    canSaveInvestigations: true,
    canExportReports: true,
    canShareCases: false,
    canCollaborate: false,
    canManageRoles: false,
    hasApiAccess: false,
    hasAdvancedCorrelation: false,
    hasPriorityProcessing: false,
    canUploadArtifacts: true,
  },
  team: {
    maxToolRunsPerDay: -1,
    canSaveInvestigations: true,
    canExportReports: true,
    canShareCases: true,
    canCollaborate: true,
    canManageRoles: true,
    hasApiAccess: false,
    hasAdvancedCorrelation: false,
    hasPriorityProcessing: false,
    canUploadArtifacts: true,
  },
  enterprise: {
    maxToolRunsPerDay: -1,
    canSaveInvestigations: true,
    canExportReports: true,
    canShareCases: true,
    canCollaborate: true,
    canManageRoles: true,
    hasApiAccess: true,
    hasAdvancedCorrelation: true,
    hasPriorityProcessing: true,
    canUploadArtifacts: true,
  },
};

export function getPlanPermissions(plan: SubscriptionPlan): PlanPermissions {
  return PLAN_PERMISSIONS[plan];
}

// ─── Pre-execution Gate ───

export type GateResult =
  | { allowed: true; reason?: undefined; requiredPlan?: undefined }
  | { allowed: false; reason: string; requiredPlan: SubscriptionPlan };

/**
 * Check whether a tool execution is allowed based on plan limits and current daily usage.
 * @param dailyTotal – the user's total tool executions today (from usage_metrics DB)
 */
export function checkToolExecutionGate(
  plan: SubscriptionPlan,
  dailyTotal: number
): GateResult {
  const perms = getPlanPermissions(plan);

  if (perms.maxToolRunsPerDay !== -1 && dailyTotal >= perms.maxToolRunsPerDay) {
    return {
      allowed: false,
      reason: `Daily tool limit reached (${perms.maxToolRunsPerDay} runs). Upgrade for unlimited access.`,
      requiredPlan: "professional",
    };
  }

  return { allowed: true };
}

export function checkFeatureGate(
  plan: SubscriptionPlan,
  feature: keyof PlanPermissions
): GateResult {
  const perms = getPlanPermissions(plan);
  const value = perms[feature];

  if (typeof value === "boolean" && !value) {
    const minPlan = getMinimumPlanForFeature(feature);
    const labels: Partial<Record<keyof PlanPermissions, string>> = {
      canSaveInvestigations: "Saving investigations",
      canExportReports: "Exporting reports",
      canShareCases: "Sharing cases",
      canCollaborate: "Collaboration",
      canManageRoles: "Role management",
      hasApiAccess: "API access",
      hasAdvancedCorrelation: "Advanced correlation engine",
      hasPriorityProcessing: "Priority processing",
      canUploadArtifacts: "Artifact storage",
    };
    return {
      allowed: false,
      reason: `${labels[feature] ?? feature} requires the ${minPlan.charAt(0).toUpperCase() + minPlan.slice(1)} plan or higher.`,
      requiredPlan: minPlan,
    };
  }

  return { allowed: true };
}

function getMinimumPlanForFeature(feature: keyof PlanPermissions): SubscriptionPlan {
  const order: SubscriptionPlan[] = ["free", "professional", "team", "enterprise"];
  for (const p of order) {
    const val = PLAN_PERMISSIONS[p][feature];
    if (typeof val === "boolean" && val) return p;
    if (typeof val === "number" && val === -1) return p;
  }
  return "enterprise";
}
