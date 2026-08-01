import { useCallback } from "react";
import type { StreamConfig } from "@/types/schema";

const STORAGE_KEY = "bintunet:stream_drafts";
const VERSION = 1;

type DraftConfig = Omit<StreamConfig, "id" | "status" | "uploadedVideoPath">;

interface DraftStore {
  version: number;
  savedAt: number;
  drafts: DraftConfig[];
}

function readStore(): DraftStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftStore;
    if (parsed.version !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(drafts: DraftConfig[]): void {
  try {
    const store: DraftStore = { version: VERSION, savedAt: Date.now(), drafts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

/** Strip server-only fields before saving. */
function toDraft(stream: StreamConfig): DraftConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, status, uploadedVideoPath, ...rest } = stream;
  return rest;
}

export function useStreamDrafts() {
  /** Save the full current stream list as drafts. Call after every update. */
  const saveDrafts = useCallback((streams: StreamConfig[]) => {
    if (streams.length === 0) return;
    writeStore(streams.map(toDraft));
  }, []);

  /** Read saved drafts (null → nothing saved or version mismatch). */
  const loadDrafts = useCallback((): DraftConfig[] | null => {
    const store = readStore();
    if (!store || store.drafts.length === 0) return null;
    return store.drafts;
  }, []);

  /** Return the timestamp of the last save, or null. */
  const savedAt = useCallback((): Date | null => {
    const store = readStore();
    return store ? new Date(store.savedAt) : null;
  }, []);

  /** Wipe saved drafts (e.g. user explicitly dismissed the restore banner). */
  const clearDrafts = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return { saveDrafts, loadDrafts, savedAt, clearDrafts };
}
