/** Это устройство (lib/secret.deviceId хранит его в localStorage). Сервер по
 *  нему не будет слать отбой звонка на телефон, который сам ответил, а
 *  остальным устройствам скажет «принят на другом устройстве». */
export function myDeviceId(): string | undefined {
  try { return localStorage.getItem("hyax:device-id") || undefined; } catch { return undefined; }
}
