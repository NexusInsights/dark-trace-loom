import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useLocation } from "react-router-dom";
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
import Dashboard from "./pages/Dashboard";
import ToolSuite from "./pages/ToolSuite";
import Marketplace from "./pages/Marketplace";
import Agents from "./pages/Agents";
import Pipelines from "./pages/Pipelines";
import Correlations from "./pages/Correlations";
import IdentityResolution from "./pages/IdentityResolution";
import SocialGraph from "./pages/SocialGraph";
import PersonaDiscovery from "./pages/PersonaDiscovery";
import PersonaProfile from "./pages/PersonaProfile";
import PersonaIntelDashboard from "./pages/PersonaIntelDashboard";
import Training from "./pages/Training";
import KnowledgeBase from "./pages/KnowledgeBase";
import ApiDocs from "./pages/ApiDocs";
import Pricing from "./pages/Pricing";
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

function RouteAlias({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}
function InvestigationsRoute() {
  const [params] = useSearchParams();
  // Preserve links created by the person workspace before it had a named route.
  return params.has("person") ? <RouteAlias to="/person-investigations" /> : <ErrorBoundary><Investigations /></ErrorBoundary>;
}

export function AppRoutes() {
  return <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route path="/" element={<Index />} />
              <Route path="/landing" element={<RouteAlias to="/" />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/tools" element={<ToolSuite />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/person-investigations" element={<PersonInvestigations />} />
                <Route path="/person-reports" element={<PersonReports />} />
                <Route path="/sources" element={<PersonSources />} />
                <Route path="/intelligence" element={<IntelligenceLab />} />
                <Route path="/research" element={<Suspense fallback={<p role="status" className="p-6">Loading research workspace…</p>}><ResearchWorkbench /></Suspense>} />
                <Route path="/settings" element={<PersonSettings />} />
                <Route path="/pdl-history" element={<PdlHistory />} />
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/activity" element={<ActivityLogs />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/monitoring" element={<Monitoring />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/legacy-reports" element={<RouteAlias to="/reports" />} />
                <Route path="/evidence-export" element={<EvidenceExport />} />
                <Route path="/correlations" element={<Correlations />} />
                <Route path="/identity" element={<IdentityResolution />} />
                <Route path="/social-graph" element={<SocialGraph />} />
                <Route path="/pipelines" element={<Pipelines />} />
                <Route path="/personas" element={<PersonaDiscovery />} />
                <Route path="/persona-profile" element={<PersonaProfile />} />
                <Route path="/persona-intel" element={<PersonaIntelDashboard />} />
                <Route path="/investigations" element={<InvestigationsRoute />} />
                <Route path="/case-files" element={<RouteAlias to="/investigations" />} />
                <Route path="/training" element={<ErrorBoundary><Training /></ErrorBoundary>} />
                <Route path="/knowledge" element={<ErrorBoundary><KnowledgeBase /></ErrorBoundary>} />
                <Route path="/api" element={<ApiDocs />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/admin" element={<ErrorBoundary><Admin /></ErrorBoundary>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SubscriptionProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter><AppRoutes /></BrowserRouter>
        </TooltipProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
