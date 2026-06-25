import React, { useEffect, useMemo, useState } from "react";
import { createSale, loadProductsPage, registerProductIngress } from "./adminApi.js";
import {
  buildOperationalRange,
  formatDateTime,
  formatQty,
  formatTurnLabel,
  getTodayOperationalDate,
  getTurnName,
  money,
  normalizeText,
  parseDateTime
} from "./adminRules.js";

const STORE_KEY = "licoreria_admin_store_control";

const DEFAULT_SCHEDULE = [
  { day: "Lunes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Martes", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Miercoles", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Jueves", shifts: [{ open: "10:00", close: "23:00" }], active: true },
  { day: "Viernes", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Sabado", shifts: [{ open: "10:00", close: "00:30" }], active: true },
  { day: "Domingo", shifts: [{ open: "11:00", close: "22:00" }], active: true }
];

function isCigaretteProduct(product) {
  return String(product?.category ?? product?.CATEGORIA ?? "").trim().toLowerCase() === "cigarros";
}

function normalizeCigarettePresentations(value, basePrice = 0) {
  const source = Array.isArray(value) ? value : [];
  const defaults = [
    { id: "unit", label: "Unidad", units: 1, enabled: true, price: Number(basePrice || 0) },
    { id: "box10", label: "Caja x10", units: 10, enabled: false, price: 0 },
    { id: "box20", label: "Caja x20", units: 20, enabled: false, price: 0 }
  ];
  return defaults.map((preset) => {
    const item = source.find((entry) => String(entry?.id || "").toLowerCase() === preset.id);
    return item
      ? { ...preset, enabled: preset.id === "unit" || item.enabled !== false, price: Number(item.price ?? item.precio ?? preset.price) }
      : preset;
  }).filter((item) => item.enabled);
}

function buildSmartIngressRowsFromProducts(products) {
  return (Array.isArray(products) ? products : [])
    .map((product) => {
      const id = product?.id ?? product?.["N°"];
      const name = product?.name ?? product?.NOMBRE ?? "Producto";
      if (!id) return null;
      return {
        id: `product-${id}`,
        productId: String(id),
        productName: name,
        productText: "",
        quantity: "",
        purchasePrice: String(product?.purchasePrice ?? product?.PRECIO_COMPRA ?? ""),
        enabled: false
      };
    })
    .filter(Boolean);
}

function minutesFromTime(value) {
  const [hour = "0", minute = "0"] = String(value || "00:00").split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatScheduleTime(value) {
  const [rawHour = "0", minute = "00"] = String(value || "00:00").split(":");
  const hour24 = Math.max(0, Math.min(23, Number(rawHour || 0)));
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${minute} ${period}`;
}

function normalizeSchedule(schedule) {
  const source = Array.isArray(schedule) && schedule.length ? schedule : DEFAULT_SCHEDULE;
  return DEFAULT_SCHEDULE.map((fallback, index) => {
    const row = source[index] || fallback;
    const shifts = Array.isArray(row.shifts) && row.shifts.length
      ? row.shifts
      : [{ open: row.open || fallback.shifts[0].open, close: row.close || fallback.shifts[0].close }];
    return {
      day: row.day || fallback.day,
      active: row.active !== false,
      shifts: shifts.map((shift) => ({
        open: shift?.open || fallback.shifts[0].open,
        close: shift?.close || fallback.shifts[0].close
      }))
    };
  });
}

function getActiveScheduleShift(schedule, now = new Date()) {
  const dayIndex = (now.getDay() + 6) % 7;
  const today = normalizeSchedule(schedule)?.[dayIndex];
  if (!today?.active) return null;
  const current = now.getHours() * 60 + now.getMinutes();
  const activeShift = today.shifts.find((shift) => {
    const open = minutesFromTime(shift.open);
    const close = minutesFromTime(shift.close);
    if (open <= close) return current >= open && current < close;
    return current >= open || current < close;
  });
  if (!activeShift) return null;
  return {
    day: today.day,
    label: `${formatScheduleTime(activeShift.open)} - ${formatScheduleTime(activeShift.close)}`
  };
}

function readStoreControl() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return {
      open: stored?.open !== false,
      schedule: normalizeSchedule(stored?.schedule),
      manualClosed: stored?.manualClosed === true,
      autoClosedReason: stored?.autoClosedReason || ""
    };
  } catch {
    return {
      open: true,
      schedule: DEFAULT_SCHEDULE,
      manualClosed: false,
      autoClosedReason: ""
    };
  }
}

function saleMatchesQuery(item, search) {
  if (!search) return true;
  const term = normalizeText(search);
  return [
    item?.NOMBRE,
    item?.TIPO_PAGO,
    item?.ESTADO,
    item?.["N°"],
    item?.N,
    item?.ID_VENTA,
    getTurnName(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA)
  ].some((value) => normalizeText(value).includes(term));
}

export default function AdminSalesPage({
  sales = [],
  kardex = [],
  productStats = null,
  dbStatus = null,
  loading = false,
  error = "",
  search = "",
  fromDate = getTodayOperationalDate(),
  toDate = getTodayOperationalDate(),
  onSearchChange,
  onFromDateChange,
  onToDateChange,
  onResetToday,
  onOpenOrders,
  onOpenProducts,
  onOpenKardex,
  onDownloadSalesReport,
  onRefresh
}) {
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [saleProducts, setSaleProducts] = useState([]);
  const [saleForm, setSaleForm] = useState({
    productId: "",
    quantity: "1",
    cigarettePresentation: "unit",
    paymentType: "Efectivo",
    saleDate: "",
    note: ""
  });
  const [saleSaving, setSaleSaving] = useState(false);
  const [saleLoadingProducts, setSaleLoadingProducts] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [saleSuccess, setSaleSuccess] = useState("");
  const [reportDownloading, setReportDownloading] = useState(false);
  const [smartIngressOpen, setSmartIngressOpen] = useState(false);
  const [smartIngressRows, setSmartIngressRows] = useState([]);
  const [smartIngressBusy, setSmartIngressBusy] = useState(false);
  const [smartIngressError, setSmartIngressError] = useState("");
  const [storeControl, setStoreControl] = useState(readStoreControl);
  const filteredSales = useMemo(() => {
    const range = buildOperationalRange(fromDate, toDate);
    return sales
      .filter((item) => String(item?.ESTADO || "ACTIVA").toUpperCase() !== "ANULADA")
      .filter((item) => {
        if (!range) return true;
        const saleDate = parseDateTime(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA);
        return saleDate && saleDate >= range.start && saleDate <= range.end;
      })
      .filter((item) => saleMatchesQuery(item, search))
      .sort((left, right) => {
        const leftDate = parseDateTime(left?.FECHA_REFERENCIA || left?.FECHA_OPERATIVA || left?.FECHA_VENTA);
        const rightDate = parseDateTime(right?.FECHA_REFERENCIA || right?.FECHA_OPERATIVA || right?.FECHA_VENTA);
        return (rightDate?.getTime() || 0) - (leftDate?.getTime() || 0);
      });
  }, [sales, fromDate, toDate, search]);

  const filteredKardex = useMemo(() => {
    const range = buildOperationalRange(fromDate, toDate);
    return kardex.filter((item) => {
      if (!range) return true;
      const movementDate = parseDateTime(item?.FECHA_HORA);
      return movementDate && movementDate >= range.start && movementDate <= range.end;
    });
  }, [kardex, fromDate, toDate]);

  const summary = useMemo(() => {
    const totalSales = filteredSales.reduce((acc, item) => acc + Number(item?.TOTAL || 0), 0);
    const totalUnits = filteredSales.reduce((acc, item) => acc + Number(item?.CANTIDAD || 0), 0);
    const avgTicket = filteredSales.length ? totalSales / filteredSales.length : 0;
    const ingressUnits = filteredKardex
      .filter((item) => String(item?.TIPO || "").toUpperCase() === "INGRESO")
      .reduce((acc, item) => acc + Number(item?.CANTIDAD || 0), 0);
    const lowStockCount = Number(productStats?.lowStockCount ?? 0);
    const outOfStockCount = Number(productStats?.outOfStockCount ?? 0);

    const paymentTotals = new Map();
    const categoryTotals = new Map();

    for (const sale of filteredSales) {
      const paymentLabel = String(sale?.TIPO_PAGO || "Sin definir").trim() || "Sin definir";
      paymentTotals.set(paymentLabel, (paymentTotals.get(paymentLabel) || 0) + Number(sale?.TOTAL || 0));

      const categoryLabel = String(sale?.CATEGORIA || sale?.CATEGORIA_PRODUCTO || "OTRO").trim() || "OTRO";
      categoryTotals.set(categoryLabel, (categoryTotals.get(categoryLabel) || 0) + Number(sale?.CANTIDAD || 0));
    }

    const topPaymentEntry = [...paymentTotals.entries()].sort((left, right) => right[1] - left[1])[0] || null;
    const topCategoryEntry = [...categoryTotals.entries()].sort((left, right) => right[1] - left[1])[0] || null;

    const activeProducts = Number(productStats?.activeProducts ?? productStats?.activos ?? productStats?.total ?? 0);
    const totalFlow = activeProducts + totalUnits + ingressUnits;
    const salesFlowRatio = totalFlow > 0 ? Math.round((totalUnits / totalFlow) * 100) : 0;
    const ingressFlowRatio = totalFlow > 0 ? Math.round((ingressUnits / totalFlow) * 100) : 0;
    const activeFlowRatio = Math.max(12, 100 - salesFlowRatio - ingressFlowRatio);

    return {
      totalSales,
      totalUnits,
      salesCount: filteredSales.length,
      avgTicket,
      kardexCount: filteredKardex.length,
      activeProducts,
      ingressUnits,
      lowStockCount,
      outOfStockCount,
      topPaymentLabel: topPaymentEntry?.[0] || "Sin ventas",
      topPaymentAmount: Number(topPaymentEntry?.[1] || 0),
      topCategoryLabel: topCategoryEntry?.[0] || "OTRO",
      topCategoryUnits: Number(topCategoryEntry?.[1] || 0),
      salesFlowRatio,
      ingressFlowRatio,
      activeFlowRatio
    };
  }, [filteredSales, filteredKardex, productStats]);

  const liveLabel = dbStatus?.connected ? "EN VIVO" : loading ? "SINCRONIZANDO" : "LOCAL";
  const turnLabel = formatTurnLabel(fromDate).replace("Turno ", "");
  const sessionLabel = fromDate === toDate ? "Cierre de caja" : "Resumen por rango";
  const selectedSaleProduct = saleProducts.find((item) => String(item?.id ?? item?.["N°"]) === String(saleForm.productId));
  const selectedSalePresentations = isCigaretteProduct(selectedSaleProduct)
    ? normalizeCigarettePresentations(
      selectedSaleProduct?.cigarettePresentations ?? selectedSaleProduct?.CIGARRO_PRESENTACIONES,
      selectedSaleProduct?.price ?? selectedSaleProduct?.PRECIO ?? 0
    )
    : [];
  const selectedSalePresentation = selectedSalePresentations.find((item) => item.id === saleForm.cigarettePresentation) || selectedSalePresentations[0] || null;
  const saleUnitMultiplier = selectedSalePresentation?.units || 1;
  const salePresentationPrice = selectedSalePresentation?.price ?? Number(selectedSaleProduct?.price ?? selectedSaleProduct?.PRECIO ?? 0);
  const salePreviewTotal = Number(salePresentationPrice || 0) * Number(saleForm.quantity || 0);
  const saleReportUnits = Number(saleForm.quantity || 0) * saleUnitMultiplier;
  const activeScheduleShift = getActiveScheduleShift(storeControl.schedule);
  const scheduledOpen = Boolean(activeScheduleShift);
  const storeOpen = storeControl.open && scheduledOpen;
  const storeStatusLabel = storeOpen ? "Abierta" : "Cerrada";
  const storeStatusDetail = storeOpen
    ? `Turno activo: ${activeScheduleShift.label}`
    : storeControl.manualClosed
      ? storeControl.autoClosedReason || "Cierre manual"
      : scheduledOpen
        ? "Cierre manual"
        : "Sin turno activo";

  useEffect(() => {
    if (!saleModalOpen || saleProducts.length) return;
    let isMounted = true;
    setSaleLoadingProducts(true);
    setSaleError("");
    loadProductsPage({ page: 1, pageSize: 250, sortBy: "NOMBRE", sortDir: "asc" })
      .then((data) => {
        if (!isMounted) return;
        setSaleProducts(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((err) => {
        if (!isMounted) return;
        setSaleError(err?.message || "No se pudieron cargar los productos.");
      })
      .finally(() => {
        if (isMounted) setSaleLoadingProducts(false);
      });
    return () => {
      isMounted = false;
    };
  }, [saleModalOpen, saleProducts.length]);

  useEffect(() => {
    function refreshStoreControl() {
      setStoreControl(readStoreControl());
    }
    refreshStoreControl();
    const id = window.setInterval(refreshStoreControl, 60000);
    window.addEventListener("storage", refreshStoreControl);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", refreshStoreControl);
    };
  }, []);

  function openSaleModal() {
    setSaleForm({
      productId: "",
      quantity: "1",
      cigarettePresentation: "unit",
      paymentType: "Efectivo",
      saleDate: "",
      note: ""
    });
    setSaleError("");
    setSaleSuccess("");
    setSaleModalOpen(true);
  }

  function openSmartIngressModal() {
    setSmartIngressOpen(true);
    setSmartIngressRows(buildSmartIngressRowsFromProducts(saleProducts));
    setSmartIngressError("");
    if (!saleProducts.length && !saleLoadingProducts) {
      setSaleLoadingProducts(true);
      loadProductsPage({ page: 1, pageSize: 1000, sortBy: "NOMBRE", sortDir: "asc" })
        .then((data) => {
          const products = Array.isArray(data?.items) ? data.items : [];
          setSaleProducts(products);
          setSmartIngressRows(buildSmartIngressRowsFromProducts(products));
        })
        .catch((err) => setSmartIngressError(err?.message || "No se pudieron cargar los productos."))
        .finally(() => setSaleLoadingProducts(false));
    }
  }

  function closeSmartIngressModal() {
    if (smartIngressBusy) return;
    setSmartIngressOpen(false);
    setSmartIngressRows([]);
    setSmartIngressError("");
  }

  function updateSaleForm(field, value) {
    setSaleForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreateSale(event) {
    event.preventDefault();
    const productId = Number(saleForm.productId);
    const quantity = Number(saleForm.quantity);

    if (!productId) {
      setSaleError("Selecciona un producto.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSaleError("Ingresa una cantidad válida.");
      return;
    }

    setSaleSaving(true);
    setSaleError("");
    setSaleSuccess("");
    try {
      await createSale({
        productId,
        cantidad: quantity,
        presentacionCigarro: isCigaretteProduct(selectedSaleProduct) ? (selectedSalePresentation?.id || "unit") : undefined,
        tipoPago: saleForm.paymentType,
        fechaVenta: saleForm.saleDate || undefined,
        origen: "Panel admin",
        nota: saleForm.note
      });
      setSaleModalOpen(false);
      setSaleSuccess("Venta registrada correctamente.");
      await onRefresh?.();
    } catch (err) {
      setSaleError(err?.message || "No se pudo registrar la venta.");
    } finally {
      setSaleSaving(false);
    }
  }

  async function handleDownloadReport() {
    if (!onDownloadSalesReport || reportDownloading) return;
    setReportDownloading(true);
    setSaleError("");
    try {
      await onDownloadSalesReport({ from: fromDate, to: toDate, q: search, format: "xlsx" });
      setSaleSuccess("Reporte de pedido descargado.");
    } catch (err) {
      setSaleError(err?.message || "No se pudo descargar el reporte.");
    } finally {
      setReportDownloading(false);
    }
  }

  function updateSmartIngressRow(index, patch) {
    setSmartIngressRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function handleConfirmSmartIngress() {
    const rows = smartIngressRows.filter((row) => row.enabled && Number(row.productId) > 0 && Number(row.quantity) > 0);
    if (!rows.length) {
      setSmartIngressError("Confirma al menos un producto con cantidad válida.");
      return;
    }
    setSmartIngressBusy(true);
    setSmartIngressError("");
    try {
      for (const row of rows) {
        await registerProductIngress(Number(row.productId), {
          cantidad: Number(row.quantity || 0),
          precio_compra: row.purchasePrice ? Number(row.purchasePrice) : undefined,
          nota: "Ingreso masivo desde tabla admin"
        });
      }
      closeSmartIngressModal();
      setSaleSuccess(`Ingreso confirmado: ${rows.length} producto${rows.length === 1 ? "" : "s"}.`);
      await onRefresh?.();
    } catch (err) {
      setSmartIngressError(err?.message || "No se pudo guardar el ingreso.");
    } finally {
      setSmartIngressBusy(false);
    }
  }

  return (
    <div className="react-admin-sales-page">
      {error ? <p className="react-admin-error">{error}</p> : null}
      {saleSuccess ? <p className="react-admin-success">{saleSuccess}</p> : null}

      <section className="react-admin-overview">
        <article className="react-admin-overview-card react-admin-overview-card-session">
          <div className="react-admin-overview-top">
            <div className="react-admin-overview-icon">CA</div>
            <div>
              <span className="react-admin-overview-kicker">Sesión actual</span>
              <strong>{sessionLabel}</strong>
            </div>
            <span className="react-admin-overview-chevron">&gt;</span>
          </div>
          <div className="react-admin-overview-metric">
            <small>Total vendido del turno</small>
            <strong>{money(summary.totalSales)}</strong>
          </div>
          <div className="react-admin-overview-divider" />
          <button type="button" className="react-admin-link react-admin-link-wide" onClick={openSaleModal}>
            + Crear venta
          </button>
          <div className="react-admin-overview-mini-grid">
            <div className="react-admin-overview-mini">
              <span>Ventas</span>
              <strong>{formatQty(summary.salesCount)}</strong>
            </div>
            <div className="react-admin-overview-mini">
              <span>Prom. venta</span>
              <strong>{money(summary.avgTicket)}</strong>
            </div>
          </div>
        </article>

        <article className="react-admin-overview-card">
          <div className="react-admin-overview-headline">
            <div className="react-admin-overview-icon is-blue">FI</div>
            <strong>Flujo de inventario</strong>
            <span className="react-admin-overview-chevron">&gt;</span>
          </div>
          <div className="react-admin-overview-stats-row">
            <div>
              <span>Activos</span>
              <strong>{formatQty(summary.activeProducts)}</strong>
            </div>
            <div>
              <span>Salidas</span>
              <strong className="is-warn">{formatQty(summary.totalUnits)}</strong>
            </div>
            <div>
              <span>Entradas</span>
              <strong className="is-ok">{formatQty(summary.ingressUnits)}</strong>
            </div>
          </div>
          <div className="react-admin-overview-progress" aria-hidden="true">
            <span style={{ width: `${summary.activeFlowRatio}%` }} />
            <span className="is-sales" style={{ width: `${summary.salesFlowRatio}%` }} />
            <span className="is-ingress" style={{ width: `${summary.ingressFlowRatio}%` }} />
          </div>
          <div className="react-admin-overview-foot">
            <small>{`Turno ${turnLabel} activo`}</small>
            <span>{`${formatQty(summary.kardexCount)} mov.`}</span>
          </div>
        </article>

        <article className="react-admin-overview-card">
          <div className="react-admin-overview-headline">
            <div className="react-admin-overview-icon is-amber">AS</div>
            <strong>Alertas de stock</strong>
            <span className="react-admin-overview-pill is-muted">{formatQty(summary.lowStockCount + summary.outOfStockCount)}</span>
          </div>
          <div className="react-admin-overview-alert is-danger">
            <div className="react-admin-overview-alert-badge">{formatQty(summary.outOfStockCount)}</div>
            <div>
              <strong>Sin stock</strong>
              <small>Productos activos sin unidades</small>
            </div>
            <span>&gt;</span>
          </div>
          <div className="react-admin-overview-alert is-info">
            <div className="react-admin-overview-alert-badge is-blue">{formatQty(summary.lowStockCount)}</div>
            <div>
              <strong>Stock bajo</strong>
              <small>Requieren reposición operativa</small>
            </div>
            <span>&gt;</span>
          </div>
          <div className="react-admin-overview-actions">
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={openSmartIngressModal}>
              + Ingresar inventario
            </button>
            <button type="button" className="react-admin-link" onClick={handleDownloadReport} disabled={reportDownloading}>
              {reportDownloading ? "Generando..." : "+ Reporte de pedido"}
            </button>
          </div>
        </article>

        <article className="react-admin-overview-card">
          <div className="react-admin-overview-headline">
            <div className="react-admin-overview-icon is-mint">RL</div>
            <strong>Resumen líder</strong>
            <span className="react-admin-overview-pill is-live">{liveLabel}</span>
          </div>
          <button type="button" className="react-admin-overview-feature react-admin-overview-shortcut" onClick={onOpenOrders}>
            <div className={`react-admin-overview-feature-score ${storeOpen ? "is-open" : "is-closed"}`}>
              {storeOpen ? "ON" : "OFF"}
            </div>
            <div>
              <span>Horario de tienda</span>
              <strong>{storeStatusLabel}</strong>
              <small>{storeStatusDetail}</small>
            </div>
          </button>
          <div className="react-admin-overview-divider" />
          <div className="react-admin-overview-feature">
            <div className="react-admin-overview-feature-score is-ghost">CAT</div>
            <div>
              <span>Categoría más vendida</span>
              <strong>{summary.topCategoryLabel}</strong>
              <small>{`${formatQty(summary.topCategoryUnits)} unidades - ${formatQty(summary.salesCount)} venta(s)`}</small>
            </div>
          </div>
        </article>
      </section>

      <article className="react-admin-filter-card">
        <div className="react-admin-filter-head">
          <div>
            <span className="react-admin-filter-kicker">Filtro operativo</span>
            <h2>Consulta por turno</h2>
          </div>
          <button type="button" onClick={onResetToday}>Hoy</button>
        </div>
        <div className="react-admin-filter-grid">
          <label>
            Turno desde
            <input type="date" value={fromDate} onChange={(event) => onFromDateChange(event.target.value)} />
            <small>{formatTurnLabel(fromDate)}</small>
          </label>
          <label>
            Turno hasta
            <input type="date" value={toDate} onChange={(event) => onToDateChange(event.target.value)} />
            <small>{formatTurnLabel(toDate)}</small>
          </label>
          <label className="react-admin-filter-search">
            Buscar
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Nombre, turno, N° o pago"
            />
          </label>
        </div>
      </article>

      <article className="react-admin-table-card">
        <div className="react-admin-table-head">
          <div>
            <h2>Ventas del turno</h2>
            <small>{loading ? "Actualizando datos..." : `${filteredSales.length} registros visibles`}</small>
          </div>
          <button type="button" className="react-admin-link" onClick={openSaleModal}>
            + Crear venta
          </button>
        </div>
        <div className="react-admin-table-wrap">
          <table className="react-admin-table">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Fecha/hora</th>
                <th>N°</th>
                <th>Nombre</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.length ? (
                filteredSales.slice(0, 80).map((item, index) => (
                  <tr key={`${item?.ID_VENTA || "sale"}-${index}`}>
                    <td>{getTurnName(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA)}</td>
                    <td>{formatDateTime(item?.FECHA_REFERENCIA || item?.FECHA_OPERATIVA || item?.FECHA_VENTA)}</td>
                    <td>{String(item?.["N°"] ?? item?.N ?? "-")}</td>
                    <td>{String(item?.NOMBRE || "-")}</td>
                    <td>{formatQty(item?.CANTIDAD || 0)}</td>
                    <td>{money(item?.PRECIO || 0)}</td>
                    <td>{money(item?.TOTAL || 0)}</td>
                    <td>{String(item?.TIPO_PAGO || "-")}</td>
                    <td>{String(item?.ESTADO || "ACTIVA")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="9">No hay ventas para este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      {smartIngressOpen ? (
        <div className="react-admin-modal-backdrop" role="presentation">
          <div className="react-admin-modal react-admin-modal-wide" role="dialog" aria-modal="true">
            <div className="react-admin-modal-head">
              <div>
                <span>Ingreso de inventario</span>
                <h3>Selecciona productos y cantidades</h3>
              </div>
              <button type="button" className="react-admin-icon-close" onClick={closeSmartIngressModal} disabled={smartIngressBusy}>
                ×
              </button>
            </div>

            {smartIngressError ? <p className="react-admin-error">{smartIngressError}</p> : null}

            <p className="react-admin-smart-ingress-help">
              Marca los productos que están ingresando y completa cantidad y precio de compra por unidad.
            </p>

            <div className="react-admin-smart-ingress-table">
              {smartIngressRows.length ? (
                <table className="react-admin-table">
                  <thead>
                    <tr>
                      <th>Usar</th>
                      <th>Producto</th>
                      <th>Detalle</th>
                      <th>Cantidad</th>
                      <th>Precio compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {smartIngressRows.map((row, index) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(event) => updateSmartIngressRow(index, { enabled: event.target.checked })}
                          />
                        </td>
                        <td>
                          <strong>{row.productName || "Producto"}</strong>
                          <small>N° {row.productId}</small>
                        </td>
                        <td>
                          <input value={row.productText} onChange={(event) => updateSmartIngressRow(index, { productText: event.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0.01" step="0.01" value={row.quantity} onChange={(event) => updateSmartIngressRow(index, { quantity: event.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={row.purchasePrice} onChange={(event) => updateSmartIngressRow(index, { purchasePrice: event.target.value })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="react-admin-empty-state">
                  <strong>{saleLoadingProducts ? "Cargando productos..." : "No hay productos disponibles."}</strong>
                  <small>Cuando cargue el catálogo podrás marcar productos, cantidades y precios.</small>
                </div>
              )}
            </div>

            <div className="react-admin-modal-actions">
              <button type="button" className="react-admin-link react-admin-link-soft" onClick={closeSmartIngressModal} disabled={smartIngressBusy}>
                Cancelar
              </button>
              <button type="button" className="react-admin-link" onClick={handleConfirmSmartIngress} disabled={smartIngressBusy || !smartIngressRows.length}>
                {smartIngressBusy ? "Procesando..." : "Confirmar ingreso"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saleModalOpen ? (
        <div className="react-admin-modal-backdrop" role="presentation">
          <form className="react-admin-modal react-admin-modal-sm" onSubmit={handleCreateSale}>
            <div className="react-admin-modal-head">
              <div>
                <span>Venta rápida</span>
                <h3>Crear venta</h3>
              </div>
              <button type="button" className="react-admin-icon-close" onClick={() => setSaleModalOpen(false)}>
                ×
              </button>
            </div>

            {saleError ? <p className="react-admin-error">{saleError}</p> : null}

            <div className="react-admin-form-grid">
              <label className="is-span-2">
                Producto
                <select
                  value={saleForm.productId}
                  onChange={(event) => setSaleForm((current) => ({ ...current, productId: event.target.value, cigarettePresentation: "unit" }))}
                  disabled={saleLoadingProducts || saleSaving}
                  required
                >
                  <option value="">{saleLoadingProducts ? "Cargando productos..." : "Seleccionar producto"}</option>
                  {saleProducts.map((item) => {
                    const id = item?.id ?? item?.["N°"];
                    const name = item?.name ?? item?.NOMBRE ?? "Producto";
                    const price = item?.price ?? item?.PRECIO ?? 0;
                    const stock = item?.stock ?? item?.STOCK_ACTUAL ?? 0;
                    return (
                      <option key={id} value={id}>
                        {`${id} · ${name} · ${money(price)} · Stock ${formatQty(stock)}`}
                      </option>
                    );
                  })}
                </select>
              </label>
              {selectedSalePresentations.length ? (
                <label className="is-span-2">
                  Presentación
                  <select
                    value={saleForm.cigarettePresentation}
                    onChange={(event) => updateSaleForm("cigarettePresentation", event.target.value)}
                    disabled={saleSaving}
                  >
                    {selectedSalePresentations.map((presentation) => (
                      <option key={presentation.id} value={presentation.id}>
                        {`${presentation.label} · ${presentation.units} unidad${presentation.units === 1 ? "" : "es"} · ${money(presentation.price)}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Cantidad
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={saleForm.quantity}
                  onChange={(event) => updateSaleForm("quantity", event.target.value)}
                  disabled={saleSaving}
                  required
                />
              </label>
              <label>
                Pago
                <select
                  value={saleForm.paymentType}
                  onChange={(event) => updateSaleForm("paymentType", event.target.value)}
                  disabled={saleSaving}
                >
                  <option>Efectivo</option>
                  <option>Yape</option>
                  <option>Plin</option>
                  <option>Tarjeta</option>
                  <option>Transferencia</option>
                  <option>Mixto</option>
                </select>
              </label>
              <label className="is-span-2">
                Fecha y hora
                <input
                  type="datetime-local"
                  value={saleForm.saleDate}
                  onChange={(event) => updateSaleForm("saleDate", event.target.value)}
                  disabled={saleSaving}
                />
              </label>
              <label className="is-span-2">
                Nota
                <textarea
                  value={saleForm.note}
                  onChange={(event) => updateSaleForm("note", event.target.value)}
                  disabled={saleSaving}
                  placeholder="Opcional"
                />
              </label>
            </div>

            <div className="react-admin-sale-preview">
              <span>Total estimado</span>
              <strong>{money(salePreviewTotal)}</strong>
              {selectedSalePresentation ? <small>Reporte Excel: {formatQty(saleReportUnits)} unidades</small> : null}
            </div>

            <div className="react-admin-modal-actions">
              <button type="button" className="react-admin-link react-admin-link-soft" onClick={() => setSaleModalOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="react-admin-link" disabled={saleSaving || saleLoadingProducts}>
                {saleSaving ? "Guardando..." : "Guardar venta"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
