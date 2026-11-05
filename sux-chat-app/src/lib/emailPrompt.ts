import { api, type Profile } from "@/api/client";
import { readCache, writeCache } from "@/lib/session-cache";

/**
 * Предложение привязать почту (восстановление пароля) тем, у кого её нет:
 * последним шагом онбординга, а кто его уже прошёл — окном после входа
 * (EmailPrompt). Показываем один раз за вход на устройстве: «Позже» — до
 * следующего входа; «Больше не показывать» — навсегда и на всех устройствах
 * (Profile.email_prompt_off).
 */
const SHOWN = "hyax:email-prompt-shown";

const shownThisLogin = () => { try { return localStorage.getItem(SHOWN) === "1"; } catch { return true; } };

/** Предлагать ли сейчас: почты нет, не отказались насовсем, в этот вход ещё не показывали. */
export const emailPromptWanted = (me: Partial<Profile> | null | undefined) =>
  !!me?.id && !me.email_verified && !me.email_prompt_off && !shownThisLogin();

export const markEmailPromptShown = () => { try { localStorage.setItem(SHOWN, "1"); } catch { /* приватный режим */ } };

/** Новый вход — можно предложить снова (если не отказались насовсем). */
export const resetEmailPromptForLogin = () => { try { localStorage.removeItem(SHOWN); } catch { /* ок */ } };

/** «Больше не показывать» — в профиль (настройка аккаунта). */
export async function emailPromptOff(me: Partial<Profile> | null | undefined): Promise<void> {
  markEmailPromptShown();
  if (!me?.id) return;
  writeCache("user", { ...(readCache<object>("user") || {}), email_prompt_off: true });
  try { await api.updateProfile(me.id, { email_prompt_off: true }); } catch { /* не вышло — в этот вход всё равно не покажем */ }
}
