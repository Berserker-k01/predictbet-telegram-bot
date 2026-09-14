const KEY = "pb_admin_token";
const token = localStorage.getItem(KEY);
if (!token) location.replace("/admin/login");

const VIEWS = [
  ["dash", "Dashboard"],
  ["users", "Utilisateurs"],
  ["plans", "Plans"],
  ["subs", "Abonnements"],
  ["pays", "Paiements"],
  ["tchin", "Tchin"],
  ["audit", "Journal"],
];

const $ = (id) => document.getElementById(id);
const nav = $("nav");
const view = $("view");
const modal = $("modal");
let state = { view: "dash", me: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem(KEY);
    location.replace("/admin/login");
    return {};
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function money(amount, currency = "XOF") {
  const zero = ["XOF", "XAF", "JPY", "KRW"].includes(String(currency || "").toUpperCase());
  const n = zero ? Number(amount) || 0 : (Number(amount) || 0) / 100;
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString("fr-FR")} ${currency}`;
  }
}
function when(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function badge(status) {
  const map = { active: "ok", paid: "ok", trialing: "ok", pending: "warn", paused: "warn", canceled: "bad", failed: "bad", banned: "bad" };
  return `<span class="badge ${map[status] || ""}">${status || "—"}</span>`;
}
function intervalFr(i) {
  return { week: "semaine", month: "mois", year: "an", day: "jour" }[i] || i;
}

function openModal(html) {
  modal.innerHTML = `<div class="modal">${html}</div>`;
  modal.classList.remove("hidden");
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}
function closeModal() {
  modal.classList.add("hidden");
  modal.innerHTML = "";
}

function setView(name) {
  state.view = name;
  [...nav.querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const meta = {
    dash: ["Dashboard", "Vue d'ensemble"],
    users: ["Utilisateurs", "Comptes Telegram et crédits"],
    plans: ["Plans", "Hebdo, mensuel, annuel — tout est éditable"],
    subs: ["Abonnements", "Activer, pauser, résilier"],
    pays: ["Paiements", "Tchin · page de paiement"],
    tchin: ["Tchin", "Réglages du rail de paiement"],
    audit: ["Journal", "Actions admin"],
  }[name];
  $("title").textContent = meta[0];
  $("subtitle").textContent = meta[1];
  $("primaryBtn").hidden = !["users", "plans", "subs"].includes(name);
  $("primaryBtn").textContent = name === "plans" ? "Nouveau plan" : name === "subs" ? "Attribuer" : "Nouvel utilisateur";
  render();
}

async function renderDash() {
  const d = await api("/api/admin/dashboard");
  const s = d.stats;
  view.innerHTML = `
    <div class="kpis">
      <div class="kpi"><strong>${s.users}</strong><span>Utilisateurs</span></div>
      <div class="kpi"><strong>${s.activeSubs}</strong><span>Abos actifs</span></div>
      <div class="kpi"><strong>${money(s.revenueCents)}</strong><span>Encaissé Tchin</span></div>
      <div class="kpi"><strong>${s.pendingPayments}</strong><span>Paiements en attente</span></div>
      <div class="kpi"><strong>${s.signups7d}</strong><span>Inscriptions 7 j</span></div>
      <div class="kpi"><strong>${s.plans}</strong><span>Plans actifs</span></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Derniers paiements</h3>
        ${(d.recentPayments || []).map((p) => `<div class="row-actions" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>${p.planCode} · ${money(p.amountCents, p.currency)}</span>${badge(p.status)}</div>`).join("") || "<p class='muted'>Aucun paiement</p>"}
      </div>
      <div class="card">
        <h3>Nouveaux users</h3>
        ${(d.recentUsers || []).map((u) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">${u.displayName || u.email || u.telegramId}<br><small class="muted">${u.planCode} · ${when(u.createdAt)}</small></div>`).join("") || "<p class='muted'>Personne pour l'instant</p>"}
      </div>
    </div>`;
}

async function renderUsers() {
  const q = view.querySelector("#q")?.value || "";
  const d = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
  view.innerHTML = `
    <div class="toolbar"><input id="q" placeholder="Rechercher nom, @, email, telegram…" value="${q}" /><button class="btn small ghost" id="search">Filtrer</button></div>
    <div class="card"><table><thead><tr><th>User</th><th>Plan</th><th>Crédits</th><th>Statut</th><th></th></tr></thead>
    <tbody>${d.users.map((u) => `<tr>
      <td><b>${u.displayName || "—"}</b><br><small class="muted">${u.username ? "@" + u.username : ""} ${u.telegramId || ""} ${u.email || ""}</small></td>
      <td>${u.planCode || "starter"}</td><td>${u.credits ?? "—"}</td><td>${badge(u.status)}</td>
      <td><button class="btn small ghost" data-edit="${u.id}">Gérer</button></td>
    </tr>`).join("")}</tbody></table></div>`;
  $("search")?.addEventListener("click", renderUsers);
  view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editUser(b.dataset.edit)));
}

async function editUser(id) {
  const d = await api(`/api/admin/users/${id}`);
  const plans = (await api("/api/admin/plans")).plans;
  const u = d.user;
  openModal(`
    <h3>${u.displayName}</h3>
    <p class="muted">Telegram ${u.telegramId || "—"} · ${u.email || "pas d'email"}</p>
    <label>Nom<input id="displayName" value="${u.displayName || ""}"/></label>
    <label>Email<input id="email" value="${u.email || ""}"/></label>
    <label>Abonnement<select id="planCode">
      <option value="" ${!u.planCode ? "selected" : ""}>Aucun accès</option>
      ${plans.map((p) => `<option value="${p.code}" ${p.code === u.planCode ? "selected" : ""}>${p.name}</option>`).join("")}
    </select></label>
    ${d.subscription ? `<p class="muted">En cours : ${d.subscription.planName} · jusqu'au ${when(d.subscription.currentPeriodEnd)}</p>` : ""}
    <label>Crédits<input id="credits" type="number" value="${u.credits ?? 0}"/></label>
    <label>Statut<select id="status">
      ${["active", "banned", "disabled"].map((s) => `<option ${u.status === s ? "selected" : ""}>${s}</option>`).join("")}
    </select></label>
    <label>Notes<textarea id="notes" rows="3">${u.notes || ""}</textarea></label>
    <div class="modal-actions">
      <button class="btn ghost small" id="close">Fermer</button>
      <button class="btn small" id="save">Enregistrer</button>
    </div>`);
  $("close").onclick = closeModal;
  $("save").onclick = async () => {
    await api(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: document.getElementById("displayName").value,
        email: document.getElementById("email").value,
        planCode: document.getElementById("planCode").value,
        credits: Number(document.getElementById("credits").value),
        status: document.getElementById("status").value,
        notes: document.getElementById("notes").value,
      }),
    });
    closeModal();
    renderUsers();
  };
}

function planForm(p = {}) {
  openModal(`
    <h3>${p.id ? "Modifier le plan" : "Nouveau plan"}</h3>
    <label>Nom<input id="name" value="${p.name || ""}"/></label>
    <label>Code<input id="code" value="${p.code || ""}" ${p.id ? "disabled" : ""}/></label>
    <label>Description<textarea id="description" rows="2">${p.description || ""}</textarea></label>
    <label>Prix (F CFA)<input id="priceCents" type="number" value="${p.priceCents ?? 0}"/></label>
    <label>Devise<input id="currency" value="${p.currency || "XOF"}"/></label>
    <label>Cycle<select id="interval">${["week", "month", "year"].map((i) => `<option value="${i}" ${p.interval === i ? "selected" : ""}>${intervalFr(i)}</option>`).join("")}</select></label>
    <label>Ordre<input id="sortOrder" type="number" value="${p.sortOrder ?? 0}"/></label>
    <label><input id="active" type="checkbox" ${p.active !== false ? "checked" : ""}/> Actif</label>
    <label><input id="highlighted" type="checkbox" ${p.highlighted ? "checked" : ""}/> Mis en avant</label>
    <div class="modal-actions">
      ${p.id ? `<button class="btn danger small" id="del">Supprimer</button>` : ""}
      <button class="btn ghost small" id="close">Fermer</button>
      <button class="btn small" id="save">Enregistrer</button>
    </div>`);
  $("close").onclick = closeModal;
  $("save").onclick = async () => {
    const body = {
      id: p.id,
      name: document.getElementById("name").value,
      code: document.getElementById("code").value,
      description: document.getElementById("description").value,
      priceCents: Number(document.getElementById("priceCents").value),
      currency: document.getElementById("currency").value,
      interval: document.getElementById("interval").value,
      features: [],
      sortOrder: Number(document.getElementById("sortOrder").value),
      active: document.getElementById("active").checked,
      highlighted: document.getElementById("highlighted").checked,
    };
    await api(p.id ? `/api/admin/plans/${p.id}` : "/api/admin/plans", { method: p.id ? "PATCH" : "POST", body: JSON.stringify(body) });
    closeModal();
    renderPlans();
  };
  const del = document.getElementById("del");
  if (del) {
    del.onclick = async () => {
      if (!confirm("Supprimer ce plan ?")) return;
      await api(`/api/admin/plans/${p.id}`, { method: "DELETE" });
      closeModal();
      renderPlans();
    };
  }
}

async function renderPlans() {
  const d = await api("/api/admin/plans");
  view.innerHTML = `<div class="plans">${d.plans
    .map(
      (p) => `<article class="card plan ${p.highlighted ? "hot" : ""}">
      <div class="row-actions" style="justify-content:space-between"><b>${p.name}</b>${badge(p.active ? "active" : "paused")}</div>
      <p class="muted">${p.description || ""}</p>
      <p><strong>${money(p.priceCents, p.currency)}</strong> / ${intervalFr(p.interval)}</p>
      <p class="muted">Accès au bot</p>
      <button class="btn small ghost" data-plan="${p.id}">Éditer</button>
    </article>`,
    )
    .join("")}</div>`;
  view.querySelectorAll("[data-plan]").forEach((b) => {
    b.onclick = () => planForm(d.plans.find((p) => p.id === b.dataset.plan));
  });
}

async function renderSubs() {
  const d = await api("/api/admin/subscriptions");
  view.innerHTML = `<div class="card"><table><thead><tr><th>User</th><th>Plan</th><th>Cycle</th><th>Fin de période</th><th>Statut</th><th></th></tr></thead><tbody>
    ${d.subscriptions
      .map(
        (s) => `<tr>
      <td><code>${s.userId.slice(0, 10)}</code></td>
      <td>${s.planName}</td><td>/${intervalFr(s.interval)}</td>
      <td>${when(s.currentPeriodEnd)}</td><td>${badge(s.status)}</td>
      <td class="row-actions">
        <button class="btn small ghost" data-act="paused" data-id="${s.id}">Pause</button>
        <button class="btn small ghost" data-act="canceled" data-id="${s.id}">Résilier</button>
        <button class="btn small ghost" data-act="active" data-id="${s.id}">Activer</button>
      </td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  view.querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/admin/subscriptions/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: b.dataset.act }) });
      renderSubs();
    };
  });
}

async function grantSub() {
  const users = (await api("/api/admin/users")).users;
  const plans = (await api("/api/admin/plans")).plans;
  openModal(`
    <h3>Attribuer un abonnement</h3>
    <label>User<select id="userId">${users.map((u) => `<option value="${u.id}">${u.displayName} (${u.planCode})</option>`).join("")}</select></label>
    <label>Plan<select id="planId">${plans.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
    <div class="modal-actions"><button class="btn ghost small" id="close">Fermer</button><button class="btn small" id="save">Activer</button></div>`);
  $("close").onclick = closeModal;
  $("save").onclick = async () => {
    await api("/api/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify({ userId: document.getElementById("userId").value, planId: document.getElementById("planId").value }),
    });
    closeModal();
    renderSubs();
  };
}

async function newUser() {
  openModal(`
    <h3>Nouvel utilisateur</h3>
    <label>Nom<input id="displayName"/></label>
    <label>Email<input id="email" type="email"/></label>
    <label>Telegram ID<input id="telegramId" type="number"/></label>
    <div class="modal-actions"><button class="btn ghost small" id="close">Fermer</button><button class="btn small" id="save">Créer</button></div>`);
  $("close").onclick = closeModal;
  $("save").onclick = async () => {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        displayName: document.getElementById("displayName").value,
        email: document.getElementById("email").value,
        telegramId: document.getElementById("telegramId").value,
      }),
    });
    closeModal();
    renderUsers();
  };
}

async function renderPays() {
  const d = await api("/api/admin/payments");
  view.innerHTML = `<div class="card"><table><thead><tr><th>Date</th><th>Plan</th><th>Montant</th><th>Tchin</th><th>Statut</th><th></th></tr></thead><tbody>
    ${d.payments
      .map(
        (p) => `<tr>
      <td>${when(p.createdAt)}</td><td>${p.planCode}</td>
      <td>${money(p.amountCents, p.currency)} / ${intervalFr(p.interval)}</td>
      <td>${p.providerRef || (p.metadata?.sandbox ? "sandbox" : "—")}</td>
      <td>${badge(p.status)}</td>
      <td>${p.status === "pending" ? `<button class="btn small" data-pay="${p.id}">Confirmer</button>` : ""}</td>
    </tr>`,
      )
      .join("")}</tbody></table></div>`;
  view.querySelectorAll("[data-pay]").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/admin/payments/${b.dataset.pay}/confirm`, { method: "POST" });
      renderPays();
    };
  });
}

async function renderTchin() {
  const d = await api("/api/admin/settings");
  view.innerHTML = `<div class="card" style="max-width:640px">
    <p>Paiements via l'API Tchin (<a href="https://doc.tchin.tech/" target="_blank" rel="noreferrer">doc.tchin.tech</a>).</p>
    <p class="muted">Clés : <b>${d.tchin.configured ? "présentes" : "manquantes"}</b> · env <b>${d.tchin.env}</b></p>
    <p class="muted">API : <code>${d.tchin.apiUrl}</code></p>
    <p class="muted">Webhook (HTTPS public) : <code>${d.tchin.webhook}</code></p>
    <p class="muted">Parcours officiel (page de paiement) : <code>POST /api/v1/payments</code> → le client paie sur <code>payment_url</code> Tchin → webhook signé <code>status=completed</code> → accès ouvert. Semaine / mois / an sont des accès locaux : Tchin n'a pas d'abonnement hebdo.</p>
    <label>Email support<input id="supportEmail" value="${d.settings.supportEmail || ""}"/></label>
    <label>Devise<input id="currency" value="${d.settings.currency || "XOF"}"/></label>
    <label><input id="tchinEnabled" type="checkbox" ${d.settings.tchinEnabled !== false ? "checked" : ""}/> Tchin activé</label>
    <label><input id="allowManualConfirm" type="checkbox" ${d.settings.allowManualConfirm !== false ? "checked" : ""}/> Confirmation manuelle (filet de sécu)</label>
    <p class="muted">Dans le <code>.env</code> : <code>TCHIN_PUBLIC_KEY</code>, <code>TCHIN_SECRET_KEY</code> (clé privée), <code>TCHIN_ENV=test</code> ou <code>live</code>, <code>PUBLIC_URL</code> en HTTPS.</p>
    <button class="btn small" id="save">Enregistrer</button>
  </div>`;
  $("save").onclick = async () => {
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        supportEmail: document.getElementById("supportEmail").value,
        currency: document.getElementById("currency").value,
        tchinEnabled: document.getElementById("tchinEnabled").checked,
        allowManualConfirm: document.getElementById("allowManualConfirm").checked,
      }),
    });
    renderTchin();
  };
}

async function renderAudit() {
  const d = await api("/api/admin/audit");
  view.innerHTML = `<div class="card"><table><thead><tr><th>Quand</th><th>Action</th><th>Détail</th></tr></thead><tbody>
    ${d.audit.map((a) => `<tr><td>${when(a.at)}</td><td>${a.action}</td><td><small class="muted">${JSON.stringify(a.meta)}</small></td></tr>`).join("")}
  </tbody></table></div>`;
}

async function render() {
  view.innerHTML = "<p class='muted'>Chargement…</p>";
  const map = { dash: renderDash, users: renderUsers, plans: renderPlans, subs: renderSubs, pays: renderPays, tchin: renderTchin, audit: renderAudit };
  try {
    await map[state.view]();
  } catch (e) {
    view.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

nav.innerHTML = VIEWS.map(([id, label]) => `<button data-view="${id}">${label}</button>`).join("");
nav.onclick = (e) => {
  const b = e.target.closest("button");
  if (b) setView(b.dataset.view);
};
$("logout").onclick = async () => {
  await api("/api/admin/logout", { method: "POST" });
  localStorage.removeItem(KEY);
  location.replace("/admin/login");
};
$("primaryBtn").onclick = () => {
  if (state.view === "plans") planForm({});
  else if (state.view === "subs") grantSub();
  else newUser();
};

api("/api/admin/me").then((d) => {
  state.me = d.user;
  $("who").textContent = d.user?.email || "";
  $("tchinBadge").textContent = d.tchin === "live" ? "Tchin live" : `Tchin ${d.tchin || "test"}`;
  setView("dash");
});
