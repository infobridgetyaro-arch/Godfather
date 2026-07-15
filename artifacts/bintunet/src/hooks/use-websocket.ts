import { useEffect, useRef, useCallback, useState } from "react";

type WSMessage = {
  type: string;
  streamId?: string;
  data?: any;
};

const HEARTBEAT_INTERVAL_MS = 20_000; // send ping every 20 s
const HEARTBEAT_TIMEOUT_MS  = 10_000; // force-close if no pong within 10 s

export function useWebSocket() {
  const wsRef           = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listenersRef    = useRef<Map<string, Set<(msg: WSMessage) => void>>>(new Map());
  const retryDelayRef   = useRef(1000);
  const retryTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current)   { clearInterval(heartbeatRef.current);  heartbeatRef.current  = null; }
    if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null; }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const newWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = newWs;

    newWs.onopen = () => {
      if (!mountedRef.current) { newWs.close(); return; }
      setIsConnected(true);
      retryDelayRef.current = 1000;
      console.debug("[ws] Connected");

      // Start heartbeat ping loop
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        if (newWs.readyState !== WebSocket.OPEN) return;
        try { newWs.send(JSON.stringify({ type: "ping" })); } catch { /* swallow */ }

        // If no pong received within HEARTBEAT_TIMEOUT_MS, force reconnect
        pongTimeoutRef.current = setTimeout(() => {
          console.warn("[ws] Heartbeat timed out — force closing for reconnect");
          stopHeartbeat();
          newWs.close();
        }, HEARTBEAT_TIMEOUT_MS);
      }, HEARTBEAT_INTERVAL_MS);
    };

    newWs.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);

        // Clear pong timeout on any message (server is alive)
        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = null;
        }

        // Skip internal pong messages from propagating to listeners
        if (msg.type === "pong") return;

        const handlers = listenersRef.current.get(msg.type);
        if (handlers) { handlers.forEach((h) => h(msg)); }
        const allHandlers = listenersRef.current.get("*");
        if (allHandlers) { allHandlers.forEach((h) => h(msg)); }
      } catch (e) {
        console.error("[ws] Parse error:", e);
      }
    };

    newWs.onclose = (evt) => {
      stopHeartbeat();
      setIsConnected(false);

      if (!mountedRef.current) return;

      const delay = retryDelayRef.current + Math.random() * 500;
      retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30_000);
      console.debug(`[ws] Disconnected (code=${evt.code}) — retrying in ${Math.round(delay)}ms`);
      retryTimerRef.current = setTimeout(connect, delay);
    };

    newWs.onerror = (err) => {
      console.warn("[ws] Error:", err);
      // onclose fires after onerror; it handles reconnect
      newWs.close();
    };
  // connect is intentionally stable; stopHeartbeat has no deps either
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback((type: string, handler: (msg: WSMessage) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(handler);
    return () => {
      listenersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      stopHeartbeat();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isConnected, subscribe, send };
}
