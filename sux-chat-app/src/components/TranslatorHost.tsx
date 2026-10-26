import { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, Languages } from "lucide-react";
import { toast } from "sonner";
import { api, type LiveTextResult } from "@/api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { writeClipboard } from "@/lib/clipboard";
import { getLang, t } from "@/lib/i18n";
import { LIVE_LANGS, langName } from "@/lib/live/languages";
import { onTranslator, openTranslator } from "@/lib/translator";

const FROM_KEY = "hyax:translator-from";
const OTHER_KEY = "hyax:translator-other";
const readPref = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const writePref = (key: string, value: string) => {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* без памяти — не страшно */ }
};

/**
 * Переводчик вставленного текста — окно поверх приложения (lib/translator).
 * Направление само: текст на чужом языке — на мой, на моём — на язык
 * собеседника. Если язык текста определился неверно (испанский принят за
 * английский, украинский — за русский), его можно закрепить.
 */
const TranslatorHost = () => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<LiveTextResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(() => readPref(FROM_KEY));
  const [other, setOther] = useState(() => readPref(OTHER_KEY) || (getLang() === "en" ? "ru" : "en"));
  // Перевод зовут и из подписок (хоткей), где состояние было бы старым.
  const prefs = useRef({ from, other });
  prefs.current = { from, other };
  const seq = useRef(0);

  const run = async (value: string) => {
    const q = value.trim();
    if (!q) return;
    const id = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const r = await api.liveText({ text: q, to: getLang(), other: prefs.current.other, from: prefs.current.from || undefined });
      if (id === seq.current) setResult(r);
    } catch (e) {
      if (id === seq.current) {
        setResult(null);
        setError(e instanceof Error ? e.message : t("Не удалось перевести"));
      }
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  useEffect(() => onTranslator((value) => {
    setOpen(true);
    if (value?.trim()) {
      setText(value);
      void run(value);
    }
  }), []);
  // Компьютер: ⌘/Ctrl+Shift+Y — перевести то, что в буфере обмена.
  useEffect(() => window.electronAPI?.onTranslateClipboard?.((value) => openTranslator(value)), []);

  const setLangPref = (key: string, value: string, set: (v: string) => void) => {
    set(value);
    writePref(key, value);
    prefs.current = { ...prefs.current, [key === FROM_KEY ? "from" : "other"]: value };
    if (text.trim()) void run(text);
  };

  const copy = async () => {
    if (!result) return;
    await writeClipboard(result.translation);
    toast(t("Перевод скопирован"));
  };

  const select = "h-9 w-full rounded-md bg-surface-2 border border-border px-2 text-small";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-primary" />
            {t("Переводчик")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-caption text-subtle">{t("Язык текста")}</span>
              <select className={select} value={from} onChange={(e) => setLangPref(FROM_KEY, e.target.value, setFrom)}>
                <option value="">{t("Определять автоматически")}</option>
                {LIVE_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-caption text-subtle">{t("Язык собеседника")}</span>
              <select className={select} value={other} onChange={(e) => setLangPref(OTHER_KEY, e.target.value, setOther)}>
                {LIVE_LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // Вставили в пустое поле — переводим сразу, без кнопки.
              const pasted = e.clipboardData.getData("text");
              if (!text.trim() && pasted.trim()) void run(pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run(text);
              }
            }}
            placeholder={t("Вставьте или напишите текст: чужой язык переведём на ваш, ваш — на язык собеседника")}
            rows={5}
            className="resize-none"
            autoFocus
          />
          <Button type="button" className="w-full" disabled={busy || !text.trim()} onClick={() => void run(text)}>
            {busy ? t("Перевожу…") : t("Перевести")}
          </Button>
          {error && <p className="text-small text-destructive">{error}</p>}
          {result && !error && (
            <div className="rounded-lg bg-surface-2 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-caption text-subtle">
                <span>{langName(result.from)}</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{langName(result.to)}</span>
              </div>
              <p className="text-body whitespace-pre-wrap break-words select-text">{result.translation}</p>
              <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1.5 text-small text-primary">
                <Copy className="w-4 h-4" />
                {t("Скопировать перевод")}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TranslatorHost;
