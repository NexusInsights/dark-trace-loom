import { useState } from "react";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  useCollaborators, useInviteCollaborator, useUpdateCollaboratorRole,
  useRemoveCollaborator, ROLE_LABELS, type CollaboratorRole,
} from "@/hooks/useCollaborators";
import {
  Users, UserPlus, Loader2, X, Shield, Eye, Search, Scale, Trash2,
} from "lucide-react";

const ROLES: { id: CollaboratorRole; label: string; description: string; icon: typeof Eye }[] = [
  { id: "viewer", label: "Viewer", description: "Read-only access to case data", icon: Eye },
  { id: "investigator", label: "Investigator", description: "Can view and add subjects, artifacts, events", icon: Search },
  { id: "legal_reviewer", label: "Legal Reviewer", description: "Read-only access for legal proceedings", icon: Scale },
];

interface Props {
  caseId: string;
  isOwner: boolean;
}

export function CaseCollaborators({ caseId, isOwner }: Props) {
  const { user } = useAuth();
  const { data: collaborators = [], isLoading } = useCollaborators(caseId);
  const inviteMutation = useInviteCollaborator();
  const updateRoleMutation = useUpdateCollaboratorRole();
  const removeMutation = useRemoveCollaborator();

  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CollaboratorRole>("viewer");

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMutation.mutate(
      { caseId, email: email.trim(), role },
      { onSuccess: () => { setEmail(""); setShowInvite(false); } }
    );
  };

  return (
    <GlassPanel className="p-4 space-y-3" neonLine="left">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
            COLLABORATORS ({collaborators.length})
          </span>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="p-1 rounded hover:bg-secondary transition-colors"
          >
            {showInvite ? (
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInvite && isOwner && (
        <form onSubmit={handleInvite} className="space-y-2 border-t border-border pt-3">
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">
            INVITE BY EMAIL
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="w-full bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="font-mono text-[10px] tracking-widest text-muted-foreground">ROLE</label>
          <div className="space-y-1.5">
            {ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id)}
                  className={`w-full flex items-start gap-2 p-2 rounded border text-left transition-all text-xs ${
                    role === r.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold text-[11px]">{r.label}</span>
                    <p className="text-[10px] text-muted-foreground">{r.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <Button
            type="submit"
            variant="neon"
            size="sm"
            className="w-full gap-2"
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <><UserPlus className="h-3 w-3" />INVITE</>
            )}
          </Button>
        </form>
      )}

      {/* Collaborator list */}
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto" />
      ) : collaborators.length === 0 ? (
        <p className="text-[10px] text-muted-foreground font-mono text-center py-2">
          No collaborators yet
        </p>
      ) : (
        <div className="space-y-2">
          {collaborators.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 p-2 rounded bg-secondary/50 border border-border/30"
            >
              <Shield className="h-3.5 w-3.5 text-primary/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium truncate block">
                  {c.profile?.name ?? c.user_id.slice(0, 8)}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {ROLE_LABELS[c.role as CollaboratorRole]}
                </span>
              </div>
              {isOwner && (
                <div className="flex items-center gap-1">
                  <select
                    value={c.role}
                    onChange={(e) =>
                      updateRoleMutation.mutate({
                        id: c.id,
                        caseId,
                        role: e.target.value as CollaboratorRole,
                      })
                    }
                    className="bg-secondary border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeMutation.mutate({ id: c.id, caseId })}
                    className="p-1 rounded hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
