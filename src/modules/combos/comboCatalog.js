import comboChillImage from "../../assets/storefront/combos/frame-48.png";
import comboFullImage from "../../assets/storefront/combos/frame-49.png";
import comboPlayaImage from "../../assets/storefront/combos/frame-47.png";
import comboPreImage from "../../assets/storefront/combos/frame-46.png";

const COMBO_STORAGE_KEY = "licoreria.combo_catalog";

const DEFAULT_COMBO_IMAGES = {
  "combo-pre": comboPreImage,
  "combo-playa": comboPlayaImage,
  "combo-chill": comboChillImage,
  "combo-full": comboFullImage,
  "combo-brava": comboPreImage,
  "combo-premium": comboFullImage,
  "combo-after": comboPlayaImage,
  "combo-gin-tonic": comboChillImage
};

const LEGACY_COMBO_IMAGE_HINTS = {
  "combo-pre": ["combo-pre", "frame-46"],
  "combo-playa": ["combo-playa", "frame-47"],
  "combo-chill": ["combo-chill", "frame-48"],
  "combo-full": ["combo-full", "frame-49"],
  "combo-brava": ["combo-brava", "frame-46"],
  "combo-premium": ["combo-premium", "frame-49"],
  "combo-after": ["combo-after", "frame-47"],
  "combo-gin-tonic": ["combo-gin-tonic", "frame-48"]
};

export const COMBO_THEMES = [
  { value: "gold", label: "Dorado" },
  { value: "cyan", label: "Turquesa" },
  { value: "coral", label: "Coral" },
  { value: "green", label: "Verde" },
  { value: "pink", label: "Rosado" }
];

export const DEFAULT_COMBOS = [
  {
    id: "combo-pre",
    badge: "Mas pedido",
    title: "Combo Pre",
    summary: "12 chelas + hielo + snacks",
    price: 69,
    theme: "gold",
    imageUrl: comboPreImage,
    items: []
  },
  {
    id: "combo-playa",
    badge: "Para 6 personas",
    title: "Combo Playa",
    summary: "18 chelas + ron + hielo + snacks",
    price: 129,
    theme: "cyan",
    imageUrl: comboPlayaImage,
    items: []
  },
  {
    id: "combo-chill",
    badge: "Tarde tranqui",
    title: "Combo Chill",
    summary: "Gin + mixers + snacks",
    price: 89,
    theme: "coral",
    imageUrl: comboChillImage,
    items: []
  },
  {
    id: "combo-full",
    badge: "Fiesta improvisada",
    title: "Combo Full",
    summary: "Ron + vodka + whisky + energizantes + hielo",
    price: 159,
    theme: "green",
    imageUrl: comboFullImage,
    items: []
  },
  {
    id: "combo-brava",
    badge: "Para arrancar",
    title: "Combo Brava",
    summary: "18 chelas + hielo + piqueos",
    price: 99,
    theme: "gold",
    imageUrl: comboPreImage,
    items: []
  },
  {
    id: "combo-premium",
    badge: "Premium",
    title: "Combo Top",
    summary: "Whisky + vodka + energizantes",
    price: 189,
    theme: "pink",
    imageUrl: comboFullImage,
    items: []
  },
  {
    id: "combo-after",
    badge: "After office",
    title: "Combo After",
    summary: "Ron + chelas + snacks + hielo",
    price: 119,
    theme: "cyan",
    imageUrl: comboPlayaImage,
    items: []
  },
  {
    id: "combo-gin-tonic",
    badge: "Gin night",
    title: "Combo Gin",
    summary: "Gin + mixers + botanas",
    price: 109,
    theme: "coral",
    imageUrl: comboChillImage,
    items: []
  }
];

function normalizeComboItem(item, index = 0) {
  return {
    productId: String(item?.productId ?? item?.id ?? `item-${index}`),
    quantity: Math.max(1, Number(item?.quantity ?? 1))
  };
}

export function normalizeCombo(combo, index = 0) {
  const id = String(combo?.id ?? `combo-${index}`);
  const imageUrl = String(combo?.imageUrl || "");
  const legacyHints = LEGACY_COMBO_IMAGE_HINTS[id] || [];
  const shouldRestoreDefaultImage =
    !imageUrl ||
    legacyHints.some((hint) => imageUrl.toLowerCase().includes(hint)) ||
    imageUrl.toLowerCase().includes("/assets/combo-") ||
    imageUrl.toLowerCase().endsWith(".svg");
  return {
    id,
    badge: String(combo?.badge ?? ""),
    title: String(combo?.title ?? "Combo"),
    summary: String(combo?.summary ?? ""),
    price: Number(combo?.price ?? 0),
    theme: String(combo?.theme ?? "gold"),
    imageUrl: shouldRestoreDefaultImage ? String(DEFAULT_COMBO_IMAGES[id] || imageUrl) : imageUrl,
    items: Array.isArray(combo?.items) ? combo.items.map(normalizeComboItem) : []
  };
}

export function loadComboCatalog() {
  if (typeof window === "undefined") {
    return DEFAULT_COMBOS.map(normalizeCombo);
  }
  try {
    const stored = window.localStorage.getItem(COMBO_STORAGE_KEY);
    if (!stored) return DEFAULT_COMBOS.map(normalizeCombo);
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_COMBOS.map(normalizeCombo);
    const normalized = parsed.map(normalizeCombo);
    const existingIds = new Set(normalized.map((combo) => combo.id));
    const missingDefaults = DEFAULT_COMBOS.filter((combo) => !existingIds.has(combo.id)).map(normalizeCombo);
    return [...normalized, ...missingDefaults];
  } catch {
    return DEFAULT_COMBOS.map(normalizeCombo);
  }
}

export function saveComboCatalog(combos) {
  const normalized = Array.isArray(combos) ? combos.map(normalizeCombo) : [];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // noop
    }
  }
  return normalized;
}

export function getComboStorageKey() {
  return COMBO_STORAGE_KEY;
}
