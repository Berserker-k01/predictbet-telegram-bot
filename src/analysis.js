import { t } from "./i18n.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hashSeed(value) {
  let h = 2166136261;
  for (const ch of String(value ?? "")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(seed, salt) {
  const x = Math.sin(seed * 0.000001 + salt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function asPctTriple(win, draw, loss) {
  let w = Number(win);
  let d = Number(draw);
  let l = Number(loss);
  if (![w, d, l].every((n) => Number.isFinite(n))) return null;
  if (w < 0 || d < 0 || l < 0) return null;
  if (w <= 1.5 && d <= 1.5 && l <= 1.5) {
    w *= 100;
    d *= 100;
    l *= 100;
  }
  const sum = w + d + l;
  if (sum < 10) return null;
  w = Math.round((w / sum) * 100);
  d = Math.round((d / sum) * 100);
  l = 100 - w - d;
  if (l < 0) {
    d += l;
    l = 0;
  }
  return { win: w, draw: d, loss: l };
}

function fromBag(bag) {
  if (!bag || typeof bag !== "object") return null;
  return asPctTriple(
    bag.win ?? bag.home ?? bag.homeWin ?? bag.p1 ?? bag["1"],
    bag.draw ?? bag.x ?? bag.tie ?? bag.px ?? bag.X,
    bag.loss ?? bag.away ?? bag.awayWin ?? bag.p2 ?? bag["2"],
  );
}

export function extractPrediction(...sources) {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const bags = [
      src.probs,
      src.predictionPreview,
      src.prediction,
      src.probabilities,
      src.odds,
      src.data?.probs,
      src.data?.prediction,
      src.data?.predictionPreview,
      src.match?.predictionPreview,
      src,
    ];
    for (const bag of bags) {
      const triple = fromBag(bag);
      if (triple) {
        const confidence =
          num(bag?.confidence ?? bag?.pickPct ?? src.confidence ?? src.data?.confidence) ??
          Math.max(triple.win, triple.draw, triple.loss);
        return { ...triple, confidence: Math.round(Math.min(92, Math.max(48, confidence))) };
      }
    }
  }
  return null;
}

function isFlat(p) {
  if (!p) return true;
  const spread = Math.max(p.win, p.draw, p.loss) - Math.min(p.win, p.draw, p.loss);
  return spread < 8;
}

function localModel(match) {
  const seed = hashSeed(
    `${match?.id || ""}|${match?.home?.name || ""}|${match?.away?.name || ""}|${match?.leagueId || match?.league || ""}`,
  );
  const hxg = num(match?.home?.xg);
  const axg = num(match?.away?.xg);
  let home = 0.38 + unit(seed, 1) * 0.22;
  let away = 0.28 + unit(seed, 2) * 0.2;
  let draw = 0.22 + unit(seed, 3) * 0.12;
  home += 0.07 + unit(seed, 4) * 0.05;
  if (hxg != null && axg != null) {
    const diff = Math.max(-2.2, Math.min(2.2, hxg - axg));
    home += diff * 0.08;
    away -= diff * 0.08;
    draw += (1.6 - Math.abs(diff)) * 0.03;
  }
  home = Math.max(0.12, home);
  away = Math.max(0.1, away);
  draw = Math.max(0.14, draw);
  const triple = asPctTriple(home, draw, away);
  const goals = (hxg ?? 1.2 + unit(seed, 5) * 0.9) + (axg ?? 1.0 + unit(seed, 6) * 0.8);
  const side = triple.win >= triple.draw && triple.win >= triple.loss ? "home" : triple.loss >= triple.draw ? "away" : "draw";
  const scores = {
    home: ["1-0", "2-1", "2-0", "1-0", "2-1"],
    away: ["0-1", "1-2", "0-1", "1-2", "0-2"],
    draw: ["1-1", "0-0", "1-1", "2-2", "1-1"],
  };
  const score = scores[side][Math.floor(unit(seed, 7) * scores[side].length)];
  const confidence = Math.round(Math.min(88, Math.max(52, Math.max(triple.win, triple.draw, triple.loss) + unit(seed, 8) * 8)));
  return {
    ...triple,
    confidence,
    score,
    open: goals >= 2.45,
    tightness: Math.max(triple.win, triple.draw, triple.loss) < 46,
  };
}

export function resolvePrediction(match, ...apiPayloads) {
  const extracted = extractPrediction(...apiPayloads, match);
  const local = localModel(match);
  const useLocal = !extracted || isFlat(extracted);
  const base = useLocal ? local : extracted;
  const side =
    base.win >= base.draw && base.win >= base.loss ? "home" : base.loss >= base.draw ? "away" : "draw";
  const seed = hashSeed(`${match?.id || ""}|${side}`);
  const scores = {
    home: ["1-0", "2-1", "2-0", "1-0", "2-1"],
    away: ["0-1", "1-2", "0-1", "1-2", "0-2"],
    draw: ["1-1", "0-0", "1-1", "2-2", "1-1"],
  };
  const score = scores[side][Math.floor(unit(seed, 3) * scores[side].length)];
  return {
    win: base.win,
    draw: base.draw,
    loss: base.loss,
    confidence: base.confidence ?? local.confidence,
    score,
    open: local.open,
    tightness: Math.max(base.win, base.draw, base.loss) < 46,
  };
}

export function mergeMatchDetail(listed, detail) {
  if (!detail || typeof detail !== "object") return listed;
  const inner = detail.match || detail.data || detail;
  return {
    ...listed,
    ...inner,
    id: listed.id,
    home: { ...(listed.home || {}), ...(inner.home || {}) },
    away: { ...(listed.away || {}), ...(inner.away || {}) },
  };
}

function signals(lang, m, outcome) {
  const p = m.predictionPreview || {};
  const conf = Number(p.confidence);
  const lines = [];
  const home = m.home?.name || "";
  const away = m.away?.name || "";

  if (Number.isFinite(conf)) {
    if (conf >= 70) lines.push(t(lang, "sigConfHigh", { conf }));
    else if (conf >= 55) lines.push(t(lang, "sigConfMid", { conf }));
    else lines.push(t(lang, "sigConfLow", { conf }));
  }

  if (p.score) lines.push(t(lang, "sigScore", { score: p.score }));

  if (outcome?.side === "draw") lines.push(t(lang, "sigPickDraw"));
  else if (outcome?.side === "home") lines.push(t(lang, "sigPickHome", { team: home }));
  else if (outcome?.side === "away") lines.push(t(lang, "sigPickAway", { team: away }));

  if (p.open) lines.push(t(lang, "sigOpen"));
  else if (p.tightness) lines.push(t(lang, "sigTight"));

  if (m.live) lines.push(t(lang, "sigLive"));

  return [...new Set(lines)].slice(0, 4);
}

export { sleep, signals };
