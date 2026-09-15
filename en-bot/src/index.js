import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import "./load-env.js";
import { Bot } from "grammy";
import { loadConfig, apiUrlFallbacks } from "./config.js";
import { createApi, ApiError, extractAuth, extractMatches } from "./api.js";
import { createSessionStore, initialSession } from "./session-store.js";
import { createStore } from "./store.js";
import { createPaystack } from "./paystack.js";
import { startHttpServer } from "./http-server.js";
import { sleep, signals, resolvePrediction, mergeMatchDetail } from "./analysis.js";
import { predictFixture, refreshEngine } from "./engine.js";
import { t } from "./i18n.js";
import { resolveStadium, resolveReferee } from "./venues.js";
import {
  esc,
  upcoming,
  whenText,
  paginate,
  priceLabel,
  findMatch,
  pctBar,
  listEntry,
  hydrateMatch,
} from "./format.js";
import {
  filterMatches,
  sortMatches,
  stats,
  neighbors,
  defaultView,
  pickOutcome,
  ymd,
} from "./catalog.js";
import {
  mainKeyboard,
  menuKeyboard,
  leaguesKeyboard,
  listKeyboard,
  matchDetailKeyboard,
  profileKeyboard,
  plansKeyboard,
  payKeyboard,
  welcomeKeyboard,
} from "./keyboards.js";

const config = loadConfig();
if (!config.token) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env");
  process.exit(1);
}

const api = createApi(config);
const sessions = createSessionStore(config.sessionFile);
const store = createStore(config.storeFile, {
  adminEmail: config.adminEmail,
  adminPassword: config.adminPassword,
});
const bot = new Bot(config.token);
const paystack = createPaystack(config, store, {
    onPaid: async (payment) => {
      const tgId = Number(payment?.metadata?.telegramId);
      if (!tgId) return;
      const plan = store.getPlan(payment.planId) || store.getPlan(payment.planCode);
      const lang = "en";
    await bot.api.sendMessage(tgId, t(lang, "payFree", { plan: esc(plan?.name || "") }), {
      parse_mode: "HTML",
    });
  },
});
let botUsername = "";
let matchCache = { at: 0, list: [], error: null };

function sess(ctx) {
  const id = ctx.from?.id;
  if (!id) return initialSession();
  return sessions.get(id) ?? sessions.patch(id, initialSession());
}

function langOf(_ctx) {
  return "en";
}

function loggedIn(s) {
  return Boolean(s?.loggedIn && s?.userId);
}

function registeredUserFor(ctx) {
  const u = store.getUser(ctx.from?.id);
  if (!u || u.role === "admin" || !u.registered) return null;
  return u;
}

function openLocalSession(ctx, user) {
  sessions.patch(ctx.from.id, {
    loggedIn: true,
    userId: user.id,
    user: sess(ctx).user || user,
    token: sess(ctx).token || null,
    flow: null,
    pendingEmail: null,
    pendingName: null,
  });
  store.touchUser(user.id);
  return sessions.get(ctx.from.id);
}

function autoLoginFromTelegram(ctx) {
  if (loggedIn(sess(ctx))) return sess(ctx);
  const u = registeredUserFor(ctx);
  if (!u) return null;
  return openLocalSession(ctx, u);
}

function currentUser(ctx) {
  const s = sess(ctx);
  if (!loggedIn(s)) return null;
  return store.getUser(s.userId) || store.getUser(ctx.from?.id);
}

function isAuthFlow(flow) {
  return String(flow || "").startsWith("register_") || String(flow || "").startsWith("login_");
}

function authErrorText(lang, e) {
  const keys = {
    INVALID_NAME: "nameBad",
    INVALID_EMAIL: "emailBad",
    INVALID_PASSWORD: "passBad",
    EMAIL_TAKEN: "regEmailTaken",
    ALREADY_REGISTERED: "regAlready",
    LOGIN_BAD: "loginBad",
    TELEGRAM_MISMATCH: "loginOtherTg",
  };
  if (e?.code && keys[e.code]) return t(lang, keys[e.code]);
  return t(lang, "error", { msg: esc(e.message) });
}

function getView(ctx) {
  return { ...defaultView(), ...(sess(ctx).view || {}) };
}

function setView(ctx, partial) {
  const next = { ...getView(ctx), ...partial };
  sessions.patch(ctx.from.id, { view: next });
  return next;
}

function html(ctx, text, extra = {}) {
  const markup =
    extra.reply_markup !== undefined
      ? extra.reply_markup
      : loggedIn(sess(ctx))
        ? mainKeyboard(langOf(ctx))
        : undefined;
  return ctx.reply(text, {
    parse_mode: "HTML",
    ...extra,
    reply_markup: markup,
  });
}

async function editOrReply(ctx, text, markup) {
  const opts = { parse_mode: "HTML" };
  if (markup) opts.reply_markup = markup;
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, opts);
      return;
    }
  } catch {
    /* message identique ou trop ancien */
  }
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: markup ?? (loggedIn(sess(ctx)) ? mainKeyboard(langOf(ctx)) : undefined),
  });
}

async function ensureAuth(ctx) {
  const s = sess(ctx);
  if (!loggedIn(s)) return s;
  if (s.token) {
    try {
      const me = await api.me(s.token);
      return sessions.patch(ctx.from.id, {
        user: me.user || s.user,
        token: s.token,
      });
    } catch {
      sessions.patch(ctx.from.id, { token: null });
    }
  }
  return sess(ctx);
}

async function requireSession(ctx) {
  const s = sess(ctx);
  if (loggedIn(s)) return ensureAuth(ctx);
  return s;
}

function mergeMatchRows(into, raw) {
  const m = hydrateMatch(raw);
  const id = String(m?.id || m?.externalId || "");
  if (!id) return;
  const prev = into.get(id);
  into.set(
    id,
    prev
      ? hydrateMatch({
          ...prev,
          ...m,
          home: { ...(prev.home || {}), ...(m.home || {}) },
          away: { ...(prev.away || {}), ...(m.away || {}) },
        })
      : m,
  );
}

async function fetchMatchBundle(apiUrl) {
  const today = ymd(new Date());
  const results = await Promise.allSettled([
    api.matches({ upcoming: true }, { apiUrl }),
    api.matches({ date: today }, { apiUrl }),
    api.matches({ live: true }, { apiUrl }),
  ]);
  const map = new Map();
  let lastError = null;
  let anyOk = false;
  for (const r of results) {
    if (r.status !== "fulfilled") {
      lastError = r.reason;
      continue;
    }
    anyOk = true;
    for (const raw of extractMatches(r.value)) mergeMatchRows(map, raw);
  }
  if (!anyOk) throw lastError || new Error("matches unreachable");
  const list = upcoming([...map.values()]);
  await refreshEngine(config, list);
  return list.map((m) => {
    if (m.finished || m.cancelled) return m;
    return { ...m, predictionPreview: predictFixture(m) };
  });
}

async function loadUpcoming(force = false) {
  const ttl = matchCache.list.some((m) => m.live) ? 12_000 : config.cacheMs;
  if (!force && matchCache.list.length && Date.now() - matchCache.at < ttl) {
    return matchCache.list;
  }
  let lastError = null;
  for (const apiUrl of apiUrlFallbacks(config.apiUrl)) {
    try {
      const list = await fetchMatchBundle(apiUrl);
      if (apiUrl !== config.apiUrl) {
        config.apiUrl = apiUrl;
        console.warn(`API matches via ${apiUrl} (${list.length})`);
      }
      matchCache = { at: Date.now(), list, error: null };
      return list;
    } catch (e) {
      lastError = e;
      console.warn(`matches ${apiUrl}:`, e.message);
    }
  }
  if (matchCache.list.length) return matchCache.list;
  matchCache = { at: Date.now(), list: [], error: lastError?.message || "unreachable" };
  return [];
}

function browseList(all, view) {
  const filtered = filterMatches(all, {
    scope: view.scope || "all",
    league: view.league || "",
  });
  return sortMatches(filtered, view.sort === "confidence" ? "confidence" : "time");
}

function matchCard(lang, m) {
  const round = m.round || "";
  let body = t(lang, "matchInfo", {
    home: esc(m.home?.name),
    away: esc(m.away?.name),
    league: esc(m.league),
    round: esc(round ? ` · ${round}` : ""),
    when: esc(whenText(m, lang)),
  });
  const stadium = resolveStadium(m);
  if (stadium) body += `\n${t(lang, "stadium", { name: esc(stadium) })}`;
  const referee = resolveReferee(m);
  if (referee) body += `\n${t(lang, "referee", { name: esc(referee) })}`;
  return body;
}

function trackUser(ctx) {
  const u = currentUser(ctx);
  if (!u) return null;
  return store.touchUser(u.id) || u;
}

function hasAccess(ctx) {
  const u = currentUser(ctx);
  if (!u) return false;
  const sub = store.activeSubForUser(u.id);
  return Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
}

async function showWelcome(ctx) {
  if (autoLoginFromTelegram(ctx)) {
    await showMenu(ctx);
    return;
  }
  const lang = langOf(ctx);
  const local = store.getUser(ctx.from.id);
  const text = local?.registered ? t(lang, "welcomeBack") : t(lang, "welcomeGate");
  if (ctx.callbackQuery?.message) {
    await editOrReply(ctx, text, welcomeKeyboard(lang));
    return;
  }
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
  await ctx.reply(t(lang, "welcomePick"), {
    parse_mode: "HTML",
    reply_markup: welcomeKeyboard(lang),
  });
}

async function requireLogin(ctx) {
  if (loggedIn(sess(ctx)) || autoLoginFromTelegram(ctx)) return true;
  await showWelcome(ctx);
  return false;
}

async function beginRegister(ctx) {
  if (autoLoginFromTelegram(ctx)) {
    await showMenu(ctx);
    return;
  }
  const lang = langOf(ctx);
  sessions.patch(ctx.from.id, { flow: "register_name", pendingName: null, pendingEmail: null });
  await editOrReply(ctx, t(lang, "regAskName"));
}

async function beginLogin(ctx) {
  if (autoLoginFromTelegram(ctx)) {
    await showMenu(ctx);
    return;
  }
  const lang = langOf(ctx);
  sessions.patch(ctx.from.id, { flow: "register_name", pendingName: null, pendingEmail: null });
  await editOrReply(ctx, t(lang, "needAuth"));
}

async function showNeedAccess(ctx) {
  const lang = langOf(ctx);
  await editOrReply(ctx, t(lang, "needAccess"), plansKeyboard(lang, store.listPlans(), (p) =>
    priceLabel(p.priceCents, { currency: p.currency, interval: p.interval, lang }),
  ));
}

function analysisBlock(lang, m, extraMarkets = "") {
  const p = m.predictionPreview || {};
  const home = esc(m.home?.name || "");
  const away = esc(m.away?.name || "");
  const outcome = pickOutcome(m);
  const conf = p.confidence ?? "—";
  const score = esc(m.scoreText || p.score || "—");

  if (m.cancelled) {
    return [t(lang, "analysisTitle"), t(lang, "predCancelled")].join("\n");
  }

  if (m.finished) {
    return [
      t(lang, "analysisTitle"),
      t(lang, "predFt", { home, away, score }),
      "",
      `${home}  ${p.win ?? "—"}%  ${pctBar(p.win)}`,
      `${t(lang, "drawLabel")}  ${p.draw ?? "—"}%  ${pctBar(p.draw)}`,
      `${away}  ${p.loss ?? "—"}%  ${pctBar(p.loss)}`,
    ].join("\n");
  }

  let sentence = t(lang, "predNone");
  const vals = [Number(p.win) || 0, Number(p.draw) || 0, Number(p.loss) || 0];
  const maxp = Math.max(...vals);
  const gap = maxp - [...vals].sort((a, b) => b - a)[1];
  if (maxp >= 40 || gap >= 6) {
    if (outcome?.side === "home") {
      sentence = t(lang, "predHome", { team: home, pct: outcome.pct, conf });
    } else if (outcome?.side === "draw") {
      sentence = t(lang, "predDraw", { pct: outcome.pct, conf });
    } else if (outcome?.side === "away") {
      sentence = t(lang, "predAway", { team: away, pct: outcome.pct, conf });
    }
  }

  const lines = [t(lang, "analysisTitle")];
  if (m.live) {
    lines.push(t(lang, "predLiveHead", { clock: esc(m.clock || "LIVE"), score }));
  }
  lines.push(sentence);
  if (p.score) {
    lines.push(t(lang, m.live ? "predScoreLive" : "predScore", { score: esc(p.score) }));
  }
  lines.push(
    "",
    `${home}  ${p.win ?? "—"}%  ${pctBar(p.win)}`,
    `${t(lang, "drawLabel")}  ${p.draw ?? "—"}%  ${pctBar(p.draw)}`,
    `${away}  ${p.loss ?? "—"}%  ${pctBar(p.loss)}`,
  );
  if (p.market) {
    lines.push(
      "",
      t(lang, "marketLine", {
        home,
        away,
        hp: p.market.win,
        dp: p.market.draw,
        ap: p.market.loss,
      }),
    );
    if (Number.isFinite(p.edge) && Math.abs(p.edge) >= 4) {
      const pick =
        p.edge > 0
          ? p.win >= p.draw && p.win >= p.loss
            ? home
            : p.loss >= p.draw
              ? away
              : t(lang, "drawLabel")
          : "";
      if (pick) lines.push(t(lang, "edgeLine", { gap: Math.abs(p.edge), pick }));
    }
  }
  const sig = signals(lang, m, outcome);
  if (sig.length) {
    lines.push("", t(lang, "aiSignals"), ...sig.map((s) => `• ${esc(s)}`));
  }
  if (extraMarkets) lines.push("", extraMarkets);
  const footer = t(lang, "aiFooter");
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

async function showMenu(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  trackUser(ctx);
  await requireSession(ctx);
  const all = await loadUpcoming();
  const s = stats(all);
  setView(ctx, { screen: "menu", page: 0, matchId: "", from: "menu", league: "", sort: "time" });
  await editOrReply(ctx, t(lang, "menuHello"), menuKeyboard(lang, { hasLive: s.live > 0 }));
}

async function showLeagues(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  await requireSession(ctx);
  const all = await loadUpcoming();
  setView(ctx, { screen: "leagues", from: "menu", page: 0, matchId: "", league: "" });
  await editOrReply(ctx, t(lang, "stepLeagues"), leaguesKeyboard(lang, all));
}

function listIntro(lang, view, leagueName) {
  if (view.soon) return t(lang, "stepSoon");
  if (view.sort === "confidence") return t(lang, "stepTops");
  if (view.scope === "today") return t(lang, "stepToday");
  if (view.scope === "live") return t(lang, "stepLive");
  if (view.league) return t(lang, "stepLeague", { league: esc(leagueName || view.league) });
  return t(lang, "stepAll");
}

async function showList(ctx, patch = {}) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  await requireSession(ctx);
  const prev = getView(ctx);
  const view = setView(ctx, {
    screen: "list",
    from: "list",
    matchId: "",
    scope: patch.scope ?? prev.scope ?? "today",
    league: patch.league !== undefined ? patch.league : prev.league,
    sort: patch.sort ?? prev.sort ?? "time",
    page: patch.page ?? (patch.scope || patch.league !== undefined || patch.sort ? 0 : prev.page),
  });
  const all = await loadUpcoming(view.scope === "live");
  if (!all.length && matchCache.error) {
    await editOrReply(ctx, t(lang, "matchesLoadError"), menuKeyboard(lang));
    return;
  }
  let list = browseList(all, view);
  let intro = { ...view };
  if (!list.length && !view.league && view.scope !== "live") {
    const fallback = sortMatches(all, view.sort === "confidence" ? "confidence" : "time");
    if (fallback.length) {
      list = fallback;
      intro = { ...view, soon: true, scope: "all" };
      setView(ctx, { scope: "all" });
    }
  }
  const emptyKey =
    view.scope === "live" ? "noLive" : view.league ? "noLeague" : view.scope === "today" ? "noToday" : "noMatches";
  if (!list.length) {
    await editOrReply(ctx, t(lang, emptyKey), menuKeyboard(lang));
    return;
  }
  const { slice, page: p, pages } = paginate(list, view.page, config.pageSize);
  setView(ctx, { page: p });
  const leagueName = slice[0]?.league || "";
  const body = slice
    .map((m, i) => listEntry(m, p * config.pageSize + i + 1, lang, whenText))
    .join("\n\n");
  const text =
    listIntro(lang, { ...intro, page: p }, leagueName) +
    t(lang, "stepCount", { count: list.length, page: p + 1, pages }) +
    `\n\n${body}`;
  await editOrReply(ctx, text, listKeyboard(lang, slice, p, pages, config.pageSize));
}

async function showMatch(ctx, id, { refresh = false } = {}) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  trackUser(ctx);
  if (!hasAccess(ctx)) {
    await showNeedAccess(ctx);
    return;
  }
  const s = await requireSession(ctx);
  const all = await loadUpcoming(true);
  const current = getView(ctx);
  const from = current.screen === "match" ? current.from : current.screen;
  const browseView = {
    ...current,
    screen: "list",
    sort: current.sort,
    scope: current.scope,
    league: current.league,
  };
  const pool = browseList(all, browseView);
  let listed = findMatch(pool, id).match || findMatch(all, id).match;
  if (!listed) {
    try {
      const detail = await api.matchDetail(s.token || undefined, id);
      listed = mergeMatchDetail({ id }, detail);
    } catch {
      listed = null;
    }
  }
  if (!listed) {
    await ctx.reply(t(lang, "noMatches"), { parse_mode: "HTML" });
    return;
  }
  let match = hydrateMatch({
    ...listed,
    home: listed.home,
    away: listed.away,
    predictionPreview: listed.predictionPreview ? { ...listed.predictionPreview } : {},
  });
  setView(ctx, { screen: "match", matchId: listed.id, from: from || "list" });

  const thinkKey = match.live ? "aiThinkingLive" : "aiThinking";
  const thinkText = t(lang, thinkKey, {
    home: esc(match.home?.name),
    away: esc(match.away?.name),
  });
  let thinkingId;
  if (refresh && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(thinkText, { parse_mode: "HTML" });
      thinkingId = ctx.callbackQuery.message.message_id;
    } catch {
      const thinking = await ctx.reply(thinkText, { parse_mode: "HTML" });
      thinkingId = thinking.message_id;
    }
  } else {
    const thinking = await ctx.reply(thinkText, { parse_mode: "HTML" });
    thinkingId = thinking.message_id;
  }
  try {
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
  } catch {
    /* */
  }
  await sleep(refresh ? 280 : 800 + Math.floor(Math.random() * 500));

  let extra = "";
  try {
    const detail = await api.matchDetail(s.token || undefined, listed.id);
    match = mergeMatchDetail(match, detail);
  } catch {
    /* listed data is enough */
  }
  try {
    const data = await api.matchPredictions(s.token || undefined, listed.id);
    if (data.markets?.length) {
      extra = data.markets
        .slice(0, 6)
        .map((mk) => `• ${esc(mk.label)} — ${mk.pct}%`)
        .join("\n");
    }
    match.predictionPreview = resolvePrediction(match, data);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 402 || e.code === "INSUFFICIENT_CREDITS")) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, thinkingId, t(lang, "creditsLow"), {
          parse_mode: "HTML",
        });
      } catch {
        await ctx.reply(t(lang, "creditsLow"), { parse_mode: "HTML" });
      }
      return;
    }
    match.predictionPreview = resolvePrediction(match);
  }
  if (!match.predictionPreview?.win && !match.predictionPreview?.draw && !match.finished && !match.cancelled) {
    match.predictionPreview = resolvePrediction(match);
  }

  const text = `${t(lang, "stepAnalysis")}${matchCard(lang, match)}\n\n${analysisBlock(lang, match, extra)}`;
  const nav = neighbors(pool.length ? pool : all, listed.id);
  const markup = matchDetailKeyboard(lang, match, { prev: nav.prev, next: nav.next });
  try {
    await ctx.api.editMessageText(ctx.chat.id, thinkingId, text, {
      parse_mode: "HTML",
      reply_markup: markup,
    });
  } catch {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: markup });
  }
}

async function goBack(ctx) {
  const view = getView(ctx);
  if (view.from === "leagues" || view.league) {
    if (view.screen === "match") return showList(ctx);
    return showLeagues(ctx);
  }
  if (view.screen === "match") return showList(ctx);
  return showMenu(ctx);
}

async function openListedNumber(ctx, n) {
  const view = getView(ctx);
  if (view.screen !== "list" && view.screen !== "match") return false;
  const all = await loadUpcoming();
  const list = browseList(all, view.screen === "match" ? { ...view, screen: "list" } : view);
  const m = list[n - 1];
  if (!m) return false;
  await showMatch(ctx, m.id);
  return true;
}

function profileMarkup(lang, s) {
  return profileKeyboard(lang, { loggedIn: loggedIn(s), notif: s.notif !== false });
}

async function showProfile(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  trackUser(ctx);
  const s = await requireSession(ctx);
  setView(ctx, { screen: "account" });
  const local = currentUser(ctx);
  const sub = local ? store.activeSubForUser(local.id) : null;
  const u = local || s.user || {};
  await editOrReply(
    ctx,
    t(lang, "profile", {
      name: esc(u.displayName || u.email || ctx.from.first_name),
      plan: esc(sub?.planName || t(lang, "noAccessPlan")),
      credits: "",
      quota: sub
        ? `Until ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB")}`
        : "Grab an access pass to use the bot.",
    }),
    profileMarkup(lang, sessions.get(ctx.from.id) || s),
  );
}

async function showReferral(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  if (!loggedIn(s)) {
    await editOrReply(ctx, t(lang, "needLogin"), profileMarkup(lang, s));
    return;
  }
  if (!s.token) {
    await editOrReply(ctx, t(lang, "familyEmpty"), profileMarkup(lang, s));
    return;
  }
  const data = await api.referral(s.token);
  const r = data.referral || {};
  const link = botUsername ? `https://t.me/${botUsername}?start=${r.code}` : r.code;
  let text = t(lang, "referral", {
    code: esc(r.code),
    link: esc(link),
    count: r.familyCount ?? 0,
    credits: r.creditsFromReferrals ?? 0,
  });
  const family = r.family || [];
  text += "\n\n";
  if (!family.length) text += t(lang, "familyEmpty");
  else {
    text += family
      .slice(0, 15)
      .map((f) => t(lang, "familyRow", { name: esc(f.name), credits: f.creditsEarned ?? 0 }))
      .join("\n");
  }
  await editOrReply(ctx, text, profileMarkup(lang, s));
}

async function showPlans(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  const localUser = currentUser(ctx) || trackUser(ctx);
  const s = await requireSession(ctx);
  const plans = store.listPlans();
  const sub = localUser ? store.activeSubForUser(localUser.id) : null;
  const current = sub?.planName || t(lang, "noAccessPlan");
  let text = t(lang, "plansTitle", { plan: esc(current) }) + "\n";
  for (const p of plans) {
    text +=
      "\n" +
      t(lang, "planCard", {
        name: esc(p.name),
        price: priceLabel(p.priceCents, { currency: p.currency, interval: p.interval, lang }),
        desc: esc(p.description || ""),
        credits: p.credits ?? p.maxPredictionsPerDay ?? "—",
      }) +
      "\n";
  }
  await editOrReply(
    ctx,
    text,
    plansKeyboard(lang, plans, (p) => priceLabel(p.priceCents, { currency: p.currency, interval: p.interval, lang })),
  );
}

async function startPaystackPay(ctx, planCode) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  const user = currentUser(ctx) || trackUser(ctx);
  const plan = store.getPlan(planCode);
  if (!user || !plan || !plan.active) {
    await html(ctx, t(lang, "error", { msg: "Plan unavailable" }));
    return;
  }
  try {
    const checkout = await paystack.createCheckout({ user, plan, telegramId: ctx.from.id, lang });
    if (checkout.free) {
      await editOrReply(ctx, t(lang, "payFree", { plan: esc(plan.name) }), profileMarkup(lang, sess(ctx)));
      return;
    }
    if (!checkout.checkoutUrl) throw new Error("Paystack did not return a payment URL");
    await editOrReply(
      ctx,
      t(lang, "payLink", {
        plan: esc(plan.name),
        price: priceLabel(plan.priceCents, { currency: plan.currency, interval: plan.interval, lang }),
      }) + `\n\n${esc(checkout.checkoutUrl)}`,
      payKeyboard(lang, checkout.checkoutUrl),
    );
  } catch (e) {
    if (e.code === "PAYSTACK_NOT_CONFIGURED") {
      await html(ctx, t(lang, "payNotConfigured"));
      return;
    }
    await html(ctx, t(lang, "error", { msg: esc(e.message) }));
  }
}

async function showHelp(ctx) {
  if (!(await requireLogin(ctx))) return;
  const lang = langOf(ctx);
  await html(
    ctx,
    t(lang, "help", { email: esc(config.supportEmail), web: esc(config.webUrl) }),
  );
}

function isMenuText(text, lang) {
  const labels = [t(lang, "btnMenu"), t(lang, "btnToday"), t(lang, "btnLeagues"), t(lang, "btnAccount"), t(lang, "btnHelp")];
  if (labels.includes(text)) return true;
  return /Menu|Menú|Меню|Aujourd'hui|Today|Hoy|Сегодня|Compétition|Competition|Competiciones|Турнир|Compte|Account|Cuenta|Аккаунт|Aide|Help|Ayuda|Помощь|Analyses|Prédictions/.test(
    text,
  );
}

async function handleMenu(ctx, text, lang) {
  if (text === t(lang, "btnMenu") || /^🏠/.test(text)) {
    await showMenu(ctx);
    return true;
  }
  if (text === t(lang, "btnToday") || text.includes("Aujourd'hui") || text.includes("Today") || text.includes("Hoy") || text.includes("Сегодня")) {
    await showList(ctx, { scope: "today", league: "", sort: "time", page: 0 });
    return true;
  }
  if (text === t(lang, "btnLeagues") || text.includes("Compétition") || text.includes("Competition") || text.includes("Турнир")) {
    await showLeagues(ctx);
    return true;
  }
  if (text === t(lang, "btnAccount") || text.includes("Compte") || text.includes("Account") || text.includes("Cuenta") || text.includes("Аккаунт")) {
    await showProfile(ctx);
    return true;
  }
  if (text === t(lang, "btnHelp") || text.includes("Aide") || text.includes("Help") || text.includes("Ayuda") || text.includes("Помощь")) {
    await showHelp(ctx);
    return true;
  }
  return false;
}

async function applyLogin(ctx, email, password) {
  const user = store.loginBotUser({ from: ctx.from, email, password });
  let token = null;
  let remoteUser = null;
  try {
    const data = await api.login({ email, password });
    const extracted = extractAuth(data);
    token = extracted.token || null;
    remoteUser = extracted.user || null;
  } catch {
    /* le compte local suffit */
  }
  sessions.patch(ctx.from.id, {
    loggedIn: true,
    userId: user.id,
    token,
    user: remoteUser || user,
    flow: null,
    pendingEmail: null,
    pendingName: null,
  });
  try {
    await ctx.deleteMessage();
  } catch {
    /* */
  }
  return sessions.get(ctx.from.id);
}

bot.catch((err) => {
  console.error("Bot error:", err.error ?? err);
});

bot.command("start", async (ctx) => {
  const payload = String(ctx.match || "").trim();
  if (payload) sessions.patch(ctx.from.id, { pendingRef: payload });
  autoLoginFromTelegram(ctx);
  if (!loggedIn(sess(ctx))) {
    sessions.patch(ctx.from.id, { flow: null, pendingEmail: null, pendingName: null });
    await showWelcome(ctx);
    return;
  }
  try {
    await ensureAuth(ctx);
  } catch (e) {
    if (e?.message) console.warn("start:", e.message);
  }
  await showMenu(ctx);
});

bot.command("help", (ctx) => showHelp(ctx));
bot.command("profile", (ctx) => showProfile(ctx));
bot.command("matches", (ctx) => showList(ctx, { scope: "today", league: "", sort: "time", page: 0 }));
bot.command("predictions", (ctx) => showMenu(ctx));

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const lang = langOf(ctx);
  if (data.startsWith("m:")) {
    await ctx.answerCallbackQuery({ text: t(lang, "toastOpen") });
  } else if (data.startsWith("r:")) {
    await ctx.answerCallbackQuery({ text: t(lang, "toastRefresh") });
  } else {
    await ctx.answerCallbackQuery();
  }

  try {
    if (data === "noop") return;
    if (data === "auth:register") return void (await beginRegister(ctx));
    if (data === "auth:login") return void (await beginLogin(ctx));
    if (!loggedIn(sess(ctx)) && !autoLoginFromTelegram(ctx)) {
      if (data === "lang" || data.startsWith("setlang:")) {
        /* langue avant connexion */
      } else {
        return void (await showWelcome(ctx));
      }
    }
    if (data === "help") return void (await showHelp(ctx));
    if (data === "profile") return void (await showProfile(ctx));
    if (data === "sub") return void (await showPlans(ctx));
    if (data === "ref") return void (await showReferral(ctx));
    if (data === "lang" || data.startsWith("setlang:")) return;
    if (data === "go:menu" || data === "go:home") return void (await showMenu(ctx));
    if (data === "go:back") return void (await goBack(ctx));
    if (data === "go:leagues") return void (await showLeagues(ctx));
    if (data === "go:top") {
      return void (await showList(ctx, { scope: "today", league: "", sort: "confidence", page: 0 }));
    }
    if (data.startsWith("go:list:")) {
      return void (await showList(ctx, { scope: data.slice(8), league: "", sort: "time", page: 0 }));
    }
    if (data.startsWith("lg:")) {
      return void (await showList(ctx, { scope: "all", league: data.slice(3), sort: "time", page: 0 }));
    }
    if (data.startsWith("pg:")) {
      return void (await showList(ctx, { page: Number(data.slice(3)) || 0 }));
    }
    if (data.startsWith("r:")) return void (await showMatch(ctx, data.slice(2), { refresh: true }));
    if (data.startsWith("m:")) return void (await showMatch(ctx, data.slice(2)));
    if (data === "notif") {
      const s = sess(ctx);
      const next = s.notif === false;
      const updated = sessions.patch(ctx.from.id, { notif: next });
      return void (await html(ctx, t(lang, next ? "notifOn" : "notifOff"), {
        reply_markup: profileMarkup(lang, updated),
      }));
    }
    if (data === "link") return void (await beginLogin(ctx));
    if (data === "logout") {
      sessions.patch(ctx.from.id, {
        loggedIn: false,
        token: null,
        user: null,
        userId: null,
        flow: null,
        pendingEmail: null,
        pendingName: null,
      });
      await ctx.reply(t(lang, "logoutOk"), {
        parse_mode: "HTML",
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    if (data.startsWith("plan:")) {
      return void (await startPaystackPay(ctx, data.slice(5)));
    }
    if (data.startsWith("pay:")) {
      return void (await startPaystackPay(ctx, data.split(":")[1]));
    }
  } catch (e) {
    await html(ctx, t(lang, "error", { msg: esc(e.message) }));
  }
});

async function handleAuthText(ctx, text, lang, s) {
  if (isMenuText(text, lang)) {
    sessions.patch(ctx.from.id, { flow: null, pendingEmail: null, pendingName: null });
    if (loggedIn(sess(ctx)) || autoLoginFromTelegram(ctx)) await showMenu(ctx);
    else await showWelcome(ctx);
    return true;
  }

  const flow = s.flow === "link_email" ? "login_email" : s.flow === "link_pass" ? "login_pass" : s.flow;

  if (flow === "register_name") {
    if (text.trim().length < 2) {
      await html(ctx, t(lang, "nameBad"));
      return true;
    }
    sessions.patch(ctx.from.id, { flow: "register_email", pendingName: text.trim() });
    await html(ctx, t(lang, "regAskEmail"));
    return true;
  }

  if (flow === "register_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
      await html(ctx, t(lang, "emailBad"));
      return true;
    }
    sessions.patch(ctx.from.id, { flow: "register_pass", pendingEmail: text.trim().toLowerCase() });
    await html(ctx, t(lang, "regAskPass"));
    return true;
  }

  if (flow === "register_pass") {
    try {
      await ctx.deleteMessage();
    } catch {
      /* */
    }
    if (text.length < 6) {
      await html(ctx, t(lang, "passBad"));
      return true;
    }
    try {
      store.registerBotUser({
        from: ctx.from,
        email: s.pendingEmail,
        password: text,
        displayName: s.pendingName || ctx.from.first_name,
        lang,
        referralCode: s.pendingRef || "",
      });
      await applyLogin(ctx, s.pendingEmail, text);
      await html(ctx, t(lang, "regOk"));
    } catch (e) {
      if (e.code === "ALREADY_REGISTERED") {
        autoLoginFromTelegram(ctx);
        await html(ctx, t(lang, "regAlready"));
      } else if (e.code === "EMAIL_TAKEN") {
        sessions.patch(ctx.from.id, { flow: "register_email" });
        await html(ctx, t(lang, "regEmailTaken"));
        return true;
      } else {
        await html(ctx, authErrorText(lang, e));
        return true;
      }
    }
    try {
      await showMenu(ctx);
    } catch (e) {
      console.warn("menu after register:", e.message);
      await html(ctx, t(lang, "menuHello"), { reply_markup: menuKeyboard(lang) });
    }
    return true;
  }

  if (flow === "login_email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
      await html(ctx, t(lang, "emailBad"));
      return true;
    }
    sessions.patch(ctx.from.id, { flow: "login_pass", pendingEmail: text.trim().toLowerCase() });
    await html(ctx, t(lang, "loginAskPass"));
    return true;
  }

  if (flow === "login_pass") {
    try {
      await applyLogin(ctx, s.pendingEmail, text);
      await html(ctx, t(lang, "loginOk"));
      await showMenu(ctx);
    } catch (e) {
      sessions.patch(ctx.from.id, { flow: "login_email", pendingEmail: null });
      await html(ctx, authErrorText(lang, e));
    }
    return true;
  }

  return false;
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  const lang = langOf(ctx);
  try {
    const s = sess(ctx);

    if (isAuthFlow(s.flow) || s.flow === "link_email" || s.flow === "link_pass") {
      await handleAuthText(ctx, text, lang, s);
      return;
    }

    if (!loggedIn(s) && autoLoginFromTelegram(ctx)) {
      await showMenu(ctx);
      return;
    }

    if (!loggedIn(sess(ctx))) {
      await showWelcome(ctx);
      return;
    }

    if (/^\d+$/.test(text) && (await openListedNumber(ctx, Number(text)))) return;
    if (await handleMenu(ctx, text, lang)) return;
    await showMenu(ctx);
  } catch (e) {
    console.warn("message:", e.message);
    await html(ctx, t(lang, "menuHello"), { reply_markup: menuKeyboard(lang) });
  }
});

async function reminderTick() {
  try {
    const list = await loadUpcoming(true);
    const soon = list.filter((m) => {
      if (!m.dateIso) return false;
      const diff = new Date(m.dateIso).getTime() - Date.now();
      return diff > 0 && diff < 90 * 60 * 1000;
    });
    if (!soon.length) return;

    for (const [id, s] of sessions.entries()) {
      if (!s.loggedIn || s.notif === false) continue;
      const reminded = s.reminded || {};
      for (const m of soon.slice(0, 3)) {
        if (reminded[m.id]) continue;
        const lang = "en";
        try {
          await bot.api.sendMessage(
            Number(id),
            t(lang, "reminder", {
              home: esc(m.home?.name),
              away: esc(m.away?.name),
              when: esc(whenText(m, lang)),
              league: esc(m.league),
            }),
            { parse_mode: "HTML" },
          );
          reminded[m.id] = Date.now();
        } catch {
          /* user blocked bot */
        }
      }
      sessions.patch(Number(id), { reminded });
    }
  } catch (e) {
    console.warn("reminder:", e.message);
  }
}

async function start() {
  const generated = config.adminPassword ? "" : randomBytes(9).toString("base64url");
  const boot = store.ensureAdmin(generated || config.adminPassword || "changeme-admin");
  if (boot.created && boot.password) {
    console.log(`Admin web: ${boot.email}  password: ${boot.password}`);
    console.log("Set ADMIN_PASSWORD in .env to pin it.");
  }

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
  startHttpServer({ config, store, paystack, publicDir });

  try {
    const h = await api.health();
    console.log(`Predictbet API OK (db=${h.database}) → ${config.apiUrl}`);
  } catch (e) {
    console.warn(`API health (${config.apiUrl}): ${e.message}`);
  }
  const bootList = await loadUpcoming(true);
  console.log(`Matches loaded: ${bootList.length} (${config.apiUrl})`);

  const me = await bot.api.getMe();
  botUsername = me.username;
  console.log(`Telegram bot @${me.username} started (long polling)`);
  console.log(`Paystack: ${paystack.configured ? paystack.env : "not configured"} → ${paystack.apiUrl}`);
  if (!paystack.configured) {
    console.warn("Paystack: set PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY (Paystack dashboard → Settings → API Keys).");
  }
  if (!/^https:\/\//i.test(config.publicUrl) || /localhost|127\.0\.0\.1/i.test(config.publicUrl)) {
    console.warn("Paystack: PUBLIC_URL must be a public HTTPS URL — webhooks and callback_url reject HTTP/localhost.");
  }

  setInterval(() => void reminderTick(), 15 * 60 * 1000);
  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });
}

process.on("SIGINT", () => {
  sessions.flush();
  process.exit(0);
});
process.on("SIGTERM", () => {
  sessions.flush();
  process.exit(0);
});

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
