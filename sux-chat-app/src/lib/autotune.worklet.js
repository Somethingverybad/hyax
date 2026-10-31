/* global sampleRate, registerProcessor, AudioWorkletProcessor */
/**
 * Автотюн в звонке (браузер и компьютер): AudioWorklet, подключается в
 * lib/autotune.ts. Код уходит в worklet строкой (?raw → Blob), поэтому без
 * импортов.
 *
 * Высота голоса — YIN по сигналу, прорежённому до ~12 кГц (дешевле в 16 раз,
 * для основного тона 75–900 Гц этого хватает). Нота — ближайший полутон,
 * держится, пока голос не ушёл от неё дальше чем на 0,65 полутона: так
 * звучит «жёсткий» автотюн — голос ступеньками, без плавания.
 *
 * Сдвиг высоты — TD-PSOLA: зёрна по два периода с окном Ханна берутся с
 * шагом исходного периода, а кладутся с шагом периода нужной ноты. Тембр
 * (форманты) остаётся свой. Глухие звуки и паузы проходят как есть (шаг
 * зёрен одинаковый — окна в сумме дают единицу). Задержка ~40 мс.
 */
class HyaxAutotune extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.N = 16384;
    this.mask = this.N - 1;
    this.inBuf = new Float32Array(this.N);
    this.outBuf = new Float32Array(this.N);
    // Сумма окон в каждой точке: при смене периода зёрна ложатся неровно —
    // делим на неё, и громкость не проседает и не вспухает.
    this.wBuf = new Float32Array(this.N);
    this.nIn = 0;
    const minF = 75;
    const maxF = 900;
    this.pMax = Math.ceil(sr / minF);
    this.L = Math.ceil(2.5 * this.pMax) + 256;
    this.pUnvoiced = Math.round(sr / 200);
    this.sMark = this.pMax;
    this.aMark = 0;
    // Определение высоты.
    this.dec = Math.max(1, Math.round(sr / 12000));
    this.dsr = sr / this.dec;
    this.tauMin = Math.floor(this.dsr / maxF);
    this.tauMax = Math.ceil(this.dsr / minF);
    this.W = Math.max(this.tauMax + 8, Math.round(0.02 * this.dsr));
    this.dsN = 4096;
    this.ds = new Float32Array(this.dsN);
    this.dsPos = 0;
    this.decPhase = 0;
    this.win = new Float32Array(this.W + this.tauMax + 1);
    this.diff = new Float32Array(this.tauMax + 2);
    this.lp = [this.biquad(2400), this.biquad(2400)];
    this.sinceDetect = 0;
    this.hop = 128;
    // Оценки высоты с моментом, к которому они относятся (середина окна):
    // зерно сдвигается по высоте в его собственный момент, а не по самой
    // свежей оценке — речь за 10–15 мс уходит на треть полутона.
    this.hN = 64;
    this.hT = new Float64Array(this.hN).fill(-1e9);
    this.hF = new Float32Array(this.hN);
    this.hPos = 0;
    this.note = null;
    this.lastVoiced = -1e9;
    this.on = true;
    this.port.onmessage = (e) => { if (e.data && typeof e.data.on === "boolean") this.on = e.data.on; };
  }

  /** Фильтр нижних частот (Баттерворт 2-го порядка) перед прореживанием. */
  biquad(fc) {
    const w = (2 * Math.PI * fc) / sampleRate;
    const q = Math.SQRT1_2;
    const a = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + a;
    return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  }

  filt(f, x) {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  }

  /** Основной тон по последним W + tauMax прорежённым отсчётам; 0 — голоса нет. */
  detect() {
    const { W, tauMin, tauMax, win, diff, ds, dsN } = this;
    const n = W + tauMax;
    // Окно — самые свежие W отсчётов, сравниваем с ними же на tau раньше:
    // оценка относится к последним (W + tau) отсчётам, без лишнего запаздывания.
    const base = n - W;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = ds[(this.dsPos - n + i + dsN) % dsN];
      win[i] = v;
      if (i >= base) energy += v * v;
    }
    this.tau = tauMax;
    if (Math.sqrt(energy / W) < 0.006) return 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = base; j < n; j++) {
        const d = win[j] - win[j - tau];
        s += d * d;
      }
      diff[tau] = s;
    }
    // Кумулятивно нормированная разность (YIN, шаг 3).
    let run = 0;
    diff[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      run += diff[tau];
      diff[tau] = run > 0 ? (diff[tau] * tau) / run : 1;
    }
    let best = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (diff[tau] < 0.15) {
        while (tau + 1 < tauMax && diff[tau + 1] < diff[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let m = tauMin;
      for (let tau = tauMin + 1; tau < tauMax; tau++) if (diff[tau] < diff[m]) m = tau;
      if (diff[m] > 0.25) return 0;
      best = m;
    }
    let t = best;
    this.tau = best;
    if (best > 1 && best < tauMax) {
      const a = diff[best - 1];
      const b = diff[best];
      const c = diff[best + 1];
      const den = a - 2 * b + c;
      if (den > 1e-9) t = best + (a - c) / (2 * den);
    }
    return this.dsr / t;
  }

  /** Высота в момент t: медиана трёх ближайших к нему оценок; 0 — голоса нет. */
  pitchAt(t) {
    const { hN, hT, hF } = this;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < hN; i++) {
      const d = Math.abs(hT[i] - t);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > 4 * this.hop) return 0;
    const a = hF[(best - 1 + hN) % hN];
    const b = hF[best];
    const c = hF[(best + 1) % hN];
    // Соседи по кольцу — соседи по времени, кроме стыка новейшей и старейшей.
    const newest = (this.hPos - 1 + hN) % hN;
    const lo = best === (this.hPos % hN) ? b : a;
    const hi = best === newest ? b : c;
    return lo + b + hi - Math.max(lo, b, hi) - Math.min(lo, b, hi);
  }

  /** Нота и коэффициент сдвига для зерна с высотой f. */
  retune(f, t) {
    if (!f) {
      // Пауза дольше 15 мс — следующая фраза выберет ноту заново.
      if (t - this.lastVoiced > 0.015 * sampleRate) this.note = null;
      return 1;
    }
    this.lastVoiced = t;
    const midi = 69 + 12 * Math.log2(f / 440);
    if (this.note === null || Math.abs(midi - this.note) > 0.65) this.note = Math.round(midi);
    const target = 440 * Math.pow(2, (this.note - 69) / 12);
    return Math.min(1.06, Math.max(0.94, target / f));
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    const len = out.length;
    const { mask, inBuf, outBuf, wBuf } = this;
    const start = this.nIn;
    for (let i = 0; i < len; i++) {
      const x = input ? input[i] : 0;
      inBuf[(start + i) & mask] = x;
      const y = this.filt(this.lp[1], this.filt(this.lp[0], x));
      if (++this.decPhase >= this.dec) {
        this.decPhase = 0;
        this.ds[this.dsPos] = y;
        this.dsPos = (this.dsPos + 1) % this.dsN;
      }
    }
    this.nIn = start + len;
    this.sinceDetect += len;
    if (this.sinceDetect >= this.hop) {
      this.sinceDetect = 0;
      const f = this.on ? this.detect() : 0;
      const i = this.hPos % this.hN;
      this.hF[i] = f;
      this.hT[i] = this.nIn - ((this.W + this.tau) / 2) * this.dec;
      this.hPos++;
    }
    const latest = this.hT[(this.hPos - 1 + this.hN) % this.hN];
    // Синтез: метки через P/ratio, у каждой — зерно с ближайшей метки анализа.
    // Метку берём, когда для её момента уже есть оценка высоты.
    while (this.sMark <= latest) {
      const f = this.pitchAt(this.sMark);
      const P = f ? Math.min(this.pMax, Math.max(16, Math.round(sampleRate / f))) : this.pUnvoiced;
      if (this.sMark + 1.5 * P > this.nIn) break;
      const ratio = this.retune(f, this.sMark);
      while (this.aMark + P / 2 < this.sMark) this.aMark += P;
      const ts = Math.round(this.sMark);
      const ta = Math.round(this.aMark);
      const k = Math.PI / P;
      for (let j = -P; j <= P; j++) {
        const w = 0.5 * (1 + Math.cos(k * j));
        const o = (ts + j) & mask;
        outBuf[o] += w * inBuf[(ta + j) & mask];
        wBuf[o] += w;
      }
      this.sMark += P / ratio;
    }
    // Отдаём с задержкой L: к этому месту все зёрна уже сложены.
    const from = start - this.L;
    for (let i = 0; i < len; i++) {
      const pos = from + i;
      if (pos < 0) { out[i] = 0; continue; }
      const idx = pos & mask;
      const w = wBuf[idx];
      out[i] = outBuf[idx] / (w > 0.25 ? w : 0.25);
      outBuf[idx] = 0;
      wBuf[idx] = 0;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor("hyax-autotune", HyaxAutotune);
