import { randomBytes } from "crypto";

export function nid(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function addInterval(from, interval, count = 1) {
  const d = new Date(from);
  const n = Number(count) || 1;
  if (interval === "day") d.setUTCDate(d.getUTCDate() + n);
  else if (interval === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

export function intervalMs(interval) {
  if (interval === "day") return 24 * 60 * 60 * 1000;
  if (interval === "week") return 7 * 24 * 60 * 60 * 1000;
  if (interval === "year") return 365 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}
