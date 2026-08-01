import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Radio, CheckCircle, XCircle, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function JoinPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [status, setStatus] = useState<"pending" | "claiming" | "redirecting" | "success" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState("");

  const token = new URLSearchParams(window.location.search).get("token");

  const claimAndRedirectToCamera = async (tok: string) => {
    setStatus("claiming");
    try {
      await apiRequest("POST", "/api/invite/claim", { token: tok });
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message?.includes("401") ? "Invalid or expired invite link." : (e.message || "Failed to join"));
      return;
    }

    setStatus("redirecting");
    try {
      const resp = await apiRequest("POST", "/api/invite/camera-token", {});
      const data = await resp.json();
      window.location.href = data.url;
    } catch {
      window.location.href = "/";
    }
  };

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      setStatus("redirecting");
      apiRequest("POST", "/api/invite/camera-token", {})
        .then((resp) => resp.json())
        .then((data: any) => { window.location.href = data.url; })
        .catch(() => { window.location.href = "/"; });
      return;
    }

    if (!token) {
      setStatus("error");
      setErrorMsg("No invite token found in the URL.");
      return;
    }

    void claimAndRedirectToCamera(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAuthenticated, isLoading]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Radio className="w-7 h-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">BintuNet</CardTitle>
          <CardDescription>Joining as camera guest…</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-4">
          {(status === "pending" || status === "claiming" || isLoading) && (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Verifying invite link…</p>
            </>
          )}
          {status === "redirecting" && (
            <>
              <Camera className="w-8 h-8 text-primary animate-pulse" />
              <p className="text-sm text-muted-foreground">Opening camera studio…</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="w-10 h-10 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600">Access granted! Redirecting…</p>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="w-10 h-10 text-destructive" />
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
              <Button variant="outline" size="sm" onClick={() => { window.location.href = "/"; }}>
                Back to login
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
