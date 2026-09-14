import http from "http";
import { createReadStream, existsSync, statSync } from "fs";
import { extname, join, normalize, resolve } from "path";
import { formatMoney } from "./format.js";
import { parseTchinWebhook } from "./tchin.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const extra = typeof body === "object" && !Buffer.isBuffer(body) ? { "Content-Type": "application/json; charset=utf-8" } : {};
  res.writeHead(status, { "Cache-Control": "no-store", ...extra, ...headers });
  res.end(payload);
}

function json(res, status, body) {
  send(res, status, body);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)pb_admin=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function money(cents, currency = "XOF") {
  return formatMoney(cents, currency, "fr");
}

function returnPage(payment, plan, { status = "pending" }) {
  const title =
    status === "paid" ? "Paiement reçu" : status === "failed" ? "Paiement non abouti" : "En attente de Tchin";
  const msg =
    status === "paid"
      ? "C'est bon, ton accès est ouvert. Reviens sur Telegram."
      : status === "failed"
        ? "Le paiement n'est pas passé. Tu peux relancer depuis le bot."
        : "Tchin confirme dès que tu as validé sur ton téléphone. Tu peux fermer cette page et revenir sur Telegram.";
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · Predictbet</title>
<style>
:root{--bg:#07090e;--card:#10141c;--line:#243044;--gold:#f5c542;--txt:#eef1f6;--mut:#8b95a7}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:DM Sans,system-ui,sans-serif;background:var(--bg);color:var(--txt)}
.card{width:min(420px,92vw);background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px}
h1{font-size:1.15rem;margin:0 0 8px}p{color:var(--mut);line-height:1.45}
.row{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)}
.ok{color:#3dd68c;font-weight:700}
</style></head>
<body><div class="card">
  <h1>Predictbet</h1>
  <p class="${status === "paid" ? "ok" : ""}">${msg}</p>
  <div class="row"><span>Offre</span><b>${plan?.name || payment?.planCode || "—"}</b></div>
  <div class="row"><span>Montant</span><b>${payment ? money(payment.amountCents, payment.currency) : "—"}</b></div>
</div></body></html>`;
}

export function startHttpServer({ config, store, tchin, publicDir }) {
  const logins = new Map();
  const root = resolve(publicDir);

  function requireAdmin(req, res) {
    const token = bearer(req);
    const sess = token ? store.getSession(token) : null;
    if (!sess) {
      json(res, 401, { ok: false, error: "Non authentifié" });
      return null;
    }
    const user = store.getUser(sess.userId);
    if (!user || user.role !== "admin") {
      json(res, 403, { ok: false, error: "Accès refusé" });
      return null;
    }
    return { sess, user };
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "/admin" || rel === "/admin/") rel = "/admin/index.html";
    if (rel === "/admin/login" || rel === "/admin/login/") rel = "/admin/login.html";
    const file = normalize(join(root, rel)).replace(/\\/g, "/");
    const rootNorm = root.replace(/\\/g, "/");
    if (!file.startsWith(rootNorm)) {
      json(res, 403, { ok: false, error: "forbidden" });
      return true;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) return false;
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": rel.endsWith(".html") ? "no-store" : "public, max-age=3600" });
    createReadStream(file).pipe(res);
    return true;
  }

  async function handleApi(req, res, url) {
    const path = url.pathname;
    const method = req.method || "GET";

    if (path === "/health") {
      json(res, 200, {
        ok: true,
        service: "predictbet-admin",
        tchin: { configured: tchin.configured, env: tchin.env, api: tchin.apiUrl },
      });
      return true;
    }

    if (path === "/webhooks/tchin" && method === "POST") {
      if (!tchin.configured) {
        send(res, 503, "tchin non configure", { "Content-Type": "text/plain; charset=utf-8" });
        return true;
      }
      const raw = await readBody(req);
      let payload;
      try {
        payload = parseTchinWebhook(raw, req.headers["content-type"]);
      } catch {
        send(res, 400, "corps invalide", { "Content-Type": "text/plain; charset=utf-8" });
        return true;
      }
      if (!tchin.verifyPayload(payload, req.headers)) {
        send(res, 403, "signature invalide", { "Content-Type": "text/plain; charset=utf-8" });
        return true;
      }
      try {
        await tchin.fulfillFromPayload(payload);
      } catch (e) {
        console.warn("tchin webhook:", e.message);
      }
      send(res, 200, "ok", { "Content-Type": "text/plain; charset=utf-8" });
      return true;
    }

    if (path === "/pay/return" && method === "GET") {
      const token = url.searchParams.get("token") || "";
      const pid = url.searchParams.get("pid") || "";
      let payment = token ? store.getPaymentByRef(token) : pid ? store.getPayment(pid) : null;
      if (payment) payment = (await tchin.fulfillByPid(payment.id)) || payment;
      const status = payment?.status === "paid" ? "paid" : payment?.status === "failed" ? "failed" : "pending";
      send(res, payment ? 200 : 404, returnPage(payment, store.getPlan(payment?.planId), { status }), {
        "Content-Type": "text/html; charset=utf-8",
      });
      return true;
    }

    if (path === "/api/admin/login" && method === "POST") {
      const ip = req.socket.remoteAddress || "ip";
      const hits = logins.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - hits.at > 15 * 60 * 1000) hits.n = 0;
      hits.n += 1;
      hits.at = Date.now();
      logins.set(ip, hits);
      if (hits.n > 20) {
        json(res, 429, { ok: false, error: "Trop de tentatives" });
        return true;
      }
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const email = String(body.email || "").trim().toLowerCase();
      const user = store.snapshot().users.find((u) => u.email === email && u.role === "admin");
      if (!user || !store.verifyPassword(body.password || "", user.passwordHash)) {
        json(res, 401, { ok: false, error: "Identifiants incorrects" });
        return true;
      }
      const sess = store.createSession(user.id);
      json(res, 200, { ok: true, token: sess.token, user: store.publicUser(user) });
      return true;
    }

    if (path === "/api/admin/logout" && method === "POST") {
      store.deleteSession(bearer(req));
      json(res, 200, { ok: true });
      return true;
    }

    const authNeeded = path.startsWith("/api/admin") && path !== "/api/admin/login";
    const auth = authNeeded ? requireAdmin(req, res) : null;
    if (authNeeded && !auth) return true;

    if (path === "/api/admin/me" && method === "GET") {
      json(res, 200, { ok: true, user: auth.user, tchin: tchin.env, settings: store.settings() });
      return true;
    }
    if (path === "/api/admin/dashboard" && method === "GET") {
      json(res, 200, {
        ok: true,
        stats: store.stats(),
        recentUsers: store.listUsers().slice(0, 8),
        recentPayments: store.listPayments().slice(0, 8),
        subs: store.listSubscriptions({ status: "active" }).slice(0, 8),
      });
      return true;
    }
    if (path === "/api/admin/users" && method === "GET") {
      json(res, 200, { ok: true, users: store.listUsers({ q: url.searchParams.get("q") || "", status: url.searchParams.get("status") || "" }) });
      return true;
    }
    if (path.startsWith("/api/admin/users/") && method === "GET") {
      const user = store.getUser(path.split("/").pop());
      if (!user) json(res, 404, { ok: false, error: "Utilisateur introuvable" });
      else json(res, 200, { ok: true, user, subscription: store.activeSubForUser(user.id), payments: store.listPayments().filter((p) => p.userId === user.id) });
      return true;
    }
    if (path.startsWith("/api/admin/users/") && method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const user = store.updateUser(path.split("/").pop(), body);
      if (!user) json(res, 404, { ok: false, error: "Utilisateur introuvable" });
      else json(res, 200, { ok: true, user, subscription: store.activeSubForUser(user.id) });
      return true;
    }
    if (path === "/api/admin/users" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      json(res, 201, { ok: true, user: store.createUser(body) });
      return true;
    }
    if (path === "/api/admin/plans" && method === "GET") {
      json(res, 200, { ok: true, plans: store.listPlans({ all: true }) });
      return true;
    }
    if (path === "/api/admin/plans" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      json(res, 201, { ok: true, plan: store.savePlan(body) });
      return true;
    }
    if (path.startsWith("/api/admin/plans/") && method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      json(res, 200, { ok: true, plan: store.savePlan({ ...body, id: path.split("/").pop() }) });
      return true;
    }
    if (path.startsWith("/api/admin/plans/") && method === "DELETE") {
      const ok = store.deletePlan(path.split("/").pop());
      json(res, ok ? 200 : 404, { ok });
      return true;
    }
    if (path === "/api/admin/subscriptions" && method === "GET") {
      json(res, 200, { ok: true, subscriptions: store.listSubscriptions({ status: url.searchParams.get("status") || "" }) });
      return true;
    }
    if (path === "/api/admin/subscriptions" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const plan = store.getPlan(body.planId || body.planCode);
      const sub = store.activateSubscription({
        userId: body.userId,
        plan,
        provider: "tchin",
        cancelAtPeriodEnd: false,
      });
      if (!sub) json(res, 400, { ok: false, error: "Utilisateur ou plan invalide" });
      else json(res, 201, { ok: true, subscription: sub });
      return true;
    }
    if (path.startsWith("/api/admin/subscriptions/") && method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const sub = store.patchSubscription(path.split("/").pop(), body);
      if (!sub) json(res, 404, { ok: false, error: "Abonnement introuvable" });
      else json(res, 200, { ok: true, subscription: sub });
      return true;
    }
    if (path === "/api/admin/payments" && method === "GET") {
      json(res, 200, { ok: true, payments: store.listPayments() });
      return true;
    }
    if (path.startsWith("/api/admin/payments/") && path.endsWith("/confirm") && method === "POST") {
      const id = path.split("/")[4];
      const payment = tchin.markPaid(id, { metadata: { manual: true } });
      if (!payment) json(res, 404, { ok: false, error: "Paiement introuvable" });
      else json(res, 200, { ok: true, payment });
      return true;
    }
    if (path === "/api/admin/settings" && method === "GET") {
      json(res, 200, {
        ok: true,
        settings: store.settings(),
        tchin: {
          configured: tchin.configured,
          env: tchin.env,
          apiUrl: tchin.apiUrl,
          webhook: `${config.publicUrl}/webhooks/tchin`,
          docs: "https://doc.tchin.tech/",
        },
      });
      return true;
    }
    if (path === "/api/admin/settings" && method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      json(res, 200, { ok: true, settings: store.patchSettings(body) });
      return true;
    }
    if (path === "/api/admin/audit" && method === "GET") {
      json(res, 200, { ok: true, audit: store.listAudit() });
      return true;
    }
    return false;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (await handleApi(req, res, url)) return;
      if (serveStatic(req, res, url)) return;
      json(res, 404, { ok: false, error: "Not found" });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message || "Erreur serveur" });
    }
  });

  server.listen(config.adminPort, "0.0.0.0", () => {
    console.log(`Panel admin → ${config.publicUrl}/admin`);
  });

  const tick = async () => {
    try {
      for (const sub of store.dueSubscriptions()) {
        store.renewSubscription(sub);
      }
    } catch (e) {
      console.warn("billing tick:", e.message);
    }
  };
  setInterval(() => void tick(), 60 * 60 * 1000);
  return server;
}
