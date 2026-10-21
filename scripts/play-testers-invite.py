"""Письмо тестировщикам закрытого теста Google Play — через Resend (chat/mailer.py).

На сервере:  docker exec -i sux_chat_api python - < scripts/play-testers-invite.py addr1 addr2 …
Без адресов — печатает HTML в stdout (посмотреть в браузере).
Стиль — сайт wyx.su (nginx/wyx-site/style.css, тёмная тема).
"""
import sys
from html import escape

WEB = "https://play.google.com/apps/testing/com.hyax.messenger"
PLAY = "https://play.google.com/store/apps/details?id=com.hyax.messenger"
FEEDBACK = "trapitsalife@gmail.com"
SUBJECT = "Вы приглашены в закрытое тестирование WYX для Android"

TEXT = f"""Вы приглашены в закрытое тестирование WYX для Android.

WYX готовится к публикации в Google Play. Перед выходом приложение проходит закрытое тестирование, и ваш адрес добавлен в список участников.

Как присоединиться:
1. Откройте ссылку под тем Google-аккаунтом, на который пришло это письмо: {WEB}
2. Нажмите «Стать тестировщиком».
3. Установите WYX из Google Play: {PLAY}
   Если приложение пока недоступно — подождите несколько минут и обновите страницу.

Важно: тестирование длится 14 дней. Пожалуйста, не удаляйте приложение и не выходите из теста в этот период.

Если у вас уже установлена версия с сайта, версия из Google Play обновит её — переписка сохранится.

Замечания и ошибки: {FEEDBACK} или в приложении — Настройки → Сообщить об ошибке.
"""

def html():
    # По макету design/image copy 3.png: глубокий тёмно-зелёный фон, центр —
    # иконка и WYX, справа слоган, стеклянная карточка, лаймовый акцент.
    LIME, BG, CARD, SUB, TXT, LINE = "#CFFA55", "#0C1F15", "#14271C", "#9BA79C", "#FFFFFF", "rgba(255,255,255,.08)"
    def step(n, title, body, last=False):
        return (f'<tr><td style="width:44px;vertical-align:top;padding:0;">'
                f'<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:32px;height:32px;border-radius:50%;background:#1F3A2A;color:{LIME};'
                f'font-weight:700;font-size:14px;text-align:center;vertical-align:middle;">{n}</td></tr>'
                + ('' if last else f'<tr><td style="height:34px;"><div style="width:2px;height:34px;margin:0 auto;background:{LINE};"></div></td></tr>')
                + f'</table></td>'
                f'<td style="vertical-align:top;padding:4px 0 {"0" if last else "18px"} 8px;">'
                f'<div style="font-size:16px;font-weight:700;color:{TXT};line-height:22px;">{title}</div>'
                f'<div style="font-size:14px;color:{SUB};line-height:21px;margin-top:4px;">{body}</div></td></tr>')
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>{escape(SUBJECT)}</title></head>
<body bgcolor="{BG}" style="margin:0;padding:0;background:{BG};font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(60% 40% at 15% 10%,#1E3B27 0%,rgba(30,59,39,0) 70%),radial-gradient(50% 35% at 90% 80%,#1A3524 0%,rgba(26,53,36,0) 70%),linear-gradient(160deg,#0C1F15 0%,#152A1C 100%);background-color:{BG};">
<tr><td align="center" style="padding:40px 16px 48px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;">
  <tr><td>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{CARD}" style="background:{CARD};background-color:{CARD};border-radius:28px;border:1px solid rgba(255,255,255,.06);">
    <tr><td style="padding:36px 32px 32px;">
      <img src="https://wyx.su/apple-touch-icon.png" width="84" height="84" alt="WYX" style="display:block;border-radius:22px;margin:0 auto 14px;">
      <div style="font-size:30px;font-weight:800;letter-spacing:.06em;color:{TXT};line-height:34px;text-align:center;">WYX</div>
      <div style="width:28px;height:2px;background:{LIME};margin:14px auto 26px;"></div>
      <div align="center"><span style="display:inline-block;padding:7px 14px;border-radius:999px;background:{LIME};color:#0C1F15;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Закрытое тестирование · Android</span></div>
      <h1 style="margin:22px 0 12px;font-size:30px;line-height:36px;font-weight:800;color:{TXT};text-align:center;">Вы приглашены в WYX!</h1>
      <p style="margin:0 auto 26px;max-width:460px;font-size:16px;line-height:25px;color:{SUB};text-align:center;">WYX готовится к публикации в Google Play. Перед выходом приложение проходит закрытое тестирование, и вы добавлены в список участников.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td>
        <a href="{WEB}" style="display:block;padding:18px 24px;border-radius:18px;background:{LIME};color:#0C1F15;font-size:17px;font-weight:800;text-decoration:none;text-align:left;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="color:#0C1F15;font-size:17px;font-weight:800;">Стать тестировщиком</td><td align="right" style="color:#0C1F15;font-size:20px;font-weight:800;">&rarr;</td></tr></table>
        </a>
      </td></tr></table>
      <p style="margin:16px 0 0;text-align:center;font-size:14px;line-height:20px;"><span style="color:{LIME};font-size:12px;">&#9654;</span>&nbsp; <a href="{PLAY}" style="color:{LIME};text-decoration:underline;">Открыть в Google Play</a> <span style="color:{LIME};">&#8599;</span></p>
      <div style="height:1px;background:{LINE};margin:28px 0;"></div>
      <div style="font-size:19px;font-weight:800;color:{TXT};text-align:center;margin-bottom:22px;">Как присоединиться</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        {step(1, "Примите приглашение", "Откройте ссылку с того Google-аккаунта, на который пришло это письмо, и нажмите «Стать тестировщиком».")}
        {step(2, "Установите WYX", "После принятия приглашения установите приложение из Google Play. Если оно пока недоступно — подождите несколько минут и обновите страницу.")}
        {step(3, "Оставайтесь с нами 14 дней", "Не удаляйте приложение и не выходите из программы тестирования в течение этого периода.", last=True)}
      </table>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;background:rgba(255,255,255,.04);border-radius:16px;"><tr>
        <td style="width:52px;padding:16px 0 16px 16px;vertical-align:top;"><div style="width:28px;height:28px;border-radius:50%;background:#2A3F32;color:{SUB};font-weight:700;font-size:14px;text-align:center;line-height:28px;font-family:Georgia,serif;">i</div></td>
        <td style="padding:16px 16px 16px 8px;font-size:14px;line-height:21px;color:{SUB};">Если у вас уже установлена версия с сайта, версия из Google Play обновит её — переписка сохранится.</td>
      </tr></table>
      <div style="height:1px;background:{LINE};margin:28px 0 22px;"></div>
      <p style="margin:0;text-align:center;font-size:13px;line-height:21px;color:{SUB};">Вопросы или нашли ошибку? Напишите на <a href="mailto:{FEEDBACK}" style="color:{LIME};text-decoration:underline;">{FEEDBACK}</a>.<br>
      <a href="https://wyx.su" style="color:{LIME};text-decoration:underline;">wyx.su</a> &nbsp;·&nbsp; <a href="https://wyx.su/privacy" style="color:{LIME};text-decoration:underline;">Конфиденциальность</a></p>
    </td></tr></table>
  </td></tr>
</table></td></tr></table></body></html>"""

if __name__ == "__main__":
    addrs = sys.argv[1:]
    if not addrs:
        print(html()); sys.exit(0)
    import django, os
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "sux_chat.settings"); django.setup()
    from chat.mailer import send_email
    for a in addrs:
        try:
            send_email(a, SUBJECT, TEXT, html()); print("ok", a)
        except Exception as e:
            print("FAIL", a, type(e).__name__, str(e)[:120])
