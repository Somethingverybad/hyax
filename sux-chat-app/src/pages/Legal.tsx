import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenHeader from "@/components/ScreenHeader";
import { APP_NAME, SUPPORT_EMAIL, LEGAL_UPDATED } from "@/lib/brand";

type Lang = "ru" | "en";
export type LegalKind = "terms" | "privacy";
type Section = { h: string; p: string[] };
type Doc = { title: string; updated: string; intro: string; sections: Section[] };

const mail = SUPPORT_EMAIL;

const TERMS: Record<Lang, Doc> = {
  ru: {
    title: "Правила",
    updated: `Редакция от ${LEGAL_UPDATED}`,
    intro: `${APP_NAME} — мессенджер. Регистрируясь и пользуясь им, вы принимаете эти правила. Не согласны — не пользуйтесь приложением и удалите аккаунт.`,
    sections: [
      { h: "Кому можно", p: [
        "Приложение рассчитано на пользователей от 17 лет. Материалы с пометкой 18+ скрыты, пока вы сами не включите их показ в настройках и не подтвердите, что вам есть 18.",
      ] },
      { h: "Чего нельзя", p: [
        "К недопустимому контенту и оскорбительному поведению — нулевая терпимость. Запрещено отправлять, публиковать в каналах и загружать в паки стикеров и звуков:",
        "• порнографию и любую сексуализацию несовершеннолетних;\n• угрозы, травлю, преследование, призывы к насилию и разжигание ненависти;\n• чужие персональные данные без согласия человека;\n• спам, мошенничество, вредоносные ссылки и файлы;\n• то, что нарушает закон или чужие авторские права.",
        "Материалы для взрослых, не запрещённые законом, в паках обязаны иметь пометку 18+.",
      ] },
      { h: "Жалобы и блокировки", p: [
        "На любое сообщение, пользователя, канал или пак можно пожаловаться: меню сообщения или карточка пользователя → «Пожаловаться». Жалобы разбирают модераторы в течение 24 часов: нарушающий контент удаляется, а его автор лишается доступа.",
        "Любого пользователя можно заблокировать из его карточки: его сообщения и уведомления перестанут приходить сразу. Список заблокированных — в «Профиль → Конфиденциальность».",
      ] },
      { h: "Ваш контент", p: [
        "Всё, что вы отправляете, остаётся вашим. Вы разрешаете нам хранить и доставлять это адресатам — только ради работы мессенджера. За содержание отвечает тот, кто его отправил.",
      ] },
      { h: "Аккаунт", p: [
        "Храните пароль в тайне: восстановить его по почте или телефону нельзя, мы их не собираем. Удалить аккаунт со всеми данными можно в «Профиль → Конфиденциальность → Удалить аккаунт».",
        "Мы можем ограничить или удалить аккаунт, нарушающий эти правила.",
      ] },
      { h: "Без гарантий", p: [
        "Приложение предоставляется «как есть». Мы стараемся, чтобы оно работало, но не обещаем бесперебойной работы и не отвечаем за потерю данных.",
      ] },
      { h: "Связь", p: [`Вопросы и жалобы: ${mail}`] },
    ],
  },
  en: {
    title: "Terms of Use",
    updated: `Last updated ${LEGAL_UPDATED}`,
    intro: `${APP_NAME} is a messenger. By creating an account and using it you agree to these terms. If you do not agree, do not use the app and delete your account.`,
    sections: [
      { h: "Eligibility", p: [
        "The app is intended for users aged 17 and over. Content marked 18+ stays hidden until you turn it on in settings and confirm that you are 18 or older.",
      ] },
      { h: "Prohibited content", p: [
        "There is zero tolerance for objectionable content and abusive behaviour. You may not send, post to channels, or upload to sticker and sound packs:",
        "• pornography or any sexualisation of minors;\n• threats, bullying, harassment, incitement to violence or hatred;\n• other people's personal data without their consent;\n• spam, fraud, malicious links or files;\n• anything illegal or infringing someone's copyright.",
        "Lawful adult material in packs must carry the 18+ mark.",
      ] },
      { h: "Reports and blocking", p: [
        "You can report any message, user, channel or pack: message menu or user card → “Report”. Moderators review reports within 24 hours: violating content is removed and its author loses access.",
        "You can block any user from their card: their messages and notifications stop immediately. The block list is in Profile → Privacy.",
      ] },
      { h: "Your content", p: [
        "What you send remains yours. You allow us to store it and deliver it to the recipients, solely to operate the messenger. The sender is responsible for the content.",
      ] },
      { h: "Account", p: [
        "Keep your password safe: it cannot be recovered by email or phone because we do not collect them. You can delete your account and all its data in Profile → Privacy → Delete account.",
        "We may restrict or remove accounts that break these terms.",
      ] },
      { h: "No warranty", p: [
        "The app is provided “as is”. We do our best to keep it running but do not guarantee uninterrupted service and are not liable for data loss.",
      ] },
      { h: "Contact", p: [`Questions and complaints: ${mail}`] },
    ],
  },
};

const PRIVACY: Record<Lang, Doc> = {
  ru: {
    title: "Политика конфиденциальности",
    updated: `Редакция от ${LEGAL_UPDATED}`,
    intro: `Здесь описано, какие данные собирает ${APP_NAME}, зачем и как их удалить. Рекламы, аналитики и сторонних трекеров в приложении нет; данные не продаются и не передаются для рекламы.`,
    sections: [
      { h: "Что мы храним", p: [
        "• Аккаунт: логин, пароль (только в виде хеша), никнейм, описание, аватар и обложку. Телефон, почту и список контактов не запрашиваем.",
        "• Переписку: сообщения, фото, видео, файлы, голосовые и их расшифровку, реакции, посты и комментарии в каналах. Расшифровка голосовых делается на нашем сервере, сторонним сервисам аудио не передаётся.",
        "• Созданные вами паки стикеров и звуков, сохранённые картинки, список заблокированных.",
        "• Токен устройства для уведомлений и дату регистрации.",
        "• Жалобы и баг-репорты, если вы их отправили: описание, скриншот и технический лог сеанса. В лог не попадают тексты сообщений и токены.",
      ] },
      { h: "Доступ на устройстве", p: [
        "Камера, микрофон и фото используются только когда вы сами снимаете, записываете, звоните или прикрепляете файл. Звонки идут напрямую между устройствами или через наш ретранслятор и не записываются.",
      ] },
      { h: "Кому данные передаются", p: [
        "• Адресатам ваших сообщений и подписчикам ваших каналов.",
        "• Сервисам доставки уведомлений Apple (APNs) и Google (Firebase Cloud Messaging): им уходит токен устройства и зашифрованное содержимое уведомления, расшифровать которое может только ваше устройство.",
        "• Облачному хранилищу Yandex Object Storage: там лежат фото, видео и файлы из переписки, доступ к ним — по временным ссылкам после проверки прав.",
        "• Модераторам — содержимое, на которое подана жалоба.",
        "• Государственным органам — только по требованию закона.",
      ] },
      { h: "Сколько хранится и как удалить", p: [
        "Данные хранятся, пока существует аккаунт. Сообщение можно удалить у себя или у всех. Аккаунт удаляется в приложении: «Профиль → Конфиденциальность → Удалить аккаунт». Вместе с ним сразу удаляются профиль, ваши сообщения, личные чаты, каналы, паки и токены уведомлений; вложения в облачном хранилище становятся недоступны сразу и стираются в течение 30 дней.",
        `Если войти в приложение не получается, напишите на ${mail} — удалим по запросу.`,
      ] },
      { h: "Безопасность", p: [
        "Соединение с сервером идёт по HTTPS, пароли хранятся в виде хеша, фото, видео и файлы — в закрытом хранилище. Аватары, обложки, стикеры, звуки и голосовые открываются по прямой ссылке со случайным именем, которую получают участники переписки. Сквозного шифрования переписки нет: сообщения хранятся на сервере.",
      ] },
      { h: "Дети", p: [
        "Приложение не предназначено для лиц младше 17 лет, и мы сознательно не собираем их данные.",
      ] },
      { h: "Изменения и связь", p: [
        `О существенных изменениях политики сообщим в приложении. Вопросы о данных: ${mail}`,
      ] },
    ],
  },
  en: {
    title: "Privacy Policy",
    updated: `Last updated ${LEGAL_UPDATED}`,
    intro: `This explains what data ${APP_NAME} collects, why, and how to delete it. The app contains no ads, analytics or third-party trackers; data is never sold or shared for advertising.`,
    sections: [
      { h: "What we store", p: [
        "• Account: login, password (hash only), nickname, bio, avatar and cover image. We do not ask for a phone number, email or contacts.",
        "• Conversations: messages, photos, videos, files, voice messages and their transcripts, reactions, channel posts and comments. Voice transcription runs on our own server; audio is not sent to third parties.",
        "• Sticker and sound packs you create, saved images, your block list.",
        "• A device token for notifications and the registration date.",
        "• Reports and bug reports you choose to send: description, screenshot and a technical session log. The log never contains message texts or tokens.",
      ] },
      { h: "Device access", p: [
        "Camera, microphone and photos are used only when you shoot, record, call or attach a file. Calls go directly between devices or through our relay and are not recorded.",
      ] },
      { h: "Who receives data", p: [
        "• The recipients of your messages and subscribers of your channels.",
        "• Apple (APNs) and Google (Firebase Cloud Messaging) notification services: they receive the device token and an encrypted notification payload that only your device can decrypt.",
        "• Yandex Object Storage: photos, videos and files from conversations are kept there and served via temporary links after a permission check.",
        "• Moderators — content that has been reported.",
        "• Authorities — only when required by law.",
      ] },
      { h: "Retention and deletion", p: [
        "Data is kept while the account exists. You can delete a message for yourself or for everyone. You can delete the account in the app: Profile → Privacy → Delete account. This immediately removes your profile, your messages, direct chats, channels, packs and notification tokens; attachments in cloud storage become inaccessible at once and are erased within 30 days.",
        `If you cannot sign in, email ${mail} and we will delete the account on request.`,
      ] },
      { h: "Security", p: [
        "Traffic to the server uses HTTPS, passwords are stored hashed, and photos, videos and files sit in private storage. Avatars, covers, stickers, sounds and voice messages are served by a direct link with a random name that conversation members receive. Conversations are not end-to-end encrypted: messages are stored on the server.",
      ] },
      { h: "Children", p: [
        "The app is not intended for anyone under 17 and we do not knowingly collect their data.",
      ] },
      { h: "Changes and contact", p: [
        `We will announce material changes in the app. Data questions: ${mail}`,
      ] },
    ],
  },
};

/**
 * Правила и политика конфиденциальности. Страницы публичные (без входа):
 * на них ведут экран регистрации, профиль и карточка приложения в сторах.
 * Два языка — ревьюер стора читает по-английски.
 */
export const LegalView = ({ kind: initial, onClose }: { kind: LegalKind; onClose: () => void }) => {
  // Переход между двумя документами — внутри, без маршрутов: тот же экран
  // открывается шторкой поверх регистрации, и уход по ссылке сбросил бы форму.
  const [kind, setKind] = useState<LegalKind>(initial);
  const [lang, setLang] = useState<Lang>(() => (navigator.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en");
  const doc = (kind === "terms" ? TERMS : PRIVACY)[lang];

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title={doc.title}
        onBack={onClose}
        right={
          <button
            type="button"
            onClick={() => setLang(lang === "ru" ? "en" : "ru")}
            className="w-10 h-10 flex items-center justify-center text-small font-semibold text-primary active:opacity-60"
            aria-label={lang === "ru" ? "Switch to English" : "Переключить на русский"}
          >
            {lang === "ru" ? "EN" : "RU"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-5 py-5 select-text">
        <div className="max-w-2xl mx-auto space-y-5 pb-10">
          <p className="text-caption text-subtle">{doc.updated}</p>
          <p className="text-body">{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.h} className="space-y-2">
              <h2 className="text-h1">{s.h}</h2>
              {s.p.map((t, i) => (
                <p key={i} className="text-body text-muted-foreground whitespace-pre-line">{t}</p>
              ))}
            </section>
          ))}
          <p className="pt-2 text-small">
            <button type="button" className="text-primary underline" onClick={() => setKind(kind === "terms" ? "privacy" : "terms")}>
              {kind === "terms" ? PRIVACY[lang].title : TERMS[lang].title}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

/** Страница по адресу /terms и /privacy. */
const Legal = ({ kind }: { kind: LegalKind }) => {
  const navigate = useNavigate();
  return (
    <LegalView
      key={kind}
      kind={kind}
      onClose={() => (window.history.length > 1 ? navigate(-1) : navigate("/", { replace: true }))}
    />
  );
};

export default Legal;
