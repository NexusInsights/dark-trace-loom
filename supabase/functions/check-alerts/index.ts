import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: unknown) =>
  console.log(`[CHECK-ALERTS] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    log("Starting alert check cycle");

    // Get all enabled alerts that are due for checking
    const now = new Date();
    const { data: alerts, error: alertsErr } = await supabase
      .from("alerts")
      .select("*, subjects(name, type, case_id)")
      .eq("enabled", true);

    if (alertsErr) throw alertsErr;
    if (!alerts || alerts.length === 0) {
      log("No active alerts found");
      return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("Found active alerts", { count: alerts.length });

    let triggered = 0;

    for (const alert of alerts) {
      // Check frequency - skip if checked too recently
      if (alert.last_checked) {
        const lastChecked = new Date(alert.last_checked);
        const intervalMs = getIntervalMs(alert.frequency);
        if (now.getTime() - lastChecked.getTime() < intervalMs) continue;
      }

      // Simulate alert checking based on type
      const result = await checkAlert(alert, supabase);

      // Update last_checked
      await supabase
        .from("alerts")
        .update({ last_checked: now.toISOString() })
        .eq("id", alert.id);

      if (result.triggered) {
        triggered++;

        // Update last_triggered
        await supabase
          .from("alerts")
          .update({ last_triggered: now.toISOString() })
          .eq("id", alert.id);

        // Create notification
        await supabase.from("alert_notifications").insert({
          alert_id: alert.id,
          user_id: alert.user_id,
          title: result.title,
          message: result.message,
          severity: result.severity || "info",
          metadata: result.metadata || {},
        });

        log("Alert triggered", { alertId: alert.id, type: alert.alert_type, title: result.title });
      }
    }

    log("Alert check complete", { checked: alerts.length, triggered });

    return new Response(
      JSON.stringify({ checked: alerts.length, triggered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function getIntervalMs(frequency: string): number {
  switch (frequency) {
    case "realtime": return 5 * 60 * 1000;        // 5 min
    case "hourly": return 60 * 60 * 1000;
    case "daily": return 24 * 60 * 60 * 1000;
    case "weekly": return 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

interface AlertCheckResult {
  triggered: boolean;
  title: string;
  message: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}

async function checkAlert(alert: any, supabase: any): Promise<AlertCheckResult> {
  const subjectName = alert.subjects?.name || "Unknown subject";

  switch (alert.alert_type) {
    case "domain_registration": {
      // Check for new artifacts of type 'domain' added since last check
      const since = alert.last_checked || alert.created_at;
      const { data: newArtifacts } = await supabase
        .from("artifacts")
        .select("id, data, created_at")
        .eq("case_id", alert.subjects?.case_id)
        .eq("artifact_type", "domain")
        .gt("created_at", since)
        .limit(5);

      if (newArtifacts && newArtifacts.length > 0) {
        return {
          triggered: true,
          title: `New domain activity for "${subjectName}"`,
          message: `${newArtifacts.length} new domain artifact(s) detected since last check.`,
          severity: "warning",
          metadata: { artifact_count: newArtifacts.length },
        };
      }
      return { triggered: false, title: "", message: "" };
    }

    case "username_appearance": {
      const since = alert.last_checked || alert.created_at;
      const { data: newResults } = await supabase
        .from("tool_results")
        .select("id, tool_name, created_at")
        .eq("case_id", alert.subjects?.case_id)
        .gt("created_at", since)
        .limit(5);

      if (newResults && newResults.length > 0) {
        return {
          triggered: true,
          title: `New username findings for "${subjectName}"`,
          message: `${newResults.length} new tool result(s) found with potential username matches.`,
          severity: "info",
          metadata: { result_count: newResults.length },
        };
      }
      return { triggered: false, title: "", message: "" };
    }

    case "data_change": {
      const since = alert.last_checked || alert.created_at;
      const { data: newArtifacts } = await supabase
        .from("artifacts")
        .select("id, artifact_type, created_at")
        .eq("case_id", alert.subjects?.case_id)
        .gt("created_at", since)
        .limit(10);

      const { data: newEvents } = await supabase
        .from("events")
        .select("id, event_type, created_at")
        .eq("case_id", alert.subjects?.case_id)
        .gt("created_at", since)
        .limit(10);

      const totalChanges = (newArtifacts?.length || 0) + (newEvents?.length || 0);

      if (totalChanges > 0) {
        return {
          triggered: true,
          title: `Data changes detected for "${subjectName}"`,
          message: `${totalChanges} new data point(s): ${newArtifacts?.length || 0} artifacts, ${newEvents?.length || 0} events.`,
          severity: totalChanges > 5 ? "warning" : "info",
          metadata: { artifacts: newArtifacts?.length || 0, events: newEvents?.length || 0 },
        };
      }
      return { triggered: false, title: "", message: "" };
    }

    case "breach_detection": {
      // Deferred until breach-lookup change-detector lands (Pass 2).
      // Lottery-based fake alert removed; honest no-op until real diffing is wired.
      return {
        triggered: false,
        title: "",
        message: "",
        metadata: { status: "deferred_until_breach_lookup_lands" },
      };
    }

    case "mention_monitoring": {
      const since = alert.last_checked || alert.created_at;
      const { data: newEntities } = await supabase
        .from("entities")
        .select("id, label, entity_type")
        .eq("case_id", alert.subjects?.case_id)
        .gt("created_at", since)
        .limit(5);

      if (newEntities && newEntities.length > 0) {
        return {
          triggered: true,
          title: `New mentions related to "${subjectName}"`,
          message: `${newEntities.length} new entity reference(s) discovered.`,
          severity: "info",
          metadata: { entity_count: newEntities.length },
        };
      }
      return { triggered: false, title: "", message: "" };
    }

    default:
      return { triggered: false, title: "", message: "" };
  }
}
