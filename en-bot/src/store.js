import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { addInterval, nid, nowIso } from "./ids.js";

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const next = scryptSync(String(password), salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function defaultPlans() {
  const t = nowIso();
  return [
    {
      id: "pln_weekly",
      code: "weekly",
      name: "Weekly",
      description: "7 days of bot access.",
      priceCents: 500_000,
      currency: "NGN",
      interval: "week",
      credits: 9999,
      maxPredictionsPerDay: 999,
      features: [],
      active: true,
      highlighted: true,
      sortOrder: 0,
      trialDays: 0,
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "pln_monthly",
      code: "monthly",
      name: "Monthly",
      description: "30 days of bot access.",
      priceCents: 1_800_000,
      currency: "NGN",
      interval: "month",
      credits: 9999,
      maxPredictionsPerDay: 999,
      features: [],
      active: true,
      highlighted: false,
      sortOrder: 1,
      trialDays: 0,
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "pln_annual",
      code: "annual",
      name: "Yearly",
      description: "One year of bot access.",
      priceCents: 18_000_000,
      currency: "NGN",
      interval: "year",
      credits: 9999,
      maxPredictionsPerDay: 999,
      features: [],
      active: true,
      highlighted: false,
      sortOrder: 2,
      trialDays: 0,
      createdAt: t,
      updatedAt: t,
    },
  ];
}

function syncOfficialPlans(state) {
  const official = defaultPlans();
  const kept = new Map((state.plans || []).map((p) => [p.code, p]));
  state.plans = official.map((p) => {
    const old = kept.get(p.code);
    if (!old) return p;
    return {
      ...old,
      ...p,
      id: old.id,
      createdAt: old.createdAt || p.createdAt,
      updatedAt: nowIso(),
    };
  });
  state.settings = { ...state.settings, currency: "NGN" };
}

function emptyState() {
  return {
    users: [],
    plans: defaultPlans(),
    subscriptions: [],
    payments: [],
    checkouts: [],
    sessions: [],
    audit: [],
    settings: {
      brand: "Predictbet",
      currency: "NGN",
      paystackEnabled: true,
      allowManualConfirm: true,
      supportEmail: "support@predictbet.app",
    },
  };
}

export function createStore(filePath, { adminEmail, adminPassword } = {}) {
  let state = emptyState();
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    state = { ...emptyState(), ...raw, plans: raw.plans?.length ? raw.plans : defaultPlans() };
    syncOfficialPlans(state);
  } catch {
    state = emptyState();
  }

  let timer = null;
  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(state, null, 2));
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, 250);
  }
  function audit(action, meta = {}) {
    state.audit.unshift({ id: nid("aud"), action, meta, at: nowIso() });
    state.audit = state.audit.slice(0, 400);
    schedule();
  }

  function ensureAdmin(generatedPassword) {
    const email = String(adminEmail || "admin@predictbet.app").toLowerCase();
    let admin = state.users.find((u) => u.role === "admin" && u.email === email);
    if (!admin) {
      const password = adminPassword || generatedPassword;
      admin = {
        id: nid("usr"),
        email,
        displayName: "Admin",
        role: "admin",
        status: "active",
        planCode: "annual",
        credits: 9999,
        telegramId: null,
        username: null,
        notes: "",
        passwordHash: hashPassword(password),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastSeenAt: null,
        source: "admin",
      };
      state.users.push(admin);
      schedule();
      return { created: true, email, password, user: publicUser(admin) };
    }
    if (adminPassword) {
      admin.passwordHash = hashPassword(adminPassword);
      admin.updatedAt = nowIso();
      schedule();
    }
    return { created: false, email, password: null, user: publicUser(admin) };
  }

  function publicUser(u) {
    if (!u) return null;
    const { passwordHash, ...rest } = u;
    return {
      ...rest,
      registered: Boolean(u.email && passwordHash),
    };
  }

  function findUser(id) {
    return state.users.find((u) => u.id === id || String(u.telegramId) === String(id) || u.email === id) || null;
  }

  function findUserByEmail(email) {
    const want = String(email || "").trim().toLowerCase();
    if (!want) return null;
    return state.users.find((u) => String(u.email || "").toLowerCase() === want) || null;
  }

  function authError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  const api = {
    hashPassword,
    verifyPassword,
    persist,
    audit,
    ensureAdmin,
    publicUser,
    findUser,
    findUserByEmail,
    snapshot() {
      return state;
    },
    listUsers({ q = "", status = "" } = {}) {
      const needle = q.trim().toLowerCase();
      return state.users
        .filter((u) => u.role !== "admin" || needle)
        .filter((u) => !status || u.status === status)
        .filter((u) => {
          if (!needle) return u.role !== "admin";
          return [u.email, u.displayName, u.username, u.telegramId, u.notes, u.planCode]
            .map((x) => String(x || "").toLowerCase())
            .some((x) => x.includes(needle));
        })
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
        .map(publicUser);
    },
    getUser(id) {
      return publicUser(findUser(id));
    },
    createUser(patch = {}) {
      const t = nowIso();
      const u = {
        id: nid("usr"),
        email: patch.email || null,
        displayName: patch.displayName || "User",
        role: "user",
        status: "active",
        planCode: patch.planCode || "",
        credits: Number(patch.credits ?? 0),
        telegramId: patch.telegramId ? Number(patch.telegramId) : null,
        username: patch.username || null,
        notes: patch.notes || "",
        passwordHash: null,
        createdAt: t,
        updatedAt: t,
        lastSeenAt: null,
        source: "admin",
        lang: "en",
      };
      state.users.push(u);
      schedule();
      audit("user.create", { id: u.id, source: "admin" });
      return publicUser(u);
    },
    upsertTelegramUser(from, extra = {}) {
      const telegramId = Number(from.id);
      let u = state.users.find((x) => Number(x.telegramId) === telegramId);
      const t = nowIso();
      if (!u) {
        u = {
          id: nid("usr"),
          email: extra.email || null,
          displayName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `tg-${telegramId}`,
          role: "user",
          status: "active",
          planCode: "",
          credits: 0,
          telegramId,
          username: from.username || null,
          notes: "",
          passwordHash: null,
          createdAt: t,
          updatedAt: t,
          lastSeenAt: t,
          source: "telegram",
          lang: extra.lang || "en",
        };
        state.users.push(u);
        audit("user.create", { id: u.id, telegramId });
      } else {
        u.username = from.username || u.username;
        u.displayName =
          [from.first_name, from.last_name].filter(Boolean).join(" ") || u.displayName;
        u.lastSeenAt = t;
        u.updatedAt = t;
        if (extra.email) u.email = extra.email;
        if (extra.lang) u.lang = extra.lang;
      }
      schedule();
      return publicUser(u);
    },
    touchUser(id) {
      const u = findUser(id);
      if (!u) return null;
      u.lastSeenAt = nowIso();
      schedule();
      return publicUser(u);
    },
    registerBotUser({ from, email, password, displayName, lang, referralCode }) {
      const telegramId = Number(from?.id);
      const emailN = String(email || "").trim().toLowerCase();
      const name = String(displayName || "").trim();
      const pass = String(password || "");
      if (!telegramId) throw authError("NO_TELEGRAM", "Telegram account missing.");
      if (name.length < 2) throw authError("INVALID_NAME", "Name too short.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailN)) throw authError("INVALID_EMAIL", "Invalid email.");
      if (pass.length < 6) throw authError("INVALID_PASSWORD", "Password too short.");

      const byTg = state.users.find((x) => Number(x.telegramId) === telegramId && x.role !== "admin") || null;
      if (byTg?.email && byTg.passwordHash) {
        throw authError("ALREADY_REGISTERED", "Account already created.");
      }
      const byEmail = findUserByEmail(emailN);
      if (byEmail && byEmail.role === "admin") {
        throw authError("EMAIL_TAKEN", "That email is already taken.");
      }
      if (byEmail && Number(byEmail.telegramId) && Number(byEmail.telegramId) !== telegramId) {
        throw authError("EMAIL_TAKEN", "That email is already taken.");
      }
      if (byEmail && byEmail.passwordHash && Number(byEmail.telegramId) !== telegramId) {
        throw authError("EMAIL_TAKEN", "That email is already taken.");
      }

      const t = nowIso();
      let u = byTg || (byEmail && !byEmail.passwordHash ? byEmail : null);
      if (!u) {
        u = {
          id: nid("usr"),
          role: "user",
          status: "active",
          planCode: "",
          credits: 0,
          notes: "",
          createdAt: t,
          source: "telegram",
        };
        state.users.push(u);
      }
      u.email = emailN;
      u.displayName = name;
      u.passwordHash = hashPassword(pass);
      u.telegramId = telegramId;
      u.username = from.username || u.username || null;
      u.lang = lang || u.lang || "en";
      u.referralCode = referralCode || u.referralCode || null;
      u.updatedAt = t;
      u.lastSeenAt = t;
      u.registeredAt = t;
      schedule();
      audit("user.register", { id: u.id, telegramId, email: emailN });
      return publicUser(u);
    },
    loginBotUser({ from, email, password }) {
      const telegramId = Number(from?.id);
      const emailN = String(email || "").trim().toLowerCase();
      const u = findUserByEmail(emailN);
      if (!u || u.role === "admin" || u.status === "banned" || !u.passwordHash) {
        throw authError("LOGIN_BAD", "Wrong email or password.");
      }
      if (!verifyPassword(password, u.passwordHash)) {
        throw authError("LOGIN_BAD", "Wrong email or password.");
      }
      if (u.telegramId && Number(u.telegramId) !== telegramId) {
        throw authError("TELEGRAM_MISMATCH", "This account is already linked to another Telegram.");
      }
      u.telegramId = telegramId;
      u.username = from?.username || u.username;
      u.lastSeenAt = nowIso();
      u.updatedAt = nowIso();
      schedule();
      audit("user.login", { id: u.id, telegramId });
      return publicUser(u);
    },
    updateUser(id, patch) {
      const u = findUser(id);
      if (!u) return null;
      const allowed = [
        "email",
        "displayName",
        "status",
        "planCode",
        "credits",
        "notes",
        "role",
        "username",
      ];
      for (const k of allowed) {
        if (patch[k] !== undefined) u[k] = patch[k];
      }
      if (patch.password) u.passwordHash = hashPassword(patch.password);
      u.updatedAt = nowIso();
      schedule();
      audit("user.update", { id: u.id, patch: Object.keys(patch) });
      return publicUser(u);
    },
    listPlans({ all = false } = {}) {
      return [...state.plans]
        .filter((p) => all || p.active)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    },
    getPlan(idOrCode) {
      const want = String(idOrCode || "");
      return state.plans.find((p) => p.id === want || p.code === want) || null;
    },
    savePlan(input) {
      const t = nowIso();
      const existing = input.id ? state.plans.find((p) => p.id === input.id) : null;
      const plan = {
        id: existing?.id || nid("pln"),
        code: String(input.code || existing?.code || "plan")
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_"),
        name: input.name || existing?.name || "Plan",
        description: input.description ?? existing?.description ?? "",
        priceCents: Number(input.priceCents ?? existing?.priceCents ?? 0),
        currency: input.currency || existing?.currency || "EUR",
        interval: input.interval || existing?.interval || "month",
        credits: Number(input.credits ?? existing?.credits ?? 0),
        maxPredictionsPerDay: Number(input.maxPredictionsPerDay ?? existing?.maxPredictionsPerDay ?? 10),
        features: Array.isArray(input.features)
          ? input.features
          : existing?.features || [],
        active: input.active !== undefined ? Boolean(input.active) : existing?.active ?? true,
        highlighted: input.highlighted !== undefined ? Boolean(input.highlighted) : existing?.highlighted ?? false,
        sortOrder: Number(input.sortOrder ?? existing?.sortOrder ?? state.plans.length),
        trialDays: Number(input.trialDays ?? existing?.trialDays ?? 0),
        createdAt: existing?.createdAt || t,
        updatedAt: t,
      };
      if (existing) {
        Object.assign(existing, plan);
      } else {
        state.plans.push(plan);
      }
      schedule();
      audit(existing ? "plan.update" : "plan.create", { id: plan.id, code: plan.code });
      return plan;
    },
    deletePlan(id) {
      const i = state.plans.findIndex((p) => p.id === id);
      if (i < 0) return false;
      const [removed] = state.plans.splice(i, 1);
      schedule();
      audit("plan.delete", { id, code: removed.code });
      return true;
    },
    listSubscriptions({ status = "" } = {}) {
      return state.subscriptions
        .filter((s) => !status || s.status === status)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    },
    getSubscription(id) {
      return state.subscriptions.find((s) => s.id === id) || null;
    },
    activeSubForUser(userId) {
      return (
        state.subscriptions.find(
          (s) => s.userId === userId && (s.status === "active" || s.status === "trialing"),
        ) || null
      );
    },
    activateSubscription({ userId, plan, paymentId = null, provider = "paystack", cancelAtPeriodEnd = true }) {
      const t = nowIso();
      const user = findUser(userId);
      if (!user || !plan) return null;
      for (const s of state.subscriptions) {
        if (s.userId === user.id && (s.status === "active" || s.status === "trialing")) {
          s.status = "replaced";
          s.updatedAt = t;
        }
      }
      const start = t;
      const sub = {
        id: nid("sub"),
        userId: user.id,
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        status: "active",
        provider,
        interval: plan.interval,
        priceCents: plan.priceCents,
        currency: plan.currency,
        currentPeriodStart: start,
        currentPeriodEnd: addInterval(start, plan.interval),
        cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
        paymentId,
        createdAt: t,
        updatedAt: t,
      };
      state.subscriptions.push(sub);
      user.planCode = plan.code;
      user.credits = Number(plan.credits || 0);
      user.updatedAt = t;
      schedule();
      audit("sub.activate", { subId: sub.id, userId: user.id, plan: plan.code });
      return sub;
    },
    patchSubscription(id, patch) {
      const s = state.subscriptions.find((x) => x.id === id);
      if (!s) return null;
      if (patch.status) s.status = patch.status;
      if (patch.cancelAtPeriodEnd !== undefined) s.cancelAtPeriodEnd = Boolean(patch.cancelAtPeriodEnd);
      if (patch.currentPeriodEnd) s.currentPeriodEnd = patch.currentPeriodEnd;
      s.updatedAt = nowIso();
      if (patch.status === "canceled" || patch.status === "paused") {
        const u = findUser(s.userId);
        if (u && patch.status === "canceled") {
          u.planCode = "";
          u.updatedAt = s.updatedAt;
        }
      }
      schedule();
      audit("sub.update", { id, patch });
      return s;
    },
    dueSubscriptions(at = Date.now()) {
      return state.subscriptions.filter((s) => {
        if (s.status !== "active") return false;
        return new Date(s.currentPeriodEnd).getTime() <= at;
      });
    },
    renewSubscription(sub) {
      const plan = api.getPlan(sub.planId) || api.getPlan(sub.planCode);
      if (!plan || !plan.active || sub.cancelAtPeriodEnd) {
        sub.status = "canceled";
        sub.updatedAt = nowIso();
        const u = findUser(sub.userId);
        if (u) {
          u.planCode = "";
          u.updatedAt = sub.updatedAt;
        }
        schedule();
        return { renewed: false, sub };
      }
      sub.currentPeriodStart = nowIso();
      sub.currentPeriodEnd = addInterval(sub.currentPeriodStart, sub.interval || plan.interval);
      sub.updatedAt = nowIso();
      const u = findUser(sub.userId);
      if (u) {
        u.credits = Number(plan.credits || u.credits);
        u.updatedAt = sub.updatedAt;
      }
      schedule();
      audit("sub.renew", { id: sub.id });
      return { renewed: true, sub };
    },
    listPayments() {
      return [...state.payments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    getPayment(id) {
      return state.payments.find((p) => p.id === id) || null;
    },
    getPaymentByRef(ref) {
      const want = String(ref || "");
      if (!want) return null;
      return (
        state.payments.find(
          (p) =>
            p.providerRef === want ||
            p.id === want ||
            String(p.metadata?.paystackRef || p.metadata?.tchinToken || "") === want,
        ) || null
      );
    },
    createPayment(partial) {
      const p = {
        id: nid("pay"),
        status: "pending",
        provider: "paystack",
        providerRef: null,
        userId: null,
        planId: null,
        planCode: null,
        amountCents: 0,
        currency: "NGN",
        interval: "month",
        checkoutUrl: null,
        metadata: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
        paidAt: null,
        ...partial,
      };
      state.payments.push(p);
      schedule();
      return p;
    },
    updatePayment(id, patch) {
      const p = state.payments.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch, { updatedAt: nowIso() });
      schedule();
      return p;
    },
    createCheckout(partial) {
      const c = {
        id: nid("chk"),
        paymentId: null,
        status: "open",
        ...partial,
        createdAt: nowIso(),
      };
      state.checkouts.push(c);
      schedule();
      return c;
    },
    getCheckout(id) {
      return state.checkouts.find((c) => c.id === id) || null;
    },
    createSession(userId) {
      const token = randomBytes(24).toString("hex");
      const row = {
        token,
        userId,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      state.sessions.push(row);
      state.sessions = state.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now()).slice(-80);
      schedule();
      return row;
    },
    getSession(token) {
      const s = state.sessions.find((x) => x.token === token);
      if (!s) return null;
      if (new Date(s.expiresAt).getTime() < Date.now()) return null;
      return s;
    },
    deleteSession(token) {
      state.sessions = state.sessions.filter((s) => s.token !== token);
      schedule();
    },
    settings() {
      return state.settings;
    },
    patchSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      schedule();
      audit("settings.update", { keys: Object.keys(patch) });
      return state.settings;
    },
    listAudit(limit = 80) {
      return state.audit.slice(0, limit);
    },
    stats() {
      const users = state.users.filter((u) => u.role !== "admin");
      const activeSubs = state.subscriptions.filter((s) => s.status === "active");
      const paid = state.payments.filter((p) => p.status === "paid");
      const revenue = paid.reduce((sum, p) => sum + Number(p.amountCents || 0), 0);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return {
        users: users.length,
        activeUsers: users.filter((u) => u.status === "active").length,
        banned: users.filter((u) => u.status === "banned").length,
        activeSubs: activeSubs.length,
        plans: state.plans.filter((p) => p.active).length,
        payments: state.payments.length,
        paidCount: paid.length,
        revenueCents: revenue,
        signups7d: users.filter((u) => new Date(u.createdAt).getTime() > weekAgo).length,
        pendingPayments: state.payments.filter((p) => p.status === "pending").length,
      };
    },
  };

  return api;
}
