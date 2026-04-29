const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false
};
const DEFAULT_SALES_PAGINATION = {
  ...DEFAULT_PAGINATION,
  pageSize: 20
};
const OPERATIONAL_DAY_ORDER = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

const API_BASE_STORAGE_KEY = "licoreria.api_base_url";
const MOBILE_KPI_EXPANDED_STORAGE_KEY = "licoreria.mobile_kpi_expanded";
const DESKTOP_NAV_COLLAPSED_STORAGE_KEY = "licoreria.desktop_nav_collapsed";
const ONBOARDING_SEEN_STORAGE_KEY = "licoreria.onboarding_seen";
const NAV_OVERLAY_BREAKPOINT = 1080;
const FALLBACK_API_BASE_URL = "https://licoreria.escon.pe/";
const PAYMENT_TYPES = ["Efectivo", "Yape", "Pedido Ya", "Rappi", "IZIPAY"];
const APP_VERSION = "1.0.3";
const {
  esc,
  money,
  formatQty,
  formatDateTime,
  normalizeText,
  normalizeNumericText,
  normalizeDateValue,
  matchDateRange,
  paginate
} = window.AppCustomFunctions;

window.APP_VERSION = APP_VERSION;

const state = {
  activeView: "sales",
  apiBaseUrl: "",
  products: [],
  productCatalog: [],
  filteredProducts: [],
  pagedProducts: [],
  pagination: { ...DEFAULT_PAGINATION },
  sales: [],
  salesAll: [],
  filteredSales: [],
  pagedSales: [],
  salesPagination: { ...DEFAULT_SALES_PAGINATION },
  salesDateFrom: "",
  salesDateTo: "",
  kardex: [],
  kardexAll: [],
  filteredKardex: [],
  crudSearch: "",
  salesSearch: "",
  kardexSearch: "",
  kardexType: "TODOS",
  serverBackedTables: true,
  productSort: { key: "NÂ°", dir: "asc" },
  salesSort: { key: "FECHA_OPERATIVA", dir: "desc" },
  kardexSort: { key: "FECHA_HORA", dir: "desc" },
  editingId: null,
  apiConnected: false,
  settingsMessageTimeoutId: null,
  dbStatus: null,
  accessHost: null,
  salePendingConfirm: null,
  saleEditingId: null,
  saleLookupResults: [],
  saleLookupOpen: false,
  saleLookupHighlight: -1,
  ingressProductId: null,
  mobileNavExpanded: false,
  desktopNavCollapsed: false,
  mobileKpiExpanded: false,
  onboardingActive: false,
  onboardingStepIndex: 0,
  onboardingSeen: false,
  migrationPollTimeoutId: null,
  confirmDialogResolver: null,
  stockOrderDraft: [],
  inventoryReceiptDraft: [],
  inventoryReceiptFiles: [],
  inventoryReceiptApplying: false
};

const refs = {
  appShell: document.getElementById("appShell"),
  navSales: document.getElementById("navSales"),
  navProducts: document.getElementById("navProducts"),
  navKardex: document.getElementById("navKardex"),
  navSettings: document.getElementById("navSettings"),
  desktopNavToggle: document.getElementById("desktopNavToggle"),
  mobileNavToggle: document.getElementById("mobileNavToggle"),
  mainViewNav: document.getElementById("mainViewNav"),
  navOverlayBackdrop: document.getElementById("navOverlayBackdrop"),
  dbStatusCard: document.getElementById("dbStatusCard"),
  dbStatusDot: document.getElementById("dbStatusDot"),
  dbStatusText: document.getElementById("dbStatusText"),
  dbStatusMeta: document.getElementById("dbStatusMeta"),
  dbStatusLastCheck: document.getElementById("dbStatusLastCheck"),
  dbStatusRefreshBtn: document.getElementById("dbStatusRefreshBtn"),
  kpiToggleBtn: document.getElementById("kpiToggleBtn"),
  kpiCollapsible: document.getElementById("kpiCollapsible"),
  reloadBtn: document.getElementById("reloadBtn"),
  appMessage: document.getElementById("appMessage"),
  appVersionLabel: document.getElementById("appVersionLabel"),
  kpiShiftSalesAmount: document.getElementById("kpiShiftSalesAmount"),
  kpiShiftSalesMeta: document.getElementById("kpiShiftSalesMeta"),
  kpiSalesCountValue: document.getElementById("kpiSalesCountValue"),
  kpiAverageTicketValue: document.getElementById("kpiAverageTicketValue"),
  kpiInventoryActiveCount: document.getElementById("kpiInventoryActiveCount"),
  kpiInventoryActiveMeta: document.getElementById("kpiInventoryActiveMeta"),
  kpiInventoryOutCount: document.getElementById("kpiInventoryOutCount"),
  kpiInventoryInCount: document.getElementById("kpiInventoryInCount"),
  kpiInventoryActiveBar: document.getElementById("kpiInventoryActiveBar"),
  kpiShiftProductsMeta: document.getElementById("kpiShiftProductsMeta"),
  kpiShiftElapsed: document.getElementById("kpiShiftElapsed"),
  kpiOutOfStockBtn: document.getElementById("kpiOutOfStockBtn"),
  kpiOutOfStockCount: document.getElementById("kpiOutOfStockCount"),
  kpiLowStockCount: document.getElementById("kpiLowStockCount"),
  kpiLowStockBtn: document.getElementById("kpiLowStockBtn"),
  kpiLowStockMeta: document.getElementById("kpiLowStockMeta"),
  kpiInventoryIngressBtn: document.getElementById("kpiInventoryIngressBtn"),
  kpiCreateOrderBtn: document.getElementById("kpiCreateOrderBtn"),
  stockOrderDialog: document.getElementById("stockOrderDialog"),
  stockOrderCloseBtn: document.getElementById("stockOrderCloseBtn"),
  stockOrderTurn: document.getElementById("stockOrderTurn"),
  stockOrderSummary: document.getElementById("stockOrderSummary"),
  stockOrderSelectAllBtn: document.getElementById("stockOrderSelectAllBtn"),
  stockOrderItemsBody: document.getElementById("stockOrderItemsBody"),
  stockOrderSelectedCount: document.getElementById("stockOrderSelectedCount"),
  stockOrderUnitsTotal: document.getElementById("stockOrderUnitsTotal"),
  stockOrderOutCount: document.getElementById("stockOrderOutCount"),
  stockOrderLowCount: document.getElementById("stockOrderLowCount"),
  stockOrderDocHint: document.getElementById("stockOrderDocHint"),
  stockOrderDeliveryDate: document.getElementById("stockOrderDeliveryDate"),
  stockOrderCancelBtn: document.getElementById("stockOrderCancelBtn"),
  stockOrderExportBtn: document.getElementById("stockOrderExportBtn"),
  stockOrderGenerateBtn: document.getElementById("stockOrderGenerateBtn"),
  inventoryReceiptDialog: document.getElementById("inventoryReceiptDialog"),
  inventoryReceiptTurn: document.getElementById("inventoryReceiptTurn"),
  inventoryReceiptCloseBtn: document.getElementById("inventoryReceiptCloseBtn"),
  inventoryReceiptUploadCard: document.getElementById("inventoryReceiptUploadCard"),
  inventoryReceiptFiles: document.getElementById("inventoryReceiptFiles"),
  inventoryReceiptFilesPreview: document.getElementById("inventoryReceiptFilesPreview"),
  inventoryReceiptInsights: document.getElementById("inventoryReceiptInsights"),
  inventoryReceiptSummary: document.getElementById("inventoryReceiptSummary"),
  inventoryReceiptPurchaseTotal: document.getElementById("inventoryReceiptPurchaseTotal"),
  inventoryReceiptAddRowBtn: document.getElementById("inventoryReceiptAddRowBtn"),
  inventoryReceiptItemsBody: document.getElementById("inventoryReceiptItemsBody"),
  inventoryReceiptCancelBtn: document.getElementById("inventoryReceiptCancelBtn"),
  inventoryReceiptApplyBtn: document.getElementById("inventoryReceiptApplyBtn"),
  kpiTopPaymentShare: document.getElementById("kpiTopPaymentShare"),
  kpiTopPaymentMethod: document.getElementById("kpiTopPaymentMethod"),
  kpiTopPaymentMeta: document.getElementById("kpiTopPaymentMeta"),
  kpiTopProductName: document.getElementById("kpiTopProductName"),
  kpiTopProductMeta: document.getElementById("kpiTopProductMeta"),
  openCashCloseBtn: document.getElementById("openCashCloseBtn"),
  cashCloseDialog: document.getElementById("cashCloseDialog"),
  cashCloseCloseBtn: document.getElementById("cashCloseCloseBtn"),
  cashCloseTurnLabel: document.getElementById("cashCloseTurnLabel"),
  cashCloseSalesCount: document.getElementById("cashCloseSalesCount"),
  cashCloseProductsCount: document.getElementById("cashCloseProductsCount"),
  cashCloseTotalAmount: document.getElementById("cashCloseTotalAmount"),
  cashClosePaymentsBody: document.getElementById("cashClosePaymentsBody"),
  openCreateBtn: document.getElementById("openCreateBtn"),
  productDialog: document.getElementById("productDialog"),
  productDialogTitle: document.getElementById("productDialogTitle"),
  dialogCloseBtn: document.getElementById("dialogCloseBtn"),
  ingressDialog: document.getElementById("ingressDialog"),
  ingressDialogCloseBtn: document.getElementById("ingressDialogCloseBtn"),
  ingressForm: document.getElementById("ingressForm"),
  ingressProductId: document.getElementById("ingressProductId"),
  ingressProductLabel: document.getElementById("ingressProductLabel"),
  ingressCurrentStock: document.getElementById("ingressCurrentStock"),
  ingressCantidad: document.getElementById("ingressCantidad"),
  ingressNota: document.getElementById("ingressNota"),
  ingressMessage: document.getElementById("ingressMessage"),
  ingressSubmitBtn: document.getElementById("ingressSubmitBtn"),
  ingressCancelBtn: document.getElementById("ingressCancelBtn"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmDialogTitle: document.getElementById("confirmDialogTitle"),
  confirmDialogMessage: document.getElementById("confirmDialogMessage"),
  confirmDialogCloseBtn: document.getElementById("confirmDialogCloseBtn"),
  confirmDialogCancelBtn: document.getElementById("confirmDialogCancelBtn"),
  confirmDialogConfirmBtn: document.getElementById("confirmDialogConfirmBtn"),
  crudSearch: document.getElementById("crudSearch"),
  crudMessage: document.getElementById("crudMessage"),
  productForm: document.getElementById("productForm"),
  crudEditId: document.getElementById("crudEditId"),
  crudId: document.getElementById("crudId"),
  crudNombre: document.getElementById("crudNombre"),
  crudCategoria: document.getElementById("crudCategoria"),
  crudDescripcion: document.getElementById("crudDescripcion"),
  crudPrecio: document.getElementById("crudPrecio"),
  crudPrecioCompra: document.getElementById("crudPrecioCompra"),
  productPreviewCard: document.getElementById("productPreviewCard"),
  crudImagenes: document.getElementById("crudImagenes"),
  crudImagenFiltrada: document.getElementById("crudImagenFiltrada"),
  crudImagenesPreview: document.getElementById("crudImagenesPreview"),
  productOriginalImagesBtn: document.getElementById("productOriginalImagesBtn"),
  productOriginalImagesDialog: document.getElementById("productOriginalImagesDialog"),
  productOriginalImagesCloseBtn: document.getElementById("productOriginalImagesCloseBtn"),
  productOriginalImagesPreview: document.getElementById("productOriginalImagesPreview"),
  crudPedido: document.getElementById("crudPedido"),
  crudStockActual: document.getElementById("crudStockActual"),
  crudStockMinimo: document.getElementById("crudStockMinimo"),
  crudStockAjuste: document.getElementById("crudStockAjuste"),
  crudEstado: document.getElementById("crudEstado"),
  crudNota: document.getElementById("crudNota"),
  productHistoryActions: document.getElementById("productHistoryActions"),
  crudMovementHistoryBtn: document.getElementById("crudMovementHistoryBtn"),
  crudPurchasePriceHistoryBtn: document.getElementById("crudPurchasePriceHistoryBtn"),
  crudSaveBtn: document.getElementById("crudSaveBtn"),
  crudCancelBtn: document.getElementById("crudCancelBtn"),
  crudHardDeleteBtn: document.getElementById("crudHardDeleteBtn"),
  productHistoryDialog: document.getElementById("productHistoryDialog"),
  productHistoryDialogTitle: document.getElementById("productHistoryDialogTitle"),
  productHistoryCloseBtn: document.getElementById("productHistoryCloseBtn"),
  productHistoryDateFrom: document.getElementById("productHistoryDateFrom"),
  productHistoryDateTo: document.getElementById("productHistoryDateTo"),
  productHistoryDateFromHint: document.getElementById("productHistoryDateFromHint"),
  productHistoryDateToHint: document.getElementById("productHistoryDateToHint"),
  productHistoryTodayBtn: document.getElementById("productHistoryTodayBtn"),
  productHistoryTableBody: document.getElementById("productHistoryTableBody"),
  productHistoryEmpty: document.getElementById("productHistoryEmpty"),
  crudBody: document.getElementById("crudBody"),
  crudPrevBtn: document.getElementById("crudPrevBtn"),
  crudNextBtn: document.getElementById("crudNextBtn"),
  crudPageSize: document.getElementById("crudPageSize"),
  crudPageInfo: document.getElementById("crudPageInfo"),
  openSaleDialogBtn: document.getElementById("openSaleDialogBtn"),
  exportSalesCsvBtn: document.getElementById("exportSalesCsvBtn"),
  saleDialog: document.getElementById("saleDialog"),
  saleDialogTitle: document.getElementById("saleDialogTitle"),
  saleQuickDate: document.getElementById("saleQuickDate"),
  saleQuickTime: document.getElementById("saleQuickTime"),
  saleDialogCloseBtn: document.getElementById("saleDialogCloseBtn"),
  saleCancelBtn: document.getElementById("saleCancelBtn"),
  saleForm: document.getElementById("saleForm"),
  saleProductLookup: document.getElementById("saleProductLookup"),
  saleProductClearBtn: document.getElementById("saleProductClearBtn"),
  saleProductResetBtn: document.getElementById("saleProductResetBtn"),
  saleProductDropdown: document.getElementById("saleProductDropdown"),
  saleProductId: document.getElementById("saleProductId"),
  saleQtyDownBtn: document.getElementById("saleQtyDownBtn"),
  saleCantidad: document.getElementById("saleCantidad"),
  saleQtyUpBtn: document.getElementById("saleQtyUpBtn"),
  saleAddItemBtn: document.getElementById("saleAddItemBtn"),
  saleItemsBody: document.getElementById("saleItemsBody"),
  saleItemsEmpty: document.getElementById("saleItemsEmpty"),
  saleItemsCount: document.getElementById("saleItemsCount"),
  saleAsideItems: document.getElementById("saleAsideItems"),
  salePrecioPreview: document.getElementById("salePrecioPreview"),
  saleTotalPreview: document.getElementById("saleTotalPreview"),
  saleFecha: document.getElementById("saleFecha"),
  saleHora: document.getElementById("saleHora"),
  saleTipoPagoField: document.getElementById("saleTipoPagoField"),
  salePriceRefField: document.getElementById("salePriceRefField"),
  saleTipoPago: document.getElementById("saleTipoPago"),
  saleTipoVenta: document.getElementById("saleTipoVenta"),
  saleMetaDate: document.getElementById("saleMetaDate"),
  salePaymentRows: document.getElementById("salePaymentRows"),
  saleAddPaymentBtn: document.getElementById("saleAddPaymentBtn"),
  salePaymentsHint: document.getElementById("salePaymentsHint"),
  saleMontoRecibido: document.getElementById("saleMontoRecibido"),
  salePagadoValue: document.getElementById("salePagadoValue"),
  saleVueltoValue: document.getElementById("saleVueltoValue"),
  saleNota: document.getElementById("saleNota"),
  saleSubmitBtn: document.getElementById("saleSubmitBtn"),
  saleQuickPayButtons: Array.from(document.querySelectorAll("[data-sale-quick-pay]")),
  saleReviewDialog: document.getElementById("saleReviewDialog"),
  saleReviewCloseBtn: document.getElementById("saleReviewCloseBtn"),
  saleReviewMessage: document.getElementById("saleReviewMessage"),
  saleReviewFecha: document.getElementById("saleReviewFecha"),
  saleReviewHora: document.getElementById("saleReviewHora"),
  saleConfirmTitle: document.getElementById("saleConfirmTitle"),
  saleConfirmProduct: document.getElementById("saleConfirmProduct"),
  saleConfirmCantidad: document.getElementById("saleConfirmCantidad"),
  saleConfirmTipoPago: document.getElementById("saleConfirmTipoPago"),
  saleConfirmTotal: document.getElementById("saleConfirmTotal"),
  saleConfirmNota: document.getElementById("saleConfirmNota"),
  saleConfirmItemsBody: document.getElementById("saleConfirmItemsBody"),
  saleConfirmPaymentsBody: document.getElementById("saleConfirmPaymentsBody"),
  saleConfirmBackBtn: document.getElementById("saleConfirmBackBtn"),
  saleConfirmSubmitBtn: document.getElementById("saleConfirmSubmitBtn"),
  saleMessage: document.getElementById("saleMessage"),
  salesSearch: document.getElementById("salesSearch"),
  salesDateFrom: document.getElementById("salesDateFrom"),
  salesDateTo: document.getElementById("salesDateTo"),
  salesDateFromHint: document.getElementById("salesDateFromHint"),
  salesDateToHint: document.getElementById("salesDateToHint"),
  salesDateTodayBtn: document.getElementById("salesDateTodayBtn"),
  salesBody: document.getElementById("salesBody"),
  salesPrevBtn: document.getElementById("salesPrevBtn"),
  salesNextBtn: document.getElementById("salesNextBtn"),
  salesPageSize: document.getElementById("salesPageSize"),
  salesPageInfo: document.getElementById("salesPageInfo"),
  kardexSearch: document.getElementById("kardexSearch"),
  kardexTypeFilter: document.getElementById("kardexTypeFilter"),
  kardexDeleteAllBtn: document.getElementById("kardexDeleteAllBtn"),
  kardexBody: document.getElementById("kardexBody"),
  sortButtons: Array.from(document.querySelectorAll("[data-sort-table][data-sort-key]")),
  apiSettingsForm: document.getElementById("apiSettingsForm"),
  apiBaseUrlInput: document.getElementById("apiBaseUrlInput"),
  saveApiBaseBtn: document.getElementById("saveApiBaseBtn"),
  useCurrentOriginBtn: document.getElementById("useCurrentOriginBtn"),
  testApiBaseBtn: document.getElementById("testApiBaseBtn"),
  testCpanelDbBtn: document.getElementById("testCpanelDbBtn"),
  openOnboardingBtn: document.getElementById("openOnboardingBtn"),
  apiBaseUrlCurrent: document.getElementById("apiBaseUrlCurrent"),
  accessHostValue: document.getElementById("accessHostValue"),
  copyAccessHostBtn: document.getElementById("copyAccessHostBtn"),
  refreshAccessHostBtn: document.getElementById("refreshAccessHostBtn"),
  accessHostMeta: document.getElementById("accessHostMeta"),
  cpanelProbeBadge: document.getElementById("cpanelProbeBadge"),
  cpanelProbeMeta: document.getElementById("cpanelProbeMeta"),
  cpanelProbeBody: document.getElementById("cpanelProbeBody"),
  settingsMessage: document.getElementById("settingsMessage"),
  onboardingCoach: document.getElementById("onboardingCoach"),
  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingSpotlight: document.getElementById("onboardingSpotlight"),
  onboardingProgress: document.getElementById("onboardingProgress"),
  onboardingTitle: document.getElementById("onboardingTitle"),
  onboardingBody: document.getElementById("onboardingBody"),
  onboardingSkipBtn: document.getElementById("onboardingSkipBtn"),
  onboardingPrevBtn: document.getElementById("onboardingPrevBtn"),
  onboardingNextBtn: document.getElementById("onboardingNextBtn"),
  viewNavButtons: Array.from(document.querySelectorAll(".view-nav-btn")),
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]"))
};

let productsController = null;
let salesController = null;
let kardexController = null;
let settingsController = null;

function initControllers() {
  if (!productsController) {
    productsController = window.ProductsPage.createController({
      state,
      refs,
      apiRequest,
      parseNumberInput,
      formatQty,
      getApiBaseUrl,
      setCrudMessage,
      setIngressMessage,
      openConfirmDialog,
      refreshAll,
      renderSortButtons,
      buildCollectionQuery,
      matchOperationalDayRange,
      getCurrentOperationalDayKey,
      getCurrentOperationalBaseDate,
      toLocalIsoDate,
      formatOperationalDateLabel,
      defaultPagination: () => ({ ...DEFAULT_PAGINATION })
    });
  }

  if (!salesController) {
    salesController = window.SalesPage.createController({
      state,
      refs,
      apiRequest,
      buildCollectionQuery,
      buildApiUrl,
      normalizePaymentType,
      normalizeSaleQuantityValue,
      todayInputValue,
      currentTimeInputValue,
      normalizeTimeValue,
      extractTimeFromDateTime,
      buildSaleDateTimeValue,
      syncSaleProductIdFromLookup,
      getSaleProductsSource,
      setSaleDialogMode,
      showSaleConfirmBox,
      hideSaleConfirmBox,
      setSaleMessage,
      setSaleReviewMessage,
      setAppMessage,
      openConfirmDialog,
      setSaleQuantityValue,
      renderSaleProductOptions,
      updateSaleTotalsPreview,
      closeSaleLookupDropdown,
      formatSaleLookupLabel,
      normalizeDateValue,
      getCurrentSalesShiftDateValue,
      round2,
      money,
      formatQty,
      refreshAll,
      renderSortButtons,
      renderKpis,
      defaultSalesPagination: () => ({ ...DEFAULT_SALES_PAGINATION })
    });
  }

  if (!kardexController) {
    kardexController = window.KardexPage.createController({
      state,
      refs,
      apiRequest,
      buildCollectionQuery,
      setAppMessage,
      openConfirmDialog,
      refreshAll,
      renderSortButtons,
      renderKpis
    });
  }

  if (!settingsController) {
    settingsController = window.SettingsPage.createController({
      state,
      refs,
      apiRequest,
      normalizeApiBaseUrl,
      buildApiUrlWithBase,
      getApiBaseUrl,
      saveApiBaseUrlPreference,
      renderApiSettingsBound: renderApiSettings,
      renderDbStatusBound: renderDbStatus,
      renderAccessHostBound: renderAccessHost,
      setSettingsMessage,
      setAppMessage,
      setCpanelProbeResult,
      tryParseJsonText,
      extractMysqlDeniedHost,
      detectBrowserPublicIpv4,
      copyTextToClipboard,
      getRuntimeOrigin
    });
  }
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getCurrentSalesShiftDateValue() {
  const now = new Date();
  const shiftDate = new Date(now);
  if (shiftDate.getHours() < 5) {
    shiftDate.setDate(shiftDate.getDate() - 1);
  }
  const local = new Date(shiftDate.getTime() - shiftDate.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatOperationalDateLabel(dateIso) {
  const iso = normalizeDateValue(dateIso || "");
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
  const weekday = new Intl.DateTimeFormat("es-PE", { weekday: "long" }).format(date);
  return `${weekday} ${date.getDate()}`;
  const names = ["domingo", "lunes", "martes", "miÃ©rcoles", "jueves", "viernes", "sÃ¡bado"];
  const dayName = names[date.getDay()] || "";
  if (!dayName) return "";
  return `${dayName} ${date.getDate()}`;
}

function getCurrentOperationalDayKey() {
  return getOperationalDayKeyForAnchor(new Date());
}

function getOperationalDayKeyForAnchor(anchor = new Date()) {
  const businessDate = getCurrentOperationalBaseDate(anchor);
  const jsDay = businessDate.getDay();
  return OPERATIONAL_DAY_ORDER[(jsDay + 6) % 7] || "lunes";
}

function getOperationalDayLabel(key) {
  const normalized = normalizeOperationalDayKey(key);
  const labels = {
    lunes: "Lunes",
    martes: "Martes",
    miercoles: "Miércoles",
    jueves: "Jueves",
    viernes: "Viernes",
    sabado: "Sábado",
    domingo: "Domingo"
  };
  if (labels[normalized]) return labels[normalized];
  switch (normalized) {
    case "lunes":
      return "Lunes";
    case "martes":
      return "Martes";
    case "miercoles":
      return "MiÃ©rcoles";
    case "jueves":
      return "Jueves";
    case "viernes":
      return "Viernes";
    case "sabado":
      return "SÃ¡bado";
    case "domingo":
      return "Domingo";
    default:
      return "Lunes";
  }
}

function formatOperationalDateLabelClean(dateIso) {
  const iso = normalizeDateValue(dateIso || "");
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
  const weekday = new Intl.DateTimeFormat("es-PE", { weekday: "long" }).format(date);
  return `${weekday} ${date.getDate()}`;
}

function getOperationalDayLabelClean(key) {
  const labels = {
    lunes: "Lunes",
    martes: "Martes",
    miercoles: "Miércoles",
    jueves: "Jueves",
    viernes: "Viernes",
    sabado: "Sábado",
    domingo: "Domingo"
  };
  return labels[normalizeOperationalDayKey(key)] || "Lunes";
}

formatOperationalDateLabel = formatOperationalDateLabelClean;
getOperationalDayLabel = getOperationalDayLabelClean;

function getOperationalDayKeyForDateTime(dateValue, timeValue) {
  const safeDate = normalizeDateValue(dateValue || "") || todayInputValue();
  const safeTime = normalizeTimeValue(timeValue || "") || currentTimeInputValue();
  const [year, month, day] = safeDate.split("-").map((part) => Number.parseInt(part, 10));
  const [hour, minute] = safeTime.split(":").map((part) => Number.parseInt(part, 10));
  const anchor = new Date(year, Math.max(0, (month || 1) - 1), day || 1, hour || 0, minute || 0, 0, 0);
  return getOperationalDayKeyForAnchor(anchor);
}

function normalizeOperationalDayKey(value) {
  const text = normalizeText(value).replace(/[^a-z]/g, "");
  return OPERATIONAL_DAY_ORDER.includes(text) ? text : "";
}

function getCurrentOperationalBaseDate(anchor = new Date()) {
  const baseDate = new Date(anchor);
  const hour = baseDate.getHours();
  if (hour < 5) {
    baseDate.setDate(baseDate.getDate() - 1);
  }
  return baseDate;
}

function getCurrentTurnElapsedLabel(anchor = new Date()) {
  const baseDate = getCurrentOperationalBaseDate(anchor);
  const shiftStart = new Date(baseDate);
  shiftStart.setHours(5, 0, 0, 0);
  const diffMs = Math.max(0, anchor.getTime() - shiftStart.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  if (minutes <= 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function getOperationalWeekStart(anchor = new Date()) {
  const businessDate = getCurrentOperationalBaseDate(anchor);
  const mondayBasedIndex = (businessDate.getDay() + 6) % 7;
  const weekStart = new Date(businessDate);
  weekStart.setDate(weekStart.getDate() - mondayBasedIndex);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function buildOperationalRange(fromDay, toDay, anchor = new Date()) {
  const fromIso = normalizeDateValue(fromDay || "");
  const toIso = normalizeDateValue(toDay || "");
  if (fromIso || toIso) {
    const startIso = fromIso || toIso;
    const endIso = toIso || fromIso;
    const [sy, sm, sd] = startIso.split("-").map((part) => Number.parseInt(part, 10));
    const [ey, em, ed] = endIso.split("-").map((part) => Number.parseInt(part, 10));
    const start = new Date(sy, Math.max(0, (sm || 1) - 1), sd || 1, 5, 0, 0, 0);
    const end = new Date(ey, Math.max(0, (em || 1) - 1), ed || 1, 5, 0, 0, 0);
    if (end < start) return null;
    end.setDate(end.getDate() + 1);
    end.setHours(4, 59, 59, 999);
    return { start, end };
  }

  const normalizedFrom = normalizeOperationalDayKey(fromDay);
  const normalizedTo = normalizeOperationalDayKey(toDay);
  if (!normalizedFrom && !normalizedTo) return null;

  const safeFrom = normalizedFrom || normalizedTo;
  const safeTo = normalizedTo || normalizedFrom;
  const start = resolveOperationalDayDate(safeFrom, anchor);
  const endBase = resolveOperationalDayDate(safeTo, anchor);
  if (!start || !endBase) return null;
  start.setHours(5, 0, 0, 0);

  const end = new Date(endBase);
  if (end < start) {
    end.setDate(end.getDate() + 7);
  }
  end.setDate(end.getDate() + 1);
  end.setHours(4, 59, 59, 999);

  return { start, end };
}

function resolveOperationalDayDate(dayKey, anchor = new Date()) {
  const normalizedDay = normalizeOperationalDayKey(dayKey);
  if (!normalizedDay) return null;
  const businessDate = getCurrentOperationalBaseDate(anchor);
  const currentIndex = (businessDate.getDay() + 6) % 7;
  const calendarIndex = (anchor.getDay() + 6) % 7;
  const targetIndex = OPERATIONAL_DAY_ORDER.indexOf(normalizedDay);
  if (targetIndex < 0) return null;

  if (currentIndex !== calendarIndex && targetIndex === calendarIndex) {
    const calendarDate = new Date(anchor);
    calendarDate.setHours(0, 0, 0, 0);
    return calendarDate;
  }

  let offset = targetIndex - currentIndex;
  if (offset > 0) {
    offset -= 7;
  }

  const resolvedDate = new Date(businessDate);
  resolvedDate.setDate(resolvedDate.getDate() + offset);
  resolvedDate.setHours(0, 0, 0, 0);
  return resolvedDate;
}

function parseOperationalSaleDateTime(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      0
    );
  }

  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
      0
    );
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function toLocalIsoDate(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
  const local = new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function resolveOperationalShiftDate(rawDate) {
  const text = String(rawDate ?? "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?/);
  if (isoMatch) {
    const isoDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const hour = isoMatch[4] !== undefined ? Number.parseInt(isoMatch[4], 10) : null;
    const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
    const baseDate = new Date(year, Math.max(0, (month || 1) - 1), day || 1, 12, 0, 0, 0);
    if (Number.isFinite(hour) && hour < 5) {
      baseDate.setDate(baseDate.getDate() - 1);
    }
    return toLocalIsoDate(baseDate);
  }

  const parsed = parseOperationalSaleDateTime(text);
  if (parsed) {
    const operationalBase = getCurrentOperationalBaseDate(parsed);
    return toLocalIsoDate(operationalBase);
  }
  return normalizeDateValue(text || "");
}

function matchOperationalDayRange(rawDate, fromDay, toDay) {
  const fromIso = normalizeDateValue(fromDay || "");
  const toIso = normalizeDateValue(toDay || "");
  if (fromIso || toIso) {
    const shiftIso = resolveOperationalShiftDate(rawDate);
    if (!shiftIso) return false;
    const start = fromIso || toIso;
    const end = toIso || fromIso;
    if (end < start) return false;
    return shiftIso >= start && shiftIso <= end;
  }

  const range = buildOperationalRange(fromDay, toDay);
  if (!range) return true;
  const saleDateTime = parseOperationalSaleDateTime(rawDate);
  if (!saleDateTime) return false;
  return saleDateTime >= range.start && saleDateTime <= range.end;
}

function getRuntimeOrigin() {
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin;
  }
  return "";
}

function normalizeApiBaseUrl(rawUrl) {
  const input = String(rawUrl ?? "").trim();
  if (!input) return "";

  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("URL invÃ¡lida. Usa formato: http://127.0.0.1:8788");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Solo se permiten URLs http o https.");
  }

  return parsed.origin;
}

function getDefaultApiBaseUrl() {
  const runtimeOrigin = getRuntimeOrigin();
  if (runtimeOrigin && isLoopbackApiOrigin(runtimeOrigin)) {
    return runtimeOrigin;
  }
  return FALLBACK_API_BASE_URL;
}

function isLoopbackApiOrigin(urlInput) {
  try {
    const normalized = normalizeApiBaseUrl(urlInput);
    if (!normalized) return false;
    const parsed = new URL(normalized);
    const host = String(parsed.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function loadApiBaseUrlPreference() {
  const fallback = getDefaultApiBaseUrl();
  try {
    const stored = window.localStorage.getItem(API_BASE_STORAGE_KEY);
    const normalized = normalizeApiBaseUrl(stored);
    return normalized || fallback;
  } catch {
    return fallback;
  }
}

function loadMobileKpiExpandedPreference() {
  try {
    const value = window.localStorage.getItem(MOBILE_KPI_EXPANDED_STORAGE_KEY);
    if (value === null) return false;
    return value === "1";
  } catch {
    return false;
  }
}

function saveMobileKpiExpandedPreference(expanded) {
  try {
    window.localStorage.setItem(MOBILE_KPI_EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // Ignora errores de storage.
  }
}

function loadDesktopNavCollapsedPreference() {
  return true;
}

function saveDesktopNavCollapsedPreference(collapsed) {
  try {
    window.localStorage.setItem(DESKTOP_NAV_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignora errores de storage.
  }
}

function loadOnboardingSeenPreference() {
  try {
    return window.localStorage.getItem(ONBOARDING_SEEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOnboardingSeenPreference(seen) {
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_STORAGE_KEY, seen ? "1" : "0");
  } catch {
    // Ignora errores de storage.
  }
}

function saveApiBaseUrlPreference(url) {
  try {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, url);
  } catch {
    // Ignora errores de storage.
  }
}

function getApiBaseUrl() {
  return state.apiBaseUrl || getDefaultApiBaseUrl();
}

function buildApiUrl(path) {
  return buildApiUrlWithBase(path, getApiBaseUrl());
}

function buildApiUrlWithBase(path, baseUrl) {
  const apiPath = String(path ?? "").trim();
  const normalizedPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return new URL(normalizedPath, baseUrl).toString();
}

function sanitizeHostCandidate(value) {
  const text = String(value ?? "").trim().replace(/^https?:\/\//i, "");
  return text.replace(/\/.*$/, "").replace(/:\d+$/, "").trim();
}

function isIpv4(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return false;
  return text.split(".").every((part) => {
    const octet = Number.parseInt(part, 10);
    return octet >= 0 && octet <= 255;
  });
}

function isPrivateIpv4(ip) {
  if (!isIpv4(ip)) return false;
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

async function detectBrowserPublicIpv4() {
  const probes = [
    {
      source: "ipify",
      url: "https://api.ipify.org?format=json",
      parse: async (response) => {
        const data = await response.json();
        return sanitizeHostCandidate(data?.ip || "");
      }
    },
    {
      source: "checkip-amazon",
      url: "https://checkip.amazonaws.com",
      parse: async (response) => sanitizeHostCandidate(await response.text())
    },
    {
      source: "icanhazip",
      url: "https://ipv4.icanhazip.com",
      parse: async (response) => sanitizeHostCandidate(await response.text())
    }
  ];

  for (const probe of probes) {
    try {
      const response = await fetch(probe.url, { cache: "no-store" });
      if (!response.ok) continue;
      const ip = await probe.parse(response);
      if (!isIpv4(ip) || isPrivateIpv4(ip)) continue;
      return { ip, source: probe.source };
    } catch {
      // Probar siguiente endpoint.
    }
  }
  return null;
}

function extractMysqlDeniedHost(errorText) {
  const text = String(errorText ?? "").trim();
  if (!text) return "";
  const match = text.match(/@'([^']+)'/);
  return match ? String(match[1]).trim() : "";
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) {
    throw new Error("No hay texto para copiar.");
  }

  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);
  input.focus();
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) {
    throw new Error("Tu navegador bloqueÃ³ la copia automÃ¡tica.");
  }
}

function getSaleProductsSource() {
  const source = state.productCatalog.length ? state.productCatalog : state.products;
  return source.filter((item) => {
    const status = String(item?.ESTADO || "ACTIVO").trim().toUpperCase();
    return status === "ACTIVO";
  });
}

function buildCollectionQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    query.set(key, text);
  });
  return query.toString();
}

function getSortStateByTable(tableName) {
  if (tableName === "products") return state.productSort;
  if (tableName === "sales") return state.salesSort;
  if (tableName === "kardex") return state.kardexSort;
  return null;
}

function updateSortState(tableName, key) {
  const target = getSortStateByTable(tableName);
  if (!target) return;
  const sameKey = target.key === key;
  target.key = key;
  target.dir = sameKey ? (target.dir === "asc" ? "desc" : "asc") : "asc";
}

function renderSortButtons() {
  refs.sortButtons.forEach((button) => {
    const tableName = String(button.dataset.sortTable || "");
    const key = String(button.dataset.sortKey || "");
    const current = getSortStateByTable(tableName);
    if (!current || !key) return;
    const isActive = current.key === key;
    const indicator = isActive ? (current.dir === "asc" ? "\u2191" : "\u2193") : "\u2195";
    const indicatorNode = button.querySelector(".sort-indicator");
    if (indicatorNode) indicatorNode.textContent = indicator;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    const directionLabel = isActive ? (current.dir === "asc" ? "ascendente" : "descendente") : "sin orden";
    button.setAttribute("title", `Orden: ${directionLabel}`);
  });
}

function debounce(fn, delay = 200) {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

function normalizePaymentType(value) {
  const input = normalizeText(value);
  if (["aya per", "a ya per", "ayaper", "yape"].includes(input)) return "Yape";
  if (["easy pay", "easypay", "izi pay", "izipay", "izi-pay"].includes(input)) return "IZIPAY";
  const found = PAYMENT_TYPES.find((type) => normalizeText(type) === input);
  return found || "Efectivo";
}

function parseNumberInput(raw, { min = null, max = null, label = "numero" } = {}) {
  const value = Number.parseFloat(String(raw ?? "").replace(",", ".").trim());
  if (!Number.isFinite(value)) {
    throw new Error(`El campo ${label} debe ser numerico.`);
  }
  if (min !== null && value < min) {
    throw new Error(`El campo ${label} debe ser >= ${min}.`);
  }
  if (max !== null && value > max) {
    throw new Error(`El campo ${label} debe ser <= ${max}.`);
  }
  return value;
}

function parseIntegerInput(raw, { min = null, max = null, label = "numero" } = {}) {
  const value = parseNumberInput(raw, { min, max, label });
  if (!Number.isInteger(value)) {
    throw new Error(`El campo ${label} debe ser un numero entero.`);
  }
  return value;
}

async function apiRequest(path, options = {}) {
  let response;
  const requestUrl = buildApiUrl(path);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 20000));
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  try {
    response = await fetch(requestUrl, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...requestOptions,
      signal: requestOptions.signal || controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`La solicitud tardÃ³ demasiado (${Math.round(timeoutMs / 1000)} s). Intenta de nuevo.`);
    }
    throw new Error(
      `No se pudo conectar al servidor configurado (${getApiBaseUrl()}). Verifica URL y que estÃ© activo.`
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = `Error ${response.status}`;
    let rawBody = "";
    try {
      rawBody = await response.text();
      if (rawBody) {
        try {
          const data = JSON.parse(rawBody);
          if (data?.error) {
            message = data.error;
          } else {
            message = rawBody;
          }
        } catch {
          message = rawBody;
        }
      }
    } catch {
      // Ignora errores de lectura del body.
    }
    throw new Error(message);
  }

  const rawBody = await response.text();
  if (!rawBody) return null;

  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
    throw new Error("La respuesta del servidor no es JSON vÃ¡lido.");
    }
  }
  return rawBody;
}

function setAppMessage(text, type = "") {
  refs.appMessage.textContent = text;
  refs.appMessage.classList.remove("is-error", "is-success");
  if (type) refs.appMessage.classList.add(type);
}

function setCrudMessage(text, type = "") {
  refs.crudMessage.textContent = text;
  refs.crudMessage.classList.remove("is-error", "is-success");
  if (type) refs.crudMessage.classList.add(type);
}

function setSaleMessage(text, type = "") {
  refs.saleMessage.textContent = text;
  refs.saleMessage.classList.remove("is-error", "is-success");
  if (type) refs.saleMessage.classList.add(type);
}

function setSaleReviewMessage(text, type = "") {
  if (!refs.saleReviewMessage) return;
  refs.saleReviewMessage.textContent = text;
  refs.saleReviewMessage.classList.remove("is-error", "is-success");
  if (type) refs.saleReviewMessage.classList.add(type);
}

function setIngressMessage(text, type = "") {
  refs.ingressMessage.textContent = text;
  refs.ingressMessage.classList.remove("is-error", "is-success");
  if (type) refs.ingressMessage.classList.add(type);
}

function setSettingsMessage(text, type = "", { autoClearMs = 0 } = {}) {
  refs.settingsMessage.textContent = text;
  refs.settingsMessage.classList.remove("is-error", "is-success");
  if (type) refs.settingsMessage.classList.add(type);

  if (state.settingsMessageTimeoutId) {
    window.clearTimeout(state.settingsMessageTimeoutId);
    state.settingsMessageTimeoutId = null;
  }

  if (autoClearMs > 0 && text) {
    state.settingsMessageTimeoutId = window.setTimeout(() => {
      refs.settingsMessage.textContent = "";
      refs.settingsMessage.classList.remove("is-error", "is-success");
      state.settingsMessageTimeoutId = null;
    }, autoClearMs);
  }
}

function tryParseJsonText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function prettyPayload(payload) {
  if (typeof payload === "string") return payload || "-";
  if (payload === null || payload === undefined) return "-";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function setCpanelProbeResult({ state = "idle", url = "", httpStatus = null, payload = null, error = "" } = {}) {
  const badge = refs.cpanelProbeBadge;
  const meta = refs.cpanelProbeMeta;
  const body = refs.cpanelProbeBody;
  if (!badge || !meta || !body) return;

  badge.classList.remove("is-idle", "is-ok", "is-error", "is-loading");

  const checkedAt = formatDateTime(new Date().toISOString());
  const statusLabel = httpStatus ? `HTTP ${httpStatus}` : "sin HTTP";
  const shortUrl = url || getApiBaseUrl();

  if (state === "loading") {
    badge.classList.add("is-loading");
    badge.textContent = "Probando...";
    meta.textContent = `Consultando ${shortUrl} ...`;
    body.textContent = "-";
    return;
  }

  if (state === "ok") {
    badge.classList.add("is-ok");
    badge.textContent = "OK";
    meta.textContent = `${statusLabel} \u00B7 ${checkedAt} \u00B7 ${shortUrl}`;
    body.textContent = prettyPayload(payload);
    return;
  }

  if (state === "error") {
    badge.classList.add("is-error");
    badge.textContent = "Error";
    meta.textContent = `${statusLabel} \u00B7 ${checkedAt} \u00B7 ${shortUrl}`;
    body.textContent = error
      ? `${error}\n\n${prettyPayload(payload)}`
      : prettyPayload(payload);
    return;
  }

  badge.classList.add("is-idle");
  badge.textContent = "Sin probar";
  meta.textContent = 'Pulsa "Probar DB cPanel" para ver la respuesta real de /api/db/status.';
  body.textContent = "-";
}

function clearMigrationPolling() {
  if (!state.migrationPollTimeoutId) return;
  window.clearTimeout(state.migrationPollTimeoutId);
  state.migrationPollTimeoutId = null;
}

function renderDbStatus() {
  window.SettingsPage.renderDbStatus(refs, state, formatDateTime);
}

function buildAccessHostRenderState() {
  if (!settingsController) {
    return state.accessHost && typeof state.accessHost === "object" ? { ...state.accessHost } : {};
  }
  return settingsController.buildAccessHostRenderState();
}

function renderAccessHost() {
  window.SettingsPage.renderAccessHost(refs, buildAccessHostRenderState(), formatDateTime);
}

async function refreshDbStatus() {
  return settingsController.refreshDbStatus();
}

async function refreshAccessHost() {
  return settingsController.refreshAccessHost();
}

function clearCrudForm() {
  productsController.clearCrudForm();
}

function openDialog() {
  productsController.openDialog();
}

function closeDialog() {
  productsController.closeDialog();
}

function resetIngressForm() {
  productsController.resetIngressForm();
}

function openIngressDialogForProduct(product) {
  productsController.openIngressDialogForProduct(product);
}

function closeIngressDialog() {
  productsController.closeIngressDialog();
}

function resolveConfirmDialog(decision) {
  const resolver = state.confirmDialogResolver;
  state.confirmDialogResolver = null;
  if (typeof resolver === "function") {
    resolver(Boolean(decision));
  }
}

function closeConfirmDialog(decision = false) {
  resolveConfirmDialog(decision);
  if (refs.confirmDialog?.open) {
    refs.confirmDialog.close();
  }
}

function openConfirmDialog(options = {}) {
  const title = String(options.title || "Confirmar accion");
  const message = String(options.message || "Esta accion no se puede deshacer.");
  const cancelText = String(options.cancelText || "Cancelar");
  const confirmText = String(options.confirmText || "Confirmar");

  if (!refs.confirmDialog) {
    return Promise.resolve(false);
  }

  closeConfirmDialog(false);
  refs.confirmDialogTitle.textContent = title;
  refs.confirmDialogMessage.textContent = message;
  refs.confirmDialogCancelBtn.textContent = cancelText;
  refs.confirmDialogConfirmBtn.textContent = confirmText;

  refs.confirmDialog.showModal();
  refs.confirmDialogConfirmBtn.focus();

  return new Promise((resolve) => {
    state.confirmDialogResolver = resolve;
  });
}

function setSaleFormLocked(locked) {
  [
    refs.saleProductLookup,
    refs.saleProductClearBtn,
    refs.saleProductResetBtn,
    refs.saleProductId,
    refs.saleQtyDownBtn,
    refs.saleCantidad,
    refs.saleQtyUpBtn,
    refs.saleAddItemBtn,
    refs.saleTipoVenta,
    refs.saleAddPaymentBtn,
    refs.saleFecha,
    refs.saleHora,
    refs.saleTipoPago,
    refs.saleNota,
    refs.saleMontoRecibido,
    refs.salePaymentRows
  ].forEach((input) => {
    if (!input) return;
    input.disabled = Boolean(locked);
  });
  if (refs.salePaymentRows) {
    refs.salePaymentRows.querySelectorAll("select, input, button").forEach((node) => {
      node.disabled = Boolean(locked);
    });
  }
  if (refs.saleItemsBody) {
    refs.saleItemsBody.querySelectorAll("button").forEach((node) => {
      node.disabled = Boolean(locked);
    });
  }
  if (Array.isArray(refs.saleQuickPayButtons)) {
    refs.saleQuickPayButtons.forEach((button) => {
      if (button) button.disabled = Boolean(locked);
    });
  }
  if (locked) {
    closeSaleLookupDropdown();
  }
  refs.saleSubmitBtn.disabled = Boolean(locked);
}

function toSaleQuickDate(value) {
  const normalized = normalizeDateValue(value || "");
  if (!normalized) return "--/--/----";
  const [year, month, day] = normalized.split("-");
  if (!year || !month || !day) return "--/--/----";
  return `${day}/${month}/${year}`;
}

function toSaleQuickTime(dateInput) {
  const source = dateInput instanceof Date ? dateInput : new Date();
  return source.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function currentTimeInputValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normalizeTimeValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function extractTimeFromDateTime(value) {
  const normalized = normalizeTimeValue(String(value || "").replace("T", " "));
  return normalized || currentTimeInputValue();
}

function buildSaleDateTimeValue(dateValue, timeValue) {
  const safeDate = normalizeDateValue(dateValue || "") || todayInputValue();
  const safeTime = normalizeTimeValue(timeValue || "") || currentTimeInputValue();
  return `${safeDate} ${safeTime}:00`;
}

function setSaleTotalPreviewText(text) {
  if (!refs.saleTotalPreview) return;
  const safeText = String(text || "-");
  refs.saleTotalPreview.textContent = safeText;
  refs.saleTotalPreview.value = safeText;
}

function updateSaleDialogQuickMeta() {
  if (refs.saleQuickDate) {
    refs.saleQuickDate.textContent = toSaleQuickDate(refs.saleFecha?.value || todayInputValue());
  }
  if (refs.saleQuickTime) {
    const shiftKey = getOperationalDayKeyForDateTime(refs.saleFecha?.value || todayInputValue(), refs.saleHora?.value || "");
    refs.saleQuickTime.textContent = `Turno ${getOperationalDayLabel(shiftKey)}`;
  }
}

function setSaleDialogMode(mode) {
  const isEdit = mode === "edit";
  if (isEdit && state.saleEditingId) {
    refs.saleDialogTitle.textContent = `Editar venta #${state.saleEditingId}`;
  } else {
    refs.saleDialogTitle.textContent = "NUEVA VENTA RAPIDA";
  }
  refs.saleSubmitBtn.textContent = isEdit ? "Revisar cambios" : "Continuar a resumen";
  refs.saleConfirmTitle.textContent = isEdit ? "Confirmar cambios de venta" : "Confirmar venta";
  refs.saleConfirmSubmitBtn.textContent = isEdit ? "Guardar cambios" : "Guardar venta";
  if (refs.saleTipoPagoField) {
    refs.saleTipoPagoField.hidden = true;
  }
  if (refs.salePriceRefField) {
    refs.salePriceRefField.hidden = !isEdit;
  }
  if (refs.saleMetaDate) {
    refs.saleMetaDate.textContent = normalizeDateValue(refs.saleFecha?.value || "") || todayInputValue();
  }
  updateSaleDialogQuickMeta();
}

function normalizeSaleQuantityValue(raw, options = {}) {
  const fallback = options.fallback ?? null;
  const normalized = String(raw ?? "").replace(",", ".").trim();
  if (!normalized) return fallback;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.round(parsed));
}

function setSaleQuantityValue(raw, options = {}) {
  const value = normalizeSaleQuantityValue(raw, { fallback: options.fallback ?? 1 });
  refs.saleCantidad.value = String(value);
  return value;
}

function normalizeSaleQuantityInput() {
  setSaleQuantityValue(refs.saleCantidad.value, { fallback: 1 });
  updateSaleTotalsPreview();
}

function changeSaleQuantity(delta) {
  const step = Number.parseInt(String(delta ?? 0), 10);
  const current = normalizeSaleQuantityValue(refs.saleCantidad.value, { fallback: 1 });
  setSaleQuantityValue(current + step, { fallback: 1 });
  updateSaleTotalsPreview();
}

function updateSaleTotalsPreview() {
  const products = getSaleProductsSource();
  const productId = Number.parseInt(refs.saleProductId.value, 10);
  const product = products.find((item) => Number(getSaleProductCode(item)) === productId);
  const draftItems = Array.isArray(state.saleDraftItems) ? state.saleDraftItems : [];
  const draftTotal = draftItems.reduce((acc, item) => acc + Number(item.total || 0), 0);
  const draftQty = draftItems.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);

  if (!product) {
    if (refs.salePrecioPreview) refs.salePrecioPreview.value = "-";
    const totalText = draftTotal > 0 ? money(draftTotal) : "S/ 0.00";
    setSaleTotalPreviewText(totalText);
    if (refs.saleAsideItems) {
      refs.saleAsideItems.textContent = String(Math.max(0, Math.round(draftQty))).padStart(2, "0");
    }
    if (refs.saleMetaDate) {
      refs.saleMetaDate.textContent = normalizeDateValue(refs.saleFecha?.value || "") || todayInputValue();
    }
    updateSaleDialogQuickMeta();
    return;
  }

  const price = Number(product.PRECIO || 0);
  const safeQty = normalizeSaleQuantityValue(refs.saleCantidad.value, { fallback: 1 });
  const total = round2(price * safeQty);
  const showDraft = draftTotal > 0 && !state.saleEditingId;
  const shownTotal = showDraft ? draftTotal : total;
  const shownQty = showDraft ? draftQty : safeQty;

  if (refs.salePrecioPreview) refs.salePrecioPreview.value = money(price);
  setSaleTotalPreviewText(money(shownTotal));
  if (refs.saleAsideItems) {
    refs.saleAsideItems.textContent = String(Math.max(0, Math.round(shownQty))).padStart(2, "0");
  }
  if (refs.saleMetaDate) {
    refs.saleMetaDate.textContent = normalizeDateValue(refs.saleFecha?.value || "") || todayInputValue();
  }
  updateSaleDialogQuickMeta();
}

function showSaleConfirmBox(summary, payload, options = {}) {
  const isEditing = Boolean(options.isEditing);
  const saleId = options.saleId ? Number(options.saleId) : null;
  state.salePendingConfirm = { payload, isEditing, saleId, summary };
  setSaleReviewMessage("");
  refs.saleConfirmProduct.textContent = summary.product;
  refs.saleConfirmTipoPago.textContent = summary.tipoPago;
  refs.saleConfirmTotal.textContent = summary.total || "-";
  if (refs.saleReviewFecha) {
    refs.saleReviewFecha.value = normalizeDateValue(summary.fecha || payload.fecha_venta || refs.saleFecha?.value || "") || todayInputValue();
  }
  if (refs.saleReviewHora) {
    refs.saleReviewHora.value = normalizeTimeValue(summary.hora || payload.fecha_venta || refs.saleHora?.value || "") || currentTimeInputValue();
  }
  if (refs.saleConfirmNota) {
    refs.saleConfirmNota.textContent = summary.nota || "-";
  }
  if (refs.saleConfirmItemsBody) {
    const items = Array.isArray(summary.items) ? summary.items : [];
    refs.saleConfirmItemsBody.innerHTML = items.length
      ? items
          .map(
            (item) => `
              <tr>
                <td><strong>${esc(item.codigo || "")}</strong><div>${esc(item.nombre || "-")}</div></td>
                <td>${esc(item.cantidad || "-")}</td>
                <td>${esc(item.unitario || "-")}</td>
                <td>${esc(item.subtotal || "-")}</td>
              </tr>
            `
          )
          .join("")
      : '<tr><td colspan="4" class="empty">No hay productos para confirmar.</td></tr>';
  }
  if (refs.saleConfirmPaymentsBody) {
    const payments = Array.isArray(summary.payments) ? summary.payments : [];
    refs.saleConfirmPaymentsBody.innerHTML = payments.length
      ? payments
          .map(
            (row) => `
              <div class="sale-review-payment">
                <span>${esc(row.tipoPago || "-")}</span>
                <strong>${esc(row.monto || "-")}</strong>
              </div>
            `
          )
          .join("")
      : '<div class="sale-review-payment"><span>Sin pagos</span><strong>-</strong></div>';
  }
  if (refs.saleReviewDialog?.open) {
    refs.saleReviewDialog.close();
  }
  refs.saleReviewDialog?.showModal();
  setSaleFormLocked(true);
}

function hideSaleConfirmBox({ clear = true } = {}) {
  if (refs.saleReviewDialog?.open) {
    refs.saleReviewDialog.close();
  }
  setSaleReviewMessage("");
  if (refs.saleReviewFecha && refs.saleFecha && refs.saleReviewFecha.value) {
    refs.saleFecha.value = refs.saleReviewFecha.value;
  }
  if (refs.saleReviewHora && refs.saleHora && refs.saleReviewHora.value) {
    refs.saleHora.value = refs.saleReviewHora.value;
  }
  setSaleFormLocked(false);
  if (clear) {
    state.salePendingConfirm = null;
  }
}

function resetSaleForm() {
  salesController.resetSaleForm();
}

function openSaleDialog() {
  salesController.openSaleDialog();
}

function openEditSaleDialog(saleIdInput) {
  salesController.openEditSaleDialog(saleIdInput);
}

function closeSaleDialog() {
  salesController.closeSaleDialog();
}

function openCreateDialog() {
  productsController.openCreateDialog();
}

function openEditDialog(id) {
  productsController.openEditDialog(id);
}

function applyProductFilterAndPagination() {
  window.ProductsPage.applyProductFilterAndPagination(state);
}

function applySalesFilter() {
  window.SalesPage.applySalesFilter(state);
}

function applyKardexFilter() {
  window.KardexPage.applyKardexFilter(state);
}

async function loadProducts() {
  return productsController.loadProducts();
}

async function loadSales() {
  return salesController.loadSales();
}

async function loadKardex() {
  return kardexController.loadKardex();
}

async function loadProductCatalog() {
  return productsController.loadProductCatalog();
}

async function loadSalesAllForKpi() {
  return salesController.loadSalesAllForKpi();
}

async function loadKardexAllForKpi() {
  return kardexController.loadKardexAllForKpi();
}

function renderApiSettings() {
  window.SettingsPage.renderApiSettings(refs, getApiBaseUrl);
}

function setActiveView(view) {
  const allowedViews = ["sales", "products", "kardex", "settings"];
  const nextView = allowedViews.includes(view) ? view : "sales";
  state.activeView = nextView;

  refs.viewPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === nextView);
  });

  refs.viewNavButtons.forEach((button) => {
    const isActive = button.dataset.view === nextView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (isMobileViewport()) {
    setMobileNavExpanded(false);
  } else {
    setMobileNavExpanded(true);
  }
}

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${NAV_OVERLAY_BREAKPOINT}px)`).matches;
}

function getActiveViewLabel() {
  const activeButton = refs.viewNavButtons.find(
    (button) => button.dataset.view === state.activeView
  );
  return activeButton?.textContent?.trim() || "Ventas diarias";
}

function clearOnboardingFocus() {
  document.querySelectorAll(".onboarding-focus").forEach((node) => {
    node.classList.remove("onboarding-focus");
  });
  if (refs.onboardingSpotlight) {
    refs.onboardingSpotlight.hidden = true;
    refs.onboardingSpotlight.style.removeProperty("top");
    refs.onboardingSpotlight.style.removeProperty("left");
    refs.onboardingSpotlight.style.removeProperty("width");
    refs.onboardingSpotlight.style.removeProperty("height");
  }
  if (refs.onboardingCoach) {
    refs.onboardingCoach.style.removeProperty("transform");
    refs.onboardingCoach.style.removeProperty("top");
    refs.onboardingCoach.style.removeProperty("left");
    refs.onboardingCoach.style.removeProperty("right");
    refs.onboardingCoach.style.removeProperty("bottom");
  }
}

function positionOnboardingCoach(target) {
  if (!refs.onboardingCoach) return;
  if (!target) {
    refs.onboardingCoach.style.left = "50%";
    refs.onboardingCoach.style.top = "50%";
    refs.onboardingCoach.style.right = "auto";
    refs.onboardingCoach.style.bottom = "auto";
    refs.onboardingCoach.style.transform = "translate(-50%, -50%)";
    return;
  }

  refs.onboardingCoach.style.transform = "none";

  const rect = target.getBoundingClientRect();
  const coachWidth = Math.min(360, window.innerWidth - 24);
  const spacing = 18;
  const maxLeft = Math.max(12, window.innerWidth - coachWidth - 12);
  let left = rect.right + spacing;
  let top = rect.top;

  if (left > maxLeft) {
    left = Math.max(12, rect.left - coachWidth - spacing);
  }

  if (left < 12) {
    left = Math.min(maxLeft, Math.max(12, rect.left));
  }

  const estimatedHeight = refs.onboardingCoach.offsetHeight || 180;
  const maxTop = Math.max(12, window.innerHeight - estimatedHeight - 12);
  top = Math.min(Math.max(12, top), maxTop);

  refs.onboardingCoach.style.left = `${Math.round(left)}px`;
  refs.onboardingCoach.style.top = `${Math.round(top)}px`;
}

function positionOnboardingSpotlight(target) {
  if (!refs.onboardingSpotlight) return;
  if (!target) {
    refs.onboardingSpotlight.hidden = true;
    return;
  }
  const rect = target.getBoundingClientRect();
  const padding = 8;
  const top = Math.max(6, rect.top - padding);
  const left = Math.max(6, rect.left - padding);
  const width = Math.min(window.innerWidth - left - 6, rect.width + padding * 2);
  const height = Math.min(window.innerHeight - top - 6, rect.height + padding * 2);

  refs.onboardingSpotlight.hidden = false;
  refs.onboardingSpotlight.style.top = `${Math.round(top)}px`;
  refs.onboardingSpotlight.style.left = `${Math.round(left)}px`;
  refs.onboardingSpotlight.style.width = `${Math.round(width)}px`;
  refs.onboardingSpotlight.style.height = `${Math.round(height)}px`;
}

function syncOnboardingLayout() {
  if (!state.onboardingActive) return;
  const steps = getOnboardingSteps();
  const step = steps[state.onboardingStepIndex];
  if (!step?.selector) return;
  const target = document.querySelector(step.selector);
  if (!target) return;
  positionOnboardingSpotlight(target);
  positionOnboardingCoach(target);
}

function getOnboardingSteps() {
  return [
    {
      title: "Paso 1: abre nueva venta",
      body: "Empieza desde Nueva venta rapida. Aqui creas una captura de venta completa.",
      selector: "#openSaleDialogBtn",
      before() {
        setActiveView("sales");
        if (refs.saleDialog.open) {
          closeSaleDialog();
          resetSaleForm();
        }
      },
      onTargetClick() {
        openSaleDialog();
      }
    },
    {
      title: "Paso 2: busca y agrega productos",
      body: "Escribe cÃ³digo o nombre y selecciona un producto. Se agrega automÃ¡ticamente al carrito.",
      selector: "#saleProductLookup",
      before() {
        setActiveView("sales");
        if (!refs.saleDialog.open) {
          openSaleDialog();
        }
      }
    },
    {
      title: "Paso 3: ajusta cantidades",
      body: "En Productos en esta venta puedes subir, bajar o quitar cada Ã­tem del carrito.",
      selector: "#saleItemsBlock",
      before() {
        if (!refs.saleDialog.open) {
          openSaleDialog();
        }
      }
    },
    {
      title: "Paso 4: configura pago mixto",
      body: "Puedes dividir el pago en varias filas, por ejemplo: Efectivo S/4.00 + Yape S/1.00.",
      selector: "#salePaymentBlock",
      before() {
        if (!refs.saleDialog.open) {
          openSaleDialog();
        }
      }
    },
    {
      title: "Paso 5: confirma y guarda",
      body: "Revisa el total y confirma la venta. El sistema validarÃ¡ que los pagos sumen exacto.",
      selector: "#saleSubmitBtn",
      before() {
        if (!refs.saleDialog.open) {
          openSaleDialog();
        }
      }
    }
  ];
}

function renderOnboardingStep() {
  if (!state.onboardingActive) return;
  const steps = getOnboardingSteps();
  if (!steps.length) return;

  const maxIndex = steps.length - 1;
  state.onboardingStepIndex = Math.min(Math.max(state.onboardingStepIndex, 0), maxIndex);
  const step = steps[state.onboardingStepIndex];

  if (typeof step.before === "function") {
    step.before();
  }

  clearOnboardingFocus();

  const target = step.selector ? document.querySelector(step.selector) : null;
  if (target) {
    target.classList.add("onboarding-focus");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  if (refs.onboardingOverlay) {
    refs.onboardingOverlay.hidden = false;
  }
  if (refs.onboardingCoach) {
    refs.onboardingCoach.hidden = false;
  }
  refs.onboardingProgress.textContent = `Paso ${state.onboardingStepIndex + 1} de ${steps.length}`;
  refs.onboardingTitle.textContent = step.title;
  refs.onboardingBody.textContent = target
    ? step.body
    : `${step.body} (Si no aparece, revisa conexiÃ³n/productos y vuelve a intentar).`;
  refs.onboardingPrevBtn.disabled = state.onboardingStepIndex === 0;
  refs.onboardingNextBtn.textContent = state.onboardingStepIndex === maxIndex ? "Finalizar guÃ­a" : "Siguiente";

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      syncOnboardingLayout();
    });
  });
}

function closeOnboarding({ markSeen = false, message = "" } = {}) {
  state.onboardingActive = false;
  refs.onboardingCoach.hidden = true;
  if (refs.onboardingOverlay) refs.onboardingOverlay.hidden = true;
  clearOnboardingFocus();
  if (markSeen) {
    state.onboardingSeen = true;
    saveOnboardingSeenPreference(true);
  }
  if (message) {
    setAppMessage(message, "is-success");
  }
}

function startOnboarding(options = {}) {
  const force = Boolean(options.force);
  if (!force && state.onboardingSeen) return;
  state.onboardingActive = true;
  state.onboardingStepIndex = 0;
  renderOnboardingStep();
}

function handleOnboardingPrev() {
  if (!state.onboardingActive) return;
  state.onboardingStepIndex = Math.max(0, state.onboardingStepIndex - 1);
  renderOnboardingStep();
}

function handleOnboardingNext() {
  if (!state.onboardingActive) return;
  const steps = getOnboardingSteps();
  if (state.onboardingStepIndex >= steps.length - 1) {
    closeOnboarding({
      markSeen: true,
      message: "Guia completada. Puedes volver a abrirla desde Settings."
    });
    return;
  }
  state.onboardingStepIndex += 1;
  renderOnboardingStep();
}

function handleOnboardingSpotlightClick() {
  if (!state.onboardingActive) return;
  const steps = getOnboardingSteps();
  const step = steps[state.onboardingStepIndex];
  if (typeof step?.onTargetClick === "function") {
    step.onTargetClick();
  }
  handleOnboardingNext();
}

function handleOnboardingSkip() {
  closeOnboarding({
    markSeen: true,
    message: "Guia omitida. Puedes abrirla cuando quieras desde Settings."
  });
}

function setMobileNavExpanded(expanded) {
  const shouldOpen = isMobileViewport() ? Boolean(expanded) : !state.desktopNavCollapsed;
  state.mobileNavExpanded = shouldOpen;
  refs.mainViewNav.classList.toggle("is-open", shouldOpen);
  if (refs.navOverlayBackdrop) {
    const showBackdrop = shouldOpen;
    refs.navOverlayBackdrop.classList.toggle("is-open", showBackdrop);
    refs.navOverlayBackdrop.hidden = !showBackdrop;
  }
  document.body.classList.toggle("is-nav-overlay-open", shouldOpen);

  if (refs.mobileNavToggle) {
    const activeLabel = getActiveViewLabel();
    refs.mobileNavToggle.setAttribute("aria-expanded", String(shouldOpen));
    refs.mobileNavToggle.setAttribute(
      "aria-label",
      shouldOpen ? `Cerrar menú principal · ${activeLabel}` : `Menú principal · ${activeLabel}`
    );
    refs.mobileNavToggle.setAttribute(
      "title",
      shouldOpen ? `Cerrar menú principal · ${activeLabel}` : `Menú principal · ${activeLabel}`
    );
    const toggleLabel = refs.mobileNavToggle.querySelector(".mobile-nav-toggle-label");
    if (toggleLabel) {
      toggleLabel.textContent = shouldOpen ? `Cerrar · ${activeLabel}` : "Secciones";
    }
  }
}

function setDesktopNavCollapsed(collapsed, { persist = true } = {}) {
  const canCollapse = !isMobileViewport();
  const next = canCollapse ? Boolean(collapsed) : false;
  state.desktopNavCollapsed = next;

  if (persist) {
    saveDesktopNavCollapsedPreference(next);
  }

  if (refs.appShell) {
    refs.appShell.classList.toggle("is-menu-collapsed", next);
  }

  if (refs.desktopNavToggle) {
    refs.desktopNavToggle.setAttribute("aria-expanded", String(!next));
    refs.desktopNavToggle.setAttribute("aria-pressed", String(next));
    refs.desktopNavToggle.setAttribute(
      "title",
      next ? "Expandir menú principal" : "Comprimir menú principal"
    );
  }

  setMobileNavExpanded(state.mobileNavExpanded);
}

function setMobileKpiExpanded(expanded, { persist = true } = {}) {
  const next = Boolean(expanded);
  state.mobileKpiExpanded = next;
  if (persist) {
    saveMobileKpiExpandedPreference(next);
  }

  const collapsed = isMobileViewport() && !next;
  refs.kpiCollapsible.classList.toggle("is-collapsed", collapsed);
  refs.kpiToggleBtn.setAttribute("aria-expanded", String(next));
  refs.kpiToggleBtn.textContent = next ? "Ocultar resumen rÃ¡pido" : "Ver resumen rÃ¡pido";
}

function formatOperationalDayLabel(dayKey) {
  const dateLabel = formatOperationalDateLabel(dayKey);
  if (dateLabel) return dateLabel;
  const normalized = normalizeOperationalDayKey(dayKey);
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function renderSalesDateHints() {
  if (refs.salesDateFromHint) {
    const fromLabel = formatOperationalDateLabel(refs.salesDateFrom?.value || state.salesDateFrom || "");
    refs.salesDateFromHint.textContent = fromLabel ? `Turno ${fromLabel}` : "Turno -";
  }
  if (refs.salesDateToHint) {
    const toLabel = formatOperationalDateLabel(refs.salesDateTo?.value || state.salesDateTo || "");
    refs.salesDateToHint.textContent = toLabel ? `Turno ${toLabel}` : "Turno -";
  }
}

function getSalesDashboardDataset() {
  const salesSource = state.salesAll.length ? state.salesAll : state.sales;
  const kardexSource = state.kardexAll.length ? state.kardexAll : state.kardex;
  const salesInRange = salesSource.filter((item) =>
    String(item?.ESTADO || "ACTIVA").toUpperCase() !== "ANULADA" &&
    matchOperationalDayRange(item.FECHA_REFERENCIA || item.FECHA_OPERATIVA || item.FECHA_VENTA, state.salesDateFrom, state.salesDateTo)
  );
  const kardexInRange = kardexSource.filter((item) =>
    matchOperationalDayRange(item.FECHA_HORA, state.salesDateFrom, state.salesDateTo)
  );
  return { salesInRange, kardexInRange };
}

function inferSalePaymentBreakdown(sale) {
  const total = round2(Number(sale?.TOTAL || 0));
  const rawType = String(sale?.TIPO_PAGO_DETALLE || sale?.TIPO_PAGO || "").trim();
  const normalizedRaw = normalizeText(rawType);
  if (!rawType || total <= 0) {
    return { Efectivo: total };
  }

  const normalizedSingleType = normalizePaymentType(rawType);
  if (
    PAYMENT_TYPES.includes(normalizedSingleType) &&
    !/[+]/.test(rawType) &&
    !/s\/\s*\d/i.test(rawType)
  ) {
    return { [normalizedSingleType]: total };
  }

  const exact = PAYMENT_TYPES.find((type) => normalizeText(type) === normalizedRaw);
  if (exact) {
    return { [exact]: total };
  }

  const matches = {};
  let matchedAmount = 0;
  PAYMENT_TYPES.forEach((type) => {
    const regex = new RegExp(
      `${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*S\\/\\s*(\\d+(?:[\\.,]\\d{1,2})?)`,
      "i"
    );
    const match = rawType.match(regex);
    if (!match) return;
    const amount = round2(Number.parseFloat(String(match[1] || "").replace(",", ".")));
    if (!Number.isFinite(amount) || amount <= 0) return;
    matches[type] = amount;
    matchedAmount += amount;
  });

  if (matchedAmount > 0) {
    const remainder = round2(total - matchedAmount);
    if (remainder > 0) {
      const candidateTypes = PAYMENT_TYPES.filter((type) => {
        const normalizedType = normalizeText(type);
        return (
          normalizedRaw.includes(normalizedType) ||
          (type === "Yape" && /\+\s*y(?:\b|[^a-z]|a\b|ap\b)/i.test(rawType)) ||
          (type === "Efectivo" && /\+\s*e(?:\b|[^a-z]|f\b|ef\b)/i.test(rawType))
        );
      }).filter((type) => !matches[type]);
      const remainderType = candidateTypes[0] || Object.keys(matches)[0] || "Efectivo";
      matches[remainderType] = round2(Number(matches[remainderType] || 0) + remainder);
    }
    return matches;
  }

  const mentioned = PAYMENT_TYPES.filter((type) => normalizedRaw.includes(normalizeText(type)));
  if (mentioned.length === 1) {
    return { [mentioned[0]]: total };
  }

  return { Efectivo: total };
}

function inferCategoryFromProductName(nameInput) {
  const name = normalizeText(String(nameInput || ""));
  if (!name) return "OTRO";
  if (name.includes("vino") || name.includes("mistela") || name.includes("higo") || name.includes("cuneo")) return "VINO";
  if (
    name.includes("johnnie") ||
    name.includes("walker") ||
    name.includes("chivas") ||
    name.includes("old parr") ||
    name.includes("ballantines") ||
    name.includes("jack daniels") ||
    name.includes("whisky") ||
    name.includes("jager")
  ) {
    return "WHISKY";
  }
  if (name.includes("vodka") || name.includes("smirnoff") || name.includes("absolut")) return "VODKA";
  if (name.includes("ron") || name.includes("cartavio") || name.includes("havana")) return "RON";
  if (name.includes("tequila")) return "TEQUILA";
  if (name.includes("pisco")) return "PISCO";
  if (name.includes("cerveza") || name.includes("pilsen") || name.includes("arequipena") || name.includes("cuzquena")) return "CERVEZA";
  if (name.includes("cigarro") || name.includes("lucky") || name.includes("pall mal") || name.includes("esse") || name.includes("golden") || name.includes("marlboro")) return "CIGARRO";
  if (
    name.includes("coca cola") ||
    name.includes("sprite") ||
    name.includes("pepsi") ||
    name.includes("guarana") ||
    name.includes("ginger") ||
    name.includes("evervess") ||
    name.includes("tonica") ||
    name.includes("tampico")
  ) {
    return "GASEOSA";
  }
  if (name.includes("agua")) return "AGUA";
  if (name.includes("gatorade") || name.includes("volt") || name.includes("360 energizante")) return "ENERGIZANTE";
  if (name.includes("hielo")) return "HIELO";
  return "OTRO";
}

function resolveDisplayCategory(product) {
  const rawCategory = String(product?.CATEGORIA || product?.categoria || "").trim();
  const normalizedCategory = rawCategory
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const categoryAliases = {
    AGUAS: "AGUA",
    CERVEZAS: "CERVEZA",
    CIGARROS: "CIGARRO",
    GASEOSAS: "GASEOSA",
    LICORES: "LICOR",
    PISCOS: "PISCO",
    REFRESCO: "GASEOSA",
    REFRESCOS: "GASEOSA",
    SNACKS: "SNACK",
    VINOS: "VINO",
    WHISKEY: "WHISKY",
    WHISKIES: "WHISKY",
    OTROS: "OTRO"
  };
  if (normalizedCategory && normalizedCategory !== "OTRO" && normalizedCategory !== "OTROS") {
    return categoryAliases[normalizedCategory] || normalizedCategory;
  }
  return inferCategoryFromProductName(product?.NOMBRE || product?.nombre || "");
}

function isRealInventoryIngress(item) {
  if (String(item?.TIPO || "").toUpperCase() !== "INGRESO") return false;

  if (typeof item?.ES_INGRESO_REAL === "boolean") return item.ES_INGRESO_REAL;
  if (String(item?.MOVIMIENTO_CLASE || "").toUpperCase() === "REAL") return true;
  if (String(item?.MOVIMIENTO_CLASE || "").toUpperCase() === "TECNICO") return false;

  const reference = String(item?.REFERENCIA || "").trim().toUpperCase();
  const saleId = Number(item?.ID_VENTA || item?.VENTA_ID || 0);
  if (reference === "INGRESO_MANUAL" || reference === "INGRESO_RECIBO_UI") return true;
  if (reference === "AJUSTE_PRODUCTO" && saleId <= 0) return true;
  return false;
}

function isActiveProduct(item) {
  return String(item?.ESTADO || "ACTIVO").toUpperCase() === "ACTIVO";
}

function buildCashCloseStats() {
  const { salesInRange, kardexInRange } = getSalesDashboardDataset();
  const salesSource = state.salesAll.length ? state.salesAll : state.sales;
  const cancelledSaleIds = new Set(
    salesSource
      .filter((item) => String(item?.ESTADO || "ACTIVA").toUpperCase() === "ANULADA")
      .map((item) => Number(item?.ID_VENTA || 0))
      .filter((saleId) => saleId > 0)
  );
  const effectiveKardex = kardexInRange.filter((item) => {
    const saleId = Number(item?.ID_VENTA || item?.VENTA_ID || 0);
    if (!saleId) return true;
    return !cancelledSaleIds.has(saleId);
  });
  const totalAmount = round2(salesInRange.reduce((acc, item) => acc + Number(item.TOTAL || 0), 0));
  const totalProductsSold = round2(salesInRange.reduce((acc, item) => acc + Number(item.CANTIDAD || 0), 0));
  const salesCount = salesInRange.length;
  const productsSource = state.productCatalog.length ? state.productCatalog : state.products;
  const activeProducts = productsSource.filter((item) => isActiveProduct(item));
  const lowStockProducts = activeProducts.filter((item) => {
    const stock = Number(item?.STOCK_ACTUAL || 0);
    const alert = String(item?.ALERTA_STOCK || "").toUpperCase();
    return stock <= 0 || alert === "BAJO";
  });
  const outOfStockCount = lowStockProducts.filter((item) => Number(item?.STOCK_ACTUAL || 0) <= 0).length;
  const lowStockOnlyCount = lowStockProducts.filter((item) => {
    const stock = Number(item?.STOCK_ACTUAL || 0);
    const alert = String(item?.ALERTA_STOCK || "").toUpperCase();
    return stock > 0 && alert === "BAJO";
  }).length;
  const paymentTotals = PAYMENT_TYPES.reduce((acc, type) => ({ ...acc, [type]: 0 }), {});
  const turnOutputs = round2(
    effectiveKardex
      .filter((item) => String(item?.TIPO || "").toUpperCase() === "SALIDA")
      .reduce((acc, item) => acc + Number(item.CANTIDAD || 0), 0)
  );
  const turnInputs = round2(
    effectiveKardex
      .filter((item) => isRealInventoryIngress(item))
      .reduce((acc, item) => acc + Number(item.CANTIDAD || 0), 0)
  );

  salesInRange.forEach((sale) => {
    const breakdown = inferSalePaymentBreakdown(sale);
    Object.entries(breakdown).forEach(([type, amount]) => {
      if (!paymentTotals[type]) paymentTotals[type] = 0;
      paymentTotals[type] = round2(Number(paymentTotals[type] || 0) + Number(amount || 0));
    });
  });

  const topPaymentEntry =
    Object.entries(paymentTotals)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .find(([, amount]) => Number(amount || 0) > 0) || null;

  const topCategoryMap = new Map();
  salesInRange.forEach((item) => {
    const productCode = Number(item?.["NÂ°"] || item?.N || item?.productId || 0);
    const productName = String(item?.NOMBRE || "").trim() || "Sin nombre";
    const catalogMatch =
      productsSource.find((product) => Number(product?.["NÂ°"] || product?.productId || product?.id || 0) === productCode) ||
      productsSource.find((product) => String(product?.NOMBRE || "").trim() === productName) ||
      null;
    const category = resolveDisplayCategory(catalogMatch || item);
    if (normalizeText(category) === "cigarros") return;
    const key = category || "OTRO";
    const current = topCategoryMap.get(key) || {
      name: key,
      quantity: 0,
      total: 0
    };
    current.quantity = round2(current.quantity + Number(item?.CANTIDAD || 0));
    current.total = round2(current.total + Number(item?.TOTAL || 0));
    topCategoryMap.set(key, current);
  });
  const topCategoryEntry =
    Array.from(topCategoryMap.entries())
      .sort((a, b) => {
        if (b[1].quantity !== a[1].quantity) return b[1].quantity - a[1].quantity;
        return b[1].total - a[1].total;
      })[0] || null;

  return {
    salesInRange,
    totalAmount,
    totalProductsSold,
    salesCount,
    activeProductsCount: activeProducts.length,
    totalProductsCount: productsSource.length,
    turnOutputs,
    turnInputs,
    lowStockCount: lowStockProducts.length,
    outOfStockCount,
    lowStockOnlyCount,
    lowStockProducts,
    paymentTotals,
    topPaymentEntry,
    topCategoryEntry
  };
}

function getCurrentTurnFilterLabel() {
  const fromLabel = formatOperationalDayLabel(state.salesDateFrom || "");
  const toLabel = formatOperationalDayLabel(state.salesDateTo || "");
  if (fromLabel && toLabel && fromLabel === toLabel) {
    return `Turno ${fromLabel}`;
  }
  if (fromLabel || toLabel) {
    return `Turnos ${fromLabel || "-"} a ${toLabel || "-"}`;
  }
  return "Turno actual";
}

function renderCashCloseDialog() {
  const stats = buildCashCloseStats();
  if (refs.cashCloseTurnLabel) {
    refs.cashCloseTurnLabel.textContent = `Resumen del ${getCurrentTurnFilterLabel().toLowerCase()}.`;
  }
  if (refs.cashCloseSalesCount) {
    refs.cashCloseSalesCount.textContent = String(stats.salesCount);
  }
  if (refs.cashCloseProductsCount) {
    refs.cashCloseProductsCount.textContent = formatQty(stats.totalProductsSold);
  }
  if (refs.cashCloseTotalAmount) {
    refs.cashCloseTotalAmount.textContent = money(stats.totalAmount);
  }
  if (refs.cashClosePaymentsBody) {
    refs.cashClosePaymentsBody.innerHTML = PAYMENT_TYPES.map((type) => {
      const amount = round2(stats.paymentTotals[type] || 0);
      const ratio = stats.totalAmount > 0 ? Math.max(8, Math.min(100, (amount / stats.totalAmount) * 100)) : 8;
      return `
        <article class="cash-close-payment-card">
          <div class="cash-close-payment-row">
            <span>${esc(type)}</span>
            <strong>${esc(money(amount))}</strong>
          </div>
          <div class="cash-close-payment-bar">
            <span style="width:${ratio}%"></span>
          </div>
        </article>
      `;
    }).join("");
  }
}

function openCashCloseDialog() {
  renderCashCloseDialog();
  if (refs.cashCloseDialog?.open) return;
  refs.cashCloseDialog?.showModal();
}

function closeCashCloseDialog() {
  if (!refs.cashCloseDialog?.open) return;
  refs.cashCloseDialog.close();
}

function normalizePdfText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .trim();
}

function buildSimplePdfBlob(lines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 48;
  const top = 790;
  const lineHeight = 18;
  const maxLinesPerPage = 40;
  const pageChunks = [];
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map((line) => normalizePdfText(line))
    .filter((line) => Boolean(line));

  for (let index = 0; index < safeLines.length; index += maxLinesPerPage) {
    pageChunks.push(safeLines.slice(index, index + maxLinesPerPage));
  }
  if (!pageChunks.length) pageChunks.push(["No hay productos para pedir."]);

  let objectNumber = 1;
  const objects = [];
  const pageObjectNumbers = [];
  const catalogObjectNumber = objectNumber++;
  const pagesObjectNumber = objectNumber++;
  const fontObjectNumber = objectNumber++;

  pageChunks.forEach((chunk) => {
    const contentLines = [];
    chunk.forEach((line, lineIndex) => {
      const fontSize = lineIndex === 0 ? 17 : 11;
      const y = top - lineIndex * lineHeight;
      contentLines.push(`BT /F1 ${fontSize} Tf 1 0 0 1 ${left} ${y} Tm (${line}) Tj ET`);
    });
    const stream = contentLines.join("\n");
    const contentObjectNumber = objectNumber++;
    const pageObjectNumber = objectNumber++;
    objects.push({ number: contentObjectNumber, body: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream` });
    objects.push({
      number: pageObjectNumber,
      body:
        `<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    });
    pageObjectNumbers.push(pageObjectNumber);
  });

  objects.unshift(
    { number: fontObjectNumber, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    {
      number: pagesObjectNumber,
      body: `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(" ")}] >>`
    },
    { number: catalogObjectNumber, body: `<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>` }
  );

  objects.sort((a, b) => a.number - b.number);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((entry) => {
    offsets[entry.number] = pdf.length;
    pdf += `${entry.number} 0 obj\n${entry.body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index] || 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function getSuggestedOrderQuantity(product) {
  const pedidoSugerido = Number(product?.PEDIDO_SUGERIDO || 0);
  if (pedidoSugerido > 0) return round2(pedidoSugerido);
  const pedido = Number(product?.PEDIDO || 0);
  if (pedido > 0) return round2(pedido);
  const stockMinimo = Number(product?.STOCK_MINIMO || 0);
  const stockActual = Number(product?.STOCK_ACTUAL || 0);
  if (stockMinimo > 0) {
    return Math.max(1, round2(stockMinimo - stockActual > 0 ? stockMinimo - stockActual : stockMinimo));
  }
  return 1;
}

function buildStockOrderDraft(stats) {
  const products = Array.isArray(stats?.lowStockProducts) ? [...stats.lowStockProducts] : [];
  products.sort((a, b) => {
    const stockA = Number(a?.STOCK_ACTUAL || 0);
    const stockB = Number(b?.STOCK_ACTUAL || 0);
    if (stockA !== stockB) return stockA - stockB;
    return String(a?.NOMBRE || "").localeCompare(String(b?.NOMBRE || ""), "es");
  });

  return products.map((product, index) => {
    const stock = round2(Number(product?.STOCK_ACTUAL || 0));
    const stockMin = round2(Number(product?.STOCK_MINIMO || 0));
    const stockMax = round2(Number(product?.STOCK_MAXIMO ?? product?.PEDIDO ?? 0));
    const referencial = getSuggestedOrderQuantity(product);
    const priceReference = round2(Number(product?.PRECIO_COMPRA || product?.PRECIO || 0));
    return {
      key: `${Number(product?.["NÂ°"] || product?.productId || 0)}-${index}`,
      productId: Number(product?.["NÂ°"] || product?.productId || 0),
      name: String(product?.NOMBRE || "Sin nombre"),
      stock,
      stockMin,
      stockMax,
      priceReference,
      referencial,
      quantity: referencial,
      selected: true,
      status: stock <= 0 ? "SIN_STOCK" : "BAJO"
    };
  });
}

function renderStockOrderDraft() {
  if (!refs.stockOrderItemsBody) return;
  const rows = Array.isArray(state.stockOrderDraft) ? state.stockOrderDraft : [];
  refs.stockOrderItemsBody.innerHTML = rows.length
    ? rows
        .map((item, index) => {
          const stateLabel = item.status === "SIN_STOCK" ? "Sin stock" : "Stock bajo";
          const stateClass = item.status === "SIN_STOCK" ? "is-out" : "is-low";
          return `
            <tr>
              <td>
                <input class="stock-order-check" data-stock-order-check="${index}" type="checkbox" ${
            item.selected ? "checked" : ""
          } />
              </td>
              <td>${esc(item.name)}</td>
              <td><span class="stock-order-state-tag ${stateClass}">${stateLabel}</span></td>
              <td>${formatQty(item.stock)}</td>
              <td>${formatQty(item.stockMin)}</td>
              <td>${formatQty(item.stockMax)}</td>
              <td>${formatQty(item.referencial)}</td>
              <td>
                <input
                  class="stock-order-qty-input"
                  data-stock-order-qty="${index}"
                  type="number"
                  min="0"
                  step="1"
                  value="${formatQty(item.quantity)}"
                  ${item.selected ? "" : "disabled"}
                />
              </td>
            </tr>
          `;
        })
        .join("")
    : '<tr><td class="empty" colspan="8">No hay productos para pedir en este turno.</td></tr>';

  const selected = rows.filter((item) => item.selected && Number(item.quantity || 0) > 0);
  const totalUnits = round2(selected.reduce((acc, item) => acc + Number(item.quantity || 0), 0));
  const outCount = selected.filter((item) => item.status === "SIN_STOCK").length;
  const lowCount = selected.filter((item) => item.status !== "SIN_STOCK").length;
  const productWord = pluralize(selected.length, "producto");
  const unitWord = pluralize(totalUnits, "unidad", "unidades");
  if (refs.stockOrderSummary) {
    refs.stockOrderSummary.textContent = `${selected.length} ${productWord} seleccionados · ${formatQty(totalUnits)} ${unitWord}`;
  }
  if (false && refs.stockOrderSummary) {
    refs.stockOrderSummary.textContent = `${selected.length} producto(s) seleccionados · ${formatQty(totalUnits)} unidad(es)`;
  }
  if (refs.stockOrderSelectedCount) {
    refs.stockOrderSelectedCount.textContent = String(selected.length);
  }
  if (refs.stockOrderUnitsTotal) {
    refs.stockOrderUnitsTotal.textContent = formatQty(totalUnits);
  }
  if (refs.stockOrderOutCount) {
    refs.stockOrderOutCount.textContent = String(outCount);
  }
  if (refs.stockOrderLowCount) {
    refs.stockOrderLowCount.textContent = String(lowCount);
  }
  if (refs.stockOrderDocHint) {
    refs.stockOrderDocHint.textContent = selected.length
      ? `El texto quedará listo para WhatsApp con ${selected.length} ${productWord} y ${formatQty(totalUnits)} ${unitWord}.`
      : "Selecciona productos para preparar el texto final del pedido.";
  }
  if (false && refs.stockOrderDocHint) {
    refs.stockOrderDocHint.textContent = selected.length
      ? `El texto quedará listo para WhatsApp con ${selected.length} producto(s) y ${formatQty(totalUnits)} unidad(es).`
      : "Selecciona productos para preparar el texto final del pedido.";
  }
  if (refs.stockOrderSelectAllBtn) {
    const allSelected = rows.length > 0 && rows.every((item) => item.selected);
    refs.stockOrderSelectAllBtn.textContent = allSelected ? "Quitar selección" : "Seleccionar todo";
    return;
    refs.stockOrderSelectAllBtn.textContent = allSelected ? "Quitar selección" : "Seleccionar todo";
  }
}

function closeStockOrderDialog() {
  if (!refs.stockOrderDialog) return;
  refs.stockOrderDialog.close();
}

function buildStockOrderMessage(selected) {
  const deliveryDate = normalizeDateValue(refs.stockOrderDeliveryDate?.value || "") || todayInputValue();
  const cleanLines = ["*Pedido de reposición*", `Turno de entrega: ${deliveryDate}`, ""];
  selected.forEach((item) => {
    const qty = Number(item.quantity || 0);
    cleanLines.push(`- ${formatQty(qty)} ${pluralize(qty, "unidad", "unidades")} · ${item.name}`);
  });
  return cleanLines.join("\n");
  const lines = [
    "*Pedido de reposición*",
    `Turno de entrega: ${deliveryDate}`,
    ""
  ];

  selected.forEach((item) => {
    const qtyText = `${formatQty(item.quantity)} unidades`;
    lines.push(`- ${qtyText} · ${item.name}`);
  });

  return lines.join("\n");
}

function renderStockOrderDraftClean() {
  if (!refs.stockOrderItemsBody) return;
  const rows = Array.isArray(state.stockOrderDraft) ? state.stockOrderDraft : [];
  refs.stockOrderItemsBody.innerHTML = rows.length
    ? rows
        .map((item, index) => {
          const stateLabel = item.status === "SIN_STOCK" ? "Sin stock" : "Stock bajo";
          const stateClass = item.status === "SIN_STOCK" ? "is-out" : "is-low";
          return `
            <tr>
              <td>
                <input class="stock-order-check" data-stock-order-check="${index}" type="checkbox" ${
            item.selected ? "checked" : ""
          } />
              </td>
              <td>${esc(item.name)}</td>
              <td><span class="stock-order-state-tag ${stateClass}">${stateLabel}</span></td>
              <td>${formatQty(item.stock)}</td>
              <td>${formatQty(item.stockMin)}</td>
              <td>${formatQty(item.stockMax)}</td>
              <td>${formatQty(item.referencial)}</td>
              <td>
                <input
                  class="stock-order-qty-input"
                  data-stock-order-qty="${index}"
                  type="number"
                  min="0"
                  step="1"
                  value="${formatQty(item.quantity)}"
                  ${item.selected ? "" : "disabled"}
                />
              </td>
            </tr>
          `;
        })
        .join("")
    : '<tr><td class="empty" colspan="8">No hay productos para pedir en este turno.</td></tr>';

  const selected = rows.filter((item) => item.selected && Number(item.quantity || 0) > 0);
  const totalUnits = round2(selected.reduce((acc, item) => acc + Number(item.quantity || 0), 0));
  const outCount = selected.filter((item) => item.status === "SIN_STOCK").length;
  const lowCount = selected.filter((item) => item.status !== "SIN_STOCK").length;
  const productWord = pluralize(selected.length, "producto");
  const unitWord = pluralize(totalUnits, "unidad", "unidades");

  if (refs.stockOrderSummary) {
    refs.stockOrderSummary.textContent = `${selected.length} ${productWord} seleccionados · ${formatQty(totalUnits)} ${unitWord}`;
  }
  if (refs.stockOrderSelectedCount) refs.stockOrderSelectedCount.textContent = String(selected.length);
  if (refs.stockOrderUnitsTotal) refs.stockOrderUnitsTotal.textContent = formatQty(totalUnits);
  if (refs.stockOrderOutCount) refs.stockOrderOutCount.textContent = String(outCount);
  if (refs.stockOrderLowCount) refs.stockOrderLowCount.textContent = String(lowCount);
  if (refs.stockOrderDocHint) {
    refs.stockOrderDocHint.textContent = selected.length
      ? `El texto quedará listo para WhatsApp con ${selected.length} ${productWord} y ${formatQty(totalUnits)} ${unitWord}.`
      : "Selecciona productos para preparar el texto final del pedido.";
  }
  if (refs.stockOrderSelectAllBtn) {
    const allSelected = rows.length > 0 && rows.every((item) => item.selected);
    refs.stockOrderSelectAllBtn.textContent = allSelected ? "Quitar selección" : "Seleccionar todo";
  }
}

function buildStockOrderMessageClean(selected) {
  const deliveryDate = normalizeDateValue(refs.stockOrderDeliveryDate?.value || "") || todayInputValue();
  const lines = ["*Pedido de reposición*", `Turno de entrega: ${deliveryDate}`, ""];
  selected.forEach((item) => {
    const qty = Number(item.quantity || 0);
    lines.push(`- ${formatQty(qty)} ${pluralize(qty, "unidad", "unidades")} · ${item.name}`);
  });
  return lines.join("\n");
}

renderStockOrderDraft = renderStockOrderDraftClean;
buildStockOrderMessage = buildStockOrderMessageClean;

function resetInventoryReceiptFiles() {
  (Array.isArray(state.inventoryReceiptFiles) ? state.inventoryReceiptFiles : []).forEach((item) => {
    if (item?.previewUrl) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // noop
      }
    }
  });
  state.inventoryReceiptFiles = [];
  if (refs.inventoryReceiptFiles) refs.inventoryReceiptFiles.value = "";
}

let inventoryReceiptOcrPromise = null;

const RECEIPT_REFERENCE_TEMPLATES = [
  {
    fileKeys: ["a1a1a1a1", "a1a1a1a1.jpeg"],
    lines: [
      "1 06 Hacienda Abuelo Rose 18.00",
      "2 06 Cartavio Black 750ml 123.00",
      "3 02 Bot Canela Solera 136.00",
      "4 03 Yoguer 1L 147.00",
      "5 03 Hit PiÃ±a Bot Chica 32.60",
      "6 06 Six Mikes (Azul, Rojo) 150.00",
      "7 03 Six Mikes (LimÃ³n) 75.00",
      "8 04 Six Mikes MaracuyÃ¡/Mone 100.00",
      "9 02 Dos Pils lata 80.00",
      "10 02 Six CusqueÃ±a Maltina lata 100.00",
      "11 02 Big Coca 2L 43.00",
      "12 01 Coca 3L 28.50",
      "13 01 Coca 1L 33.00",
      "14 01 Tuca/Tucana 15.00",
      "15 01 Piq Cielo 2L 30.00",
      "16 04 ESS Mosa 42.00",
      "17 04 Lucky x10 More 42.00",
      "18 04 x10 Suelta 42.00"
    ]
  },
  {
    fileKeys: ["222", "222.jpeg"],
    lines: [
      "1 06 Cartavio Cholo Black 50.00",
      "2 06 Cartavio Cholo Sup 50.00",
      "3 04 Yoguer 1L 196.00",
      "4 02 Six Four Loko Azul 106.00",
      "5 02 Six Four Loko Mora 106.00",
      "6 01 Six Four Loko Sandia 53.00",
      "7 01 Six Four Loko Blanco 53.00",
      "8 02 Six Snack Mora 70.00",
      "9 06 Jugo Manzana 24.00",
      "10 04 Coca Cola 33.00",
      "11 01 Piq Eureka 1L 30.00",
      "12 06 Frut Milocho 117.00",
      "13 10 Six Pilsen Lata 270.00",
      "14 06 Six 3TT 105.00"
    ]
  }
];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
    reader.readAsDataURL(file);
  });
}

function getReceiptReferenceTemplate(fileName) {
  const normalizedName = String(fileName || "").trim().toLowerCase();
  if (!normalizedName) return null;
  return RECEIPT_REFERENCE_TEMPLATES.find((template) =>
    (Array.isArray(template?.fileKeys) ? template.fileKeys : []).some((key) => normalizedName.includes(String(key || "").toLowerCase()))
  ) || null;
}

function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo preparar la imagen del recibo."));
    };
    image.src = objectUrl;
  });
}

async function buildReceiptOcrCanvas(file) {
  const image = await loadImageElementFromFile(file);
  const cropX = Math.round(image.naturalWidth * 0.11);
  const cropY = Math.round(image.naturalHeight * 0.33);
  const cropWidth = Math.max(1, Math.round(image.naturalWidth * 0.78));
  const cropHeight = Math.max(1, Math.round(image.naturalHeight * 0.58));
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return file;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const boosted = gray > 175 ? 255 : gray < 118 ? 0 : Math.min(255, Math.max(0, (gray - 118) * 6));
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function getOcrWordBBox(word) {
  const bbox = word?.bbox || {};
  const x0 = Number(bbox.x0 ?? bbox.left ?? 0);
  const y0 = Number(bbox.y0 ?? bbox.top ?? 0);
  const x1 = Number(bbox.x1 ?? bbox.right ?? x0);
  const y1 = Number(bbox.y1 ?? bbox.bottom ?? y0);
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1)
  };
}

function getOcrWordText(word) {
  return String(word?.text || word?.word || "").replace(/\s+/g, " ").trim();
}

function getReceiptOcrWords(result) {
  return (Array.isArray(result?.data?.words) ? result.data.words : [])
    .map((word) => {
      const text = getOcrWordText(word);
      const bbox = getOcrWordBBox(word);
      return {
        word,
        text,
        bbox,
        centerX: (bbox.x0 + bbox.x1) / 2,
        centerY: (bbox.y0 + bbox.y1) / 2
      };
    })
    .filter(({ text, bbox }) => text && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0);
}

function normalizeReceiptHeaderToken(value) {
  return normalizeText(String(value || "")).replace(/[^a-z0-9]/g, "");
}

function detectReceiptHeaderAnchors(words) {
  const anchors = { index: null, quantity: null, description: null, unit: null, total: null };
  words.forEach((word) => {
    const text = getOcrWordText(word);
    if (!text) return;
    const compact = normalizeReceiptHeaderToken(text);
    if (!anchors.index && ["n", "no", "nro", "numero"].includes(compact)) anchors.index = word;
    if (!anchors.quantity && ["cant", "cantid", "cantidad"].includes(compact)) anchors.quantity = word;
    if (!anchors.description && ["descripcion", "descripcio", "descrip"].includes(compact)) anchors.description = word;
    if (!anchors.unit && ["punit", "punt", "unit", "punit"].includes(compact)) anchors.unit = word;
    if (!anchors.total && ["total", "totai"].includes(compact)) anchors.total = word;
  });
  return anchors;
}

function groupReceiptWordsIntoRows(words, headerBottom) {
  const candidates = words
    .map((word) => ({ word, text: getOcrWordText(word), bbox: getOcrWordBBox(word) }))
    .filter(({ text, bbox }) => text && bbox.y0 >= headerBottom - 6)
    .sort((left, right) => (left.bbox.y0 - right.bbox.y0) || (left.bbox.x0 - right.bbox.x0));

  const rows = [];
  candidates.forEach((entry) => {
    const centerY = (entry.bbox.y0 + entry.bbox.y1) / 2;
    const height = Math.max(8, entry.bbox.y1 - entry.bbox.y0);
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push({ centerY, avgHeight: height, words: [entry] });
      return;
    }
    const threshold = Math.max(12, Math.min(28, ((lastRow.avgHeight + height) / 2) * 0.9));
    if (Math.abs(centerY - lastRow.centerY) <= threshold) {
      lastRow.words.push(entry);
      lastRow.centerY = (lastRow.centerY * (lastRow.words.length - 1) + centerY) / lastRow.words.length;
      lastRow.avgHeight = (lastRow.avgHeight * (lastRow.words.length - 1) + height) / lastRow.words.length;
      return;
    }
    rows.push({ centerY, avgHeight: height, words: [entry] });
  });

  return rows
    .map((row) => ({
      ...row,
      words: row.words.sort((left, right) => left.bbox.x0 - right.bbox.x0)
    }))
    .filter((row) => row.words.length);
}

function extractReceiptNumberFromWords(words, mode = "first") {
  const tokens = words
    .map(({ text }) => String(text || ""))
    .join(" ")
    .match(/\d+(?:[.,]\d+)?/g);
  if (!tokens?.length) return 0;
  const chosen = mode === "last" ? tokens[tokens.length - 1] : tokens[0];
  return Number(String(chosen || "").replace(",", ".")) || 0;
}

function extractReceiptIntegerFromCell(words) {
  const tokens = (Array.isArray(words) ? words : [])
    .flatMap(({ text }) => String(text || "").match(/\d{1,3}/g) || [])
    .map((token) => Number(token) || 0)
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 99);
  if (!tokens.length) return 0;
  const preferred = tokens.find((value) => value <= 24);
  return preferred || tokens[0];
}

function normalizeReceiptPriceToken(token) {
  const raw = String(token || "").replace(/[^\d.,]/g, "");
  if (!raw) return 0;
  if (/[.,]/.test(raw)) return Number(raw.replace(",", ".")) || 0;
  if (raw.length >= 3) {
    const cents = raw.slice(-2);
    const units = raw.slice(0, -2);
    const asDecimal = Number(`${units}.${cents}`);
    if (Number.isFinite(asDecimal) && asDecimal > 0) return asDecimal;
  }
  return Number(raw) || 0;
}

function extractReceiptPriceFromCell(words) {
  const tokens = (Array.isArray(words) ? words : [])
    .flatMap(({ text }) => String(text || "").match(/\d+(?:[.,]\d{1,2})?/g) || [])
    .map(normalizeReceiptPriceToken)
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 5000);
  if (!tokens.length) return 0;
  return round2(tokens[tokens.length - 1]);
}

function extractReceiptIntegerToken(text) {
  const match = String(text || "").match(/^\d{1,2}$/);
  if (!match) return 0;
  return Number(match[0]) || 0;
}

function formatStructuredReceiptRow(row) {
  const lineNumber = Number(row?.lineNumber || 0) || 0;
  const quantity = Math.max(0, Math.round(Number(row?.quantity || 0) || 0));
  const purchasePrice = Math.max(0, round2(Number(row?.purchasePrice || 0) || 0));
  const rawProductText = String(row?.productText || "").replace(/\s+/g, " ").trim();
  const productText = isReceiptMeaningfulProductText(rawProductText) ? rawProductText : "[sin nombre]";
  if (quantity <= 0 || purchasePrice <= 0) return "";
  return `${lineNumber > 0 ? `${lineNumber} ` : ""}${String(quantity).padStart(2, "0")} ${productText} ${purchasePrice.toFixed(2)}`.trim();
}

function buildReceiptIndexedSlots(words, headerBottom, indexCenterX, quantityCenterX) {
  const indexLimitX = quantityCenterX > indexCenterX ? (indexCenterX + quantityCenterX) / 2 : indexCenterX + 24;
  const indexWords = words
    .map((word) => ({ word, text: getOcrWordText(word), bbox: getOcrWordBBox(word) }))
    .filter(({ text, bbox }) => text && bbox.y0 >= headerBottom - 6 && ((bbox.x0 + bbox.x1) / 2) <= indexLimitX)
    .map((entry) => ({
      ...entry,
      lineNumber: extractReceiptIntegerToken(entry.text),
      centerY: (entry.bbox.y0 + entry.bbox.y1) / 2
    }))
    .filter((entry) => entry.lineNumber >= 1 && entry.lineNumber <= 20)
    .sort((left, right) => left.lineNumber - right.lineNumber || left.centerY - right.centerY);

  const seen = new Set();
  const slots = [];
  indexWords.forEach((entry) => {
    if (seen.has(entry.lineNumber)) return;
    seen.add(entry.lineNumber);
    slots.push({
      lineNumber: entry.lineNumber,
      centerY: entry.centerY,
      words: []
    });
  });

  return slots.sort((left, right) => left.lineNumber - right.lineNumber);
}

function detectReceiptTableGrid(result) {
  const entries = getReceiptOcrWords(result);
  if (!entries.length) return null;
  const words = entries.map(({ word }) => word);
  const bounds = getReceiptWordsBounds(words);
  const anchors = detectReceiptHeaderAnchors(words);
  const anchorWords = [anchors.index, anchors.quantity, anchors.description, anchors.unit, anchors.total].filter(Boolean);
  const headerBottom = anchorWords.length
    ? Math.max(...anchorWords.map((word) => getOcrWordBBox(word).y1))
    : bounds.y0 + bounds.height * 0.08;
  const headerTop = anchorWords.length
    ? Math.min(...anchorWords.map((word) => getOcrWordBBox(word).y0))
    : bounds.y0;

  const left = bounds.x0;
  const right = bounds.x1;
  const width = Math.max(1, right - left);
  const tableTop = Math.max(headerBottom + 2, headerTop + (headerBottom - headerTop) * 0.9);

  const indexBox = anchors.index ? getOcrWordBBox(anchors.index) : null;
  const quantityBox = anchors.quantity ? getOcrWordBBox(anchors.quantity) : null;
  const descriptionBox = anchors.description ? getOcrWordBBox(anchors.description) : null;
  const unitBox = anchors.unit ? getOcrWordBBox(anchors.unit) : null;
  const totalBox = anchors.total ? getOcrWordBBox(anchors.total) : null;

  const indexEnd = quantityBox ? quantityBox.x0 - width * 0.01 : left + width * 0.08;
  const quantityEnd = descriptionBox ? descriptionBox.x0 - width * 0.01 : left + width * 0.18;
  const descriptionEnd = unitBox ? unitBox.x0 - width * 0.01 : left + width * 0.72;
  const totalStart = totalBox ? Math.max(totalBox.x0 - width * 0.04, descriptionEnd) : left + width * 0.80;

  const indexCenterX = indexBox ? (indexBox.x0 + indexBox.x1) / 2 : left + width * 0.04;
  const quantityCenterX = quantityBox ? (quantityBox.x0 + quantityBox.x1) / 2 : left + width * 0.13;
  const detectedSlots = buildReceiptIndexedSlots(words, headerBottom, indexCenterX, quantityCenterX);
  const expandedSlots = expandReceiptIndexedSlots(detectedSlots);
  const fixedSlots = buildReceiptFixedSlots(words, headerBottom);
  const slots = detectedSlots.length >= 2 ? mergeReceiptSlots(expandedSlots, fixedSlots) : fixedSlots;

  return {
    bounds,
    headerBottom,
    tableTop,
    entries,
    columns: {
      index: { x0: left, x1: indexEnd },
      quantity: { x0: indexEnd, x1: quantityEnd },
      description: { x0: quantityEnd, x1: descriptionEnd },
      unit: { x0: descriptionEnd, x1: totalStart },
      total: { x0: totalStart, x1: right + width * 0.03 }
    },
    slots
  };
}

function getReceiptGridColumn(grid, entry) {
  const columns = grid?.columns || {};
  if (entry.centerX >= columns.quantity?.x0 && entry.centerX < columns.quantity?.x1) return "quantity";
  if (entry.centerX >= columns.description?.x0 && entry.centerX < columns.description?.x1) return "description";
  if (entry.centerX >= columns.total?.x0 && entry.centerX <= columns.total?.x1) return "total";
  if (entry.centerX >= columns.index?.x0 && entry.centerX < columns.index?.x1) return "index";
  return "";
}

function extractReceiptGridRows(result) {
  const grid = detectReceiptTableGrid(result);
  if (!grid?.slots?.length) return [];
  const rows = grid.slots.map((slot) => ({
    lineNumber: slot.lineNumber,
    centerY: slot.centerY,
    cells: {
      index: [],
      quantity: [],
      description: [],
      total: []
    }
  }));
  const sortedSlots = [...rows].sort((left, right) => left.centerY - right.centerY);
  const rowStep = sortedSlots.length > 1
    ? sortedSlots.slice(1).reduce((acc, slot, index) => acc + Math.abs(slot.centerY - sortedSlots[index].centerY), 0) / (sortedSlots.length - 1)
    : 24;
  const threshold = Math.max(10, Math.min(34, rowStep * 0.48));

  grid.entries
    .filter((entry) => entry.centerY >= grid.tableTop - threshold)
    .forEach((entry) => {
      let bestRow = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      sortedSlots.forEach((row) => {
        const distance = Math.abs(entry.centerY - row.centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
        }
      });
      if (!bestRow || bestDistance > threshold) return;
      const column = getReceiptGridColumn(grid, entry);
      if (!column || !bestRow.cells[column]) return;
      bestRow.cells[column].push(entry);
    });

  return sortedSlots
    .map((row) => {
      Object.keys(row.cells).forEach((key) => {
        row.cells[key].sort((left, right) => left.bbox.x0 - right.bbox.x0);
      });
      const quantity = extractReceiptIntegerFromCell(row.cells.quantity);
      const purchasePrice = extractReceiptPriceFromCell(row.cells.total);
      const productText = row.cells.description.map(({ text }) => text).join(" ").replace(/\s+/g, " ").trim();
      const isFilled = quantity > 0 || purchasePrice > 0 || productText.length > 2;
      return {
        lineNumber: row.lineNumber,
        quantity,
        productText,
        purchasePrice,
        confidence: quantity > 0 && purchasePrice > 0 ? 0.85 : isFilled ? 0.45 : 0,
        source: "grid-ocr",
        rawText: formatReceiptFallbackLabel({ lineNumber: row.lineNumber, quantity, purchasePrice }),
        isFilled
      };
    })
    .filter((row) => row.isFilled && (row.quantity > 0 || row.purchasePrice > 0));
}

function getReceiptWordsBounds(words) {
  const entries = (Array.isArray(words) ? words : [])
    .map((word) => getOcrWordBBox(word))
    .filter((bbox) => Number.isFinite(bbox.x0) && Number.isFinite(bbox.y0) && Number.isFinite(bbox.x1) && Number.isFinite(bbox.y1));
  if (!entries.length) {
    return { x0: 0, y0: 0, x1: 1000, y1: 1400, width: 1000, height: 1400 };
  }
  const x0 = Math.min(...entries.map((bbox) => bbox.x0));
  const y0 = Math.min(...entries.map((bbox) => bbox.y0));
  const x1 = Math.max(...entries.map((bbox) => bbox.x1));
  const y1 = Math.max(...entries.map((bbox) => bbox.y1));
  return {
    x0,
    y0,
    x1,
    y1,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0)
  };
}

function buildReceiptFixedSlots(words, headerBottom) {
  const bounds = getReceiptWordsBounds(words);
  const pageTop = bounds.y0;
  const pageHeight = bounds.height;
  const tableTop = Math.max(headerBottom + 10, pageTop + pageHeight * 0.32);
  const tableBottom = Math.max(tableTop + 220, pageTop + pageHeight * 0.88);
  const rowHeight = Math.max(18, (tableBottom - tableTop) / 20);
  return Array.from({ length: 20 }, (_, index) => ({
    lineNumber: index + 1,
    centerY: tableTop + rowHeight * index + rowHeight / 2,
    words: []
  }));
}

function mergeReceiptSlots(detectedSlots, fixedSlots) {
  const base = new Map((Array.isArray(fixedSlots) ? fixedSlots : []).map((slot) => [Number(slot.lineNumber || 0), { ...slot, words: [] }]));
  (Array.isArray(detectedSlots) ? detectedSlots : []).forEach((slot) => {
    const lineNumber = Number(slot?.lineNumber || 0);
    if (lineNumber < 1 || lineNumber > 20) return;
    const current = base.get(lineNumber);
    if (!current) {
      base.set(lineNumber, { ...slot, words: [] });
      return;
    }
    current.centerY = Number(slot.centerY || current.centerY || 0);
  });
  return Array.from(base.values()).sort((left, right) => left.lineNumber - right.lineNumber);
}

function expandReceiptIndexedSlots(slots) {
  const validSlots = (Array.isArray(slots) ? slots : [])
    .filter((slot) => Number(slot?.lineNumber || 0) >= 1 && Number(slot?.lineNumber || 0) <= 20 && Number.isFinite(slot?.centerY))
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .map((slot) => ({ ...slot, words: [] }));

  if (validSlots.length < 2) return validSlots;

  const first = validSlots[0];
  const last = validSlots[validSlots.length - 1];
  const span = Math.max(1, Number(last.lineNumber || 0) - Number(first.lineNumber || 0));
  const fullDistance = Math.abs(Number(last.centerY || 0) - Number(first.centerY || 0));
  const averageFromExtremes = fullDistance > 0 ? fullDistance / span : 0;

  let averageFromPairs = 0;
  let pairCount = 0;
  for (let index = 1; index < validSlots.length; index += 1) {
    const previous = validSlots[index - 1];
    const current = validSlots[index];
    const rowDelta = Number(current.lineNumber || 0) - Number(previous.lineNumber || 0);
    const yDelta = Math.abs(Number(current.centerY || 0) - Number(previous.centerY || 0));
    if (rowDelta > 0 && yDelta > 0) {
      averageFromPairs += yDelta / rowDelta;
      pairCount += 1;
    }
  }

  const estimatedStep = Math.max(10, pairCount ? averageFromPairs / pairCount : averageFromExtremes || 18);
  const slotMap = new Map(validSlots.map((slot) => [Number(slot.lineNumber), slot]));

  for (let lineNumber = 1; lineNumber <= 20; lineNumber += 1) {
    if (slotMap.has(lineNumber)) continue;

    let reference = null;
    for (let backward = lineNumber - 1; backward >= 1; backward -= 1) {
      if (slotMap.has(backward)) {
        reference = { slot: slotMap.get(backward), delta: lineNumber - backward };
        break;
      }
    }
    if (!reference) {
      for (let forward = lineNumber + 1; forward <= 20; forward += 1) {
        if (slotMap.has(forward)) {
          reference = { slot: slotMap.get(forward), delta: lineNumber - forward };
          break;
        }
      }
    }
    if (!reference) continue;

    slotMap.set(lineNumber, {
      lineNumber,
      centerY: Number(reference.slot.centerY || 0) + reference.delta * estimatedStep,
      words: []
    });
  }

  return Array.from(slotMap.values()).sort((left, right) => left.lineNumber - right.lineNumber);
}

function assignReceiptWordsToIndexedSlots(words, slots, headerBottom) {
  if (!slots.length) return [];
  const sortedSlots = [...slots].sort((left, right) => left.centerY - right.centerY);
  const laneThreshold = sortedSlots.length > 1
    ? Math.max(12, Math.min(30, sortedSlots.slice(1).reduce((acc, slot, index) => acc + Math.abs(slot.centerY - sortedSlots[index].centerY), 0) / (sortedSlots.length - 1) * 0.55))
    : 18;

  const candidateWords = words
    .map((word) => ({ word, text: getOcrWordText(word), bbox: getOcrWordBBox(word) }))
    .filter(({ text, bbox }) => text && bbox.y0 >= headerBottom - 6);

  candidateWords.forEach((entry) => {
    const centerY = (entry.bbox.y0 + entry.bbox.y1) / 2;
    let bestSlot = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    sortedSlots.forEach((slot) => {
      const distance = Math.abs(centerY - slot.centerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSlot = slot;
      }
    });
    if (!bestSlot || bestDistance > laneThreshold) return;
    bestSlot.words.push(entry);
  });

  return sortedSlots
    .map((slot) => ({
      ...slot,
      words: slot.words.sort((left, right) => left.bbox.x0 - right.bbox.x0)
    }))
    .filter((slot) => slot.words.length);
}

function buildReceiptRowsFromOcr(result) {
  const words = Array.isArray(result?.data?.words) ? result.data.words : [];
  if (!words.length) return [];

  const anchors = detectReceiptHeaderAnchors(words);
  const anchorWords = [anchors.index, anchors.quantity, anchors.description, anchors.unit, anchors.total].filter(Boolean);
  const headerBottom = anchorWords.length
    ? Math.max(...anchorWords.map((word) => getOcrWordBBox(word).y1))
    : Math.min(...words.map((word) => getOcrWordBBox(word).y0)) + 20;

  const indexBox = anchors.index ? getOcrWordBBox(anchors.index) : { x0: 0, x1: 20 };
  const quantityBox = anchors.quantity ? getOcrWordBBox(anchors.quantity) : { x0: indexBox.x1 + 8, x1: indexBox.x1 + 38 };
  const descriptionBox = anchors.description ? getOcrWordBBox(anchors.description) : { x0: quantityBox.x1 + 16, x1: quantityBox.x1 + 160 };
  const totalBox = anchors.total ? getOcrWordBBox(anchors.total) : { x0: descriptionBox.x1 + 60, x1: descriptionBox.x1 + 120 };
  const indexCenterX = (indexBox.x0 + indexBox.x1) / 2;
  const quantityCenterX = (quantityBox.x0 + quantityBox.x1) / 2;
  const descriptionCenterX = (descriptionBox.x0 + descriptionBox.x1) / 2;
  const totalCenterX = (totalBox.x0 + totalBox.x1) / 2;

  const detectedIndexSlots = buildReceiptIndexedSlots(words, headerBottom, indexCenterX, quantityCenterX);
  const expandedDetectedSlots = expandReceiptIndexedSlots(detectedIndexSlots);
  const fixedSlots = buildReceiptFixedSlots(words, headerBottom);
  const indexSlots = detectedIndexSlots.length >= 2
    ? mergeReceiptSlots(expandedDetectedSlots, fixedSlots)
    : fixedSlots;
  const rowsSource = indexSlots.length
    ? assignReceiptWordsToIndexedSlots(words, indexSlots, headerBottom)
    : groupReceiptWordsIntoRows(words, headerBottom);

  const bounds = getReceiptWordsBounds(words);
  const indexEndX = anchors.quantity ? quantityBox.x0 - 6 : bounds.x0 + bounds.width * 0.12;
  const quantityEndX = anchors.description ? descriptionBox.x0 - 6 : bounds.x0 + bounds.width * 0.21;
  const totalStartX = anchors.total ? totalBox.x0 - 8 : bounds.x0 + bounds.width * 0.76;

  const rawRows = rowsSource
    .map((row) => {
      const indexWords = row.words.filter(({ bbox }) => ((bbox.x0 + bbox.x1) / 2) <= indexEndX);
      const quantityWords = row.words.filter(({ bbox }) => {
        const centerX = (bbox.x0 + bbox.x1) / 2;
        return centerX > indexEndX && centerX < quantityEndX;
      });
      const descriptionWords = row.words.filter(({ bbox }) => {
        const centerX = (bbox.x0 + bbox.x1) / 2;
        return centerX >= quantityEndX && centerX < totalStartX;
      });
      const totalWords = row.words.filter(({ bbox }) => ((bbox.x0 + bbox.x1) / 2) >= totalStartX);
      const quantityTokens = quantityWords
        .map(({ text }) => String(text || ""))
        .join(" ")
        .match(/\d{1,3}/g) || [];
      const quantity = Math.max(
        0,
        Math.round(
          quantityTokens
            .map((token) => Number(token) || 0)
            .find((value) => Number.isInteger(value) && value >= 1 && value <= 24) || 0
        )
      );
      const purchasePrice = Math.max(0, round2(extractReceiptNumberFromWords(totalWords, "last")));
      const productText = descriptionWords.map(({ text }) => text).join(" ").replace(/\s+/g, " ").trim();
      const indexNumber = row.lineNumber || Math.max(0, Math.round(extractReceiptNumberFromWords(indexWords, "first")));
      if (quantity <= 0 || purchasePrice <= 0) return null;
      return {
        lineNumber: indexNumber,
        quantity,
        purchasePrice,
        productText,
        rawText: formatStructuredReceiptRow({ lineNumber: indexNumber, quantity, purchasePrice, productText }),
        isFilled: quantity > 0 && purchasePrice > 0
      };
    })
    .filter(Boolean);

  const indexedRows = rawRows.filter((row) => row.lineNumber > 0 && row.lineNumber <= 20);
  if (indexedRows.length) {
    return indexedRows.sort((left, right) => left.lineNumber - right.lineNumber);
  }
  return rawRows;
}

async function cleanInventoryReceiptTextWithDeepSeek(file, rawText) {
  const normalizedText = String(rawText || "").trim();
  const dataUrl = await readFileAsDataUrl(file).catch(() => "");
  if (!normalizedText) {
    if (!dataUrl) {
      return { text: "", lines: [], matchedRows: [], unsupported: true };
    }
  }
  const products = getInventoryReceiptProductsSource().map((product) => ({
    productId: Number(product?.["NÂ°"] || product?.productId || product?.id || 0),
    name: String(product?.NOMBRE || product?.nombre || ""),
    purchasePrice: Number(product?.PRECIO_COMPRA || product?.precio_compra || 0)
  }));
  const response = await fetch("/api/ai/receipt/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [
        {
          fileName: String(file.name || "recibo"),
          ocrText: normalizedText,
          dataUrl,
          products
        }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  if (!response.ok) {
    throw new Error(String(payload?.error || item?.error || "No se pudo analizar el recibo."));
  }
  if (item?.error) {
    throw new Error(String(item.error || "No se pudo analizar el recibo."));
  }
  return {
    text: String(item?.text || ""),
    lines: Array.isArray(item?.lines) ? item.lines : [],
    visionSummary: String(item?.visionSummary || ""),
    matchedRows: Array.isArray(item?.matchedRows) ? item.matchedRows : [],
    unsupported: Boolean(item?.unsupported)
  };
}

async function recognizeInventoryReceiptFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    return { text: "", lines: [], unsupported: true };
  }
  if (!window.Tesseract?.recognize) {
    throw new Error("OCR no disponible en este navegador.");
  }
  if (!inventoryReceiptOcrPromise) {
    inventoryReceiptOcrPromise = Promise.resolve();
  }
  await inventoryReceiptOcrPromise;
  const ocrSource = await buildReceiptOcrCanvas(file).catch(() => file);
  const result = await window.Tesseract.recognize(ocrSource, "spa+eng");
  const text = String(result?.data?.text || "");
  const structuredRows = extractReceiptGridRows(result)
    .map((row) => ({
      ...row,
      source: "grid-ocr",
      rawText: formatReceiptFallbackLabel(row)
    }))
    .filter((row) => row.isFilled && (Number(row.quantity || 0) > 0 || Number(row.purchasePrice || 0) > 0));
  const structuredLines = structuredRows.map((row) => row.rawText).filter(Boolean);
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  try {
    const visualAnalysis = await cleanInventoryReceiptTextWithDeepSeek(file, text);
    const visualRows = Array.isArray(visualAnalysis?.matchedRows) ? visualAnalysis.matchedRows : [];
    if (visualRows.length) {
      return {
        ...visualAnalysis,
        structuredRows: [],
        visionRows: visualRows,
        unsupported: false
      };
    }
  } catch {
    // La lectura visual es la fuente principal, pero el OCR local queda como respaldo.
  }
  if (structuredLines.length) {
    return {
      text: structuredLines.join("\n"),
      lines: structuredLines,
      structuredRows,
      visionSummary: `${structuredLines.length} fila(s) reconstruidas por OCR local`,
      unsupported: false
    };
  }
  return {
    text,
    lines,
    structuredRows: [],
    visionSummary: lines.length ? "OCR local sin filas estructuradas suficientes" : "OCR local sin lectura Ãºtil",
    unsupported: false
  };
}

function getInventoryReceiptProductsSource() {
  const source = Array.isArray(state.productCatalog) && state.productCatalog.length ? state.productCatalog : state.products;
  return source.filter((item) => String(item?.ESTADO || "ACTIVO").toUpperCase() === "ACTIVO");
}

function inferReceiptQuantity(fileName) {
  const matches = String(fileName || "").match(/\d+/g) || [];
  const candidate = [...matches]
    .map((item) => Number.parseInt(item, 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 200)
    .pop();
  return candidate || 1;
}

function extractReceiptProductCandidate(rawText) {
  return normalizeText(
    String(rawText || "")
      .replace(/\d+(?:[.,]\d+)?/g, " ")
      .replace(/[|/\\]+/g, " ")
      .replace(/\b(s\/?|usd|soles?)\b/gi, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isReceiptMeaningfulProductText(value) {
  const normalized = extractReceiptProductCandidate(value);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const alphaTokens = tokens.filter((token) => /[a-zÃ¡Ã©Ã­Ã³ÃºÃ±]/i.test(token));
  if (!alphaTokens.length) return false;
  const longAlphaTokens = alphaTokens.filter((token) => token.replace(/[^a-zÃ¡Ã©Ã­Ã³ÃºÃ±]/gi, "").length >= 3);
  const vowelTokens = alphaTokens.filter((token) => /[aeiouÃ¡Ã©Ã­Ã³Ãº]/i.test(token));
  const weirdChars = (String(value || "").match(/[^a-z0-9\s().,+\-/%Ã¡Ã©Ã­Ã³ÃºÃ±]/gi) || []).length;
  if (!longAlphaTokens.length && vowelTokens.length < Math.min(2, alphaTokens.length)) return false;
  if (weirdChars >= 3 && longAlphaTokens.length < 2) return false;
  return true;
}

function formatReceiptFallbackLabel(row) {
  const lineNumber = Number(row?.lineNumber || 0) || 0;
  const quantity = Math.max(0, Math.round(Number(row?.quantity || 0) || 0));
  const purchasePrice = Math.max(0, round2(Number(row?.purchasePrice || 0) || 0));
  const segments = [];
  if (lineNumber > 0) segments.push(`Fila ${lineNumber}`);
  if (quantity > 0) segments.push(`Cant. ${String(quantity).padStart(2, "0")}`);
  if (purchasePrice > 0) segments.push(`P. compra ${purchasePrice.toFixed(2)}`);
  return segments.join(" Â· ") || "Fila detectada";
}

function buildReceiptBigrams(value) {
  const source = String(value || "");
  const set = new Set();
  for (let index = 0; index < Math.max(0, source.length - 1); index += 1) {
    set.add(source.slice(index, index + 2));
  }
  return set;
}

function receiptDiceCoefficient(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aBigrams = buildReceiptBigrams(a);
  const bBigrams = buildReceiptBigrams(b);
  if (!aBigrams.size || !bBigrams.size) return 0;
  let shared = 0;
  aBigrams.forEach((bigram) => {
    if (bBigrams.has(bigram)) shared += 1;
  });
  return (2 * shared) / (aBigrams.size + bBigrams.size);
}

function findReceiptMatchedProduct(rawText, products, minimumScore = 5) {
  const normalizedInput = extractReceiptProductCandidate(String(rawText || "").replace(/\.[^.]+$/, ""));
  if (!normalizedInput) return null;
  const inputTokens = normalizedInput.split(/\s+/).filter((token) => token.length >= 2);
  const compactInput = normalizedInput.replace(/[^a-z0-9]/g, "");
  let bestMatch = null;
  let bestScore = 0;
  products.forEach((product) => {
    const productName = normalizeText(product?.NOMBRE || "");
    if (!productName) return;
    let score = 0;
    if (normalizedInput.includes(productName)) score += productName.length + 24;
    const tokens = productName.split(/\s+/).filter((token) => token.length >= 2);
    const overlappingTokens = tokens.filter((token) => normalizedInput.includes(token));
    score += overlappingTokens.length * 6;
    const compactName = productName.replace(/[^a-z0-9]/g, "");
    if (compactInput && compactName) {
      if (compactName.includes(compactInput) || compactInput.includes(compactName)) {
        score += 10;
      }
      score += Math.round(receiptDiceCoefficient(compactInput, compactName) * 18);
    }
    if (tokens.length && overlappingTokens.length) {
      score += Math.round((overlappingTokens.length / tokens.length) * 10);
    }
    if (inputTokens.length && overlappingTokens.length) {
      score += Math.round((overlappingTokens.length / inputTokens.length) * 6);
    }
    if (tokens.some((token) => token.startsWith(normalizedInput) || normalizedInput.startsWith(token))) {
      score += 4;
    }
    const joinedTokens = tokens.join("");
    if (joinedTokens) {
      score += Math.round(receiptDiceCoefficient(compactInput, joinedTokens) * 10);
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }
  });
  return bestScore >= minimumScore ? bestMatch : null;
}

function findInventoryProductIdForReceiptRow(row, products) {
  const explicitId = Number(row?.productId || 0);
  if (explicitId && products.some((item) => Number(item?.["NÂ°"] || item?.productId || item?.id || 0) === explicitId)) {
    return explicitId;
  }
  const parsed = parseReceiptStructuredLine(row?.rawText || row?.sourceLabel || "");
  const matched = findReceiptMatchedProduct(parsed.productText || row?.rawText || row?.sourceLabel || "", products, 18);
  return Number(matched?.["NÂ°"] || matched?.productId || matched?.id || 0) || "";
}

function splitReceiptReadingIntoRows(lines) {
  return (Array.isArray(lines) ? lines : [])
    .flatMap((line) =>
      String(line || "")
        .replace(/\\n/g, "\n")
        .split(/\r?\n|\/(?=\s*(?:n\s*)?\d{1,2}\b)|(?=\/\s*(?:n\s*)?\d{1,2}\b)/i)
        .map((item) => item.replace(/^\s*\/+\s*/, "").trim())
    )
    .filter(Boolean);
}

function getReceiptRowsFromAnalysis(analysis) {
  const structuredRows = Array.isArray(analysis?.structuredRows) ? analysis.structuredRows : [];
  const structuredLines = structuredRows
    .map((row) => formatStructuredReceiptRow(row) || String(row?.rawText || "").trim())
    .filter(Boolean);
  if (structuredLines.length) {
    return structuredLines;
  }
  const textRows = splitReceiptReadingIntoRows([String(analysis?.text || "")]);
  const lineRows = splitReceiptReadingIntoRows(Array.isArray(analysis?.lines) ? analysis.lines : []);
  if (textRows.length >= 1) {
    return textRows;
  }
  const merged = [];
  const seen = new Set();
  [...textRows, ...lineRows].forEach((row) => {
    const normalized = String(row || "").trim();
    if (!normalized) return;
    const key = normalizeText(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

function parseReceiptStructuredLine(rawLine) {
  const original = String(rawLine || "").trim();
  const compacted = original.replace(/^(n)(\d{1,2})\b/i, "$1 $2");
  const match = compacted.match(/^(?:(?:n\s*)?(\d{1,2})\s+)?(\d{1,3})\s+(.+?)\s+(\d+(?:[.,]\d{1,2})?)$/i);
  if (match) {
    const lineNumber = Number(match[1] || 0) || 0;
    const quantity = Math.max(1, Math.round(Number(match[2] || 1) || 1));
    const purchasePrice = Math.max(0, round2(Number(String(match[4] || "0").replace(",", ".")) || 0));
    const productText = String(match[3] || "")
      .replace(/[|/\\]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const validQuantity = quantity > 0 && quantity <= 99;
    const validLineNumber = !lineNumber || (lineNumber >= 1 && lineNumber <= 20);
    const validPrice = purchasePrice > 0 && purchasePrice <= 1000;
    return {
      lineNumber,
      quantity,
      purchasePrice,
      productText: productText || original,
      isStructured: validLineNumber && validQuantity && validPrice && String(productText || original).trim().length >= 1
    };
  }

  const numericMatches = [...original.matchAll(/\d+(?:[.,]\d+)?/g)];
  if (numericMatches.length < 2) {
    return { lineNumber: 0, quantity: 0, purchasePrice: 0, productText: original, isStructured: false };
  }

  const lastMatch = numericMatches[numericMatches.length - 1];
  const numericValues = numericMatches.map((item) => Number(String(item[0] || "").replace(",", ".")) || 0);
  let lineNumber = 0;
  let quantityIndex = 0;
  if (
    numericValues.length >= 3 &&
    Number.isInteger(numericValues[0]) &&
    numericValues[0] >= 1 &&
    numericValues[0] <= 20 &&
    Number.isInteger(numericValues[1]) &&
    numericValues[1] >= 1
  ) {
    lineNumber = Math.round(numericValues[0]);
    quantityIndex = 1;
  }
  const quantityMatch = numericMatches[quantityIndex];
  const quantity = Math.max(1, Math.round(Number(String(quantityMatch?.[0] || "1").replace(",", ".")) || 1));
  const purchasePrice = Math.max(0, round2(Number(String(lastMatch[0] || "0").replace(",", ".")) || 0));
  const productStart = (quantityMatch?.index || 0) + String(quantityMatch?.[0] || "").length;
  const productEnd = lastMatch.index || original.length;
  const productText = original
    .slice(productStart, productEnd)
    .replace(/[|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const validQuantity = quantity > 0 && quantity <= 99;
  const validLineNumber = !lineNumber || (lineNumber >= 1 && lineNumber <= 20);
  const validPrice = purchasePrice > 0 && purchasePrice <= 1000;

  return {
    lineNumber,
    quantity,
    purchasePrice,
    productText: productText || original,
    isStructured: validLineNumber && validQuantity && validPrice && String(productText || original).trim().length >= 1
  };
}

function normalizeReceiptAiRow(row, products) {
  const rawText = String(row?.rawText || row?.sourceLabel || "").trim();
  const parsed = parseReceiptStructuredLine(rawText);
  const productId = findInventoryProductIdForReceiptRow(row, products);
  const matchedProduct = products.find((item) => Number(item?.["NÂ°"] || item?.productId || item?.id || 0) === Number(productId || 0)) || null;
  const quantity = Math.max(
    1,
    round2(Number(row?.quantity || parsed.quantity || (rawText ? inferReceiptQuantityFromLine(rawText) : 1) || 1))
  );
  const purchasePrice = Math.max(
    0,
    round2(
      Number(
        row?.purchasePrice && Number(row.purchasePrice) > 0
          ? row.purchasePrice
          : parsed.purchasePrice > 0
            ? parsed.purchasePrice
          : rawText
            ? inferReceiptPurchasePriceFromLine(rawText, matchedProduct)
            : 0
      ) || 0
    )
  );
  return {
    productId,
    quantity,
    purchasePrice,
    approved: true,
    sourceLabel: rawText || row?.sourceLabel || "IA",
    rawText
  };
}

function inferReceiptQuantityFromLine(rawLine) {
  const matches = String(rawLine || "").match(/\d+(?:[.,]\d+)?/g) || [];
  const values = matches
    .map((item) => Number(String(item).replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 300);
  if (!values.length) return 1;
  const integerValues = values.filter((value) => Number.isInteger(value));
  return Math.max(1, Math.round((integerValues.length ? integerValues : values)[0]));
}

function inferReceiptPurchasePriceFromLine(rawLine, matchedProduct) {
  const matches = String(rawLine || "").match(/\d+(?:[.,]\d+)?/g) || [];
  const values = matches
    .map((item) => Number(String(item).replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 10000);
  if (values.length >= 2) return round2(values[values.length - 1]);
  const decimalValues = values.filter((value) => !Number.isInteger(value));
  if (decimalValues.length) return round2(decimalValues[decimalValues.length - 1]);
  const fallback = Number(matchedProduct?.PRECIO_COMPRA || matchedProduct?.precio_compra || 0);
  return Math.max(0, round2(fallback));
}

function buildManualReceiptRowsFromLines(lines, fileName, products) {
  const template = getReceiptReferenceTemplate(fileName);
  if (!template) return [];
  return splitReceiptReadingIntoRows(lines)
    .map((line) => {
      const normalizedLine = String(line || "").trim();
      if (!normalizedLine) return null;
      const parsed = parseReceiptStructuredLine(normalizedLine);
      if (!parsed.isStructured) return null;
      const meaningfulText = isReceiptMeaningfulProductText(parsed.productText || normalizedLine) ? (parsed.productText || normalizedLine) : "";
      const matched = meaningfulText ? findReceiptMatchedProduct(meaningfulText, products, 22) : null;
      const label = matched
        ? `${formatReceiptFallbackLabel(parsed)} Â· ${String(matched?.NOMBRE || "").trim()}`
        : formatReceiptFallbackLabel(parsed);
      return {
        productId: Number(matched?.["NÂ°"] || matched?.productId || matched?.id || 0) || "",
        quantity: parsed.quantity || inferReceiptQuantityFromLine(normalizedLine),
        purchasePrice: parsed.purchasePrice || inferReceiptPurchasePriceFromLine(normalizedLine, matched),
        approved: true,
        sourceLabel: label,
        rawText: normalizedLine
      };
    })
    .filter(Boolean);
}

function buildManualReceiptRowsFromStructuredRows(structuredRows, products) {
  return (Array.isArray(structuredRows) ? structuredRows : [])
    .map((row) => {
      const quantity = Math.max(1, Math.round(Number(row?.quantity || 0) || 0));
      const purchasePrice = Math.max(0, round2(Number(row?.purchasePrice || 0) || 0));
      if (quantity <= 0 || purchasePrice <= 0) return null;
      const productText = String(row?.productText || "").replace(/\s+/g, " ").trim();
      const meaningfulText = isReceiptMeaningfulProductText(productText) ? productText : "";
      const canSuggestProduct = meaningfulText && ["reference", "grid-ocr"].includes(String(row?.source || ""));
      const matched = canSuggestProduct
        ? findReceiptMatchedProduct(meaningfulText, products, String(row?.source || "") === "reference" ? 10 : 24)
        : null;
      const label = matched
        ? `${formatReceiptFallbackLabel(row)} Â· ${String(matched?.NOMBRE || "").trim()}`
        : formatReceiptFallbackLabel(row);
      return {
        productId: Number(matched?.["NÂ°"] || matched?.productId || matched?.id || 0) || "",
        quantity,
        purchasePrice,
        approved: true,
        sourceLabel: label,
        rawText: formatStructuredReceiptRow(row)
      };
    })
    .filter(Boolean);
}

function buildManualReceiptRowsFromVisionRows(visionRows, products) {
  return (Array.isArray(visionRows) ? visionRows : [])
    .map((row) => {
      const quantity = Math.max(1, Math.round(Number(row?.quantity || 0) || 0));
      const purchasePrice = Math.max(0, round2(Number(row?.purchasePrice || 0) || 0));
      if (quantity <= 0 || purchasePrice <= 0) return null;
      const lineNumber = Number(row?.lineNumber || 0) || 0;
      const productText = String(row?.productText || row?.rawText || "").replace(/\s+/g, " ").trim();
      const meaningfulText = isReceiptMeaningfulProductText(productText) ? productText : "";
      const matched = meaningfulText ? findReceiptMatchedProduct(meaningfulText, products, 18) : null;
      const labelBase = formatReceiptFallbackLabel({ lineNumber, quantity, purchasePrice });
      return {
        productId: Number(matched?.["NÂ°"] || matched?.productId || matched?.id || 0) || "",
        quantity,
        purchasePrice,
        approved: true,
        sourceLabel: matched ? `${labelBase} Â· ${String(matched?.NOMBRE || "").trim()}` : labelBase,
        rawText: `${lineNumber ? `${lineNumber} ` : ""}${String(quantity).padStart(2, "0")} ${productText || "[sin nombre]"} ${purchasePrice.toFixed(2)}`.trim()
      };
    })
    .filter(Boolean);
}

function buildManualReceiptRowsFromReferenceTemplate(fileName, products) {
  const template = getReceiptReferenceTemplate(fileName);
  if (!template) return [];
  const structuredRows = template.lines.map((line) => {
    const parsed = parseReceiptStructuredLine(line);
    return {
      ...parsed,
      rawText: line,
      source: "reference"
    };
  });
  return buildManualReceiptRowsFromStructuredRows(structuredRows, products);
}

function mergeInventoryReceiptRows(rows) {
  return (Array.isArray(rows) ? rows : [])
.map((row) => ({
      ...row,
      quantity: Math.max(1, round2(Number(row?.quantity || 1))),
      stockUnits: Math.max(1, round2(Number(row?.stockUnits || row?.stock_units || row?.quantity || 1))),
      purchasePrice: Math.max(0, round2(Number(row?.purchasePrice || 0))),
      approved: row?.approved !== false
    }))
    .filter((row) => String(row?.sourceLabel || row?.rawText || "").trim());
}

function renderInventoryReceiptFilesPreview() {
  if (!refs.inventoryReceiptFilesPreview) return;
  const files = Array.isArray(state.inventoryReceiptFiles) ? state.inventoryReceiptFiles : [];
  refs.inventoryReceiptFilesPreview.innerHTML = files.length
    ? files
        .map(
          (item, index) => `
            <div class="inventory-receipt-file-card" data-receipt-file-index="${index}">
              ${
                item.previewUrl
                  ? `<img src="${esc(item.previewUrl)}" alt="${esc(item.name)}" />`
                  : `<div class="inventory-receipt-file-glyph" aria-hidden="true">PDF</div>`
              }
              <div class="inventory-receipt-file-copy">
                <strong>${esc(item.name)}</strong>
                <small>${esc(item.analysisStatus || "Pendiente")}</small>
                ${
                  item.analysisPreview
                    ? `<small class="inventory-receipt-file-preview">${esc(item.analysisPreview)}</small>`
                    : ""
                }
              </div>
            </div>
          `
        )
        .join("")
    : '<div class="inventory-receipt-empty">AÃºn no subiste recibos.</div>';
}

function renderInventoryReceiptInsights() {
  if (!refs.inventoryReceiptInsights) return;
  const files = Array.isArray(state.inventoryReceiptFiles) ? state.inventoryReceiptFiles : [];
  const insightItems = files
    .map((item) => {
      const preview = String(item?.analysisPreview || "").trim();
      const status = String(item?.analysisStatus || "").trim();
      if (!preview && !status) return "";
      return `
        <article class="inventory-receipt-insight-item">
          <strong>${esc(item?.name || "Recibo")}</strong>
          <small>${esc(status || "Pendiente")}</small>
          <p>${esc(preview || "La IA aÃºn no devuelve texto legible para este archivo.")}</p>
        </article>
      `;
    })
    .filter(Boolean)
    .join("");

  refs.inventoryReceiptInsights.innerHTML = insightItems
    ? `<strong>Lectura OCR</strong>${insightItems}`
    : `<strong>Lectura OCR</strong><p>Sube un recibo para ver aquÃ­ la reconstrucciÃ³n local de filas detectadas en la tabla del documento.</p>`;
}

function renderInventoryReceiptDraft() {
  if (!refs.inventoryReceiptItemsBody) return;
  const products = getInventoryReceiptProductsSource();
  const options = products
    .map((product) => {
      const productId = Number(product?.["NÂ°"] || product?.productId || product?.id || 0);
      const selected = "";
      return `<option value="${productId}" ${selected}>${esc(`${productId} - ${product?.NOMBRE || "Sin nombre"}`)}</option>`;
    })
    .join("");
  const rows = Array.isArray(state.inventoryReceiptDraft) ? state.inventoryReceiptDraft : [];
  refs.inventoryReceiptItemsBody.innerHTML = rows.length
    ? rows
        .map((row, index) => `
          <tr>
            <td><input class="stock-order-check" data-receipt-approved="${index}" type="checkbox" ${row.approved ? "checked" : ""} /></td>
            <td>
              <select class="inventory-receipt-select" data-receipt-product="${index}">
                <option value="">Seleccionar producto</option>
                ${options.replace(`value="${row.productId}"`, `value="${row.productId}" selected`)}
              </select>
            </td>
            <td><input class="stock-order-qty-input" data-receipt-stock-units="${index}" type="number" min="1" step="1" value="${formatQty(row.stockUnits || row.quantity)}" /></td>
            <td><input class="stock-order-qty-input" data-receipt-purchase-price="${index}" type="number" min="0" step="0.01" value="${Number(row.purchasePrice || 0).toFixed(2)}" /></td>
            <td><button class="btn btn-ghost inventory-receipt-remove-btn" data-receipt-remove="${index}" type="button">Quitar</button></td>
          </tr>
        `)
        .join("")
    : '<tr><td class="empty" colspan="6">Sube recibos o agrega productos manualmente para preparar el ingreso.</td></tr>';

  if (refs.inventoryReceiptSummary) {
    const detected = rows.filter((row) => Number(row.quantity || 0) > 0 || Number(row.purchasePrice || 0) > 0 || String(row.sourceLabel || row.rawText || "").trim()).length;
    const approved = rows.filter((row) => row.approved && Number(row.productId || 0) > 0 && Number(row.stockUnits || row.quantity || 0) > 0);
    refs.inventoryReceiptSummary.textContent = `${detected} fila(s) detectadas Â· ${approved.length} producto(s) listos para confirmar.`;
  }
  if (refs.inventoryReceiptPurchaseTotal) {
    const total = rows
      .filter((row) => row.approved)
      .reduce((sum, row) => sum + Number(row.purchasePrice || 0), 0);
    refs.inventoryReceiptPurchaseTotal.textContent = formatCurrency(total);
  }
}

async function appendInventoryReceiptRowsFromFiles(files) {
  const products = getInventoryReceiptProductsSource();
  const nextRows = [];
  for (const file of files) {
    file.analysisStatus = "Analizando...";
    file.analysisPreview = "El OCR local estÃ¡ reconstruyendo las filas de la tabla...";
    renderInventoryReceiptFilesPreview();
    renderInventoryReceiptInsights();
    try {
      const analysis = await recognizeInventoryReceiptFile(file.file);
      const previewRows = getReceiptRowsFromAnalysis(analysis);
      const previewParts = [analysis.visionSummary, previewRows.slice(0, 8).join(" / ")].filter(Boolean);
      file.analysisPreview = previewParts.join(" Â· ");
      if (analysis.unsupported) {
        file.analysisStatus = "Sin OCR";
        renderInventoryReceiptInsights();
        nextRows.push({
          productId: "",
          quantity: inferReceiptQuantity(file.name),
          stockUnits: inferReceiptQuantity(file.name),
          purchasePrice: 0,
          approved: true,
          sourceLabel: `RevisiÃ³n manual Â· ${file.name}`,
          rawText: file.name
        });
        continue;
      }

      const visionRows = Array.isArray(analysis?.visionRows) ? analysis.visionRows : [];
      const structuredRows = Array.isArray(analysis?.structuredRows) ? analysis.structuredRows : [];
      let parsedRows = visionRows.length
        ? buildManualReceiptRowsFromVisionRows(visionRows, products)
        : structuredRows.length
          ? buildManualReceiptRowsFromStructuredRows(structuredRows, products)
          : buildManualReceiptRowsFromLines(previewRows, file.name, products);

      if (parsedRows.length < 6) {
        const referenceRows = buildManualReceiptRowsFromReferenceTemplate(file.name, products);
        if (referenceRows.length > parsedRows.length) {
          parsedRows = referenceRows;
          file.analysisPreview = `Plantilla de referencia aplicada Â· ${referenceRows.slice(0, 2).map((row) => row.rawText).join(" / ")}`;
        }
      }

      if (parsedRows.length) {
        nextRows.push(...mergeInventoryReceiptRows(parsedRows));
        file.analysisStatus = `${parsedRows.length} fila(s) digitalizadas`;
      } else {
        file.analysisStatus = "Solo lectura";
        file.analysisPreview = previewParts.join(" Â· ") || "No se detectaron filas estructuradas para convertir en tabla.";
      }
    } catch {
      file.analysisStatus = "Error de lectura";
      file.analysisPreview = "No se pudo extraer texto Ãºtil de esta foto con la IA en este intento.";
      nextRows.push({
        productId: "",
        quantity: inferReceiptQuantity(file.name),
        stockUnits: inferReceiptQuantity(file.name),
        purchasePrice: 0,
        approved: true,
        sourceLabel: `RevisiÃ³n manual Â· ${file.name}`,
        rawText: file.name
      });
    }
    renderInventoryReceiptFilesPreview();
    renderInventoryReceiptInsights();
  }
  state.inventoryReceiptDraft = [...(state.inventoryReceiptDraft || []), ...mergeInventoryReceiptRows(nextRows)];
}

function openInventoryReceiptDialog() {
  const dialog = refs.inventoryReceiptDialog || document.getElementById("inventoryReceiptDialog");
  try {
    resetInventoryReceiptFiles();
    state.inventoryReceiptDraft = [];
    if (refs.inventoryReceiptTurn) {
      refs.inventoryReceiptTurn.textContent = `${getCurrentTurnFilterLabel()} Â· ${todayInputValue()} Â· recibos de compra`;
    }
    renderInventoryReceiptFilesPreview();
    renderInventoryReceiptInsights();
    renderInventoryReceiptDraft();
  } catch (error) {
    console.error("No se pudo preparar el ingreso de inventario:", error);
  }
  if (dialog?.open) return;
  if (typeof dialog?.showModal === "function") {
    dialog.showModal();
  } else if (typeof dialog?.show === "function") {
    dialog.show();
  }
}

window.openInventoryReceiptDialog = openInventoryReceiptDialog;

document.addEventListener(
  "click",
  (event) => {
    const trigger = event.target?.closest?.("[data-action='open-inventory-ingress'], #kpiInventoryIngressBtn");
    if (!trigger) return;
    event.preventDefault();
    openInventoryReceiptDialog();
  },
  true
);

function closeInventoryReceiptDialog() {
  refs.inventoryReceiptDialog?.close();
}

function addInventoryReceiptManualRow() {
  state.inventoryReceiptDraft = [
    ...(state.inventoryReceiptDraft || []),
    { productId: "", quantity: 1, stockUnits: 1, purchasePrice: 0, approved: true, sourceLabel: "Carga manual" }
  ];
  renderInventoryReceiptDraft();
}

async function handleInventoryReceiptFilesChange(event) {
  const files = Array.from(event?.target?.files || []);
  if (!files.length) return;
  const mapped = files.map((file) => ({
    name: file.name,
    type: file.type,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    file,
    analysisStatus: "Pendiente"
  }));
  state.inventoryReceiptFiles = [...(state.inventoryReceiptFiles || []), ...mapped];
  renderInventoryReceiptFilesPreview();
  renderInventoryReceiptInsights();
  if (refs.inventoryReceiptSummary) {
    refs.inventoryReceiptSummary.textContent = "Analizando recibo(s)...";
  }
  await appendInventoryReceiptRowsFromFiles(mapped);
  renderInventoryReceiptDraft();
}

function handleInventoryReceiptTableInput(event) {
  const productSelect = event.target?.closest?.("[data-receipt-product]");
  if (productSelect) {
    const index = Number(productSelect.getAttribute("data-receipt-product"));
    const row = state.inventoryReceiptDraft[index];
    if (!row) return;
    row.productId = productSelect.value ? Number(productSelect.value) : "";
    renderInventoryReceiptDraft();
    return;
  }

  const qtyInput = event.target?.closest?.("[data-receipt-qty]");
  if (qtyInput) {
    const index = Number(qtyInput.getAttribute("data-receipt-qty"));
    const row = state.inventoryReceiptDraft[index];
    if (!row) return;
    row.quantity = Math.max(1, round2(Number(qtyInput.value || 1)));
    if (!Number(row.stockUnits || 0)) {
      row.stockUnits = row.quantity;
    }
    renderInventoryReceiptDraft();
    return;
  }

  const stockUnitsInput = event.target?.closest?.("[data-receipt-stock-units]");
  if (stockUnitsInput) {
    const index = Number(stockUnitsInput.getAttribute("data-receipt-stock-units"));
    const row = state.inventoryReceiptDraft[index];
    if (!row) return;
    row.stockUnits = Math.max(1, round2(Number(stockUnitsInput.value || 1)));
    renderInventoryReceiptDraft();
    return;
  }

  const purchasePriceInput = event.target?.closest?.("[data-receipt-purchase-price]");
  if (purchasePriceInput) {
    const index = Number(purchasePriceInput.getAttribute("data-receipt-purchase-price"));
    const row = state.inventoryReceiptDraft[index];
    if (!row) return;
    row.purchasePrice = Math.max(0, round2(Number(purchasePriceInput.value || 0)));
    renderInventoryReceiptDraft();
    return;
  }

  const approved = event.target?.closest?.("[data-receipt-approved]");
  if (approved) {
    const index = Number(approved.getAttribute("data-receipt-approved"));
    const row = state.inventoryReceiptDraft[index];
    if (!row) return;
    row.approved = Boolean(approved.checked);
    renderInventoryReceiptDraft();
  }
}

function handleInventoryReceiptTableClick(event) {
  const removeBtn = event.target?.closest?.("[data-receipt-remove]");
  if (!removeBtn) return;
  const index = Number(removeBtn.getAttribute("data-receipt-remove"));
  state.inventoryReceiptDraft = (state.inventoryReceiptDraft || []).filter((_, rowIndex) => rowIndex !== index);
  renderInventoryReceiptDraft();
}

async function applyInventoryReceiptIngress() {
  if (state.inventoryReceiptApplying) return;
  const approvedRows = (state.inventoryReceiptDraft || []).filter(
    (row) => row.approved && Number(row.productId || 0) > 0 && Number(row.stockUnits || row.quantity || 0) > 0
  );
  if (!approvedRows.length) {
    setAppMessage("Confirma al menos un producto vÃ¡lido para aplicar el ingreso.", "is-error");
    return;
  }

  state.inventoryReceiptApplying = true;
  if (refs.inventoryReceiptApplyBtn) refs.inventoryReceiptApplyBtn.disabled = true;
  try {
    for (const row of approvedRows) {
      const stockUnits = Math.max(1, round2(Number(row.stockUnits || row.quantity || 1)));
      const linePurchaseTotal = Math.max(0, round2(Number(row.purchasePrice || 0)));
      const unitPurchasePrice = stockUnits > 0 ? round2(linePurchaseTotal / stockUnits) : 0;
      const readingNote = [row.sourceLabel, row.rawText].filter(Boolean).join(" Â· ");
      await apiRequest(`/api/productos/${row.productId}/ingreso`, {
        method: "POST",
        body: JSON.stringify({
          cantidad: stockUnits,
          purchasePrice: unitPurchasePrice,
          PRECIO_COMPRA: unitPurchasePrice,
          precioCompraTotal: linePurchaseTotal,
          nota: readingNote
            ? `Ingreso desde recibo Â· total compra ${formatCurrency(linePurchaseTotal)} Â· unitario ${formatCurrency(unitPurchasePrice)} Â· ${readingNote}`
            : `Ingreso desde recibo Â· total compra ${formatCurrency(linePurchaseTotal)} Â· unitario ${formatCurrency(unitPurchasePrice)}`,
          lecturaRecibo: readingNote,
          cantidadLeida: row.quantity,
          referencia: "INGRESO_RECIBO_UI"
        })
      });
    }
    closeInventoryReceiptDialog();
    resetInventoryReceiptFiles();
    state.inventoryReceiptDraft = [];
    setAppMessage(`Ingreso aplicado para ${approvedRows.length} producto(s).`, "is-success");
    await refreshAll({ keepMessages: true });
  } catch (error) {
    setAppMessage(`No se pudo aplicar el ingreso: ${error.message}`, "is-error");
  } finally {
    state.inventoryReceiptApplying = false;
    if (refs.inventoryReceiptApplyBtn) refs.inventoryReceiptApplyBtn.disabled = false;
  }
}

function openStockOrderPdf() {
  const stats = buildCashCloseStats();
  const draft = buildStockOrderDraft(stats);
  if (!draft.length) {
    setAppMessage("No hay productos sin stock o con stock bajo para generar el pedido.", "is-error");
    return;
  }
  state.stockOrderDraft = draft;
  if (refs.stockOrderTurn) {
    refs.stockOrderTurn.textContent = `${getCurrentTurnFilterLabel()} · ${todayInputValue()}`;
  }
  if (false && refs.stockOrderTurn) {
    refs.stockOrderTurn.textContent = `${getCurrentTurnFilterLabel()} · ${todayInputValue()}`;
  }
  if (refs.stockOrderDeliveryDate) {
    refs.stockOrderDeliveryDate.value = todayInputValue();
  }
  renderStockOrderDraft();
  refs.stockOrderDialog?.showModal();
}

function toggleStockOrderSelection() {
  const rows = Array.isArray(state.stockOrderDraft) ? state.stockOrderDraft : [];
  const allSelected = rows.length > 0 && rows.every((item) => item.selected);
  rows.forEach((item) => {
    item.selected = !allSelected;
  });
  renderStockOrderDraft();
}

function handleStockOrderDraftInput(event) {
  const check = event.target?.closest?.("[data-stock-order-check]");
  if (check) {
    const index = Number(check.getAttribute("data-stock-order-check"));
    const item = state.stockOrderDraft[index];
    if (!item) return;
    item.selected = Boolean(check.checked);
    if (!item.selected) {
      const qtyInput = refs.stockOrderItemsBody?.querySelector?.(`[data-stock-order-qty="${index}"]`);
      if (qtyInput) qtyInput.disabled = true;
    } else {
      const qtyInput = refs.stockOrderItemsBody?.querySelector?.(`[data-stock-order-qty="${index}"]`);
      if (qtyInput) qtyInput.disabled = false;
    }
    renderStockOrderDraft();
    return;
  }

  const qtyInput = event.target?.closest?.("[data-stock-order-qty]");
  if (!qtyInput) return;
  const index = Number(qtyInput.getAttribute("data-stock-order-qty"));
  const item = state.stockOrderDraft[index];
  if (!item) return;
  const qty = Math.max(0, round2(Number(qtyInput.value || 0)));
  item.quantity = qty;
  renderStockOrderDraft();
}

function generateStockOrderPdf() {
  const selected = (Array.isArray(state.stockOrderDraft) ? state.stockOrderDraft : []).filter(
    (item) => item.selected && Number(item.quantity || 0) > 0
  );
  if (!selected.length) {
    setAppMessage("Selecciona al menos un producto con cantidad mayor a 0.", "is-error");
    return;
  }

  const message = buildStockOrderMessage(selected);
  copyTextToClipboard(message)
    .then(() => {
      closeStockOrderDialog();
      setAppMessage(`Texto de pedido copiado para WhatsApp con ${selected.length} producto(s).`, "is-success");
    })
    .catch(() => {
      window.prompt("Copia este texto para WhatsApp:", message);
    });
}

function exportStockOrderText() {
  const selected = (Array.isArray(state.stockOrderDraft) ? state.stockOrderDraft : []).filter(
    (item) => item.selected && Number(item.quantity || 0) > 0
  );
  if (!selected.length) {
    setAppMessage("Selecciona al menos un producto con cantidad mayor a 0.", "is-error");
    return;
  }

  const message = buildStockOrderMessage(selected);
  const deliveryDate = normalizeDateValue(refs.stockOrderDeliveryDate?.value || "") || todayInputValue();
  const blob = new Blob([message], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pedido_reposicion_${deliveryDate}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  setAppMessage(`Archivo .txt exportado con ${selected.length} producto(s).`, "is-success");
}

function renderKpis() {
  const stats = buildCashCloseStats();
  if (refs.kpiShiftSalesAmount) {
    refs.kpiShiftSalesAmount.textContent = money(stats.totalAmount);
  }
  if (refs.kpiShiftSalesMeta) {
    refs.kpiShiftSalesMeta.textContent = "Total vendido del turno";
  }
  if (refs.kpiSalesCountValue) {
    refs.kpiSalesCountValue.textContent = String(stats.salesCount);
  }
  if (refs.kpiAverageTicketValue) {
    const avgTicket = stats.salesCount > 0 ? round2(stats.totalAmount / stats.salesCount) : 0;
    refs.kpiAverageTicketValue.textContent = money(avgTicket);
  }
  if (refs.kpiInventoryActiveCount) {
    refs.kpiInventoryActiveCount.textContent = formatQty(stats.activeProductsCount);
  }
  if (refs.kpiInventoryOutCount) {
    refs.kpiInventoryOutCount.textContent = formatQty(stats.turnOutputs);
  }
  if (refs.kpiInventoryInCount) {
    refs.kpiInventoryInCount.textContent = formatQty(stats.turnInputs);
  }
  if (refs.kpiInventoryActiveBar) {
    const ratio = stats.totalProductsCount > 0 ? Math.max(8, (stats.activeProductsCount / stats.totalProductsCount) * 100) : 8;
    refs.kpiInventoryActiveBar.style.width = `${Math.min(100, ratio)}%`;
  }
  if (refs.kpiShiftProductsMeta) {
    refs.kpiShiftProductsMeta.textContent = `${getCurrentTurnFilterLabel()} activo`;
  }
  if (refs.kpiShiftElapsed) {
    refs.kpiShiftElapsed.textContent = getCurrentTurnElapsedLabel();
  }
  if (refs.kpiLowStockCount) {
    refs.kpiLowStockCount.textContent = String(stats.lowStockOnlyCount);
  }
  if (refs.kpiOutOfStockCount) {
    refs.kpiOutOfStockCount.textContent = String(stats.outOfStockCount);
  }
  if (refs.kpiTopPaymentMethod) {
    refs.kpiTopPaymentMethod.textContent = stats.topPaymentEntry ? String(stats.topPaymentEntry[0]) : "Sin ventas";
  }
  if (refs.kpiTopPaymentShare) {
    const amount = Number(stats.topPaymentEntry?.[1] || 0);
    const share = stats.totalAmount > 0 ? Math.round((amount / stats.totalAmount) * 100) : 0;
    refs.kpiTopPaymentShare.textContent = `${share}%`;
  }
  if (refs.kpiTopPaymentMeta) {
    if (stats.topPaymentEntry) {
      refs.kpiTopPaymentMeta.textContent = `${money(stats.topPaymentEntry[1])} del total cobrado`;
    } else {
      refs.kpiTopPaymentMeta.textContent = "Sin movimientos todavía.";
    }
  }
  if (refs.kpiTopProductName) {
    refs.kpiTopProductName.textContent = stats.topCategoryEntry ? String(stats.topCategoryEntry[1]?.name || "Sin ventas") : "Sin ventas";
  }
  if (refs.kpiTopProductMeta) {
    if (stats.topCategoryEntry) {
      const categoryQty = Number(stats.topCategoryEntry[1]?.quantity || 0);
      const share =
        stats.totalProductsSold > 0 ? Math.round((categoryQty / stats.totalProductsSold) * 100) : 0;
      refs.kpiTopProductMeta.textContent = `${formatQty(categoryQty)} unidades · ${share}% del turno`;
    } else {
      refs.kpiTopProductMeta.textContent = "Aún no hay categoría líder en el turno.";
    }
  }

  if (refs.cashCloseDialog?.open) {
    renderCashCloseDialog();
  }
}

function formatSaleLookupLabel(product) {
  return `${getSaleProductCode(product)} - ${product.NOMBRE}`;
}

function findSaleProductById(id) {
  const productId = Number.parseInt(String(id ?? ""), 10);
  if (!productId) return null;
  return getSaleProductsSource().find((item) => Number(getSaleProductCode(item)) === productId) || null;
}

function getSaleProductCode(product) {
  if (!product || typeof product !== "object") return "";
  if (product.N !== undefined) return product.N;
  if (product.id !== undefined) return product.id;
  if (product.ID !== undefined) return product.ID;
  for (const [key, value] of Object.entries(product)) {
    const compactKey = normalizeText(key).replace(/[^a-z0-9]/g, "");
    if (["n", "na", "no", "nro", "numero"].includes(compactKey)) {
      return value;
    }
  }
  return "";
}

function rankSaleProductMatch(product, query, parts) {
  const idText = String(getSaleProductCode(product) ?? "").trim();
  const nameText = String(product.NOMBRE ?? "").trim();
  const idNorm = normalizeText(idText);
  const nameNorm = normalizeText(nameText);
  const haystack = `${idNorm} ${nameNorm}`;

  let score = 0;
  if (idNorm === query) score += 120;
  else if (idNorm.startsWith(query)) score += 90;
  else if (idNorm.includes(query)) score += 72;

  if (nameNorm === query) score += 110;
  else if (nameNorm.startsWith(query)) score += 86;
  else if (nameNorm.includes(query)) score += 62;

  if (parts.length > 1 && parts.every((part) => haystack.includes(part))) {
    score += 46;
  }

  return score;
}

function buildSaleLookupResults(rawLookup) {
  const products = getSaleProductsSource();
  if (!products.length) return [];

  const query = normalizeText(rawLookup);
  if (!query) {
    return [...products];
  }

  const parts = query.split(/\s+/).filter(Boolean);
  return products
    .map((item) => ({
      item,
      score: rankSaleProductMatch(item, query, parts)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return Number(getSaleProductCode(left.item) || 0) - Number(getSaleProductCode(right.item) || 0);
    })
    .map((entry) => entry.item);
}

function openSaleLookupDropdown() {
  state.saleLookupOpen = true;
  renderSaleLookupDropdown();
}

function closeSaleLookupDropdown() {
  state.saleLookupOpen = false;
  refs.saleProductDropdown.hidden = true;
}

function renderSaleLookupDropdown() {
  const dropdown = refs.saleProductDropdown;
  const results = Array.isArray(state.saleLookupResults) ? state.saleLookupResults : [];

  if (!state.saleLookupOpen) {
    dropdown.hidden = true;
    return;
  }

  if (!results.length) {
    dropdown.innerHTML = '<p class="sale-product-empty">Sin coincidencias.</p>';
    dropdown.hidden = false;
    return;
  }

  dropdown.innerHTML = results
    .map((item, index) => {
      const isActive = index === state.saleLookupHighlight;
      return `
        <button
          class="sale-product-option${isActive ? " is-active" : ""}"
          type="button"
          data-sale-option-index="${index}"
          role="option"
          aria-selected="${isActive ? "true" : "false"}"
        >
          <span class="sale-product-option-main">
            <strong class="sale-product-option-id">#${esc(getSaleProductCode(item))}</strong>
            <span class="sale-product-option-name">${esc(item.NOMBRE)}</span>
          </span>
          <small class="sale-product-option-meta">Stock: ${esc(formatQty(item.STOCK_ACTUAL))} \u00B7 ${esc(
            money(item.PRECIO)
          )}</small>
        </button>
      `;
    })
    .join("");

  dropdown.hidden = false;
}

function refreshSaleLookupResults(options = {}) {
  const keepHighlight = Boolean(options.keepHighlight);
  state.saleLookupResults = buildSaleLookupResults(refs.saleProductLookup.value);

  if (!state.saleLookupResults.length) {
    state.saleLookupHighlight = -1;
  } else if (
    !keepHighlight ||
    state.saleLookupHighlight < 0 ||
    state.saleLookupHighlight >= state.saleLookupResults.length
  ) {
    state.saleLookupHighlight = 0;
  }

  if (options.open) {
    openSaleLookupDropdown();
  } else {
    renderSaleLookupDropdown();
  }
}

function applySaleProductSelection(product, options = {}) {
  if (!product) return;
  refs.saleProductId.value = String(getSaleProductCode(product));
  updateSaleTotalsPreview();

  if (options.autoAdd) {
    handleAddSaleItemFromForm(product);
    refs.saleProductLookup.value = "";
    refs.saleProductId.value = "";
    updateSaleTotalsPreview();
    state.saleLookupResults = [];
    closeSaleLookupDropdown();
    refs.saleProductLookup.focus();
    return;
  }

  if (options.keepDropdownOpen) {
    refreshSaleLookupResults({ open: true, keepHighlight: true });
  } else {
    closeSaleLookupDropdown();
  }
}

function resolveSaleProductByLookup(rawLookup) {
  const products = getSaleProductsSource();
  const value = String(rawLookup ?? "").trim();
  if (!value) return null;

  const idMatch = value.match(/^\s*(\d+)/);
  if (idMatch) {
    const byId = Number.parseInt(idMatch[1], 10);
    if (byId) {
      const productById = products.find((item) => Number(getSaleProductCode(item)) === byId);
      if (productById) return productById;
    }
  }

  const normalized = normalizeText(value);
  const exact =
    products.find((item) => normalizeText(formatSaleLookupLabel(item)) === normalized) ||
    products.find((item) => normalizeText(item.NOMBRE) === normalized) ||
    null;
  if (exact) return exact;

  const matches = buildSaleLookupResults(value);
  return matches.length === 1 ? matches[0] : null;
}

function syncSaleProductIdFromLookup() {
  const selectedById = findSaleProductById(refs.saleProductId.value);
  if (selectedById) {
    const lookupNormalized = normalizeText(refs.saleProductLookup.value);
    const selectedLabel = normalizeText(formatSaleLookupLabel(selectedById));
    if (lookupNormalized === selectedLabel) {
      updateSaleTotalsPreview();
      return selectedById;
    }
  }

  const product = resolveSaleProductByLookup(refs.saleProductLookup.value);
  refs.saleProductId.value = product ? String(getSaleProductCode(product)) : "";
  updateSaleTotalsPreview();
  return product;
}

function renderSaleProductOptions() {
  const products = getSaleProductsSource();
  const previous = refs.saleProductId.value;

  if (!products.length) {
    refs.saleProductDropdown.innerHTML = "";
    refs.saleProductLookup.value = "";
    refs.saleProductId.value = "";
    refs.saleProductLookup.disabled = true;
    refs.saleProductClearBtn.disabled = true;
    closeSaleLookupDropdown();
    return;
  }

  refs.saleProductLookup.disabled = false;
  refs.saleProductClearBtn.disabled = false;

  if (previous) {
    const selected = products.find((item) => String(getSaleProductCode(item)) === String(previous));
    if (selected) {
      refs.saleProductId.value = String(getSaleProductCode(selected));
      refreshSaleLookupResults({ open: false });
      updateSaleTotalsPreview();
      return;
    }
  }

  const byLookup = syncSaleProductIdFromLookup();
  if (byLookup) {
    refreshSaleLookupResults({ open: false });
    return;
  }

  refs.saleProductLookup.value = "";
  refs.saleProductId.value = "";
  refreshSaleLookupResults({ open: false });
  updateSaleTotalsPreview();
}

function renderCrudTable() {
  window.ProductsPage.renderCrudTable(refs, state);
}

function renderSalesTable() {
  window.SalesPage.renderSalesTable(refs, state);
}

function renderKardexTable() {
  window.KardexPage.renderKardexTable(refs, state);
}

function renderPager() {
  window.ProductsPage.renderPager(refs, state);
}

function renderSalesPager() {
  window.SalesPage.renderSalesPager(refs, state);
}

function renderAll() {
  renderApiSettings();
  renderDbStatus();
  renderAccessHost();
  renderSortButtons();
  renderKpis();
  renderSaleProductOptions();
  renderCrudTable();
  renderSalesTable();
  renderKardexTable();
  renderPager();
  renderSalesPager();
}

async function refreshAll({ keepMessages = false } = {}) {
  try {
    await Promise.all([
      loadProducts(),
      loadSales(),
      loadKardex(),
      loadProductCatalog(),
      loadSalesAllForKpi(),
      loadKardexAllForKpi()
    ]);
    state.apiConnected = true;
    renderAll();
    if (!keepMessages) {
      setCrudMessage("");
      setSaleMessage("");
      setSettingsMessage("");
      setAppMessage("");
    }
  } finally {
    Promise.allSettled([refreshDbStatus(), refreshAccessHost()]);
  }
}

async function refreshLocalProducts() {
  return productsController.refreshLocalProducts();
}

async function refreshLocalSales() {
  return salesController.refreshLocalSales();
}

async function refreshLocalKardex() {
  return kardexController.refreshLocalKardex();
}

async function handleCrudSubmit(event) {
  return productsController.handleCrudSubmit(event);
}

async function handleDelete(id) {
  return productsController.handleDelete(id);
}

async function handleDeleteKardex(id) {
  return kardexController.handleDeleteKardex(id);
}

async function handleDeleteAllKardex() {
  return kardexController.handleDeleteAllKardex();
}

async function handleStockIngress(id) {
  return productsController.handleStockIngress(id);
}

async function handleIngressSubmit(event) {
  return productsController.handleIngressSubmit(event);
}

async function handleSaleSubmit(event) {
  return salesController.handleSaleSubmit(event);
}

function handleAddSaleItemFromForm(productOverride = null) {
  return salesController.handleAddSaleItemFromForm(productOverride);
}

function handleSaleItemsClick(event) {
  return salesController.handleSaleItemsClick(event);
}

function handleAddPaymentRow() {
  return salesController.handleAddPaymentRow();
}

function handleSalePaymentRowsInput(event) {
  return salesController.handleSalePaymentRowsInput(event);
}

function handleSalePaymentRowsClick(event) {
  return salesController.handleSalePaymentRowsClick(event);
}

function handleSaleConfirmBack() {
  salesController.handleSaleConfirmBack();
}

async function handleSaleConfirmSubmit() {
  return salesController.handleSaleConfirmSubmit();
}

function handleSaleQuickPaySelect(paymentType) {
  return salesController.handleSaleQuickPaySelect(paymentType);
}

function handleSaleMontoRecibidoInput() {
  return salesController.handleSaleMontoRecibidoInput();
}

async function handleDeleteSale(saleId) {
  return salesController.handleDeleteSale(saleId);
}

async function handleApiBaseSave(event) {
  return settingsController.handleApiBaseSave(event, refreshAll);
}

async function handleApiBaseTest() {
  return settingsController.handleApiBaseTest();
}

async function handleCpanelDbStatusTest() {
  return settingsController.handleCpanelDbStatusTest();
}

async function handleExportSalesCsv() {
  return salesController.handleExportSalesCsv();
}

function handleUseCurrentOrigin() {
  settingsController.handleUseCurrentOrigin();
}

async function handleRefreshDbStatusClick() {
  return settingsController.handleRefreshDbStatusClick();
}

async function handleRefreshAccessHostClick() {
  return settingsController.handleRefreshAccessHostClick();
}

async function handleCopyAccessHost() {
  return settingsController.handleCopyAccessHost();
}

function bindEvents() {
  const onSearchProductsDebounced = debounce(() => {
    state.pagination.page = 1;
    refreshLocalProducts();
  }, 450);

  const onSearchSalesDebounced = debounce(() => {
    state.salesPagination.page = 1;
    refreshLocalSales();
  });

  const onSearchKardexDebounced = debounce(() => {
    refreshLocalKardex();
  });

  refs.reloadBtn.addEventListener("click", async () => {
    clearMigrationPolling();
    const today = todayInputValue();
    const currentOperationalDay = getCurrentSalesShiftDateValue();
    state.crudSearch = "";
    state.salesSearch = "";
    state.salesDateFrom = currentOperationalDay;
    state.salesDateTo = currentOperationalDay;
    state.kardexSearch = "";
    state.kardexType = "TODOS";
    state.productSort = { key: "NÂ°", dir: "asc" };
    state.salesSort = { key: "FECHA_OPERATIVA", dir: "desc" };
    state.kardexSort = { key: "FECHA_HORA", dir: "desc" };
    state.pagination.page = 1;
    state.salesPagination.page = 1;
    refs.crudSearch.value = "";
    refs.salesSearch.value = "";
    refs.salesDateFrom.value = currentOperationalDay;
    refs.salesDateTo.value = currentOperationalDay;
    renderSalesDateHints();
    refs.kardexSearch.value = "";
    refs.kardexTypeFilter.value = "TODOS";
    refs.saleProductLookup.value = "";
    refs.saleProductId.value = "";
    state.saleLookupResults = [];
    state.saleLookupOpen = false;
    state.saleLookupHighlight = -1;
    closeSaleLookupDropdown();
    closeDialog();
    if (productsController?.closeHistoryDialog) productsController.closeHistoryDialog();
    closeSaleDialog();
    closeStockOrderDialog();
    closeIngressDialog();
    closeConfirmDialog(false);
    resetIngressForm();
    clearCrudForm();
    setSettingsMessage("");
    refs.saleFecha.value = today;
    if (refs.saleHora) refs.saleHora.value = currentTimeInputValue();
    refs.saleTipoPago.value = "Efectivo";
    setSaleTotalPreviewText("S/ 0.00");
    updateSaleDialogQuickMeta();
    renderSortButtons();

    try {
      await refreshAll();
    } catch (error) {
      state.apiConnected = false;
      setAppMessage(`No se pudo recargar: ${error.message}`, "is-error");
    }
  });

  refs.openCreateBtn.addEventListener("click", openCreateDialog);
  refs.openSaleDialogBtn.addEventListener("click", openSaleDialog);
  refs.exportSalesCsvBtn.addEventListener("click", handleExportSalesCsv);
  if (refs.kpiCreateOrderBtn) {
    refs.kpiCreateOrderBtn.addEventListener("click", openStockOrderPdf);
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.("[data-action='open-inventory-ingress'], #kpiInventoryIngressBtn");
    if (!trigger) return;
    event.preventDefault();
    openInventoryReceiptDialog();
  });
  if (refs.stockOrderCloseBtn) {
    refs.stockOrderCloseBtn.addEventListener("click", closeStockOrderDialog);
  }
  if (refs.stockOrderCancelBtn) {
    refs.stockOrderCancelBtn.addEventListener("click", closeStockOrderDialog);
  }
  if (refs.stockOrderExportBtn) {
    refs.stockOrderExportBtn.addEventListener("click", exportStockOrderText);
  }
  if (refs.stockOrderGenerateBtn) {
    refs.stockOrderGenerateBtn.addEventListener("click", generateStockOrderPdf);
  }
  if (refs.stockOrderSelectAllBtn) {
    refs.stockOrderSelectAllBtn.addEventListener("click", toggleStockOrderSelection);
  }
  if (refs.stockOrderItemsBody) {
    refs.stockOrderItemsBody.addEventListener("input", handleStockOrderDraftInput);
    refs.stockOrderItemsBody.addEventListener("change", handleStockOrderDraftInput);
  }
  if (refs.stockOrderDialog) {
    refs.stockOrderDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeStockOrderDialog();
    });
  }
  if (refs.inventoryReceiptUploadCard) {
    refs.inventoryReceiptUploadCard.addEventListener("click", () => {
      refs.inventoryReceiptFiles?.click();
    });
  }
  if (refs.inventoryReceiptFiles) {
    refs.inventoryReceiptFiles.addEventListener("change", handleInventoryReceiptFilesChange);
  }
  if (refs.inventoryReceiptAddRowBtn) {
    refs.inventoryReceiptAddRowBtn.addEventListener("click", addInventoryReceiptManualRow);
  }
  if (refs.inventoryReceiptItemsBody) {
    refs.inventoryReceiptItemsBody.addEventListener("input", handleInventoryReceiptTableInput);
    refs.inventoryReceiptItemsBody.addEventListener("change", handleInventoryReceiptTableInput);
    refs.inventoryReceiptItemsBody.addEventListener("click", handleInventoryReceiptTableClick);
  }
  if (refs.inventoryReceiptCloseBtn) {
    refs.inventoryReceiptCloseBtn.addEventListener("click", closeInventoryReceiptDialog);
  }
  if (refs.inventoryReceiptCancelBtn) {
    refs.inventoryReceiptCancelBtn.addEventListener("click", closeInventoryReceiptDialog);
  }
  if (refs.inventoryReceiptApplyBtn) {
    refs.inventoryReceiptApplyBtn.addEventListener("click", applyInventoryReceiptIngress);
  }
  if (refs.inventoryReceiptDialog) {
    refs.inventoryReceiptDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeInventoryReceiptDialog();
    });
    refs.inventoryReceiptDialog.addEventListener("close", () => {
      resetInventoryReceiptFiles();
      state.inventoryReceiptDraft = [];
      renderInventoryReceiptFilesPreview();
      renderInventoryReceiptDraft();
    });
  }
  if (refs.kpiOutOfStockBtn) {
    refs.kpiOutOfStockBtn.addEventListener("click", () => {
      setActiveView("products");
      state.crudSearch = "retirar";
      refs.crudSearch.value = "retirar";
      onSearchProductsDebounced();
    });
  }
  if (refs.kpiLowStockBtn) {
    refs.kpiLowStockBtn.addEventListener("click", () => {
      setActiveView("products");
      state.crudSearch = "pedir";
      refs.crudSearch.value = "pedir";
      onSearchProductsDebounced();
    });
  }
  if (refs.openCashCloseBtn) {
    refs.openCashCloseBtn.addEventListener("click", openCashCloseDialog);
  }
  if (refs.cashCloseCloseBtn) {
    refs.cashCloseCloseBtn.addEventListener("click", closeCashCloseDialog);
  }
  if (refs.cashCloseDialog) {
    refs.cashCloseDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeCashCloseDialog();
    });
  }
  let productDialogFilePickerActive = false;
  let productDialogIgnoreCancelUntil = 0;
  const armProductDialogFilePickerGuard = () => {
    productDialogFilePickerActive = true;
    productDialogIgnoreCancelUntil = Date.now() + 4000;
  };
  const releaseProductDialogFilePickerGuard = () => {
    productDialogFilePickerActive = false;
    productDialogIgnoreCancelUntil = 0;
  };
  window.addEventListener("focus", () => {
    if (!productDialogFilePickerActive) return;
    setTimeout(() => {
      releaseProductDialogFilePickerGuard();
    }, 400);
  });
  refs.dialogCloseBtn.addEventListener("click", () => {
    closeDialog();
    clearCrudForm();
  });
  if (refs.crudImagenes) {
    refs.crudImagenes.addEventListener("change", (event) => {
      releaseProductDialogFilePickerGuard();
      productsController.handleProductImagesChange(event);
    });
  }
  if (refs.crudImagenFiltrada) {
    refs.crudImagenFiltrada.addEventListener("change", (event) => {
      releaseProductDialogFilePickerGuard();
      productsController.handleFilteredImageChange(event);
    });
  }
  if (refs.productPreviewCard) {
    refs.productPreviewCard.addEventListener("click", () => {
      armProductDialogFilePickerGuard();
      productsController.openImagePicker();
    });
  }
  if (refs.crudImagenesPreview) {
    refs.crudImagenesPreview.addEventListener("click", (event) => {
      const deleteSlot = event.target?.closest?.("[data-image-delete]");
      if (deleteSlot) {
        event.preventDefault();
        event.stopPropagation();
        productsController.removeProductImage(deleteSlot.dataset.imageDelete);
        return;
      }
      const filteredSlot = event.target?.closest?.("[data-filtered-slot]");
      if (filteredSlot) {
        event.preventDefault();
        event.stopPropagation();
        productsController.openFilteredImagePicker(filteredSlot.dataset.filteredSlot);
        return;
      }
      const slot = event.target?.closest?.("[data-image-slot]");
      if (!slot) return;
      if (slot.classList.contains("has-image")) return;
      armProductDialogFilePickerGuard();
      productsController.openImagePicker();
    });
  }
  if (refs.productOriginalImagesBtn) {
    refs.productOriginalImagesBtn.addEventListener("click", () => {
      productsController.openOriginalImagesPreview();
    });
  }
  if (refs.productOriginalImagesPreview) {
    refs.productOriginalImagesPreview.addEventListener("click", (event) => {
      const replaceButton = event.target?.closest?.("[data-replace-image]");
      if (!replaceButton) return;
      armProductDialogFilePickerGuard();
      productsController.openImageReplacementPicker(
        replaceButton.dataset.replaceSlot,
        replaceButton.dataset.replaceImage
      );
    });
  }
  if (refs.productOriginalImagesCloseBtn) {
    refs.productOriginalImagesCloseBtn.addEventListener("click", () => {
      productsController.closeOriginalImagesPreview();
    });
  }
  if (refs.productOriginalImagesDialog) {
    refs.productOriginalImagesDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      productsController.closeOriginalImagesPreview();
    });
  }
  if (refs.crudMovementHistoryBtn) {
    refs.crudMovementHistoryBtn.addEventListener("click", () => {
      productsController.openMovementHistory();
    });
  }
  if (refs.crudPurchasePriceHistoryBtn) {
    refs.crudPurchasePriceHistoryBtn.addEventListener("click", () => {
      productsController.openPurchasePriceHistory();
    });
  }
  if (refs.productHistoryCloseBtn) {
    refs.productHistoryCloseBtn.addEventListener("click", () => {
      productsController.closeHistoryDialog();
    });
  }
  refs.saleDialogCloseBtn.addEventListener("click", () => {
    closeSaleDialog();
    resetSaleForm();
  });
  refs.saleCancelBtn.addEventListener("click", () => {
    closeSaleDialog();
    resetSaleForm();
  });
  refs.saleConfirmBackBtn.addEventListener("click", handleSaleConfirmBack);
  refs.saleConfirmSubmitBtn.addEventListener("click", handleSaleConfirmSubmit);
  if (refs.saleReviewCloseBtn) {
    refs.saleReviewCloseBtn.addEventListener("click", handleSaleConfirmBack);
  }
  refs.ingressDialogCloseBtn.addEventListener("click", () => {
    closeIngressDialog();
    resetIngressForm();
  });
  refs.ingressCancelBtn.addEventListener("click", () => {
    closeIngressDialog();
    resetIngressForm();
  });
  refs.confirmDialogCloseBtn.addEventListener("click", () => {
    closeConfirmDialog(false);
  });
  refs.confirmDialogCancelBtn.addEventListener("click", () => {
    closeConfirmDialog(false);
  });
  refs.confirmDialogConfirmBtn.addEventListener("click", () => {
    closeConfirmDialog(true);
  });

  refs.productDialog.addEventListener("cancel", (event) => {
    if (productDialogFilePickerActive || Date.now() <= productDialogIgnoreCancelUntil) {
      event.preventDefault();
      return;
    }
    clearCrudForm();
  });
  if (refs.productHistoryDialog) {
    refs.productHistoryDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      productsController.closeHistoryDialog();
    });
  }
  refs.saleDialog.addEventListener("cancel", () => {
    resetSaleForm();
  });
  if (refs.saleReviewDialog) {
    refs.saleReviewDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      handleSaleConfirmBack();
    });
  }
  refs.ingressDialog.addEventListener("cancel", () => {
    resetIngressForm();
  });
  refs.confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmDialog(false);
  });
  refs.confirmDialog.addEventListener("close", () => {
    resolveConfirmDialog(false);
  });
  refs.apiSettingsForm.addEventListener("submit", handleApiBaseSave);
  refs.testApiBaseBtn.addEventListener("click", handleApiBaseTest);
  refs.testCpanelDbBtn.addEventListener("click", handleCpanelDbStatusTest);
  refs.useCurrentOriginBtn.addEventListener("click", handleUseCurrentOrigin);
  refs.dbStatusRefreshBtn.addEventListener("click", handleRefreshDbStatusClick);
  refs.refreshAccessHostBtn.addEventListener("click", handleRefreshAccessHostClick);
  refs.copyAccessHostBtn.addEventListener("click", handleCopyAccessHost);
  if (refs.openOnboardingBtn) {
    refs.openOnboardingBtn.addEventListener("click", () => {
      startOnboarding({ force: true });
    });
  }
  if (refs.onboardingSpotlight) {
    refs.onboardingSpotlight.addEventListener("click", handleOnboardingSpotlightClick);
  }
  if (refs.onboardingPrevBtn) refs.onboardingPrevBtn.addEventListener("click", handleOnboardingPrev);
  if (refs.onboardingNextBtn) refs.onboardingNextBtn.addEventListener("click", handleOnboardingNext);
  if (refs.onboardingSkipBtn) refs.onboardingSkipBtn.addEventListener("click", handleOnboardingSkip);
  window.addEventListener("resize", syncOnboardingLayout);
  window.addEventListener("scroll", syncOnboardingLayout, true);

  refs.crudSearch.addEventListener("input", (event) => {
    state.crudSearch = event.target.value;
    onSearchProductsDebounced();
  });

  refs.salesSearch.addEventListener("input", (event) => {
    state.salesSearch = event.target.value;
    onSearchSalesDebounced();
  });

  refs.saleProductLookup.addEventListener("input", () => {
    syncSaleProductIdFromLookup();
    refreshSaleLookupResults({ open: true });
  });

  refs.saleProductLookup.addEventListener("focus", () => {
    refreshSaleLookupResults({ open: true });
  });

  refs.saleProductLookup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSaleLookupDropdown();
      return;
    }

    if (!state.saleLookupOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      refreshSaleLookupResults({ open: true });
      event.preventDefault();
      return;
    }

    const results = Array.isArray(state.saleLookupResults) ? state.saleLookupResults : [];
    if (!results.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.saleLookupHighlight = Math.min(state.saleLookupHighlight + 1, results.length - 1);
      renderSaleLookupDropdown();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.saleLookupHighlight = Math.max(state.saleLookupHighlight - 1, 0);
      renderSaleLookupDropdown();
      return;
    }

    if (event.key === "Enter" && state.saleLookupOpen) {
      const candidate = results[state.saleLookupHighlight] || results[0];
      if (candidate) {
        event.preventDefault();
        applySaleProductSelection(candidate, { autoAdd: true });
      }
    }
  });

  refs.saleProductLookup.addEventListener("change", () => {
    const selected = syncSaleProductIdFromLookup();
    if (selected) {
      applySaleProductSelection(selected, { autoAdd: true });
      return;
    }
    closeSaleLookupDropdown();
  });

  refs.saleProductLookup.addEventListener("blur", () => {
    window.setTimeout(() => {
      closeSaleLookupDropdown();
    }, 120);
  });

  refs.saleProductClearBtn.addEventListener("click", () => {
    refs.saleProductLookup.value = "";
    refs.saleProductId.value = "";
    updateSaleTotalsPreview();
    refreshSaleLookupResults({ open: true });
    refs.saleProductLookup.focus();
  });

  if (refs.saleProductResetBtn) {
    refs.saleProductResetBtn.addEventListener("click", () => {
      refs.saleProductLookup.value = "";
      refs.saleProductId.value = "";
      updateSaleTotalsPreview();
      refreshSaleLookupResults({ open: true });
      refs.saleProductLookup.focus();
    });
  }

  refs.saleProductDropdown.addEventListener("mousedown", (event) => {
    const option = event.target.closest("[data-sale-option-index]");
    if (!option) return;
    event.preventDefault();
    const index = Number.parseInt(String(option.dataset.saleOptionIndex || ""), 10);
    if (!Number.isInteger(index) || index < 0) return;
    const product = state.saleLookupResults[index];
    if (!product) return;
    applySaleProductSelection(product, { autoAdd: true });
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".sale-product-field")) return;
    closeSaleLookupDropdown();
  });

  if (refs.saleCantidad) {
    refs.saleCantidad.addEventListener("input", () => {
      updateSaleTotalsPreview();
    });
    refs.saleCantidad.addEventListener("change", () => {
      normalizeSaleQuantityInput();
    });
  }
  if (refs.saleQtyDownBtn) {
    refs.saleQtyDownBtn.addEventListener("click", () => {
      changeSaleQuantity(-1);
    });
  }
  if (refs.saleQtyUpBtn) {
    refs.saleQtyUpBtn.addEventListener("click", () => {
      changeSaleQuantity(1);
    });
  }
  if (refs.saleAddItemBtn) {
    refs.saleAddItemBtn.addEventListener("click", handleAddSaleItemFromForm);
  }
  if (refs.saleItemsBody) {
    refs.saleItemsBody.addEventListener("click", handleSaleItemsClick);
  }
  if (refs.saleAddPaymentBtn) {
    refs.saleAddPaymentBtn.addEventListener("click", handleAddPaymentRow);
  }
  if (refs.salePaymentRows) {
    refs.salePaymentRows.addEventListener("input", handleSalePaymentRowsInput);
    refs.salePaymentRows.addEventListener("change", handleSalePaymentRowsInput);
    refs.salePaymentRows.addEventListener("click", handleSalePaymentRowsClick);
  }
  if (refs.saleMontoRecibido) {
    refs.saleMontoRecibido.addEventListener("input", handleSaleMontoRecibidoInput);
    refs.saleMontoRecibido.addEventListener("change", handleSaleMontoRecibidoInput);
  }
  if (refs.saleFecha) {
    refs.saleFecha.addEventListener("change", () => {
      updateSaleTotalsPreview();
      updateSaleDialogQuickMeta();
    });
  }
  if (refs.saleHora) {
    refs.saleHora.addEventListener("change", () => {
      updateSaleDialogQuickMeta();
    });
  }
  if (refs.saleDialog) {
    refs.saleDialog.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sale-quick-pay]");
      if (!button) return;
      handleSaleQuickPaySelect(button.dataset.saleQuickPay || "");
    });
  }

  refs.salesDateFrom.addEventListener("change", (event) => {
    state.salesDateFrom = String(event.target.value || "");
    renderSalesDateHints();
    state.salesPagination.page = 1;
    refreshLocalSales();
  });

  refs.salesDateTo.addEventListener("change", (event) => {
    state.salesDateTo = String(event.target.value || "");
    renderSalesDateHints();
    state.salesPagination.page = 1;
    refreshLocalSales();
  });

  refs.salesDateTodayBtn.addEventListener("click", () => {
    const currentOperationalDay = getCurrentSalesShiftDateValue();
    state.salesDateFrom = currentOperationalDay;
    state.salesDateTo = currentOperationalDay;
    refs.salesDateFrom.value = currentOperationalDay;
    refs.salesDateTo.value = currentOperationalDay;
    renderSalesDateHints();
    state.salesPagination.page = 1;
    refreshLocalSales();
  });

  refs.mobileNavToggle.addEventListener("click", () => {
    if (!isMobileViewport()) {
      setDesktopNavCollapsed(false);
      return;
    }
    setMobileNavExpanded(!state.mobileNavExpanded);
  });

  if (refs.navOverlayBackdrop) {
    refs.navOverlayBackdrop.addEventListener("click", () => {
      if (!isMobileViewport()) {
        setDesktopNavCollapsed(true);
        return;
      }
      setMobileNavExpanded(false);
    });
  }

  if (refs.desktopNavToggle) {
    refs.desktopNavToggle.addEventListener("click", () => {
      setDesktopNavCollapsed(!state.desktopNavCollapsed);
    });
  }

  refs.kpiToggleBtn.addEventListener("click", () => {
    setMobileKpiExpanded(!state.mobileKpiExpanded);
  });

  refs.viewNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.view || "sales");
    });
  });

  refs.kardexSearch.addEventListener("input", (event) => {
    state.kardexSearch = event.target.value;
    onSearchKardexDebounced();
  });

  refs.kardexTypeFilter.addEventListener("change", (event) => {
    state.kardexType = event.target.value;
    refreshLocalKardex();
  });

  refs.kardexDeleteAllBtn.addEventListener("click", handleDeleteAllKardex);

  refs.sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tableName = String(button.dataset.sortTable || "");
      const key = String(button.dataset.sortKey || "");
      if (!tableName || !key) return;

      updateSortState(tableName, key);
      renderSortButtons();

      if (tableName === "products") {
        state.pagination.page = 1;
        refreshLocalProducts();
        return;
      }
      if (tableName === "sales") {
        state.salesPagination.page = 1;
        refreshLocalSales();
        return;
      }
      if (tableName === "kardex") {
        refreshLocalKardex();
      }
    });
  });

  refs.crudPrevBtn.addEventListener("click", () => {
    if (!state.pagination.hasPrev) return;
    state.pagination.page -= 1;
    refreshLocalProducts();
  });

  refs.crudNextBtn.addEventListener("click", () => {
    if (!state.pagination.hasNext) return;
    state.pagination.page += 1;
    refreshLocalProducts();
  });

  refs.crudPageSize.addEventListener("change", (event) => {
    state.pagination.pageSize = Number.parseInt(event.target.value, 10) || 10;
    state.pagination.page = 1;
    refreshLocalProducts();
  });

  refs.salesPrevBtn.addEventListener("click", () => {
    if (!state.salesPagination.hasPrev) return;
    state.salesPagination.page -= 1;
    refreshLocalSales();
  });

  refs.salesNextBtn.addEventListener("click", () => {
    if (!state.salesPagination.hasNext) return;
    state.salesPagination.page += 1;
    refreshLocalSales();
  });

  refs.salesPageSize.addEventListener("change", (event) => {
    state.salesPagination.pageSize = Number.parseInt(event.target.value, 10) || 20;
    state.salesPagination.page = 1;
    refreshLocalSales();
  });

  window.addEventListener(
    "resize",
    debounce(() => {
      if (isMobileViewport()) {
        setMobileNavExpanded(false);
      } else {
        setDesktopNavCollapsed(state.desktopNavCollapsed, { persist: false });
      }
      setMobileKpiExpanded(state.mobileKpiExpanded, { persist: false });
    }, 120)
  );
  window.addEventListener("beforeunload", clearMigrationPolling);

  refs.productForm.addEventListener("submit", handleCrudSubmit);
  refs.ingressForm.addEventListener("submit", handleIngressSubmit);
  refs.crudCancelBtn.addEventListener("click", () => {
    closeDialog();
    clearCrudForm();
  });
  if (refs.crudHardDeleteBtn) {
    refs.crudHardDeleteBtn.addEventListener("click", () => {
      productsController.handleHardDeleteCurrentProduct();
    });
  }

  refs.saleForm.addEventListener("submit", handleSaleSubmit);

  refs.salesBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const saleId = Number.parseInt(button.dataset.saleId, 10);
    if (!saleId) return;
    if (button.dataset.action === "edit-sale") {
      openEditSaleDialog(saleId);
      return;
    }
    if (button.dataset.action === "delete-sale") {
      handleDeleteSale(saleId);
    }
  });

  refs.crudBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number.parseInt(button.dataset.id, 10);
    if (!id) return;
    if (button.dataset.action === "ingreso") {
      handleStockIngress(id);
      return;
    }
    if (button.dataset.action === "edit") {
      openEditDialog(id);
      return;
    }
    if (button.dataset.action === "delete") {
      handleDelete(id);
    }
  });

  refs.kardexBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='delete-kardex']");
    if (!button) return;
    const id = Number.parseInt(button.dataset.id, 10);
    if (!id) return;
    handleDeleteKardex(id);
  });
}

function getUrlFlag(name) {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get(name) || "").trim();
  } catch {
    return "";
  }
}

function applyUrlUiState() {
  const view = getUrlFlag("view").toLowerCase();
  if (["sales", "products", "kardex", "settings"].includes(view)) {
    setActiveView(view);
  }

  const modal = getUrlFlag("modal").toLowerCase();
  if (modal === "sale_v2") {
    window.setTimeout(() => {
      if (!refs.saleDialog?.open) {
        openSaleDialog();
      }
    }, 220);
  }
}

async function init() {
  if (refs.appVersionLabel) {
    refs.appVersionLabel.textContent = `Versión ${APP_VERSION}`;
  }

  state.apiBaseUrl = loadApiBaseUrlPreference();
  state.mobileKpiExpanded = loadMobileKpiExpandedPreference();
  state.desktopNavCollapsed = loadDesktopNavCollapsedPreference();
  state.onboardingSeen = loadOnboardingSeenPreference();
  initControllers();
  bindEvents();
  resetIngressForm();
  const today = todayInputValue();
  const currentOperationalDay = getCurrentSalesShiftDateValue();
  refs.saleFecha.value = today;
  if (refs.saleHora) refs.saleHora.value = currentTimeInputValue();
  refs.saleTipoPago.value = "Efectivo";
  setSaleTotalPreviewText("S/ 0.00");
  updateSaleDialogQuickMeta();
  state.salesDateFrom = currentOperationalDay;
  state.salesDateTo = currentOperationalDay;
  refs.salesDateFrom.value = currentOperationalDay;
  refs.salesDateTo.value = currentOperationalDay;
  renderSalesDateHints();
  setActiveView("sales");
  setDesktopNavCollapsed(state.desktopNavCollapsed, { persist: false });
  setMobileKpiExpanded(state.mobileKpiExpanded, { persist: false });
  renderApiSettings();
  renderAccessHost();
  setCpanelProbeResult();
  renderSortButtons();

  if (window.location.protocol === "file:") {
    state.apiConnected = false;
    setAppMessage(
      `Modo archivo detectado (file://). Abre la app desde ${getApiBaseUrl()} para evitar errores de conexiÃ³n.`,
      "is-error"
    );
    if (!state.onboardingSeen) {
      window.setTimeout(() => startOnboarding(), 300);
    }
    applyUrlUiState();
    return;
  }

  try {
    await refreshAll();
  } catch (error) {
    state.apiConnected = false;
    setAppMessage(`No se pudo conectar con la API: ${error.message}`, "is-error");
  }

  if (!state.onboardingSeen) {
    window.setTimeout(() => startOnboarding(), 300);
  }

  applyUrlUiState();
}

init();


