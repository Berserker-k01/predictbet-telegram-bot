import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export function createSessionStore(filePath) {
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof cache !== "object" || !cache) cache = {};
  } catch {
    cache = {};
  }

  let timer = null;
  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(cache, null, 0));
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, 400);
  }

  return {
    get(id) {
      return cache[String(id)] ?? null;
    },
    set(id, data) {
      cache[String(id)] = { ...data, updatedAt: Date.now() };
      schedule();
    },
    patch(id, partial) {
      const cur = cache[String(id)] ?? {};
      cache[String(id)] = { ...cur, ...partial, updatedAt: Date.now() };
      schedule();
      return cache[String(id)];
    },
    delete(id) {
      delete cache[String(id)];
      schedule();
    },
    entries() {
      return Object.entries(cache);
    },
    flush: persist,
  };
}

export function initialSession() {
  return {
    lang: "fr",
    token: null,
    user: null,
    userId: null,
    loggedIn: false,
    flow: null,
    pendingEmail: null,
    pendingName: null,
    pendingRef: null,
    notif: true,
    reminded: {},
    view: { screen: "menu", scope: "today", league: "", page: 0, matchId: "", from: "menu" },
  };
}
