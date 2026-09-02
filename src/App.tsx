import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import Organizations from "./pages/Organizations";
import ActivityLogs from "./pages/ActivityLogs";
import Alerts from "./pages/Alerts";
import Investigations from "./pages/Investigations";
import Training from "./pages/Training";
import KnowledgeBase from "./pages/KnowledgeBase";
import ApiDocs from "./pages/ApiDocs";
import Pricing from "./pages/Pricing";
import Billing from "./pages/Billing";
import Agents from "./pages/Agents";
import Reports from "./pages/Reports";
import EvidenceExport from "./pages/EvidenceExport";
import Correlations from "./pages/Correlations";
import IdentityResolution from "./pages/IdentityResolution";
import SocialGraph from "./pages/SocialGraph";
import Pipelines from "./pages/Pipelines";
import Admin from "./pages/Admin";
import PersonaDiscovery from "./pages/PersonaDiscovery";
import PersonaProfile from "./pages/PersonaProfile";
import PersonaIntelDashboard from "./pages/PersonaIntelDashboard";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
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
              <Route path="/" element={<Index />} />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/tools" element={<ToolSuite />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/pdl-history" element={<PdlHistory />} />
                <Route path="/organizations" element={<Organizations />} />
                <Route path="/activity" element={<ActivityLogs />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/evidence-export" element={<EvidenceExport />} />
                <Route path="/correlations" element={<Correlations />} />
                <Route path="/identity" element={<IdentityResolution />} />
                <Route path="/social-graph" element={<SocialGraph />} />
                <Route path="/pipelines" element={<Pipelines />} />
                <Route path="/personas" element={<PersonaDiscovery />} />
                <Route path="/persona-profile" element={<PersonaProfile />} />
                <Route path="/persona-intel" element={<PersonaIntelDashboard />} />
                <Route path="/investigations" element={<ErrorBoundary><Investigations /></ErrorBoundary>} />
                <Route path="/training" element={<ErrorBoundary><Training /></ErrorBoundary>} />
                <Route path="/knowledge" element={<ErrorBoundary><KnowledgeBase /></ErrorBoundary>} />
                <Route path="/api" element={<ApiDocs />} />
                <Route path="/pricing" element={<Pricing />} />
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
