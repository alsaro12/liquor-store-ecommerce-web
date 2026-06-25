import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import CardQuantityControl from "../CardQuantityControl.jsx";
import { createCombo, loadCombos } from "../combosApi.js";
import { getCachedProducts, loadComboEditorProducts, loadProducts, resolveProductImage } from "../storefrontApi.js";
import comboImageUnavailable from "../../../assets/storefront/combos/combo-image-unavailable-red.png";
import comboHeroProduct from "../../../assets/storefront/combos/combo-full.png";
import comboHeroBackground from "../../../assets/storefront/combos/fondopublicidad.png";

const EMPTY_COMBO_FORM = {
  title: "",
  badge: "",
  tipo: "general",
  summary: "",
  discountType: "amount",
  discountValue: "0",
  imageUrl: "",
  imageData: "",
  imageName: "",
  items: [{ productId: "", quantity: "1" }]
};

const COMBO_PAGE_SIZE = 18;
const COMBO_SKELETON_COUNT = 18;

const COMBO_FEATURES = [
  { icon: "⚡", title: "Siempre encuentras", text: "Stock real al instante" },
  { icon: "🧊", title: "Hielo y mixers", text: "Ya incluidos en el combo" },
  { icon: "🚚", title: "Llega rápido", text: "Listo para tu reunión" }
];

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function buildPaginationItems(pageInput, totalInput) {
  const total = Math.max(1, Number(totalInput) || 1);
  const page = Math.min(total, Math.max(1, Number(pageInput) || 1));
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const items = [];
  for (let current = start; current <= end; current += 1) items.push(current);
  if (end < total - 1) items.push("ellipsis");
  if (end < total) items.push(total);
  return items;
}

function productById(products, id) {
  return products.find((product) => String(product.id) === String(id));
}

function comboItemProductKey(item) {
  if (!item) return "";
  if (item.variantId) return `${item.productId}::${item.variantId}`;
  return String(item.productId || "");
}

function comboProductPayload(productId) {
  const raw = String(productId || "");
  const [parentProductId, variantId] = raw.split("::");
  return {
    productId: parentProductId || raw,
    variantId: variantId || ""
  };
}

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function comboStockLimit(combo, products) {
  const items = (combo?.items || [])
    .map((item) => {
      const product = productById(products, comboItemProductKey(item));
      return product ? { product, quantity: Math.max(1, Number(item.quantity || 1)) } : null;
    })
    .filter(Boolean);
  if (!items.length) return 0;
  return items.reduce((limit, { product, quantity }) => {
    const stock = Math.max(0, Number(product.stock || 0));
    return Math.min(limit, Math.floor(stock / quantity));
  }, 99);
}

function comboBasePrice(items, products) {
  return items.reduce((sum, item) => {
    const product = productById(products, comboItemProductKey(item));
    const quantity = Math.max(1, Number(item.quantity || 1));
    return product ? sum + Number(product.price || 0) * quantity : sum;
  }, 0);
}

function comboDiscount(basePrice, type, value) {
  const amount = Math.max(0, Number(value || 0));
  if (type === "percent") return Math.min(basePrice, basePrice * (amount / 100));
  return Math.min(basePrice, amount);
}

function comboHasStock(combo, products) {
  const items = Array.isArray(combo.items) ? combo.items : [];
  if (!items.length) return false;
  return items.every((item) => {
    const product = productById(products, comboItemProductKey(item));
    const quantity = Math.max(1, Number(item.quantity || 1));
    return product && product.status !== "INACTIVO" && Number(product.stock || 0) >= quantity;
  });
}

function comboIsVisible(combo) {
  const status = String(combo?.estado || combo?.status || "ACTIVO").toUpperCase();
  return status !== "INACTIVO";
}

function suggestTitle(items, products) {
  const selected = items.map((item) => productById(products, comboItemProductKey(item))).filter(Boolean);
  const categories = [...new Set(selected.map((product) => product.category).filter(Boolean))].slice(0, 2);
  if (categories.length) return `Combo ${categories.join(" + ")}`;
  return "Combo personalizado";
}

function normalizeComboRecord(combo) {
  return {
    id: String(combo?.id || `combo-${Date.now()}`),
    slug: String(combo?.slug || combo?.id || `combo-${Date.now()}`),
    title: String(combo?.title || combo?.nombre || "Combo promocional"),
    summary: String(combo?.summary || combo?.descripcion || ""),
    badge: String(combo?.badge || ""),
    tipo: String(combo?.tipo || "general"),
    theme: String(combo?.theme || combo?.tema || "gold"),
    price: Number(combo?.price || combo?.precio || 0),
    priceBefore: combo?.priceBefore || combo?.precio_antes ? Number(combo.priceBefore || combo.precio_antes) : null,
    imageUrl: String(combo?.imageUrl || ""),
    imageData: String(combo?.imageData || ""),
    imageHash: String(combo?.imageHash || ""),
    coverStyle: String(combo?.coverStyle || "manual"),
    coverText: String(combo?.coverText || ""),
    items: Array.isArray(combo?.items) ? combo.items : []
  };
}

function buildPreviewProducts(sourceItems, products) {
  const resolved = (Array.isArray(sourceItems) ? sourceItems : [])
    .map((item) => (item?.id && item?.name ? item : productById(products, comboItemProductKey(item))))
    .filter(Boolean);
  const seen = new Set();
  return resolved
    .filter((product) => {
      const key = String(product.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Number(right.price || 0) - Number(left.price || 0))
    .slice(0, 5);
}

function buildPreviewSlots(selectedProducts) {
  const [center, left, right, farLeft, farRight] = selectedProducts;
  return [
    farLeft ? { product: farLeft, slot: "far-left" } : null,
    left ? { product: left, slot: "left" } : null,
    center ? { product: center, slot: "center" } : null,
    right ? { product: right, slot: "right" } : null,
    farRight ? { product: farRight, slot: "far-right" } : null
  ].filter(Boolean);
}

function ComboPreviewProduct({ product }) {
  const [failed, setFailed] = useState(false);
  const image = resolveProductImage(product);
  if (image && !failed) return <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <i>{String(product?.category || "COMBO").slice(0, 10)}</i>;
}

function ComboImage({ image }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = !failed && image ? image : comboImageUnavailable;
  return (
    <div className="combo-card-image-stage">
      <img
        src={src}
        alt=""
        loading="lazy"
        className={`${loaded ? "is-loaded" : "is-loading"}${!failed && image ? "" : " is-fallback"}`}
        onLoad={() => window.setTimeout(() => setLoaded(true), 80)}
        onError={() => {
          setFailed(true);
          setLoaded(false);
        }}
      />
    </div>
  );
}

function ComboSkeletonCard() {
  return (
    <article className="combo-card is-loading" aria-hidden="true">
      <div className="combo-card-media">
        <div className="combo-card-image-stage">
          <span className="combo-card-skeleton is-media" />
        </div>
      </div>
      <div className="combo-card-body">
        <span className="combo-card-skeleton is-title" />
        <span className="combo-card-skeleton is-summary" />
        <div className="combo-card-foot">
          <span className="combo-card-skeleton is-price" />
          <span className="combo-card-skeleton is-button" />
        </div>
      </div>
    </article>
  );
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la imagen del combo."));
    image.src = src;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function buildOptimizedComboImage(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImageElement(source);
  const maxWidth = 1280;
  const originalWidth = image.naturalWidth || image.width || 1;
  const originalHeight = image.naturalHeight || image.height || 1;
  const width = Math.min(maxWidth, originalWidth);
  const height = Math.max(1, Math.round(originalHeight * (width / originalWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se pudo preparar la imagen del combo.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return {
    imageData: canvas.toDataURL("image/webp", 0.82),
    imageName: file.name,
    width,
    height
  };
}

export default function CombosPage({
  onAddCombo,
  onRemoveCombo,
  comboQuantities,
  onOpenCombo,
  onGoCatalog,
  favoriteComboIds,
  onToggleFavorite
}) {
  const [combos, setCombos] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [productCategoryFilters, setProductCategoryFilters] = useState([]);
  const [page, setPage] = useState(1);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorStep, setCreatorStep] = useState("products");
  const [creatorSaving, setCreatorSaving] = useState(false);
  const [comboImageState, setComboImageState] = useState({ processing: false, error: "" });
  const [form, setForm] = useState(EMPTY_COMBO_FORM);

  useEffect(() => {
    let cancelled = false;
    const cachedProducts = getCachedProducts();
    if (cachedProducts.length) setProducts(cachedProducts);
    setLoading(true);
    loadCombos({ force: true })
      .then((items) => {
        if (cancelled) return;
        const remoteCombos = (Array.isArray(items) ? items : []).map(normalizeComboRecord);
        setCombos(remoteCombos);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "No se pudieron cargar los combos.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    loadComboEditorProducts()
      .catch(() => loadProducts().catch(() => []))
      .then((productItems) => {
        if (cancelled) return;
        setProducts((current) => (Array.isArray(productItems) && productItems.length ? productItems : current));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const basePrice = useMemo(() => comboBasePrice(form.items, products), [form.items, products]);
  const discount = useMemo(
    () => comboDiscount(basePrice, form.discountType, form.discountValue),
    [basePrice, form.discountType, form.discountValue]
  );
  const finalPrice = Math.max(0, basePrice - discount);
  const comboLineItems = useMemo(
    () =>
      form.items.map((item) => {
        const product = productById(products, comboItemProductKey(item));
        const quantity = Math.max(1, Number(item.quantity || 1));
        return {
          ...item,
          product,
          quantity,
          subtotal: product ? Number(product.price || 0) * quantity : 0,
          stockOk: !!product && Number(product.stock || 0) >= quantity
        };
      }),
    [form.items, products]
  );
  const selectedUnits = comboLineItems.reduce((sum, item) => sum + (item.product ? item.quantity : 0), 0);
  const validComboItems = comboLineItems.filter((item) => item.product);
  const canContinueToDetails = validComboItems.length > 0 && validComboItems.every((item) => item.stockOk);
  const canPublish = comboHasStock(form, products);
  const comboEditorProducts = useMemo(
    () =>
      [...products].sort((left, right) => {
        const leftId = Number(left?.id);
        const rightId = Number(right?.id);
        if (Number.isFinite(leftId) && Number.isFinite(rightId)) return leftId - rightId;
        if (Number.isFinite(leftId)) return -1;
        if (Number.isFinite(rightId)) return 1;
        return String(left?.id || "").localeCompare(String(right?.id || ""), "es", { numeric: true });
      }),
    [products]
  );
  const productCategoryOptions = useMemo(() => {
    const categories = new Map();
    for (const product of products) {
      const key = normalizeCategoryKey(product?.category);
      if (!key || categories.has(key)) continue;
      categories.set(key, String(product.category).trim().toUpperCase());
    }
    return [
      { value: "TODOS", label: "TODOS" },
      ...[...categories.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], "es", { sensitivity: "base" }))
        .map(([value, label]) => ({ value, label }))
    ];
  }, [products]);
  const selectedCategoryLabels = useMemo(
    () =>
      productCategoryOptions
        .filter((option) => option.value !== "TODOS" && productCategoryFilters.includes(option.value))
        .map((option) => option.label),
    [productCategoryFilters, productCategoryOptions]
  );
  const productCategoryFilterLabel = selectedCategoryLabels.length ? selectedCategoryLabels.join(" + ") : "TODOS";
  const filtered = useMemo(() => {
    const visible = combos.filter(comboIsVisible);
    if (!productCategoryFilters.length) return visible;
    const selectedCategories = new Set(productCategoryFilters);
    return visible.filter((combo) => {
      const items = Array.isArray(combo.items) ? combo.items : [];
      return items.some((item) => {
        const product = productById(products, comboItemProductKey(item));
        return selectedCategories.has(normalizeCategoryKey(product?.category));
      });
    });
  }, [combos, productCategoryFilters, products]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / COMBO_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginationItems = useMemo(() => buildPaginationItems(currentPage, totalPages), [currentPage, totalPages]);
  const visibleCombos = useMemo(() => {
    const start = (currentPage - 1) * COMBO_PAGE_SIZE;
    return filtered.slice(start, start + COMBO_PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [productCategoryFilters]);

  function toggleProductCategoryFilter(value) {
    setProductCategoryFilters((current) => (
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    ));
  }

  function goToPage(nextPage) {
    const safePage = Math.min(totalPages, Math.max(1, Number(nextPage) || 1));
    setPage(safePage);
    requestAnimationFrame(() => {
      document.querySelector(".combos-catalog-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderPagination(position) {
    if (loading || !filtered.length) return null;
    return (
      <div className={`official-product-pagination is-${position}`}>
        <span>Página {currentPage} de {totalPages}</span>
        <div className="official-product-pagination-controls" aria-label="Paginación de combos">
          <button type="button" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>Anterior</button>
          <div className="official-product-page-numbers">
            {paginationItems.map((item, index) =>
              item === "ellipsis" ? (
                <span key={`combo-ellipsis-${index}`} className="official-product-page-ellipsis">...</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={Number(item) === currentPage ? "is-active" : ""}
                  disabled={Number(item) === currentPage}
                  onClick={() => goToPage(item)}
                  aria-current={Number(item) === currentPage ? "page" : undefined}
                >
                  {item}
                </button>
              )
            )}
          </div>
          <button type="button" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>Siguiente</button>
        </div>
      </div>
    );
  }

  function resolveComboImage(combo) {
    if (combo.imageUrl) return combo.imageUrl;
    if (combo.imageData) return combo.imageData;
    return "";
  }

  function updateItem(index, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    }));
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, { productId: "", quantity: "1" }] }));
  }

  function removeItem(index) {
    setForm((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index)
    }));
  }

  function closeCreator() {
    setCreatorOpen(false);
    setCreatorStep("products");
    setComboImageState({ processing: false, error: "" });
    setForm(EMPTY_COMBO_FORM);
  }

  async function handleComboImageSelection(event) {
    const file = Array.from(event.target.files || [])[0];
    if (!file) return;
    setComboImageState({ processing: true, error: "" });
    try {
      const optimized = await buildOptimizedComboImage(file);
      setForm((current) => ({
        ...current,
        imageUrl: optimized.imageData,
        imageData: optimized.imageData,
        imageName: optimized.imageName
      }));
      setComboImageState({ processing: false, error: "" });
    } catch (err) {
      setComboImageState({ processing: false, error: err.message || "No se pudo procesar la imagen." });
    } finally {
      event.target.value = "";
    }
  }

  function removeComboImage() {
    setForm((current) => ({ ...current, imageUrl: "", imageData: "", imageName: "" }));
    setComboImageState({ processing: false, error: "" });
  }

  async function saveCombo() {
    if (!canPublish) {
      setError("No se puede publicar: todos los productos deben tener stock suficiente.");
      return;
    }
    const cleanItems = form.items
      .filter((item) => item.productId)
      .map((item) => ({
        ...comboProductPayload(item.productId),
        quantity: Math.max(1, Number(item.quantity || 1))
      }));
    const nextCombo = normalizeComboRecord({
      id: `combo-${Date.now()}`,
      slug: `combo-${Date.now()}`,
      title: form.title || suggestTitle(form.items, products),
      badge: form.badge || (discount ? `Ahorras ${formatMoney(discount)}` : "Nuevo combo"),
      tipo: "general",
      theme: "gold",
      summary:
        form.summary ||
        form.items.map((item) => `${Math.max(1, Number(item.quantity || 1))}x ${productById(products, comboItemProductKey(item))?.name || "Producto"}`).join(" + "),
      price: finalPrice,
      priceBefore: basePrice,
      imageUrl: form.imageUrl,
      imageData: form.imageData,
      imageName: form.imageName,
      coverStyle: "manual",
      coverText: "",
      items: cleanItems
    });
    setCreatorSaving(true);
    let saved = false;
    try {
      const savedCombo = normalizeComboRecord(await createCombo(nextCombo));
      setCombos((current) => [...current, savedCombo]);
      setError("");
      saved = true;
    } catch (err) {
      setError(err?.message || "No se pudo guardar el combo en la base de datos.");
    } finally {
      setCreatorSaving(false);
      if (saved) closeCreator();
    }
  }

  return (
    <section className="page-shell page-combos">
      <header className="combos-hero-showcase">
        <img className="combos-hero-bg" src={comboHeroBackground} alt="" aria-hidden="true" />
        <div className="combos-hero-copy">
          <span>Combos nocturnos</span>
          <h1>COMBOS PARA <b>CADA PLAN</b></h1>
        </div>
        <div className="combos-hero-stage" aria-hidden="true">
          <img className="combos-hero-product" src={comboHeroProduct} alt="" />
        </div>
        <ul className="combos-feature-bar">
          {COMBO_FEATURES.map((feature) => (
            <li key={feature.title}>
              <span aria-hidden="true">{feature.icon}</span>
              <div>
                <strong>{feature.title}</strong>
                <small>{feature.text}</small>
              </div>
            </li>
          ))}
        </ul>
      </header>

      <div className="official-product-panel combos-catalog-panel">
        <div className="official-section-head">
          <div>
            <div className="official-section-kicker">Catalogo de combos</div>
            <small>{filtered.length} combos disponibles</small>
          </div>
          <button type="button" className="page-cta combos-catalog-create" onClick={() => setCreatorOpen(true)}>Crear combo</button>
        </div>

        <div className="combos-product-filter" aria-label="Filtro de combos por categoria de producto">
          <div className="combos-product-filter-field">
            <span>Categoría</span>
            <details>
              <summary>
                <b>{productCategoryFilterLabel}</b>
              </summary>
              <div className="combos-product-filter-menu">
                <button type="button" className={!productCategoryFilters.length ? "is-active" : ""} onClick={() => setProductCategoryFilters([])}>
                  TODOS
                </button>
                {productCategoryOptions.filter((option) => option.value !== "TODOS").map((option) => (
                  <label key={option.value}>
                    <input
                      type="checkbox"
                      checked={productCategoryFilters.includes(option.value)}
                      onChange={() => toggleProductCategoryFilter(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        </div>

        {error ? <p className="page-status page-status-error">{error}</p> : null}
        {renderPagination("top")}

        {loading ? (
          <div className="combos-grid" aria-busy="true">
            {Array.from({ length: COMBO_SKELETON_COUNT }, (_, index) => <ComboSkeletonCard key={`combo-skeleton-${index}`} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="page-empty">
            <div className="page-empty-icon" aria-hidden="true">🍻</div>
            <h3>No hay combos con productos de esta categoría</h3>
            <p>Prueba con otra categoría o vuelve a Todos.</p>
            <div className="combo-empty-actions">
              <button type="button" className="page-cta" onClick={() => setCreatorOpen(true)}>Crear combo</button>
              <button type="button" className="page-cta page-cta-soft" onClick={onGoCatalog}>Ir al catálogo</button>
            </div>
          </div>
        ) : (
          <div className="combos-grid">
            {visibleCombos.map((combo) => {
            const image = resolveComboImage(combo);
            const isFav = favoriteComboIds?.has(String(combo.id));
            return (
              <article
                key={combo.id}
                className={`combo-card theme-${combo.theme || "gold"}`}
                tabIndex={0}
                role="button"
                onClick={() => onOpenCombo?.(combo)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenCombo?.(combo);
                  }
                }}
              >
                <div className="combo-card-media">
                  <ComboImage image={image} />
                  {combo.badge ? <span className="combo-card-badge">{combo.badge}</span> : null}
                  <button
                    type="button"
                    className={`combo-card-heart${isFav ? " is-active" : ""}`}
                    aria-label={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                    aria-pressed={!!isFav}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite?.(combo);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill={isFav ? "currentColor" : "none"} aria-hidden="true">
                      <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
                <div className="combo-card-body">
                  <strong>{combo.title}</strong>
                  <small>{combo.summary}</small>
                  <div className="combo-card-foot">
                <div className="combo-card-price">
                  {combo.priceBefore ? <span className="combo-card-old">{formatMoney(combo.priceBefore)}</span> : null}
                  <b>{formatMoney(combo.price)}</b>
                </div>
                    <CardQuantityControl
                      quantity={comboQuantities?.get?.(`combo:${combo.id}`) || 0}
                      max={comboStockLimit(combo, products)}
                      aria-label={`Agregar ${combo.title} al carrito`}
                      onIncrement={() => onAddCombo?.(combo)}
                      onDecrement={() => onRemoveCombo?.(combo)}
                      className="is-combo-card"
                    />
                  </div>
                </div>
              </article>
            );
            })}
          </div>
        )}

        {renderPagination("bottom")}
      </div>

      <div className="combos-cta-footer">
        <p>¿No encuentras tu combo ideal?</p>
        <button type="button" className="page-cta" onClick={() => setCreatorOpen(true)}>CREAR MI COMBO</button>
      </div>

      {creatorOpen ? createPortal((
        <div className="combo-creator-backdrop">
          <form className="combo-creator" onSubmit={(event) => event.preventDefault()}>
            <header>
              <div>
                <span>Nuevo combo</span>
                <h2>Arma y publica</h2>
              </div>
              <button type="button" aria-label="Cerrar" onClick={closeCreator}>×</button>
            </header>

            <div className="combo-creator-steps">
              {[
                ["products", "Productos"],
                ["price", "Detalles"]
              ].map(([key, label]) => (
                <button key={key} type="button" className={creatorStep === key ? "is-active" : ""} onClick={() => setCreatorStep(key)}>
                  {label}
                </button>
              ))}
            </div>

            {creatorStep === "products" ? (
              <section className="combo-creator-panel">
                <div className="combo-creator-section-head">
                  <strong>Productos del combo</strong>
                  <small>Elige productos reales del inventario y define cuántas unidades incluye.</small>
                </div>
                <div className="combo-products-layout">
                  <div className="combo-creator-list">
                  {comboLineItems.map((item, index) => {
                    const product = item.product;
                    const quantity = item.quantity;
                    const rowOk = item.stockOk;
                    const image = product ? resolveProductImage(product) : "";
                    return (
                      <div key={`combo-row-${index}`} className="combo-creator-row">
                        <div className="combo-creator-product-thumb">
                          {image ? <img src={image} alt="" /> : <span>{product ? product.category : "Producto"}</span>}
                        </div>
                        <label>
                          Producto
                          <select
                            value={item.productId}
                            onChange={(event) => updateItem(index, { productId: event.target.value })}
                          >
                            <option value="">Selecciona un producto</option>
                            {comboEditorProducts.map((productItem) => (
                              <option key={productItem.id} value={productItem.id}>
                                {productItem.id} · {productItem.name} · {formatMoney(productItem.price)}
                                {productItem.status === "INACTIVO" ? " · INACTIVO" : Number(productItem.stock || 0) <= 0 ? " · Sin stock" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Cantidad
                          <input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} />
                        </label>
                        <div className="combo-creator-line-total" aria-label="Precio">
                          <span>{product ? formatMoney(product.price) : "S/ 0.00"}</span>
                          <strong>{formatMoney(item.subtotal)}</strong>
                        </div>
                        <strong className={rowOk ? "is-ok" : "is-blocked"}>{product ? (rowOk ? "Stock OK" : "Sin stock") : "Pendiente"}</strong>
                        <button type="button" onClick={() => removeItem(index)}>Quitar</button>
                      </div>
                    );
                  })}
                  <button type="button" className="combo-creator-add" onClick={addItem}>Agregar producto</button>
                  <div className="combo-creator-mobile-deal">
                    <div>
                      <span>Descuento</span>
                      <strong>{formatMoney(discount)}</strong>
                      <small>{selectedUnits} unidad(es) en el combo</small>
                    </div>
                    <label>
                      Tipo
                      <select value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value }))}>
                        <option value="amount">Soles</option>
                        <option value="percent">Porcentaje</option>
                      </select>
                    </label>
                    <label>
                      Valor
                      <input type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => setForm((current) => ({ ...current, discountValue: event.target.value }))} />
                    </label>
                    <div className="combo-creator-mobile-total">
                      <span>Total final</span>
                      <b>{formatMoney(finalPrice)}</b>
                    </div>
                  </div>
                  </div>
                </div>
              </section>
            ) : null}

            {creatorStep === "price" ? (
              <section className="combo-creator-panel combo-creator-grid">
                <div className="combo-creator-section-head is-wide">
                  <strong>Detalles comerciales</strong>
                  <small>Completa la ficha que verá el cliente y confirma el precio final.</small>
                </div>
                <label>
                  Nombre del combo
                  <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={suggestTitle(form.items, products)} />
                </label>
                <label>
                  Etiqueta visible
                  <input value={form.badge} onChange={(event) => setForm((current) => ({ ...current, badge: event.target.value }))} placeholder="Más pedido" />
                </label>
                <label>
                  Tipo de descuento
                  <select value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value }))}>
                    <option value="amount">Soles</option>
                    <option value="percent">Porcentaje</option>
                  </select>
                </label>
                <label>
                  Valor del descuento
                  <input type="number" min="0" step="0.01" value={form.discountValue} onChange={(event) => setForm((current) => ({ ...current, discountValue: event.target.value }))} />
                </label>
                <div className="combo-creator-price">
                  <span>Suma catálogo</span><b>{formatMoney(basePrice)}</b>
                  <span>Ahorro</span><b>{formatMoney(discount)}</b>
                  <span>Precio final</span><strong>{formatMoney(finalPrice)}</strong>
                </div>
                <label className="is-wide">
                  Resumen comercial
                  <textarea value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} placeholder="Ron + hielo + mixers" />
                </label>
                <div className="combo-creator-image-upload is-wide">
                  <div>
                    <strong>Imagen del combo</strong>
                    <small>Sube la imagen final que verá el cliente. Se optimiza automáticamente para cargar rápido.</small>
                  </div>
                  <div className="combo-creator-image-body">
                    <div className={`combo-creator-image-preview${form.imageUrl ? " has-image" : ""}`}>
                      {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <span>Sin imagen</span>}
                    </div>
                    <div className="combo-creator-image-actions">
                      <label>
                        <input type="file" accept="image/*" onChange={handleComboImageSelection} disabled={comboImageState.processing} />
                        {comboImageState.processing ? "Procesando..." : form.imageUrl ? "Cambiar imagen" : "Subir imagen"}
                      </label>
                      {form.imageUrl ? <button type="button" onClick={removeComboImage}>Quitar</button> : null}
                      {form.imageName ? <small>{form.imageName}</small> : null}
                      {comboImageState.error ? <small className="is-error">{comboImageState.error}</small> : null}
                    </div>
                  </div>
                </div>
                <div className="combo-creator-detail-review is-wide">
                  <div>
                    <span className={canPublish ? "is-ok" : "is-blocked"}>{canPublish ? "Listo para publicar" : "Revisa stock"}</span>
                    <strong>{form.title || suggestTitle(form.items, products)}</strong>
                    <small>{validComboItems.length} producto(s) · {selectedUnits} unidad(es)</small>
                  </div>
                  <ul>
                    {validComboItems.length ? validComboItems.map((line, index) => (
                      <li key={`detail-${line.product.id}-${index}`}>
                        <span>{line.quantity}x {line.product.name}</span>
                        <b>{formatMoney(line.subtotal)}</b>
                      </li>
                    )) : <li><span>Selecciona productos en el paso anterior.</span></li>}
                  </ul>
                </div>
              </section>
            ) : null}

            <footer>
              <button type="button" className="page-cta page-cta-soft" onClick={closeCreator} disabled={creatorSaving}>Cancelar</button>
              {creatorStep === "products" ? (
                <button type="button" className="page-cta" onClick={() => setCreatorStep("price")} disabled={creatorSaving || !canContinueToDetails}>Continuar</button>
              ) : (
                <button type="button" className="page-cta" disabled={!canPublish || creatorSaving} onClick={saveCombo}>{creatorSaving ? "Publicando..." : "Publicar combo"}</button>
              )}
            </footer>
          </form>
        </div>
      ), document.body) : null}
    </section>
  );
}
