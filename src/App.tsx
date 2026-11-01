import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import AuthCallback from "./pages/AuthCallback";
import PdlHistory from "./pages/PdlHistory";
import Index from "./pages/Index";
import ToolSuite from "./pages/ToolSuite";
import Organizations from "./pages/Organizations";
import ActivityLogs from "./pages/ActivityLogs";
import Alerts from "./pages/Alerts";
import Monitoring from "./pages/Monitoring";
import Investigations from "./pages/Investigations";
import Billing from "./pages/Billing";
import Reports from "./pages/Reports";
import EvidenceExport from "./pages/EvidenceExport";
import Admin from "./pages/Admin";
import PersonInvestigations from "./pages/PersonInvestigations";
import PersonSources from "./pages/PersonSources";
import PersonSettings from "./pages/PersonSettings";
import PersonReports from "./pages/PersonReports";
import IntelligenceLab from "./pages/IntelligenceLab";
const ResearchWorkbench = lazy(() => import("./pages/ResearchWorkbench"));
import { personSources } from "./lib/personSources";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: error => toast.error(`Data could not be loaded: ${error.message}`) }),
  mutationCache: new MutationCache({ onError: error => toast.error(`Operation failed: ${error.message}`) }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

function LegacyPersonRoute() {
  const [params] = useSearchParams();
  const id=params.get("id");
  return <Navigate to={id?`/investigations?person=${encodeURIComponent(id)}`:"/investigations"} replace/>;
}
function PersonToolsRoute() {
  const [params] = useSearchParams();
  return personSources.some(source=>source.id===params.get("tool")) ? <ToolSuite/> : <Navigate to="/sources" replace/>;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SubscriptionProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route path="/" element={<Navigate to="/investigations" replace />} />
              <Route path="/landing" element={<Index />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Navigate to="/investigations" replace />} />
                <Route path="/tools" element={<PersonToolsRoute />} />
                <Route path="/marketplace" element={<Navigate to="/sources" replace />} />
                <Route path="/sources" element={<PersonSources />} />
                <Route path="/intelligence" element={<IntelligenceLab />} />
                <Route path="/research" element={<Suspense fallback={<p role="status" className="p-6">Loading research workspace…</p>}><ResearchWorkbench /></Suspense>} />
                <Route path="/settings" element={<PersonSettings />} />
                <Route path="/pdl-history" element={<PdlHistory />} />
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/activity" element={<ActivityLogs />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/monitoring" element={<Monitoring />} />
                <Route path="/agents" element={<Navigate to="/investigations" replace />} />
                <Route path="/reports" element={<PersonReports />} />
                <Route path="/legacy-reports" element={<Reports />} />
                <Route path="/evidence-export" element={<EvidenceExport />} />
                <Route path="/correlations" element={<Navigate to="/investigations" replace />} />
                <Route path="/identity" element={<Navigate to="/investigations" replace />} />
                <Route path="/social-graph" element={<Navigate to="/investigations" replace />} />
                <Route path="/pipelines" element={<Navigate to="/investigations" replace />} />
                <Route path="/personas" element={<Navigate to="/investigations" replace />} />
                <Route path="/persona-profile" element={<LegacyPersonRoute />} />
                <Route path="/persona-intel" element={<Navigate to="/investigations" replace />} />
                <Route path="/investigations" element={<PersonInvestigations />} />
                <Route path="/case-files" element={<ErrorBoundary><Investigations /></ErrorBoundary>} />
                <Route path="/training" element={<Navigate to="/investigations" replace />} />
                <Route path="/knowledge" element={<Navigate to="/investigations" replace />} />
                <Route path="/api" element={<Navigate to="/sources" replace />} />
                <Route path="/pricing" element={<Navigate to="/settings" replace />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/admin" element={<ErrorBoundary><Admin /></ErrorBoundary>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
