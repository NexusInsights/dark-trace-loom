import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type CollaboratorRole = "viewer" | "investigator" | "legal_reviewer";

export interface CaseCollaborator {
  id: string;
  case_id: string;
  user_id: string;
  role: CollaboratorRole;
  invited_by: string;
  created_at: string;
  profile?: { name: string | null } | null;
}

const ROLE_LABELS: Record<CollaboratorRole, string> = {
  viewer: "Viewer",
  investigator: "Investigator",
  legal_reviewer: "Legal Reviewer",
};

export { ROLE_LABELS };

export function useCollaborators(caseId: string | null) {
  return useQuery({
    queryKey: ["collaborators", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      // Fetch collaborators
      const { data, error } = await supabase
        .from("case_collaborators")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at");
      if (error) throw new Error(error.message);

      // Fetch profile names for each collaborator
      const collaborators: CaseCollaborator[] = data ?? [];
      if (collaborators.length > 0) {
        const userIds = collaborators.map((c) => c.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", userIds);

        collaborators.forEach((c) => {
          const profile = profiles?.find((p) => p.id === c.user_id);
          (c as CaseCollaborator).profile = profile ?? null;
        });
      }

      return collaborators;
    },
  });
}

export function useInviteCollaborator() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { caseId: string; email: string; role: CollaboratorRole }) => {
      if (!user) throw new Error("You must be signed in");

      // Look up the user by email via profiles
      // We need to find the user_id from the email. Since we can't query auth.users,
      // we'll use a workaround: the profile name might be the email for users without a name set
      // Better approach: look up via profiles table where name = email (set by handle_new_user trigger)
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, name")
        .eq("name", input.email)
        .limit(1);

      if (profileError) throw new Error(`Lookup failed: ${profileError.message}`);
      if (!profiles || profiles.length === 0) {
        throw new Error("No user found with that email. They must have an account first.");
      }

      const targetUserId = profiles[0].id;

      if (targetUserId === user.id) {
        throw new Error("You cannot invite yourself");
      }

      const { data, error } = await supabase
        .from("case_collaborators")
        .insert({
          case_id: input.caseId,
          user_id: targetUserId,
          role: input.role,
          invited_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") throw new Error("This user is already a collaborator on this case");
        throw new Error(`Invite failed: ${error.message}`);
      }
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["collaborators", vars.caseId] });
      toast.success("Collaborator invited");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateCollaboratorRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; caseId: string; role: CollaboratorRole }) => {
      const { error } = await supabase
        .from("case_collaborators")
        .update({ role: input.role })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["collaborators", vars.caseId] });
      toast.success("Role updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveCollaborator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; caseId: string }) => {
      const { error } = await supabase
        .from("case_collaborators")
        .delete()
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["collaborators", vars.caseId] });
      toast.success("Collaborator removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
