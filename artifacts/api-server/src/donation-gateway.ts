/**
 * donation-gateway.ts
 *
 * Self-generating QR Donation system for BintuNet Controller.
 *
 * Responsibilities:
 *  - Detect the current public container URL automatically (REPLIT_DOMAINS)
 *  - Proxy Paystack charge / verify calls from the donation page
 *  - Receive and verify Paystack webhooks (HMAC-SHA512)
 *  - On payment success → emit WebSocket donation_alert to all clients
 *  - Push donation alert into the live overlay renderer (no stream restart)
 *  - Health-check the gateway URL so the QR is never invalid
 */

import { type Express, type Request, type Response } from "express";
import crypto from "crypto";
import { broadcastGlobal, updateStreamOverlays } from "./stream-manager";
import { classifyGift, enqueueGift } from "./gift-system";
import type { GiftQueueItem } from "./gift-system";
import { logger } from "./lib/logger";

// ── URL detection ─────────────────────────────────────────────────────────────

/** Returns the public base URL for this container. */
export function getGatewayBaseUrl(): string {
  // Replit sets REPLIT_DOMAINS (comma-separated) on every deployed/dev container
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const first = domains.split(",")[0]?.trim() ?? "";
  if (first) return `https://${first}`;

  // Dev environment secondary fallback
  const dev = process.env.REPLIT_DEV_DOMAIN ?? "";
  if (dev) return `https://${dev}`;

  return "";
}

/** Returns the full public URL to the /gateway-payment page. */
export function getGatewayPaymentUrl(): string {
  const base = getGatewayBaseUrl();
  return base ? `${base}/gateway-payment` : "";
}

// ── Paystack helpers ──────────────────────────────────────────────────────────

const PAYSTACK_BASE = "https://api.paystack.co";
const paystackKey = (): string => process.env.PAYSTACK_SECRET_KEY ?? "";

async function paystackPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = paystackKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function paystackGet(path: string): Promise<Record<string, unknown>> {
  const key = paystackKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Webhook signature verification ────────────────────────────────────────────

function verifyPaystackSignature(rawBody: Buffer | string, signature: string): boolean {
  const key = paystackKey();
  if (!key || !signature) return false;
  const hash = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
  return hash === signature;
}

// ── Phone number formatting (Kenyan) ─────────────────────────────────────────

function formatKenyanNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if ((digits.startsWith("07") || digits.startsWith("01")) && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `+254${digits}`;
  return null;
}

// ── Donation amount tier coloring ─────────────────────────────────────────────

function donationColor(amountKes: number): string {
  if (amountKes >= 5000) return "#B71C1C";
  if (amountKes >= 2000) return "#AD1457";
  if (amountKes >= 1000) return "#E65100";
  if (amountKes >= 500)  return "#F57F17";
  if (amountKes >= 200)  return "#00695C";
  if (amountKes >= 100)  return "#006064";
  return "#1565C0";
}

// ── QR scan counter ────────────────────────────────────────────────────────────

let qrScanCount = 0;
export function getQRScanCount(): number { return qrScanCount; }

// ── Gift queue (server-side authoritative queue for overlay renderers) ─────────

let serverGiftQueue: GiftQueueItem[] = [];
export function getGiftQueue(): GiftQueueItem[] { return serverGiftQueue; }

// ── Donation record store ─────────────────────────────────────────────────────

export interface DonationRecord {
  id: string;
  name: string;
  amount: string;
  amountKes: number;
  currency: string;
  message: string;
  channel: string;
  reference: string;
  color: string;
  ts: number;
}

const donationLog: DonationRecord[] = [];
const emittedRefs = new Set<string>();

export function getDonationLog(): DonationRecord[] {
  return donationLog.slice(-50);
}

export function getTotalRaised(): number {
  return donationLog.reduce((sum, d) => sum + d.amountKes, 0);
}

// ── Donation callback (set by bintunet-routes.ts) ─────────────────────────────

type DonationCallback = (donation: DonationRecord) => void;
let _onDonation: DonationCallback | null = null;

export function setDonationCallback(cb: DonationCallback): void {
  _onDonation = cb;
}

// ── Health check ──────────────────────────────────────────────────────────────
// No self-ping — that was unreliable in Replit's proxied environment.
// Gateway is healthy when a Paystack key is configured AND a URL is derivable.

export function isGatewayHealthy(): boolean {
  // Only check Paystack key — the gateway URL is always auto-derived from
  // the incoming request host, so it is never null in practice.
  return !!paystackKey();
}

// ── Internal donation emit ────────────────────────────────────────────────────

async function handleDonationEvent(d: {
  name: string;
  amountKes: number;
  currency: string;
  message: string;
  channel: string;
  reference: string;
  color: string;
}): Promise<void> {
  if (emittedRefs.has(d.reference)) return;
  emittedRefs.add(d.reference);

  const record: DonationRecord = {
    id: crypto.randomUUID(),
    name: d.name,
    amount: `${d.currency} ${d.amountKes.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
    amountKes: d.amountKes,
    currency: d.currency,
    message: d.message,
    channel: d.channel,
    reference: d.reference,
    color: d.color,
    ts: Date.now(),
  };

  donationLog.push(record);
  if (donationLog.length > 200) donationLog.shift();

  logger.info({ name: record.name, amount: record.amount }, "[gateway] 💚 Donation received");

  // Notify bintunet-routes.ts (which updates broadcastState + pushes to overlay)
  if (_onDonation) _onDonation(record);

  // Also broadcast WebSocket event to all dashboard clients
  broadcastGlobal("donation_alert", {
    id: record.id,
    name: record.name,
    amount: record.amount,
    amountKes: record.amountKes,
    currency: record.currency,
    message: record.message,
    channel: record.channel,
    color: record.color,
    ts: record.ts,
  });

  // ── Gift economy: classify → enqueue → push to overlay → broadcast ──────────
  const gift = classifyGift(record.amountKes);
  serverGiftQueue = enqueueGift(serverGiftQueue, {
    id:         record.id,
    donorName:  record.name,
    amount:     record.amount,
    amountKes:  record.amountKes,
    message:    record.message,
    gift,
    ts:         record.ts,
  });
  updateStreamOverlays({ giftQueue: serverGiftQueue });
  // Find the queue item (may be the combo-updated item rather than a new one)
  const queuedItem = serverGiftQueue.find(
    (g) => g.donorName === record.name && g.gift.id === gift.id,
  ) ?? serverGiftQueue[serverGiftQueue.length - 1];
  broadcastGlobal("gift_received", {
    id:         record.id,
    donorName:  record.name,
    amount:     record.amount,
    amountKes:  record.amountKes,
    message:    record.message,
    gift,
    ts:         record.ts,
    comboCount: queuedItem?.comboCount ?? 1,
  });

  // QR thank-you animation: swap QR for donor card for 10 s
  const firstName = record.name.split(" ")[0] ?? record.name;
  updateStreamOverlays({ qrThankYouActive: true, qrThankYouName: firstName, qrThankYouTs: record.ts });
  broadcastGlobal("qr_thank_you", { name: firstName, amount: record.amount, ts: record.ts });
  setTimeout(() => {
    updateStreamOverlays({ qrThankYouActive: false, qrThankYouName: "", qrThankYouTs: 0 });
  }, 11_000);
}

async function handleSuccessfulPayment(data: Record<string, unknown>): Promise<void> {
  const reference = (data["reference"] as string) ?? crypto.randomUUID();
  const amountKobo = (data["amount"] as number) ?? 0;
  const amountKes = amountKobo / 100;
  const currency = (data["currency"] as string) ?? "KES";
  const channel = (data["channel"] as string) ?? "unknown";
  const metadata = data["metadata"] as Record<string, unknown> | undefined;
  const customFields = (metadata?.["custom_fields"] as Array<{ variable_name: string; value: string }>) ?? [];
  const donorField = customFields.find(f => f.variable_name === "donor_name");
  const customer = data["customer"] as Record<string, string> | undefined;
  // first_name + last_name are set on the charge for M-Pesa; full name is also on customer.name
  const customerFullName = customer?.["name"] || (
    [customer?.["first_name"], customer?.["last_name"]].filter(Boolean).join(" ")
  );
  const name = donorField?.value || customerFullName || "Anonymous";
  const message = (metadata?.["message"] as string) ?? "";

  await handleDonationEvent({ name, amountKes, currency, message, channel, reference, color: donationColor(amountKes) });
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerDonationGateway(app: Express): void {

  // ── POST /api/gateway/scan ───────────────────────────────────────────────
  // Called from the public donation page on every page load (QR scan).
  app.post("/api/gateway/scan", (_req: Request, res: Response): void => {
    qrScanCount++;
    broadcastGlobal("qr_scan", { count: qrScanCount });
    updateStreamOverlays({ qrScanCount });
    res.json({ count: qrScanCount });
  });

  // ── GET /api/gateway/url ─────────────────────────────────────────────────
  app.get("/api/gateway/url", (req: Request, res: Response): void => {
    let url = getGatewayPaymentUrl();

    // Fallback: derive from the incoming request host so it works in every
    // Replit environment (dev, preview, deployed) even when REPLIT_DOMAINS
    // and REPLIT_DEV_DOMAIN are not set.
    if (!url) {
      const forwardedHost = (req.headers["x-forwarded-host"] as string | undefined)
        ?.split(",")[0]?.trim();
      const host = forwardedHost || req.headers.host || "";
      if (host) {
        const proto = (req.headers["x-forwarded-proto"] as string | undefined) || "https";
        url = `${proto}://${host}/gateway-payment`;
      }
    }

    const base = url ? url.replace("/gateway-payment", "") : getGatewayBaseUrl();
    res.json({
      gatewayUrl: url,
      baseUrl: base,
      configured: !!url,
      paystackConfigured: !!paystackKey(),
    });
  });

  // ── GET /api/gateway/health ──────────────────────────────────────────────
  app.get("/api/gateway/health", async (_req: Request, res: Response): Promise<void> => {
    const healthy = isGatewayHealthy();
    res.json({
      status: healthy ? "ok" : "unreachable",
      gatewayUrl: getGatewayPaymentUrl(),
      paystackConfigured: !!paystackKey(),
      totalRaised: getTotalRaised(),
      donationCount: donationLog.length,
      ts: new Date().toISOString(),
    });
  });

  // ── GET /api/gateway/donations ───────────────────────────────────────────
  app.get("/api/gateway/donations", (_req: Request, res: Response): void => {
    res.json({
      donations: getDonationLog(),
      totalRaised: getTotalRaised(),
      count: donationLog.length,
    });
  });

  // ── POST /api/gateway/charge ─────────────────────────────────────────────
  app.post("/api/gateway/charge", async (req: Request, res: Response): Promise<void> => {
    if (!paystackKey()) {
      res.json({ status: false, message: "Payment gateway is not configured. Add PAYSTACK_SECRET_KEY to environment secrets." });
      return;
    }

    const body = req.body as Record<string, string>;
    const action = body["action"] ?? "";

    // ── M-Pesa STK push ──────────────────────────────────────────────────
    if (action === "mpesa") {
      const { amount, phone, name } = body;
      if (!amount || !phone) { res.json({ status: false, message: "Amount and phone are required." }); return; }
      const formatted = formatKenyanNumber(phone);
      if (!formatted) { res.json({ status: false, message: "Invalid phone. Use 07XXXXXXXX or 01XXXXXXXX." }); return; }
      const email = `donor_${formatted.replace("+", "")}@bintunet.live`;
      try {
        // Build a clean display name — "John" → email stays generic but
      // Paystack will store the name on the customer record.
      const displayName = (name || "").trim() || "Anonymous";
      const nameParts = displayName.split(/\s+/);
      const firstName = nameParts[0] ?? displayName;
      const lastName  = nameParts.slice(1).join(" ") || "";
      const data = await paystackPost("/charge", {
          email,
          amount: Math.round(parseFloat(amount) * 100),
          currency: "KES",
          first_name: firstName,
          last_name:  lastName || undefined,
          mobile_money: { phone: formatted, provider: "mpesa" },
          metadata: {
            donor_name: displayName,
            source: "bintunet-donation",
            custom_fields: [{ display_name: "Donor Name", variable_name: "donor_name", value: displayName }],
          },
        });
        if (data["status"] === true) {
          const inner = data["data"] as Record<string, unknown>;
          res.json({ status: true, data: { reference: inner["reference"], status: inner["status"], gateway_response: inner["gateway_response"] ?? "" } });
        } else {
          res.json(data);
        }
      } catch (err) {
        res.json({ status: false, message: err instanceof Error ? err.message : "Gateway error." });
      }
      return;
    }

    // ── Card charge ──────────────────────────────────────────────────────
    if (action === "card") {
      const { amount, card_number, expiry, cvv, name } = body;
      if (!amount || !card_number || !expiry || !cvv || !name) {
        res.json({ status: false, message: "All card fields and amount are required." }); return;
      }
      const parts = expiry.split("/");
      if (parts.length !== 2) { res.json({ status: false, message: "Invalid expiry. Use MM/YY." }); return; }
      const expiryMonth = parts[0]!.trim().padStart(2, "0");
      const rawYear = parts[1]!.trim();
      const expiryYear = rawYear.length === 2 ? `20${rawYear}` : rawYear;
      const last4 = card_number.slice(-4);
      const email = `donor_card_${last4}_${Date.now()}@bintunet.live`;
      try {
        const data = await paystackPost("/charge", {
          email,
          amount: Math.round(parseFloat(amount) * 100),
          currency: "KES",
          card: { number: card_number, cvv, expiry_month: expiryMonth, expiry_year: expiryYear },
          metadata: {
            donor_name: name,
            source: "bintunet-donation",
            custom_fields: [
              { display_name: "Donor Name", variable_name: "donor_name", value: name },
              { display_name: "Card Last 4", variable_name: "card_last4", value: last4 },
            ],
          },
        });
        if (data["status"] !== true) {
          res.json({ status: false, message: (data["message"] as string) ?? "Card charge rejected." }); return;
        }
        const inner = data["data"] as Record<string, unknown>;
        const txStatus = (inner["status"] as string) ?? "";
        const reference = inner["reference"] as string;
        if (txStatus === "failed") { res.json({ status: false, message: (inner["gateway_response"] as string) ?? "Card declined." }); return; }
        if (txStatus === "success") { res.json({ status: true, data: { reference, status: "success", gateway_response: (inner["gateway_response"] as string) ?? "Approved" } }); return; }
        if (txStatus === "pay_offline" || txStatus === "open_url") {
          const redirectUrl = (inner["redirecturl"] as string) ?? (inner["url"] as string) ?? "";
          res.json({ status: true, data: { reference, status: "pay_offline", gateway_response: (inner["display_text"] as string) || "Redirecting to bank", redirect_url: redirectUrl, display_text: (inner["display_text"] as string) ?? "" } }); return;
        }
        res.json({ status: true, data: { reference, status: txStatus, gateway_response: (inner["gateway_response"] as string) ?? "Processing", display_text: (inner["display_text"] as string) ?? "" } });
      } catch (err) {
        res.json({ status: false, message: err instanceof Error ? err.message : "Gateway error." });
      }
      return;
    }

    // ── Submit OTP / PIN / address / phone / birthday ────────────────────
    const submitMap: Record<string, { endpoint: string; bodyKey: string }> = {
      submit_otp:      { endpoint: "/charge/submit_otp",      bodyKey: "otp" },
      submit_pin:      { endpoint: "/charge/submit_pin",      bodyKey: "pin" },
      submit_address:  { endpoint: "/charge/submit_address",  bodyKey: "address" },
      submit_phone:    { endpoint: "/charge/submit_phone",    bodyKey: "phone" },
      submit_birthday: { endpoint: "/charge/submit_birthday", bodyKey: "birthday" },
    };
    if (action in submitMap) {
      const { endpoint, bodyKey } = submitMap[action]!;
      const value = body[bodyKey] ?? body["value"] ?? "";
      const reference = body["reference"] ?? "";
      if (!value || !reference) { res.json({ status: false, message: `${bodyKey} and reference are required.` }); return; }
      try {
        const data = await paystackPost(endpoint, { [bodyKey]: value, reference });
        if (data["status"] === true) {
          const inner = data["data"] as Record<string, unknown>;
          const innerStatus = (inner["status"] as string) ?? "";
          const normStatus = innerStatus === "open_url" ? "pay_offline" : innerStatus;
          const redirectUrl = (inner["url"] as string) ?? (inner["redirecturl"] as string) ?? "";
          res.json({ status: true, data: { reference, status: normStatus, gateway_response: (inner["gateway_response"] as string) ?? "", display_text: (inner["display_text"] as string) ?? "", ...(redirectUrl ? { redirect_url: redirectUrl } : {}) } });
        } else {
          res.json({ status: false, message: (data["message"] as string) ?? "Rejected." });
        }
      } catch (err) {
        res.json({ status: false, message: err instanceof Error ? err.message : "Gateway error." });
      }
      return;
    }

    res.json({ status: false, message: "Invalid action." });
  });

  // ── GET /api/gateway/verify ──────────────────────────────────────────────
  app.get("/api/gateway/verify", async (req: Request, res: Response): Promise<void> => {
    const reference = (req.query["reference"] as string) ?? "";
    if (!reference) { res.json({ status: false, message: "Reference required." }); return; }
    try {
      const data = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (data["status"] === true) {
        const inner = data["data"] as Record<string, unknown>;
        const txStatus = (inner["status"] as string) ?? "";
        // Webhook is the primary success path; verify is the client-side fallback
        if (txStatus === "success") {
          void handleSuccessfulPayment(inner);
        }
        res.json({ status: true, data: { status: txStatus, gateway_response: (inner["gateway_response"] as string) ?? "", display_text: (inner["display_text"] as string) ?? "", channel: inner["channel"] ?? "", amount: inner["amount"], currency: inner["currency"] ?? "KES" } });
      } else {
        res.json(data);
      }
    } catch (err) {
      res.json({ status: false, message: err instanceof Error ? err.message : "Verify error." });
    }
  });

  // ── POST /api/webhook/paystack ───────────────────────────────────────────
  // Raw body is captured via the verify callback in express.json() (set in app.ts)
  app.post("/api/webhook/paystack", async (req: Request, res: Response): Promise<void> => {
    // Respond 200 immediately — Paystack times out at 5s
    res.sendStatus(200);

    const signature = (req.headers["x-paystack-signature"] as string) ?? "";
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (rawBody && signature && paystackKey()) {
      if (!verifyPaystackSignature(rawBody, signature)) {
        logger.warn("[gateway] Paystack webhook: signature mismatch — ignoring");
        return;
      }
    }

    const event = req.body as Record<string, unknown>;
    const eventType = (event["event"] as string) ?? "";
    const data = event["data"] as Record<string, unknown> | undefined;

    logger.info({ eventType }, "[gateway] Paystack webhook received");

    if ((eventType === "charge.success" || eventType === "transfer.success") && data) {
      await handleSuccessfulPayment(data);
    }
  });
}
