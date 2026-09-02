import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/intel";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { loginSchema, magicLinkSchema } from "@/lib/validations";
import { Mail, KeyRound, Loader2, Chrome } from "lucide-react";

type Mode = "login" | "signup" | "magic";

export default function AuthPage() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/dashboard" replace />;

  const handleGoogle = async () => {
    setOauthLoading(true);
    try {
      sessionStorage.setItem("postAuthRedirect", "/dashboard");
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/auth/callback",
      });
      if (result.error) throw result.error;
      // If redirected, browser handles it. Otherwise tokens are set.
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setOauthLoading(false);
    }
  };


  const handleForgotPassword = async () => {
    const parsed = magicLinkSchema.safeParse({ email });
    if (!parsed.success) {
      toast.error("Enter your email above first");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (error) throw error;
      toast.success("Password reset link sent. Check your inbox.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset link");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      toast.error(validation.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: validation.data.email,
          password: validation.data.password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: validation.data.email,
          password: validation.data.password,
        });
        if (error) throw error;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = magicLinkSchema.safeParse({ email });
    if (!validation.success) {
      toast.error(validation.error.errors[0]?.message ?? "Invalid email");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: validation.data.email,
        options: { emailRedirectTo: window.location.origin + "/dashboard" },
      });
      if (error) throw error;
      toast.success("Magic link sent! Check your inbox.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send magic link";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <span className="intel-tag intel-tag-blue inline-block">SECURE ACCESS</span>
          <h1 className="text-2xl font-display font-bold tracking-tight text-foreground">OSINTHQ</h1>
          <p className="text-sm text-muted-foreground">Intelligence Operations Platform</p>
        </div>

        <GlassPanel className="p-6 space-y-5">
          {/* Google OAuth */}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={oauthLoading}
          >
            {oauthLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Chrome className="h-4 w-4" /> Continue with Google
              </span>
            )}
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-secondary rounded-md">
            {([
              { key: "login", label: "Login", icon: KeyRound },
              { key: "signup", label: "Sign Up", icon: KeyRound },
              { key: "magic", label: "Magic Link", icon: Mail },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-mono transition-colors ${
                  mode === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          {mode === "magic" ? (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] tracking-widest text-muted-foreground">EMAIL</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="operator@agency.gov"
                />
              </div>
              <Button type="submit" variant="neon" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "SEND MAGIC LINK"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleEmailPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] tracking-widest text-muted-foreground">EMAIL</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="operator@agency.gov"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] tracking-widest text-muted-foreground">PASSWORD</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" variant="neon" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
              </Button>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={submitting}
                  className="w-full text-center text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </form>
          )}
        </GlassPanel>

        <p className="text-center text-[10px] font-mono text-muted-foreground tracking-wider">
          ENCRYPTED • SECURED • CLASSIFIED
        </p>
      </div>
    </div>
  );
}
