import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Radio, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const { login, isLoggingIn, loginError } = useAuth();

  // Prefetch the Dashboard chunk in the background while the user is on the
  // login page. In Vite dev mode this triggers transpilation of the entire
  // Dashboard + ControlRoom sub-tree ahead of time, so it is ready to render
  // the moment the login mutation resolves instead of making the user wait for
  // Vite to compile it on-demand after authentication.
  useEffect(() => {
    import("@/pages/dashboard");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(password);
    } catch {}
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Radio className="w-7 h-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">BintuNet Controller</CardTitle>
          <CardDescription>
            Enter your admin password to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                data-testid="input-password"
              />
            </div>
            {loginError && (
              <p className="text-sm text-destructive" data-testid="login-error">
                {loginError.message.includes("401") ? "Invalid password" : loginError.message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={isLoggingIn || !password}
              data-testid="button-login"
            >
              {isLoggingIn ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing in...</>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
