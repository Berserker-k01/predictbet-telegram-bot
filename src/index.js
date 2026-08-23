import "./load-env.js";
import { Bot } from "grammy";
import { loadConfig } from "./config.js";
import { createApi, ApiError } from "./api.js";
import { createSessionStore, initialSession } from "./session-store.js";
import { t } from "./i18n.js";
import {
  esc,
  upcoming,
  isLocked,
  pickLabel,
  whenText,
  paginate,
  priceLabel,
} from "./format.js";
import {
  mainKeyboard,
  matchListKeyboard,
  matchDetailKeyboard,
  profileKeyboard,
  langKeyboard,
  plansKeyboard,
  payKeyboard,
} from "./keyboards.js";

const config = loadConfig();
if (!config.token) {
  console.error("TELEGRAM_BOT_TOKEN manquant. Copiez telegram-bot/.env.example");
  process.exit(1);
}

const api = createApi(config);
const sessions = createSessionStore(config.sessionFile);
const bot = new Bot(config.token);
let botUsername = "";

function sess(ctx) {
  const id = ctx.from?.id;
  if (!id) return initialSession();
  return sessions.get(id) ?? sessions.patch(id, initialSession());
}

function langOf(ctx) {
  return sess(ctx).lang || "fr";
}

function html(ctx, text, extra = {}) {
  return ctx.reply(text, {
    parse_mode: "HTML",
    ...extra,
    reply_markup: extra.reply_markup ?? mainKeyboard(langOf(ctx)),
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
    reply_markup: markup ?? mainKeyboard(langOf(ctx)),
  });
}

async function ensureAuth(ctx, referralCode) {
  const s = sess(ctx);
  if (s.token && s.user) {
    try {
      const me = await api.me(s.token);
      sessions.patch(ctx.from.id, { user: me.user, token: s.token, flow: null });
      return sessions.get(ctx.from.id);
    } catch {
      sessions.patch(ctx.from.id, { token: null, user: null });
    }
  }

  const data = await api.telegramAuth({
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    referralCode: referralCode || s.pendingRef || "",
  });
  sessions.patch(ctx.from.id, {
    token: data.token,
    user: data.user,
    flow: null,
    pendingRef: null,
  });
  return sessions.get(ctx.from.id);
}

async function requireSession(ctx) {
  const s = sess(ctx);
  if (s.token && s.user) return s;
  try {
    return await ensureAuth(ctx);
  } catch (e) {
    await html(ctx, t(langOf(ctx), "needAuth"));
    throw e;
  }
}

async function loadUpcoming() {
  const data = await api.matches({ upcoming: true });
  return upcoming(data.matches || []);
}

function matchCard(lang, m) {
  let body = t(lang, "matchInfo", {
    home: esc(m.home?.name),
    away: esc(m.away?.name),
    league: esc(m.league),
    when: esc(whenText(m)),
    stadium: esc(m.stadium || "—"),
    context: esc(m.context || ""),
  });
  if (m.referee) body += `\n${t(lang, "referee", { name: esc(m.referee) })}`;
  return body;
}

async function showMatches(ctx, page = 0, kind = "home") {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  const list = await loadUpcoming();
  if (!list.length) {
    await editOrReply(ctx, t(lang, "noMatches"), mainKeyboard(lang));
    return;
  }
  const { page: p, pages } = paginate(list, page, config.pageSize);
  const title = kind === "pred" ? t(lang, "predTitle") : t(lang, "matchesTitle", { page: p + 1, pages });
  await editOrReply(
    ctx,
    title,
    matchListKeyboard(
      lang,
      list,
      p,
      config.pageSize,
      kind,
      s.user?.plan,
      config.freePreview,
      t(lang, "live"),
    ),
  );
}

async function showMatch(ctx, id, kind = "home") {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  const list = await loadUpcoming();
  const idx = list.findIndex((m) => m.id === id);
  const m = list[idx] ?? list.find((x) => String(x.externalId) === id);
  if (!m) {
    await editOrReply(ctx, t(lang, "noMatches"));
    return;
  }
  const locked = isLocked(s.user?.plan, idx < 0 ? 0 : idx, config.freePreview);
  let text = matchCard(lang, m);
  if (locked) {
    text += `\n\n${t(lang, "locked")}`;
  } else if (m.predictionPreview) {
    text += `\n\n${t(lang, "preview", {
      pick: pickLabel(m, {
        home: t(lang, "pickHome"),
        draw: t(lang, "pickDraw"),
        away: t(lang, "pickAway"),
      }),
      conf: m.predictionPreview.confidence ?? "—",
    })}`;
  }
  await editOrReply(ctx, text, matchDetailKeyboard(lang, m, locked));
}

async function showFullPred(ctx, id) {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  const list = await loadUpcoming();
  const idx = list.findIndex((m) => m.id === id);
  if (isLocked(s.user?.plan, idx, config.freePreview)) {
    await editOrReply(ctx, t(lang, "locked"));
    await showPlans(ctx);
    return;
  }
  try {
    const data = await api.matchPredictions(s.token, id);
    const m = data.match ?? list[idx];
    const home = esc(m?.home?.name || "1");
    const away = esc(m?.away?.name || "2");
    const markets = (data.markets || [])
      .slice(0, 6)
      .map((mk) => `• ${esc(mk.label)} — ${mk.pct}%`)
      .join("\n");
    let text = t(lang, "predBody", {
      home,
      away,
      win: data.probs?.win ?? "—",
      draw: data.probs?.draw ?? "—",
      loss: data.probs?.loss ?? "—",
      conf: data.confidence ?? "—",
      markets,
    });
    text += `\n\n<i>${t(lang, "creditCharged")}</i>`;
    await editOrReply(ctx, text, matchDetailKeyboard(lang, { id }, false));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 402 || e.code === "INSUFFICIENT_CREDITS")) {
      await editOrReply(ctx, t(lang, "creditsLow"));
      return;
    }
    throw e;
  }
}

async function showProfile(ctx) {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  let credits = "—";
  let quota = "—";
  try {
    const c = await api.credits(s.token);
    credits = String(c.balance ?? "—");
    quota = String(c.monthlyAllowance ?? "—");
    sessions.patch(ctx.from.id, { user: { ...s.user, plan: c.planCode || s.user.plan, planName: c.planName || s.user.planName } });
  } catch {
    /* */
  }
  const u = sessions.get(ctx.from.id)?.user || s.user;
  await editOrReply(
    ctx,
    t(lang, "profile", {
      name: esc(u.displayName || u.email),
      plan: esc(u.planName || u.plan || "Starter"),
      credits,
      quota,
    }),
    profileKeyboard(lang),
  );
}

async function showReferral(ctx) {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
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
  await editOrReply(ctx, text, profileKeyboard(lang));
}

async function showPlans(ctx) {
  const lang = langOf(ctx);
  const s = await requireSession(ctx);
  const [plansRes, subRes] = await Promise.all([
    api.plans(),
    api.subscription(s.token).catch(() => ({ subscription: null })),
  ]);
  const current = subRes.subscription?.planName || s.user?.planName || s.user?.plan || "—";
  let text = t(lang, "plansTitle", { plan: esc(current) }) + "\n";
  for (const p of plansRes.plans || []) {
    text +=
      "\n" +
      t(lang, "planCard", {
        name: esc(p.name),
        price: priceLabel(p.price_cents),
        desc: esc(p.description || ""),
        credits: p.monthly_credits ?? p.max_predictions_per_day ?? "—",
      }) +
      "\n";
  }
  await editOrReply(ctx, text, plansKeyboard(lang, plansRes.plans || []));
}

async function showHelp(ctx) {
  const lang = langOf(ctx);
  await html(
    ctx,
    t(lang, "help", { email: esc(config.supportEmail), web: esc(config.webUrl) }),
  );
}

bot.catch((err) => {
  console.error("Bot error:", err.error ?? err);
});

bot.command("start", async (ctx) => {
  const payload = String(ctx.match || "").trim();
  if (payload) sessions.patch(ctx.from.id, { pendingRef: payload });
  const lang = langOf(ctx);
  try {
    const s = await ensureAuth(ctx, payload);
    await html(
      ctx,
      `${t(lang, "start")}\n\n${t(lang, "startLinked", {
        name: esc(s.user?.displayName || s.user?.email),
        plan: esc(s.user?.planName || s.user?.plan || "Starter"),
      })}`,
    );
  } catch (e) {
    await html(ctx, t(lang, "error", { msg: esc(e.message) }));
  }
});

bot.command("help", (ctx) => showHelp(ctx));
bot.command("profile", (ctx) => showProfile(ctx));
bot.command("matches", (ctx) => showMatches(ctx, 0, "home"));
bot.command("predictions", (ctx) => showMatches(ctx, 0, "pred"));

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();
  const lang = langOf(ctx);

  try {
    if (data === "noop") return;
    if (data === "profile") return void (await showProfile(ctx));
    if (data === "sub") return void (await showPlans(ctx));
    if (data === "ref") return void (await showReferral(ctx));
    if (data === "lang") return void (await editOrReply(ctx, t(lang, "langTitle"), langKeyboard()));
    if (data === "link") {
      sessions.patch(ctx.from.id, { flow: "link_email" });
      return void (await html(ctx, t(lang, "linkAskEmail")));
    }
    if (data === "logout") {
      sessions.patch(ctx.from.id, { token: null, user: null, flow: null });
      return void (await html(ctx, t(lang, "logoutOk")));
    }
    if (data.startsWith("setlang:")) {
      const code = data.split(":")[1];
      sessions.patch(ctx.from.id, { lang: code });
      return void (await html(ctx, t(code, "langSet")));
    }
    if (data.startsWith("pg:")) {
      const [, kind, page] = data.split(":");
      return void (await showMatches(ctx, Number(page) || 0, kind === "pred" ? "pred" : "home"));
    }
    if (data.startsWith("home:") || data.startsWith("pred:")) {
      const [kind, ...rest] = data.split(":");
      return void (await showMatch(ctx, rest.join(":"), kind));
    }
    if (data.startsWith("full:")) {
      return void (await showFullPred(ctx, data.slice(5)));
    }
    if (data.startsWith("plan:")) {
      const planCode = data.slice(5);
      const methods = await api.paymentMethods();
      return void (await editOrReply(
        ctx,
        t(lang, "pickPay", { plan: esc(planCode) }),
        payKeyboard(planCode, methods.methods || []),
      ));
    }
    if (data.startsWith("pay:")) {
      const [, planCode, method] = data.split(":");
      const s = await requireSession(ctx);
      await api.upgradeRequest(s.token, { planCode, paymentMethodCode: method });
      return void (await html(ctx, t(lang, "upgradeOk")));
    }
  } catch (e) {
    await html(ctx, t(lang, "error", { msg: esc(e.message) }));
  }
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  const lang = langOf(ctx);
  const s = sess(ctx);

  if (s.flow === "link_email") {
    if (text === "/start") {
      sessions.patch(ctx.from.id, { flow: null });
      return;
    }
    sessions.patch(ctx.from.id, { flow: "link_pass", pendingEmail: text });
    await html(ctx, t(lang, "linkAskPass"));
    return;
  }

  if (s.flow === "link_pass") {
    try {
      const data = await api.telegramAuth({
        telegramId: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        linkEmail: s.pendingEmail,
        linkPassword: text,
      });
      sessions.patch(ctx.from.id, {
        token: data.token,
        user: data.user,
        flow: null,
        pendingEmail: null,
      });
      try {
        await ctx.deleteMessage();
      } catch {
        /* */
      }
      await html(ctx, t(lang, "linkOk", { name: esc(data.user.displayName || data.user.email) }));
    } catch (e) {
      sessions.patch(ctx.from.id, { flow: null, pendingEmail: null });
      await html(ctx, t(lang, "error", { msg: esc(e.message) }));
    }
    return;
  }

  if (text === t(lang, "btnHome") || text === "⚽ Matchs" || text === "⚽ Matches" || text === "⚽ Partidos" || text === "⚽ Матчи") {
    await showMatches(ctx, 0, "home");
    return;
  }
  if (text === t(lang, "btnPred") || text.includes("Prédictions") || text.includes("Predictions") || text.includes("Pronósticos") || text.includes("Прогнозы")) {
    await showMatches(ctx, 0, "pred");
    return;
  }
  if (text === t(lang, "btnProfile") || text.includes("Profil") || text.includes("Profile") || text.includes("Perfil") || text.includes("Профиль")) {
    await showProfile(ctx);
    return;
  }
  if (text === t(lang, "btnHelp") || text.includes("Aide") || text.includes("Help") || text.includes("Ayuda") || text.includes("Помощь")) {
    await showHelp(ctx);
    return;
  }

  await html(ctx, t(lang, "menu"));
});

async function reminderTick() {
  try {
    const list = await loadUpcoming();
    const soon = list.filter((m) => {
      if (!m.dateIso) return false;
      const diff = new Date(m.dateIso).getTime() - Date.now();
      return diff > 0 && diff < 90 * 60 * 1000;
    });
    if (!soon.length) return;

    for (const [id, s] of sessions.entries()) {
      if (!s.notif || !s.token) continue;
      const reminded = s.reminded || {};
      for (const m of soon.slice(0, 3)) {
        if (reminded[m.id]) continue;
        const lang = s.lang || "fr";
        try {
          await bot.api.sendMessage(
            Number(id),
            t(lang, "reminder", {
              home: esc(m.home?.name),
              away: esc(m.away?.name),
              when: esc(whenText(m)),
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
  try {
    const h = await api.health();
    console.log(`API Predictbet OK (db=${h.database}) → ${config.apiUrl}`);
  } catch (e) {
    console.warn(`API injoignable (${config.apiUrl}): ${e.message}`);
  }

  const me = await bot.api.getMe();
  botUsername = me.username;
  console.log(`Bot Telegram @${me.username} démarré (long polling)`);

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
