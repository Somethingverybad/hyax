// Версия приложения для проверки обновлений. Поднимай её вместе с версией
// сборки (package.json / MARKETING_VERSION) и с version.json на сервере.
export const APP_VERSION = "1.0.8";

/** Номер сборки (число коммитов на момент сборки) — сверяется со страницей
 *  загрузок и с versionCode у Android. */
export const APP_BUILD: string = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "0";
