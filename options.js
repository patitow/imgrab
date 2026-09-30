// Textos traduzidos (_locales) e o prefixo correto da página de atalhos do navegador.
document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = chrome.i18n.getMessage("optionsTitle");
document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = chrome.i18n.getMessage(el.dataset.i18n)));
document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => (el.placeholder = chrome.i18n.getMessage(el.dataset.i18nPlaceholder)));
document.getElementById("shortcutsUrl").textContent = (/Edg\//.test(navigator.userAgent) ? "edge" : "chrome") + "://extensions/shortcuts";

const fields = [...document.querySelectorAll("[data-key]")];
let saveTimer;

const read = (el) => (el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value);
const write = (el, v) => (el.type === "checkbox" ? (el.checked = v) : (el.value = v));

function preview() {
  const s = Object.fromEntries(fields.map((el) => [el.dataset.key, read(el)]));
  const n = (i) => String(s.counterStart + i * s.counterStep).padStart(Math.max(1, s.counterDigits || 1), "0");
  const mk = (name, i) =>
    renderFilename(
      { ...s, folder: "" },
      { url: `https://img.example.com/a/b/${name}`, pageUrl: "https://example.com/gallery/page", title: "Page title", counter: n(i) }
    );
  document.getElementById("p1").textContent = mk("jean-doe.jpg", 0);
  document.getElementById("p2").textContent = mk("haha-yes.png", 1);
}

chrome.storage.sync.get(DEFAULTS).then((s) => {
  fields.forEach((el) => write(el, s[el.dataset.key]));
  preview();
});

fields.forEach((el) =>
  el.addEventListener("input", () => {
    preview();
    chrome.storage.sync.set({ [el.dataset.key]: read(el) }).then(() => {
      const saved = document.getElementById("saved");
      saved.classList.add("on");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saved.classList.remove("on"), 900);
    });
  })
);
