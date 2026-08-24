export function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const apiUrl = (
    process.env.PREDICTBET_API_URL ||
    process.env.PREDICTBET_WEB_URL ||
    "http://187.77.101.57:59180"
  ).replace(/\/$/, "");
  const webUrl = (process.env.PREDICTBET_WEB_URL || apiUrl).replace(/\/$/, "");
  const adminPort = Number(process.env.ADMIN_PORT || 8788);
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
    tchin: {
      apiUrl: (process.env.TCHIN_API_URL || "https://tchin.tech/api/v1").replace(/\/$/, ""),
      publicKey: process.env.TCHIN_PUBLIC_KEY || "",
      privateKey: process.env.TCHIN_PRIVATE_KEY || process.env.TCHIN_SECRET_KEY || "",
      secretKey: process.env.TCHIN_SECRET_KEY || process.env.TCHIN_PRIVATE_KEY || "",
      env: process.env.TCHIN_ENV === "live" ? "live" : "test",
    },
  };
}
