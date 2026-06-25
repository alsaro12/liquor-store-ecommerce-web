import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { loadStoreDeliveryConfig, quoteDelivery, saveStoreDeliveryConfig } from "./adminApi.js";

const DEFAULT_CENTER = { lat: -16.39889, lng: -71.53696 };
const AREQUIPA_BOUNDS = {
  minLat: -16.55,
  maxLat: -16.25,
  minLng: -71.75,
  maxLng: -71.35
};
const DEFAULT_RANGES = [
  { id: "range-1", fromKm: 0, toKm: 1, price: 10 },
  { id: "range-2", fromKm: 1, toKm: 3, price: 15 },
  { id: "range-3", fromKm: 3, toKm: 6, price: 20 },
  { id: "range-4", fromKm: 6, toKm: 10, price: 25 },
  { id: "range-5", fromKm: 10, toKm: 15, price: 35 }
];

function money(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function normalizeRanges(items) {
  const source = Array.isArray(items) && items.length ? items : DEFAULT_RANGES;
  return source.map((item, index) => ({
    id: item.id || `range-${index + 1}`,
    fromKm: String(item.fromKm ?? 0),
    toKm: String(item.toKm ?? 0),
    price: String(item.price ?? 0)
  }));
}

function toPayloadRanges(items) {
  return items.map((item, index) => ({
    id: item.id || `range-${index + 1}`,
    fromKm: Number(item.fromKm || 0),
    toKm: Number(item.toKm || 0),
    price: Number(item.price || 0)
  }));
}

function buildConfigSnapshot(store, ranges) {
  return JSON.stringify({
    store: {
      name: String(store?.name || ""),
      address: String(store?.address || ""),
      latitud: store?.latitud === null || store?.latitud === undefined ? null : Number(store.latitud),
      longitud: store?.longitud === null || store?.longitud === undefined ? null : Number(store.longitud)
    },
    ranges: toPayloadRanges(ranges)
  });
}

function isInsideArequipa(point = {}) {
  const lat = Number(point.latitud ?? point.lat);
  const lng = Number(point.longitud ?? point.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= AREQUIPA_BOUNDS.minLat
    && lat <= AREQUIPA_BOUNDS.maxLat
    && lng >= AREQUIPA_BOUNDS.minLng
    && lng <= AREQUIPA_BOUNDS.maxLng;
}

function resolveMapCenter(value) {
  const candidate = {
    lat: Number(value?.latitud),
    lng: Number(value?.longitud)
  };
  return isInsideArequipa(candidate) ? candidate : DEFAULT_CENTER;
}

function DeliveryMap({ label, value, onChange, loading = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const center = resolveMapCenter(value);

  useEffect(() => {
    if (loading || !containerRef.current || mapRef.current) return undefined;
    setMapReady(false);
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 15,
      zoomControl: true
    });
    const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19
    });
    tileLayer.on("load", () => setMapReady(true));
    tileLayer.addTo(map);
    const marker = L.marker([center.lat, center.lng]).addTo(map);
    map.on("moveend", () => {
      const next = map.getCenter();
      marker.setLatLng(next);
      onChange?.({ latitud: Number(next.lat.toFixed(6)), longitud: Number(next.lng.toFixed(6)) });
    });
    mapRef.current = map;
    markerRef.current = marker;
    const resizeTimer = window.setTimeout(() => {
      if (mapRef.current === map) map.invalidateSize();
    }, 80);
    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (!mapRef.current || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
    const current = mapRef.current.getCenter();
    if (Math.abs(current.lat - center.lat) < 0.000001 && Math.abs(current.lng - center.lng) < 0.000001) return;
    mapRef.current.setView([center.lat, center.lng], mapRef.current.getZoom(), { animate: false });
    markerRef.current?.setLatLng([center.lat, center.lng]);
  }, [center.lat, center.lng]);

  return (
    <div className="admin-delivery-map-block">
      <span>{label}</span>
      {loading ? (
        <div className="admin-delivery-map admin-delivery-map-loading" role="status" aria-live="polite">
          <i aria-hidden="true" />
          <strong>Cargando ubicación guardada...</strong>
        </div>
      ) : (
        <div className="admin-delivery-map-wrap">
          <div ref={containerRef} className="admin-delivery-map" />
          {!mapReady ? (
            <div className="admin-delivery-map-overlay" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <strong>Cargando mapa...</strong>
            </div>
          ) : null}
        </div>
      )}
      <small>Mueve el mapa para ubicar el pin.</small>
    </div>
  );
}

export default function AdminDeliveryPage() {
  const [store, setStore] = useState({ name: "La Licoreria", address: "", latitud: null, longitud: null });
  const [ranges, setRanges] = useState(normalizeRanges(DEFAULT_RANGES));
  const [testPoint, setTestPoint] = useState({ latitud: DEFAULT_CENTER.lat, longitud: DEFAULT_CENTER.lng });
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");

  async function refreshConfig() {
    setLoading(true);
    setError("");
    try {
      const config = await loadStoreDeliveryConfig();
      const nextRanges = normalizeRanges(config?.ranges);
      const nextStore = {
        name: config?.store?.name || "La Licoreria",
        address: config?.store?.address || "",
        latitud: config?.store?.latitud ?? null,
        longitud: config?.store?.longitud ?? null
      };
      setStore(nextStore);
      setRanges(nextRanges);
      setSavedSnapshot(buildConfigSnapshot(nextStore, nextRanges));
    } catch (err) {
      setError(err?.message || "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshConfig();
  }, []);

  function updateRange(index, field, value) {
    setRanges((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  }

  function addRange() {
    const last = ranges[ranges.length - 1];
    const fromKm = Number(last?.toKm || 0);
    setRanges((current) => [...current, {
      id: `range-${Date.now()}`,
      fromKm: String(fromKm),
      toKm: String(fromKm + 5),
      price: "0"
    }]);
  }

  function removeRange(index) {
    if (ranges.length <= 1) return;
    setRanges((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (!Number.isFinite(Number(store.latitud)) || !Number.isFinite(Number(store.longitud))) {
        throw new Error("Ubica la tienda en el mapa antes de guardar.");
      }
      const saved = await saveStoreDeliveryConfig({
        store,
        ranges: toPayloadRanges(ranges)
      });
      const nextStore = saved.store;
      const nextRanges = normalizeRanges(saved.ranges);
      setStore(nextStore);
      setRanges(nextRanges);
      setSavedSnapshot(buildConfigSnapshot(nextStore, nextRanges));
      setMessage("Configuración de tienda y delivery guardada.");
    } catch (err) {
      setError(err?.message || "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleQuote() {
    setQuoting(true);
    setError("");
    setQuote(null);
    try {
      setQuote(await quoteDelivery(testPoint));
    } catch (err) {
      setQuote(err?.payload || { available: false, message: err?.message || "Fuera de cobertura." });
    } finally {
      setQuoting(false);
    }
  }

  const storeConfigured = store.latitud !== null
    && store.latitud !== undefined
    && store.longitud !== null
    && store.longitud !== undefined
    && Number.isFinite(Number(store.latitud))
    && Number.isFinite(Number(store.longitud));
  const hasChanges = Boolean(savedSnapshot) && buildConfigSnapshot(store, ranges) !== savedSnapshot;

  return (
    <div className="react-admin-delivery-page">
      {message || error ? <p className={error ? "react-admin-error" : "react-admin-message"}>{error || message}</p> : null}

      <form className="admin-delivery-grid" onSubmit={handleSave}>
        <article className="react-admin-table-card admin-delivery-card">
          <div className="react-admin-table-head">
            <div>
              <h2>Ubicación de tienda</h2>
              <small>{storeConfigured ? `${Number(store.latitud).toFixed(6)}, ${Number(store.longitud).toFixed(6)}` : "Pendiente de configurar"}</small>
            </div>
            <span className={`react-admin-tag ${storeConfigured ? "react-admin-tag-ok" : "react-admin-tag-low"}`}>
              {storeConfigured ? "Activa" : "Sin ubicación"}
            </span>
          </div>
          <div className="react-admin-form-grid">
            <label>
              Nombre
              <input value={store.name} onChange={(event) => setStore((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="is-span-2">
              Dirección referencial
              <input value={store.address} onChange={(event) => setStore((current) => ({ ...current, address: event.target.value }))} />
            </label>
          </div>
          <DeliveryMap
            label="Punto de salida"
            value={store}
            onChange={(next) => setStore((current) => ({ ...current, ...next }))}
            loading={loading}
          />
        </article>

        <article className="react-admin-table-card admin-delivery-card">
          <div className="react-admin-table-head">
            <div>
              <h2>Rangos de delivery</h2>
              <small>Precio final que verá el cliente.</small>
            </div>
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={addRange}>+ Agregar rango</button>
          </div>
          <div className="admin-delivery-ranges">
            {ranges.map((range, index) => (
              <div className="admin-delivery-range" key={range.id}>
                <label>
                  Desde km
                  <input type="number" step="0.1" min="0" value={range.fromKm} onChange={(event) => updateRange(index, "fromKm", event.target.value)} />
                </label>
                <label>
                  Hasta km
                  <input type="number" step="0.1" min="0" value={range.toKm} onChange={(event) => updateRange(index, "toKm", event.target.value)} />
                </label>
                <label>
                  Precio
                  <input type="number" step="0.5" min="0" value={range.price} onChange={(event) => updateRange(index, "price", event.target.value)} />
                </label>
                <button type="button" className="admin-delivery-remove" onClick={() => removeRange(index)} disabled={ranges.length <= 1} aria-label="Quitar rango">×</button>
              </div>
            ))}
          </div>
          <div className="react-admin-modal-actions">
            <button type="submit" className="react-admin-link" disabled={saving || loading || !hasChanges}>{saving ? "Guardando..." : "Guardar configuración"}</button>
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={refreshConfig} disabled={loading || saving}>Recargar</button>
          </div>
        </article>

        <article className="react-admin-table-card admin-delivery-card is-wide">
          <div className="react-admin-table-head">
            <div>
              <h2>Calculadora de delivery</h2>
              <small>Mueve el punto destino y calcula la tarifa.</small>
            </div>
            <button type="button" className="react-admin-link" onClick={handleQuote} disabled={quoting || !storeConfigured}>
              {quoting ? "Calculando..." : "Calcular"}
            </button>
          </div>
          <DeliveryMap label="Punto destino de prueba" value={testPoint} onChange={setTestPoint} />
          <div className={`admin-delivery-quote ${quote?.available ? "is-ok" : "is-muted"}`}>
            {quote ? (
              quote.available ? (
                <>
                  <strong>{money(quote.price)}</strong>
                  <span>{Number(quote.distanceKm).toFixed(2)} km · rango {quote.range.fromKm}-{quote.range.toKm} km</span>
                </>
              ) : (
                <>
                  <strong>Sin cobertura</strong>
                  <span>{quote.message || "No hay rango para esta distancia."}</span>
                </>
              )
            ) : (
              <>
                <strong>{storeConfigured ? "Listo para calcular" : "Configura la tienda primero"}</strong>
                <span>La cotización usa distancia en línea recta.</span>
              </>
            )}
          </div>
        </article>
      </form>
    </div>
  );
}
