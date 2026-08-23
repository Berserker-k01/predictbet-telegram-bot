export function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const apiUrl = (process.env.PREDICTBET_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const webUrl = (process.env.PREDICTBET_WEB_URL || apiUrl).replace(/\/$/, "");
  return {
    token,
    apiUrl,
    webUrl,
    botSecret: process.env.TELEGRAM_BOT_SECRET || "",
    supportEmail: process.env.SUPPORT_EMAIL || "support@predictbet.app",
    sessionFile: process.env.SESSION_FILE || "./data/sessions.json",
    pageSize: 6,
    freePreview: 3,
    paidPlans: new Set(["pro", "enterprise"]),
  };
}
