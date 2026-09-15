import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normTeam, teamElo } from "./ratings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "..", "data", "clubelo.json");
const TTL_MS = 12 * 60 * 60 * 1000;
const UA = "PredictbetBot/1.0 (+https://predictbet.app)";

const ALIASES = {
  "man city": ["manchester city"],
  "man united": ["manchester united"],
  "nottm forest": ["nottingham forest", "nottingham forest"],
  "nottingham forest": ["nottm forest"],
  "paris sg": ["paris saint germain", "psg"],
  "psg": ["paris saint germain", "paris sg"],
  "atletico": ["atletico madrid"],
  "sporting": ["sporting clube portugal", "sporting lisbon", "sporting cp"],
  "inter": ["internazionale milano", "inter milan"],
  "milan": ["ac milan"],
  "roma": ["as roma"],
  "lazio": ["ss lazio"],
  "napoli": ["ssc napoli"],
  "bayern": ["bayern munchen", "bayern munich"],
  "koeln": ["koln", "cologne"],
  "gladbach": ["borussia monchengladbach"],
  "tottenham": ["tottenham hotspur"],
  "wolves": ["wolverhampton"],
  "west ham": ["west ham united"],
  "newcastle": ["newcastle united"],
  "brighton": ["brighton hove albion"],
  "qpr": ["queens park rangers"],
  "sheff utd": ["sheffield united"],
  "sheff wed": ["sheffield wednesday"],
  "west brom": ["west bromwich albion"],
  "man utd": ["manchester united", "man united"],
  "athletic": ["athletic bilbao", "athletic club"],
  "sociedad": ["real sociedad"],
  "betis": ["real betis"],
  "celta": ["celta vigo"],
  "rayo vallecano": ["rayo"],
  "dep la coruna": ["deportivo la coruna", "deportivo"],
  "espanyol": ["rcd espanyol barcelona"],
  "alaves": ["deportivo alaves"],
  "mainz": ["mainz 05", "fsv mainz"],
  "leverkusen": ["bayer leverkusen"],
  "leipzig": ["rb leipzig"],
  "stuttgart": ["vfb stuttgart"],
  "freiburg": ["sc freiburg"],
  "union berlin": ["fc union berlin"],
  "werder": ["werder bremen"],
  "ajax": ["afc ajax"],
  "psv": ["psv eindhoven"],
  "feyenoord": ["feyenoord rotterdam"],
  "az": ["az alkmaar"],
  "porto": ["fc porto"],
  "benfica": ["sl benfica"],
  "braga": ["sc braga"],
  "flamengo": ["cr flamengo"],
  "palmeiras": ["se palmeiras"],
  "sao paulo": ["sao paulo"],
  "gremio": ["gremio fbpa"],
  "botafogo": ["botafogo fr"],
  "vasco": ["vasco da gama"],
  "atletico mg": ["ca mineiro", "mineiro"],
  "olympique lyon": ["lyon", "olympique lyonnais"],
  "olympique marseille": ["marseille"],
  "stade rennes": ["rennes", "stade rennais"],
  "lens": ["racing club lens"],
  "strasbourg": ["rc strasbourg alsace"],
  "le havre": ["le havre ac"],
};

let cache = { at: 0, map: new Map() };

function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function shiftDay(ymdStr, days) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function put(map, name, elo) {
  const n = normTeam(name);
  if (!n || !Number.isFinite(elo)) return;
  map.set(n, elo);
  const extra = ALIASES[n];
  if (extra) for (const a of extra) map.set(normTeam(a), elo);
  for (const [key, names] of Object.entries(ALIASES)) {
    if (names.some((a) => normTeam(a) === n)) map.set(key, elo);
  }
}

function parseCsv(text) {
  const map = new Map();
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length < 2) return map;
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const clubIdx = header.findIndex((h) => h === "club");
  const eloIdx = header.findIndex((h) => h === "elo");
  if (clubIdx < 0 || eloIdx < 0) return map;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",");
    const club = cols[clubIdx];
    const elo = Number(cols[eloIdx]);
    put(map, club, elo);
  }
  return map;
}

function readDisk() {
  try {
    const raw = JSON.parse(readFileSync(CACHE, "utf8"));
    if (!raw?.at || !raw?.rows) return null;
    if (Date.now() - raw.at > TTL_MS * 2) return null;
    const map = new Map(raw.rows);
    return { at: raw.at, map };
  } catch {
    return null;
  }
}

function writeDisk(at, map) {
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ at, rows: [...map.entries()] }));
  } catch {
    /* cache disque optionnel */
  }
}

async function fetchDay(day) {
  const url = `http://api.clubelo.com/${day}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`clubelo ${res.status}`);
  const text = await res.text();
  const map = parseCsv(text);
  if (!map.size) throw new Error("clubelo vide");
  return map;
}

export async function loadClubElo(force = false) {
  if (!force && cache.map.size && Date.now() - cache.at < TTL_MS) return cache.map;
  const disk = readDisk();
  if (!force && disk?.map.size) {
    cache = disk;
    if (Date.now() - disk.at < TTL_MS) return cache.map;
  }
  let lastErr = null;
  const start = ymd();
  for (let i = 0; i < 3; i += 1) {
    try {
      const map = await fetchDay(shiftDay(start, -i));
      cache = { at: Date.now(), map };
      writeDisk(cache.at, map);
      console.warn(`ClubElo: ${map.size} clubs (${shiftDay(start, -i)})`);
      return map;
    } catch (e) {
      lastErr = e;
    }
  }
  if (disk?.map.size) {
    cache = disk;
    console.warn(`ClubElo cache (${disk.map.size}) — ${lastErr?.message || "injoignable"}`);
    return cache.map;
  }
  cache = { at: Date.now(), map: new Map() };
  if (lastErr) console.warn("ClubElo:", lastErr.message);
  return cache.map;
}

export function liveElo(name, league) {
  const n = normTeam(name);
  if (n && cache.map.has(n)) return cache.map.get(n);
  if (n) {
    const parts = n.split(" ");
    if (parts.length >= 2) {
      const short = parts.slice(0, 2).join(" ");
      if (cache.map.has(short)) return cache.map.get(short);
    }
  }
  return teamElo(name, league);
}

export function eloReady() {
  return cache.map.size > 0;
}
