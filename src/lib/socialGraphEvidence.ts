import { filterCurrentIdentityEntities, type SavedIdentityRecord } from "./identityEvidence";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Edge = { source?: unknown; target?: unknown; relationship_type: string; metadata?: unknown };

/** Exclude unsupported endpoints and never reinterpret old pattern edges as verified relationships. */
export function visibleSocialGraphEdges<T extends Edge>(edges: T[], records: SavedIdentityRecord[]) {
  const reviewedEndpoint = (value: unknown) => {
    const row = object(value);
    return filterCurrentIdentityEntities([{ metadata: row.metadata, entity_type: row.entity_type, entity_value: row.entity_value }], records).length === 1;
  };
  return edges.filter(edge => reviewedEndpoint(edge.source) && reviewedEndpoint(edge.target)).map(edge => {
    const source = object(object(object(edge.source).metadata).identity_evidence);
    const target = object(object(object(edge.target).metadata).identity_evidence);
    const reviewed = edge.relationship_type === "analyst_supported_association"
      && object(edge.metadata).assessment === "analyst_supported_association"
      && source.persona_id === target.persona_id;
    return { ...edge,
      assessment: reviewed ? "reviewed_association" as const : "unverified_lead" as const,
      relationship_type: reviewed ? "analyst_supported_association" : edge.relationship_type === "co_appearance" ? "co_appearance_lead" : "unverified_association_lead",
    };
  });
}
