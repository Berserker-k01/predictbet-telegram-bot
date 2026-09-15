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

export function expectedGoals(match) {
  const league = match?.league || match?.leagueId || "";
  const profile = leagueProfile(league);
  const eh = teamElo(match?.home?.name, league);
  const ea = teamElo(match?.away?.name, league);
  const homeAdv = 68;
  const diffElo = eh + homeAdv - ea;
  const gd = (diffElo / 400) * 1.28;
  let lh = (profile.goals + gd) / 2;
  let la = (profile.goals - gd) / 2;
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

function summarize(cells) {
  let win = 0;
  let draw = 0;
  let loss = 0;
  let over25 = 0;
  let best = cells[0];
  for (const c of cells) {
    if (c.h > c.a) win += c.p;
    else if (c.h === c.a) draw += c.p;
    else loss += c.p;
    if (c.h + c.a >= 3) over25 += c.p;
    if (!best || c.p > best.p) best = c;
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
  return {
    ...triple,
    confidence,
    score: `${best.h}–${best.a}`,
    open: over25 >= 0.52,
    tightness: maxp < 44,
    over25,
  };
}

export function predictMatch(match) {
  const { lh, la } = expectedGoals(match);
  return { ...summarize(scoreMatrix(lh, la)), lh, la };
}

export function predictLive(match, score, minute) {
  const { lh, la } = expectedGoals(match);
  const played = Number.isFinite(Number(minute)) ? clamp(Number(minute), 0, 98) : 45;
  const rem = played >= 90 ? 0.05 : clamp((90 - played) / 90, 0.05, 1);
  const cells = scoreMatrix(lh * rem, la * rem, 0.08, 6);
  const shifted = cells.map((c) => ({
    h: score.home + c.h,
    a: score.away + c.a,
    p: c.p,
  }));
  const out = summarize(shifted);
  return {
    ...out,
    live: true,
    confidence: Math.round(clamp(out.confidence + (1 - rem) * 8, 56, 92)),
    lh,
    la,
  };
}
