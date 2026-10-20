// Собирает privacy.html и terms.html для wyx.su из текстов приложения
// (sux-chat-app/src/pages/Legal.tsx), чтобы сайт и экран в приложении не
// разъезжались, и страницу удаления аккаунта (DELETION ниже).
// Запуск: node nginx/wyx-site/build-legal.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Удаление аккаунта отдельной страницей: Google Play требует ссылку, по которой
// без входа в приложение видно, как удалить аккаунт и что при этом удаляется.
// Лежит каталогом (delete-account/index.html): адрес /delete-account/ отдаёт
// общий location nginx, отдельный маршрут в wyx.conf не нужен.
// Что удаляется — по DeleteAccountView (backend/chat/account.py).
const DELETION = {
  ru: {
    title: `Удаление аккаунта ${APP_NAME}`,
    intro: "Аккаунт можно удалить в любой момент — в приложении или письмом. Удаление необратимо: восстановить аккаунт и переписку будет нельзя.",
    sections: [
      { h: "В приложении", p: ["Откройте «Профиль → Конфиденциальность → Удалить аккаунт» и подтвердите паролем. Аккаунт удаляется сразу."] },
      { h: "Если войти не получается", p: [`Напишите на ${SUPPORT_EMAIL} и укажите логин аккаунта — удалим по запросу.`] },
      { h: "Удаление части данных без удаления аккаунта", p: [
        "Сообщения и вложения: меню сообщения → «Удалить». Чат целиком — из его меню. Созданные вами каналы, стикерпаки, паки звуков и ботов удаляет их владелец из настроек. Почта для восстановления отвязывается в «Профиль → Конфиденциальность».",
        "Удалённое исчезает у собеседников сразу; вложения стираются из облачного хранилища в течение 30 дней. Жалобы, которые уже разобраны, не удаляются.",
        `Если нужного действия нет в приложении, напишите на ${SUPPORT_EMAIL} с логином и описанием, что удалить.`,
      ] },
      { h: "Что удаляется", p: [
        "Сразу: профиль и почта для восстановления, ваши сообщения, личные чаты и «Избранное», созданные вами каналы, стикерпаки и паки звуков, ваши боты, токены уведомлений и список заблокированных.",
        "Вложения — фото, видео, файлы, голосовые — становятся недоступны сразу и стираются из облачного хранилища в течение 30 дней.",
      ] },
      { h: "Что остаётся", p: [
        "Группы, в которых вы состояли, остаются у других участников — уже без ваших сообщений.",
        "Жалобы, которые вы отправляли или которые подавали на вас, остаются у модераторов без привязки к аккаунту.",
        "Копии секретных чатов на устройствах собеседников хранятся у них: удалить их с чужих устройств мы не можем.",
      ] },
    ],
  },
  en: {
    title: `Deleting your ${APP_NAME} account`,
    intro: "You can delete your account at any time — in the app or by email. Deletion is permanent: the account and its chats cannot be restored.",
    sections: [
      { h: "In the app", p: ["Open Profile → Privacy → Delete account and confirm with your password. The account is deleted immediately."] },
      { h: "If you can't sign in", p: [`Email ${SUPPORT_EMAIL} with your account login, and we will delete it on request.`] },
      { h: "Deleting some of your data without deleting the account", p: [
        "Messages and attachments: message menu → Delete. A whole chat — from its menu. Channels, sticker packs, sound packs and bots you created are deleted by their owner from their settings. The recovery email can be unlinked in Profile → Privacy.",
        "Deleted content disappears for other participants immediately; attachments are erased from cloud storage within 30 days. Reports that have already been reviewed are not deleted.",
        `If the action you need is not in the app, email ${SUPPORT_EMAIL} with your login and what to delete.`,
      ] },
      { h: "What is deleted", p: [
        "Immediately: your profile and recovery email, your messages, direct chats and Saved messages, channels you created, your sticker and sound packs, your bots, notification tokens and your block list.",
        "Attachments — photos, videos, files, voice messages — become inaccessible immediately and are erased from cloud storage within 30 days.",
      ] },
      { h: "What remains", p: [
        "Groups you were in stay with the other members, without your messages.",
        "Reports you sent or that were filed about you stay with moderators, no longer linked to your account.",
        "Copies of secret chats on your contacts' devices stay on those devices; we cannot delete them from other people's phones.",
      ] },
    ],
  },
  ko: {
    title: `${APP_NAME} 계정 삭제`,
    intro: "계정은 언제든지 앱에서 또는 이메일로 삭제할 수 있습니다. 삭제는 되돌릴 수 없으며, 계정과 대화를 복구할 수 없습니다.",
    sections: [
      { h: "앱에서 삭제", p: ["프로필 → 개인정보 → 계정 삭제를 열고 비밀번호로 확인하세요. 계정은 즉시 삭제됩니다."] },
      { h: "로그인할 수 없는 경우", p: [`${SUPPORT_EMAIL}로 계정 아이디를 적어 보내 주시면 요청에 따라 삭제해 드립니다.`] },
      { h: "계정을 삭제하지 않고 일부 데이터만 삭제하기", p: [
        "메시지와 첨부 파일: 메시지 메뉴 → 삭제. 채팅 전체는 채팅 메뉴에서 삭제합니다. 내가 만든 채널, 스티커 팩, 사운드 팩, 봇은 소유자가 설정에서 삭제합니다. 복구 이메일은 프로필 → 개인정보에서 연결을 해제할 수 있습니다.",
        "삭제된 내용은 상대방에게서도 즉시 사라지며, 첨부 파일은 30일 이내에 클라우드 저장소에서 삭제됩니다. 이미 처리된 신고는 삭제되지 않습니다.",
        `앱에 필요한 기능이 없다면 ${SUPPORT_EMAIL}로 아이디와 삭제할 내용을 적어 보내 주세요.`,
      ] },
      { h: "삭제되는 정보", p: [
        "즉시: 프로필과 복구 이메일, 내가 보낸 메시지, 1:1 채팅과 저장한 메시지, 내가 만든 채널, 스티커 팩과 사운드 팩, 내 봇, 알림 토큰, 차단 목록.",
        "첨부 파일(사진, 동영상, 파일, 음성 메시지)은 즉시 접근할 수 없게 되며 30일 이내에 클라우드 저장소에서 삭제됩니다.",
      ] },
      { h: "남는 정보", p: [
        "참여했던 그룹은 다른 참여자에게 남지만, 내 메시지는 삭제됩니다.",
        "내가 보낸 신고와 나에 대한 신고는 계정과 연결되지 않은 상태로 운영진에게 남습니다.",
        "상대방 기기에 있는 비밀 채팅 사본은 그 기기에 남으며, 다른 사람의 기기에서는 삭제할 수 없습니다.",
      ] },
    ],
  },
};

const terms = { kind: "terms", docs: TERMS, path: "/terms" };
const privacy = { kind: "privacy", docs: PRIVACY, path: "/privacy" };
const deletion = {
  kind: "delete",
  docs: Object.fromEntries(LANGS.map((l) => [l, { ...DELETION[l], updated: PRIVACY[l].updated }])),
  path: "/delete-account/",
};
writeFileSync(join(here, "terms.html"), page({ ...terms, other: privacy }));
writeFileSync(join(here, "privacy.html"), page({ ...privacy, other: terms }));
mkdirSync(join(here, "delete-account"), { recursive: true });
writeFileSync(join(here, "delete-account", "index.html"), page({ ...deletion, other: privacy }));
console.log(`terms.html, privacy.html и delete-account/index.html собраны (${APP_NAME}, редакция ${LEGAL_UPDATED})`);
