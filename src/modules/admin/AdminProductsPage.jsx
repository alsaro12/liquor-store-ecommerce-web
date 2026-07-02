import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { COMBO_THEMES, loadComboCatalog, saveComboCatalog } from "../combos/comboCatalog.js";
import {
  createProduct,
  createCombo,
  deleteCombo,
  inactivateProduct,
  loadCombosAll,
  loadProductsPage,
  loadProductsAll,
  loadProductsStats,
  loadRuntimeStatus,
  registerProductIngress,
  updateCombo,
  updateProduct
} from "./adminApi.js";
import { formatQty, money, normalizeProduct, normalizeText } from "./adminRules.js";
import { PRODUCT_CATEGORY_OPTIONS, normalizeProductCategory } from "../productCategories.js";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  category: "Aperitivos y Digestivos",
  price: "0",
  purchasePrice: "0",
  baseFlavor: "",
  baseStock: "0",
  stockMax: "0",
  stockMin: "0",
  stockActual: "0",
  status: "ACTIVO",
  images: [],
  cigarettePresentations: [
    { id: "unit", label: "Unidad", units: 1, enabled: true, price: "0" },
    { id: "box10", label: "Caja x10", units: 10, enabled: false, price: "0" },
    { id: "box20", label: "Caja x20", units: 20, enabled: false, price: "0" }
  ],
  cigaretteStockLink: {
    enabled: false,
    unitProductId: "",
    unitVariantId: "",
    box20ProductId: "",
    box20VariantId: "",
    rules: [],
    unitsPerBox: 20
  },
  variants: []
};

function normalizeFormCategory(value) {
  return normalizeProductCategory(value);
}

const EMPTY_COMBO_FORM = {
  id: "",
  badge: "",
  title: "",
  summary: "",
  price: "0",
  theme: "gold",
  imageUrl: "",
  imageData: "",
  items: [{ productId: "", quantity: "1" }]
};

function normalizeFormFromProduct(item) {
  const product = normalizeProduct(item);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const baseVariant = variants.find((variant) => variant.id === "__base") || null;
  const extraVariants = variants.filter((variant) => variant.id !== "__base");
  const baseStock = baseVariant ? Number(baseVariant.stock || 0) : Number(product.stock || 0);
  return {
    id: product.code ? String(product.code) : "",
    name: product.name,
    description: product.description,
    category: normalizeFormCategory(product.category),
    price: String(product.price ?? 0),
    purchasePrice: String(product.purchasePrice ?? 0),
    baseFlavor: baseVariant?.name || "",
    baseStock: String(baseStock),
    stockMax: String(product.stockMax ?? 0),
    stockMin: String(product.stockMin ?? 0),
    stockActual: String(product.stock ?? 0),
    status: product.status || "ACTIVO",
    images: Array.isArray(product.images) ? product.images.slice(0, 3) : [],
    cigarettePresentations: normalizeCigarettePresentationsForForm(product.cigarettePresentations, product.price),
    cigaretteStockLink: normalizeCigaretteStockLink(product.cigaretteStockLink),
    variants: extraVariants
  };
}

function normalizeCigaretteStockLink(value) {
  const source = value && typeof value === "object" ? value : {};
  const legacyRule = {
    unitProductId: String(source.unitProductId || source.unit_product_id || ""),
    unitVariantId: String(source.unitVariantId || source.unit_variant_id || ""),
    box20ProductId: String(source.box20ProductId || source.box20_product_id || ""),
    box20VariantId: String(source.box20VariantId || source.box20_variant_id || ""),
    unitsPerBox: Number(source.unitsPerBox || source.units_per_box || 20) || 20
  };
  const rulesSource = Array.isArray(source.rules) ? source.rules : Array.isArray(source.reglas) ? source.reglas : [];
  const rules = rulesSource
    .map((rule) => ({
      unitProductId: String(rule?.unitProductId || rule?.unit_product_id || ""),
      unitVariantId: String(rule?.unitVariantId || rule?.unit_variant_id || ""),
      box20ProductId: String(rule?.box20ProductId || rule?.box20_product_id || ""),
      box20VariantId: String(rule?.box20VariantId || rule?.box20_variant_id || ""),
      unitsPerBox: Number(rule?.unitsPerBox || rule?.units_per_box || 20) || 20
    }))
    .filter((rule) => rule.unitProductId || rule.box20ProductId);
  if (!rules.length && (legacyRule.unitProductId || legacyRule.box20ProductId)) {
    rules.push(legacyRule);
  }
  const firstRule = rules[0] || legacyRule;
  return {
    enabled: source.enabled === true && rules.some((rule) => rule.unitProductId && rule.box20ProductId),
    unitProductId: firstRule.unitProductId,
    unitVariantId: firstRule.unitVariantId,
    box20ProductId: firstRule.box20ProductId,
    box20VariantId: firstRule.box20VariantId,
    rules,
    unitsPerBox: 20
  };
}

function emptyCigaretteStockRule() {
  return {
    unitProductId: "",
    unitVariantId: "",
    box20ProductId: "",
    box20VariantId: "",
    unitsPerBox: 20
  };
}

function adminProductOptionId(product) {
  return String(product?.code || product?.id || product?.["N°"] || "").trim();
}

function adminProductVariants(product) {
  return Array.isArray(product?.variants)
    ? product.variants
    : Array.isArray(product?.VARIANTES)
      ? product.VARIANTES
      : [];
}

function findAdminProductOption(products, id) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return null;
  return (Array.isArray(products) ? products : []).find((product) => adminProductOptionId(product) === cleanId) || null;
}

function ScrollableAdminSelect({ value, placeholder, disabled = false, options = [], onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value || ""));
  const displayText = selected?.label || placeholder;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className={`react-admin-scroll-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="react-admin-scroll-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{displayText}</span>
        <b aria-hidden="true">v</b>
      </button>
      {open ? (
        <div className="react-admin-scroll-select-menu" role="listbox">
          <button
            type="button"
            className={!value ? "is-active" : ""}
            role="option"
            aria-selected={!value}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={String(option.value) === String(value || "") ? "is-active" : ""}
              role="option"
              aria-selected={String(option.value) === String(value || "")}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeCigarettePresentationsForForm(value, basePrice = 0) {
  const source = Array.isArray(value) ? value : [];
  const rows = EMPTY_FORM.cigarettePresentations.map((preset) => {
    const item = source.find((entry) => String(entry?.id || entry?.tipo || "").toLowerCase() === preset.id);
    return {
      ...preset,
      enabled: item ? item.enabled !== false && item.activo !== false : preset.id === "unit",
      price: String(item?.price ?? item?.precio ?? (preset.id === "unit" ? basePrice : "0"))
    };
  });
  const activeIndex = rows.findIndex((item) => item.enabled);
  return rows.map((item, index) => ({
    ...item,
    enabled: activeIndex < 0 ? item.id === "unit" : index === activeIndex
  }));
}

function buildCigarettePresentationsPayload(form) {
  return normalizeCigarettePresentationsForForm(form.cigarettePresentations, form.price).map((item) => ({
    id: item.id,
    label: item.label,
    units: Number(item.units || 1),
    reportUnits: item.id === "box20" ? 20 : 1,
    enabled: Boolean(item.enabled),
    price: item.enabled ? Number(item.price || 0) : 0
  }));
}

function resolveCigaretteBasePrice(form) {
  const presentations = buildCigarettePresentationsPayload(form);
  const active = presentations.find((item) => item.enabled && Number(item.price || 0) > 0);
  return Number(active?.price || 0);
}

function validateCigarettePresentations(form) {
  const presentations = buildCigarettePresentationsPayload(form);
  const active = presentations.filter((item) => item.enabled);
  if (!active.length) {
    throw new Error("Activa al menos una presentacion de cigarro.");
  }
  const missingPrice = active.find((item) => Number(item.price || 0) <= 0);
  if (missingPrice) {
    throw new Error(`Ingresa el precio de ${missingPrice.label}.`);
  }
}

function selectedCigarettePresentationId(form) {
  const selected = normalizeCigarettePresentationsForForm(form.cigarettePresentations, form.price)
    .find((item) => item.enabled);
  return selected?.id || "unit";
}

function selectedCigarettePresentationPrice(form) {
  const selected = normalizeCigarettePresentationsForForm(form.cigarettePresentations, form.price)
    .find((item) => item.enabled);
  return Number(selected?.price || 0);
}

function buildVariantId(name, index) {
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `variante-${index + 1}`;
}

function buildVariantsPayload(variants, form = null) {
  const baseFlavor = String(form?.baseFlavor || "").trim();
  const baseStock = Number(form?.baseStock || 0);
  const category = normalizeFormCategory(form?.category);
  const isCigarette = category === "Cigarros";
  const cigarettePrice = isCigarette ? selectedCigarettePresentationPrice(form) : null;
  const extras = (Array.isArray(variants) ? variants : [])
    .map((variant, index) => {
      const name = String(variant.name || "").trim();
      if (!name) return null;
      return {
        id: String(variant.id || buildVariantId(name, index)).trim(),
        name,
        description: String(variant.description || "").trim(),
        price: isCigarette ? cigarettePrice : variant.price === "" || variant.price === null || variant.price === undefined ? null : Number(variant.price || 0),
        purchasePrice: variant.purchasePrice === "" || variant.purchasePrice === null || variant.purchasePrice === undefined ? null : Number(variant.purchasePrice || 0),
        stock: Number(variant.stock || 0),
        stockMin: Number(variant.stockMin || 0),
        stockMax: Number(variant.stockMax || 0),
        status: variant.status || "ACTIVO",
        images: Array.isArray(variant.images) ? variant.images.slice(0, 3) : []
      };
    })
    .filter(Boolean);
  return [
    {
      id: "__base",
      name: baseFlavor || "Original",
      description: String(form?.description || "").trim(),
      price: isCigarette ? cigarettePrice : null,
      purchasePrice: null,
      stock: baseStock,
      stockMin: Number(form?.stockMin || 0),
      stockMax: Number(form?.stockMax || 0),
      status: form?.status || "ACTIVO",
      images: Array.isArray(form?.images) ? form.images.slice(0, 3) : []
    },
    ...extras
  ];
}

function buildPayloadFromForm(form, mode) {
  const category = normalizeFormCategory(form.category);
  const isCigarette = category === "Cigarros";
  const payload = {
    NOMBRE: form.name,
    DESCRIPCION: form.description,
    CATEGORIA: category,
    PRECIO: isCigarette ? resolveCigaretteBasePrice(form) : Number(form.price || 0),
    PRECIO_COMPRA: Number(form.purchasePrice || 0),
    STOCK_MAXIMO: Number(form.stockMax || 0),
    STOCK_MINIMO: Number(form.stockMin || 0),
    STOCK_BASE_ACTUAL: Number(form.baseStock || 0),
    STOCK_ACTUAL: Number(form.stockActual || 0),
    ESTADO: form.status,
    IMAGENES: Array.isArray(form.images) ? form.images.slice(0, 3) : [],
    CIGARRO_PRESENTACIONES: buildCigarettePresentationsPayload(form),
    CIGARRO_STOCK_LINK: isCigarette ? normalizeCigaretteStockLink(form.cigaretteStockLink) : { enabled: false },
    VARIANTES: buildVariantsPayload(form.variants, form)
  };
  if (mode === "create" && form.id) {
    payload["N°"] = Number(form.id);
  }
  return payload;
}

function productImagePreview(image) {
  return String(
    image?.thumb_webp_url ||
    image?.filtered_image_url ||
    image?.original_webp_url ||
    image?.original_image_url ||
    ""
  ).trim();
}

function productCoverImage(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  return productImagePreview(images[0]);
}

function buildPaginationItems(pageInput, totalInput) {
  const total = Math.max(1, Number(totalInput) || 1);
  const page = Math.min(total, Math.max(1, Number(pageInput) || 1));
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const items = [];
  for (let current = start; current <= end; current += 1) {
    items.push(current);
  }
  if (end < total - 1) items.push("ellipsis");
  if (end < total) items.push(total);
  return items;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer una de las imágenes."));
    img.src = src;
  });
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function buildOptimizedProductImage(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImageElement(source);
  const maxWidth = 1280;
  const originalWidth = image.naturalWidth || image.width || 1;
  const originalHeight = image.naturalHeight || image.height || 1;
  const width = Math.min(maxWidth, originalWidth);
  const height = Math.max(1, Math.round(originalHeight * (width / originalWidth)));
  const thumbWidth = Math.min(640, width);
  const thumbHeight = Math.max(1, Math.round(height * (thumbWidth / width)));

  function renderToWebp(targetWidth, targetHeight, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL("image/webp", quality);
  }

  return {
    original_image_url: renderToWebp(width, height, 0.82),
    filtered_image_url: renderToWebp(thumbWidth, thumbHeight, 0.78),
    original_webp_url: renderToWebp(width, height, 0.82),
    thumb_webp_url: renderToWebp(thumbWidth, thumbHeight, 0.78),
    mime: "image/webp",
    width,
    height,
    status: "completed"
  };
}

export default function AdminProductsPage({ quickIngressRequest = 0 } = {}) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
  const [query, setQuery] = useState("");
  const [sortBy] = useState("N°");
  const [sortDir] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState({ open: false, mode: "create", saving: false });
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageState, setImageState] = useState({ processing: false, error: "" });
  const [ingress, setIngress] = useState({ open: false, product: null, quantity: "1", note: "", purchasePrice: "", saving: false });
  const [comboCatalog, setComboCatalog] = useState(() => loadComboCatalog());
  const [comboModal, setComboModal] = useState({ open: false, saving: false, mode: "create", comboId: "" });
  const [comboForm, setComboForm] = useState(EMPTY_COMBO_FORM);
  const [comboImageState, setComboImageState] = useState({ processing: false, error: "" });
  const [comboProductOptions, setComboProductOptions] = useState([]);
  const [cigaretteLinkModal, setCigaretteLinkModal] = useState({ open: false });
  const [cigaretteLinkDraft, setCigaretteLinkDraft] = useState(emptyCigaretteStockRule());
  const [cigaretteLinkEditingIndex, setCigaretteLinkEditingIndex] = useState(null);
  const productsCacheRef = useRef(new Map());
  const statsCacheRef = useRef(null);
  const latestProductsLoadRef = useRef(0);
  const deferredQuery = useDeferredValue(query);
  const paginationItems = useMemo(
    () => buildPaginationItems(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages]
  );

  function buildProductsCacheKey({ page, pageSize, q, sortBy: nextSortBy, sortDir: nextSortDir }) {
    return JSON.stringify({ page, pageSize, q: q || "", sortBy: nextSortBy || "", sortDir: nextSortDir || "" });
  }

  function clearProductsCache() {
    productsCacheRef.current.clear();
    statsCacheRef.current = null;
  }

  async function loadData({ page = pagination.page, pageSize = pagination.pageSize, keepMessage = true, force = false } = {}) {
    const loadId = latestProductsLoadRef.current + 1;
    latestProductsLoadRef.current = loadId;
    const request = { page, pageSize, q: deferredQuery, sortBy, sortDir };
    const cacheKey = buildProductsCacheKey(request);
    const cachedPage = productsCacheRef.current.get(cacheKey);
    const cachedStats = statsCacheRef.current;
    if (!force && cachedPage) {
      setItems(cachedPage.items);
      setPagination(cachedPage.pagination);
      if (cachedStats) setStats(cachedStats);
      setError("");
      if (!keepMessage) setMessage("");
      return;
    }

    setLoading(true);
    if (!keepMessage) setMessage("");
    setError("");
    try {
      const [pageData, statsData] = await Promise.all([
        loadProductsPage(request),
        cachedStats ? Promise.resolve(cachedStats) : loadProductsStats()
      ]);
      if (loadId !== latestProductsLoadRef.current) return;
      const nextItems = Array.isArray(pageData?.items) ? pageData.items.map(normalizeProduct) : [];
      const nextPagination = pageData?.pagination || { page, pageSize, totalItems: nextItems.length, totalPages: 1 };
      setItems(nextItems);
      setStats(statsData || null);
      setPagination(nextPagination);
      productsCacheRef.current.set(cacheKey, { items: nextItems, pagination: nextPagination });
      if (statsData) statsCacheRef.current = statsData;
    } catch (err) {
      if (loadId !== latestProductsLoadRef.current) return;
      setError(err.message || "No se pudo cargar Gestión de productos.");
    } finally {
      if (loadId !== latestProductsLoadRef.current) return;
      setLoading(false);
    }
  }

  function goToProductsPage(targetPage) {
    const totalPages = Math.max(1, Number(pagination.totalPages || 1));
    const nextPage = Math.min(totalPages, Math.max(1, Number(targetPage) || 1));
    if (nextPage === Number(pagination.page || 1)) return;
    setPagination((current) => ({ ...current, page: nextPage }));
    loadData({ page: nextPage, pageSize: pagination.pageSize, keepMessage: true, force: true });
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
    loadCombosAll()
      .then((items) => {
        const normalized = Array.isArray(items) ? items.map((combo, index) => ({
          ...combo,
          id: String(combo.slug || combo.id || `combo-${index}`),
          imageUrl: combo.imageUrl || "",
          items: Array.isArray(combo.items) ? combo.items : []
        })) : [];
        if (normalized.length) setComboCatalog(saveComboCatalog(normalized));
      })
      .catch(() => {
        // Mantiene el catálogo local como respaldo visible si el backend no responde.
      });
  }, []);

  useEffect(() => {
    loadProductsAll()
      .then((pageData) => {
        const nextItems = Array.isArray(pageData?.items) ? pageData.items.map(normalizeProduct) : Array.isArray(pageData) ? pageData.map(normalizeProduct) : [];
        setComboProductOptions(nextItems);
      })
      .catch(() => {
        setComboProductOptions([]);
      });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(text, type = "success") {
    setToast({ text, type });
  }

  const computedStats = useMemo(() => {
    const totalCount = Number(stats?.total ?? 0);
    const lowStockCount = Number(stats?.lowStockCount ?? 0);
    const withOrder = Number(stats?.conPedido ?? 0);
    const stockTotal = Number(stats?.stockTotal ?? 0);
    return { totalCount, lowStockCount, withOrder, stockTotal };
  }, [stats]);

  const comboOptions = useMemo(() => [...comboProductOptions].sort((left, right) => {
    const leftNumber = Number(left.code ?? left.id);
    const rightNumber = Number(right.code ?? right.id);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return String(left.code || left.id || "").localeCompare(String(right.code || right.id || ""), "es", {
      numeric: true,
      sensitivity: "base"
    });
  }), [comboProductOptions]);
  const variantStockTotal = useMemo(() => (
    (Array.isArray(form.variants) ? form.variants : []).reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
  ), [form.variants]);
  const productStockTotal = Number(form.stockActual || 0);
  const isCigaretteForm = normalizeFormCategory(form.category) === "Cigarros";
  const cigaretteProductOptions = useMemo(() => (
    comboProductOptions.filter((product) => normalizeFormCategory(product.category) === "Cigarros")
  ), [comboProductOptions]);
  const cigaretteStockLink = normalizeCigaretteStockLink(form.cigaretteStockLink);

  useEffect(() => {
    if (!quickIngressRequest || !items.length || ingress.open) return;
    const target = items.find((item) => item.status !== "INACTIVO" && (item.alertKey === "out" || item.alertKey === "low")) ||
      items.find((item) => item.status !== "INACTIVO") ||
      items[0];
    if (!target) return;
    setIngress({
      open: true,
      product: target,
      quantity: "1",
      note: "",
      purchasePrice: String(target.purchasePrice || ""),
      saving: false
    });
  }, [quickIngressRequest, items, ingress.open]);

  function updateCigarettePresentation(id, patch) {
    setForm((current) => ({
      ...current,
      cigarettePresentations: normalizeCigarettePresentationsForForm(current.cigarettePresentations, current.price).map((item) => (
        item.id === id
          ? {
            ...item,
            ...patch,
            enabled: patch.enabled ?? item.enabled
          }
          : patch.enabled === true
            ? { ...item, enabled: false }
            : item
      ))
    }));
  }

  function updateCigaretteStockLink(patch) {
    setForm((current) => ({
      ...current,
      cigaretteStockLink: {
        ...normalizeCigaretteStockLink(current.cigaretteStockLink),
        ...patch,
        unitsPerBox: 20
      }
    }));
  }

  function updateCigaretteStockLinkRule(patch) {
    setCigaretteLinkDraft((current) => ({
      ...current,
      ...patch,
      unitsPerBox: 20
    }));
  }

  function addCigaretteStockLinkRule() {
    setForm((current) => {
      const currentLink = normalizeCigaretteStockLink(current.cigaretteStockLink);
      const nextRule = normalizeCigaretteStockLink({ rules: [cigaretteLinkDraft] }).rules[0] || emptyCigaretteStockRule();
      if (!nextRule.unitProductId || !nextRule.box20ProductId) {
        return current;
      }
      const nextRules = cigaretteLinkEditingIndex !== null
        ? currentLink.rules.map((rule, ruleIndex) => (ruleIndex === cigaretteLinkEditingIndex ? nextRule : rule))
        : [...currentLink.rules, nextRule];
      return {
        ...current,
        cigaretteStockLink: {
          ...currentLink,
          ...nextRules[0],
          enabled: true,
          rules: nextRules
        }
      };
    });
    setCigaretteLinkDraft(emptyCigaretteStockRule());
    setCigaretteLinkEditingIndex(null);
  }

  function editCigaretteStockLinkRule(index) {
    const rule = cigaretteStockLink.rules[index];
    if (!rule) return;
    setCigaretteLinkDraft({
      ...emptyCigaretteStockRule(),
      ...rule,
      unitsPerBox: 20
    });
    setCigaretteLinkEditingIndex(index);
  }

  function removeCigaretteStockLinkRule(index) {
    const wasEditingRemovedRule = cigaretteLinkEditingIndex === index;
    setForm((current) => {
      const currentLink = normalizeCigaretteStockLink(current.cigaretteStockLink);
      const nextRules = currentLink.rules.filter((_, ruleIndex) => ruleIndex !== index);
      return {
        ...current,
        cigaretteStockLink: {
          ...currentLink,
          ...(nextRules[0] || emptyCigaretteStockRule()),
          enabled: Boolean(nextRules.length),
          rules: nextRules
        }
      };
    });
    setCigaretteLinkEditingIndex((currentIndex) => {
      if (currentIndex === null) return null;
      if (currentIndex === index) return null;
      return currentIndex > index ? currentIndex - 1 : currentIndex;
    });
    if (wasEditingRemovedRule) {
      setCigaretteLinkDraft(emptyCigaretteStockRule());
    }
  }

  function buildCigaretteStockLinkRulesWithDraft(baseRules = []) {
    const draftRule = normalizeCigaretteStockLink({ rules: [cigaretteLinkDraft] }).rules[0] || emptyCigaretteStockRule();
    if (!draftRule.unitProductId || !draftRule.box20ProductId) {
      return baseRules;
    }
    if (cigaretteLinkEditingIndex !== null) {
      return baseRules.map((rule, ruleIndex) => (ruleIndex === cigaretteLinkEditingIndex ? draftRule : rule));
    }
    return [...baseRules, draftRule];
  }

  function openCreateComboModal() {
    setComboForm(EMPTY_COMBO_FORM);
    setComboImageState({ processing: false, error: "" });
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
      imageData: "",
      items: (combo.items || []).length
        ? combo.items.map((item) => ({ productId: String(item.productId || ""), quantity: String(item.quantity || 1) }))
        : [{ productId: "", quantity: "1" }]
    });
    setComboImageState({ processing: false, error: "" });
    setComboModal({ open: true, saving: false, mode: "edit", comboId: combo.id });
  }

  function closeComboModal() {
    setComboModal({ open: false, saving: false, mode: "create", comboId: "" });
    setComboImageState({ processing: false, error: "" });
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
    deleteCombo(comboId)
      .then(() => {
        const nextCatalog = comboCatalog.filter((combo) => combo.id !== comboId);
        setComboCatalog(saveComboCatalog(nextCatalog));
        setMessage("Combo eliminado.");
        showToast("Combo eliminado.");
      })
      .catch((err) => {
        const errorMessage = err.message || "No se pudo eliminar el combo.";
        setError(errorMessage);
        showToast(errorMessage, "error");
      });
  }

  async function handleComboImageSelection(event) {
    const file = Array.from(event.target.files || [])[0];
    if (!file) return;
    setComboImageState({ processing: true, error: "" });
    try {
      const optimized = await buildOptimizedProductImage(file);
      const preview = productImagePreview(optimized);
      setComboForm((current) => ({
        ...current,
        imageUrl: preview,
        imageData: optimized.original_webp_url || optimized.thumb_webp_url || preview
      }));
      setComboImageState({ processing: false, error: "" });
    } catch (err) {
      setComboImageState({ processing: false, error: err.message || "No se pudo procesar la imagen del combo." });
    } finally {
      event.target.value = "";
    }
  }

  function removeComboImage() {
    setComboForm((current) => ({ ...current, imageUrl: "", imageData: "" }));
    setComboImageState({ processing: false, error: "" });
  }

  async function handleSubmitCombo(event) {
    event.preventDefault();
    setComboModal((current) => ({ ...current, saving: true }));
    setError("");
    try {
      const normalizedItems = comboForm.items
        .filter((item) => item.productId)
        .map((item) => ({ productId: String(item.productId), quantity: Math.max(1, Number(item.quantity || 1)) }));

      const payload = {
        id: comboForm.id || `combo-${Date.now()}`,
        slug: comboForm.id || comboModal.comboId || undefined,
        badge: comboForm.badge,
        title: comboForm.title,
        summary: comboForm.summary,
        price: Number(comboForm.price || 0),
        theme: comboForm.theme,
        imageUrl: comboForm.imageData ? "" : comboForm.imageUrl,
        imageData: comboForm.imageData,
        items: normalizedItems
      };
      const savedCombo = comboModal.mode === "create"
        ? await createCombo(payload)
        : await updateCombo(comboModal.comboId, payload);
      const normalizedSaved = {
        ...savedCombo,
        id: String(savedCombo.slug || savedCombo.id || payload.id),
        imageUrl: savedCombo.imageUrl || comboForm.imageUrl || "",
        items: Array.isArray(savedCombo.items) ? savedCombo.items : normalizedItems
      };
      const nextCatalog =
        comboModal.mode === "create"
          ? [normalizedSaved, ...comboCatalog.filter((combo) => combo.id !== normalizedSaved.id)]
          : comboCatalog.map((combo) => (combo.id === comboModal.comboId ? normalizedSaved : combo));

      setComboCatalog(saveComboCatalog(nextCatalog));
      setComboModal({ open: false, saving: false, mode: "create", comboId: "" });
      setComboImageState({ processing: false, error: "" });
      setComboForm(EMPTY_COMBO_FORM);
      const successMessage = comboModal.mode === "create" ? "Combo creado correctamente." : "Combo actualizado correctamente.";
      setMessage(successMessage);
      showToast(successMessage);
    } catch (err) {
      const errorMessage = err.message || "No se pudo guardar el combo.";
      setError(errorMessage);
      showToast(errorMessage, "error");
      setComboModal((current) => ({ ...current, saving: false }));
    }
  }

  function openCreateModal() {
    setForm(EMPTY_FORM);
    setImageState({ processing: false, error: "" });
    setModal({ open: true, mode: "create", saving: false });
  }

  function openEditModal(product) {
    setForm(normalizeFormFromProduct(product));
    setImageState({ processing: false, error: "" });
    setModal({ open: true, mode: "edit", saving: false, product });
  }

  function closeProductModal() {
    setModal({ open: false, mode: "create", saving: false });
    setImageState({ processing: false, error: "" });
  }

  function openCigaretteLinkModal() {
    setCigaretteLinkDraft(emptyCigaretteStockRule());
    setCigaretteLinkEditingIndex(null);
    setCigaretteLinkModal({ open: true });
  }

  async function handleProductImageSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;
    const remainingSlots = Math.max(0, 3 - (Array.isArray(form.images) ? form.images.length : 0));
    if (!remainingSlots) {
      setImageState({ processing: false, error: "Solo se permiten hasta 3 imágenes por producto." });
      event.target.value = "";
      return;
    }
    const files = selectedFiles.slice(0, remainingSlots);
    setImageState({ processing: true, error: "" });
    try {
      const optimized = [];
      for (const file of files) {
        optimized.push(await buildOptimizedProductImage(file));
      }
      setForm((current) => ({
        ...current,
        images: [...(Array.isArray(current.images) ? current.images : []), ...optimized].slice(0, 3)
      }));
      setImageState({ processing: false, error: selectedFiles.length > remainingSlots ? "Solo se agregaron las primeras 3 imágenes permitidas." : "" });
    } catch (err) {
      setImageState({ processing: false, error: err.message || "No se pudieron procesar las imágenes." });
    } finally {
      event.target.value = "";
    }
  }

  function removeProductImage(index) {
    setForm((current) => ({
      ...current,
      images: (Array.isArray(current.images) ? current.images : []).filter((_, imageIndex) => imageIndex !== index)
    }));
  }

  function addVariant() {
    setForm((current) => ({
      ...current,
      variants: [
        ...(Array.isArray(current.variants) ? current.variants : []),
        {
          id: "",
          name: "",
          description: "",
          price: "",
          purchasePrice: "",
          stock: "0",
          stockMin: "0",
          stockMax: "0",
          status: "ACTIVO",
          images: []
        }
      ]
    }));
  }

  function updateVariant(index, patch) {
    setForm((current) => ({
      ...current,
      variants: (Array.isArray(current.variants) ? current.variants : []).map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, ...patch } : variant
      )
    }));
  }

  function removeVariant(index) {
    setForm((current) => ({
      ...current,
      variants: (Array.isArray(current.variants) ? current.variants : []).filter((_, variantIndex) => variantIndex !== index)
    }));
  }

  async function handleVariantImageSelection(index, event) {
    const file = Array.from(event.target.files || [])[0];
    if (!file) return;
    setImageState({ processing: true, error: "" });
    try {
      const image = await buildOptimizedProductImage(file);
      updateVariant(index, { images: [image] });
      setImageState({ processing: false, error: "" });
    } catch (err) {
      setImageState({ processing: false, error: err.message || "No se pudo procesar la imagen de la variante." });
    } finally {
      event.target.value = "";
    }
  }

  async function handleSubmitProduct(event) {
    event.preventDefault();
    setModal((current) => ({ ...current, saving: true }));
    setError("");
    try {
      await loadRuntimeStatus();
      if (normalizeFormCategory(form.category) === "Cigarros") {
        validateCigarettePresentations(form);
      }
      const payload = buildPayloadFromForm(form, modal.mode);
      let successMessage = "";
      if (modal.mode === "create") {
        await createProduct(payload);
        successMessage = "Producto creado correctamente.";
      } else {
        await updateProduct(modal.product.id, payload);
        successMessage = `Producto N° ${modal.product.id} actualizado.`;
      }
      setMessage(successMessage);
      showToast(successMessage);
      setModal({ open: false, mode: "create", saving: false });
      setImageState({ processing: false, error: "" });
      setForm(EMPTY_FORM);
      clearProductsCache();
      const nextPage = modal.mode === "create" ? 1 : pagination.page;
      loadData({ page: nextPage, pageSize: pagination.pageSize, keepMessage: true, force: true }).catch((err) => {
        const refreshMessage = err.message || "Se guardo, pero no se pudo refrescar la tabla.";
        setError(refreshMessage);
        showToast(refreshMessage, "error");
      });
    } catch (err) {
      const errorMessage = err.message || "No se pudo guardar el producto.";
      setError(errorMessage);
      showToast(errorMessage, "error");
      setModal((current) => ({ ...current, saving: false }));
    }
  }

  async function handleInactivate(product) {
    if (!window.confirm(`¿Inactivar ${product.name || `producto N° ${product.id}`}?`)) return;
    setError("");
    try {
      await inactivateProduct(product.id);
      setMessage(`Producto N° ${product.id} inactivado.`);
      clearProductsCache();
      await loadData({ page: pagination.page, pageSize: pagination.pageSize, keepMessage: true, force: true });
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
      clearProductsCache();
      await loadData({ page: pagination.page, pageSize: pagination.pageSize, keepMessage: true, force: true });
    } catch (err) {
      setError(err.message || "No se pudo registrar el ingreso.");
      setIngress((current) => ({ ...current, saving: false }));
    }
  }

  return (
    <div className="react-admin-products-page">
      {toast ? (
        <div className={`react-admin-toast react-admin-toast-${toast.type}`} role="status" aria-live="polite">
          <strong>{toast.type === "error" ? "No se pudo completar" : "Cambio guardado"}</strong>
          <span>{toast.text}</span>
        </div>
      ) : null}

      {error ? <p className="react-admin-error">{error}</p> : null}

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

      <article className="react-admin-table-card">
        <div className="react-admin-products-head">
          <div>
            <span className="react-admin-filter-kicker">Gestión operativa</span>
            <h2>Catálogo operativo</h2>
            <small>{pagination.totalItems || items.length} registros</small>
          </div>
          <div className="react-admin-pagination">
            <button
              type="button"
              disabled={!pagination.hasPrev || loading}
              onClick={() => goToProductsPage(pagination.page - 1)}
            >
              Anterior
            </button>
            <div className="react-admin-page-numbers" aria-label="Paginas del catalogo">
              {paginationItems.map((item, index) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="react-admin-page-ellipsis">...</span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={Number(item) === Number(pagination.page || 1) ? "is-active" : ""}
                    disabled={loading || Number(item) === Number(pagination.page || 1)}
                    onClick={() => goToProductsPage(item)}
                    aria-label={`Ir a pagina ${item}`}
                    aria-current={Number(item) === Number(pagination.page || 1) ? "page" : undefined}
                  >
                    {item}
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              disabled={!pagination.hasNext || loading}
              onClick={() => goToProductsPage(pagination.page + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>

        <div className="react-admin-products-commandbar">
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

          <button type="button" className="react-admin-link" onClick={openCreateModal}>Crear producto</button>
        </div>

        <div className="react-admin-table-wrap">
          {loading ? (
            <div className="react-admin-loading-pill" role="status" aria-live="polite">
              <span className="react-admin-spinner" aria-hidden="true" />
              Cargando productos...
            </div>
          ) : null}
          <table className="react-admin-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Imagen</th>
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
                      <div className={`react-admin-product-image ${productCoverImage(product) ? "has-image" : "is-empty"}`}>
                        {productCoverImage(product) ? <img src={productCoverImage(product)} alt="" /> : <span>Sin imagen</span>}
                      </div>
                    </td>
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
                  <td colSpan="9">No hay productos para este filtro.</td>
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
              <button type="button" className="react-admin-icon-close" onClick={closeProductModal}>×</button>
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
                <select value={normalizeFormCategory(form.category)} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                  {PRODUCT_CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              {!isCigaretteForm ? (
                <label>
                  Precio
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  />
                </label>
              ) : null}
              <label>
                Precio compra
                <input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => setForm((current) => ({ ...current, purchasePrice: event.target.value }))} />
              </label>
              {isCigaretteForm ? (
                <div className="is-span-3 react-admin-cigarette-presentations">
                  <div>
                    <strong>Presentaciones de cigarro</strong>
                    <small>Unidad y caja x10 cuentan como 1 en el reporte. Caja x20 cuenta como 20 unidades.</small>
                  </div>
                  <div className="react-admin-cigarette-link-summary">
                    <div>
                      <strong>Enlace de stock unidad/caja x20</strong>
                      <small>
                        {cigaretteStockLink.enabled
                          ? `${cigaretteStockLink.rules.filter((rule) => rule.unitProductId && rule.box20ProductId).length} regla(s) activas de apertura por variante`
                          : "Sin enlace automático"}
                      </small>
                    </div>
                    <button type="button" onClick={openCigaretteLinkModal}>
                      Enlazar stock
                    </button>
                  </div>
                  <div className="react-admin-cigarette-presentation-grid">
                    {normalizeCigarettePresentationsForForm(form.cigarettePresentations, form.price).map((presentation) => (
                      <label key={presentation.id} className="react-admin-cigarette-presentation-row">
                        <span>
                          <input
                            type="radio"
                            name="cigarette-presentation"
                            checked={selectedCigarettePresentationId(form) === presentation.id}
                            onChange={() => updateCigarettePresentation(presentation.id, { enabled: true })}
                          />
                          {presentation.label}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={presentation.enabled ? presentation.price : "0"}
                          disabled={!presentation.enabled}
                          onChange={(event) => updateCigarettePresentation(presentation.id, { price: event.target.value })}
                          placeholder="Precio"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <label>
                Sabor variante 1
                <input value={form.baseFlavor} onChange={(event) => setForm((current) => ({ ...current, baseFlavor: event.target.value }))} placeholder="Original, clásico, sandía" />
              </label>
              <label>
                Stock variante 1
                <input type="number" min="0" step="1" value={form.baseStock} onChange={(event) => setForm((current) => ({ ...current, baseStock: event.target.value }))} />
              </label>
              <label>
                Stock total producto
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
              <div className="react-admin-stock-breakdown">
                <span><small>Otras variantes</small><strong>{formatQty(variantStockTotal)}</strong></span>
                <span><small>Stock total producto</small><strong>{formatQty(productStockTotal)}</strong></span>
              </div>
              <label>
                Estado
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                </select>
              </label>
              <div className="is-span-3 react-admin-image-field">
                <div className="react-admin-image-field-head">
                  <div>
                    <strong>Imágenes del producto</strong>
                    <small>Hasta 3 imágenes. Se optimizan automáticamente para carga rápida.</small>
                  </div>
                  <label className="react-admin-image-upload">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleProductImageSelection}
                      disabled={imageState.processing || (Array.isArray(form.images) ? form.images.length >= 3 : false)}
                    />
                    {imageState.processing ? "Procesando..." : "Agregar imágenes"}
                  </label>
                </div>
                {imageState.error ? <p className="react-admin-image-help is-error">{imageState.error}</p> : null}
                <div className="react-admin-image-grid">
                  {(Array.isArray(form.images) ? form.images : []).length ? (
                    form.images.map((image, index) => (
                      <article key={`product-image-${index}`} className="react-admin-image-card">
                        <div className="react-admin-image-thumb">
                          {productImagePreview(image) ? <img src={productImagePreview(image)} alt="" /> : <span>Sin vista previa</span>}
                        </div>
                        <div className="react-admin-image-meta">
                          <small>
                            {image.width && image.height ? `${image.width}x${image.height}` : "Optimizada"}
                          </small>
                          <button type="button" className="is-danger" onClick={() => removeProductImage(index)}>Quitar</button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="react-admin-image-empty">Aún no hay imágenes para este producto.</div>
                  )}
                </div>
              </div>
              <div className="is-span-3 react-admin-variants-field">
                <div className="react-admin-image-field-head">
                  <div>
                    <strong>Variantes de sabor</strong>
                    <small>Se muestran como productos separados en catálogo, pero se editan solo aquí.</small>
                  </div>
                  <button type="button" className="react-admin-image-upload" onClick={addVariant}>
                    Agregar variante
                  </button>
                </div>
                <div className="react-admin-variant-list">
                  {(Array.isArray(form.variants) ? form.variants : []).length ? (
                    form.variants.map((variant, index) => (
                      <article key={`variant-${index}`} className="react-admin-variant-card">
                        <div className="react-admin-variant-thumb">
                          {productImagePreview(variant.images?.[0]) ? <img src={productImagePreview(variant.images[0])} alt="" /> : <span>Sin foto</span>}
                        </div>
                        <label>
                          Sabor
                          <input value={variant.name || ""} onChange={(event) => updateVariant(index, { name: event.target.value })} placeholder="Original, Vainilla, Uva" />
                        </label>
                        <label>
                          Descripción
                          <input value={variant.description || ""} onChange={(event) => updateVariant(index, { description: event.target.value })} placeholder="Mismo tamaño, otro sabor" />
                        </label>
                        <label>
                          Precio
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={isCigaretteForm ? selectedCigarettePresentationPrice(form) : variant.price ?? ""}
                            disabled={isCigaretteForm}
                            onChange={(event) => updateVariant(index, { price: event.target.value })}
                            placeholder={isCigaretteForm ? selectedCigarettePresentationPrice(form) : form.price}
                          />
                        </label>
                        <label>
                          Stock
                          <input type="number" min="0" step="1" value={variant.stock ?? "0"} onChange={(event) => updateVariant(index, { stock: event.target.value })} />
                        </label>
                        <label>
                          Estado
                          <select value={variant.status || "ACTIVO"} onChange={(event) => updateVariant(index, { status: event.target.value })}>
                            <option value="ACTIVO">ACTIVO</option>
                            <option value="INACTIVO">INACTIVO</option>
                          </select>
                        </label>
                        <div className="react-admin-variant-actions">
                          <label className="react-admin-image-upload">
                            <input type="file" accept="image/*" onChange={(event) => handleVariantImageSelection(index, event)} />
                            Foto
                          </label>
                          {variant.images?.length ? <button type="button" onClick={() => updateVariant(index, { images: [] })}>Quitar foto</button> : null}
                          <button type="button" className="is-danger" onClick={() => removeVariant(index)}>Quitar</button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="react-admin-image-empty">Sin variantes. El producto se mostrará normal en catálogo.</div>
                  )}
                </div>
              </div>
              <div className="react-admin-modal-actions is-span-3">
                <button type="button" className="react-admin-link react-admin-link-soft" onClick={closeProductModal}>
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

      {cigaretteLinkModal.open ? (
        <div className="react-admin-modal-backdrop">
          <div className="react-admin-modal react-admin-modal-sm react-admin-cigarette-link-modal">
            <div className="react-admin-modal-head">
              <div>
                <span className="react-admin-filter-kicker">Cigarros</span>
                <h3>Enlazar stock automático</h3>
              </div>
              <button
                type="button"
                className="react-admin-icon-close"
                onClick={() => {
                  setCigaretteLinkDraft(emptyCigaretteStockRule());
                  setCigaretteLinkEditingIndex(null);
                  setCigaretteLinkModal({ open: false });
                }}
              >
                ×
              </button>
            </div>
            <div className="react-admin-form-grid">
              <div className="react-admin-cigarette-link-rules is-span-2">
                <div className="react-admin-cigarette-link-rule">
                  <div className="react-admin-cigarette-link-rule-head">
                    <strong>{cigaretteLinkEditingIndex === null ? "Regla nueva" : `Editando regla ${cigaretteLinkEditingIndex + 1}`}</strong>
                    <button type="button" className="is-danger" onClick={addCigaretteStockLinkRule} disabled={!cigaretteLinkDraft.unitProductId || !cigaretteLinkDraft.box20ProductId}>
                      {cigaretteLinkEditingIndex === null ? "Guardar regla en lista" : "Actualizar regla"}
                    </button>
                  </div>
                  <label>
                    Producto unidad
                    <ScrollableAdminSelect
                      value={cigaretteLinkDraft.unitProductId}
                      placeholder="Selecciona unidad"
                      options={cigaretteProductOptions.map((product) => ({
                        value: product.code || product.id,
                        label: `${product.code || product.id} · ${product.name}`
                      }))}
                      onChange={(nextValue) => updateCigaretteStockLinkRule({
                        unitProductId: nextValue,
                        unitVariantId: ""
                      })}
                    />
                  </label>
                  <label>
                    Variante unidad
                    <ScrollableAdminSelect
                      value={cigaretteLinkDraft.unitVariantId}
                      disabled={!adminProductVariants(findAdminProductOption(cigaretteProductOptions, cigaretteLinkDraft.unitProductId)).length}
                      placeholder="Sin variante especifica"
                      options={adminProductVariants(findAdminProductOption(cigaretteProductOptions, cigaretteLinkDraft.unitProductId)).map((variant) => ({
                        value: variant.id,
                        label: `${variant.name || variant.id} · stock ${variant.stock ?? 0}`
                      }))}
                      onChange={(nextValue) => updateCigaretteStockLinkRule({ unitVariantId: nextValue })}
                    />
                  </label>
                  <label>
                    Producto caja x20
                    <ScrollableAdminSelect
                      value={cigaretteLinkDraft.box20ProductId}
                      placeholder="Selecciona caja x20"
                      options={cigaretteProductOptions.map((product) => ({
                        value: product.code || product.id,
                        label: `${product.code || product.id} · ${product.name}`
                      }))}
                      onChange={(nextValue) => updateCigaretteStockLinkRule({
                        box20ProductId: nextValue,
                        box20VariantId: ""
                      })}
                    />
                  </label>
                  <label>
                    Variante caja x20
                    <ScrollableAdminSelect
                      value={cigaretteLinkDraft.box20VariantId}
                      disabled={!adminProductVariants(findAdminProductOption(cigaretteProductOptions, cigaretteLinkDraft.box20ProductId)).length}
                      placeholder="Sin variante especifica"
                      options={adminProductVariants(findAdminProductOption(cigaretteProductOptions, cigaretteLinkDraft.box20ProductId)).map((variant) => ({
                        value: variant.id,
                        label: `${variant.name || variant.id} · stock ${variant.stock ?? 0}`
                      }))}
                      onChange={(nextValue) => updateCigaretteStockLinkRule({ box20VariantId: nextValue })}
                    />
                  </label>
                </div>
                <div className="react-admin-cigarette-link-saved-head">
                  <strong>Reglas guardadas</strong>
                  <span>{cigaretteStockLink.rules.length} regla(s)</span>
                </div>
                {cigaretteStockLink.rules.length ? (
                  cigaretteStockLink.rules.map((rule, ruleIndex) => {
                    const unitProduct = findAdminProductOption(cigaretteProductOptions, rule.unitProductId);
                    const box20Product = findAdminProductOption(cigaretteProductOptions, rule.box20ProductId);
                    const unitVariants = adminProductVariants(unitProduct);
                    const box20Variants = adminProductVariants(box20Product);
                    return (
                      <div key={`cigarette-rule-${ruleIndex}`} className="react-admin-cigarette-link-rule is-saved">
                        <div className="react-admin-cigarette-link-rule-head">
                          <strong>Regla {ruleIndex + 1}</strong>
                          <span className="react-admin-cigarette-link-rule-actions">
                            <button type="button" onClick={() => editCigaretteStockLinkRule(ruleIndex)}>
                              Editar
                            </button>
                            <button type="button" className="is-danger" onClick={() => removeCigaretteStockLinkRule(ruleIndex)}>
                              Quitar
                            </button>
                          </span>
                        </div>
                        <div className="react-admin-cigarette-link-rule-summary">
                          <div>
                            <span>Producto unidad</span>
                            <strong>{unitProduct ? `${unitProduct.code || unitProduct.id} · ${unitProduct.name}` : "Sin producto"}</strong>
                          </div>
                          <div>
                            <span>Variante unidad</span>
                            <strong>
                              {rule.unitVariantId
                                ? (unitVariants.find((variant) => variant.id === rule.unitVariantId)?.name || rule.unitVariantId)
                                : "Sin variante especifica"}
                            </strong>
                          </div>
                          <div>
                            <span>Producto caja x20</span>
                            <strong>{box20Product ? `${box20Product.code || box20Product.id} · ${box20Product.name}` : "Sin producto"}</strong>
                          </div>
                          <div>
                            <span>Variante caja x20</span>
                            <strong>
                              {rule.box20VariantId
                                ? (box20Variants.find((variant) => variant.id === rule.box20VariantId)?.name || rule.box20VariantId)
                                : "Sin variante especifica"}
                            </strong>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="react-admin-image-empty">Aún no hay reglas guardadas.</div>
                )}
              </div>
              <div className="react-admin-cigarette-link-note is-span-2">
                <strong>Regla</strong>
                <span>Si la unidad o variante queda por debajo de 10 con la venta, se descuenta la caja x20 enlazada y se ingresan 20 unidades. La regla aplica aunque se haya creado desde otro producto.</span>
              </div>
              <div className="react-admin-modal-actions is-span-2">
                <button
                  type="button"
                  className="react-admin-link react-admin-link-soft"
                  onClick={() => {
                    updateCigaretteStockLink({ enabled: false, unitProductId: "", unitVariantId: "", box20ProductId: "", box20VariantId: "", rules: [] });
                    setCigaretteLinkDraft(emptyCigaretteStockRule());
                    setCigaretteLinkEditingIndex(null);
                    setCigaretteLinkModal({ open: false });
                  }}
                >
                  Quitar enlace
                </button>
                <button
                  type="button"
                  className="react-admin-link"
                  onClick={() => {
                    const rules = buildCigaretteStockLinkRulesWithDraft([...cigaretteStockLink.rules]);
                    updateCigaretteStockLink({
                      ...(rules[0] || emptyCigaretteStockRule()),
                      enabled: Boolean(rules.length),
                      rules
                    });
                    setCigaretteLinkDraft(emptyCigaretteStockRule());
                    setCigaretteLinkEditingIndex(null);
                    setCigaretteLinkModal({ open: false });
                  }}
                >
                  Guardar enlace
                </button>
              </div>
            </div>
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
              <button type="button" className="react-admin-icon-close" onClick={closeComboModal}>×</button>
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
              <div className="is-span-3 react-admin-image-field react-admin-combo-image-field">
                <div className="react-admin-image-field-head">
                  <div>
                    <strong>Imagen del combo</strong>
                    <small>Se optimiza antes de guardar y en Firebase queda solo una URL liviana.</small>
                  </div>
                  <label className="react-admin-image-upload">
                    <input type="file" accept="image/*" onChange={handleComboImageSelection} disabled={comboImageState.processing} />
                    {comboImageState.processing ? "Procesando..." : comboForm.imageUrl ? "Cambiar imagen" : "Agregar imagen"}
                  </label>
                </div>
                {comboImageState.error ? <p className="react-admin-image-help is-error">{comboImageState.error}</p> : null}
                <div className="react-admin-combo-image-preview">
                  {comboForm.imageUrl ? (
                    <>
                      <div className="react-admin-combo-image-thumb">
                        <img src={comboForm.imageUrl} alt="" />
                      </div>
                      <div>
                        <strong>Portada lista</strong>
                        <small>{comboForm.imageData ? "Optimizada para subir a Storage" : "URL guardada en el combo"}</small>
                        <button type="button" className="is-danger" onClick={removeComboImage}>Quitar imagen</button>
                      </div>
                    </>
                  ) : (
                    <div className="react-admin-image-empty">Aún no hay imagen para este combo.</div>
                  )}
                </div>
              </div>

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
                              {product.code || product.id} · {product.name}{product.status === "INACTIVO" ? " (INACTIVO)" : ""}
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
                <button type="button" className="react-admin-link react-admin-link-soft" onClick={closeComboModal}>
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
    </div>
  );
}


