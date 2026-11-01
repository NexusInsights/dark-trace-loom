/** Normalized records validated by the portable evidence core before entering the UI. */
export type EvidenceScalar = string | number | boolean | null;
export interface EvidenceSource {
  id: string; label: string; url: string | null; provider: string | null; publisher: string | null;
  independenceGroup: string | null; independence: 'unknown' | 'independent' | 'shared_origin';
}
export interface EvidenceEntity {
  id: string; type: string; label: string; identifiers: Array<{ type: string; value: string }>;
}
export interface EvidenceEventTime { value: string; precision: 'day' | 'timestamp' }
export interface EvidenceObservation {
  id: string; sourceId: string; entityId: string; property: string; value: EvidenceScalar;
  eventTime: EvidenceEventTime | null; capturedAt: string; artifactId: string | null;
}
export interface EvidenceClaim {
  id: string; subjectId: string; predicate: string; objectId: string | null; value: EvidenceScalar;
  evidenceIds: string[]; counterEvidenceIds: string[]; status: 'unreviewed' | 'accepted' | 'rejected' | 'needs_review';
}
interface EvidenceReviewBase {
  id: string; reason: string; evidenceIds: string[]; counterEvidenceIds: string[]; actor: string; at: string;
}
export interface EvidenceClaimReview extends EvidenceReviewBase {
  kind: 'claim'; claimId: string; decision: 'accepted' | 'rejected' | 'needs_review';
}
export interface EvidenceMatchReview extends EvidenceReviewBase {
  kind: 'match'; leftId: string; rightId: string; decision: 'accepted' | 'rejected' | 'revoked';
}
export interface EvidenceManifest {
  schema: string; algorithm: string; actor: string; capturedAt: string; sourceUrl: string | null; digest: string;
  files: Array<{ path: string; sha256: string; size: number; mediaType: string; sourceUrl: string | null; capturedAt: string }>;
}
export interface EvidenceLedger {
  schema: string; schemaVersion: number; caseId: string; title: string; createdAt: string;
  sources: EvidenceSource[]; entities: EvidenceEntity[]; observations: EvidenceObservation[]; claims: EvidenceClaim[];
  reviews: Array<EvidenceClaimReview | EvidenceMatchReview>; artifacts: Array<{ id: string; manifest: EvidenceManifest }>;
  audit: Array<{ id: string; sequence: number; action: string; actor: string; at: string; details: Record<string, unknown>; snapshotDigest: string; previousDigest: string | null; digest: string }>;
}
export interface EvidenceGraph {
  nodes: Array<{ id: string; recordId: string; kind: 'entity' | 'claim' | 'observation' | 'source'; type: string; label: string; reviewStatus?: string }>;
  edges: Array<{ id: string; source: string; target: string; type: string; kind: string; reviewStatus?: string; evidenceIds?: string[]; counterEvidenceIds?: string[] }>;
  totalNodes: number; totalEdges: number; omittedNodes: number; omittedEdges: number; truncated: boolean;
}
export interface EvidenceTimeline {
  entries: Array<EvidenceObservation & { eventTime: EvidenceEventTime; entity: EvidenceEntity; source: EvidenceSource }>;
  undatedIds: string[]; totalDated: number; omitted: number; note: string;
}
export interface EvidenceConflict { entityId: string; property: string; observations: EvidenceObservation[]; note: string }
export interface EvidenceVerification {
  ok: boolean; manifestDigestValid: boolean; checkpointMatches: boolean | null; missing: string[]; unexpected: string[];
  files: Array<{ path: string; ok: boolean; reason: string | null }>; authenticity: string;
}
