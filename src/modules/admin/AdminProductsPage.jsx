import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { COMBO_THEMES, loadComboCatalog, saveComboCatalog } from "../combos/comboCatalog.js";
import {
  createProduct,
  inactivateProduct,
  loadProductsPage,
  loadProductsStats,
  registerProductIngress,
  updateProduct
} from "./adminApi.js";
import { formatQty, money, normalizeProduct, normalizeText } from "./adminRules.js";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  category: "OTRO",
  price: "0",
  purchasePrice: "0",
  stockMax: "0",
  stockMin: "0",
  stockActual: "0",
  status: "ACTIVO"
};

const EMPTY_COMBO_FORM = {
  id: "",
  badge: "",
  title: "",
  summary: "",
  price: "0",
  theme: "gold",
  imageUrl: "",
  items: [{ productId: "", quantity: "1" }]
};

function normalizeFormFromProduct(item) {
  const product = normalizeProduct(item);
  return {
    id: product.code ? String(product.code) : "",
    name: product.name,
    description: product.description,
    category: product.category || "OTRO",
    price: String(product.price ?? 0),
    purchasePrice: String(product.purchasePrice ?? 0),
    stockMax: String(product.stockMax ?? 0),
    stockMin: String(product.stockMin ?? 0),
    stockActual: String(product.stock ?? 0),
    status: product.status || "ACTIVO"
  };
}

function buildPayloadFromForm(form, mode) {
  const payload = {
    NOMBRE: form.name,
    DESCRIPCION: form.description,
    CATEGORIA: form.category,
    PRECIO: Number(form.price || 0),
    PRECIO_COMPRA: Number(form.purchasePrice || 0),
    STOCK_MAXIMO: Number(form.stockMax || 0),
    STOCK_MINIMO: Number(form.stockMin || 0),
    STOCK_ACTUAL: Number(form.stockActual || 0),
    ESTADO: form.status
  };
  if (mode === "create" && form.id) {
    payload["N°"] = Number(form.id);
  }
  return payload;
}

export default function AdminProductsPage() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
  const [query, setQuery] = useState("");
  const [sortBy] = useState("N°");
  const [sortDir] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState({ open: false, mode: "create", saving: false });
  const [form, setForm] = useState(EMPTY_FORM);
  const [ingress, setIngress] = useState({ open: false, product: null, quantity: "1", note: "", purchasePrice: "", saving: false });
  const [comboCatalog, setComboCatalog] = useState(() => loadComboCatalog());
  const [comboModal, setComboModal] = useState({ open: false, saving: false, mode: "create", comboId: "" });
  const [comboForm, setComboForm] = useState(EMPTY_COMBO_FORM);
  const [comboProductOptions, setComboProductOptions] = useState([]);
  const deferredQuery = useDeferredValue(query);

  async function loadData({ page = pagination.page, pageSize = pagination.pageSize, keepMessage = true } = {}) {
    setLoading(true);
    if (!keepMessage) setMessage("");
    setError("");
    try {
      const [pageData, statsData] = await Promise.all([
        loadProductsPage({
          page,
          pageSize,
          q: deferredQuery,
          sortBy,
          sortDir
        }),
        loadProductsStats()
      ]);
      const nextItems = Array.isArray(pageData?.items) ? pageData.items.map(normalizeProduct) : [];
      setItems(nextItems);
      setStats(statsData || null);
      setPagination(pageData?.pagination || { page, pageSize, totalItems: nextItems.length, totalPages: 1 });
    } catch (err) {
      setError(err.message || "No se pudo cargar Gestión de productos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData({ page: 1, pageSize: pagination.pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery]);

  useEffect(() => {
    loadData({ page: pagination.page, pageSize: pagination.pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadProductsPage({ page: 1, pageSize: 120, sortBy: "N°", sortDir: "asc" })
      .then((pageData) => {
        const nextItems = Array.isArray(pageData?.items) ? pageData.items.map(normalizeProduct) : [];
        setComboProductOptions(nextItems);
      })
      .catch(() => {
        setComboProductOptions([]);
      });
  }, []);

  const computedStats = useMemo(() => {
    const totalCount = Number(stats?.total ?? 0);
    const lowStockCount = Number(stats?.lowStockCount ?? 0);
    const withOrder = Number(stats?.conPedido ?? 0);
    const stockTotal = Number(stats?.stockTotal ?? 0);
    return { totalCount, lowStockCount, withOrder, stockTotal };
  }, [stats]);

  const comboOptions = useMemo(() => comboProductOptions.filter((item) => item.status !== "INACTIVO"), [comboProductOptions]);

  function openCreateComboModal() {
    setComboForm(EMPTY_COMBO_FORM);
    setComboModal({ open: true, saving: false, mode: "create", comboId: "" });
  }

  function openEditComboModal(combo) {
    setComboForm({
      id: combo.id,
      badge: combo.badge || "",
      title: combo.title || "",
      summary: combo.summary || "",
      price: String(combo.price ?? 0),
      theme: combo.theme || "gold",
      imageUrl: combo.imageUrl || "",
      items: (combo.items || []).length
        ? combo.items.map((item) => ({ productId: String(item.productId || ""), quantity: String(item.quantity || 1) }))
        : [{ productId: "", quantity: "1" }]
    });
    setComboModal({ open: true, saving: false, mode: "edit", comboId: combo.id });
  }

  function updateComboItem(index, patch) {
    setComboForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    }));
  }

  function addComboItemRow() {
    setComboForm((current) => ({
      ...current,
      items: [...current.items, { productId: "", quantity: "1" }]
    }));
  }

  function removeComboItemRow(index) {
    setComboForm((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function handleDeleteCombo(comboId) {
    if (!window.confirm("¿Eliminar este combo promocional?")) return;
    const nextCatalog = comboCatalog.filter((combo) => combo.id !== comboId);
    setComboCatalog(saveComboCatalog(nextCatalog));
    setMessage("Combo eliminado.");
  }

  function handleSubmitCombo(event) {
    event.preventDefault();
    setComboModal((current) => ({ ...current, saving: true }));
    const normalizedItems = comboForm.items
      .filter((item) => item.productId)
      .map((item) => ({ productId: String(item.productId), quantity: Math.max(1, Number(item.quantity || 1)) }));

    const nextCombo = {
      id: comboForm.id || `combo-${Date.now()}`,
      badge: comboForm.badge,
      title: comboForm.title,
      summary: comboForm.summary,
      price: Number(comboForm.price || 0),
      theme: comboForm.theme,
      imageUrl: comboForm.imageUrl,
      items: normalizedItems
    };

    const nextCatalog =
      comboModal.mode === "create"
        ? [...comboCatalog, nextCombo]
        : comboCatalog.map((combo) => (combo.id === comboModal.comboId ? nextCombo : combo));

    setComboCatalog(saveComboCatalog(nextCatalog));
    setComboModal({ open: false, saving: false, mode: "create", comboId: "" });
    setComboForm(EMPTY_COMBO_FORM);
    setMessage(comboModal.mode === "create" ? "Combo creado correctamente." : "Combo actualizado correctamente.");
  }

  function openCreateModal() {
    setForm(EMPTY_FORM);
    setModal({ open: true, mode: "create", saving: false });
  }

  function openEditModal(product) {
    setForm(normalizeFormFromProduct(product));
    setModal({ open: true, mode: "edit", saving: false, product });
  }

  async function handleSubmitProduct(event) {
    event.preventDefault();
    setModal((current) => ({ ...current, saving: true }));
    setError("");
    try {
      const payload = buildPayloadFromForm(form, modal.mode);
      if (modal.mode === "create") {
        await createProduct(payload);
        setMessage("Producto creado correctamente.");
      } else {
        await updateProduct(modal.product.id, payload);
        setMessage(`Producto N° ${modal.product.id} actualizado.`);
      }
      setModal({ open: false, mode: "create", saving: false });
      setForm(EMPTY_FORM);
      await loadData({ page: 1, pageSize: pagination.pageSize, keepMessage: true });
    } catch (err) {
      setError(err.message || "No se pudo guardar el producto.");
      setModal((current) => ({ ...current, saving: false }));
    }
  }

  async function handleInactivate(product) {
    if (!window.confirm(`¿Inactivar ${product.name || `producto N° ${product.id}`}?`)) return;
    setError("");
    try {
      await inactivateProduct(product.id);
      setMessage(`Producto N° ${product.id} inactivado.`);
      await loadData({ page: pagination.page, pageSize: pagination.pageSize, keepMessage: true });
    } catch (err) {
      setError(err.message || "No se pudo inactivar el producto.");
    }
  }

  async function handleIngressSubmit(event) {
    event.preventDefault();
    if (!ingress.product) return;
    setIngress((current) => ({ ...current, saving: true }));
    setError("");
    try {
      await registerProductIngress(ingress.product.id, {
        cantidad: Number(ingress.quantity || 0),
        nota: ingress.note,
        precio_compra: ingress.purchasePrice ? Number(ingress.purchasePrice) : undefined
      });
      setMessage(`Ingreso registrado para N° ${ingress.product.id}.`);
      setIngress({ open: false, product: null, quantity: "1", note: "", purchasePrice: "", saving: false });
      await loadData({ page: pagination.page, pageSize: pagination.pageSize, keepMessage: true });
    } catch (err) {
      setError(err.message || "No se pudo registrar el ingreso.");
      setIngress((current) => ({ ...current, saving: false }));
    }
  }

  return (
    <>
      {(message || error) ? (
        <p className={error ? "react-admin-error" : "react-admin-message"}>{error || message}</p>
      ) : null}

      <div className="react-admin-kpis">
        <article className="react-admin-kpi react-admin-kpi-primary">
          <span>Registrados</span>
          <strong>{formatQty(computedStats.totalCount)}</strong>
          <small>Total del catálogo</small>
        </article>
        <article className="react-admin-kpi">
          <span>Stock bajo</span>
          <strong>{formatQty(computedStats.lowStockCount)}</strong>
          <small>Con alerta operativa</small>
        </article>
        <article className="react-admin-kpi">
          <span>Con pedido</span>
          <strong>{formatQty(computedStats.withOrder)}</strong>
          <small>Reposición planificada</small>
        </article>
        <article className="react-admin-kpi">
          <span>Stock total</span>
          <strong>{formatQty(computedStats.stockTotal)}</strong>
          <small>Unidades disponibles</small>
        </article>
      </div>

      <article className="react-admin-filter-card">
        <div className="react-admin-filter-head">
          <div>
            <span className="react-admin-filter-kicker">Gestión operativa</span>
            <h2>Listado y edición de productos</h2>
          </div>
          <button type="button" onClick={openCreateModal}>Crear producto</button>
        </div>
        <div className="react-admin-products-toolbar">
          <label className="react-admin-filter-search">
            Buscar
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPagination((current) => ({ ...current, page: 1 }));
              }}
              placeholder="N°, nombre, categoría, estado, precio o stock"
            />
          </label>

          <label className="react-admin-inline-select">
            Filas
            <select
              value={pagination.pageSize}
              onChange={(event) => {
                const nextSize = Number(event.target.value);
                setPagination((current) => ({ ...current, pageSize: nextSize, page: 1 }));
                loadData({ page: 1, pageSize: nextSize });
              }}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>
      </article>

      <article className="react-admin-table-card">
        <div className="react-admin-table-head">
          <div>
            <h2>Catálogo operativo</h2>
            <small>{loading ? "Actualizando productos..." : `${pagination.totalItems || items.length} registros`}</small>
          </div>
          <div className="react-admin-pagination">
            <button
              type="button"
              disabled={!pagination.hasPrev || loading}
              onClick={() => loadData({ page: pagination.page - 1, pageSize: pagination.pageSize })}
            >
              Anterior
            </button>
            <span>Página {pagination.page || 1} de {pagination.totalPages || 1}</span>
            <button
              type="button"
              disabled={!pagination.hasNext || loading}
              onClick={() => loadData({ page: pagination.page + 1, pageSize: pagination.pageSize })}
            >
              Siguiente
            </button>
          </div>
        </div>

        <div className="react-admin-table-wrap">
          <table className="react-admin-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Alerta</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((product) => (
                  <tr key={product.id}>
                    <td>{product.code || "-"}</td>
                    <td>
                      <div className="react-admin-product-cell">
                        <strong>{product.name || "-"}</strong>
                        <small>{product.description || "Sin descripción"}</small>
                      </div>
                    </td>
                    <td>{product.category || "OTRO"}</td>
                    <td>{money(product.price)}</td>
                    <td>
                      <div className="react-admin-product-cell">
                        <strong>{formatQty(product.stock)}</strong>
                        <small>Mín. {formatQty(product.stockMin)} · Máx. {formatQty(product.stockMax)}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`react-admin-tag react-admin-tag-${product.alertKey}`}>{product.alertLabel}</span>
                    </td>
                    <td>
                      <span className={`react-admin-tag react-admin-tag-${product.status === "INACTIVO" ? "muted" : "ok"}`}>
                        {product.status}
                      </span>
                    </td>
                    <td>
                      <div className="react-admin-actions">
                        <button type="button" onClick={() => setIngress({ open: true, product, quantity: "1", note: "", purchasePrice: String(product.purchasePrice || "") })}>
                          Ingreso
                        </button>
                        <button type="button" onClick={() => openEditModal(product)}>Editar</button>
                        <button type="button" className="is-danger" onClick={() => handleInactivate(product)}>Inactivar</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8">No hay productos para este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="react-admin-table-card">
        <div className="react-admin-table-head">
          <div>
            <h2>Combos promocionales</h2>
            <small>{comboCatalog.length} combos listos para la vitrina horizontal de la tienda</small>
          </div>
          <div className="react-admin-actions">
            <button type="button" onClick={openCreateComboModal}>Crear combo</button>
          </div>
        </div>
        <div className="react-admin-combo-grid">
          {comboCatalog.map((combo) => (
            <article key={combo.id} className={`react-admin-combo-card is-${combo.theme}`}>
              <span>{combo.badge || "Combo"}</span>
              <strong>{combo.title}</strong>
              <small>{combo.summary || "Sin resumen"}</small>
              <b>{money(combo.price)}</b>
              <p>{(combo.items || []).length} productos asignados</p>
              <div className="react-admin-actions">
                <button type="button" onClick={() => openEditComboModal(combo)}>Editar</button>
                <button type="button" className="is-danger" onClick={() => handleDeleteCombo(combo.id)}>Eliminar</button>
              </div>
            </article>
          ))}
        </div>
      </article>

      {modal.open ? (
        <div className="react-admin-modal-backdrop">
          <div className="react-admin-modal">
            <div className="react-admin-modal-head">
              <div>
                <span className="react-admin-filter-kicker">{modal.mode === "create" ? "Nuevo producto" : "Editar producto"}</span>
                <h3>{modal.mode === "create" ? "Crear producto" : `Producto N° ${modal.product?.id || ""}`}</h3>
              </div>
              <button type="button" className="react-admin-icon-close" onClick={() => setModal({ open: false, mode: "create", saving: false })}>×</button>
            </div>
            <form className="react-admin-form-grid" onSubmit={handleSubmitProduct}>
              <label>
                N°
                <input
                  type="number"
                  min="1"
                  value={form.id}
                  disabled={modal.mode === "edit"}
                  onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                />
              </label>
              <label className="is-span-2">
                Nombre
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label className="is-span-3">
                Descripción
                <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                Categoría
                <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value.toUpperCase() }))} />
              </label>
              <label>
                Precio
                <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} />
              </label>
              <label>
                Precio compra
                <input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => setForm((current) => ({ ...current, purchasePrice: event.target.value }))} />
              </label>
              <label>
                Stock actual
                <input type="number" min="0" step="1" value={form.stockActual} onChange={(event) => setForm((current) => ({ ...current, stockActual: event.target.value }))} />
              </label>
              <label>
                Stock mínimo
                <input type="number" min="0" step="1" value={form.stockMin} onChange={(event) => setForm((current) => ({ ...current, stockMin: event.target.value }))} />
              </label>
              <label>
                Stock máximo
                <input type="number" min="0" step="1" value={form.stockMax} onChange={(event) => setForm((current) => ({ ...current, stockMax: event.target.value }))} />
              </label>
              <label>
                Estado
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                </select>
              </label>
              <div className="react-admin-modal-actions is-span-3">
                <button type="button" className="react-admin-link react-admin-link-soft" onClick={() => setModal({ open: false, mode: "create", saving: false })}>
                  Cancelar
                </button>
                <button type="submit" className="react-admin-link" disabled={modal.saving}>
                  {modal.saving ? "Guardando..." : modal.mode === "create" ? "Crear producto" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {ingress.open ? (
        <div className="react-admin-modal-backdrop">
          <div className="react-admin-modal react-admin-modal-sm">
            <div className="react-admin-modal-head">
              <div>
                <span className="react-admin-filter-kicker">Ingreso</span>
                <h3>{ingress.product?.name || "Producto"}</h3>
              </div>
              <button type="button" className="react-admin-icon-close" onClick={() => setIngress({ open: false, product: null, quantity: "1", note: "", purchasePrice: "", saving: false })}>×</button>
            </div>
            <form className="react-admin-form-grid" onSubmit={handleIngressSubmit}>
              <label>
                Cantidad
                <input type="number" min="1" step="1" value={ingress.quantity} onChange={(event) => setIngress((current) => ({ ...current, quantity: event.target.value }))} required />
              </label>
              <label>
                Precio compra
                <input type="number" min="0" step="0.01" value={ingress.purchasePrice} onChange={(event) => setIngress((current) => ({ ...current, purchasePrice: event.target.value }))} />
              </label>
              <label className="is-span-2">
                Nota
                <textarea value={ingress.note} onChange={(event) => setIngress((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <div className="react-admin-modal-actions is-span-2">
                <button type="button" className="react-admin-link react-admin-link-soft" onClick={() => setIngress({ open: false, product: null, quantity: "1", note: "", purchasePrice: "", saving: false })}>
                  Cancelar
                </button>
                <button type="submit" className="react-admin-link" disabled={ingress.saving}>
                  {ingress.saving ? "Registrando..." : "Guardar ingreso"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {comboModal.open ? (
        <div className="react-admin-modal-backdrop">
          <div className="react-admin-modal">
            <div className="react-admin-modal-head">
              <div>
                <span className="react-admin-filter-kicker">{comboModal.mode === "create" ? "Nuevo combo" : "Editar combo"}</span>
                <h3>{comboModal.mode === "create" ? "Crear combo promocional" : comboForm.title || "Editar combo"}</h3>
              </div>
              <button type="button" className="react-admin-icon-close" onClick={() => setComboModal({ open: false, saving: false, mode: "create", comboId: "" })}>×</button>
            </div>
            <form className="react-admin-form-grid" onSubmit={handleSubmitCombo}>
              <label>
                ID
                <input value={comboForm.id} onChange={(event) => setComboForm((current) => ({ ...current, id: event.target.value }))} placeholder="combo-pre" />
              </label>
              <label>
                Badge
                <input value={comboForm.badge} onChange={(event) => setComboForm((current) => ({ ...current, badge: event.target.value }))} placeholder="Mas pedido" />
              </label>
              <label>
                Tema
                <select value={comboForm.theme} onChange={(event) => setComboForm((current) => ({ ...current, theme: event.target.value }))}>
                  {COMBO_THEMES.map((theme) => (
                    <option key={theme.value} value={theme.value}>{theme.label}</option>
                  ))}
                </select>
              </label>
              <label className="is-span-2">
                Titulo
                <input value={comboForm.title} onChange={(event) => setComboForm((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label>
                Precio
                <input type="number" min="0" step="0.01" value={comboForm.price} onChange={(event) => setComboForm((current) => ({ ...current, price: event.target.value }))} />
              </label>
              <label className="is-span-3">
                Resumen comercial
                <textarea value={comboForm.summary} onChange={(event) => setComboForm((current) => ({ ...current, summary: event.target.value }))} placeholder="12 chelas + hielo + snacks" />
              </label>
              <label className="is-span-3">
                Imagen promocional
                <input value={comboForm.imageUrl} onChange={(event) => setComboForm((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://... o /uploads/..." />
              </label>

              <div className="is-span-3 react-admin-combo-items">
                <div className="react-admin-table-head">
                  <div>
                    <h2>Productos del combo</h2>
                    <small>Selecciona productos y cantidades para el row horizontal de combos.</small>
                  </div>
                  <div className="react-admin-actions">
                    <button type="button" onClick={addComboItemRow}>Agregar fila</button>
                  </div>
                </div>
                <div className="react-admin-combo-item-list">
                  {comboForm.items.map((item, index) => (
                    <div key={`${comboModal.comboId || "new"}-${index}`} className="react-admin-combo-item-row">
                      <label>
                        Producto
                        <select value={item.productId} onChange={(event) => updateComboItem(index, { productId: event.target.value })}>
                          <option value="">Selecciona un producto</option>
                          {comboOptions.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.code || product.id} · {product.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Cantidad
                        <input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateComboItem(index, { quantity: event.target.value })} />
                      </label>
                      <div className="react-admin-actions">
                        <button type="button" className="is-danger" onClick={() => removeComboItemRow(index)}>Quitar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="react-admin-modal-actions is-span-3">
                <button type="button" className="react-admin-link react-admin-link-soft" onClick={() => setComboModal({ open: false, saving: false, mode: "create", comboId: "" })}>
                  Cancelar
                </button>
                <button type="submit" className="react-admin-link" disabled={comboModal.saving}>
                  {comboModal.saving ? "Guardando..." : comboModal.mode === "create" ? "Crear combo" : "Guardar combo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
