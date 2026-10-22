import { Navigate, useParams } from "react-router-dom";

/** Ссылка на эфир wyx.su/air/<id>: открываем «Музыку» на этом эфире (pages/Music). */
export default function AirLink() {
  const { id } = useParams();
  return <Navigate to="/music" replace state={{ stationId: id }} />;
}
