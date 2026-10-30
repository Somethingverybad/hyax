import { Check } from "lucide-react";
import { getLang } from "@/lib/i18n";
import { coatSwatch, type PetPack } from "@/lib/pets";
import { cn } from "@/lib/utils";

/** Кружки окрасов пака: ровной сеткой во всю ширину (без одинокого кружка
 *  во втором ряду), выбранный — с тёмной обводкой и галочкой: салатовую
 *  обводку на светлом фоне было почти не видно. */
export default function CoatSwatches({ pack, value, onPick }: { pack: PetPack; value: string; onPick: (id: string) => void }) {
  const lang = getLang();
  return (
    <div className="grid gap-2 justify-items-center" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))" }}>
      {Object.entries(pack.coats || {}).map(([id, coat]) => {
        const sw = coatSwatch(pack, id);
        const on = value === id;
        const label = coat.name[lang] || coat.name.ru || id;
        return (
          <button key={id} type="button" onClick={() => onPick(id)} aria-label={label} title={label} aria-pressed={on}
            className={cn("w-9 h-9 rounded-full grid place-items-center transition-transform active:scale-95", on && "ring-2 ring-foreground/80 ring-offset-2 ring-offset-background")}
            style={{ background: sw.fur, boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,.18)" }}>
            {on
              ? <span className="w-5 h-5 rounded-full bg-black/45 grid place-items-center"><Check className="w-3.5 h-3.5 text-white" strokeWidth={3} /></span>
              : <span className="w-3 h-3 rounded-full" style={{ background: sw.tip }} />}
          </button>
        );
      })}
    </div>
  );
}
