export class ApiError extends Error {
  constructor(message, status = 500, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApi(config) {
  async function request(path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (config.botSecret) headers["X-Predictbet-Telegram-Secret"] = config.botSecret;

    const res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new ApiError(data.error || res.statusText, res.status, data.code);
    }
    return data;
  }

  return {
    health: () => request("/api/health"),
    telegramAuth: (payload) => request("/api/auth/telegram", { method: "POST", body: payload }),
    me: (token) => request("/api/auth/me", { token }),
    matches: (params = {}) => {
      const q = new URLSearchParams();
      if (params.upcoming) q.set("upcoming", "1");
      if (params.date) q.set("date", params.date);
      q.set("category", "football");
      return request(`/api/sports/matches?${q}`);
    },
    matchPredictions: (token, id) =>
      request(`/api/sports/matches/${encodeURIComponent(id)}/predictions`, { token }),
    matchDetail: (token, id) =>
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
