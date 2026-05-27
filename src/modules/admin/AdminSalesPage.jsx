import { useMemo } from "react";
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

function saleMatchesQuery(item, search) {
  if (!search) return true;
  const term = normalizeText(search);
  return [
    item?.NOMBRE,
    item?.TIPO_PAGO,
    item?.ESTADO,
    item?.["NÂ°"],
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
  onOpenProducts,
  onOpenKardex
}) {
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
  const paymentShare = summary.totalSales > 0 ? Math.round((summary.topPaymentAmount / summary.totalSales) * 100) : 0;

  return (
    <>
      {error ? <p className="react-admin-error">{error}</p> : null}

      <section className="react-admin-overview">
        <article className="react-admin-overview-card react-admin-overview-card-session">
          <div className="react-admin-overview-top">
            <div className="react-admin-overview-icon">CA</div>
            <div>
              <span className="react-admin-overview-kicker">Sesion actual</span>
              <strong>{sessionLabel}</strong>
            </div>
            <span className="react-admin-overview-chevron">&gt;</span>
          </div>
          <div className="react-admin-overview-metric">
            <small>Total vendido del turno</small>
            <strong>{money(summary.totalSales)}</strong>
          </div>
          <div className="react-admin-overview-divider" />
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
              <small>Requieren reposicion operativa</small>
            </div>
            <span>&gt;</span>
          </div>
          <div className="react-admin-overview-actions">
            <button type="button" className="react-admin-link react-admin-link-soft" onClick={onOpenProducts}>
              + Ingresar inventario
            </button>
            <button type="button" className="react-admin-link" onClick={onOpenKardex}>
              + Reporte de pedido
            </button>
          </div>
        </article>

        <article className="react-admin-overview-card">
          <div className="react-admin-overview-headline">
            <div className="react-admin-overview-icon is-mint">RL</div>
            <strong>Resumen lider</strong>
            <span className="react-admin-overview-pill is-live">{liveLabel}</span>
          </div>
          <div className="react-admin-overview-feature">
            <div className="react-admin-overview-feature-score">{`${paymentShare}%`}</div>
            <div>
              <span>Metodo de pago lider</span>
              <strong>{summary.topPaymentLabel}</strong>
              <small>{`${money(summary.topPaymentAmount)} del total cobrado`}</small>
            </div>
          </div>
          <div className="react-admin-overview-divider" />
          <div className="react-admin-overview-feature">
            <div className="react-admin-overview-feature-score is-ghost">CAT</div>
            <div>
              <span>Categoria mas vendida</span>
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
                    <td>{String(item?.["NÂ°"] ?? item?.N ?? "-")}</td>
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
    </>
  );
}
