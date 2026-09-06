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

const DONE = new Set(["FINISHED", "AWARDED", "CANCELLED", "CANCELED", "ABANDONED"]);
const LIVE = new Set(["IN_PLAY", "PAUSED", "LIVE", "HALFTIME"]);
const KICKOFF_GRACE_MS = 3 * 60 * 60 * 1000;

function stillUpcoming(m, nowMs) {
  const st = String(m.status ?? "").toUpperCase();
  if (DONE.has(st)) return false;
  if (m.live || LIVE.has(st)) return true;
  const t = new Date(m.dateIso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return false;
  return t + KICKOFF_GRACE_MS > nowMs;
}

export function upcoming(matches = [], now = new Date()) {
  const nowMs = now.getTime();
  return matches
    .map((m) => {
      const dateIso = kickoffIso(m) || m.dateIso;
      const st = String(m.status ?? "");
      const status = /^\d{4}-\d{2}-\d{2}/.test(st) ? "TIMED" : m.status;
      return { ...m, dateIso, status };
    })
    .filter((m) => stillUpcoming(m, nowMs))
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

export function whenText(m, lang = "en") {
  if (m.live) return "LIVE";
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

export function timeShort(m, lang = "en") {
  if (m.live) return "LIVE";
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
  const live = m.live ? "  ⚡️ LIVE" : "";
  return `${n}. <b>${esc(m.home?.name)} vs ${esc(m.away?.name)}</b>${live}\n    🏆 ${esc(m.league || "")} · ${esc(whenTextFn(m, lang))}`;
}

export function paginate(list, page, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { page: p, pages, slice: list.slice(p * size, p * size + size) };
}

export function isZeroDecimal(currency) {
  return ["XOF", "XAF", "JPY", "KRW"].includes(String(currency || "").toUpperCase());
}

export function formatMoney(amount, currency = "NGN", lang = "en") {
  const n = Number(amount) || 0;
  const major = isZeroDecimal(currency) ? n : n / 100;
  const loc = lang === "en" ? "en-NG" : lang === "es" ? "es-ES" : lang === "ru" ? "ru-RU" : "fr-FR";
  try {
    return new Intl.NumberFormat(loc, { style: "currency", currency, maximumFractionDigits: isZeroDecimal(currency) ? 0 : 2 }).format(major);
  } catch {
    return `${major.toLocaleString(loc)} ${currency}`;
  }
}

export function priceLabel(cents, { currency = "NGN", interval, lang = "en" } = {}) {
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
