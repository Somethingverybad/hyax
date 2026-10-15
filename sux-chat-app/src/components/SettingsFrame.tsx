import { Outlet } from "react-router-dom";

/**
 * Экраны настроек на широком окне (веб, компьютер) — колонкой по центру,
 * а не во всю ширину: строки по полторы тысячи пикселей читать неудобно.
 * На телефоне ничего не меняется (см. .settings-frame в index.css).
 */
export default function SettingsFrame() {
  return (
    <div className="settings-frame">
      <Outlet />
    </div>
  );
}
