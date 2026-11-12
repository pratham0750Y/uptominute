const $ = (id) => document.getElementById(id);
const f = $("f"), msg = $("msg");
let mode = "in", cfg = { signup: true, needsCode: false };

function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-selected", b.dataset.m === m));
  $("up-only").hidden = m !== "up";
  $("code-row").hidden = m !== "up" || !cfg.needsCode;
  $("go").textContent = m === "up" ? "Create account" : "Sign in";
  $("p").autocomplete = m === "up" ? "new-password" : "current-password";
  msg.textContent = "";
}
$("modes").onclick = (e) => { if (e.target.dataset.m) setMode(e.target.dataset.m); };

fetch("/api/config").then((r) => r.json()).then((c) => {
  cfg = c;
  if (!c.signup) { $("modes").hidden = true; $("foot").textContent = "Accounts are created by the person who runs this server."; }
}).catch(() => {});

f.onsubmit = async (e) => {
  e.preventDefault();
  msg.textContent = "";
  if (mode === "up" && $("p").value !== $("p2").value) { msg.textContent = "The two passwords do not match."; return; }
  const btn = $("go"); btn.disabled = true;
  try {
    const body = { username: $("u").value, password: $("p").value };
    if (mode === "up" && cfg.needsCode) body.code = $("c").value;
    const res = await fetch(mode === "up" ? "/api/signup" : "/api/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return (location.href = "/");
    msg.textContent = data.message || "Something went wrong.";
  } catch { msg.textContent = "Could not reach the server."; }
  btn.disabled = false;
};
