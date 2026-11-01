import { checkedDatabase } from "@/lib/checkedDatabase";
import { useEffect, useState, createContext, useContext, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setLoading(false);

        // Audit log for login/logout
        if (event === "SIGNED_IN" && session?.user) {
          Promise.resolve(supabase.from("activity_logs").insert({
            user_id: session.user.id,
            action: "login",
            entity_type: "auth",
            entity_id: session.user.id,
            metadata: { provider: session.user.app_metadata?.provider ?? "email" },
          })).then(({ error }) => {
            if (error) console.warn("Login audit record could not be saved:", error.message);
          }).catch((error: unknown) => {
            console.warn("Login audit record could not be saved:", error instanceof Error ? error.message : "Unknown error");
          });
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) throw error;
      setSession(session);
    }).catch((error: unknown) => {
      console.warn("Session could not be restored:", error instanceof Error ? error.message : "Unknown error");
      setSession(null);
    }).finally(() => {
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (session?.user) {
      try {
        const { error } = await checkedDatabase(supabase.from("activity_logs").insert({
          user_id: session.user.id,
          action: "logout",
          entity_type: "auth",
          entity_id: session.user.id,
        }));
        if (error) throw error;
      } catch (error: unknown) {
        console.warn("Logout audit record could not be saved:", error instanceof Error ? error.message : "Unknown error");
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
