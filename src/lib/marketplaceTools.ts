import { allTools } from "@/components/tools/toolDefinitions";
import type { Tables } from "@/integrations/supabase/types";

export type MarketplaceTool = Tables<"tool_marketplace">;

// These point to existing implementations, whose actual scope is displayed at launch.
// Never turn arbitrary catalog config or an advertised description into executable code.
const aliases: Record<string, string> = {
  "email-header": "email-header-analysis",
  "phone-intel": "phone-lookup",
  "email-breach-checker": "breach-lookup",
};
export function marketplaceImplementation(tool: Pick<MarketplaceTool, "slug">) {
  return allTools.find(builtin => builtin.id === (aliases[tool.slug] || tool.slug));
}

export function marketplaceUnavailableReason(slug: string): string {
  const reasons: Record<string, string> = {
    "facial-recognition": "No face-to-person identity service is connected. Image metadata or provenance cannot identify an unknown person and is not substituted for facial identification.",
    "voice-profiler": "No speaker identity service is connected. Transcription or audio metadata cannot establish a speaker's identity and is not substituted for voice identification.",
    "voice-print": "No speaker identity service is connected. Transcription or audio metadata cannot establish a speaker's identity and is not substituted for voice identification.",
    "voice-recognition": "No speaker identity service is connected. Transcription or audio metadata cannot establish a speaker's identity.",
    "geofence-alert": "Geofence alerts require an authorized position feed, stored geofences, a persistent event worker and a delivery channel. Those components are not connected; a one-time location calculation would not provide continuing alerts.",
    "port-scanner-pro": "Active port scanning requires a supported TCP execution worker and an explicitly authorized target allowlist. Passive Shodan data is not substituted for a scan.",
  };
  return reasons[slug] || "No executable provider or input-analysis handler is connected for this operation. The catalog description does not establish an integration.";
}
