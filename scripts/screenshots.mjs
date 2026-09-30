// Generates the store screenshots (1280x800) and doubles as an end-to-end smoke test.
// Usage: node scripts/screenshots.mjs
// Needs Edge or Chrome installed. Launches it headless with the extension loaded.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "screenshots");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "imgrab-"));
const prof = path.join(tmp, "profile");
const dl = path.join(tmp, "downloads");
const PORT = 8765;
const DEBUG_PORT = 9334;

const browser = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => fs.existsSync(p));
if (!browser) throw new Error("Edge/Chrome not found");

// ---------- demo gallery (generated SVG scenes, no third-party images) ----------
const palettes = [
  ["#ff9966", "#ff5e62", "#2b1055", "#1b0b3a"],
  ["#56ccf2", "#2f80ed", "#0f2a5e", "#081a3d"],
  ["#f7971e", "#ffd200", "#3a1c71", "#1d0f3a"],
  ["#a8ff78", "#78ffd6", "#0b486b", "#05263b"],
  ["#ee9ca7", "#ffdde1", "#4b2c6b", "#2a1640"],
  ["#c79081", "#dfa579", "#2c3e50", "#16222e"],
];
const scene = ([sky1, sky2, m1, m2], i) => `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="500" viewBox="0 0 760 500">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
<rect width="760" height="500" fill="url(#g)"/>
<circle cx="${200 + i * 70}" cy="${190 + (i % 3) * 25}" r="62" fill="#fff" opacity=".85"/>
<polygon points="0,500 0,330 140,230 260,330 380,200 520,340 640,250 760,350 760,500" fill="${m1}" opacity=".85"/>
<polygon points="0,500 0,400 120,320 250,410 400,310 560,420 700,340 760,400 760,500" fill="${m2}"/></svg>`;
const names = ["sunset-ridge", "blue-hour", "golden-valley", "mint-lake", "rose-dusk", "desert-night"];
const html = `<!doctype html><meta charset="utf-8"><title>Sunsets</title>
<style>body{margin:0;background:#0f1115;color:#e8eaf0;font:16px system-ui,sans-serif}
header{padding:28px 48px 8px}h1{margin:0;font-size:28px}p{margin:6px 0 0;color:#8b92a5}
main{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:24px 48px}
img{width:100%;display:block;border-radius:10px}</style>
<header><h1>Sunset collection</h1><p>Hover an image and click the button to download it.</p></header>
<main>${names.map((n) => `<img src="/img/${n}.svg" alt="${n}">`).join("")}</main>`;

const server = http
  .createServer((req, res) => {
    const m = req.url.match(/^\/img\/(.+)\.svg$/);
    if (m && names.includes(m[1])) {
      res.setHeader("content-type", "image/svg+xml");
      return res.end(scene(palettes[names.indexOf(m[1])], names.indexOf(m[1])));
    }
    res.setHeader("content-type", "text/html");
    res.end(html);
  })
  .listen(PORT);

// ---------- launch browser ----------
fs.mkdirSync(path.join(prof, "Default"), { recursive: true });
fs.mkdirSync(dl, { recursive: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(prof, "Default", "Preferences"),
  JSON.stringify({ download: { default_directory: dl, prompt_for_download: false }, intl: { accept_languages: "en-US" } })
);
const proc = spawn(
  browser,
  [
    `--user-data-dir=${prof}`,
    `--load-extension=${root}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--headless=new",
    "--lang=en-US",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" }
);
const cleanup = () => {
  proc.kill();
  server.close();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let ver;
  for (let i = 0; i < 40 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    } catch {
      await sleep(500);
    }
  }
  if (!ver) throw new Error("browser did not start");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (d) => (d.error ? reject(new Error(method + ": " + d.error.message)) : resolve(d.result)));
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  // The browser ships built-in extensions too: pick the one whose manifest name is ours.
  let extId;
  for (let i = 0; i < 30 && !extId; i++) {
    const { targetInfos } = await send("Target.getTargets");
    for (const t of targetInfos.filter((x) => x.type === "service_worker" && x.url.startsWith("chrome-extension://"))) {
      try {
        const { sessionId } = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
        const r = await send("Runtime.evaluate", { expression: "chrome.runtime.getManifest().name", returnByValue: true }, sessionId);
        if (r.result.value === "Imgrab") extId = new URL(t.url).host;
      } catch {}
    }
    if (!extId) await sleep(500);
  }
  if (!extId) throw new Error("Imgrab service worker not found");

  const open = async (url) => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    await sleep(1800);
    return sessionId;
  };
  const evaluate = async (sessionId, expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
  const mouse = (sessionId, type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra }, sessionId);
  const shot = async (sessionId, name) => {
    const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 }, sessionId);
    fs.writeFileSync(path.join(out, name), Buffer.from(data, "base64"));
    console.log("saved", name);
  };

  // 1 + 2: hover button and download toast
  const page = await open(`http://localhost:${PORT}/`);
  const imgBox = JSON.parse(await evaluate(page, `JSON.stringify(document.querySelectorAll('img')[1].getBoundingClientRect())`));
  await mouse(page, "mouseMoved", imgBox.x + imgBox.width / 2, imgBox.y + imgBox.height / 2, { button: "none", clickCount: 0 });
  await sleep(400);
  const btnBox = JSON.parse(
    await evaluate(
      page,
      `JSON.stringify([...document.querySelectorAll('div')].find(d => d.shadowRoot && d.shadowRoot.querySelector('.btn')).shadowRoot.querySelector('.btn').getBoundingClientRect())`
    )
  );
  const bx = btnBox.x + btnBox.width / 2;
  const by = btnBox.y + btnBox.height / 2;
  await mouse(page, "mouseMoved", bx, by, { button: "none", clickCount: 0 });
  await sleep(300);
  await shot(page, "1-hover-button.jpg");
  await mouse(page, "mousePressed", bx, by);
  await mouse(page, "mouseReleased", bx, by);
  await sleep(900);
  await shot(page, "2-downloaded.jpg");

  // 3: options page
  const opts = await open(`chrome-extension://${extId}/options.html`);
  await shot(opts, "3-options.jpg");

  const files = fs.existsSync(dl) ? fs.readdirSync(dl, { recursive: true }) : [];
  console.log("downloaded files:", files);
  if (!files.some((f) => /blue-hour\.svg$/.test(f))) throw new Error("SMOKE TEST FAILED: download did not happen");
  console.log("OK");
} finally {
  cleanup();
  setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 1500);
}
