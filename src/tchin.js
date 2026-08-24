import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_API = "https://tchin.tech/api/v1";

function header(reqHeaders, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(reqHeaders || {})) {
    if (k.toLowerCase() === want) return String(v || "");
  }
  return "";
}

function stripSig(value) {
  const s = String(value || "").trim();
  return s.startsWith("v1=") ? s.slice(3) : s;
}

function fromDescription(text) {
  const m = /\((pay_[a-z0-9]+)\)/i.exec(String(text || ""));
  return m ? m[1] : "";
}

export function parseTchinWebhook(raw, contentType = "") {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("application/json")) {
    const json = JSON.parse(text || "{}");
    if (json.data && typeof json.data === "object") return { ...json, ...json.data };
    return json;
  }
  const params = new URLSearchParams(text);
  const data = {};
  for (const [k, v] of params.entries()) {
    const m = /^data\[([^\]]+)\]$/.exec(k);
    if (m) data[m[1]] = v;
    else if (k !== "data") data[k] = v;
  }
  return data;
}

export function createTchin(config, store, hooks = {}) {
  const cfg = config.tchin || {};
  const apiUrl = (cfg.apiUrl || DEFAULT_API).replace(/\/$/, "");
  const publicKey = cfg.publicKey || "";
  const privateKey = cfg.privateKey || cfg.secretKey || "";
  const env = cfg.env === "live" ? "live" : "test";
  const configured = Boolean(publicKey && privateKey);

  async function remote(path, { method = "GET", body } = {}) {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "TCHIN-PUBLIC-KEY": publicKey,
        "TCHIN-PRIVATE-KEY": privateKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || data.error || `Tchin HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function verifyPayload(payload, headers = {}) {
    if (!privateKey) return false;
    const ts = Number(header(headers, "tchin-timestamp") || payload.timestamp || 0);
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const chaine = [
      ts,
      payload.reference ?? "",
      payload.token ?? "",
      payload.status ?? "",
      payload.amount ?? "",
      payload.net ?? "",
      payload.mode ?? "",
    ].join(".");
    const attendue = createHmac("sha256", privateKey).update(String(chaine)).digest("hex");
    const recue = stripSig(payload.signature || header(headers, "tchin-signature"));
    const a = Buffer.from(attendue);
    const b = Buffer.from(recue);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  function shouldFulfill(payload) {
    const status = String(payload.status || "").toLowerCase();
    const mode = String(payload.mode || payload.env || "");
    if (status !== "completed") return false;
    if (env === "live" && mode === "test") return false;
    return true;
  }

  function findPayment(payload) {
    const refs = [payload.reference, payload.token, fromDescription(payload.description)];
    for (const ref of refs) {
      const found = store.getPaymentByRef(ref);
      if (found) return found;
    }
    return null;
  }

  const api = {
    configured,
    env,
    apiUrl,
    verifyPayload,
    shouldFulfill,
    async createCheckout({ user, plan, telegramId, lang }) {
      if (!configured) {
        const err = new Error("Tchin n'est pas configuré (clés API manquantes).");
        err.code = "TCHIN_NOT_CONFIGURED";
        throw err;
      }
      const payment = store.createPayment({
        userId: user.id,
        planId: plan.id,
        planCode: plan.code,
        amountCents: plan.priceCents,
        currency: plan.currency || "XOF",
        interval: plan.interval,
        status: "pending",
        metadata: {
          telegramId: telegramId || user.telegramId || null,
          planName: plan.name,
          lang: lang || "fr",
        },
      });

      const returnUrl = `${config.publicUrl}/pay/return`;
      const data = await remote("/payments", {
        method: "POST",
        body: {
          amount: Number(plan.priceCents),
          description: `Predictbet ${plan.name} (${payment.id})`,
          env,
          return_url: returnUrl,
          cancel_url: returnUrl,
          callback_url: `${config.publicUrl}/webhooks/tchin`,
        },
      });
      const token = data.token || null;
      const checkoutUrl = data.payment_url || null;
      if (!token || !checkoutUrl) throw new Error("Tchin n'a pas renvoyé token / payment_url");
      store.updatePayment(payment.id, {
        providerRef: String(token),
        checkoutUrl,
        metadata: {
          ...payment.metadata,
          tchinToken: String(token),
          tchinEnv: data.env || env,
        },
      });
      return { payment: store.getPayment(payment.id), checkoutUrl, free: false };
    },
    async getStatus(token) {
      if (!configured || !token) return null;
      return remote(`/payments/${encodeURIComponent(token)}/status`);
    },
    markPaid(paymentId, extra = {}) {
      const current = store.getPayment(paymentId);
      if (!current) return null;
      if (current.status === "paid") return current;
      const payment = store.updatePayment(paymentId, {
        status: "paid",
        paidAt: new Date().toISOString(),
        ...extra,
        metadata: { ...current.metadata, ...(extra.metadata || {}) },
      });
      const plan = store.getPlan(payment.planId) || store.getPlan(payment.planCode);
      if (plan) {
        store.activateSubscription({
          userId: payment.userId,
          plan,
          paymentId: payment.id,
          provider: "tchin",
          cancelAtPeriodEnd: true,
        });
      }
      if (typeof hooks.onPaid === "function") {
        void Promise.resolve(hooks.onPaid(store.getPayment(payment.id))).catch((e) => {
          console.warn("tchin onPaid:", e.message);
        });
      }
      return store.getPayment(payment.id);
    },
    markFailed(paymentId, reason) {
      const current = store.getPayment(paymentId);
      if (!current || current.status === "paid") return current;
      return store.updatePayment(paymentId, { status: "failed", metadata: { ...current.metadata, reason } });
    },
    async fulfillFromPayload(payload) {
      const payment = findPayment(payload);
      if (!payment) return { ok: false, reason: "payment_not_found" };
      if (payment.status === "paid") return { ok: true, duplicate: true, payment };
      if (payload.amount != null && Number(payload.amount) !== Number(payment.amountCents)) {
        return { ok: false, reason: "amount_mismatch" };
      }
      const status = String(payload.status || "").toLowerCase();
      if (shouldFulfill(payload)) {
        api.markPaid(payment.id, {
          providerRef: payload.reference || payload.token || payment.providerRef,
          metadata: {
            ...payment.metadata,
            tchinToken: payload.reference || payment.metadata?.tchinToken,
            tchinTx: payload.token,
            tchinStatus: status,
            tchinMode: payload.mode,
            tchinNet: payload.net,
          },
        });
        return { ok: true, payment: store.getPayment(payment.id) };
      }
      if (status === "failed" || status === "cancelled") {
        api.markFailed(payment.id, status);
      }
      return { ok: true, payment: store.getPayment(payment.id) };
    },
    async fulfillByPid(pidOrToken) {
      const payment = store.getPayment(pidOrToken) || store.getPaymentByRef(pidOrToken);
      if (!payment) return null;
      if (payment.status === "paid") return payment;
      const token = payment.providerRef || payment.metadata?.tchinToken;
      if (!token) return payment;
      try {
        const st = await api.getStatus(token);
        const status = String(st?.status || st?.data?.status || "").toLowerCase();
        const mode = st?.mode || st?.env || st?.data?.mode || env;
        if (status === "completed" && !(env === "live" && mode === "test")) {
          return api.markPaid(payment.id, { metadata: { ...payment.metadata, polled: true } });
        }
        if (status === "failed" || status === "cancelled") api.markFailed(payment.id, status);
      } catch {
        /* le webhook reste la source de vérité */
      }
      return store.getPayment(payment.id);
    },
  };

  return api;
}
