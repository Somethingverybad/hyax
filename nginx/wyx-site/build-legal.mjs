// Собирает privacy.html и terms.html для wyx.su из текстов приложения
// (sux-chat-app/src/pages/Legal.tsx), чтобы сайт и экран в приложении не
// разъезжались. Запуск: node nginx/wyx-site/build-legal.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const brand = readFileSync(join(root, "sux-chat-app/src/lib/brand.ts"), "utf8");
const legal = readFileSync(join(root, "sux-chat-app/src/pages/Legal.tsx"), "utf8");

const constant = (name) => brand.match(new RegExp(`export const ${name} = "([^"]+)"`))[1];
const APP_NAME = constant("APP_NAME");
const SUPPORT_EMAIL = constant("SUPPORT_EMAIL");
const LEGAL_UPDATED = constant("LEGAL_UPDATED");

// Вырезаем объекты TERMS и PRIVACY и исполняем их как обычный JS.
const cut = (name) => {
  const start = legal.indexOf(`const ${name}: Record<Lang, Doc> = {`);
  const end = legal.indexOf("\n};\n", start);
  if (start < 0 || end < 0) throw new Error(`${name} не найден в Legal.tsx`);
  return legal.slice(legal.indexOf("= {", start) + 2, end + 2);
};
const evalDoc = (src) => new Function("APP_NAME", "LEGAL_UPDATED", "mail", `return (${src});`)(APP_NAME, LEGAL_UPDATED, SUPPORT_EMAIL);
const TERMS = evalDoc(cut("TERMS"));
const PRIVACY = evalDoc(cut("PRIVACY"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkify = (s) => esc(s).replace(new RegExp(SUPPORT_EMAIL.replace(".", "\\."), "g"), `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`);

// Языки — те, что есть в Legal.tsx (ru всегда, en, ko — если есть).
const LANGS = ["ru", "en", "ko"].filter((l) => TERMS[l] && PRIVACY[l]);
const LABEL = { ru: "RU", en: "EN", ko: "KO" };
const NAV = {
  download: { ru: "Скачать", en: "Download", ko: "다운로드" },
  terms: { ru: "Правила", en: "Terms", ko: "이용 규칙" },
  privacy: { ru: "Конфиденциальность", en: "Privacy", ko: "개인정보" },
};
const navAttrs = (k) => LANGS.map((l) => `data-${l}="${esc(NAV[k][l])}"`).join(" ");

const render = (doc, lang, other) => `
  <div class="lang-block" data-lang="${lang}" ${lang === "ru" ? "" : "hidden"}>
    <div class="doc-head">
      <h1>${esc(doc.title)}</h1>
      <div class="lang" role="group" aria-label="Language">
        ${LANGS.map((l) => `<button type="button" data-set="${l}" aria-pressed="${lang === l}">${LABEL[l]}</button>`).join("\n        ")}
      </div>
    </div>
    <p class="updated">${esc(doc.updated)}</p>
    <p class="intro">${esc(doc.intro)}</p>
    ${doc.sections.map((s) => `<h2>${esc(s.h)}</h2>\n${s.p.map((p) => `<p>${linkify(p)}</p>`).join("\n")}`).join("\n")}
    <p class="switch"><a href="${other.href}">${esc(other.title)}</a></p>
  </div>`;

const page = ({ kind, docs, other, path }) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docs.ru.title)} — ${APP_NAME}</title>
<meta name="description" content="${LANGS.map((l) => esc(docs[l].title)).join(" / ")} — ${APP_NAME}">
<meta name="theme-color" content="#F4F8F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#222B27" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="WYX"><img src="/mark.svg" alt="" width="30" height="30"><span>WYX</span></a>
    <nav class="nav">
      <a href="/#download" class="hide-sm" data-nav="download" ${navAttrs("download")}>Скачать</a>
      <a href="/terms" data-nav="terms" ${navAttrs("terms")}${kind === "terms" ? ' aria-current="page"' : ""}>Правила</a>
      <a href="/privacy" data-nav="privacy" ${navAttrs("privacy")}${kind === "privacy" ? ' aria-current="page"' : ""}>Конфиденциальность</a>
    </nav>
  </div>
</header>
<main class="doc wrap">
  <article class="card">
    ${LANGS.map((l) => render(docs[l], l, { href: other.path + (l === "ru" ? "" : "?lang=" + l), title: other.docs[l].title })).join("\n    ")}
  </article>
</main>
<footer class="wrap"><div>© 2026 ${APP_NAME}</div></footer>
<script>
  // Язык: ?lang=…, иначе по браузеру; переключатель запоминает выбор в адресе.
  (function () {
    var q = new URLSearchParams(location.search).get("lang");
    var langs = ${JSON.stringify(LANGS)};
    var nav = (navigator.language || "ru").toLowerCase().slice(0, 2);
    var saved = null; try { saved = localStorage.getItem("wyx-lang"); } catch (e) {}
    var lang = langs.indexOf(q) >= 0 ? q : langs.indexOf(saved) >= 0 ? saved : (langs.indexOf(nav) >= 0 ? nav : "en");
    function apply(l) {
      document.querySelectorAll(".lang-block").forEach(function (b) { b.hidden = b.dataset.lang !== l; });
      document.querySelectorAll("[data-nav]").forEach(function (a) { if (a.dataset[l]) a.textContent = a.dataset[l]; });
      document.querySelectorAll('a[href="/"], a[href^="/#"]').forEach(function (a) { var base = l === "ru" ? "/" : "/" + l + "/"; a.setAttribute("href", a.getAttribute("href").replace(/^\/(?:(?:en|ko)\/)?/, base)); });
      document.documentElement.lang = l;
      var u = new URL(location.href); u.searchParams.set("lang", l); history.replaceState(null, "", u);
    }
    apply(lang);
    document.querySelectorAll(".lang button").forEach(function (b) { b.addEventListener("click", function () { apply(b.dataset.set); }); });
  })();
</script>
</body>
</html>
`;

const terms = { kind: "terms", docs: TERMS, path: "/terms" };
const privacy = { kind: "privacy", docs: PRIVACY, path: "/privacy" };
writeFileSync(join(here, "terms.html"), page({ ...terms, other: privacy }));
writeFileSync(join(here, "privacy.html"), page({ ...privacy, other: terms }));
console.log(`terms.html и privacy.html собраны (${APP_NAME}, редакция ${LEGAL_UPDATED})`);
