const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const JSON_HEADERS = { "content-type": "application/json" };

// Keep these ids and colours in step with style.css and server/profile.js.
const THEMES = [
  { id: "cyber", name: "Cyber", c: ["#04060c", "#00e5ff", "#ff2bd6"] },
  { id: "olive", name: "Olive", c: ["#1c2016", "#e0b48a", "#a9bd93"] },
  { id: "ocean", name: "Ocean", c: ["#05121a", "#2ec4b6", "#4895ef"] },
  { id: "sunset", name: "Sunset", c: ["#150a0c", "#ff8c42", "#ff3d81"] },
  { id: "graphite", name: "Graphite", c: ["#0c0d0f", "#d4d8e4", "#8aa4ff"] },
  { id: "paper", name: "Paper (light)", c: ["#f4f1e8", "#0b6e4f", "#b4492e"] },
];

const show = (id, text, ok) => { const el = $(id); el.className = ok ? "ok" : "err"; el.textContent = text; };

async function call(path, body) {
  const res = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body ?? {}) });
  if (res.status === 401 && path !== "/api/password") { location.href = "/login.html"; throw new Error("Please sign in"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

let me = null;
function paintAvatar(v) {
  me.avatarV = v;
  $("av").innerHTML = v ? `<img alt="Your photo" src="/api/avatar?v=${v}">` : esc(me.user[0].toUpperCase());
  $("rm").hidden = !v;
}
function currentTheme() { return document.documentElement.getAttribute("data-theme") || "olive"; }
function paintThemes() {
  const now = currentTheme();
  $("themes").innerHTML = THEMES.map((t) =>
    `<button class="sw" data-t="${t.id}" aria-pressed="${t.id === now}"><span>${esc(t.name)}</span>${t.c.map((c) => `<i style="background:${c}"></i>`).join("")}</button>`).join("");
}

async function init() {
  const res = await fetch("/api/me");
  if (res.status === 401) return (location.href = "/login.html");
  me = await res.json();
  $("who").textContent = `Signed in as ${me.user}`;
  if (me.theme) { document.documentElement.setAttribute("data-theme", me.theme); try { localStorage.setItem("blr-theme", me.theme); } catch {} }
  paintAvatar(me.avatarV);
  paintThemes();
}

// ---- theme ----
$("themes").onclick = async (e) => {
  const b = e.target.closest("[data-t]"); if (!b) return;
  const id = b.dataset.t;
  document.documentElement.setAttribute("data-theme", id);       // instant
  try { localStorage.setItem("blr-theme", id); } catch {}
  paintThemes();
  try { await call("/api/theme", { theme: id }); show("thmsg", "Theme saved to your account.", true); }
  catch (err) { show("thmsg", `Applied here, but not saved to your account: ${err.message}`, false); }
};

// ---- profile photo: crop to a square and shrink in the browser, then upload ----
function toSquareJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const size = 256, c = document.createElement("canvas"); c.width = c.height = size;
      const s = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url); resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that picture. Try a JPG or PNG.")); };
    img.src = url;
  });
}
$("up").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0]; $("file").value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) return show("avmsg", "Please choose an image file.", false);
  if (f.size > 15 * 1024 * 1024) return show("avmsg", "That picture is too large (15 MB maximum).", false);
  show("avmsg", "Uploading…", true);
  try { const r = await call("/api/avatar", { image: await toSquareJpeg(f) }); paintAvatar(r.avatarV); show("avmsg", "Photo updated.", true); }
  catch (e) { show("avmsg", e.message, false); }
};
$("rm").onclick = async () => {
  try { await call("/api/avatar", { image: null }); paintAvatar(0); show("avmsg", "Photo removed.", true); }
  catch (e) { show("avmsg", e.message, false); }
};

// ---- password ----
$("pwgo").onclick = async () => {
  if ($("np").value !== $("np2").value) return show("pwmsg", "The two new passwords do not match.", false);
  $("pwgo").disabled = true;
  try {
    await call("/api/password", { current: $("cur").value, password: $("np").value });
    ["cur", "np", "np2"].forEach((i) => ($(i).value = ""));
    show("pwmsg", "Password changed. Other devices have been signed out.", true);
  } catch (e) { show("pwmsg", e.message, false); }
  $("pwgo").disabled = false;
};

// ---- sign out ----
$("out").onclick = async () => { try { await call("/api/logout"); } catch {} location.href = "/login.html"; };

init().catch(() => show("who", "Could not load your account.", false));
