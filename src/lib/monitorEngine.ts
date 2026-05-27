import { supabase } from "@/integrations/supabase/client";

export const MONITOR_TYPES = [
  { value: "domain_registration", label: "Domain Registration", description: "New domains linked to this entity" },
  { value: "social_account", label: "Social Account", description: "New social profiles discovered" },
  { value: "breach_appearance", label: "Breach Appearance", description: "Entity appears in new data breaches" },
  { value: "infrastructure_change", label: "Infrastructure Change", description: "Hosting/DNS/IP changes detected" },
  { value: "username_activity", label: "Username Activity", description: "New username appearances found" },
] as const;

export const MONITOR_FREQUENCIES = [
  { value: "realtime", label: "Real-time", description: "Check every 5 minutes" },
  { value: "hourly", label: "Hourly", description: "Check every hour" },
  { value: "daily", label: "Daily", description: "Check once per day" },
  { value: "weekly", label: "Weekly", description: "Check once per week" },
] as const;

/**
 * Run a check for a specific monitor — looks for new data since last check
 */
export async function checkMonitor(
  monitorId: string,
  entityId: string,
  monitorType: string,
  lastChecked: string | null,
  userId: string,
): Promise<{ changed: boolean; message: string }> {
  const since = lastChecked ?? new Date(Date.now() - 7 * 86400000).toISOString();

  switch (monitorType) {
    case "domain_registration": {
      const { data } = await supabase
        .from("infrastructure_links")
        .select("id")
        .eq("entity_id", entityId)
        .eq("infrastructure_type", "domain")
        .gt("created_at", since);
      if (data && data.length > 0)
        return { changed: true, message: `${data.length} new domain(s) detected` };
      return { changed: false, message: "No new domains" };
    }

    case "social_account": {
      const { data } = await supabase
        .from("identity_entity_links")
        .select("id")
        .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`)
        .eq("relationship_type", "social_profile")
        .gt("created_at", since);
      if (data && data.length > 0)
        return { changed: true, message: `${data.length} new social account(s) found` };
      return { changed: false, message: "No new social accounts" };
    }

    case "breach_appearance": {
      const { data } = await supabase
        .from("breach_records")
        .select("id")
        .eq("entity_id", entityId)
        .gt("created_at", since);
      if (data && data.length > 0)
        return { changed: true, message: `${data.length} new breach record(s) found` };
      return { changed: false, message: "No new breaches" };
    }

    case "infrastructure_change": {
      const { data } = await supabase
        .from("infrastructure_links")
        .select("id")
        .eq("entity_id", entityId)
        .gt("created_at", since);
      if (data && data.length > 0)
        return { changed: true, message: `${data.length} infrastructure change(s) detected` };
      return { changed: false, message: "No infrastructure changes" };
    }

    case "username_activity": {
      const { data } = await supabase
        .from("entity_observations")
        .select("id")
        .eq("entity_id", entityId)
        .gt("created_at", since);
      if (data && data.length > 0)
        return { changed: true, message: `${data.length} new observation(s) recorded` };
      return { changed: false, message: "No new activity" };
    }

    default:
      return { changed: false, message: "Unknown monitor type" };
  }
}

/**
 * Run all monitors for the current user and create notifications for triggered ones
 */
export async function runAllMonitors(userId: string) {
  const { data: monitors, error } = await supabase
    .from("entity_monitors")
    .select("*, entity:identity_entities!entity_monitors_entity_id_fkey(entity_type, entity_value)")
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error || !monitors) return { checked: 0, triggered: 0 };

  let triggered = 0;
  const now = new Date().toISOString();

  for (const monitor of monitors) {
    const result = await checkMonitor(
      monitor.id,
      monitor.entity_id,
      monitor.monitor_type,
      monitor.last_checked,
      userId,
    );

    // Update last_checked
    await supabase
      .from("entity_monitors")
      .update({ last_checked: now })
      .eq("id", monitor.id);

    if (result.changed) {
      triggered++;
      await supabase
        .from("entity_monitors")
        .update({ last_triggered: now })
        .eq("id", monitor.id);

      // Add timeline event
      await supabase.from("entity_timeline").insert({
        entity_id: monitor.entity_id,
        event_type: `monitor_${monitor.monitor_type}`,
        description: result.message,
        source: "monitor_engine",
        user_id: userId,
      });
    }
  }

  return { checked: monitors.length, triggered };
}
