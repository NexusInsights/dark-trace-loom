import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createEntitySchema, createRelationshipSchema } from "@/lib/validations";

export function useEntities(caseId: string | null) {
  return useQuery({
    queryKey: ["entities", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entities")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Failed to load entities: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useEntityRelationships(caseId: string | null) {
  return useQuery({
    queryKey: ["entity_relationships", caseId],
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entity_relationships")
        .select("*")
        .eq("case_id", caseId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Failed to load relationships: ${error.message}`);
      return data ?? [];
    },
  });
}

export function useCreateEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { case_id: string; entity_type: string; label: string }) => {
      createEntitySchema.parse(input);
      const { data, error } = await supabase.from("entities").insert(input).select().single();
      if (error) throw new Error(`Failed to add entity: ${error.message}`);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["entities", vars.case_id] });
      toast.success("Entity added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateRelationship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      case_id: string; source_id: string; target_id: string;
      relationship_type: string; notes?: string;
    }) => {
      createRelationshipSchema.parse(input);
      const { data, error } = await supabase.from("entity_relationships").insert(input).select().single();
      if (error) throw new Error(`Failed to create relationship: ${error.message}`);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["entity_relationships", vars.case_id] });
      toast.success("Relationship created");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
