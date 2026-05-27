import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel } from "@/components/intel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Building2, Plus, Users, Shield, UserPlus, Crown, Trash2, Briefcase, Settings,
} from "lucide-react";

interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  description: string | null;
  created_at: string;
}

interface OrgMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  profiles?: { name: string | null } | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  investigator: "Investigator",
  viewer: "Viewer",
};

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  owner: Crown,
  admin: Shield,
  investigator: Briefcase,
  viewer: Users,
};

export default function OrganizationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Organization[];
    },
    enabled: !!user,
  });

  const activeOrg = orgs.find((o) => o.id === selectedOrg);

  if (selectedOrg && activeOrg) {
    return (
      <div className="p-6 max-w-5xl mx-auto animate-fade-in">
        <Button variant="ghost" size="sm" className="mb-4 gap-2" onClick={() => setSelectedOrg(null)}>
          ← Back to Organizations
        </Button>
        <OrgDetail org={activeOrg} userId={user?.id} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <span className="intel-tag intel-tag-blue mb-3 inline-block">WORKSPACES</span>
          <h1 className="text-2xl font-display font-bold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage team workspaces and investigators
          </p>
        </div>
        <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} userId={user?.id} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <GlassPanel key={i} className="p-6 animate-pulse h-36"><div /></GlassPanel>
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <GlassPanel className="p-10 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display font-semibold mb-2">No Organizations Yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create an organization to manage team investigations collaboratively.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create Organization
          </Button>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orgs.map((org) => (
            <div key={org.id} className="cursor-pointer" onClick={() => setSelectedOrg(org.id)}>
              <GlassPanel className="p-5 group hover:glow-blue transition-all duration-300">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-sm font-semibold truncate">{org.name}</h3>
                    <p className="font-mono text-[10px] text-muted-foreground">/{org.slug}</p>
                  </div>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-primary">
                    OPEN →
                  </span>
                </div>
                {org.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{org.description}</p>
                )}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {org.owner_id === user?.id && (
                    <Badge variant="outline" className="text-[10px]">Owner</Badge>
                  )}
                  <span className="font-mono">
                    Created {new Date(org.created_at).toLocaleDateString()}
                  </span>
                </div>
              </GlassPanel>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Organization Detail ── */
function OrgDetail({ org, userId }: { org: Organization; userId?: string }) {
  const queryClient = useQueryClient();
  const isOwner = org.owner_id === userId;

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["org-members", org.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("*")
        .eq("organization_id", org.id)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return data as OrgMember[];
    },
  });

  const { data: orgCases = [] } = useQuery({
    queryKey: ["org-cases", org.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, title, created_at, owner_id")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", org.id] });
      toast({ title: "Member removed" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: "admin" | "investigator" | "viewer" }) => {
      const { error } = await supabase
        .from("organization_members")
        .update({ role: role as any })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", org.id] });
      toast({ title: "Role updated" });
    },
  });

  const myMembership = members.find((m) => m.user_id === userId);
  const canManage = isOwner || myMembership?.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-primary/10 text-primary">
          <Building2 className="h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">{org.name}</h1>
          <p className="text-sm text-muted-foreground">/{org.slug}</p>
        </div>
        {isOwner && <Badge className="ml-auto">Owner</Badge>}
      </div>

      {org.description && (
        <p className="text-sm text-muted-foreground">{org.description}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Members", value: members.length, icon: Users },
          { label: "Cases", value: orgCases.length, icon: Briefcase },
          { label: "Your Role", value: ROLE_LABELS[myMembership?.role || "viewer"] || "Member", icon: Shield },
        ].map((s) => (
          <GlassPanel key={s.label} className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <s.icon className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] tracking-wider uppercase">{s.label}</span>
            </div>
            <span className="text-lg font-display font-bold">{s.value}</span>
          </GlassPanel>
        ))}
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="cases">Cases ({orgCases.length})</TabsTrigger>
          {canManage && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members" className="mt-4 space-y-3">
          {canManage && (
            <InviteMemberForm orgId={org.id} userId={userId} />
          )}

          {members.map((m) => {
            const RoleIcon = ROLE_ICONS[m.role] || Users;
            return (
              <GlassPanel key={m.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-muted">
                    <RoleIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.user_id === userId ? "You" : m.user_id.slice(0, 8) + "..."}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Joined {new Date(m.joined_at).toLocaleDateString()}
                    </p>
                  </div>

                  {canManage && m.role !== "owner" ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={m.role}
                        onValueChange={(role: "admin" | "investigator" | "viewer") => updateRoleMutation.mutate({ memberId: m.id, role })}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="investigator">Investigator</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      {m.user_id !== userId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeMemberMutation.mutate(m.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {ROLE_LABELS[m.role]}
                    </Badge>
                  )}
                </div>
              </GlassPanel>
            );
          })}
        </TabsContent>

        {/* Cases Tab */}
        <TabsContent value="cases" className="mt-4 space-y-3">
          {orgCases.length === 0 ? (
            <GlassPanel className="p-8 text-center">
              <Briefcase className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No cases assigned to this organization yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Cases can be assigned to this organization when creating new investigations.
              </p>
            </GlassPanel>
          ) : (
            orgCases.map((c) => (
              <GlassPanel key={c.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold">{c.title}</h4>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Created {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {c.owner_id === userId ? "Your case" : "Team case"}
                  </Badge>
                </div>
              </GlassPanel>
            ))
          )}
        </TabsContent>

        {/* Settings Tab */}
        {canManage && (
          <TabsContent value="settings" className="mt-4">
            <OrgSettings org={org} isOwner={isOwner} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/* ── Invite Member Form ── */
function InviteMemberForm({ orgId, userId }: { orgId: string; userId?: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("investigator");

  const inviteMutation = useMutation({
    mutationFn: async () => {
      // Look up user by email via profiles (simplified - in production use an edge function)
      // For now, we add by user ID concept - in a real app this would send an invite email
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id")
        .eq("name", email)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) throw new Error("User not found. They must have an account first.");

      const { error } = await supabase
        .from("organization_members")
        .insert({
          organization_id: orgId,
          user_id: profile.id,
          role: role as any,
          invited_by: userId,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", orgId] });
      setEmail("");
      toast({ title: "Member added", description: "The user has been added to the organization." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <GlassPanel className="p-4" neonLine="left">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-xs font-medium mb-1 block">Add Member (by display name)</label>
          <Input
            placeholder="User's display name..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="w-[140px]">
          <label className="text-xs font-medium mb-1 block">Role</label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="investigator">Investigator</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => inviteMutation.mutate()}
          disabled={!email || inviteMutation.isPending}
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          {inviteMutation.isPending ? "Adding..." : "Add"}
        </Button>
      </div>
    </GlassPanel>
  );
}

/* ── Org Settings ── */
function OrgSettings({ org, isOwner }: { org: Organization; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description || "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations")
        .update({ name, description })
        .eq("id", org.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      toast({ title: "Organization updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organizations").delete().eq("id", org.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      toast({ title: "Organization deleted" });
      window.location.reload();
    },
  });

  return (
    <div className="space-y-4">
      <GlassPanel className="p-5 space-y-4">
        <h3 className="font-display font-semibold text-sm flex items-center gap-2">
          <Settings className="h-4 w-4" /> General Settings
        </h3>
        <div>
          <label className="text-xs font-medium mb-1 block">Organization Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Description</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </GlassPanel>

      {isOwner && (
        <GlassPanel className="p-5 border-destructive/30">
          <h3 className="font-display font-semibold text-sm text-destructive mb-2">Danger Zone</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Deleting this organization will remove all member associations. Cases will be unlinked but not deleted.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Are you sure you want to delete this organization?")) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Organization
          </Button>
        </GlassPanel>
      )}
    </div>
  );
}

/* ── Create Organization Dialog ── */
function CreateOrgDialog({
  open, onOpenChange, userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      let slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      
      // Check for slug collision and append random suffix if needed
      const { data: existing } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (existing) {
        slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      // Create org
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name, slug, owner_id: userId, description: description || null })
        .select()
        .single();
      if (orgError) throw orgError;

      // Add creator as owner member
      const { error: memberError } = await supabase
        .from("organization_members")
        .insert({
          organization_id: org.id,
          user_id: userId,
          role: "owner" as const,
          invited_by: userId,
        } as any);
      if (memberError) throw memberError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      onOpenChange(false);
      setName("");
      setDescription("");
      toast({ title: "Organization created", description: "Your new workspace is ready." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> New Organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Create Organization</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs font-medium mb-1 block">Organization Name *</label>
            <Input
              placeholder="e.g. Acme Investigations"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {name && (
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                /{name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Description</label>
            <Textarea
              placeholder="What does this organization focus on?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <Button
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={!name || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Organization"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
