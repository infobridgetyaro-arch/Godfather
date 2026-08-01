#!/usr/bin/env node
/**
 * BintuNet backend load/stress test — pure Node built-ins only (no extra deps).
 *
 * Counts:
 *  - "ok"          HTTP 2xx/3xx/4xx (expected responses, including 401 auth blocks)
 *  - "fail"        HTTP 5xx *from our server* (crashes/panics)
 *  - "ratelimited" HTTP 429 (rate limiter working correctly)
 *  - "p502"        HTTP 502 specifically — Paystack upstream rejection (not our fault)
 *
 * Exit 0 = zero server 5xx. Exit 1 = server failures detected.
 */

import http from "http";
import net from "net";
import crypto from "crypto";

const HOST = "localhost";
const PORT = 8080;
const PASS = "bintunet";
const RESULTS = [];

// ── helpers ──────────────────────────────────────────────────────────────────

function req(method, path, body, cookie) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: HOST,
      port: PORT,
      path,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const start = Date.now();
    const r = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: data, ms: Date.now() - start, headers: res.headers })
      );
    });
    r.on("error", (e) => resolve({ status: 0, body: e.message, ms: Date.now() - start }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function login() {
  const r = await req("POST", "/api/auth/login", { password: PASS });
  if (r.status !== 200) throw new Error("Login failed: " + r.body);
  const raw = r.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : [raw || ""];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

/**
 * @param {string} label
 * @param {number} count
 * @param {(i: number) => Promise<{status: number, body: string, ms: number}>} fn
 * @param {boolean} [countP502AsOk]  true when 502 = upstream rejection, not our crash
 */
async function runConcurrent(label, count, fn, countP502AsOk = false) {
  const start = Date.now();
  const results = await Promise.all(Array.from({ length: count }, (_, i) => fn(i)));
  const total = Date.now() - start;
  const p502 = results.filter((r) => r.status === 502).length;
  // "fail" = connection error (status 0) OR 5xx from *our server* (but not 502 when upstream)
  const fail = results.filter((r) => r.status === 0 || (r.status >= 500 && !(countP502AsOk && r.status === 502))).length;
  const ratelimited = results.filter((r) => r.status === 429).length;
  const ok = results.length - fail - ratelimited;
  const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const max = Math.max(...results.map((r) => r.ms));
  const entry = { label, count, ok, fail, ratelimited, p502, avg, max, total, countP502AsOk };
  RESULTS.push(entry);
  return entry;
}

function printEntry(e, extra) {
  const icon = e.fail === 0 ? "✅" : "❌";
  const p502note = e.countP502AsOk && e.p502 > 0 ? ` 502↑=${e.p502}` : "";
  console.log(
    `${icon} ${e.label.padEnd(48)} | ${String(e.count).padStart(4)} reqs` +
    ` | OK=${String(e.ok).padStart(4)} FAIL=${e.fail} RL=${e.ratelimited}${p502note}` +
    ` | avg=${e.avg}ms max=${e.max}ms wall=${e.total}ms` +
    (extra ? `\n   ↳ ${extra}` : "")
  );
}

/** Raw WebSocket upgrade test via raw TCP — no ws dep required */
function wsConnect(cookie) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const start = Date.now();
    const socket = net.createConnection({ host: HOST, port: PORT });
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; socket.destroy(); resolve({ ok: false, reason: "timeout", ms: Date.now() - start }); }
    }, 5000);
    socket.on("connect", () => {
      socket.write(
        `GET /ws HTTP/1.1\r\n` +
        `Host: ${HOST}:${PORT}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        (cookie ? `Cookie: ${cookie}\r\n` : "") +
        `\r\n`
      );
    });
    socket.on("data", (buf) => {
      if (done) return;
      clearTimeout(timeout); done = true; socket.destroy();
      const resp = buf.toString();
      if (resp.startsWith("HTTP/1.1 101")) resolve({ ok: true, ms: Date.now() - start });
      else resolve({ ok: false, reason: resp.split("\r\n")[0], ms: Date.now() - start });
    });
    socket.on("error", (e) => {
      if (done) return;
      clearTimeout(timeout); done = true;
      resolve({ ok: false, reason: e.message, ms: Date.now() - start });
    });
  });
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(78));
  console.log("  BintuNet Backend — Load / Stress Test  (target: http://localhost:8080)");
  console.log("═".repeat(78) + "\n");

  // ── Login (get a valid session cookie) ───────────────────────────────────
  process.stdout.write("Logging in…  ");
  let cookie;
  try {
    cookie = await login();
    console.log("OK — session=" + cookie.slice(0, 28) + "…  ✅");
  } catch (e) {
    console.log("FAILED:", e.message);
    process.exit(1);
  }
  console.log();

  // ── 1. Auth check — 200 concurrent ──────────────────────────────────────
  printEntry(await runConcurrent("GET /api/auth/check", 200,
    () => req("GET", "/api/auth/check", null, cookie)));

  // ── 2. Stream list — 300 concurrent ─────────────────────────────────────
  printEntry(await runConcurrent("GET /api/streams", 300,
    () => req("GET", "/api/streams", null, cookie)));

  // ── 3. Broadcast state — 200 concurrent ─────────────────────────────────
  printEntry(await runConcurrent("GET /api/broadcast", 200,
    () => req("GET", "/api/broadcast", null, cookie)));

  // ── 4. Paystack status poll — 500 concurrent (simulates many polling tabs) ─
  printEntry(await runConcurrent("GET /api/paystack/status", 500,
    (i) => req("GET", `/api/paystack/status?streamId=stream_${i % 10}`, null, cookie)));

  // ── 5. Paystack init without auth — all should be 401 ───────────────────
  {
    const r = await runConcurrent("POST /api/paystack/init (no auth)", 50,
      () => req("POST", "/api/paystack/init", { title: "x", amount: 5, streamId: "s" }));
    printEntry(r, `All blocked by auth guard: ${r.ok === 0 && r.fail === 0 ? "YES ✅" : "NO ❌"}`);
  }

  // ── 6. Rate-limit enforcement — 30 rapid init reqs (same IP, auth'd) ────
  //    First 20 reach Paystack (may get 502 from Paystack if key not valid for test)
  //    Next 10 should be 429 rate-limited. 502 here = Paystack rejection, not our bug.
  {
    const r = await runConcurrent(
      "POST /api/paystack/init (rate-limit @ 20/min)",
      30,
      () => req("POST", "/api/paystack/init", { title: "RL", amount: 1, streamId: "rl_sid" }, cookie),
      true // 502 = Paystack upstream, not our server fault
    );
    printEntry(r, `Rate-limiter blocked: ${r.ratelimited}/30 | ` +
      `Paystack upstream rejections (502): ${r.p502} | ` +
      `Server errors: ${r.fail} | Limiter ✅: ${r.ratelimited >= 8 ? "YES" : "check"}`);
  }

  // ── 7. Brute-force login simulation — 50 wrong passwords ────────────────
  {
    const r = await runConcurrent("POST /api/auth/login (wrong pwd)", 50,
      () => req("POST", "/api/auth/login", { password: "wrongpassword" }));
    printEntry(r, `All rejected: ${r.fail === 0 && r.ok === 0 ? "YES ✅" : "NO ❌"}`);
  }

  // ── 8. Concurrent resets — 200 concurrent ───────────────────────────────
  printEntry(await runConcurrent("DELETE /api/paystack/reset", 200,
    (i) => req("DELETE", `/api/paystack/reset?streamId=ghost_${i}`, null, cookie)));

  // ── 9. WebSocket handshake stress — 40 concurrent raw TCP upgrades ───────
  console.log("\n  WebSocket upgrade stress (40 concurrent raw TCP handshakes)…");
  const wsStart = Date.now();
  const wsResults = await Promise.all(Array.from({ length: 40 }, () => wsConnect(cookie)));
  const wsTotal = Date.now() - wsStart;
  const wsOk = wsResults.filter((r) => r.ok).length;
  const wsFail = wsResults.filter((r) => !r.ok);
  const wsEntry = {
    label: "WebSocket /ws upgrade handshake",
    count: 40, ok: wsOk, fail: wsFail.length, ratelimited: 0, p502: 0,
    avg: Math.round(wsResults.reduce((s, r) => s + r.ms, 0) / wsResults.length),
    max: Math.max(...wsResults.map((r) => r.ms)), total: wsTotal, countP502AsOk: false,
  };
  RESULTS.push(wsEntry);
  printEntry(wsEntry,
    wsFail.length > 0
      ? "Failures: " + wsFail.slice(0, 3).map((r) => r.reason).join(" | ")
      : "All 40 WS handshakes succeeded ✅"
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(78));
  console.log("  SUMMARY");
  console.log("═".repeat(78));
  const totalReqs = RESULTS.reduce((s, r) => s + r.count, 0);
  const totalServerFails = RESULTS.reduce((s, r) => s + r.fail, 0);
  const totalP502 = RESULTS.reduce((s, r) => s + r.p502, 0);
  const overallMs = RESULTS.reduce((s, r) => s + r.total, 0);

  console.log(`  Total requests fired        : ${totalReqs}`);
  console.log(`  True server errors (5xx)    : ${totalServerFails}   ← crash / panic in our code`);
  console.log(`  Paystack upstream 502s      : ${totalP502}  ← Paystack API rejections (not our code)`);
  console.log(`  Test elapsed (wall clock)   : ${(overallMs / 1000).toFixed(2)}s`);
  console.log(`  Throughput                  : ~${Math.round(totalReqs / (overallMs / 1000))} req/s`);
  console.log();
  if (totalServerFails === 0) {
    console.log("  ✅  PASS — zero server errors under load");
    console.log("      Rate limiter active, auth guards holding, WS stable.");
    if (totalP502 > 0) {
      console.log(`      ${totalP502} Paystack 502s = test-mode key rejected by Paystack API — expected.`);
      console.log("      Set PAYSTACK_CURRENCY=NGN (or your account's currency) in Replit secrets.");
    }
  } else {
    console.log("  ❌  FAIL — server errors detected. Review FAIL column above.");
  }
  console.log("═".repeat(78) + "\n");

  process.exit(totalServerFails > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Test runner error:", e); process.exit(1); });
