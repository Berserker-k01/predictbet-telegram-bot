const TIMEZONE = "Europe/Paris";

export function ymd(value, timeZone = TIMEZONE) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function shiftYmd(ymdStr, days) {
  const [y, m, d] = String(ymdStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function isLive(m) {
  if (m?.live) return true;
  const st = String(m?.status ?? "").toUpperCase();
  return st === "IN_PLAY" || st === "PAUSED" || st === "LIVE" || st === "HALFTIME";
}

export function isToday(m, now = new Date()) {
  return Boolean(m?.dateIso) && ymd(m.dateIso) === ymd(now);
}

export function isTomorrow(m, now = new Date()) {
  if (!m?.dateIso) return false;
  return ymd(m.dateIso) === shiftYmd(ymd(now), 1);
}

export function confidence(m) {
  const p = m?.predictionPreview || {};
  const max = Math.max(p.win ?? 0, p.draw ?? 0, p.loss ?? 0);
  return Number(p.confidence ?? p.pickPct ?? max) || 0;
}

export function pickPct(m) {
  const p = m?.predictionPreview || {};
  return Number(p.pickPct ?? Math.max(p.win ?? 0, p.draw ?? 0, p.loss ?? 0)) || 0;
}

export function stats(list = []) {
  return {
    total: list.length,
    today: list.filter((m) => isToday(m)).length,
    tomorrow: list.filter((m) => isTomorrow(m)).length,
    live: list.filter((m) => isLive(m)).length,
  };
}

export function pickOutcome(m) {
  const p = m?.predictionPreview;
  if (!p) return null;
  const win = p.win ?? 0;
  const draw = p.draw ?? 0;
  const loss = p.loss ?? 0;
  const max = Math.max(win, draw, loss);
  if (max === win) return { side: "home", pct: win };
  if (max === draw) return { side: "draw", pct: draw };
  return { side: "away", pct: loss };
}

export function teamName(m, side) {
  if (side === "home") return m?.home?.name || "";
  return m?.away?.name || "";
}

export function topLeagues(list = [], limit = 12) {
  const map = new Map();
  for (const m of list) {
    const id = String(m.leagueId || m.league || "").trim();
    if (!id) continue;
    const cur = map.get(id) || { id, name: m.league || id, count: 0 };
    cur.count += 1;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function filterMatches(list = [], { scope = "all", league = "" } = {}) {
  let out = list;
  if (scope === "today") out = out.filter((m) => isToday(m) || isLive(m));
  else if (scope === "tomorrow") out = out.filter((m) => isTomorrow(m));
  else if (scope === "live") out = out.filter((m) => isLive(m));
  if (league) {
    const want = String(league);
    out = out.filter((m) => String(m.leagueId || "") === want || String(m.league || "") === want);
  }
  return out;
}

export function sortMatches(list = [], mode = "time") {
  const copy = [...list];
  if (mode === "confidence") {
    copy.sort((a, b) => {
      const dc = confidence(b) - confidence(a);
      if (dc) return dc;
      return pickPct(b) - pickPct(a);
    });
    return copy;
  }
  copy.sort((a, b) => {
    if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1;
    return new Date(a.dateIso || 0) - new Date(b.dateIso || 0);
  });
  return copy;
}

export function featured(list = [], count = 3) {
  return sortMatches(list, "confidence").slice(0, count);
}

export function neighbors(list, id) {
  const want = String(id ?? "");
  const idx = list.findIndex((m) => String(m.id) === want || String(m.externalId) === want);
  if (idx < 0) return { prev: null, next: null, idx: -1 };
  return {
    idx,
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx < list.length - 1 ? list[idx + 1] : null,
  };
}

export function defaultView() {
  return { screen: "menu", scope: "today", league: "", page: 0, matchId: "", from: "menu" };
}
