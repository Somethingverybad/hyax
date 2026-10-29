// Внешний вид питомца для превью вне приложения — ровно то же, что делает
// sux-chat-app/src/lib/pets.ts: перекраска по палитре (recolor), надетые
// украшения (wornAccessories) и вырезание чужих слоёв acc:/sex: (filterLayers).
// Подключается обычным <script> (превью из набора Студии) и в render-sheet.mjs.
(function (root) {
  function hexRgb(h) {
    const n = parseInt(String(h).replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function recolor(data, pack, coat) {
    const c = coat && pack.coats && pack.coats[coat];
    const pal = pack.palette;
    if (!c || !pal) return data;
    const pairs = Object.entries(c.colors || {}).filter(([s]) => pal[s]).map(([s, to]) => [hexRgb(pal[s]), hexRgb(to)]);
    if (!pairs.length) return data;
    const same = (a, b) => Math.abs(a[0] - b[0]) < 0.0015 && Math.abs(a[1] - b[1]) < 0.0015 && Math.abs(a[2] - b[2]) < 0.0015;
    const walk = (o) => {
      if (Array.isArray(o)) return o.map(walk);
      if (!o || typeof o !== "object") return o;
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = walk(v);
      if (r.ty === "fl" || r.ty === "st") {
        const cc = r.c;
        if (cc && !cc.a && Array.isArray(cc.k)) {
          const hit = pairs.find(([f]) => same(cc.k, f));
          if (hit) r.c = { ...cc, k: [...hit[1], cc.k[3] ?? 1] };
        }
      }
      return r;
    };
    return walk(data);
  }

  function wornAccessories(pack, look) {
    const all = pack.accessories || {};
    const sex = look.sex || "m";
    const fits = (id) => { const a = all[id]; return !!a && (!a.sex || a.sex.includes(sex)); };
    const list = look.acc ?? Object.keys(all).filter((id) => all[id].default);
    const bySlot = new Map();
    for (const id of list) if (fits(id)) bySlot.set(all[id].slot, id);
    return [...bySlot.values()];
  }

  function filterLayers(data, worn, sex) {
    const keep = (nm) => {
      if (typeof nm !== "string") return true;
      if (nm.startsWith("acc:")) return worn.includes(nm.slice(4));
      if (nm.startsWith("sex:")) return nm.slice(4) === sex;
      return true;
    };
    const walk = (o) => {
      if (Array.isArray(o)) return o.filter((x) => !(x && typeof x === "object" && "nm" in x && !keep(x.nm))).map(walk);
      if (!o || typeof o !== "object") return o;
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = walk(v);
      return r;
    };
    return walk(data);
  }

  /** Поза в нужном виде: { coat, sex, acc } (acc: null — украшения по умолчанию для пола). */
  function shapePet(data, pack, look) {
    const sex = look.sex || "m";
    const d = (pack.format || 1) >= 2 ? filterLayers(data, wornAccessories(pack, look), sex) : data;
    return look.coat ? recolor(d, pack, look.coat) : d;
  }

  root.PetLook = { recolor, wornAccessories, filterLayers, shapePet };
})(typeof window !== "undefined" ? window : globalThis);
