import { InlineKeyboard, Keyboard } from "grammy";
import { t, LANGS } from "./i18n.js";
import { topLeagues } from "./catalog.js";

export function welcomeKeyboard(lang) {
  return new InlineKeyboard().text(t(lang, "btnRegister"), "auth:register");
}

export function mainKeyboard(lang) {
  return new Keyboard()
    .text(t(lang, "btnMenu"))
    .text(t(lang, "btnToday"))
    .row()
    .text(t(lang, "btnLeagues"))
    .text(t(lang, "btnAccount"))
    .resized()
    .persistent();
}

export function menuKeyboard(lang, { hasLive = false } = {}) {
  const kb = new InlineKeyboard()
    .text(t(lang, "menuToday"), "go:list:today")
    .row()
    .text(t(lang, "menuLeagues"), "go:leagues")
    .row();
  if (hasLive) kb.text(t(lang, "menuLive"), "go:list:live").row();
  kb.text(t(lang, "menuTops"), "go:top").row();
  kb.text(t(lang, "btnSub"), "sub").row();
  kb.text(t(lang, "menuAccount"), "profile");
  return kb;
}

export function leaguesKeyboard(lang, list) {
  const kb = new InlineKeyboard();
  const leagues = topLeagues(list, 10);
  leagues.forEach((lg, i) => {
    kb.text(`${lg.name} (${lg.count})`.slice(0, 64), `lg:${lg.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (leagues.length % 2 === 1) kb.row();
  kb.text(t(lang, "backMenu"), "go:menu");
  return kb;
}

export function listKeyboard(lang, slice, page, pages, pageSize) {
  const kb = new InlineKeyboard();
  for (let i = 0; i < slice.length; i += 2) {
    const n1 = page * pageSize + i + 1;
    kb.text(`${n1} ⚡️`, `m:${slice[i].id}`);
    if (slice[i + 1]) {
      const n2 = page * pageSize + i + 2;
      kb.text(`${n2} 🔥`, `m:${slice[i + 1].id}`);
    }
    kb.row();
  }
  if (pages > 1) {
    const prev = Math.max(0, page - 1);
    const next = Math.min(pages - 1, page + 1);
    kb.text(t(lang, "pagePrev"), `pg:${prev}`)
      .text(`${page + 1}/${pages}`, "noop")
      .text(t(lang, "pageNext"), `pg:${next}`)
      .row();
  }
  kb.text(t(lang, "backMenu"), "go:menu");
  return kb;
}

export function matchDetailKeyboard(lang, match, { prev, next } = {}) {
  const kb = new InlineKeyboard();
  if (prev) kb.text(t(lang, "prevMatch"), `m:${prev.id}`);
  if (next) kb.text(t(lang, "nextMatch"), `m:${next.id}`);
  if (prev || next) kb.row();
  kb.text(t(lang, "backList"), "go:back").row();
  kb.text(t(lang, "backMenu"), "go:menu");
  return kb;
}

export function profileKeyboard(lang, { loggedIn = false, notif = true } = {}) {
  const kb = new InlineKeyboard();
  kb.text(t(lang, "btnSub"), "sub").text(t(lang, "btnRef"), "ref").row();
  kb.text(t(lang, "btnLang"), "lang")
    .text(notif ? t(lang, "btnNotifOn") : t(lang, "btnNotifOff"), "notif")
    .row();
  kb.text(t(lang, "btnHelp"), "help").row();
  kb.text(t(lang, "backMenu"), "go:menu");
  if (loggedIn) kb.row().text(t(lang, "btnLogout"), "logout");
  return kb;
}

export function langKeyboard() {
  const kb = new InlineKeyboard();
  LANGS.forEach((l, i) => {
    kb.text(l.label, `setlang:${l.code}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export function referralKeyboard(lang, link) {
  const kb = new InlineKeyboard();
  if (link && /^https:\/\//i.test(link)) {
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}`;
    kb.url(t(lang, "btnShareRef"), share).row();
  }
  kb.text(t(lang, "back"), "profile");
  return kb;
}

export function plansKeyboard(lang, plans, priceFn) {
  const kb = new InlineKeyboard();
  for (const p of plans) {
    const price = priceFn ? priceFn(p) : "";
    const label = t(lang, "choosePlan", { name: p.name, price }).slice(0, 64);
    kb.text(label, `plan:${p.code}`).row();
  }
  kb.text(t(lang, "back"), "profile");
  return kb;
}

export function payKeyboard(lang, paymentUrl) {
  const kb = new InlineKeyboard();
  if (paymentUrl && /^https:\/\//i.test(paymentUrl)) kb.url(t(lang, "payTchin"), paymentUrl).row();
  kb.text(t(lang, "back"), "sub");
  return kb;
}
