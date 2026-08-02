import type { WidgetConfig, WidgetType, WidgetPosition } from "./types.js";
import { logger } from "../lib/logger.js";

let _runtimeData: Record<string, Record<string, unknown>> = {};

export const WIDGET_DEFAULTS: Record<WidgetType, Partial<WidgetConfig>> = {
  clock: { settings: { format: "HH:mm:ss", timezone: "local", showSeconds: true } },
  date: { settings: { format: "dddd, MMMM D YYYY" } },
  weather: { settings: { city: "", units: "metric" } },
  temperature: { settings: { units: "celsius" } },
  wind: { settings: { units: "kph" } },
  cpu: { settings: { intervalMs: 2000 } },
  ram: { settings: { showUsed: true } },
  network: { settings: { interface: "auto", unit: "Mbps" } },
  bitrate: { settings: { streamId: "all" } },
  fps: { settings: { streamId: "all" } },
  stock: { settings: { symbols: ["AAPL", "GOOGL", "TSLA"] } },
  currency: { settings: { pairs: ["USD/EUR", "USD/GBP"] } },
  crypto: { settings: { coins: ["BTC", "ETH"] } },
  gas: { settings: { region: "US National" } },
  election: { settings: { race: "", candidates: [] } },
  sports: { settings: { sport: "football", league: "" } },
  viewers: { settings: { source: "all" } },
};

export function createWidget(type: WidgetType, position: WidgetPosition = { x: 80, y: 90 }): WidgetConfig {
  const defaults = WIDGET_DEFAULTS[type] ?? {};
  return {
    id: `widget-${type}-${Date.now()}`,
    type,
    enabled: true,
    position,
    settings: { ...(defaults.settings ?? {}) },
  };
}

export function updateWidgetRuntimeData(widgetId: string, data: Record<string, unknown>): void {
  _runtimeData[widgetId] = { ..._runtimeData[widgetId], ...data };
}

export function getWidgetRuntimeData(widgetId: string): Record<string, unknown> {
  return _runtimeData[widgetId] ?? {};
}

export function getAllWidgetRuntimeData(): Record<string, Record<string, unknown>> {
  return { ..._runtimeData };
}

let _clockInterval: ReturnType<typeof setInterval> | null = null;

export function startClockWidgets(widgets: WidgetConfig[]): void {
  stopClockWidgets();
  const clockWidgets = widgets.filter(w => w.enabled && (w.type === "clock" || w.type === "date"));
  if (clockWidgets.length === 0) return;
  _clockInterval = setInterval(() => {
    const now = new Date();
    for (const w of clockWidgets) {
      if (w.type === "clock") {
        updateWidgetRuntimeData(w.id, {
          time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        });
      } else if (w.type === "date") {
        updateWidgetRuntimeData(w.id, {
          date: now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        });
      }
    }
  }, 1000);
}

export function stopClockWidgets(): void {
  if (_clockInterval !== null) {
    clearInterval(_clockInterval);
    _clockInterval = null;
  }
}

export function listWidgetTypes(): WidgetType[] {
  return Object.keys(WIDGET_DEFAULTS) as WidgetType[];
}

export function validateWidget(w: WidgetConfig): { valid: boolean; error?: string } {
  if (!w.id || typeof w.id !== "string") return { valid: false, error: "Missing widget id" };
  if (!listWidgetTypes().includes(w.type)) return { valid: false, error: `Unknown widget type: ${w.type}` };
  if (typeof w.position?.x !== "number" || typeof w.position?.y !== "number")
    return { valid: false, error: "Invalid widget position" };
  return { valid: true };
}
