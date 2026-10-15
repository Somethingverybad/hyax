import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ScreenHeader from "@/components/ScreenHeader";
import { APP_NAME, SUPPORT_EMAIL, LEGAL_UPDATED } from "@/lib/brand";
import { getLang } from "@/lib/i18n";

type Lang = "ru" | "en" | "ko";
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
        "Храните пароль в тайне. Восстановить его можно только по почте, если вы заранее привязали её: «Профиль → Конфиденциальность → Почта для восстановления». Удалить аккаунт со всеми данными можно в «Профиль → Конфиденциальность → Удалить аккаунт».",
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
        "Keep your password safe. It can be recovered only by email, and only if you have added one in Profile → Privacy → Recovery email. You can delete your account and all its data in Profile → Privacy → Delete account.",
        "We may restrict or remove accounts that break these terms.",
      ] },
      { h: "No warranty", p: [
        "The app is provided “as is”. We do our best to keep it running but do not guarantee uninterrupted service and are not liable for data loss.",
      ] },
      { h: "Contact", p: [`Questions and complaints: ${mail}`] },
    ],
  },
  ko: {
    title: "이용 규칙",
    updated: `최종 수정일: ${LEGAL_UPDATED}`,
    intro: `${APP_NAME}는 메신저입니다. 가입하고 이용하면 이 규칙에 동의하는 것으로 봅니다. 동의하지 않는다면 앱을 이용하지 말고 계정을 삭제해 주세요.`,
    sections: [
      { h: "이용 대상", p: [
        "앱은 17세 이상 이용자를 대상으로 합니다. 18+ 표시가 있는 콘텐츠는 이용자가 직접 설정에서 표시를 켜고 18세 이상임을 확인하기 전까지 숨겨집니다.",
      ] },
      { h: "금지 사항", p: [
        "허용되지 않는 콘텐츠와 모욕적인 행동에는 무관용 원칙을 적용합니다. 다음을 보내거나, 채널에 게시하거나, 스티커 팩과 사운드 팩에 올리는 것은 금지됩니다:",
        "• 음란물 및 미성년자에 대한 모든 성적 대상화;\n• 협박, 따돌림, 괴롭힘, 폭력 선동과 혐오 조장;\n• 본인 동의 없는 타인의 개인정보;\n• 스팸, 사기, 악성 링크와 파일;\n• 법을 위반하거나 타인의 저작권을 침해하는 것.",
        "법으로 금지되지 않은 성인용 콘텐츠라도 팩에 올릴 때는 반드시 18+ 표시를 해야 합니다.",
      ] },
      { h: "신고와 차단", p: [
        "모든 메시지, 사용자, 채널, 팩을 신고할 수 있습니다: 메시지 메뉴 또는 사용자 카드 → ‘신고’. 신고는 운영자가 24시간 이내에 검토하며, 규칙을 위반한 콘텐츠는 삭제되고 작성자는 접근 권한을 잃습니다.",
        "어떤 사용자든 그 사용자의 카드에서 차단할 수 있습니다. 차단하면 그 사용자의 메시지와 알림이 즉시 오지 않습니다. 차단 목록은 ‘프로필 → 개인정보’에 있습니다.",
      ] },
      { h: "이용자의 콘텐츠", p: [
        "이용자가 보내는 모든 것은 이용자의 것으로 남습니다. 이용자는 저희가 메신저 운영만을 위해 이를 보관하고 받는 사람에게 전달하는 것을 허락합니다. 내용에 대한 책임은 보낸 사람에게 있습니다.",
      ] },
      { h: "계정", p: [
        "비밀번호는 남에게 알리지 말고 안전하게 관리해 주세요. 비밀번호는 ‘프로필 → 개인정보 → 복구 이메일’에서 미리 이메일을 연결해 둔 경우에만 이메일로 복구할 수 있습니다. 계정과 모든 데이터는 ‘프로필 → 개인정보 → 계정 삭제’에서 삭제할 수 있습니다.",
        "이 규칙을 위반한 계정은 저희가 이용을 제한하거나 삭제할 수 있습니다.",
      ] },
      { h: "보증 없음", p: [
        "앱은 ‘있는 그대로’ 제공됩니다. 앱이 잘 작동하도록 노력하지만, 중단 없는 서비스를 약속하지 않으며 데이터 손실에 대해 책임지지 않습니다.",
      ] },
      { h: "문의", p: [`문의 및 신고: ${mail}`] },
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
        "• Аккаунт: логин, пароль (только в виде хеша), никнейм, описание, аватар и обложку. Телефон и список контактов не запрашиваем.",
        "• Почту для восстановления пароля — только если вы сами её привязали, это необязательно. На неё приходят лишь письма с одноразовым кодом: подтвердить адрес и сбросить пароль. Рассылок не шлём, другим пользователям почту не показываем.",
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
        "• Почтовому сервису Resend — адрес и одноразовый код, когда вы привязываете почту или сбрасываете пароль.",
        "• Сервису перевода — текст сообщения, поста или расшифровки голосового, когда вы просите перевод или вы либо собеседник включили автоперевод: языковой модели через OpenRouter, а если она недоступна — нашему собственному серверу перевода. Перевод хранится вместе с сообщением. Секретные чаты не переводятся.",
        "• Модераторам — содержимое, на которое подана жалоба.",
        "• Государственным органам — только по требованию закона.",
      ] },
      { h: "Сколько хранится и как удалить", p: [
        "Данные хранятся, пока существует аккаунт. Сообщение можно удалить у себя или у всех. Аккаунт удаляется в приложении: «Профиль → Конфиденциальность → Удалить аккаунт». Вместе с ним сразу удаляются профиль, ваши сообщения, личные чаты, каналы, паки и токены уведомлений; вложения в облачном хранилище становятся недоступны сразу и стираются в течение 30 дней.",
        "Почта хранится, пока вы её не отвяжете («Профиль → Конфиденциальность → Почта для восстановления») или не удалите аккаунт. Одноразовые коды действуют 15 минут и удаляются после использования и при отвязке почты.",
        `Если войти в приложение не получается, напишите на ${mail} — удалим по запросу.`,
      ] },
      { h: "Безопасность", p: [
        "Соединение с сервером идёт по HTTPS, пароли хранятся в виде хеша, фото, видео и файлы — в закрытом хранилище. Аватары, обложки, стикеры, звуки и голосовые открываются по прямой ссылке со случайным именем, которую получают участники переписки. Обычные чаты, группы и каналы не шифруются сквозным шифрованием: сообщения хранятся на сервере, чтобы переписка была на всех ваших устройствах. Секретные чаты шифруются сквозным шифрованием: сообщения и вложения шифруются на устройстве, ключи есть только у собеседников, а сервер хранит лишь шифротекст и знает, кто, кому и когда написал. Выход из аккаунта стирает ключи секретных чатов на этом устройстве.",
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
        "• Account: login, password (hash only), nickname, bio, avatar and cover image. We do not ask for a phone number or contacts.",
        "• A recovery email — only if you add one yourself; it is optional. It receives only one-time code emails: to confirm the address and to reset your password. We send no newsletters and never show your email to other users.",
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
        "• Resend, an email delivery service — your address and a one-time code when you add an email or reset your password.",
        "• A translation service — the text of a message, post or voice transcript when you ask for a translation or when you or the other person turn on auto-translation: a language model via OpenRouter or, if it is unavailable, our own translation server. The translation is stored with the message. Secret chats are never translated.",
        "• Moderators — content that has been reported.",
        "• Authorities — only when required by law.",
      ] },
      { h: "Retention and deletion", p: [
        "Data is kept while the account exists. You can delete a message for yourself or for everyone. You can delete the account in the app: Profile → Privacy → Delete account. This immediately removes your profile, your messages, direct chats, channels, packs and notification tokens; attachments in cloud storage become inaccessible at once and are erased within 30 days.",
        "Your recovery email is kept until you remove it (Profile → Privacy → Recovery email) or delete the account. One-time codes are valid for 15 minutes and are deleted once used or when you remove the email.",
        `If you cannot sign in, email ${mail} and we will delete the account on request.`,
      ] },
      { h: "Security", p: [
        "Traffic to the server uses HTTPS, passwords are stored hashed, and photos, videos and files sit in private storage. Avatars, covers, stickers, sounds and voice messages are served by a direct link with a random name that conversation members receive. Regular chats, groups and channels are not end-to-end encrypted: messages are stored on the server so your conversations are available on all your devices. Secret chats are end-to-end encrypted: messages and attachments are encrypted on the device, only the participants hold the keys, and the server keeps only ciphertext plus who wrote to whom and when. Signing out erases the secret-chat keys on that device.",
      ] },
      { h: "Children", p: [
        "The app is not intended for anyone under 17 and we do not knowingly collect their data.",
      ] },
      { h: "Changes and contact", p: [
        `We will announce material changes in the app. Data questions: ${mail}`,
      ] },
    ],
  },
  ko: {
    title: "개인정보 처리방침",
    updated: `최종 수정일: ${LEGAL_UPDATED}`,
    intro: `이 문서는 ${APP_NAME}가 어떤 데이터를 수집하는지, 왜 수집하는지, 어떻게 삭제할 수 있는지 설명합니다. 앱에는 광고, 분석 도구, 외부 추적기가 없으며, 데이터를 판매하거나 광고 목적으로 제공하지 않습니다.`,
    sections: [
      { h: "보관하는 데이터", p: [
        "• 계정: 아이디, 비밀번호(해시 형태로만), 닉네임, 소개, 아바타, 커버 이미지. 전화번호와 연락처 목록은 요청하지 않습니다.",
        "• 비밀번호 복구용 이메일: 이용자가 직접 연결한 경우에만 보관하며, 선택 사항입니다. 이 주소로는 주소 확인과 비밀번호 재설정을 위한 일회용 코드 메일만 보냅니다. 뉴스레터는 보내지 않으며, 다른 이용자에게 이메일을 보여 주지 않습니다.",
        "• 대화: 메시지, 사진, 동영상, 파일, 음성 메시지와 그 받아쓰기, 반응, 채널의 글과 댓글. 음성 받아쓰기는 저희 서버에서 처리하며, 오디오를 외부 서비스에 보내지 않습니다.",
        "• 이용자가 만든 스티커 팩과 사운드 팩, 저장한 이미지, 차단 목록.",
        "• 알림용 기기 토큰과 가입일.",
        "• 이용자가 보낸 경우, 신고와 버그 리포트: 설명, 스크린샷, 세션의 기술 로그. 로그에는 메시지 본문과 토큰이 들어가지 않습니다.",
      ] },
      { h: "기기 접근 권한", p: [
        "카메라, 마이크, 사진은 이용자가 직접 촬영하거나, 녹음·녹화하거나, 통화하거나, 파일을 첨부할 때만 사용됩니다. 통화는 기기 사이에서 직접 연결되거나 저희 중계 서버를 거치며, 녹음되지 않습니다.",
      ] },
      { h: "데이터를 제공받는 곳", p: [
        "• 이용자 메시지의 수신자와 이용자 채널의 구독자.",
        "• Apple(APNs)과 Google(Firebase Cloud Messaging)의 알림 전송 서비스: 기기 토큰과 암호화된 알림 내용이 전달되며, 이 내용은 이용자의 기기에서만 복호화할 수 있습니다.",
        "• 클라우드 저장소 Yandex Object Storage: 대화 속 사진, 동영상, 파일이 이곳에 보관되며, 권한을 확인한 뒤 임시 링크로 접근할 수 있습니다.",
        "• 이메일 발송 서비스 Resend: 이메일을 연결하거나 비밀번호를 재설정할 때 주소와 일회용 코드가 전달됩니다.",
        "• 번역 서비스: 이용자가 번역을 요청하거나 이용자 또는 상대방이 자동 번역을 켠 경우 메시지, 게시물, 음성 받아쓰기의 텍스트가 전달됩니다. OpenRouter를 통한 언어 모델을 사용하며, 이용할 수 없을 때는 저희 자체 번역 서버를 사용합니다. 번역 결과는 메시지와 함께 보관됩니다. 비밀 채팅은 번역하지 않습니다.",
        "• 운영자: 신고된 콘텐츠.",
        "• 정부 기관: 법률에 따라 요구되는 경우에만.",
      ] },
      { h: "보관 기간과 삭제 방법", p: [
        "데이터는 계정이 있는 동안 보관됩니다. 메시지는 나에게서만 또는 모두에게서 삭제할 수 있습니다. 계정은 앱의 ‘프로필 → 개인정보 → 계정 삭제’에서 삭제합니다. 계정을 삭제하면 프로필, 이용자의 메시지, 개인 채팅, 채널, 팩, 알림 토큰이 즉시 함께 삭제되며, 클라우드 저장소의 첨부 파일은 즉시 접근할 수 없게 되고 30일 이내에 완전히 지워집니다.",
        "복구 이메일은 이용자가 연결을 해제하거나(‘프로필 → 개인정보 → 복구 이메일’) 계정을 삭제할 때까지 보관됩니다. 일회용 코드는 15분 동안 유효하며, 사용하거나 이메일 연결을 해제하면 삭제됩니다.",
        `앱에 로그인할 수 없다면 ${mail}로 연락해 주세요. 요청에 따라 계정을 삭제해 드립니다.`,
      ] },
      { h: "보안", p: [
        "서버와의 연결에는 HTTPS를 사용하고, 비밀번호는 해시 형태로, 사진·동영상·파일은 비공개 저장소에 보관합니다. 아바타, 커버, 스티커, 소리, 음성 메시지는 무작위 이름을 가진 직접 링크로 열리며, 이 링크는 대화 참여자가 받습니다. 일반 채팅, 그룹, 채널에는 종단간 암호화가 적용되지 않으며, 모든 기기에서 대화를 볼 수 있도록 메시지를 서버에 보관합니다. 비밀 채팅에는 종단간 암호화가 적용됩니다. 메시지와 첨부 파일은 기기에서 암호화되고, 키는 대화 참여자만 가지며, 서버에는 암호문과 누가 누구에게 언제 보냈는지만 남습니다. 로그아웃하면 해당 기기의 비밀 채팅 키가 삭제됩니다.",
      ] },
      { h: "아동", p: [
        "앱은 17세 미만을 대상으로 하지 않으며, 저희는 17세 미만 이용자의 데이터를 고의로 수집하지 않습니다.",
      ] },
      { h: "변경 및 문의", p: [
        `처리방침에 중요한 변경이 있으면 앱에서 알려 드립니다. 데이터 관련 문의: ${mail}`,
      ] },
    ],
  },
};

/** Кнопка языка: подпись и aria-label — на том языке, на который переключаем. */
const SWITCH: Record<Lang, { code: string; label: string }> = {
  ru: { code: "RU", label: "Переключить на русский" },
  en: { code: "EN", label: "Switch to English" },
  ko: { code: "KO", label: "한국어로 보기" },
};

/**
 * Правила и политика конфиденциальности. Страницы публичные (без входа):
 * на них ведут экран регистрации, профиль и карточка приложения в сторах.
 * Текст — на языке интерфейса; кнопка переключает на английский (ревьюер
 * стора читает по-английски), а с английского интерфейса — на русский.
 */
export const LegalView = ({ kind: initial, onClose }: { kind: LegalKind; onClose: () => void }) => {
  // Переход между двумя документами — внутри, без маршрутов: тот же экран
  // открывается шторкой поверх регистрации, и уход по ссылке сбросил бы форму.
  const [kind, setKind] = useState<LegalKind>(initial);
  const home: Lang = getLang();
  const [lang, setLang] = useState<Lang>(home);
  const next: Lang = lang !== home ? home : home === "en" ? "ru" : "en";
  const doc = (kind === "terms" ? TERMS : PRIVACY)[lang];

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title={doc.title}
        onBack={onClose}
        right={
          <button
            type="button"
            onClick={() => setLang(next)}
            className="w-10 h-10 flex items-center justify-center text-small font-semibold text-primary active:opacity-60"
            aria-label={SWITCH[next].label}
          >
            {SWITCH[next].code}
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
