import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileSearchResult } from "@/lib/publicProfiles";
import { ExternalLink } from "lucide-react";

export function PublicProfileEvidence({ personaId }: { personaId: string | null }) {
  const { user } = useAuth();
  const { data, error, isLoading } = useQuery<ProfileSearchResult | null>({
    queryKey: ["persona_public_profiles", personaId, user?.id], enabled: !!personaId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tool_results").select("id,result_data,created_at").eq("user_id", user!.id).eq("tool_name", "public-profile-search").contains("result_data", { persona_id: personaId }).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      // React Query requires a defined result, including when no lookup is saved.
      return (data?.[0]?.result_data ?? null) as unknown as ProfileSearchResult | null;
    },
  });
  if (!personaId) return null;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading profile evidence…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Profile evidence could not be loaded: {error.message}</p>;
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="font-semibold">Retrieved public profiles</h2>
    <p className="text-xs text-muted-foreground">Public account records and explicitly requested provider matches. Matching handles do not prove common ownership. Contact fields appear only when a source returns them.</p>
    {!data ? <p className="text-sm text-muted-foreground">This saved persona has no live profile lookup. Run Discovery with an exact username to retrieve public records.</p> : <>
      <p className="text-xs text-muted-foreground">Retrieved {new Date(data.retrievedAt).toLocaleString()}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.profiles.map(profile => <article key={profile.profileUrl} className="rounded border border-border bg-secondary/20 p-3 space-y-2 min-w-0">
        <a className="text-primary font-semibold flex items-center gap-2 break-all" href={profile.profileUrl} target="_blank" rel="noopener noreferrer">{profile.platform}: @{profile.username}<ExternalLink className="w-3 h-3 shrink-0" /></a>
        {profile.displayName && <p className="text-sm">{profile.displayName}</p>}
        {profile.evidenceKind === "provider_match" && <p className="text-xs text-muted-foreground">People Data Labs match; account ownership has not been independently verified.</p>}
        {profile.bio && <p className="text-xs whitespace-pre-wrap break-words">{profile.bio}</p>}
        <dl className="text-xs space-y-1">{Object.entries({ Location: profile.location, Email: profile.email, Phone: profile.phone, Followers: profile.followers, "Account created": profile.accountCreatedAt, Website: profile.website }).filter(([,value]) => value !== undefined).map(([label,value]) => <div key={label} className="break-all"><dt className="inline text-muted-foreground">{label}: </dt><dd className="inline">{String(value)}</dd></div>)}</dl>
        <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary underline break-all">Source record</a>
        {profile.relatedProfiles?.map(link => <p key={link.profileUrl} className="text-xs"><a href={link.profileUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{link.platform}: @{link.username}</a> — {link.evidence}</p>)}
      </article>)}</div>
      {data.profiles.length === 0 && <p className="text-sm">No account records were returned by the checked providers.</p>}
      {data.enrichment && <div className="text-sm space-y-1"><h3 className="font-semibold">People Data Labs source record</h3>{Object.entries(data.enrichment).filter(([key]) => ["full_name","job_title","job_company_name","location_name","work_email","personal_emails","mobile_phone","phone_numbers","likelihood"].includes(key)).filter(([,value]) => value !== undefined && value !== null).map(([key,value]) => <p key={key} className="break-all"><span className="text-muted-foreground">{key.replace(/_/g," ")}: </span>{Array.isArray(value) ? value.join(", ") : String(value)}</p>)}<p className="text-xs text-muted-foreground">Provider-reported match likelihood; contact ownership is unverified. Review the source before linking identities.</p></div>}
      <div className="flex flex-wrap gap-2 text-xs">{data.checks.map(check => <span key={check.platform} title={check.reason} className="rounded border px-2 py-1">{check.platform}: {check.status.replace(/_/g, " ")}{check.reason ? ` — ${check.reason}` : ""}</span>)}</div>
    </>}
  </section>;
}
