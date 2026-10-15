/**
 * Камера для звонка (браузер и компьютер; в приложении камерой владеет
 * нативный движок). На телефоне камера выбирается по стороне — передняя или
 * задняя, на компьютере — по списку устройств: их может быть несколько.
 */
export async function openCallCamera(o: { front: boolean; deviceIdx: number }): Promise<{ stream: MediaStream; front: boolean; canFlip: boolean }> {
  const devices = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
  const cams = devices.filter((d) => d.kind === "videoinput");
  const byDevice = cams.length > 1 && cams.every((c) => c.label) && !/android|iphone|ipad/i.test(navigator.userAgent);
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  if (byDevice) video.deviceId = { exact: cams[o.deviceIdx % cams.length].deviceId };
  else video.facingMode = o.front ? "user" : "environment";
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  // Список с названиями камер есть только после разрешения — пересчитываем.
  const after = (await navigator.mediaDevices.enumerateDevices?.().catch(() => [])) || [];
  const canFlip = after.filter((d) => d.kind === "videoinput").length > 1;
  let front = o.front;
  if (byDevice) {
    const label = stream.getVideoTracks()[0]?.label || "";
    front = !/back|rear|environment|задн/i.test(label);
  }
  return { stream, front, canFlip };
}
