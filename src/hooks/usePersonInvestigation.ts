import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { checkedDatabase } from "@/lib/checkedDatabase";
import type { Json } from "@/integrations/supabase/types";
import type { DossierRecord } from "@/lib/personDossier";

async function personDatabase<T extends {error:unknown}>(query:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{return await checkedDatabase(query(controller.signal));}finally{clearTimeout(timer);}
}

export function usePersonRecords(personaId: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ["person-investigation-records", user?.id, personaId], enabled: !!user && !!personaId,
    queryFn: async () => {
      const rows: DossierRecord[] = [];
      for (let offset=0; ; offset+=200) {
        const { data } = await personDatabase(signal=>supabase.from("tool_results").select("id,tool_name,result_data,created_at,case_id")
          .eq("user_id",user!.id).contains("result_data",{persona_id:personaId}).order("created_at",{ascending:true}).order("id").range(offset,offset+199).abortSignal(signal));
        rows.push(...(data ?? []));
        if (!data || data.length < 200) return rows;
      }
    },
  });
}

export function useSavePersonRecord(personaId: string | null) {
  const { user } = useAuth(); const qc=useQueryClient();
  return useMutation({ mutationFn: async ({toolName,data}:{toolName:string;data:Record<string,unknown>}) => {
    if(!user || !personaId) throw new Error("Select a person while signed in.");
    const owner = await personDatabase(signal=>supabase.from("personas").select("id").eq("id",personaId).eq("user_id",user.id).abortSignal(signal).single());
    if(!owner.data) throw new Error("This person investigation is unavailable.");
    const serialized=JSON.stringify(data); if(serialized.length>100000)throw new Error("Evidence record exceeds 100 KB.");
    await personDatabase(signal=>supabase.from("tool_results").insert({user_id:user.id,tool_name:toolName,status:"success",result_data:{...data,persona_id:personaId} as Json}).abortSignal(signal));
  }, onSuccess: () => qc.invalidateQueries({queryKey:["person-investigation-records",user?.id,personaId]}) });
}
