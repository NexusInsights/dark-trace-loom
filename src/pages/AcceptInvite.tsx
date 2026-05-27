import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassPanel } from "@/components/intel";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; orgId: string }
  | { kind: "error"; message: string };

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (loading || !user || !token || state.kind !== "idle") return;
    setState({ kind: "loading" });
    (async () => {
      const { data, error } = await supabase.functions.invoke("accept-invite", { body: { token } });
      if (error) return setState({ kind: "error", message: error.message });
      if (data?.error) return setState({ kind: "error", message: data.error });
      if (data?.status === "success") {
        setState({ kind: "success", orgId: data.org_id });
        setTimeout(() => navigate("/organizations"), 1500);
      } else {
        setState({ kind: "error", message: "Unexpected response" });
      }
    })();
  }, [loading, user, token, state.kind, navigate]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <GlassPanel className="p-8 max-w-md w-full text-center">
          <XCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h1 className="font-display font-bold text-lg mb-2">Missing token</h1>
          <p className="text-sm text-muted-foreground">This invite link is invalid.</p>
        </GlassPanel>
      </div>
    );
  }

  if (!loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <GlassPanel className="p-8 max-w-md w-full text-center space-y-4">
          <h1 className="font-display font-bold text-lg">Sign in to accept your invitation</h1>
          <p className="text-sm text-muted-foreground">
            You must sign in with the email address the invitation was sent to.
          </p>
          <Button asChild>
            <Link to={`/auth?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>
              Sign in
            </Link>
          </Button>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <GlassPanel className="p-8 max-w-md w-full text-center">
        {state.kind === "loading" || state.kind === "idle" ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Processing invitation...</p>
          </>
        ) : state.kind === "success" ? (
          <>
            <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto mb-4" />
            <h1 className="font-display font-bold text-lg mb-2">You're in!</h1>
            <p className="text-sm text-muted-foreground">Redirecting to your organization...</p>
          </>
        ) : (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
            <h1 className="font-display font-bold text-lg mb-2">Couldn't accept invitation</h1>
            <p className="text-sm text-muted-foreground mb-4">{state.message}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </>
        )}
      </GlassPanel>
    </div>
  );
}