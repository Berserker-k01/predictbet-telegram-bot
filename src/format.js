export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function upcoming(matches = []) {
  const done = new Set(["FINISHED", "AWARDED", "CANCELLED"]);
  return matches
    .filter((m) => !done.has(String(m.status ?? "").toUpperCase()))
    .sort((a, b) => new Date(a.dateIso || 0) - new Date(b.dateIso || 0));
}

export function isPaid(plan) {
  return ["pro", "enterprise"].includes(String(plan ?? "").toLowerCase());
}

export function isLocked(plan, index, freePreview) {
  if (isPaid(plan)) return false;
  return index >= freePreview;
}

export function pickLabel(m, langPick) {
  const p = m.predictionPreview;
  if (!p) return "—";
  const max = Math.max(p.win ?? 0, p.draw ?? 0, p.loss ?? 0);
  if (max === (p.win ?? 0)) return `${langPick.home} ${p.win}%`;
  if (max === (p.draw ?? 0)) return `${langPick.draw} ${p.draw}%`;
  return `${langPick.away} ${p.loss}%`;
}

export function whenText(m) {
  if (m.live) return "LIVE";
  const iso = m.dateIso;
  if (!iso) return `${m.date ?? ""} ${m.time ?? ""}`.trim();
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function matchLine(m, { locked, liveLabel }) {
  const live = m.live ? ` ${liveLabel}` : "";
  const lock = locked ? " 🔒" : "";
  return `${esc(m.home?.name)} vs ${esc(m.away?.name)}${live}${lock}`;
}

export function paginate(list, page, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { page: p, pages, slice: list.slice(p * size, p * size + size) };
}

export function priceLabel(cents) {
  const n = Number(cents) || 0;
  if (n <= 0) return "Gratuit";
  return `${(n / 100).toFixed(2)} €`;
}
