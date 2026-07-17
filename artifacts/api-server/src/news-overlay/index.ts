export {
  initNewsOverlay, shutdownNewsOverlay, emitState, updateOverlay, getCapabilities,
  applyThemeFull, addMessage as addNewsTickerMessage, clearMessages as clearNewsTickerMessages,
  addBreaking as activateBreakingNews, clearBreaking as deactivateBreakingNews,
  updateTickerConfig,
} from "./overlay-manager.js";
export { getState, setState } from "./state-manager.js";
export type { NewsOverlayState, ThemeName, AnimationPreset, TickerStyle, WidgetType } from "./types.js";
export { default as newsOverlayRouter } from "./routes.js";
