import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normTeam } from "./ratings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "..", "data", "fd-cache.json");
const TTL_MS = 8 * 60 * 60 * 1000;
const BASE = "https://api.football-data.org/v4";

const LEAGUE_CODES = [
  { re: /premier league|\bpl\b/i, code: "PL" },
  { re: /championship|\belc\b/i, code: "ELC" },
  { re: /primera|laliga|la liga|\bpd\b/i, code: "PD" },
  { re: /serie a|\bsa\b/i, code: "SA" },
  { re: /bundesliga|\bbl1\b/i, code: "BL1" },
  { re: /ligue 1|\bfl1\b/i, code: "FL1" },
  { re: /eredivisie|\bded\b/i, code: "DED" },
  { re: /primeira liga|liga portugal|\bppl\b/i, code: "PPL" },
  { re: /brasileiro|\bbsa\b/i, code: "BSA" },
  { re: /champions league|\bcl\b/i, code: "CL" },
  { re: /world cup|\bwc\b/i, code: "WC" },
  { re: /european championship|\bec\b/i, code: "EC" },
];

let state = { at: 0, teams: new Map(), leagues: new Map() };

export function competitionCode(league, leagueId) {
  const id = String(leagueId || "").toUpperCase();
  if (["PL", "PD", "SA", "BL1", "FL1", "DED", "ELC", "PPL", "BSA", "CL", "WC", "EC"].includes(id)) {
    return id;
  }
  const raw = `${league || ""} ${leagueId || ""}`;
  return LEAGUE_CODES.find((row) => row.re.test(raw))?.code || null;
}

function formBoost(form) {
  const bits = String(form || "")
    .toUpperCase()
    .split(/[^WDL]/)
    .filter(Boolean)
    .slice(-5);
  if (!bits.length) return 0;
  let s = 0;
  bits.forEach((b, i) => {
    const w = (i + 1) / bits.length;
    if (b === "W") s += 0.08 * w;
    else if (b === "L") s -= 0.07 * w;
  });
  return s;
}

function rowRates(row, avgFor, avgAgainst) {
  const played = Math.max(1, Number(row.playedGames) || 0);
  const gf = Number(row.goalsFor) || 0;
  const ga = Number(row.goalsAgainst) || 0;
  return {
    att: avgFor > 0 ? gf / played / avgFor : 1,
    def: avgAgainst > 0 ? ga / played / avgAgainst : 1,
    played,
    gf,
    ga,
    points: Number(row.points) || 0,
    position: Number(row.position) || 0,
    gd: Number(row.goalDifference) || 0,
    form: row.form || "",
  };
}

function leagueAvgs(table) {
  let gf = 0;
  let ga = 0;
  let games = 0;
  for (const row of table || []) {
    const p = Number(row.playedGames) || 0;
    gf += Number(row.goalsFor) || 0;
    ga += Number(row.goalsAgainst) || 0;
    games += p;
  }
  return {
    for: games ? gf / games : 1.35,
    against: games ? ga / games : 1.2,
  };
}

function indexStanding(payload, code) {
  const groups = payload?.standings || [];
  const total = groups.find((g) => g.type === "TOTAL")?.table || [];
  const home = groups.find((g) => g.type === "HOME")?.table || total;
  const away = groups.find((g) => g.type === "AWAY")?.table || total;
  if (!total.length) return;
  const avgH = leagueAvgs(home);
  const avgA = leagueAvgs(away);
  state.leagues.set(code, { homeAvg: avgH.for, awayAvg: avgA.for });

  const homeById = new Map(home.map((r) => [r.team?.id, r]));
  const awayById = new Map(away.map((r) => [r.team?.id, r]));

  for (const row of total) {
    const team = row.team || {};
    const hid = team.id;
    const hr = rowRates(homeById.get(hid) || row, avgH.for, avgH.against);
    const ar = rowRates(awayById.get(hid) || row, avgA.for, avgA.against);
    const rec = {
      id: hid,
      name: team.name,
      code,
      played: Number(row.playedGames) || 0,
      attHome: hr.att,
      defHome: hr.def,
      attAway: ar.att,
      defAway: ar.def,
      homeAvg: avgH.for,
      awayAvg: avgA.for,
      position: Number(row.position) || 0,
      points: Number(row.points) || 0,
      gd: Number(row.goalDifference) || 0,
      formBoost: formBoost(row.form),
    };
    if (hid) state.teams.set(`id:${hid}`, rec);
    for (const alias of [team.name, team.shortName, team.tla]) {
      const n = normTeam(alias);
      if (!n) continue;
      state.teams.set(`${code}:${n}`, rec);
      if (!state.teams.has(n) || (state.teams.get(n).played || 0) <= rec.played) {
        state.teams.set(n, rec);
      }
    }
  }
}

function readDisk() {
  try {
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    if (!raw?.at || !Array.isArray(raw.teams)) return null;
    if (Date.now() - raw.at > TTL_MS * 2) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeDisk() {
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(
      CACHE,
      JSON.stringify({
        at: state.at,
        teams: [...state.teams.entries()],
        leagues: [...state.leagues.entries()],
      }),
    );
  } catch {
    /* */
  }
}

function restoreDisk(raw) {
  state = {
    at: raw.at,
    teams: new Map(raw.teams),
    leagues: new Map(raw.leagues || []),
  };
}

async function fdGet(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Auth-Token": token, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 429) throw new Error("football-data 429");
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  return res.json();
}

export async function loadFootballData(config, matches = [], force = false) {
  const token = config?.footballDataToken || "";
  if (!token) return state.teams;
  if (!force && state.teams.size && Date.now() - state.at < TTL_MS) return state.teams;
  const disk = readDisk();
  if (!force && disk && Date.now() - disk.at < TTL_MS) {
    restoreDisk(disk);
    return state.teams;
  }

  const codes = new Set();
  for (const m of matches) {
    const code = competitionCode(m.league, m.leagueId);
    if (code) codes.add(code);
  }
  if (!codes.size) ["PL", "PD", "SA", "BL1", "FL1", "DED"].forEach((c) => codes.add(c));

  const list = [...codes].slice(0, 10);
  const results = [];
  for (let i = 0; i < list.length; i += 6) {
    const chunk = list.slice(i, i + 6);
    const part = await Promise.allSettled(chunk.map((code) => fdGet(token, `/competitions/${code}/standings`)));
    results.push(...part);
    if (i + 6 < list.length) await new Promise((r) => setTimeout(r, 6500));
  }
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      console.warn(`football-data ${list[i]}:`, r.reason?.message || r.reason);
      return;
    }
    indexStanding(r.value, list[i]);
    ok += 1;
  });
  if (ok) {
    state.at = Date.now();
    writeDisk();
    console.warn(`football-data.org: ${ok} classements, ${state.teams.size} équipes`);
    return state.teams;
  }
  if (disk) {
    restoreDisk(disk);
    return state.teams;
  }
  return state.teams;
}

function numericId(id) {
  const m = String(id || "").match(/^(?:fd-?)?(\d+)$/i);
  return m ? m[1] : "";
}

function findTeam(name, id, code) {
  const nid = numericId(id);
  if (nid && state.teams.has(`id:${Number(nid)}`)) return state.teams.get(`id:${Number(nid)}`);
  const n = normTeam(name);
  if (code && n && state.teams.has(`${code}:${n}`)) return state.teams.get(`${code}:${n}`);
  if (n && state.teams.has(n)) return state.teams.get(n);
  return null;
}

export function lookupTeamStats(match) {
  if (!state.teams.size) return null;
  const code = competitionCode(match?.league, match?.leagueId);
  const home = findTeam(match?.home?.name, match?.home?.id, code);
  const away = findTeam(match?.away?.name, match?.away?.id, code);
  if (!home || !away || home.played < 3 || away.played < 3) return null;
  return { home, away };
}
