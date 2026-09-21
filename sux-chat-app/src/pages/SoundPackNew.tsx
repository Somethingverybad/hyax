import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Image as ImageIcon, Music2, Plus, X } from "lucide-react";
import ScreenHeader from "@/components/ScreenHeader";
import { SettingsCard } from "@/components/settings";
import { api } from "@/api/client";
import { packCover } from "@/lib/packCover";
import { shareSoundPack } from "@/lib/share";
import { syncNotificationSounds } from "@/lib/notificationSounds";

/**
 * Свой пак звуков прямо в приложении: название, обложка и файлы. Раньше пак
 * можно было собрать только в студии на сайте — с телефона это значило уйти в
 * браузер и заново войти.
 */
const SoundPackNew = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<{ file: File; title: string }[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const soundInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...list].map((file) => ({ file, title: file.name.replace(/\.[^.]+$/, "").slice(0, 64) }));
    setFiles((prev) => [...prev, ...next].slice(0, 50));
  };

  const pickCover = (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setCover(f);
    setCoverUrl(URL.createObjectURL(f));
  };

  const create = async () => {
    if (!name.trim()) { toast.error("Придумайте название пака"); return; }
    if (!files.length) { toast.error("Добавьте хотя бы один звук"); return; }
    setBusy(true);
    try {
      const pack = await api.createSoundPack(name.trim(), files);
      if (cover) await api.setSoundPackCover(pack.id, cover).catch(() => toast.error("Пак создан, но обложка не загрузилась"));
      // Каталог изменился — докачиваем файлы на устройстве.
      void syncNotificationSounds().catch(() => {});
      toast.success("Пак создан");
      navigate(`/sp/${pack.id}`, { replace: true });
      void shareSoundPack(pack.name, pack.id);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось создать пак");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <ScreenHeader
        title="Новый пак звуков"
        right={
          <button type="button" onClick={create} disabled={busy} className="px-3 h-10 text-body font-semibold text-primary disabled:opacity-50">
            {busy ? "…" : "Создать"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            className="ui-card w-20 h-20 rounded-lg overflow-hidden shrink-0 bg-surface-3"
            aria-label="Обложка пака"
          >
            <img src={coverUrl || packCover(null)} alt="" className="w-full h-full object-cover" />
          </button>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 64))}
              placeholder="Название пака"
              className="w-full h-11 px-3 rounded-md bg-surface-2 border border-border text-body outline-none focus:border-amber"
            />
            <p className="text-caption text-subtle flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" /> {cover ? "Обложка выбрана" : "Обложка необязательна — подставим свою"}
            </p>
          </div>
        </div>
        <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => pickCover(e.target.files)} />
        <input ref={soundInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.caf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

        <button
          type="button"
          onClick={() => soundInput.current?.click()}
          className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 active:opacity-90"
        >
          <Plus className="w-5 h-5" /> Добавить звуки
        </button>

        {files.length > 0 && (
          <SettingsCard>
            {files.map((f, i) => (
              <div key={`${f.file.name}-${i}`} className="px-4 py-2.5 flex items-center gap-3">
                <Music2 className="w-5 h-5 text-primary shrink-0" />
                <input
                  value={f.title}
                  onChange={(e) => setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value.slice(0, 64) } : x)))}
                  className="flex-1 min-w-0 h-9 px-2 rounded-md bg-surface-3 border border-transparent text-body outline-none focus:border-amber"
                  aria-label="Название звука"
                />
                <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="p-1.5 text-subtle active:opacity-60" aria-label="Убрать">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </SettingsCard>
        )}

        <p className="px-1 text-caption text-subtle">
          Названия звуков видят те, кто добавит пак. После создания появится ссылка — по ней пак ставят себе одним нажатием.
        </p>
      </div>
    </div>
  );
};

export default SoundPackNew;
