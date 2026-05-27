import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geohashEncode, reverseGeocode, searchPlaces } from "./direccionesApi.js";

// Lima centro como fallback inicial
const DEFAULT_CENTER = { lat: -12.0908, lng: -77.0428 };

function pickFromAddress(addr = {}) {
  const distrito = addr.suburb || addr.city_district || addr.district || addr.neighbourhood || "";
  const ciudad = addr.city || addr.town || addr.village || addr.county || "";
  return { distrito, ciudad };
}

function composeAddress(item) {
  if (!item) return "";
  if (item.display_name) return item.display_name.split(",").slice(0, 3).join(", ");
  const a = item.address || {};
  const parts = [
    a.road,
    a.house_number,
    a.suburb || a.city_district || a.neighbourhood,
    a.city || a.town
  ].filter(Boolean);
  return parts.join(", ");
}

export default function AddressPicker({ open, initial, onClose, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [center, setCenter] = useState(() => ({
    lat: Number(initial?.latitud) || DEFAULT_CENTER.lat,
    lng: Number(initial?.longitud) || DEFAULT_CENTER.lng
  }));
  const [resolved, setResolved] = useState({
    direccion: initial?.direccion || "",
    distrito: initial?.distrito || "",
    ciudad: initial?.ciudad || ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingReverse, setLoadingReverse] = useState(false);
  const reverseTimer = useRef(null);
  const reverseAbort = useRef(null);
  const searchAbort = useRef(null);

  // Init map once when opened
  useEffect(() => {
    if (!open) return undefined;
    if (mapRef.current) {
      // Force redraw next tick (modal might have changed size)
      window.setTimeout(() => mapRef.current.invalidateSize(), 50);
      return undefined;
    }
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 16,
      zoomControl: true
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    }).addTo(map);
    map.on("move", () => {
      const c = map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      scheduleReverse(c.lat, c.lng);
    });
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 80);
    scheduleReverse(center.lat, center.lng);
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup map when closed
  useEffect(() => {
    if (open) return undefined;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    if (reverseTimer.current) {
      window.clearTimeout(reverseTimer.current);
      reverseTimer.current = null;
    }
    return undefined;
  }, [open]);

  function scheduleReverse(lat, lng) {
    if (reverseTimer.current) window.clearTimeout(reverseTimer.current);
    reverseTimer.current = window.setTimeout(async () => {
      if (reverseAbort.current) reverseAbort.current.abort();
      const controller = new AbortController();
      reverseAbort.current = controller;
      setLoadingReverse(true);
      try {
        const result = await reverseGeocode(lat, lng, { signal: controller.signal });
        const { distrito, ciudad } = pickFromAddress(result?.address || {});
        setResolved({
          direccion: composeAddress(result) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          distrito,
          ciudad
        });
      } catch (err) {
        if (err?.name !== "AbortError") {
          setResolved((prev) => ({
            ...prev,
            direccion: `${lat.toFixed(5)}, ${lng.toFixed(5)}`
          }));
        }
      } finally {
        setLoadingReverse(false);
      }
    }, 500);
  }

  async function runSearch(event) {
    event.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    if (searchAbort.current) searchAbort.current.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    try {
      const results = await searchPlaces(term, { signal: controller.signal });
      setSearchResults(results);
    } catch (err) {
      if (err?.name !== "AbortError") {
        setSearchResults([]);
      }
    } finally {
      setSearching(false);
    }
  }

  function pickSearchResult(item) {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setCenter({ lat, lng });
    setSearchResults([]);
    setSearchTerm("");
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], 17, { animate: true });
    }
    const { distrito, ciudad } = pickFromAddress(item.address || {});
    setResolved({
      direccion: composeAddress(item),
      distrito,
      ciudad
    });
  }

  function handleSave() {
    const lat = Number(center.lat);
    const lng = Number(center.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    onSelect?.({
      direccion: resolved.direccion || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      distrito: resolved.distrito || "",
      ciudad: resolved.ciudad || "",
      latitud: Number(lat.toFixed(6)),
      longitud: Number(lng.toFixed(6)),
      geohash: geohashEncode(lat, lng, 10)
    });
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="address-picker-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="address-picker">
        <header className="address-picker-head">
          <h3>Elige tu ubicación</h3>
          <button type="button" className="address-picker-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <form className="address-picker-search" onSubmit={runSearch}>
          <input
            type="text"
            placeholder="Buscar dirección, calle, distrito..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="submit" disabled={searching}>{searching ? "Buscando..." : "Buscar"}</button>
        </form>

        {searchResults.length > 0 ? (
          <ul className="address-picker-results">
            {searchResults.map((item) => (
              <li key={item.place_id}>
                <button type="button" onClick={() => pickSearchResult(item)}>
                  <strong>{(item.display_name || "").split(",")[0]}</strong>
                  <span>{(item.display_name || "").split(",").slice(1, 4).join(",").trim()}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="address-picker-map-wrap">
          <div ref={containerRef} className="address-picker-map" />
          <div className="address-picker-pin" aria-hidden="true">
            <span className="address-picker-pin-shadow" />
            <span className="address-picker-pin-marker" />
          </div>
          <p className="address-picker-hint">Mueve el mapa para colocar el pin en tu puerta.</p>
        </div>

        <div className="address-picker-resolved">
          <p className="address-picker-resolved-label">{loadingReverse ? "Cargando dirección..." : "Dirección seleccionada"}</p>
          <p className="address-picker-resolved-text">
            {resolved.direccion || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`}
          </p>
          {(resolved.distrito || resolved.ciudad) ? (
            <p className="address-picker-resolved-meta">
              {[resolved.distrito, resolved.ciudad].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <p className="address-picker-coords">
            {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
          </p>
        </div>

        <div className="address-picker-actions">
          <button type="button" className="address-picker-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="address-picker-save" onClick={handleSave} disabled={loadingReverse}>
            Guardar ubicación
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
