import { useState, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePersonas, usePersonaIdentifiers } from "@/hooks/usePersonas";
import { useUsernameCandidates } from "@/hooks/useUsernameCandidates";
import { useEmailCandidates } from "@/hooks/useEmailCandidates";
import { useIdentityEntities, useIdentityLinks, useEntityScores } from "@/hooks/useIdentityResolution";
import { useIdentityClusters, useClusterMembers } from "@/hooks/useIdentityClusters";
import { useSimilarityScores } from "@/hooks/useSimilarityScores";
import { usePersonaEvents, useBuildPersonaTimeline } from "@/hooks/usePersonaEvents";
import { usePlatformAccounts, useMapPlatformAccounts } from "@/hooks/usePlatformAccounts";
import { GlassPanel } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  User, AtSign, Mail, Globe, Phone, Server, Link2, Shield, TrendingUp,
  Clock, Network, Fingerprint, ChevronRight, AlertTriangle, Activity,
  ArrowLeft, Share2, GitCompare, Loader2, Play, Monitor, MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const TYPE_ICONS: Record<string, typeof Mail> = {
  username: AtSign, email: Mail, domain: Globe, ip: Server,
  phone: Phone, social_profile: Share2, name: User,
};

const TYPE_COLORS: Record<string, string> = {
  username: "hsl(35, 85%, 55%)", email: "hsl(270, 60%, 58%)",
  domain: "hsl(160, 60%, 45%)", ip: "hsl(0, 72%, 51%)",
  phone: "hsl(200, 70%, 50%)", social_profile: "hsl(320, 60%, 55%)",
};

function usePersonaProfile(personaId: string | null) {
  const { user } = useAuth();
  const { data: identifiers = [] } = usePersonaIdentifiers(personaId);
  const { data: usernames = [] } = useUsernameCandidates(personaId);
  const { data: emails = [] } = useEmailCandidates(personaId);

  // Get linked entities by matching identifier values
  const { data: allEntities = [] } = useIdentityEntities();
  const { data: allScores = [] } = useEntityScores();
  const { data: allClusters = [] } = useIdentityClusters();
  const { data: similarityScores = [] } = useSimilarityScores();

  // Fetch entity timeline for matched entities
  const matchedEntities = useMemo(() => {
    if (!identifiers.length && !usernames.length && !emails.length) return [];
    const values = new Set<string>();
    identifiers.forEach((i: any) => values.add(i.identifier_value?.toLowerCase()));
    usernames.forEach((u: any) => values.add(u.candidate_username?.toLowerCase()));
    emails.forEach((e: any) => values.add(e.candidate_email?.toLowerCase()));
    return allEntities.filter((e) => values.has(e.entity_value?.toLowerCase()));
  }, [identifiers, usernames, emails, allEntities]);

  const entityIds = useMemo(() => new Set(matchedEntities.map((e) => e.id)), [matchedEntities]);

  // Scores for matched entities
  const scores = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of allScores as any[]) {
      if (entityIds.has(s.entity_id)) map.set(s.entity_id, s);
    }
    return map;
  }, [allScores, entityIds]);

  // Aggregate risk score
  const riskScore = useMemo(() => {
    if (scores.size === 0) return 0;
    let total = 0;
    scores.forEach((s) => { total += Number(s.score); });
    return Math.round(total / scores.size);
  }, [scores]);

  // Clusters containing matched entities
  const relatedClusters = useMemo(() => {
    return allClusters.filter((c: any) => {
      // We'll check cluster members separately
      return true;
    });
  }, [allClusters]);

  // Similarity pairs involving matched entities
  const relatedSimilarity = useMemo(() => {
    return similarityScores.filter((s: any) =>
      entityIds.has(s.entity_a) || entityIds.has(s.entity_b)
    );
  }, [similarityScores, entityIds]);

  // Fetch observations and timeline for matched entities
  const matchedEntityIdList = useMemo(() => [...entityIds], [entityIds]);

  const { data: observations = [] } = useQuery({
    queryKey: ["persona_observations", matchedEntityIdList],
    enabled: matchedEntityIdList.length > 0,
    queryFn: async () => {
      if (!user || matchedEntityIdList.length === 0) return [];
      const { data } = await supabase
        .from("entity_observations")
        .select("*")
        .in("entity_id", matchedEntityIdList.slice(0, 50))
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ["persona_timeline", matchedEntityIdList],
    enabled: matchedEntityIdList.length > 0,
    queryFn: async () => {
      if (!user || matchedEntityIdList.length === 0) return [];
      const { data } = await supabase
        .from("entity_timeline")
        .select("*")
        .in("entity_id", matchedEntityIdList.slice(0, 50))
        .eq("user_id", user.id)
        .order("event_timestamp", { ascending: false });
      return data ?? [];
    },
  });

  const { data: infraLinks = [] } = useQuery({
    queryKey: ["persona_infra", matchedEntityIdList],
    enabled: matchedEntityIdList.length > 0,
    queryFn: async () => {
      if (!user || matchedEntityIdList.length === 0) return [];
      const { data } = await supabase
        .from("infrastructure_links")
        .select("*")
        .in("entity_id", matchedEntityIdList.slice(0, 50))
        .eq("user_id", user.id);
      return data ?? [];
    },
  });

  const { data: breaches = [] } = useQuery({
    queryKey: ["persona_breaches", matchedEntityIdList],
    enabled: matchedEntityIdList.length > 0,
    queryFn: async () => {
      if (!user || matchedEntityIdList.length === 0) return [];
      const { data } = await supabase
        .from("breach_records")
        .select("*")
        .in("entity_id", matchedEntityIdList.slice(0, 50))
        .eq("user_id", user.id);
      return data ?? [];
    },
  });

  // Linked investigations (cases from observations)
  const linkedCaseIds = useMemo(() => {
    const ids = new Set<string>();
    observations.forEach((o: any) => { if (o.case_id) ids.add(o.case_id); });
    return [...ids];
  }, [observations]);

  const { data: linkedCases = [] } = useQuery({
    queryKey: ["persona_cases", linkedCaseIds],
    enabled: linkedCaseIds.length > 0,
    queryFn: async () => {
      if (linkedCaseIds.length === 0) return [];
      const { data } = await supabase
        .from("cases")
        .select("id, title, created_at")
        .in("id", linkedCaseIds);
      return data ?? [];
    },
  });

  return {
    identifiers, usernames, emails, matchedEntities, scores, riskScore,
    relatedClusters, relatedSimilarity, observations, timeline, infraLinks,
    breaches, linkedCases,
  };
}

export default function PersonaProfile() {
  const [searchParams] = useSearchParams();
  const personaId = searchParams.get("id");
  const { data: personas = [] } = usePersonas();
  const [selectedId, setSelectedId] = useState<string | null>(personaId);

  const activePersona = personas.find((p: any) => p.id === selectedId);
  const profile = usePersonaProfile(selectedId);
  const { data: personaEvents = [] } = usePersonaEvents(selectedId);
  const { mutate: buildTimeline, isPending: buildingTimeline, progress: timelineProgress } = useBuildPersonaTimeline();
  const { data: platformAccounts = [] } = usePlatformAccounts(selectedId);
  const { mutate: mapPlatforms, isPending: mappingPlatforms } = useMapPlatformAccounts();

  const riskColor = profile.riskScore >= 60 ? "text-destructive" : profile.riskScore >= 30 ? "text-yellow-500" : "text-green-400";

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in space-y-6">
      <div>
        <span className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">Intelligence</span>
        <h1 className="text-2xl font-display font-bold tracking-tight mt-1">Persona Profile Builder</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aggregated view of all identifiers, infrastructure, timeline, and risk for a persona.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Persona Selector */}
        <div className="lg:col-span-1">
          <GlassPanel className="p-4" neonLine="left">
            <h3 className="font-mono text-[10px] tracking-widest text-primary mb-3">SELECT PERSONA</h3>
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-1.5">
                {personas.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left p-3 rounded border transition-colors ${
                      selectedId === p.id
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-primary/40 bg-card/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-mono text-xs font-medium truncate">{p.persona_label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                    </div>
                    <span className="font-mono text-[9px] text-muted-foreground mt-1 block">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
                {personas.length === 0 && (
                  <p className="text-xs text-muted-foreground font-mono text-center py-8">
                    No personas found. Create one in Persona Discovery.
                  </p>
                )}
              </div>
            </ScrollArea>
          </GlassPanel>
        </div>

        {/* Profile Content */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedId ? (
            <GlassPanel className="p-12 text-center">
              <Fingerprint className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
              <p className="text-sm text-muted-foreground font-mono">Select a persona to view their aggregated profile</p>
            </GlassPanel>
          ) : (
            <>
              {/* Summary Header */}
              <GlassPanel className="p-5" neonLine="top">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-display font-bold">{activePersona?.persona_label ?? "Persona"}</h2>
                    {activePersona?.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{activePersona.notes}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[10px] tracking-widest text-muted-foreground mb-1">RISK SCORE</div>
                    <div className={`font-mono text-3xl font-bold ${riskColor}`}>
                      {profile.riskScore}
                    </div>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Identifiers", value: profile.identifiers.length, icon: Fingerprint },
                    { label: "Entities", value: profile.matchedEntities.length, icon: Network },
                    { label: "Breaches", value: profile.breaches.length, icon: AlertTriangle },
                    { label: "Infra Links", value: profile.infraLinks.length, icon: Server },
                    { label: "Timeline", value: personaEvents.length, icon: Clock },
                    { label: "Cases", value: profile.linkedCases.length, icon: Activity },
                  ].map((s) => (
                    <div key={s.label} className="text-center p-2 rounded bg-muted/30 border border-border/30">
                      <s.icon className="h-4 w-4 text-primary mx-auto mb-1" />
                      <div className="font-mono text-lg font-bold">{s.value}</div>
                      <div className="font-mono text-[8px] tracking-widest text-muted-foreground uppercase">{s.label}</div>
                    </div>
                  ))}
                </div>
              </GlassPanel>

              {/* Tabbed Content */}
              <Tabs defaultValue="identifiers" className="w-full">
                <TabsList className="grid w-full grid-cols-7 h-9">
                  <TabsTrigger value="identifiers" className="text-[10px] font-mono">IDENTIFIERS</TabsTrigger>
                  <TabsTrigger value="platforms" className="text-[10px] font-mono">PLATFORMS</TabsTrigger>
                  <TabsTrigger value="infrastructure" className="text-[10px] font-mono">INFRA</TabsTrigger>
                  <TabsTrigger value="timeline" className="text-[10px] font-mono">TIMELINE</TabsTrigger>
                  <TabsTrigger value="breaches" className="text-[10px] font-mono">BREACHES</TabsTrigger>
                  <TabsTrigger value="cases" className="text-[10px] font-mono">CASES</TabsTrigger>
                  <TabsTrigger value="similarity" className="text-[10px] font-mono">SIMILARITY</TabsTrigger>
                </TabsList>

                {/* Identifiers Tab */}
                <TabsContent value="identifiers">
                  <GlassPanel className="p-4">
                    <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
                      <Fingerprint className="h-3.5 w-3.5" /> ALL IDENTIFIERS
                    </h3>

                    {/* Persona identifiers */}
                    {profile.identifiers.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-mono text-[9px] tracking-widest text-muted-foreground mb-2">DISCOVERED IDENTIFIERS</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {profile.identifiers.map((id: any) => {
                            const Icon = TYPE_ICONS[id.identifier_type] ?? User;
                            return (
                              <div key={id.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 border border-border/30">
                                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: TYPE_COLORS[id.identifier_type] ?? "hsl(var(--muted-foreground))" }} />
                                <span className="font-mono text-xs truncate flex-1">{id.identifier_value}</span>
                                <Badge variant="outline" className="text-[8px] font-mono">{id.identifier_type}</Badge>
                                <span className="font-mono text-[9px] text-primary font-bold">{Math.round(id.confidence_score * 100)}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Username candidates */}
                    {profile.usernames.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-mono text-[9px] tracking-widest text-muted-foreground mb-2">USERNAME CANDIDATES ({profile.usernames.length})</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                          {profile.usernames.slice(0, 30).map((u: any) => (
                            <div key={u.id} className="flex items-center gap-1.5 p-1.5 rounded bg-muted/20 border border-border/20">
                              <AtSign className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="font-mono text-[10px] truncate flex-1">{u.candidate_username}</span>
                              <span className="font-mono text-[8px] text-primary">{Math.round(u.confidence_score * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Email candidates */}
                    {profile.emails.length > 0 && (
                      <div>
                        <h4 className="font-mono text-[9px] tracking-widest text-muted-foreground mb-2">EMAIL CANDIDATES ({profile.emails.length})</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                          {profile.emails.slice(0, 20).map((e: any) => (
                            <div key={e.id} className="flex items-center gap-1.5 p-1.5 rounded bg-muted/20 border border-border/20">
                              <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="font-mono text-[10px] truncate flex-1">{e.candidate_email}</span>
                              <span className="font-mono text-[8px] text-primary">{Math.round(e.confidence_score * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Matched global entities */}
                    {profile.matchedEntities.length > 0 && (
                      <div className="mt-4 border-t border-border/50 pt-3">
                        <h4 className="font-mono text-[9px] tracking-widest text-muted-foreground mb-2">MATCHED GLOBAL ENTITIES ({profile.matchedEntities.length})</h4>
                        <div className="space-y-1">
                          {profile.matchedEntities.map((e: any) => {
                            const Icon = TYPE_ICONS[e.entity_type] ?? User;
                            const s = profile.scores.get(e.id);
                            return (
                              <div key={e.id} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: TYPE_COLORS[e.entity_type] ?? "hsl(var(--muted-foreground))" }} />
                                <span className="font-mono text-xs truncate flex-1">{e.entity_value}</span>
                                <Badge variant="outline" className="text-[8px] font-mono">{e.entity_type}</Badge>
                                {s && (
                                  <span className={`font-mono text-[10px] font-bold ${Number(s.score) >= 60 ? "text-destructive" : Number(s.score) >= 30 ? "text-yellow-500" : "text-green-400"}`}>
                                    {Math.round(Number(s.score))}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {profile.identifiers.length === 0 && profile.usernames.length === 0 && profile.emails.length === 0 && (
                      <p className="text-xs text-muted-foreground font-mono text-center py-6">No identifiers discovered yet</p>
                    )}
                  </GlassPanel>
                </TabsContent>

                {/* Platforms Tab */}
                <TabsContent value="platforms">
                  <GlassPanel className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-mono text-xs tracking-widest text-primary flex items-center gap-2">
                        <Monitor className="h-3.5 w-3.5" /> PLATFORM ACCOUNTS ({platformAccounts.length})
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-7 text-[10px] font-mono"
                        disabled={mappingPlatforms || !selectedId}
                        onClick={() => {
                          if (selectedId) mapPlatforms(selectedId, {
                            onSuccess: (r) => toast.success(`Mapped ${r.mapped} platform accounts`),
                            onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
                          });
                        }}
                      >
                        {mappingPlatforms ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                        {mappingPlatforms ? "MAPPING..." : "MAP PLATFORMS"}
                      </Button>
                    </div>
                    {platformAccounts.length > 0 ? (
                      <div className="space-y-4">
                        {["social_media", "developer", "forums", "email_services", "domains", "other"].map((cat) => {
                          const catAccounts = platformAccounts.filter((a: any) => a.platform_category === cat);
                          if (catAccounts.length === 0) return null;
                          const catLabel = cat.replace(/_/g, " ").toUpperCase();
                          return (
                            <div key={cat}>
                              <h4 className="font-mono text-[9px] tracking-widest text-muted-foreground mb-2">{catLabel}</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {catAccounts.map((a: any) => (
                                  <div key={a.id} className="flex items-center gap-3 p-2.5 rounded bg-muted/30 border border-border/30">
                                    <Monitor className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-mono text-xs truncate">{a.account_identifier}</div>
                                      <div className="font-mono text-[9px] text-muted-foreground">{a.platform_name}</div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {a.verified && <Badge variant="default" className="text-[7px] font-mono">VERIFIED</Badge>}
                                      <Badge variant="outline" className="text-[8px] font-mono">
                                        {Math.round(Number(a.confidence_score) * 100)}%
                                      </Badge>
                                    </div>
                                    {a.profile_url && (
                                      <a href={a.profile_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                                        <ChevronRight className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Monitor className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
                        <p className="text-xs text-muted-foreground font-mono">No platform accounts mapped</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Click "MAP PLATFORMS" to discover accounts from identifiers</p>
                      </div>
                    )}
                  </GlassPanel>
                </TabsContent>

                <TabsContent value="infrastructure">
                  <GlassPanel className="p-4">
                    <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
                      <Server className="h-3.5 w-3.5" /> INFRASTRUCTURE ({profile.infraLinks.length})
                    </h3>
                    {profile.infraLinks.length > 0 ? (
                      <div className="space-y-2">
                        {profile.infraLinks.map((il: any) => {
                          const entity = profile.matchedEntities.find((e: any) => e.id === il.entity_id);
                          return (
                            <div key={il.id} className="flex items-center gap-3 p-3 rounded bg-muted/30 border border-border/30">
                              <Server className="h-4 w-4 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-xs font-medium">{il.value}</div>
                                <div className="font-mono text-[9px] text-muted-foreground">{il.infrastructure_type} • linked to {entity?.entity_value ?? il.entity_id.slice(0, 8)}</div>
                              </div>
                              <span className="font-mono text-[10px] text-primary font-bold">{Math.round(Number(il.confidence_score) * 100)}%</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground font-mono text-center py-6">No infrastructure links found</p>
                    )}
                  </GlassPanel>
                </TabsContent>

                {/* Persona Timeline Tab */}
                <TabsContent value="timeline">
                  <GlassPanel className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-mono text-xs tracking-widest text-primary flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" /> PERSONA TIMELINE ({personaEvents.length})
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 h-7 text-[10px] font-mono"
                        disabled={buildingTimeline || !selectedId}
                        onClick={() => {
                          if (selectedId) buildTimeline(selectedId, {
                            onSuccess: (r) => toast.success(`Built timeline with ${r.eventsCreated} events`),
                            onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
                          });
                        }}
                      >
                        {buildingTimeline ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        {buildingTimeline ? (timelineProgress ?? "BUILDING...") : "BUILD TIMELINE"}
                      </Button>
                    </div>
                    {personaEvents.length > 0 ? (
                      <ScrollArea className="h-[500px]">
                        <div className="relative pl-6 space-y-0">
                          <div className="absolute left-2 top-0 bottom-0 w-px bg-border" />
                          {personaEvents.map((ev: any) => {
                            const typeColor =
                              ev.event_type === "breach_exposure" ? "bg-destructive" :
                              ev.event_type === "investigation_sighting" ? "bg-yellow-500" :
                              ev.event_type === "infrastructure_linked" ? "bg-green-500" :
                              "bg-primary";
                            const typeIcon =
                              ev.event_type === "breach_exposure" ? AlertTriangle :
                              ev.event_type === "investigation_sighting" ? Activity :
                              ev.event_type === "identifier_discovered" ? Fingerprint :
                              ev.event_type === "username_generated" ? AtSign :
                              ev.event_type === "email_generated" ? Mail :
                              ev.event_type === "infrastructure_linked" ? Server :
                              ev.event_type === "entity_created" ? Network :
                              Clock;
                            const EvIcon = typeIcon;
                            return (
                              <div key={ev.id} className="relative pb-3">
                                <div className={`absolute left-[-18px] top-1.5 w-2.5 h-2.5 rounded-full ${typeColor}`} />
                                <div className="p-2.5 rounded bg-muted/30 border border-border/30">
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <EvIcon className="h-3 w-3 text-muted-foreground" />
                                      <Badge variant="outline" className="text-[8px] font-mono">
                                        {ev.event_type.replace(/_/g, " ").toUpperCase()}
                                      </Badge>
                                    </div>
                                    <span className="font-mono text-[9px] text-muted-foreground">
                                      {new Date(ev.event_timestamp).toLocaleDateString()} {new Date(ev.event_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="font-mono text-[10px] text-foreground">{ev.event_label}</p>
                                  {ev.source && (
                                    <span className="font-mono text-[8px] text-muted-foreground mt-0.5 block">
                                      source: {ev.source}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="text-center py-8">
                        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
                        <p className="text-xs text-muted-foreground font-mono">No timeline events yet</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">Click "BUILD TIMELINE" to aggregate events from all data sources</p>
                      </div>
                    )}
                  </GlassPanel>
                </TabsContent>

                {/* Breaches Tab */}
                <TabsContent value="breaches">
                  <GlassPanel className="p-4">
                    <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5" /> BREACH RECORDS ({profile.breaches.length})
                    </h3>
                    {profile.breaches.length > 0 ? (
                      <div className="space-y-2">
                        {profile.breaches.map((b: any) => {
                          const entity = profile.matchedEntities.find((e: any) => e.id === b.entity_id);
                          const sevColor = b.severity === "critical" ? "text-destructive" : b.severity === "high" ? "text-yellow-500" : "text-muted-foreground";
                          return (
                            <div key={b.id} className="p-3 rounded bg-muted/30 border border-border/30">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-mono text-xs font-medium">{b.breach_source}</span>
                                <Badge variant="outline" className={`text-[8px] font-mono ${sevColor}`}>{b.severity}</Badge>
                              </div>
                              <div className="font-mono text-[9px] text-muted-foreground">
                                {entity?.entity_value ?? "unknown"} • {b.breach_date ?? "date unknown"}
                              </div>
                              {b.data_exposed?.length > 0 && (
                                <div className="flex gap-1 mt-1.5 flex-wrap">
                                  {b.data_exposed.map((d: string) => (
                                    <Badge key={d} variant="secondary" className="text-[7px] font-mono">{d}</Badge>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-3 mt-1.5 font-mono text-[8px]">
                                {b.credential_leaked && <span className="text-destructive">⚠ CREDENTIAL LEAKED</span>}
                                {b.password_reuse_detected && <span className="text-yellow-500">⚠ PASSWORD REUSE</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground font-mono text-center py-6">No breach records found</p>
                    )}
                  </GlassPanel>
                </TabsContent>

                {/* Linked Cases Tab */}
                <TabsContent value="cases">
                  <GlassPanel className="p-4">
                    <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5" /> LINKED INVESTIGATIONS ({profile.linkedCases.length})
                    </h3>
                    {profile.linkedCases.length > 0 ? (
                      <div className="space-y-2">
                        {profile.linkedCases.map((c: any) => {
                          const obsCount = profile.observations.filter((o: any) => o.case_id === c.id).length;
                          return (
                            <div key={c.id} className="flex items-center gap-3 p-3 rounded bg-muted/30 border border-border/30">
                              <Shield className="h-4 w-4 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-mono text-xs font-medium truncate">{c.title}</div>
                                <div className="font-mono text-[9px] text-muted-foreground">
                                  {new Date(c.created_at).toLocaleDateString()} • {obsCount} observations
                                </div>
                              </div>
                              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground font-mono text-center py-6">No linked investigations found</p>
                    )}
                  </GlassPanel>
                </TabsContent>

                {/* Similarity Tab */}
                <TabsContent value="similarity">
                  <GlassPanel className="p-4">
                    <h3 className="font-mono text-xs tracking-widest text-primary mb-3 flex items-center gap-2">
                      <GitCompare className="h-3.5 w-3.5" /> BEHAVIORAL SIMILARITY ({profile.relatedSimilarity.length} pairs)
                    </h3>
                    {profile.relatedSimilarity.length > 0 ? (
                      <div className="space-y-2">
                        {profile.relatedSimilarity.map((s: any) => {
                          const eA = profile.matchedEntities.find((e: any) => e.id === s.entity_a);
                          const eB = profile.matchedEntities.find((e: any) => e.id === s.entity_b);
                          const pct = Math.round(Number(s.similarity_score) * 100);
                          const barColor = pct >= 70 ? "bg-destructive" : pct >= 40 ? "bg-yellow-500" : "bg-primary";
                          return (
                            <div key={s.id} className="p-3 rounded bg-muted/30 border border-border/30">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs truncate max-w-[150px]">{eA?.entity_value ?? s.entity_a.slice(0, 8)}</span>
                                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="font-mono text-xs truncate max-w-[150px]">{eB?.entity_value ?? s.entity_b.slice(0, 8)}</span>
                                <span className={`ml-auto font-mono text-xs font-bold ${pct >= 70 ? "text-destructive" : pct >= 40 ? "text-yellow-500" : "text-primary"}`}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                              <div className="flex gap-3 font-mono text-[9px] text-muted-foreground">
                                <span>USR: {Math.round(Number(s.username_similarity) * 100)}%</span>
                                <span>TMP: {Math.round(Number(s.temporal_similarity) * 100)}%</span>
                                <span>INF: {Math.round(Number(s.infrastructure_similarity) * 100)}%</span>
                                <span>META: {Math.round(Number(s.metadata_similarity) * 100)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground font-mono text-center py-6">No similarity data available. Run similarity scoring first.</p>
                    )}
                  </GlassPanel>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
