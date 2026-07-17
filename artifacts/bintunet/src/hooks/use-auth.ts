import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthToken, setAuthToken, queryClient } from "@/lib/queryClient";

async function authFetch(url: string, init?: RequestInit) {
  const token = getAuthToken();
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<{ authenticated: boolean } | null>({
    queryKey: ["/api/auth/check"],
    queryFn: async () => {
      try {
        const res = await authFetch("/api/auth/check");
        if (res.status === 401) return { authenticated: false };
        return await res.json();
      } catch {
        return { authenticated: false };
      }
    },
    staleTime: 30000,
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Login failed" }));
        throw new Error(err.message || "Login failed");
      }
      const data = await res.json();
      if (data.token) setAuthToken(data.token);
      return data;
    },
    onSuccess: () => {
      // Set auth state synchronously — no extra network round-trip needed.
      // We already know the user is authenticated from the login response;
      // invalidateQueries would trigger an unnecessary refetch of /api/auth/check
      // which keeps the login page visible for an extra network RTT before the
      // dashboard renders.
      queryClient.setQueryData(["/api/auth/check"], { authenticated: true });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await authFetch("/api/auth/logout", { method: "POST" });
      setAuthToken(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/check"] });
    },
  });

  return {
    isAuthenticated: user?.authenticated ?? false,
    isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
  };
}
