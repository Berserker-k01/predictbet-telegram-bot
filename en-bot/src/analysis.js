import { t } from "./i18n.js";
import { hydrateMatch, matchScore } from "./format.js";
import { predictFixture, predictFixtureLive } from "./engine.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function isDummyTriple(p) {
  if (!p) return true;
  if (p.draw < 15 || p.draw > 38) return true;
  const spread = Math.max(p.win, p.draw, p.loss) - Math.min(p.win, p.draw, p.loss);
  if (spread < 6) return true;
  return false;
}

export function extractPrediction(...sources) {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const bags = [
      src.probs,
      src.probabilities,
      src.data?.probs,
      src.data?.prediction,
      src.prediction,
      src.odds,
    ];
    for (const bag of bags) {
      const triple = fromBag(bag);
      if (triple && !isDummyTriple(triple)) {
        const confidence =
          num(bag?.confidence ?? bag?.pickPct ?? src.confidence ?? src.data?.confidence) ??
          Math.max(triple.win, triple.draw, triple.loss);
        return { ...triple, confidence: Math.round(Math.min(90, Math.max(50, confidence))) };
      }
    }
  }
  return null;
}

function mix(model, api, apiWeight = 0.22) {
  if (!api) return model;
  const w = 1 - apiWeight;
  const triple = asPctTriple(
    model.win * w + api.win * apiWeight,
    model.draw * w + api.draw * apiWeight,
    model.loss * w + api.loss * apiWeight,
  );
  return {
    ...model,
    ...triple,
    confidence: Math.round(model.confidence * w + (api.confidence || model.confidence) * apiWeight),
  };
}

function localModel(match) {
  return predictFixture(match);
}

function applyMatchState(match, pred) {
  const m = hydrateMatch(match);
  const score = matchScore(m);
  if (m.cancelled) {
    return { ...pred, win: 0, draw: 0, loss: 0, confidence: 0, score: "", cancelled: true };
  }
  if (m.finished) {
    const winner = !score ? null : score.home > score.away ? "home" : score.away > score.home ? "away" : "draw";
    return {
      win: winner === "home" ? 100 : 0,
      draw: winner === "draw" ? 100 : 0,
      loss: winner === "away" ? 100 : 0,
      confidence: score ? 100 : 0,
      score: score?.text || "",
      finished: true,
      open: false,
      tightness: true,
    };
  }
  if (m.live && score) {
    return predictFixtureLive(m, score, m.minute);
  }
  return pred;
}

export function resolvePrediction(match, ...apiPayloads) {
  const m = hydrateMatch(match);
  if (m.finished || m.cancelled) {
    return applyMatchState(m, { win: 0, draw: 0, loss: 0, confidence: 0, score: "" });
  }
  const model = localModel(m);
  const api = extractPrediction(...apiPayloads);
  const base = api ? mix(model, api) : model;
  return applyMatchState(m, base);
}

export function mergeMatchDetail(listed, detail) {
  if (!detail || typeof detail !== "object") return hydrateMatch(listed);
  const inner = detail.match || detail.fixture || detail.data?.match || detail.data || detail;
  return hydrateMatch({
    ...listed,
    ...inner,
    id: listed.id || inner.id,
    home: { ...(listed.home || {}), ...(inner.home || {}) },
    away: { ...(listed.away || {}), ...(inner.away || {}) },
  });
}

function signals(lang, m, outcome) {
  if (m.finished || m.cancelled) return [];
  const p = m.predictionPreview || {};
  const conf = Number(p.confidence);
  const lines = [];
  const home = m.home?.name || "";
  const away = m.away?.name || "";

  if (Number.isFinite(conf)) {
    if (conf >= 72) lines.push(t(lang, "sigConfHigh", { conf }));
    else if (conf >= 58) lines.push(t(lang, "sigConfMid", { conf }));
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
