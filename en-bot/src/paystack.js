import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_API = "https://api.paystack.co";

function header(reqHeaders, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(reqHeaders || {})) {
    if (k.toLowerCase() === want) return String(v || "");
  }
  return "";
}

export function createPaystack(config, store, hooks = {}) {
  const cfg = config.paystack || {};
  const apiUrl = (cfg.apiUrl || DEFAULT_API).replace(/\/$/, "");
  const secretKey = cfg.secretKey || "";
  const publicKey = cfg.publicKey || "";
  const env = cfg.env === "live" ? "live" : "test";
  const currency = (cfg.currency || "NGN").toUpperCase();
  const configured = Boolean(secretKey);

  async function remote(path, { method = "GET", body } = {}) {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secretKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === false) {
      const err = new Error(data.message || `Paystack HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function verifySignature(raw, headers = {}) {
    if (!secretKey) return false;
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ""), "utf8");
    const attendue = createHmac("sha512", secretKey).update(body).digest("hex");
    const recue = header(headers, "x-paystack-signature");
    const a = Buffer.from(attendue);
    const b = Buffer.from(recue);
    if (a.length !== b.length || !recue) return false;
    return timingSafeEqual(a, b);
  }

  function findPayment(data = {}) {
    const refs = [data.reference, data.metadata?.paymentId, data.id];
    for (const ref of refs) {
      const found = store.getPayment(ref) || store.getPaymentByRef(ref);
      if (found) return found;
    }
    return null;
  }

  const api = {
    configured,
    env,
    apiUrl,
    currency,
    publicKey,
    verifySignature,
    async createCheckout({ user, plan, telegramId, lang }) {
      if (!configured) {
        const err = new Error("Paystack is not configured (missing secret key).");
        err.code = "PAYSTACK_NOT_CONFIGURED";
        throw err;
      }
      const payment = store.createPayment({
        userId: user.id,
        planId: plan.id,
        planCode: plan.code,
        amountCents: plan.priceCents,
        currency: plan.currency || currency,
        interval: plan.interval,
        status: "pending",
        metadata: {
          telegramId: telegramId || user.telegramId || null,
          planName: plan.name,
          lang: lang || "en",
        },
      });

      const returnUrl = `${config.publicUrl}/pay/return?pid=${encodeURIComponent(payment.id)}`;
      const data = await remote("/transaction/initialize", {
        method: "POST",
        body: {
          email: user.email || `tg${telegramId || user.id}@predictbet.app`,
          amount: Number(plan.priceCents),
          currency: plan.currency || currency,
          reference: payment.id,
          callback_url: returnUrl,
          metadata: {
            paymentId: payment.id,
            planCode: plan.code,
            telegramId: telegramId || user.telegramId || null,
          },
        },
      });
      const payload = data.data || {};
      const token = payload.reference || payment.id;
      const checkoutUrl = payload.authorization_url || null;
      if (!checkoutUrl) throw new Error("Paystack did not return an authorization URL");
      store.updatePayment(payment.id, {
        providerRef: String(token),
        checkoutUrl,
        metadata: {
          ...payment.metadata,
          paystackRef: String(token),
          paystackAccess: payload.access_code || "",
        },
      });
      return { payment: store.getPayment(payment.id), checkoutUrl, free: false };
    },
    async getStatus(reference) {
      if (!configured || !reference) return null;
      return remote(`/transaction/verify/${encodeURIComponent(reference)}`);
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
          provider: "paystack",
          cancelAtPeriodEnd: true,
        });
      }
      if (typeof hooks.onPaid === "function") {
        void Promise.resolve(hooks.onPaid(store.getPayment(payment.id))).catch((e) => {
          console.warn("paystack onPaid:", e.message);
        });
      }
      return store.getPayment(payment.id);
    },
    markFailed(paymentId, reason) {
      const current = store.getPayment(paymentId);
      if (!current || current.status === "paid") return current;
      return store.updatePayment(paymentId, { status: "failed", metadata: { ...current.metadata, reason } });
    },
    async fulfillFromEvent(event) {
      const data = event?.data || event || {};
      const payment = findPayment(data);
      if (!payment) return { ok: false, reason: "payment_not_found" };
      if (payment.status === "paid") return { ok: true, duplicate: true, payment };
      const domain = String(data.domain || "").toLowerCase();
      if (env === "live" && domain === "test") {
        return { ok: true, ignored: "test_in_live" };
      }
      const eventName = String(event?.event || "").toLowerCase();
      const status = String(data.status || "").toLowerCase();
      const paid = eventName === "charge.success" || status === "success";
      if (paid) {
        if (data.amount != null && Number(data.amount) !== Number(payment.amountCents)) {
          return { ok: false, reason: "amount_mismatch" };
        }
        api.markPaid(payment.id, {
          providerRef: data.reference || payment.providerRef,
          metadata: {
            ...payment.metadata,
            paystackRef: data.reference,
            paystackTx: data.id,
            paystackChannel: data.channel,
            paystackStatus: status,
          },
        });
        return { ok: true, payment: store.getPayment(payment.id) };
      }
      if (status === "failed" || status === "abandoned") {
        api.markFailed(payment.id, status);
      }
      return { ok: true, payment: store.getPayment(payment.id) };
    },
    async fulfillByPid(pidOrToken) {
      const payment = store.getPayment(pidOrToken) || store.getPaymentByRef(pidOrToken);
      if (!payment) return null;
      if (payment.status === "paid") return payment;
      const ref = payment.providerRef || payment.metadata?.paystackRef || payment.id;
      if (!ref) return payment;
      try {
        const st = await api.getStatus(ref);
        const data = st?.data || {};
        const status = String(data.status || "").toLowerCase();
        if (status === "success") {
          return api.markPaid(payment.id, { metadata: { ...payment.metadata, polled: true } });
        }
        if (status === "failed" || status === "abandoned") api.markFailed(payment.id, status);
      } catch {
        /* webhook remains the source of truth */
      }
      return store.getPayment(payment.id);
    },
  };

  return api;
}
