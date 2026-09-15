import { existsSync } from "fs";

export function isDockerEnv() {
  return existsSync("/.dockerenv");
}

export function resolveApiUrl(url) {
  const trimmed = String(url || "").replace(/\/$/, "");
  if (!isDockerEnv()) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      u.hostname = "host.docker.internal";
      return u.toString().replace(/\/$/, "");
    }
  } catch {
    /* URL invalide */
  }
  return trimmed;
}

export function apiUrlFallbacks(apiUrl) {
  const out = [];
  const add = (u) => {
    const s = String(u || "").replace(/\/$/, "");
    if (s && !out.includes(s)) out.push(s);
  };
  add(apiUrl);
  let hostname = "";
  let port = "59180";
  let protocol = "http:";
  try {
    const u = new URL(apiUrl);
    hostname = u.hostname;
    protocol = u.protocol;
    port = u.port || (u.protocol === "https:" ? "443" : "59180");
  } catch {
    /* */
  }
  const hosts = [hostname];
  if (isDockerEnv()) hosts.push("host.docker.internal");
  const ports = [port];
  if (port !== "59180") ports.push("59180");
  for (const h of hosts) {
    if (!h) continue;
    for (const p of ports) add(`${protocol}//${h}:${p}`);
  }
  return out;
}

export function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const apiUrl = resolveApiUrl(
    process.env.PREDICTBET_API_URL ||
      process.env.PREDICTBET_WEB_URL ||
      "http://187.77.101.57:59180",
  );
  const webUrl = (process.env.PREDICTBET_WEB_URL || apiUrl).replace(/\/$/, "");
  const adminPort = Number(process.env.PORT || process.env.ADMIN_PORT || 8788);
  const publicUrl = (process.env.PUBLIC_URL || `http://127.0.0.1:${adminPort}`).replace(/\/$/, "");
  return {
    token,
    apiUrl,
    webUrl,
    publicUrl,
    adminPort,
    botSecret: process.env.TELEGRAM_BOT_SECRET || "",
    supportEmail: process.env.SUPPORT_EMAIL || "support@predictbet.app",
    sessionFile: process.env.SESSION_FILE || "./data/sessions.json",
    storeFile: process.env.ADMIN_STORE_FILE || "./data/admin.json",
    adminEmail: process.env.ADMIN_EMAIL || "admin@predictbet.app",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    pageSize: 4,
    cacheMs: 45_000,
    freePreview: 3,
    paidPlans: new Set(["weekly", "pro", "pro_plus", "annual", "enterprise"]),
    oddsApiKey: process.env.ODDS_API_KEY || "",
    oddsRegion: process.env.ODDS_REGION || "eu",
    footballDataToken: process.env.FOOTBALL_DATA_TOKEN || "",
    tchin: {
      apiUrl: (process.env.TCHIN_API_URL || "https://tchin.tech/api/v1").replace(/\/$/, ""),
      publicKey: process.env.TCHIN_PUBLIC_KEY || "",
      privateKey: process.env.TCHIN_PRIVATE_KEY || process.env.TCHIN_SECRET_KEY || "",
      secretKey: process.env.TCHIN_SECRET_KEY || process.env.TCHIN_PRIVATE_KEY || "",
      env: process.env.TCHIN_ENV === "live" ? "live" : "test",
    },
  };
}
