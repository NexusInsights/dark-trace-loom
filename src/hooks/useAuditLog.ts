import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Json } from "@/integrations/supabase/types";

export type AuditAction =
  | "login"
  | "logout"
  | "tool_execution"
  | "artifact_upload"
  | "case_created"
  | "case_modified"
  | "case_deleted"
  | "report_generated"
  | "subject_added"
  | "event_added"
  | "analysis_run"
  | "api_key_created"
  | "api_key_revoked"
  | "org_created"
  | "member_invited"
  | "tool_installed";

export function useAuditLog() {
  const { user } = useAuth();

  const log = useCallback(
    async (
      action: AuditAction,
      entityType?: string,
      entityId?: string,
      metadata?: Record<string, unknown>
    ) => {
      if (!user) return;
      try {
        await supabase.from("activity_logs").insert({
          user_id: user.id,
          action,
          entity_type: entityType ?? null,
          entity_id: entityId ?? null,
          metadata: (metadata ?? {}) as unknown as Json,
        });
      } catch {
        // Fire-and-forget — never block the main flow
      }
    },
    [user]
  );

  return { log };
}
