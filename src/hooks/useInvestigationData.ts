import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuditLog } from "@/hooks/useAuditLog";
import { toast } from "sonner";
import { createCaseSchema, createSubjectSchema, createEventSchema } from "@/lib/validations";

// ─── Cases ───
export function useCases() {
  return useQuery({
    queryKey: ["cases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Failed to load cases: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { log } = useAuditLog();
  return useMutation({
    mutationFn: async (input: { title: string; description?: string }) => {
      if (!user) throw new Error("You must be signed in");
      const validated = createCaseSchema.parse(input);
      const { data, error } = await supabase
        .from("cases")
        .insert({ title: validated.title, description: validated.description ?? null, owner_id: user.id })
        .select()
        .single();
      if (error) throw new Error(`Failed to create case: ${error.message}`);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      log("case_created", "case", data.id, { title: data.title });
      toast.success("Case created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Subjects ───
export function useSubjects(caseId: string | null) {
  return useQuery({
    queryKey: ["subjects", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Failed to load subjects: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useCreateSubject() {
  const qc = useQueryClient();
  const { log } = useAuditLog();
  return useMutation({
    mutationFn: async (input: { case_id: string; name: string; type: string; notes?: string }) => {
      createSubjectSchema.parse(input);
      const { data, error } = await supabase
        .from("subjects")
        .insert(input)
        .select()
        .single();
      if (error) throw new Error(`Failed to add subject: ${error.message}`);
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["subjects", vars.case_id] });
      log("subject_added", "subject", data.id, { case_id: vars.case_id, name: vars.name });
      toast.success("Subject added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Artifacts ───
export function useArtifacts(caseId: string | null) {
  return useQuery({
    queryKey: ["artifacts", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artifacts")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Failed to load artifacts: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useCreateArtifact() {
  const qc = useQueryClient();
  const { log } = useAuditLog();
  return useMutation({
    mutationFn: async (input: { case_id: string; artifact_type: string; data?: string }) => {
      if (!input.artifact_type?.trim()) throw new Error("Artifact type is required");
      if (input.data && input.data.length > 100000) throw new Error("Artifact data too large");
      const { data, error } = await supabase
        .from("artifacts")
        .insert(input)
        .select()
        .single();
      if (error) throw new Error(`Failed to attach artifact: ${error.message}`);
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["artifacts", vars.case_id] });
      log("artifact_upload", "artifact", data.id, { case_id: vars.case_id, type: vars.artifact_type });
      toast.success("Artifact attached");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Events ───
export function useEvents(caseId: string | null) {
  return useQuery({
    queryKey: ["events", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("case_id", caseId!)
        .order("timestamp", { ascending: true });
      if (error) throw new Error(`Failed to load events: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  const { log } = useAuditLog();
  return useMutation({
    mutationFn: async (input: { case_id: string; event_type?: string; timestamp?: string; description?: string }) => {
      createEventSchema.parse(input);
      const { data, error } = await supabase
        .from("events")
        .insert(input)
        .select()
        .single();
      if (error) throw new Error(`Failed to add event: ${error.message}`);
      return data;
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["events", vars.case_id] });
      log("event_added", "event", data.id, { case_id: vars.case_id });
      toast.success("Event added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
