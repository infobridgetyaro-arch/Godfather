import { useState, useRef, useEffect } from "react";
import {
  X, Upload, Trash2, CheckCircle2, AlertCircle, Cookie,
  ExternalLink, ShieldCheck, ShieldX, ShieldAlert, Loader2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface CookieValidation {
  valid: boolean;
  format: boolean;
  found: string[];
  missing: string[];
  message: string;
  detail?: string;
}

interface CookiesStatus {
  configured: boolean;
  validation?: CookieValidation;
  lastModified?: string;
  ageDays?: number;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number }
  | { phase: "validating" }
  | { phase: "done"; validation: CookieValidation }
  | { phase: "error"; message: string };

function TokenPill({ name, found }: { name: string; found: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${
        found
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      }`}
    >
      {found ? (
        <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
      ) : (
        <AlertCircle className="w-2.5 h-2.5 shrink-0" />
      )}
      {name}
    </span>
  );
}

function ValidationCard({ validation }: { validation: CookieValidation }) {
  const allTokens = [...validation.found, ...validation.missing];
  return (
    <div
      className={`rounded-xl border p-3.5 space-y-2.5 ${
        validation.valid
          ? "border-emerald-500/30 bg-emerald-500/8"
          : "border-destructive/30 bg-destructive/8"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {validation.valid ? (
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
        ) : validation.format ? (
          <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        ) : (
          <ShieldX className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        )}
        <div className="space-y-1 min-w-0">
          <p
            className={`text-xs font-semibold leading-snug ${
              validation.valid ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
            }`}
          >
            {validation.valid ? "Validation passed" : "Validation failed"}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">{validation.message}</p>
          {validation.detail && (
            <p className="text-xs text-muted-foreground/80 leading-relaxed italic">
              {validation.detail}
            </p>
          )}
        </div>
      </div>

      {allTokens.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Auth tokens
          </p>
          <div className="flex flex-wrap gap-1">
            {validation.found.map((t) => (
              <TokenPill key={t} name={t} found />
            ))}
            {validation.missing.map((t) => (
              <TokenPill key={t} name={t} found={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadProgress({ percent }: { percent: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Uploading…
        </span>
        <span className="font-mono font-semibold tabular-nums">{percent}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function CookiesSection({
  label,
  endpoint,
  hint,
  requiredTokens,
}: {
  label: string;
  endpoint: string;
  hint: string;
  requiredTokens: string[];
}) {
  const [status, setStatus] = useState<CookiesStatus | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(endpoint, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, [endpoint]);

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";

    const form = new FormData();
    form.append("cookies", file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setUploadState({ phase: "uploading", percent: pct });
      }
    });

    xhr.upload.addEventListener("load", () => {
      setUploadState({ phase: "validating" });
    });

    xhr.addEventListener("load", async () => {
      try {
        const data = JSON.parse(xhr.responseText) as {
          ok?: boolean;
          saved?: boolean;
          validation?: CookieValidation;
          message?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && data.validation) {
          setUploadState({ phase: "done", validation: data.validation });
          await fetchStatus();
        } else {
          setUploadState({
            phase: "error",
            message: data.message || `Upload failed (HTTP ${xhr.status}).`,
          });
        }
      } catch {
        setUploadState({ phase: "error", message: "Unexpected server response." });
      }
    });

    xhr.addEventListener("error", () => {
      setUploadState({ phase: "error", message: "Upload failed — check your connection." });
    });

    xhr.open("POST", endpoint);
    xhr.withCredentials = true;
    setUploadState({ phase: "uploading", percent: 0 });
    xhr.send(form);
  };

  const onRemove = async () => {
    setRemoving(true);
    setUploadState({ phase: "idle" });
    try {
      await fetch(endpoint, { method: "DELETE", credentials: "include" });
      await fetchStatus();
    } catch {}
    setRemoving(false);
  };

  const isUploading =
    uploadState.phase === "uploading" || uploadState.phase === "validating";

  const currentValidation =
    uploadState.phase === "done"
      ? uploadState.validation
      : status?.validation ?? null;

  return (
    <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cookie className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm">{label}</span>
        {status && (
          <span
            className={`ml-auto text-xs font-medium flex items-center gap-1 ${
              status.configured && currentValidation?.valid
                ? "text-emerald-500"
                : status.configured
                ? "text-amber-500"
                : "text-muted-foreground"
            }`}
          >
            {status.configured && currentValidation?.valid ? (
              <><CheckCircle2 className="w-3.5 h-3.5" /> Verified</>
            ) : status.configured ? (
              <><AlertCircle className="w-3.5 h-3.5" /> Needs attention</>
            ) : (
              <><AlertCircle className="w-3.5 h-3.5" /> Not configured</>
            )}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>

      {uploadState.phase === "uploading" && (
        <UploadProgress percent={uploadState.percent} />
      )}

      {uploadState.phase === "validating" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          Validating cookies…
        </div>
      )}

      {uploadState.phase === "error" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive leading-relaxed">{uploadState.message}</p>
        </div>
      )}

      {currentValidation && uploadState.phase !== "uploading" && uploadState.phase !== "validating" && (
        <ValidationCard validation={currentValidation} />
      )}

      {status?.ageDays !== undefined && status.ageDays >= 21 && uploadState.phase === "idle" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-600">
              Cookies are {status.ageDays} days old — may be expired
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed mt-0.5">
              YouTube cookies typically expire every 3–4 weeks. If you're seeing bot-detection errors,
              export fresh cookies from a logged-in browser session and replace the file below.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          disabled={isUploading || removing}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
          {isUploading
            ? uploadState.phase === "validating"
              ? "Validating…"
              : "Uploading…"
            : status?.configured
            ? "Replace cookies.txt"
            : "Upload cookies.txt"}
        </Button>
        {status?.configured && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs text-destructive hover:text-destructive"
            disabled={isUploading || removing}
            onClick={onRemove}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {removing ? "Removing…" : "Remove"}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={onUpload}
        />
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Cookie className="w-5 h-5 text-primary" />
              Settings
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Upload browser cookies to authenticate with YouTube, TikTok, and X.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-600">Why cookies are required for YouTube</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            YouTube enforces a <strong>Proof of Origin Token (rqh/1)</strong> on all live stream
            segments. Without a valid browser session, every segment download returns 403 Forbidden
            — regardless of User-Agent or IP. Uploading cookies from your logged-in YouTube session
            gives the server a valid token and unblocks streaming.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">How to export cookies.txt</h3>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>
              Install the <strong>"Get cookies.txt LOCALLY"</strong> extension for Chrome/Edge/Firefox
            </li>
            <li>Log into YouTube (or TikTok) in your browser</li>
            <li>
              Navigate to <code className="bg-muted rounded px-1">youtube.com</code> or{" "}
              <code className="bg-muted rounded px-1">tiktok.com</code>
            </li>
            <li>
              Click the extension icon → Export →{" "}
              <strong>Export as Netscape HTTP Cookie File</strong>
            </li>
            <li>Save the file and upload it below</li>
          </ol>
          <a
            href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
          >
            <ExternalLink className="w-3 h-3" />
            Get cookies.txt LOCALLY (Chrome Web Store)
          </a>
        </div>

        <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-primary" />
            Alternative: store cookies as a Replit Secret
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Instead of uploading a file, you can base64-encode your <code className="bg-muted rounded px-1">cookies.txt</code> and
            store it as a Replit Secret — no file upload needed, and it survives server restarts automatically.
          </p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside leading-relaxed">
            <li>Export your cookies.txt as described above</li>
            <li>
              Run: <code className="bg-muted rounded px-1 font-mono">base64 -w 0 cookies.txt</code> (Linux/Mac) or{" "}
              <code className="bg-muted rounded px-1 font-mono">certutil -encode cookies.txt b64.txt</code> (Windows)
            </li>
            <li>
              Add the result as a Replit Secret:
              <ul className="list-disc list-inside ml-3 mt-0.5 space-y-0.5">
                <li><code className="bg-muted rounded px-1 font-mono">YOUTUBE_COOKIES_B64</code> — for YouTube</li>
                <li><code className="bg-muted rounded px-1 font-mono">FACEBOOK_COOKIES_B64</code> — for Facebook live sources</li>
              </ul>
            </li>
            <li>Restart the API server — cookies are loaded automatically on startup</li>
          </ol>
        </div>

        <CookiesSection
          label="YouTube Cookies"
          endpoint="/api/settings/cookies"
          hint="Required for YouTube live sources. These cookies let yt-dlp authenticate with YouTube's CDN so segment downloads succeed. Alternatively set YOUTUBE_COOKIES_B64 as a Replit Secret (see above)."
          requiredTokens={["SID", "SAPISID", "SSID", "HSID", "APISID"]}
        />

        <CookiesSection
          label="TikTok Cookies"
          endpoint="/api/settings/tiktok-cookies"
          hint="Optional — improves TikTok live stream access. Log in to TikTok in your browser, then export and upload cookies.txt."
          requiredTokens={["sessionid"]}
        />

        <CookiesSection
          label="X (Twitter) Cookies"
          endpoint="/api/settings/x-cookies"
          hint="Required for X Spaces audio. Without this, yt-dlp gets a 'Bad guest token' error. Log in to x.com in your browser, export cookies.txt, and upload it here."
          requiredTokens={["auth_token", "ct0"]}
        />
      </div>
    </div>
  );
}
