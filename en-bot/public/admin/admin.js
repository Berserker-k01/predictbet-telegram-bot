const KEY = "pb_admin_token";
const token = localStorage.getItem(KEY);
if (!token) location.replace("/admin/login");

const VIEWS = [
  ["dash", "Dashboard"],
  ["users", "Users"],
  ["plans", "Plans"],
  ["subs", "Subscriptions"],
  ["pays", "Payments"],
  ["paystack", "Paystack"],
  ["audit", "Audit"],
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

function money(amount, currency = "NGN") {
  const zero = ["XOF", "XAF", "JPY", "KRW"].includes(String(currency || "").toUpperCase());
  const n = zero ? Number(amount) || 0 : (Number(amount) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString("en-NG")} ${currency}`;
  }
}
function when(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function badge(status) {
  const map = { active: "ok", paid: "ok", trialing: "ok", pending: "warn", paused: "warn", canceled: "bad", failed: "bad", banned: "bad" };
  return `<span class="badge ${map[status] || ""}">${status || "—"}</span>`;
}
function intervalLabel(i) {
  return { week: "week", month: "month", year: "year", day: "day" }[i] || i;
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
    dash: ["Dashboard", "Overview"],
    users: ["Users", "Telegram accounts and credits"],
    plans: ["Plans", "Weekly, monthly, yearly — all editable"],
    subs: ["Subscriptions", "Activate, pause, cancel"],
    pays: ["Payments", "Paystack checkout"],
    paystack: ["Paystack", "Payment rail settings"],
    audit: ["Audit", "Admin actions"],
  }[name];
  $("title").textContent = meta[0];
  $("subtitle").textContent = meta[1];
  $("primaryBtn").hidden = !["users", "plans", "subs"].includes(name);
  $("primaryBtn").textContent = name === "plans" ? "New plan" : name === "subs" ? "Grant access" : "New user";
  render();
}

async function renderDash() {
  const d = await api("/api/admin/dashboard");
  const s = d.stats;
  view.innerHTML = `
    <div class="kpis">
      <div class="kpi"><strong>${s.users}</strong><span>Users</span></div>
      <div class="kpi"><strong>${s.activeSubs}</strong><span>Active subs</span></div>
      <div class="kpi"><strong>${money(s.revenueCents)}</strong><span>Paystack collected</span></div>
      <div class="kpi"><strong>${s.pendingPayments}</strong><span>Pending payments</span></div>
      <div class="kpi"><strong>${s.signups7d}</strong><span>Sign-ups (7d)</span></div>
      <div class="kpi"><strong>${s.plans}</strong><span>Active plans</span></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Latest payments</h3>
        ${(d.recentPayments || []).map((p) => `<div class="row-actions" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)"><span>${p.planCode} · ${money(p.amountCents, p.currency)}</span>${badge(p.status)}</div>`).join("") || "<p class='muted'>No payments yet</p>"}
      </div>
      <div class="card">
        <h3>New users</h3>
        ${(d.recentUsers || []).map((u) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">${u.displayName || u.email || u.telegramId}<br><small class="muted">${u.planCode} · ${when(u.createdAt)}</small></div>`).join("") || "<p class='muted'>Nobody yet</p>"}
      </div>
    </div>`;
}

async function renderUsers() {
  const q = view.querySelector("#q")?.value || "";
  const d = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
  view.innerHTML = `
    <div class="toolbar"><input id="q" placeholder="Search name, @, email, telegram…" value="${q}" /><button class="btn small ghost" id="search">Filter</button></div>
    <div class="card"><table><thead><tr><th>User</th><th>Plan</th><th>Credits</th><th>Status</th><th></th></tr></thead>
    <tbody>${d.users.map((u) => `<tr>
      <td><b>${u.displayName || "—"}</b><br><small class="muted">${u.username ? "@" + u.username : ""} ${u.telegramId || ""} ${u.email || ""}</small></td>
      <td>${u.planCode || "starter"}</td><td>${u.credits ?? "—"}</td><td>${badge(u.status)}</td>
      <td><button class="btn small ghost" data-edit="${u.id}">Manage</button></td>
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
    <p class="muted">Telegram ${u.telegramId || "—"} · ${u.email || "no email"}</p>
    <label>Name<input id="displayName" value="${u.displayName || ""}"/></label>
    <label>Email<input id="email" value="${u.email || ""}"/></label>
    <label>Plan<select id="planCode">${plans.map((p) => `<option value="${p.code}" ${p.code === u.planCode ? "selected" : ""}>${p.name}</option>`).join("")}</select></label>
    <label>Credits<input id="credits" type="number" value="${u.credits ?? 0}"/></label>
    <label>Status<select id="status">
      ${["active", "banned", "disabled"].map((s) => `<option ${u.status === s ? "selected" : ""}>${s}</option>`).join("")}
    </select></label>
    <label>Notes<textarea id="notes" rows="3">${u.notes || ""}</textarea></label>
    <div class="modal-actions">
      <button class="btn ghost small" id="close">Close</button>
      <button class="btn small" id="save">Save</button>
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
    <h3>${p.id ? "Edit plan" : "New plan"}</h3>
    <label>Name<input id="name" value="${p.name || ""}"/></label>
    <label>Code<input id="code" value="${p.code || ""}" ${p.id ? "disabled" : ""}/></label>
    <label>Description<textarea id="description" rows="2">${p.description || ""}</textarea></label>
    <label>Price (kobo)<input id="priceCents" type="number" value="${p.priceCents ?? 0}"/></label>
    <label>Currency<input id="currency" value="${p.currency || "NGN"}"/></label>
    <label>Cycle<select id="interval">${["week", "month", "year"].map((i) => `<option value="${i}" ${p.interval === i ? "selected" : ""}>${intervalLabel(i)}</option>`).join("")}</select></label>
    <label>Order<input id="sortOrder" type="number" value="${p.sortOrder ?? 0}"/></label>
    <label><input id="active" type="checkbox" ${p.active !== false ? "checked" : ""}/> Active</label>
    <label><input id="highlighted" type="checkbox" ${p.highlighted ? "checked" : ""}/> Featured</label>
    <div class="modal-actions">
      ${p.id ? `<button class="btn danger small" id="del">Delete</button>` : ""}
      <button class="btn ghost small" id="close">Close</button>
      <button class="btn small" id="save">Save</button>
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
      if (!confirm("Delete this plan?")) return;
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
      <p><strong>${money(p.priceCents, p.currency)}</strong> / ${intervalLabel(p.interval)}</p>
      <p class="muted">Bot access</p>
      <button class="btn small ghost" data-plan="${p.id}">Edit</button>
    </article>`,
    )
    .join("")}</div>`;
  view.querySelectorAll("[data-plan]").forEach((b) => {
    b.onclick = () => planForm(d.plans.find((p) => p.id === b.dataset.plan));
  });
}

async function renderSubs() {
  const d = await api("/api/admin/subscriptions");
  view.innerHTML = `<div class="card"><table><thead><tr><th>User</th><th>Plan</th><th>Cycle</th><th>Period end</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.subscriptions
      .map(
        (s) => `<tr>
      <td><code>${s.userId.slice(0, 10)}</code></td>
      <td>${s.planName}</td><td>/${intervalLabel(s.interval)}</td>
      <td>${when(s.currentPeriodEnd)}</td><td>${badge(s.status)}</td>
      <td class="row-actions">
        <button class="btn small ghost" data-act="paused" data-id="${s.id}">Pause</button>
        <button class="btn small ghost" data-act="canceled" data-id="${s.id}">Cancel</button>
        <button class="btn small ghost" data-act="active" data-id="${s.id}">Activate</button>
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
    <h3>Grant a subscription</h3>
    <label>User<select id="userId">${users.map((u) => `<option value="${u.id}">${u.displayName} (${u.planCode})</option>`).join("")}</select></label>
    <label>Plan<select id="planId">${plans.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select></label>
    <div class="modal-actions"><button class="btn ghost small" id="close">Close</button><button class="btn small" id="save">Activate</button></div>`);
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
    <h3>New user</h3>
    <label>Name<input id="displayName"/></label>
    <label>Email<input id="email" type="email"/></label>
    <label>Telegram ID<input id="telegramId" type="number"/></label>
    <div class="modal-actions"><button class="btn ghost small" id="close">Close</button><button class="btn small" id="save">Create</button></div>`);
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
  view.innerHTML = `<div class="card"><table><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Paystack</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.payments
      .map(
        (p) => `<tr>
      <td>${when(p.createdAt)}</td><td>${p.planCode}</td>
      <td>${money(p.amountCents, p.currency)} / ${intervalLabel(p.interval)}</td>
      <td>${p.providerRef || (p.metadata?.sandbox ? "sandbox" : "—")}</td>
      <td>${badge(p.status)}</td>
      <td>${p.status === "pending" ? `<button class="btn small" data-pay="${p.id}">Confirm</button>` : ""}</td>
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

async function renderPaystack() {
  const d = await api("/api/admin/settings");
  view.innerHTML = `<div class="card" style="max-width:640px">
    <p>Payments go through the Paystack API (<a href="https://paystack.com/docs" target="_blank" rel="noreferrer">paystack.com/docs</a>). Covers Nigeria and other English-speaking African markets (GH, KE, ZA).</p>
    <p class="muted">Keys: <b>${d.paystack.configured ? "present" : "missing"}</b> · env <b>${d.paystack.env}</b></p>
    <p class="muted">API: <code>${d.paystack.apiUrl}</code></p>
    <p class="muted">Webhook (public HTTPS): <code>${d.paystack.webhook}</code></p>
    <p class="muted">Flow: <code>POST /transaction/initialize</code> → customer pays on Paystack checkout → signed webhook <code>charge.success</code> → local access opens. Week / month / year are local access windows: Paystack is used as a one-time charge.</p>
    <label>Support email<input id="supportEmail" value="${d.settings.supportEmail || ""}"/></label>
    <label>Currency<input id="currency" value="${d.settings.currency || "NGN"}"/></label>
    <label><input id="paystackEnabled" type="checkbox" ${d.settings.paystackEnabled !== false ? "checked" : ""}/> Paystack enabled</label>
    <label><input id="allowManualConfirm" type="checkbox" ${d.settings.allowManualConfirm !== false ? "checked" : ""}/> Manual confirm (safety net)</label>
    <p class="muted">In <code>.env</code>: <code>PAYSTACK_PUBLIC_KEY</code>, <code>PAYSTACK_SECRET_KEY</code>, <code>PAYSTACK_ENV=test</code> or <code>live</code>, <code>PAYSTACK_CURRENCY=NGN</code>, <code>PUBLIC_URL</code> as HTTPS.</p>
    <button class="btn small" id="save">Save</button>
  </div>`;
  $("save").onclick = async () => {
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        supportEmail: document.getElementById("supportEmail").value,
        currency: document.getElementById("currency").value,
        paystackEnabled: document.getElementById("paystackEnabled").checked,
        allowManualConfirm: document.getElementById("allowManualConfirm").checked,
      }),
    });
    renderPaystack();
  };
}

async function renderAudit() {
  const d = await api("/api/admin/audit");
  view.innerHTML = `<div class="card"><table><thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${d.audit.map((a) => `<tr><td>${when(a.at)}</td><td>${a.action}</td><td><small class="muted">${JSON.stringify(a.meta)}</small></td></tr>`).join("")}
  </tbody></table></div>`;
}

async function render() {
  view.innerHTML = "<p class='muted'>Loading…</p>";
  const map = { dash: renderDash, users: renderUsers, plans: renderPlans, subs: renderSubs, pays: renderPays, paystack: renderPaystack, audit: renderAudit };
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
  $("paystackBadge").textContent = d.paystack === "live" ? "Paystack live" : `Paystack ${d.paystack || "test"}`;
  setView("dash");
});
