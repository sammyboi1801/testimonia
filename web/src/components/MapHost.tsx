import { lazy, Suspense, useEffect, useState } from "react";
import { onOpenMap, type MapRequest } from "../pins";

// Leaflet loads with the first map opened, not with the app
const MapPanel = lazy(() => import("./MapPanel").then((m) => ({ default: m.MapPanel })));

/** Listens for openMap() anywhere in the app and shows the map panel (loaded on first use). */
export function MapHost() {
  const [first, setFirst] = useState<MapRequest | null>(null);
  useEffect(() => {
    return onOpenMap((r) => setFirst((f) => f ?? r)); // unsubscribe on unmount
  }, []);
  if (!first) return null;
  return (
    <Suspense fallback={null}>
      <MapPanel initial={first} />
    </Suspense>
  );
}
