import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileSearchResult, PublicProfile } from "@/lib/publicProfiles";
import { saveProfileAssociationReview, type AssociationDecision } from "@/lib/profileAssociationReview";
import { validateLookup } from "@/lib/publicProfileEvidence";
import { ExternalLink } from "lucide-react";

type SavedLookup = ProfileSearchResult & { lookup_result_id?: string; source_contract_valid?: boolean };
type Review = { account_id: string; profile_url: string; decision: AssociationDecision; supporting_source_url: string; reason: string; reviewed_at: string };
const safeLink = (value?: string) => { try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };

function AssociationReview({ profile, lookupId, personaId, userId, review }: { profile: PublicProfile; lookupId?: string; personaId: string; userId: string; review?: Review }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<AssociationDecision>(review?.decision || "unreviewed");
  const [source, setSource] = useState(review?.supporting_source_url || "");
  const [reason, setReason] = useState(review?.reason || "");
  const mutation = useMutation({
    mutationFn: () => saveProfileAssociationReview(userId, { personaId, lookupResultId: lookupId || "", accountId: profile.accountId || "", profileUrl: profile.profileUrl, decision, supportingSourceUrl: source, reason }),
    onSuccess: () => { void queryClient.invalidateQueries(); },
  });
  return <div className="border-t pt-2 space-y-2">
    <p className="text-xs font-semibold">Person association: {review?.decision === "supported" ? "Analyst-supported; not independently verified" : review?.decision === "rejected" ? "Rejected" : "Unreviewed"}</p>
    {review && <p className="text-xs break-words">Review: {review.reason}</p>}
    {review?.supporting_source_url && safeLink(review.supporting_source_url) && <a className="text-xs underline text-primary break-all" href={safeLink(review.supporting_source_url)} target="_blank" rel="noopener noreferrer">Analyst-supplied supporting source</a>}
    {!lookupId || !profile.accountId ? <p className="text-xs text-muted-foreground">This historical lookup lacks a stable account identity. Retrieve it again before recording an association.</p> : <details className="text-xs space-y-2"><summary className="cursor-pointer">Review this association</summary>
      <p>Explain the concrete bridge between this account and the person. A matching name, handle or photo is not enough. An account link establishes a link, not common ownership.</p>
      <label className="block">Decision<select aria-label={`Association decision for ${profile.platform}`} className="block w-full border rounded bg-background p-1" value={decision} onChange={e => setDecision(e.target.value as AssociationDecision)}><option value="unreviewed">Unreviewed / insufficient evidence</option><option value="supported">Supported by cited evidence</option><option value="rejected">Rejected / contradicted</option></select></label>
      <label className="block">Supporting public source URL<input aria-label={`Supporting source for ${profile.platform}`} className="block w-full border rounded bg-background p-1" value={source} onChange={e => setSource(e.target.value)} placeholder="https://…" /></label>
      <label className="block">Evidence, alternatives and limitations<textarea aria-label={`Review reason for ${profile.platform}`} className="block w-full border rounded bg-background p-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></label>
      <button className="border rounded px-3 py-1" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Saving review…" : "Save review"}</button>
      {mutation.error && <p role="alert" className="text-destructive">Review was not saved: {mutation.error.message}</p>}
      {mutation.isSuccess && <p role="status">Review saved. It remains an analyst assessment, not independent identity verification.</p>}
    </details>}
  </div>;
}

export function PublicProfileEvidence({ personaId }: { personaId: string | null }) {
  const { user } = useAuth();
  const { data, error, isLoading } = useQuery<SavedLookup | null>({
    queryKey: ["persona_public_profiles", personaId, user?.id], enabled: !!personaId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tool_results").select("id,result_data,created_at").eq("user_id", user!.id).eq("tool_name", "public-profile-search").contains("result_data", { persona_id: personaId }).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      // React Query requires a defined result, including when no lookup is saved.
      const row = data?.[0];
      if (!row?.result_data) return null;
      const result = row.result_data as unknown as SavedLookup;
      if (!Array.isArray(result.profiles) || !Array.isArray(result.checks)) throw new Error("Saved lookup is malformed; account evidence cannot be established.");
      if (result.profiles.some(profile => !profile || typeof profile.username !== "string" || typeof profile.platform !== "string" || !safeLink(profile.profileUrl) || !safeLink(profile.sourceUrl))) throw new Error("Saved lookup contains invalid source records; account evidence cannot be established.");
      if (result.profiles.some(profile => [profile.displayName, profile.bio, profile.accountId].some(value => value !== undefined && typeof value !== "string") || (profile.relatedProfiles !== undefined && (!Array.isArray(profile.relatedProfiles) || profile.relatedProfiles.some(link => !link || [link.platform, link.username, link.profileUrl, link.evidence].some(value => typeof value !== "string")))))) throw new Error("Saved lookup contains malformed account metadata; retrieve a fresh source record.");
      if (result.checks.some(check => !check || typeof check.platform !== "string" || typeof check.sourceUrl !== "string" || !["found", "not_found", "unavailable"].includes(check.status))) throw new Error("Saved lookup contains invalid source checks.");
      if (result.schemaVersion === 2) validateLookup(result);
      return { ...result, lookup_result_id: row.id, source_contract_valid: result.schemaVersion === 2 };
    },
  });
  const reviews = useQuery({
    queryKey: ["persona_public_reviews", personaId, user?.id], enabled: !!personaId && !!user && !!data,
    queryFn: async () => {
      const { data, error } = await supabase.from("tool_results").select("id,result_data,created_at").eq("user_id", user!.id).eq("tool_name", "profile-association-review").contains("result_data", { persona_id: personaId }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const latest = new Map<string, Review>();
      for (const row of data || []) {
        const review = row.result_data as unknown as Review;
        if (!review || !["supported", "rejected", "unreviewed"].includes(review.decision) || typeof review.account_id !== "string" || typeof review.profile_url !== "string" || typeof review.reason !== "string" || typeof review.reviewed_at !== "string") continue;
        const key = review.account_id;
        if (!latest.has(key)) latest.set(key, review);
      }
      return latest;
    },
  });
  if (!personaId) return null;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading profile evidence…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Profile evidence could not be loaded: {error.message}</p>;
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-semibold">2. Observed accounts and association review</h2>
    <p className="text-xs text-muted-foreground">Public account records and explicitly requested provider matches. Matching handles do not prove common ownership. Contact fields appear only when a source returns them.</p>
    {!data ? <p className="text-sm text-muted-foreground">This saved persona has no live profile lookup. Run Discovery with an exact username to retrieve public records.</p> : <>
      <p className="text-xs text-muted-foreground">Retrieved {new Date(data.retrievedAt).toLocaleString()}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.profiles.map(profile => <article key={profile.profileUrl} className="rounded border border-border bg-secondary/20 p-3 space-y-2 min-w-0">
        <a className="text-primary font-semibold flex items-center gap-2 break-all" href={safeLink(profile.profileUrl)} target="_blank" rel="noopener noreferrer">{profile.platform}: @{profile.username}<ExternalLink className="w-3 h-3 shrink-0" /></a>
        <p className="text-xs text-muted-foreground">{data.source_contract_valid ? "Account record observed. This does not establish who owns it." : "Historical account claim; retrieve a fresh source record before establishing account existence or association."}</p>
        {profile.accountId && <p className="text-xs break-all">Stable account ID: {profile.accountId}</p>}
        {profile.displayName && <p className="text-sm">{profile.displayName}</p>}
        {profile.evidenceKind === "provider_match" && <p className="text-xs text-muted-foreground">People Data Labs match; account ownership has not been independently verified.</p>}
        {profile.bio && <p className="text-xs whitespace-pre-wrap break-words">{profile.bio}</p>}
        <dl className="text-xs space-y-1">{Object.entries({ Location: profile.location, Email: profile.email, Phone: profile.phone, Followers: profile.followers, "Account created": profile.accountCreatedAt, Website: profile.website }).filter(([,value]) => value !== undefined).map(([label,value]) => <div key={label} className="break-all"><dt className="inline text-muted-foreground">{label}: </dt><dd className="inline">{String(value)}</dd></div>)}</dl>
        <a href={safeLink(profile.sourceUrl)} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary underline break-all">Source record</a>
        {profile.relatedProfiles?.filter(link => safeLink(link.profileUrl)).map(link => <p key={link.profileUrl} className="text-xs"><a href={safeLink(link.profileUrl)} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{link.platform}: @{link.username}</a> - {link.evidence} <span className="text-muted-foreground">Observed outbound link; person ownership unverified.</span></p>)}
        {reviews.error ? <p role="alert" className="text-xs text-destructive">Association reviews could not be loaded: {reviews.error.message}</p> : reviews.isLoading ? <p className="text-xs">Loading association reviews…</p> : user && <AssociationReview key={`${profile.accountId}:${reviews.data?.get(profile.accountId || "")?.reviewed_at || "none"}`} profile={profile} lookupId={data.source_contract_valid ? data.lookup_result_id : undefined} personaId={personaId} userId={user.id} review={reviews.data?.get(profile.accountId || "")} />}
      </article>)}</div>
      {data.profiles.length === 0 && <p className="text-sm">No account records were returned by the checked providers.</p>}
      {data.enrichment && <div className="text-sm space-y-1"><h3 className="font-semibold">People Data Labs source record</h3>{Object.entries(data.enrichment).filter(([key]) => ["full_name","job_title","job_company_name","location_name","work_email","personal_emails","mobile_phone","phone_numbers","likelihood"].includes(key)).filter(([,value]) => value !== undefined && value !== null).map(([key,value]) => <p key={key} className="break-all"><span className="text-muted-foreground">{key.replace(/_/g," ")}: </span>{Array.isArray(value) ? value.join(", ") : String(value)}</p>)}<p className="text-xs text-muted-foreground">Provider-reported match likelihood; contact ownership is unverified. Review the source before linking identities.</p></div>}
      <div className="flex flex-wrap gap-2 text-xs">{data.checks.map(check => <span key={`${check.platform}:${check.sourceUrl}`} title={check.reason} className="rounded border px-2 py-1">{check.platform}: {check.status.replace(/_/g, " ")}{check.reason ? ` - ${check.reason}` : ""}</span>)}</div>
    </>}
  </section>;
}
