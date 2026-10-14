/** Первый запуск: онбординг (язык → тема → аура). Флаг и выбранная аура до
 *  входа лежат в localStorage; аура применяется к профилю после входа. */
const DONE = "hyax:onboarded";
const AURA = "hyax:pending-aura";

export function onboardingDone(): boolean { try { return localStorage.getItem(DONE) === "1"; } catch { return true; } }
export function markOnboarded() { try { localStorage.setItem(DONE, "1"); } catch { /* ок */ } }
export function setPendingAura(color: string) { try { localStorage.setItem(AURA, color); } catch { /* ок */ } }

/** После входа или регистрации: аура из онбординга — в профиль, один раз. */
export async function applyPendingAura(): Promise<void> {
  let color = "";
  try { color = localStorage.getItem(AURA) || ""; } catch { return; }
  if (!color) return;
  try {
    const { api } = await import("@/api/client");
    const me = await api.getProfile();
    if (me?.id && !(me as { aura_color?: string }).aura_color) await api.updateProfile(me.id, { aura_color: color });
  } catch { /* не вышло — оставим на следующий раз */ return; }
  try { localStorage.removeItem(AURA); } catch { /* ок */ }
}
