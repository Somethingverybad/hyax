/**
 * Супрематические фигуры на форме входа: красные, чёрные и зелёные полосы и
 * квадраты по углам. Медленно плывут и покачиваются — движение задано только
 * трансформами, их считает композитор, раскладку это не трогает.
 *
 * Цвета берутся из темы (акцент, «тушь», входящие сообщения), поэтому фигуры
 * попадают в любую тему, включая пользовательскую.
 */
const SuprematistBackdrop = () => (
  <div className="supra-bg pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
    {/* Левый верх: красная полоса, чёрная плашка, зелёный квадрат, тонкая линия */}
    <span className="supra-shape supra-a" />
    <span className="supra-shape supra-b" />
    <span className="supra-shape supra-c" />
    <span className="supra-shape supra-line" />
    {/* Правый низ: чёрный квадрат и красный клин */}
    <span className="supra-shape supra-d" />
    <span className="supra-shape supra-e" />
  </div>
);

export default SuprematistBackdrop;
