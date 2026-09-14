export function extractAuth(data = {}) {
  const token = data.token || data.accessToken || data.jwt || data.data?.token || null;
  const user = data.user || data.data?.user || null;
  return { token, user };
}

export class ApiError extends Error {
  constructor(message, status = 500, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function extractMatches(data = {}) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.matches)) return data.matches;
  if (Array.isArray(data.data?.matches)) return data.data.matches;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

export function createApi(config) {
  async function request(path, { method = "GET", token, body, apiUrl } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (config.botSecret) headers["X-Predictbet-Telegram-Secret"] = config.botSecret;

    const base = (apiUrl || config.apiUrl).replace(/\/$/, "");
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new ApiError(
        data.error || data.message || res.statusText || `HTTP ${res.status}`,
        res.status,
        data.code,
      );
    }
    return data;
  }

  return {
    health: (apiUrl) => request("/api/health", { apiUrl }),
    telegramAuth: (payload) => request("/api/auth/telegram", { method: "POST", body: payload }),
    login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
    me: (token) => request("/api/auth/me", { token }),
    matches: (params = {}, extra = {}) => {
      const q = new URLSearchParams();
      if (params.upcoming) q.set("upcoming", "1");
      if (params.date) q.set("date", params.date);
      q.set("category", "football");
      return request(`/api/sports/matches?${q}`, extra);
    },
    matchPredictions: (id, token) =>
      request(`/api/sports/matches/${encodeURIComponent(id)}/predictions`, { token }),
    matchDetail: (id, token) =>
      request(`/api/sports/matches/${encodeURIComponent(id)}`, { token }),
    credits: (token) => request("/api/wallet/credits", { token }),
    referral: (token) => request("/api/wallet/referral", { token }),
    subscription: (token) => request("/api/subscription/me", { token }),
    plans: () => request("/api/subscription/plans"),
    paymentMethods: () => request("/api/subscription/payment-methods"),
    upgradeRequest: (token, payload) =>
      request("/api/subscription/upgrade-request", { method: "POST", token, body: payload }),
  };
}
