import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const LoginPage         = lazy(() => import("@/pages/login"));
const Dashboard         = lazy(() => import("@/pages/dashboard"));
const JoinPage          = lazy(() => import("@/pages/join"));
const CameraPage        = lazy(() => import("@/pages/camera"));
const BroadcastPage     = lazy(() => import("@/pages/broadcast"));
const GatewayPaymentPage = lazy(() => import("@/pages/gateway-payment"));
const NotFound          = lazy(() => import("@/pages/not-found"));

function AuthenticatedRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (window.location.pathname.startsWith("/gateway-payment")) {
    return <GatewayPaymentPage />;
  }

  if (window.location.pathname.startsWith("/join")) {
    return <JoinPage />;
  }

  if (window.location.pathname.startsWith("/camera/")) {
    return <CameraPage />;
  }

  if (window.location.pathname.startsWith("/broadcast")) {
    return <BroadcastPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/join" component={JoinPage} />
      <Route path="/camera/:token" component={CameraPage} />
      <Route path="/broadcast" component={BroadcastPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Suspense fallback={<PageFallback />}>
          <AuthenticatedRouter />
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
