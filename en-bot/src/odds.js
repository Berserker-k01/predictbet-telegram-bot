import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normTeam } from "./ratings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "..", "data", "odds-cache.json");
const TTL_MS = 10 * 60 * 60 * 1000;

const LEAGUE_SPORT = [
  { re: /premier league/i, key: "soccer_epl" },
  { re: /championship/i, key: "soccer_efl_champ" },
  { re: /primera|laliga|la liga/i, key: "soccer_spain_la_liga" },
  { re: /serie a/i, key: "soccer_italy_serie_a" },
  { re: /bundesliga/i, key: "soccer_germany_bundesliga" },
  { re: /ligue 1/i, key: "soccer_france_ligue_one" },
  { re: /eredivisie/i, key: "soccer_netherlands_eredivisie" },
  { re: /primeira liga|liga portugal/i, key: "soccer_portugal_primeira_liga" },
  { re: /brasileiro/i, key: "soccer_brazil_campeonato" },
  { re: /libertadores/i, key: "soccer_conmebol_copa_libertadores" },
  { re: /champions league/i, key: "soccer_uefa_champs_league" },
  { re: /europa league/i, key: "soccer_uefa_europa_league" },
  { re: /ligue 2/i, key: "soccer_france_ligue_two" },
  { re: /segunda/i, key: "soccer_spain_segunda_division" },
];

let state = { at: 0, events: [] };

function sportKey(league) {
  const raw = String(league || "");
  const hit = LEAGUE_SPORT.find((row) => row.re.test(raw));
  return hit?.key || null;
}

function closeNames(a, b) {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = na.split(" ").filter((w) => w.length > 2);
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit >= 1 && hit >= Math.min(2, ta.length);
}

function impliedTriple(homeOdd, drawOdd, awayOdd) {
  const ih = 1 / homeOdd;
  const id = 1 / drawOdd;
  const ia = 1 / awayOdd;
  const s = ih + id + ia;
  if (!(s > 0)) return null;
  const win = Math.round((ih / s) * 100);
  const draw = Math.round((id / s) * 100);
  const loss = 100 - win - draw;
  return { win, draw: Math.max(0, draw), loss: Math.max(0, loss) };
}

function averageBook(event) {
  const triples = [];
  for (const bk of event.bookmakers || []) {
    const mkt = (bk.markets || []).find((m) => m.key === "h2h");
    if (!mkt?.outcomes?.length) continue;
    const home = mkt.outcomes.find((o) => o.name === event.home_team);
    const away = mkt.outcomes.find((o) => o.name === event.away_team);
    const draw = mkt.outcomes.find((o) => /draw/i.test(o.name));
    if (!home?.price || !away?.price || !draw?.price) continue;
    const t = impliedTriple(Number(home.price), Number(draw.price), Number(away.price));
    if (t) triples.push(t);
  }
  if (!triples.length) return null;
  const win = Math.round(triples.reduce((s, t) => s + t.win, 0) / triples.length);
  const draw = Math.round(triples.reduce((s, t) => s + t.draw, 0) / triples.length);
  const loss = 100 - win - draw;
  return { win, draw: Math.max(0, draw), loss: Math.max(0, loss) };
}

function readDisk() {
  try {
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    if (!raw?.at || !Array.isArray(raw.events)) return null;
    if (Date.now() - raw.at > TTL_MS * 2) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeDisk(at, events) {
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ at, events }));
  } catch {
    /* */
  }
}

async function fetchSport(apiKey, region, key) {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${key}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", region);
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`odds ${key} ${res.status}`);
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining != null) console.warn(`Odds API remaining: ${remaining}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function loadOdds(config, matches = [], force = false) {
  const apiKey = config?.oddsApiKey || "";
  if (!apiKey) return state.events;
  if (!force && state.events.length && Date.now() - state.at < TTL_MS) return state.events;
  const disk = readDisk();
  if (!force && disk?.events?.length && Date.now() - disk.at < TTL_MS) {
    state = disk;
    return state.events;
  }
  const keys = new Set();
  for (const m of matches) {
    const k = sportKey(m.league || m.leagueId);
    if (k) keys.add(k);
  }
  if (!keys.size) {
    ["soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a", "soccer_germany_bundesliga", "soccer_france_ligue_one"].forEach(
      (k) => keys.add(k),
    );
  }
  const region = config.oddsRegion || "eu";
  const events = [];
  for (const key of keys) {
    try {
      const rows = await fetchSport(apiKey, region, key);
      for (const ev of rows) {
        const triple = averageBook(ev);
        if (!triple) continue;
        events.push({
          sport: key,
          commence: ev.commence_time,
          home: ev.home_team,
          away: ev.away_team,
          ...triple,
        });
      }
    } catch (e) {
      console.warn("Odds API:", e.message);
    }
  }
  if (events.length) {
    state = { at: Date.now(), events };
    writeDisk(state.at, events);
    console.warn(`Odds API: ${events.length} matchs cotés`);
    return events;
  }
  if (disk?.events?.length) {
    state = disk;
    return state.events;
  }
  return [];
}

export function lookupMarket(match) {
  if (!state.events.length) return null;
  const home = match?.home?.name;
  const away = match?.away?.name;
  const t = new Date(match?.dateIso || 0).getTime();
  let best = null;
  let bestScore = 0;
  for (const ev of state.events) {
    if (!closeNames(home, ev.home) || !closeNames(away, ev.away)) continue;
    let score = 2;
    if (Number.isFinite(t) && ev.commence) {
      const dt = Math.abs(t - new Date(ev.commence).getTime());
      if (dt < 3 * 60 * 60 * 1000) score += 2;
      else if (dt > 36 * 60 * 60 * 1000) continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = ev;
    }
  }
  if (!best) return null;
  return { win: best.win, draw: best.draw, loss: best.loss };
}
