const LOCALES = { fr: "fr-FR", en: "en-GB", es: "es-ES", ru: "ru-RU" };

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function kickoffIso(m) {
  const raw = m?.dateIso || m?.utcDate || m?.kickoff || m?.startAt || "";
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const st = String(m?.status || "").trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(st)) {
    const d = new Date(st.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return raw || "";
}

const DONE = new Set([
  "FINISHED",
  "AWARDED",
  "FT",
  "AET",
  "FULL_TIME",
  "ENDED",
  "COMPLETE",
  "COMPLETED",
]);
const LIVE = new Set([
  "IN_PLAY",
  "PAUSED",
  "LIVE",
  "HALFTIME",
  "HT",
  "1H",
  "2H",
  "ET",
  "BT",
  "P",
  "INT",
  "BREAK",
  "EXTRA_TIME",
  "PENALTIES",
]);
const CANCEL = new Set([
  "CANCELLED",
  "CANCELED",
  "ABANDONED",
  "POSTPONED",
  "SUSPENDED",
  "PST",
  "CANC",
  "ABD",
]);
const KICKOFF_GRACE_MS = 3 * 60 * 60 * 1000;
const FINISHED_KEEP_MS = 4 * 60 * 60 * 1000;
const LIVE_MAX_MS = 2.5 * 60 * 60 * 1000;

function numFirst(...vals) {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseScoreText(s) {
  const m = String(s || "").match(/(\d+)\s*[-–:]\s*(\d+)/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

function unwrapMatch(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const inner = raw.match || raw.fixture || raw.data?.match || raw.data?.fixture || raw.data || raw;
  if (inner.teams && (inner.fixture || inner.goals)) {
    const fx = inner.fixture || {};
    const st = fx.status || {};
    return {
      ...inner,
      id: fx.id || inner.id,
      dateIso: fx.date || inner.dateIso,
      status: st.short || st.long || inner.status,
      minute: st.elapsed ?? inner.minute,
      injuryTime: st.extra ?? inner.injuryTime,
      home: {
        ...(inner.home || {}),
        name: inner.teams?.home?.name || inner.home?.name,
        score: inner.goals?.home ?? inner.home?.score,
      },
      away: {
        ...(inner.away || {}),
        name: inner.teams?.away?.name || inner.away?.name,
        score: inner.goals?.away ?? inner.away?.score,
      },
      league: inner.league?.name || inner.league,
      leagueId: inner.league?.id || inner.leagueId,
      goals: inner.goals,
      score: inner.score,
    };
  }
  return inner;
}

export function matchScore(m) {
  if (!m || typeof m !== "object") return null;
  const scoreObj = typeof m.score === "object" && m.score ? m.score : null;
  const parsed = parseScoreText(
    m.scoreText || m.ftScore || m.result || (typeof m.score === "string" ? m.score : ""),
  );
  const h = numFirst(
    parsed?.home,
    m.homeScore,
    m.homeGoals,
    m.goalsHome,
    m.home?.score,
    m.home?.goals,
    m.home?.goal,
    scoreObj?.home,
    scoreObj?.homeTeam,
    scoreObj?.fullTime?.home,
    scoreObj?.fullTime?.homeTeam,
    scoreObj?.current?.home,
    m.goals?.home,
    m.fullTime?.home,
    m.ft?.home,
  );
  const a = numFirst(
    parsed?.away,
    m.awayScore,
    m.awayGoals,
    m.goalsAway,
    m.away?.score,
    m.away?.goals,
    m.away?.goal,
    scoreObj?.away,
    scoreObj?.awayTeam,
    scoreObj?.fullTime?.away,
    scoreObj?.fullTime?.awayTeam,
    scoreObj?.current?.away,
    m.goals?.away,
    m.fullTime?.away,
    m.ft?.away,
  );
  if (h == null || a == null) return null;
  return { home: h, away: a, text: `${h}–${a}` };
}

export function matchMinute(m, now = new Date()) {
  const min = numFirst(
    m?.minute,
    m?.elapsed,
    m?.clock,
    m?.time?.elapsed,
    m?.time?.minute,
    m?.statusMinute,
    m?.matchMinute,
    typeof m?.status === "object" ? m.status?.elapsed : null,
  );
  if (min != null) return min;
  const t = new Date(m?.dateIso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  const elapsed = Math.floor((now.getTime() - t) / 60_000);
  if (elapsed < 0 || elapsed > 130) return null;
  return elapsed;
}

export function matchClock(m, now = new Date()) {
  const st = String(m?.status ?? "").toUpperCase();
  if (st === "HALFTIME" || st === "PAUSED" || st === "HT" || st === "BREAK") return "MT";
  const min = matchMinute(m, now);
  if (min == null) return "";
  const extra = numFirst(m?.injuryTime, m?.addedTime, m?.time?.extra, m?.minuteExtra);
  return extra ? `${min}+${extra}'` : `${min}'`;
}

export function matchPhase(m, now = new Date()) {
  const st = String(m?.status ?? "").toUpperCase();
  if (CANCEL.has(st)) return "cancelled";
  if (DONE.has(st) || m?.finished) return "finished";
  if (m?.live || LIVE.has(st)) return "live";
  const t = new Date(m?.dateIso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return "upcoming";
  const elapsed = now.getTime() - t;
  if (elapsed > LIVE_MAX_MS) return "finished";
  if (elapsed > 60_000) return "live";
  return "upcoming";
}

export function hydrateMatch(raw, now = new Date()) {
  const m = unwrapMatch(raw);
  if (!m || typeof m !== "object") return m;
  const dateIso = kickoffIso(m) || m.dateIso;
  let status = m.status;
  let minute = m.minute;
  if (status && typeof status === "object") {
    minute = minute ?? status.elapsed;
    status = status.short || status.long || status.type || "";
  }
  const st = String(status ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(st)) status = "TIMED";
  const base = { ...m, dateIso, status, minute };
  const score = matchScore(base);
  const phase = matchPhase(base, now);
  const clock = matchClock(base, now);
  const live = phase === "live";
  const finished = phase === "finished";
  if (live && (!status || ["TIMED", "SCHEDULED", "NS", "NOT_STARTED"].includes(String(status).toUpperCase()))) {
    status = "IN_PLAY";
  }
  if (finished && (!status || ["TIMED", "SCHEDULED", "NS", "IN_PLAY", "LIVE"].includes(String(status).toUpperCase()))) {
    status = "FINISHED";
  }
  return {
    ...base,
    status,
    live,
    finished,
    cancelled: phase === "cancelled",
    phase,
    homeScore: score?.home ?? base.homeScore,
    awayScore: score?.away ?? base.awayScore,
    scoreText: score?.text || "",
    clock,
    minute: matchMinute(base, now),
  };
}

function stillVisible(m, nowMs) {
  if (m.cancelled || m.phase === "cancelled") return false;
  if (m.live || m.phase === "live") return true;
  const t = new Date(m.dateIso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return false;
  if (m.finished || m.phase === "finished") return nowMs - t < FINISHED_KEEP_MS;
  return t + KICKOFF_GRACE_MS > nowMs;
}

export function upcoming(matches = [], now = new Date()) {
  const nowMs = now.getTime();
  return matches
    .map((m) => hydrateMatch(m, now))
    .filter((m) => stillVisible(m, nowMs))
    .sort((a, b) => new Date(a.dateIso || 0) - new Date(b.dateIso || 0));
}

export function isPaid(plan) {
  return ["pro", "enterprise"].includes(String(plan ?? "").toLowerCase());
}

export function isLocked(plan, index, freePreview) {
  if (isPaid(plan)) return false;
  return index >= freePreview;
}

export function findMatch(list, id) {
  const want = String(id ?? "");
  const idx = list.findIndex((m) => String(m.id) === want || String(m.externalId) === want);
  return { match: idx >= 0 ? list[idx] : null, idx };
}

export function pickLabel(m, langPick) {
  const p = m.predictionPreview;
  if (!p) return "—";
  const win = p.win ?? 0;
  const draw = p.draw ?? 0;
  const loss = p.loss ?? 0;
  const max = Math.max(win, draw, loss);
  if (max === win) return `${langPick.home} ${win}%`;
  if (max === draw) return `${langPick.draw} ${draw}%`;
  return `${langPick.away} ${loss}%`;
}

export function whenText(m, lang = "fr") {
  if (m.finished) return m.scoreText ? `FT ${m.scoreText}` : "FT";
  if (m.live) {
    return ["LIVE", m.clock, m.scoreText].filter(Boolean).join(" ");
  }
  const iso = m.dateIso;
  if (!iso) return `${m.date ?? ""} ${m.time ?? ""}`.trim();
  const d = new Date(iso);
  return d.toLocaleString(LOCALES[lang] || LOCALES.fr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pctBar(pct) {
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round(n / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

export function timeShort(m, lang = "fr") {
  if (m.finished) return m.scoreText ? `FT ${m.scoreText}` : "FT";
  if (m.live) return ["LIVE", m.clock, m.scoreText].filter(Boolean).join(" ");
  if (!m.dateIso) return m.time || "";
  const d = new Date(m.dateIso);
  return d.toLocaleTimeString(LOCALES[lang] || LOCALES.fr, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function matchLine(m, { locked, liveLabel, pick } = {}) {
  const home = m.home?.name;
  const away = m.away?.name;
  const live = m.live ? ` ${liveLabel}` : "";
  const lock = locked ? " 🔒" : "";
  const pickTxt = pick ? ` · ${pick}` : "";
  return `${esc(home)} vs ${esc(away)}${pickTxt}${live}${lock}`;
}

export function listEntry(m, n, lang, whenTextFn) {
  return `${n}. <b>${esc(m.home?.name)} vs ${esc(m.away?.name)}</b>\n    🏆 ${esc(m.league || "")} · ${esc(whenTextFn(m, lang))}`;
}

export function paginate(list, page, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { page: p, pages, slice: list.slice(p * size, p * size + size) };
}

export function isZeroDecimal(currency) {
  return ["XOF", "XAF", "JPY", "KRW"].includes(String(currency || "").toUpperCase());
}

export function formatMoney(amount, currency = "XOF", lang = "fr") {
  const n = Number(amount) || 0;
  const major = isZeroDecimal(currency) ? n : n / 100;
  const loc = lang === "en" ? "en-GB" : lang === "es" ? "es-ES" : lang === "ru" ? "ru-RU" : "fr-FR";
  try {
    return new Intl.NumberFormat(loc, { style: "currency", currency, maximumFractionDigits: isZeroDecimal(currency) ? 0 : 2 }).format(major);
  } catch {
    return `${major.toLocaleString(loc)} ${currency}`;
  }
}

export function priceLabel(cents, { currency = "XOF", interval, lang = "fr" } = {}) {
  const n = Number(cents) || 0;
  const free = { fr: "Gratuit", en: "Free", es: "Gratis", ru: "Бесплатно" };
  if (n <= 0) return free[lang] || free.fr;
  const money = formatMoney(n, currency, lang);
  const per = {
    fr: { week: "/ semaine", month: "/ mois", year: "/ an", day: "/ jour" },
    en: { week: "/ week", month: "/ month", year: "/ year", day: "/ day" },
    es: { week: "/ semana", month: "/ mes", year: "/ año", day: "/ día" },
    ru: { week: "/ нед.", month: "/ мес.", year: "/ год", day: "/ день" },
  };
  const suffix = interval ? per[lang]?.[interval] || per.fr[interval] || "" : "";
  return `${money}${suffix ? ` ${suffix}` : ""}`;
}
