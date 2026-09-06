const KEY = "pb_admin_token";
const form = document.getElementById("form");
const err = document.getElementById("err");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    err.textContent = data.error || "Sign-in failed";
    err.hidden = false;
    return;
  }
  localStorage.setItem(KEY, data.token);
  location.replace("/admin/");
});
