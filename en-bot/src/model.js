import { leagueProfile, teamElo, knownTeam } from "./ratings.js";

const FACT = [1];
for (let i = 1; i <= 12; i += 1) FACT[i] = FACT[i - 1] * i;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function poissonP(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0 || k > 12) return 0;
  return Math.exp(-lambda) * lambda ** k / FACT[k];
}

function tau(h, a, lh, la, rho) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function expectedGoals(match, { eloLookup, stats } = {}) {
  const league = match?.league || match?.leagueId || "";
  const profile = leagueProfile(league);
  const eh = Number(eloLookup?.(match?.home?.name)) || teamElo(match?.home?.name, league);
  const ea = Number(eloLookup?.(match?.away?.name)) || teamElo(match?.away?.name, league);
  const homeAdv = 68;
  const diffElo = eh + homeAdv - ea;
  const gd = (diffElo / 400) * 1.28;
  let lh = (profile.goals + gd) / 2;
  let la = (profile.goals - gd) / 2;

  if (stats?.home && stats?.away) {
    const hs = stats.home;
    const as = stats.away;
    const fdHome = clamp(hs.attHome * as.defAway * hs.homeAvg * (1 + hs.formBoost), 0.32, 3.7);
    const fdAway = clamp(as.attAway * hs.defHome * as.awayAvg * (1 + as.formBoost), 0.22, 3.3);
    const w = Math.min(0.62, 0.28 + Math.min(hs.played, as.played) * 0.04);
    lh = lh * (1 - w) + fdHome * w;
    la = la * (1 - w) + fdAway * w;
  }

  return {
    lh: clamp(lh, 0.32, 3.7),
    la: clamp(la, 0.22, 3.3),
    eh,
    ea,
    known: knownTeam(match?.home?.name) && knownTeam(match?.away?.name),
  };
}

export function scoreMatrix(lh, la, rho = 0.12, maxGoals = 8) {
  const cells = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      let p = poissonP(h, lh) * poissonP(a, la) * tau(h, a, lh, la, rho);
      if (p < 0) p = 0;
      cells.push({ h, a, p });
      total += p;
    }
  }
  if (total <= 0) return cells;
  for (const c of cells) c.p /= total;
  return cells;
}

function capTriple(win, draw, loss) {
  let w = win;
  let d = draw;
  let l = loss;
  const cap = 96;
  if (w > cap) {
    const extra = w - cap;
    w = cap;
    d += Math.max(1, Math.round(extra * 0.65));
    l = 100 - w - d;
  } else if (l > cap) {
    const extra = l - cap;
    l = cap;
    d += Math.max(1, Math.round(extra * 0.65));
    w = 100 - l - d;
  } else if (d > cap) {
    d = cap;
    w = Math.round((100 - d) / 2);
    l = 100 - w - d;
  }
  w = Math.max(0, w);
  d = Math.max(0, d);
  l = 100 - w - d;
  if (l < 0) {
    d += l;
    l = 0;
  }
  return { win: w, draw: d, loss: l };
}

function pickSide(triple) {
  if (triple.win >= triple.draw && triple.win >= triple.loss) return "home";
  if (triple.loss >= triple.draw) return "away";
  return "draw";
}

function matchesSide(c, side) {
  if (side === "home") return c.h > c.a;
  if (side === "away") return c.a > c.h;
  return c.h === c.a;
}

function targetScore(lh, la, side, favPct, over25) {
  if (side === "draw") {
    const total = lh + la;
    if (total < 1.9) return { h: 0, a: 0 };
    if (total >= 3.25) return { h: 2, a: 2 };
    return { h: 1, a: 1 };
  }
  const home = side === "home";
  const dog = home ? la : lh;
  const fav = home ? lh : la;
  const pair = (fh, fa) => (home ? { h: fh, a: fa } : { h: fa, a: fh });

  if (favPct >= 76 && fav >= 2.3 && dog <= 0.65) return pair(3, 0);
  if (favPct >= 66 && dog <= 0.95) return pair(2, 0);
  if (favPct >= 58 && dog < 0.92) return pair(2, 0);
  if (dog >= 1.05 && over25 >= 0.5 && favPct >= 48) return pair(2, 1);
  if (favPct >= 54 && dog >= 1.0 && over25 >= 0.47) return pair(2, 1);
  return pair(1, 0);
}

function pickExactScore(cells, side, lh, la, favPct, over25, drawPct) {
  const cellAt = (h, a) => cells.find((c) => c.h === h && c.a === a);
  const tight = favPct < 51 && drawPct >= 22;
  const drawCell = cellAt(1, 1);
  const home10 = cellAt(1, 0);
  const away01 = cellAt(0, 1);
  if (tight && drawCell) {
    const rival = side === "away" ? away01 : home10;
    if (!rival || drawCell.p >= rival.p * 0.9) return drawCell;
  }

  const target = targetScore(lh, la, side, favPct, over25);
  const pool = cells.filter((c) => matchesSide(c, side));
  const list = pool.length ? pool : cells;
  const mode = list.reduce((best, c) => (!best || c.p > best.p ? c : best), list[0]);
  const close = list.filter((c) => c.p >= mode.p * 0.5);
  close.sort((x, y) => {
    const dx = (x.h - target.h) ** 2 + (x.a - target.a) ** 2;
    const dy = (y.h - target.h) ** 2 + (y.a - target.a) ** 2;
    if (dx !== dy) return dx - dy;
    return y.p - x.p;
  });
  return close[0] || mode;
}

function summarize(cells, lh, la) {
  let win = 0;
  let draw = 0;
  let loss = 0;
  let over25 = 0;
  for (const c of cells) {
    if (c.h > c.a) win += c.p;
    else if (c.h === c.a) draw += c.p;
    else loss += c.p;
    if (c.h + c.a >= 3) over25 += c.p;
  }
  const w = Math.round(win * 100);
  let d = Math.round(draw * 100);
  let l = 100 - w - d;
  if (l < 0) {
    d += l;
    l = 0;
  }
  const triple = capTriple(w, Math.max(0, d), Math.max(0, l));
  const vals = [triple.win, triple.draw, triple.loss];
  const maxp = Math.max(...vals);
  const second = [...vals].sort((a, b) => b - a)[1];
  const gap = maxp - second;
  const confidence = Math.round(clamp(38 + gap * 0.82 + (maxp - 33) * 0.26, 52, 88));
  const side = pickSide(triple);
  const favPct = side === "home" ? triple.win : side === "away" ? triple.loss : triple.draw;
  const best = pickExactScore(cells, side, lh, la, favPct, over25, triple.draw);
  return {
    ...triple,
    confidence,
    score: `${best.h}–${best.a}`,
    open: over25 >= 0.52,
    tightness: maxp < 44,
    over25,
  };
}

function asPctTriple(win, draw, loss) {
  let w = Math.round(Number(win) || 0);
  let d = Math.round(Number(draw) || 0);
  let l = Math.round(Number(loss) || 0);
  const sum = w + d + l;
  if (sum <= 0) return { win: 33, draw: 34, loss: 33 };
  w = Math.round((w / sum) * 100);
  d = Math.round((d / sum) * 100);
  l = 100 - w - d;
  if (l < 0) {
    d += l;
    l = 0;
  }
  return { win: w, draw: Math.max(0, d), loss: Math.max(0, l) };
}

function blendMarket(model, market) {
  if (!market) return { ...model, source: "elo" };
  const mw = 0.58;
  const ew = 0.42;
  const triple = asPctTriple(
    model.win * ew + market.win * mw,
    model.draw * ew + market.draw * mw,
    model.loss * ew + market.loss * mw,
  );
  const agree = 1 - Math.abs(model.win - market.win) / 100;
  const pick = pickSide(triple);
  const modelPick = pickSide(model);
  const edge =
    pick === "home" ? triple.win - market.win : pick === "away" ? triple.loss - market.loss : triple.draw - market.draw;
  const ranked = [triple.win, triple.draw, triple.loss].sort((a, b) => b - a);
  const gap = ranked[0] - ranked[1];
  return {
    ...model,
    ...triple,
    market,
    edge,
    topMarket: Math.max(market.win, market.draw, market.loss),
    confidence: Math.round(clamp(50 + gap * 0.7 + agree * 22 + (pick === modelPick ? 4 : 0), 54, 90)),
    source: "ensemble",
  };
}

function attachScore(out, cells, lh, la) {
  const side = pickSide(out);
  const favPct = side === "home" ? out.win : side === "away" ? out.loss : out.draw;
  const best = pickExactScore(cells, side, lh, la, favPct, out.over25, out.draw);
  return { ...out, score: `${best.h}–${best.a}` };
}

export function predictMatch(match, { market, eloLookup, stats } = {}) {
  const { lh, la } = expectedGoals(match, { eloLookup, stats });
  const cells = scoreMatrix(lh, la);
  let out = summarize(cells, lh, la);
  out = blendMarket(out, market);
  out = attachScore(out, cells, lh, la);
  return { ...out, lh, la };
}

export function predictLive(match, score, minute, { eloLookup, stats } = {}) {
  const { lh, la } = expectedGoals(match, { eloLookup, stats });
  const played = Number.isFinite(Number(minute)) ? clamp(Number(minute), 0, 98) : 45;
  const rem = played >= 90 ? 0.05 : clamp((90 - played) / 90, 0.05, 1);
  const cells = scoreMatrix(lh * rem, la * rem, 0.08, 6);
  const shifted = cells.map((c) => ({
    h: score.home + c.h,
    a: score.away + c.a,
    p: c.p,
  }));
  const out = summarize(shifted, score.home + lh * rem, score.away + la * rem);
  return {
    ...out,
    live: true,
    confidence: Math.round(clamp(out.confidence + (1 - rem) * 8, 56, 92)),
    lh,
    la,
    source: "live",
  };
}
