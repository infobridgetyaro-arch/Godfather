/**
 * gateway-payment.tsx
 *
 * Public donation page at /gateway-payment
 * QR code on the stream links here — no login required.
 * Calls BintuNet's own /api/gateway/* endpoints (Paystack proxy).
 */

import { useState, useEffect, useCallback, useRef } from "react";

type View = "checkout" | "status" | "otp" | "threeds" | "receipt" | "error";
type Method = "mpesa" | "card";

interface CardState { number: string; expiry: string; cvv: string; name: string }
interface ReceiptData { amount: string; method: Method; masked: string; reference: string }

const GREEN      = "#22c55e";
const MPESA_GREEN = "#00a651";
const DARK       = "#0f172a";

/* ── Shared sheet / input styles ────────────────────────────────────────── */
const SHEET: React.CSSProperties = {
  position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 10000,
  background: "#fff", borderRadius: "24px 24px 0 0",
  padding: "20px 20px 36px", transition: "transform 0.38s cubic-bezier(.32,1.1,.58,1)",
  maxHeight: "94vh", overflowY: "auto",
  boxShadow: "0 -12px 60px rgba(0,0,0,0.22)",
};
const IW: React.CSSProperties = { display: "flex", flexDirection: "column", marginBottom: 14 };
const IL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" };
const IF: React.CSSProperties = {
  padding: "13px 16px", borderRadius: 12, border: "1.5px solid #e5e7eb",
  fontSize: 15, outline: "none", background: "#f9fafb", color: "#111827",
  transition: "border-color 0.2s, box-shadow 0.2s",
};
const BTN: React.CSSProperties = {
  width: "100%", padding: "15px", borderRadius: 100, fontSize: 15, fontWeight: 700,
  cursor: "pointer", border: "none", background: GREEN, color: "#fff", marginBottom: 12,
  transition: "background 0.2s, transform 0.1s",
};
const DRAG = (
  <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
    <div style={{ width: 44, height: 4, borderRadius: 99, background: "#e5e7eb" }} />
  </div>
);

function formatCardNumber(v: string) {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function fmtCountdown(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function HeartIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={GREEN} stroke="none">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

/* ── Animated Credit Card ────────────────────────────────────────────────── */
function CardPreview({ card, flipped }: { card: CardState; flipped: boolean }) {
  const num = card.number.replace(/\s/g, "").padEnd(16, "·");
  const groups = [num.slice(0,4), num.slice(4,8), num.slice(8,12), num.slice(12,16)];
  const displayNum = groups.join("  ");
  const displayName = card.name.trim() || "CARDHOLDER NAME";
  const displayExpiry = card.expiry || "MM/YY";

  const cardType = (() => {
    const n = card.number.replace(/\s/g, "");
    if (/^4/.test(n)) return "visa";
    if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return "mastercard";
    if (/^3[47]/.test(n)) return "amex";
    return null;
  })();

  return (
    <div style={{ perspective: 1000, width: "100%", marginBottom: 6 }}>
      <div style={{
        position: "relative", width: "100%", paddingBottom: "58%",
        transformStyle: "preserve-3d",
        transition: "transform 0.65s cubic-bezier(0.4,0.2,0.2,1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        {/* ── Front ── */}
        <div style={{
          position: "absolute", inset: 0, backfaceVisibility: "hidden",
          borderRadius: 18, overflow: "hidden",
          background: "linear-gradient(135deg, #1e2a5e 0%, #0d1b3e 45%, #162a1c 100%)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.40), 0 4px 16px rgba(0,0,0,0.25)",
          padding: "22px 26px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 18,
            background: "linear-gradient(120deg, rgba(255,255,255,0.07) 0%, transparent 55%, rgba(255,255,255,0.04) 100%)",
            pointerEvents: "none" }} />
          {/* Decorative circles */}
          <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.04)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -30, left: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.03)", pointerEvents: "none" }} />

          {/* Chip + Brand */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{
              width: 40, height: 30, borderRadius: 6,
              background: "linear-gradient(135deg, #d4af37 0%, #f7e57c 45%, #c8a227 100%)",
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.6), 0 2px 5px rgba(0,0,0,0.35)",
              display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr",
              gap: 3, padding: 6,
            }}>
              {[0,1,2,3].map(i => <div key={i} style={{ borderRadius: 2, background: "rgba(0,0,0,0.2)" }} />)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.5 }}>
                <path d="M7 12c0-2.76 2.24-5 5-5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M10 12c0-1.1.9-2 2-2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M4 12c0-4.42 3.58-8 8-8" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {cardType === "visa" && <span style={{ fontSize: 20, fontWeight: 900, fontStyle: "italic", color: "#fff", fontFamily: "Georgia, serif", letterSpacing: 1 }}>VISA</span>}
              {cardType === "mastercard" && (
                <div style={{ position: "relative", width: 38, height: 24 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#eb001b", position: "absolute", left: 0 }} />
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#f79e1b", position: "absolute", left: 14, mixBlendMode: "screen" }} />
                </div>
              )}
              {cardType === "amex" && <span style={{ fontSize: 14, fontWeight: 900, color: "#60a5fa", letterSpacing: 1 }}>AMEX</span>}
              {!cardType && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>CARD</span>}
            </div>
          </div>

          {/* Number */}
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 4, textShadow: "0 2px 6px rgba(0,0,0,0.5)", marginTop: 10 }}>
            {displayNum}
          </div>

          {/* Name + Expiry */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Card Holder</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Expires</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: 2 }}>{displayExpiry}</div>
            </div>
          </div>
        </div>

        {/* ── Back ── */}
        <div style={{
          position: "absolute", inset: 0, backfaceVisibility: "hidden",
          transform: "rotateY(180deg)", borderRadius: 18, overflow: "hidden",
          background: "linear-gradient(135deg, #1e2a5e 0%, #0d1b3e 100%)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.40)",
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <div style={{ width: "100%", height: 44, background: "#0a0f1e", marginBottom: 20 }} />
          <div style={{ padding: "0 26px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 38, background: "repeating-linear-gradient(90deg, #fff 0, #f5f5f5 1px, #fff 2px)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 14 }}>
              <span style={{ color: "#111", fontFamily: "monospace", fontSize: 16, fontWeight: 700, letterSpacing: 5 }}>
                {card.cvv ? card.cvv.replace(/./g, "•") : "•••"}
              </span>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>CVV</div>
              {cardType === "visa" && <span style={{ fontSize: 14, fontWeight: 900, fontStyle: "italic", color: "#fff", fontFamily: "Georgia, serif" }}>VISA</span>}
              {cardType === "mastercard" && (
                <div style={{ position: "relative", width: 32, height: 20 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#eb001b", position: "absolute", left: 0 }} />
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f79e1b", position: "absolute", left: 12, mixBlendMode: "screen" }} />
                </div>
              )}
            </div>
          </div>
          <div style={{ padding: "16px 26px 0", fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
            Tap CVV field above to reveal
          </div>
        </div>
      </div>
      {/* Flip hint */}
      <div style={{ textAlign: "center", marginTop: 8, marginBottom: 16, fontSize: 11, color: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        Focus the CVV field to flip card
      </div>
    </div>
  );
}

/* ── Card brand badges ───────────────────────────────────────────────────── */
function CardBrands() {
  return (
    <div style={{ marginBottom: 18 }}>
      {/* Security row */}
      <div style={{
        background: "linear-gradient(135deg, #f0fdf4 0%, #f8faff 100%)",
        border: "1px solid #d1fae5",
        borderRadius: 12, padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>Secured Payment</div>
          <div style={{ fontSize: 10, color: "#4ade80", marginTop: 1 }}>256-bit SSL · PCI DSS Compliant · Paystack Encrypted</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {/* Visa badge */}
          <div style={{ background: "#1a1f71", borderRadius: 6, padding: "4px 10px", display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 900, fontStyle: "italic", color: "#fff", fontFamily: "Georgia, serif", letterSpacing: 0.5 }}>VISA</span>
          </div>
          {/* Mastercard */}
          <div style={{ background: "#1c1c1e", borderRadius: 6, padding: "4px 8px", display: "flex", alignItems: "center" }}>
            <div style={{ position: "relative", width: 26, height: 16, display: "flex", alignItems: "center" }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#eb001b", position: "absolute", left: 0 }} />
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#f79e1b", position: "absolute", left: 9, opacity: 0.9 }} />
            </div>
          </div>
        </div>
      </div>
      {/* Field group label */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Card Details</span>
      </div>
    </div>
  );
}

/* ── M-Pesa branding header ─────────────────────────────────────────────── */
function MpesaBanner() {
  return (
    <div style={{
      background: "linear-gradient(135deg, #00a651 0%, #007a3a 100%)",
      borderRadius: 16, padding: "16px 20px", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 14,
      boxShadow: "0 4px 20px rgba(0,166,81,0.25)",
    }}>
      {/* M-Pesa icon */}
      <div style={{
        width: 48, height: 48, borderRadius: 12, background: "rgba(255,255,255,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.25)",
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2"/>
          <circle cx="12" cy="17" r="1.2" fill="#fff" stroke="none"/>
          <path d="M9 7h6"/>
          <path d="M9 10h4"/>
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>M-Pesa Payment</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 }}>An STK push will be sent to your phone</div>
      </div>
      <div style={{ marginLeft: "auto", background: "rgba(255,255,255,0.2)", borderRadius: 8, padding: "4px 10px" }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", letterSpacing: "0.05em" }}>INSTANT</span>
      </div>
    </div>
  );
}

export default function GatewayPaymentPage() {
  const [isOpen, setIsOpen]       = useState(false);
  const [view, setView]           = useState<View>("checkout");
  const [method, setMethod]       = useState<Method>("mpesa");
  const [amount, setAmount]       = useState("");
  const [phone, setPhone]         = useState("");
  const [donorName, setDonorName] = useState("");
  const [card, setCard]           = useState<CardState>({ number: "", expiry: "", cvv: "", name: "" });
  const [cardFlipped, setCardFlipped] = useState(false);
  const [receipt, setReceipt]     = useState<ReceiptData | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const [countdown, setCountdown] = useState(120);
  const [statusTitle, setStatusTitle] = useState("Processing…");
  const [statusDesc,  setStatusDesc]  = useState("Please wait while we confirm your payment.");
  const [reference, setReference] = useState("");
  const [otpCode, setOtpCode]     = useState("");
  const [otpAction, setOtpAction] = useState("submit_otp");
  const [otpLabel, setOtpLabel]   = useState("Enter OTP");
  const [otpHint, setOtpHint]     = useState("Check your phone for the OTP code.");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [iframeLoading, setIframeLoading] = useState(true);
  const [copied, setCopied]       = useState(false);
  const [healthy, setHealthy]     = useState<boolean | null>(null);
  const cvvRef = useRef<HTMLInputElement>(null);

  const vis = (v: View) => view === v;

  useEffect(() => {
    fetch("/api/gateway/scan", { method: "POST" }).catch(() => {});
    fetch("/api/gateway/health")
      .then(r => r.json())
      .then((d: { status: string }) => setHealthy(d.status === "ok"))
      .catch(() => setHealthy(false));
  }, []);

  useEffect(() => {
    if (!reference || view !== "status") return;
    let cancelled = false;
    const POLL_INTERVAL = 4000;
    const MAX_POLLS = 30;
    let polls = 0;

    const tick = async () => {
      if (cancelled || polls >= MAX_POLLS) {
        if (!cancelled) {
          setStatusTitle("Timed Out");
          setStatusDesc("We couldn't confirm your payment. Please check your phone and try again.");
        }
        return;
      }
      polls++;
      try {
        const r = await fetch(`/api/gateway/verify?reference=${encodeURIComponent(reference)}`);
        const d = await r.json() as { status: boolean; data?: { status: string; gateway_response: string; channel: string; amount: number } };
        if (!cancelled && d.status && d.data) {
          const s = d.data.status;
          if (s === "success") {
            const amountKes = (d.data.amount ?? 0) / 100;
            setReceipt({
              amount: `KES ${amountKes.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
              method,
              masked: method === "mpesa" ? phone.slice(-4).padStart(phone.length, "*") : `**** **** **** ${card.number.replace(/\s/g, "").slice(-4)}`,
              reference,
            });
            setView("receipt");
            return;
          }
          if (s === "failed") {
            setErrorMsg(d.data.gateway_response || "Payment was declined. Please try again.");
            setView("error");
            return;
          }
        }
      } catch {}
      if (!cancelled) setTimeout(tick, POLL_INTERVAL);
    };

    const timer = setTimeout(tick, 3000);
    const cdTimer = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(cdTimer); };
  }, [reference, view]);

  const showError = useCallback((msg: string) => { setErrorMsg(msg); setView("error"); }, []);

  const processMpesa = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt < 1) { showError("Enter a valid amount (minimum KES 1)."); return; }
    if (!phone) { showError("Enter your M-Pesa phone number."); return; }
    setCountdown(120); setStatusTitle("Sending STK Push…"); setStatusDesc("An M-Pesa prompt is being sent to your phone. Enter your PIN to confirm.");
    setView("status");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mpesa", amount, phone, name: donorName || "Anonymous" }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { reference: string; status: string } };
      if (!d.status) { showError(d.message || "Could not initiate payment."); return; }
      setReference(d.data?.reference ?? "");
    } catch { showError("Network error. Please try again."); }
  }, [amount, phone, donorName, showError]);

  const processCard = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt < 1) { showError("Enter a valid amount (minimum KES 1)."); return; }
    const cleanCard = card.number.replace(/\s/g, "");
    if (cleanCard.length < 13) { showError("Enter a valid card number."); return; }
    if (!card.expiry || !card.cvv || !card.name) { showError("All card fields are required."); return; }
    setCountdown(120); setStatusTitle("Processing Card…"); setStatusDesc("Verifying your card details securely.");
    setView("status");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "card", amount, card_number: cleanCard, expiry: card.expiry, cvv: card.cvv, name: card.name }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { reference: string; status: string; gateway_response: string; redirect_url?: string; display_text?: string } };
      if (!d.status) { showError(d.message || "Card charge declined."); return; }
      const s = d.data?.status ?? "";
      const ref = d.data?.reference ?? "";
      setReference(ref);
      if (s === "success") {
        setReceipt({ amount: `KES ${amt.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`, method: "card", masked: `**** **** **** ${cleanCard.slice(-4)}`, reference: ref });
        setView("receipt"); return;
      }
      if (s === "pay_offline" && d.data?.redirect_url) {
        setRedirectUrl(d.data.redirect_url); setIframeLoading(true); setView("threeds"); return;
      }
      if (s === "send_otp" || s === "send_pin" || s === "send_address" || s === "send_phone" || s === "send_birthday") {
        const labels: Record<string, [string, string, string]> = {
          send_otp:      ["Enter OTP",            "Check your phone for the one-time password.", "submit_otp"],
          send_pin:      ["Enter Card PIN",        "Enter your 4-digit card PIN to confirm.", "submit_pin"],
          send_address:  ["Enter Billing Address", "Enter your billing address.", "submit_address"],
          send_phone:    ["Enter Phone Number",    "Enter the phone number registered with your card.", "submit_phone"],
          send_birthday: ["Enter Date of Birth",   "Enter your birthday (YYYY-MM-DD).", "submit_birthday"],
        };
        const [label, hint, action] = labels[s] ?? ["Enter Code", "Check your phone.", "submit_otp"];
        setOtpLabel(label); setOtpHint(hint); setOtpAction(action); setOtpCode(""); setView("otp"); return;
      }
      setStatusTitle("Awaiting Confirmation…");
      setStatusDesc(d.data?.gateway_response || "Your transaction is being processed.");
    } catch { showError("Network error. Please try again."); }
  }, [amount, card, showError]);

  const submitOtp = useCallback(async () => {
    if (!otpCode.trim()) return;
    setView("status"); setStatusTitle("Verifying…"); setStatusDesc("Confirming your details with the bank.");
    try {
      const r = await fetch("/api/gateway/charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: otpAction, [otpAction.replace("submit_", "")]: otpCode, reference }),
      });
      const d = await r.json() as { status: boolean; message?: string; data?: { status: string; gateway_response: string; redirect_url?: string } };
      if (!d.status) { showError(d.message || "Code rejected. Please try again."); return; }
      const s = d.data?.status ?? "";
      if (s === "success") {
        const amt = parseFloat(amount);
        setReceipt({ amount: `KES ${amt.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`, method, masked: method === "mpesa" ? phone : `**** ${card.number.replace(/\s/g, "").slice(-4)}`, reference });
        setView("receipt");
      } else if (s === "pay_offline" && d.data?.redirect_url) {
        setRedirectUrl(d.data.redirect_url); setIframeLoading(true); setView("threeds");
      }
    } catch { showError("Network error. Please try again."); }
  }, [otpCode, otpAction, reference, amount, method, phone, card, showError]);

  const closeAll = () => { setIsOpen(false); setView("checkout"); setOtpCode(""); setReference(""); setCardFlipped(false); };
  const goBack   = () => { setView("checkout"); setOtpCode(""); setReference(""); setCardFlipped(false); };
  const copyRef  = () => {
    if (receipt?.reference) {
      navigator.clipboard.writeText(receipt.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: `linear-gradient(160deg, ${DARK} 0%, #0d1f0f 60%, #1a2e1a 100%)`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      {/* Background glows */}
      <div style={{ position: "absolute", top: "8%", right: "-12%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.13) 0%, transparent 70%)", filter: "blur(60px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "4%", left: "-12%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)", filter: "blur(50px)", pointerEvents: "none" }} />

      {/* Hero content */}
      <div style={{ textAlign: "center", maxWidth: 380, position: "relative", zIndex: 1 }}>
        <div style={{
          width: 76, height: 76,
          background: "rgba(34,197,94,0.15)", border: "2px solid rgba(34,197,94,0.3)",
          borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px",
        }}>
          <HeartIcon size={28} />
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
          Support the Stream
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
          Send a donation via M-Pesa or card.<br/>It shows up live on the stream!
        </p>

        {healthy !== null && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 16px", borderRadius: 99, marginBottom: 28,
            background: healthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${healthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: healthy ? GREEN : "#ef4444",
              animation: "pulse 1.5s infinite",
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: healthy ? GREEN : "#ef4444" }}>
              {healthy ? "LIVE — Accepting Donations" : "Gateway Unavailable"}
            </span>
          </div>
        )}

        <button
          onClick={() => { setIsOpen(true); setView("checkout"); }}
          style={{
            ...BTN, fontSize: 16, padding: "17px 36px", borderRadius: 100,
            display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center",
            boxShadow: `0 6px 28px rgba(34,197,94,0.4)`,
          }}
        >
          <HeartIcon />
          Donate Now
        </button>

        <p style={{ margin: "18px 0 0", fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
          Powered by Paystack · Secured by 256-bit SSL
        </p>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div onClick={closeAll} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", zIndex: 9999 }} />
      )}

      {/* ── CHECKOUT sheet ───────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("checkout") && isOpen ? "0%" : "110%"})`, zIndex: 10000 }}>
        {DRAG}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HeartIcon size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#111827" }}>Make a Donation</h3>
            <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>All payments processed securely via Paystack</p>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#f3f4f6", margin: "16px 0" }} />

        {/* Method tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, background: "#f3f4f6", borderRadius: 14, padding: 4 }}>
          {(["mpesa", "card"] as Method[]).map(m => (
            <button
              key={m}
              onClick={() => { setMethod(m); setCardFlipped(false); }}
              style={{
                flex: 1, padding: "12px 0", border: "none", cursor: "pointer",
                borderRadius: 11, fontSize: 14, fontWeight: 700,
                transition: "all 0.22s cubic-bezier(0.34,1.56,0.64,1)",
                background: method === m ? "#fff" : "transparent",
                color: method === m ? (m === "mpesa" ? MPESA_GREEN : "#111827") : "#9ca3af",
                boxShadow: method === m ? "0 2px 12px rgba(0,0,0,0.10)" : "none",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              {m === "mpesa" ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2"/>
                    <circle cx="12" cy="17" r="1"/>
                    <path d="M9 7h6"/>
                  </svg>
                  M-Pesa
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  Card
                </>
              )}
            </button>
          ))}
        </div>

        {/* Card preview (card mode) */}
        {method === "card" && (
          <CardPreview card={card} flipped={cardFlipped} />
        )}

        {/* M-Pesa banner */}
        {method === "mpesa" && <MpesaBanner />}

        {/* Donor name */}
        <div style={IW}>
          <label style={IL}>Your Name <span style={{ color: "#d1d5db", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
          <input
            value={donorName}
            onChange={e => setDonorName(e.target.value)}
            placeholder="e.g. John Kamau"
            style={IF}
          />
        </div>

        {/* Amount */}
        <div style={IW}>
          <label style={IL}>Amount (KES)</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 700, color: "#9ca3af" }}>KES</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              style={{ ...IF, paddingLeft: 52, width: "100%", boxSizing: "border-box", fontSize: 18, fontWeight: 700 }}
              min={1}
            />
          </div>
        </div>

        {/* Quick amounts */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          {[10, 50, 100, 500, 1000].map(a => (
            <button
              key={a}
              onClick={() => setAmount(String(a))}
              style={{
                padding: "7px 15px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                cursor: "pointer",
                border: `1.5px solid ${amount === String(a) ? GREEN : "#e5e7eb"}`,
                background: amount === String(a) ? "rgba(34,197,94,0.08)" : "#f9fafb",
                color: amount === String(a) ? "#16a34a" : "#6b7280",
                transition: "all 0.15s",
              }}
            >
              {a}
            </button>
          ))}
        </div>

        {/* ── M-Pesa fields ── */}
        {method === "mpesa" && (
          <div style={IW}>
            <label style={IL}>M-Pesa Number</label>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                fontSize: 14, fontWeight: 700, color: MPESA_GREEN,
              }}>+254</span>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="07XXXXXXXX"
                style={{ ...IF, paddingLeft: 56, width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={MPESA_GREEN} strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill={MPESA_GREEN} stroke={MPESA_GREEN} strokeWidth="2"/></svg>
              <span style={{ fontSize: 11, color: "#166534", fontWeight: 500 }}>Enter your Safaricom number — you'll get a PIN prompt on your phone</span>
            </div>
          </div>
        )}

        {/* ── Card fields ── */}
        {method === "card" && (
          <>
            <CardBrands />
            <div style={IW}>
              <label style={IL}>Card Number</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text" inputMode="numeric"
                  value={card.number}
                  onChange={e => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                  onFocus={e => { setCardFlipped(false); (e.target as HTMLInputElement).style.borderColor = GREEN; (e.target as HTMLInputElement).style.boxShadow = `0 0 0 3px rgba(34,197,94,0.12)`; }}
                  onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "#e5e7eb"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
                  placeholder="1234  5678  9012  3456"
                  maxLength={19}
                  style={{ ...IF, letterSpacing: 3, fontFamily: "'Courier New', monospace", fontSize: 16, width: "100%", boxSizing: "border-box", paddingRight: 48 }}
                />
                <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }}>
                  {(() => {
                    const n = card.number.replace(/\s/g, "");
                    if (/^4/.test(n)) return <span style={{ fontSize: 12, fontWeight: 900, fontStyle: "italic", color: "#1a1f71", fontFamily: "Georgia, serif" }}>VISA</span>;
                    if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return (
                      <div style={{ position: "relative", width: 26, height: 16 }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#eb001b", position: "absolute", left: 0 }} />
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#f79e1b", position: "absolute", left: 9, opacity: 0.85 }} />
                      </div>
                    );
                    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>;
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ ...IW, flex: 1, marginBottom: 0 }}>
                <label style={IL}>Expiry</label>
                <input
                  type="text" inputMode="numeric"
                  value={card.expiry}
                  onChange={e => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                  onFocus={e => { setCardFlipped(false); (e.target as HTMLInputElement).style.borderColor = GREEN; (e.target as HTMLInputElement).style.boxShadow = `0 0 0 3px rgba(34,197,94,0.12)`; }}
                  onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "#e5e7eb"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
                  placeholder="MM/YY"
                  maxLength={5}
                  style={{ ...IF, textAlign: "center", letterSpacing: 2, fontWeight: 700 }}
                />
              </div>
              <div style={{ ...IW, flex: 1, marginBottom: 0 }}>
                <label style={{ ...IL, display: "flex", alignItems: "center", gap: 4 }}>
                  CVV
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                </label>
                <input
                  ref={cvvRef}
                  type="password" inputMode="numeric"
                  value={card.cvv}
                  onChange={e => setCard({ ...card, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  onFocus={e => { setCardFlipped(true); (e.target as HTMLInputElement).style.borderColor = "#818cf8"; (e.target as HTMLInputElement).style.boxShadow = `0 0 0 3px rgba(129,140,248,0.12)`; }}
                  onBlur={e => { setCardFlipped(false); (e.target as HTMLInputElement).style.borderColor = "#e5e7eb"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
                  placeholder="•••"
                  maxLength={4}
                  style={{ ...IF, textAlign: "center", letterSpacing: 4, fontWeight: 700 }}
                />
              </div>
            </div>
            <div style={IW}>
              <label style={IL}>Cardholder Name</label>
              <input
                type="text"
                value={card.name}
                onChange={e => setCard({ ...card, name: e.target.value.toUpperCase() })}
                onFocus={e => { setCardFlipped(false); (e.target as HTMLInputElement).style.borderColor = GREEN; (e.target as HTMLInputElement).style.boxShadow = `0 0 0 3px rgba(34,197,94,0.12)`; }}
                onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "#e5e7eb"; (e.target as HTMLInputElement).style.boxShadow = "none"; }}
                placeholder="JOHN DOE"
                style={{ ...IF, letterSpacing: 1, fontWeight: 600 }}
              />
            </div>
          </>
        )}

        {/* Pay button */}
        <button
          onClick={method === "mpesa" ? processMpesa : processCard}
          style={{
            ...BTN,
            background: method === "mpesa" ? `linear-gradient(135deg, ${MPESA_GREEN} 0%, #007a3a 100%)` : `linear-gradient(135deg, ${GREEN} 0%, #16a34a 100%)`,
            boxShadow: method === "mpesa" ? "0 6px 24px rgba(0,166,81,0.35)" : "0 6px 24px rgba(34,197,94,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            fontSize: 16,
          }}
        >
          {method === "mpesa" ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2"/>
                <circle cx="12" cy="17" r="1"/>
                <path d="M9 7h6"/>
              </svg>
              Pay KES {amount || "0"} via M-Pesa
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Pay KES {amount || "0"} Securely
            </>
          )}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", color: "#9ca3af", fontSize: 11, marginTop: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          256-bit SSL · Secured by Paystack
        </div>
      </div>

      {/* ── STATUS sheet ──────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("status") && isOpen ? "0%" : "110%"})`, zIndex: 10001 }}>
        {DRAG}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "16px 0" }}>
          <div style={{
            width: 90, height: 90, borderRadius: "50%",
            background: "#f0fdf4", border: `4px solid #dcfce7`,
            borderTopColor: GREEN,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 22, animation: "spin 1.2s linear infinite",
          }}>
            <span style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#111827" }}>{fmtCountdown(countdown)}</span>
          </div>
          <h3 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#111827" }}>{statusTitle}</h3>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>{statusDesc}</p>
        </div>
      </div>

      {/* ── OTP sheet ─────────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("otp") && isOpen ? "0%" : "110%"})`, zIndex: 10002 }}>
        {DRAG}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, background: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </div>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "#111827", textAlign: "center" }}>{otpLabel}</h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 22px", textAlign: "center", lineHeight: 1.6 }}>{otpHint}</p>
        <div style={IW}>
          <input
            type="text" inputMode="numeric"
            value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="••••••"
            maxLength={8}
            autoFocus
            style={{ ...IF, textAlign: "center", fontSize: 28, letterSpacing: 10, fontWeight: 700 }}
          />
        </div>
        <button onClick={submitOtp} disabled={!otpCode.trim()} style={{ ...BTN, background: otpCode.trim() ? GREEN : "#d1fae5", color: otpCode.trim() ? "#fff" : "#6b7280", cursor: otpCode.trim() ? "pointer" : "default" }}>Confirm</button>
        <button onClick={goBack} style={{ ...BTN, background: "transparent", color: "#6b7280", border: "1.5px solid #e5e7eb" }}>Cancel</button>
      </div>

      {/* ── 3DS sheet ─────────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("threeds") && isOpen ? "0%" : "110%"})`, zIndex: 10003, padding: 0, display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
        <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, background: "#f0fdf4", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Bank Verification</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>3D Secure · Secured by your bank</div>
            </div>
          </div>
          <button onClick={goBack} style={{ background: "transparent", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#6b7280" }}>Cancel</button>
        </div>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {iframeLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#fff" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: GREEN, animation: "spin 1s linear infinite", marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "#6b7280" }}>Loading bank page…</div>
            </div>
          )}
          {redirectUrl && <iframe src={redirectUrl} onLoad={() => setIframeLoading(false)} style={{ width: "100%", height: "100%", border: "none" }} title="Bank Authentication" allow="payment" />}
        </div>
      </div>

      {/* ── RECEIPT sheet ─────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("receipt") && isOpen ? "0%" : "110%"})`, zIndex: 10001 }}>
        {DRAG}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 72, height: 72, background: "#f0fdf4", borderRadius: "50%", border: "3px solid #bbf7d0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.8"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h3 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#111827" }}>Thank You! 💚</h3>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "6px 0 0", textAlign: "center", lineHeight: 1.6 }}>
            Your donation is live on stream right now!
          </p>
        </div>
        <div style={{ background: "#f9fafb", border: "1.5px solid #e5e7eb", borderRadius: 18, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 16, borderBottom: "1px dashed #e5e7eb" }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Amount Donated</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>{receipt?.amount}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Method</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{receipt?.method === "card" ? "Credit / Debit Card" : "M-Pesa"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>Status</span>
            <span style={{ background: "#f0fdf4", color: "#16a34a", fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 20, border: "1px solid #bbf7d0" }}>CONFIRMED ✓</span>
          </div>
        </div>
        {receipt?.reference && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Transaction Reference</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 12, padding: "12px 16px" }}>
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#166534", wordBreak: "break-all" }}>{receipt.reference}</span>
              <button onClick={copyRef} style={{ flexShrink: 0, padding: "6px 14px", background: copied ? GREEN : "#111827", color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "background 0.2s" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
        <button onClick={closeAll} style={{ ...BTN }}>Done</button>
      </div>

      {/* ── ERROR sheet ───────────────────────────────────────────────────────── */}
      <div style={{ ...SHEET, transform: `translateY(${vis("error") && isOpen ? "0%" : "110%"})`, background: "#fffbfb", borderTop: "4px solid #ef4444", zIndex: 10002 }}>
        {DRAG}
        <div style={{ width: 52, height: 52, background: "#fef2f2", borderRadius: "50%", border: "2px solid #fecaca", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#111827" }}>Payment Failed</h3>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 22px", lineHeight: 1.6 }}>{errorMsg}</p>
        <button onClick={goBack} style={{ ...BTN }}>Try Again</button>
        <button onClick={closeAll} style={{ ...BTN, background: "transparent", color: "#6b7280", border: "1.5px solid #e5e7eb" }}>Close</button>
      </div>

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        input:focus { border-color: #22c55e !important; box-shadow: 0 0 0 3px rgba(34,197,94,0.12) !important; }
      `}</style>
    </div>
  );
}
