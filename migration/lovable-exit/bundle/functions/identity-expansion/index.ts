import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExpansionRequest {
  entity_id: string;
  entity_type: string;
  entity_value: string;
  user_id: string;
}

async function log(
  supabase: any,
  userId: string,
  entityId: string,
  triggerValue: string,
  triggerType: string,
  step: string,
  status: string,
  result: any = {},
  error?: string
) {
  await supabase.from("expansion_logs").insert({
    user_id: userId,
    trigger_entity_id: entityId,
    trigger_value: triggerValue,
    trigger_type: triggerType,
    step,
    status,
    result,
    error: error ?? null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify the user's JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ExpansionRequest = await req.json();
    const { entity_id, entity_type, entity_value, user_id } = body;

    if (user.id !== user_id) {
      return new Response(JSON.stringify({ error: "User mismatch" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, any> = {};

    // Step 1: Persona Discovery — create/find persona and generate identifiers
    await log(supabase, user_id, entity_id, entity_value, entity_type, "persona_discovery", "running");
    try {
      // Check if persona already exists with this value
      const { data: existingPersonas } = await supabase
        .from("persona_identifiers")
        .select("persona_id")
        .eq("user_id", user_id)
        .eq("identifier_value", entity_value)
        .limit(1);

      let personaId: string;

      if (existingPersonas?.length) {
        personaId = existingPersonas[0].persona_id;
        results.persona = { action: "existing", persona_id: personaId };
      } else {
        // Create new persona
        const { data: persona } = await supabase
          .from("personas")
          .insert({ user_id, persona_label: entity_value })
          .select("id")
          .single();

        if (!persona) throw new Error("Failed to create persona");
        personaId = persona.id;

        // Add the triggering identifier
        await supabase.from("persona_identifiers").insert({
          persona_id: personaId,
          user_id,
          identifier_type: entity_type,
          identifier_value: entity_value,
          confidence_score: 1.0,
          source: "auto_expansion",
        });

        results.persona = { action: "created", persona_id: personaId };
      }

      await log(supabase, user_id, entity_id, entity_value, entity_type, "persona_discovery", "completed", results.persona);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await log(supabase, user_id, entity_id, entity_value, entity_type, "persona_discovery", "failed", {}, msg);
      results.persona = { error: msg };
    }

    // Step 2: Generate permutations based on type
    await log(supabase, user_id, entity_id, entity_value, entity_type, "permutation_generation", "running");
    try {
      let permutationsGenerated = 0;

      if (entity_type === "username" || entity_type === "email") {
        // Username permutations
        const parts = entity_value.replace(/@.*/, "").split(/[._\-]/);
        const base = entity_value.replace(/@.*/, "").toLowerCase();
        const variations: string[] = [];

        if (parts.length >= 2) {
          const [a, b] = parts;
          variations.push(`${a}${b}`, `${b}${a}`, `${a}.${b}`, `${a}_${b}`, `${b}.${a}`, `${a}${b}123`);
        }
        variations.push(`${base}_`, `the${base}`, `${base}official`, `real${base}`, `${base}x`);

        // Store as username candidates if persona exists
        const personaId = results.persona?.persona_id;
        if (personaId && variations.length > 0) {
          const candidates = variations.slice(0, 20).map((v, i) => ({
            persona_id: personaId,
            user_id,
            candidate_username: v,
            confidence_score: Math.max(0.3, 0.8 - i * 0.03),
            generation_method: "auto_expansion",
          }));
          const { data } = await supabase
            .from("username_candidates")
            .upsert(candidates, { onConflict: "persona_id,candidate_username", ignoreDuplicates: true })
            .select("id");
          permutationsGenerated = data?.length ?? 0;
        }
      }

      if (entity_type === "email") {
        // Email permutations
        const [local, domain] = entity_value.split("@");
        if (local && domain) {
          const parts = local.split(/[._\-]/);
          const emailVariations: string[] = [];
          if (parts.length >= 2) {
            const [a, b] = parts;
            emailVariations.push(
              `${a}${b}@${domain}`, `${b}${a}@${domain}`, `${a}.${b}@${domain}`,
              `${a}_${b}@${domain}`, `${a[0]}${b}@${domain}`, `${a}@${domain}`
            );
          }
          const personaId = results.persona?.persona_id;
          if (personaId && emailVariations.length > 0) {
            const candidates = emailVariations.map((v, i) => ({
              persona_id: personaId,
              user_id,
              candidate_email: v,
              confidence_score: Math.max(0.3, 0.85 - i * 0.05),
              generation_method: "auto_expansion",
            }));
            const { data } = await supabase
              .from("email_candidates")
              .upsert(candidates, { onConflict: "persona_id,candidate_email", ignoreDuplicates: true })
              .select("id");
            permutationsGenerated += data?.length ?? 0;
          }
        }
      }

      results.permutations = { generated: permutationsGenerated };
      await log(supabase, user_id, entity_id, entity_value, entity_type, "permutation_generation", "completed", results.permutations);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await log(supabase, user_id, entity_id, entity_value, entity_type, "permutation_generation", "failed", {}, msg);
      results.permutations = { error: msg };
    }

    // Step 3: Entity linking — find matching entities and create links
    await log(supabase, user_id, entity_id, entity_value, entity_type, "entity_linking", "running");
    try {
      // Find entities with similar values
      const { data: similarEntities } = await supabase
        .from("identity_entities")
        .select("id, entity_type, entity_value")
        .eq("user_id", user_id)
        .neq("id", entity_id);

      let linksCreated = 0;
      const valueLower = entity_value.toLowerCase();

      for (const other of similarEntities ?? []) {
        const otherLower = other.entity_value.toLowerCase();
        let shouldLink = false;
        let relationship = "similar_value";
        let confidence = 0.5;

        // Exact match
        if (otherLower === valueLower) {
          shouldLink = true;
          relationship = "exact_match";
          confidence = 1.0;
        }
        // Same username in different contexts
        else if (entity_type === other.entity_type && otherLower.includes(valueLower.replace(/@.*/, ""))) {
          shouldLink = true;
          relationship = "partial_match";
          confidence = 0.6;
        }
        // Email username matches a username entity
        else if (
          (entity_type === "email" && other.entity_type === "username" && valueLower.replace(/@.*/, "") === otherLower) ||
          (entity_type === "username" && other.entity_type === "email" && otherLower.replace(/@.*/, "") === valueLower)
        ) {
          shouldLink = true;
          relationship = "username_email_match";
          confidence = 0.8;
        }
        // Same domain
        else if (entity_type === "domain" && other.entity_type === "email" && otherLower.endsWith(`@${valueLower}`)) {
          shouldLink = true;
          relationship = "domain_email_match";
          confidence = 0.7;
        }

        if (shouldLink) {
          const { error } = await supabase
            .from("identity_entity_links")
            .upsert(
              {
                source_entity_id: entity_id,
                target_entity_id: other.id,
                user_id,
                relationship_type: relationship,
                confidence_score: confidence,
                evidence: `auto_expansion:${entity_value}`,
              },
              { onConflict: "source_entity_id,target_entity_id,user_id", ignoreDuplicates: true }
            );
          if (!error) linksCreated++;
        }
      }

      results.linking = { links_created: linksCreated };
      await log(supabase, user_id, entity_id, entity_value, entity_type, "entity_linking", "completed", results.linking);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await log(supabase, user_id, entity_id, entity_value, entity_type, "entity_linking", "failed", {}, msg);
      results.linking = { error: msg };
    }

    // Step 4: Update identity clusters (lightweight re-clustering)
    await log(supabase, user_id, entity_id, entity_value, entity_type, "cluster_update", "running");
    try {
      // Check if entity is already in a cluster
      const { data: existingMembership } = await supabase
        .from("cluster_members")
        .select("cluster_id")
        .eq("entity_id", entity_id)
        .eq("user_id", user_id)
        .limit(1);

      if (existingMembership?.length) {
        results.clustering = { action: "already_clustered", cluster_id: existingMembership[0].cluster_id };
      } else {
        // Find linked entities that are already in clusters
        const { data: linkedEntities } = await supabase
          .from("identity_entity_links")
          .select("source_entity_id, target_entity_id")
          .eq("user_id", user_id)
          .or(`source_entity_id.eq.${entity_id},target_entity_id.eq.${entity_id}`);

        const linkedIds = new Set<string>();
        for (const link of linkedEntities ?? []) {
          if (link.source_entity_id !== entity_id) linkedIds.add(link.source_entity_id);
          if (link.target_entity_id !== entity_id) linkedIds.add(link.target_entity_id);
        }

        if (linkedIds.size > 0) {
          // Find clusters containing linked entities
          const { data: linkedMembers } = await supabase
            .from("cluster_members")
            .select("cluster_id")
            .eq("user_id", user_id)
            .in("entity_id", [...linkedIds].slice(0, 50));

          if (linkedMembers?.length) {
            // Add to the first matching cluster
            const clusterId = linkedMembers[0].cluster_id;
            await supabase.from("cluster_members").upsert(
              {
                cluster_id: clusterId,
                entity_id,
                user_id,
                confidence_score: 0.7,
                join_reason: "auto_expansion",
              },
              { onConflict: "cluster_id,entity_id", ignoreDuplicates: true }
            );
            results.clustering = { action: "added_to_cluster", cluster_id: clusterId };
          } else {
            results.clustering = { action: "no_cluster_found" };
          }
        } else {
          results.clustering = { action: "no_links_found" };
        }
      }

      await log(supabase, user_id, entity_id, entity_value, entity_type, "cluster_update", "completed", results.clustering);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await log(supabase, user_id, entity_id, entity_value, entity_type, "cluster_update", "failed", {}, msg);
      results.clustering = { error: msg };
    }

    // Final summary log
    await log(supabase, user_id, entity_id, entity_value, entity_type, "expansion_complete", "completed", results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
