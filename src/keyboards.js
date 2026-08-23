import { InlineKeyboard, Keyboard } from "grammy";
import { t, LANGS } from "./i18n.js";
import { matchLine, paginate } from "./format.js";

export function mainKeyboard(lang) {
  return new Keyboard()
    .text(t(lang, "btnHome"))
    .text(t(lang, "btnPred"))
    .row()
    .text(t(lang, "btnProfile"))
    .text(t(lang, "btnHelp"))
    .resized()
    .persistent();
}

export function matchListKeyboard(lang, list, page, size, prefix, plan, freePreview, liveLabel) {
  const { slice, page: p, pages } = paginate(list, page, size);
  const kb = new InlineKeyboard();
  slice.forEach((m, i) => {
    const idx = p * size + i;
    const locked = !["pro", "enterprise"].includes(String(plan ?? "").toLowerCase()) && idx >= freePreview;
    kb.text(matchLine(m, { locked, liveLabel }).slice(0, 64), `${prefix}:${m.id}`).row();
  });
  if (pages > 1) {
    const prev = Math.max(0, p - 1);
    const next = Math.min(pages - 1, p + 1);
    kb.text(t(lang, "pagePrev"), `pg:${prefix}:${prev}`).text(`${p + 1}/${pages}`, "noop");
    kb.text(t(lang, "pageNext"), `pg:${prefix}:${next}`).row();
  }
  return kb;
}

export function matchDetailKeyboard(lang, match, locked) {
  const kb = new InlineKeyboard();
  if (locked) kb.text(t(lang, "unlock"), "sub").row();
  else kb.text(t(lang, "fullPred"), `full:${match.id}`).row();
  kb.text(t(lang, "back"), "pg:home:0");
  return kb;
}

export function profileKeyboard(lang) {
  return new InlineKeyboard()
    .text(t(lang, "btnSub"), "sub")
    .text(t(lang, "btnRef"), "ref")
    .row()
    .text(t(lang, "btnLang"), "lang")
    .text(t(lang, "btnLink"), "link")
    .row()
    .text(t(lang, "btnLogout"), "logout");
}

export function langKeyboard() {
  const kb = new InlineKeyboard();
  LANGS.forEach((l, i) => {
    kb.text(l.label, `setlang:${l.code}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export function plansKeyboard(lang, plans) {
  const kb = new InlineKeyboard();
  for (const p of plans) {
    kb.text(t(lang, "choosePlan", { name: p.name }), `plan:${p.code}`).row();
  }
  kb.text(t(lang, "back"), "profile");
  return kb;
}

export function payKeyboard(planCode, methods) {
  const kb = new InlineKeyboard();
  for (const m of methods) {
    kb.text(m.name, `pay:${planCode}:${m.code}`).row();
  }
  kb.text("←", "sub");
  return kb;
}
