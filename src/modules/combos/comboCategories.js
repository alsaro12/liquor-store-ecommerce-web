import bgBrindis from "../../assets/storefront/combo-backgrounds/backgroundbrindisycelebracion.jpg";
import bgChill from "../../assets/storefront/combo-backgrounds/backgroundchillyrelax.jpg";
import bgExpress from "../../assets/storefront/combo-backgrounds/backgroundexpress.jpg";
import bgFrutal from "../../assets/storefront/combo-backgrounds/backgroundfrutalyrefrescante.jpg";
import bgNoche from "../../assets/storefront/combo-backgrounds/backgroundnochedesalida.jpg";
import bgParrilla from "../../assets/storefront/combo-backgrounds/backgroundparrillayamigos.jpg";
import bgPlaya from "../../assets/storefront/combo-backgrounds/backgroundplayayverano.jpg";
import bgPremium from "../../assets/storefront/combo-backgrounds/backgroundpremium.jpg";
import bgPrevia from "../../assets/storefront/combo-backgrounds/backgroundprevia.jpg";
import bgReunion from "../../assets/storefront/combo-backgrounds/backgroundreunionencasa.jpg";

export const COMBO_CATEGORY_OPTIONS = [
  {
    value: "previa",
    label: "Previa",
    background: bgPrevia,
    cardTheme: "gold",
    accent: "#ffb347",
    shadow: "rgba(255, 145, 61, 0.35)",
    liquidStart: "#ffce7a",
    liquidEnd: "#ff8c3b",
    coverText: "Listo para arrancar la noche"
  },
  {
    value: "reunion-en-casa",
    label: "Reunión en Casa",
    background: bgReunion,
    cardTheme: "gold",
    accent: "#f0b266",
    shadow: "rgba(157, 98, 48, 0.28)",
    liquidStart: "#f3d17e",
    liquidEnd: "#b46b30",
    coverText: "Perfecto para compartir en casa"
  },
  {
    value: "noche-de-salida",
    label: "Noche de Salida",
    background: bgNoche,
    cardTheme: "pink",
    accent: "#ff4dc6",
    shadow: "rgba(47, 10, 76, 0.38)",
    liquidStart: "#7f68ff",
    liquidEnd: "#ff4dc6",
    coverText: "Hecho para prender la salida"
  },
  {
    value: "playa-y-verano",
    label: "Playa y Verano",
    background: bgPlaya,
    cardTheme: "cyan",
    accent: "#3ecfff",
    shadow: "rgba(22, 121, 171, 0.3)",
    liquidStart: "#8ff7ff",
    liquidEnd: "#34bfff",
    coverText: "Fresco para un día de verano"
  },
  {
    value: "brindis-y-celebracion",
    label: "Brindis y Celebración",
    background: bgBrindis,
    cardTheme: "gold",
    accent: "#ffe07a",
    shadow: "rgba(188, 130, 27, 0.36)",
    liquidStart: "#ffe898",
    liquidEnd: "#ffb347",
    coverText: "Listo para celebrar a lo grande"
  },
  {
    value: "chill-y-relax",
    label: "Chill y Relax",
    background: bgChill,
    cardTheme: "coral",
    accent: "#8e78ff",
    shadow: "rgba(73, 34, 105, 0.38)",
    liquidStart: "#8fddff",
    liquidEnd: "#9076ff",
    coverText: "Suavecito para bajar revoluciones"
  },
  {
    value: "parrilla-y-amigos",
    label: "Parrilla y Amigos",
    background: bgParrilla,
    cardTheme: "green",
    accent: "#ffcf7c",
    shadow: "rgba(137, 87, 22, 0.28)",
    liquidStart: "#ffd994",
    liquidEnd: "#d8843e",
    coverText: "Ideal para la parrilla del finde"
  },
  {
    value: "frutal-y-refrescante",
    label: "Frutal y Refrescante",
    background: bgFrutal,
    cardTheme: "cyan",
    accent: "#9de95c",
    shadow: "rgba(67, 144, 44, 0.24)",
    liquidStart: "#fff498",
    liquidEnd: "#8adc4b",
    coverText: "Refrescante y con toque frutal"
  },
  {
    value: "premium",
    label: "Premium",
    background: bgPremium,
    cardTheme: "pink",
    accent: "#f6d48c",
    shadow: "rgba(117, 83, 22, 0.28)",
    liquidStart: "#ffe6a6",
    liquidEnd: "#f2b35e",
    coverText: "Selección premium para lucirse"
  },
  {
    value: "express",
    label: "Express",
    background: bgExpress,
    cardTheme: "green",
    accent: "#ffd37d",
    shadow: "rgba(119, 79, 28, 0.24)",
    liquidStart: "#fff0b3",
    liquidEnd: "#f8b652",
    coverText: "Sale rápido y queda bien"
  }
];

const CATEGORY_BY_VALUE = new Map(COMBO_CATEGORY_OPTIONS.map((item) => [item.value, item]));

const LEGACY_CATEGORY_ALIASES = {
  pre: "previa",
  playa: "playa-y-verano",
  chill: "chill-y-relax",
  fiesta: "noche-de-salida",
  romantico: "reunion-en-casa",
  premium: "premium",
  mixers: "frutal-y-refrescante",
  after: "noche-de-salida",
  general: "reunion-en-casa"
};

export function normalizeComboCategoryKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return COMBO_CATEGORY_OPTIONS[0].value;
  if (CATEGORY_BY_VALUE.has(raw)) return raw;
  if (LEGACY_CATEGORY_ALIASES[raw]) return LEGACY_CATEGORY_ALIASES[raw];
  return COMBO_CATEGORY_OPTIONS[0].value;
}

export function getComboCategoryMeta(value) {
  return CATEGORY_BY_VALUE.get(normalizeComboCategoryKey(value)) || COMBO_CATEGORY_OPTIONS[0];
}

export function getComboCategoryLabel(value) {
  return getComboCategoryMeta(value).label;
}

export function inferComboCocktailName(products = []) {
  const names = products.map((product) => String(product?.name || "").toLowerCase());
  const categories = new Set(products.map((product) => String(product?.category || "").toLowerCase()));

  if (categories.has("gin")) return "Gin tonic sugerido";
  if (categories.has("whisky") && names.some((name) => name.includes("ginger"))) return "Whisky ginger";
  if (categories.has("whisky")) return "Highball sugerido";
  if (categories.has("ron") && names.some((name) => name.includes("cola"))) return "Cuba libre sugerido";
  if (categories.has("ron")) return "Ron mix sugerido";
  if (categories.has("vodka") && names.some((name) => name.includes("jugo"))) return "Vodka cítrico";
  if (categories.has("vodka")) return "Vodka mix sugerido";
  if (categories.has("pisco")) return "Pisco mix sugerido";
  if (categories.has("espumantes") || categories.has("vinos")) return "Copa sugerida";
  return "Mix de la casa";
}
