import { t } from "./i18n.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function signals(lang, m, outcome) {
  const conf = Number(m.predictionPreview?.confidence);
  const lines = [];

  if (Number.isFinite(conf)) {
    if (conf >= 70) lines.push(t(lang, "sigConfHigh", { conf }));
    else if (conf >= 55) lines.push(t(lang, "sigConfMid", { conf }));
    else lines.push(t(lang, "sigConfLow", { conf }));
  }

  if (outcome?.side === "draw") lines.push(t(lang, "sigPickDraw"));
  else if (outcome?.side === "home") lines.push(t(lang, "sigPickHome", { team: m.home?.name || "" }));
  else if (outcome?.side === "away") lines.push(t(lang, "sigPickAway", { team: m.away?.name || "" }));

  if (m.live) lines.push(t(lang, "sigLive"));

  return lines.slice(0, 3);
}

export { sleep, signals };
