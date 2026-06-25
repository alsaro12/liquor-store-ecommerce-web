import React from "react";
import { resolveProductImage } from "../storefrontApi.js";
import CardQuantityControl from "../CardQuantityControl.jsx";
import productImageUnavailable from "../../../assets/storefront/imagennodisponible2.png";

function formatMoney(value) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function productImage(product) {
  return resolveProductImage(product) || "";
}

function DetailProductImage({ image }) {
  const [failed, setFailed] = React.useState(false);
  const src = !failed && image ? image : productImageUnavailable;
  return (
    <img
      src={src}
      alt=""
      loading="eager"
      fetchPriority="high"
      decoding="async"
      className={failed || !image ? "is-fallback" : ""}
      onError={() => setFailed(true)}
    />
  );
}

function RelatedProductImage({ image, name }) {
  const [failed, setFailed] = React.useState(false);
  const src = !failed && image ? image : productImageUnavailable;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={failed || !image ? "is-fallback" : ""}
    />
  );
}

const RELATED_CATEGORY_GROUPS = [
  ["Energizantes", "Gaseosas y Mixers", "Ready To Drink", "Bebidas Preparadas (RTD)", "Jugos y Néctares", "Aguas", "Agua", "Hielo"],
  ["Whisky", "Ron", "Vodka", "Gin", "Tequila", "Pisco", "Vinos", "Espumantes", "Licores y Cremas", "Aperitivos y Digestivos"],
  ["Snacks", "Snacks y Golosinas", "Accesorios y Regalos"]
];

function normalizeRelatedCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function relatedCategorySet(category) {
  const normalized = normalizeRelatedCategory(category);
  const group = RELATED_CATEGORY_GROUPS.find((items) => (
    items.some((item) => normalizeRelatedCategory(item) === normalized)
  ));
  return new Set((group || [category]).map(normalizeRelatedCategory));
}

function relatedProductsFor(product, products) {
  const currentCategory = String(product?.category || "").toLowerCase();
  const categoryFamily = relatedCategorySet(product?.category);
  return (products || [])
    .filter((candidate) => candidate && String(candidate.id) !== String(product?.id) && Number(candidate.stock || 0) > 0)
    .map((candidate) => {
      const candidateCategory = String(candidate.category || "").toLowerCase();
      const exactCategory = candidateCategory === currentCategory;
      const familyCategory = categoryFamily.has(normalizeRelatedCategory(candidate.category));
      return { candidate, score: exactCategory ? 0 : familyCategory ? 1 : 2 };
    })
    .filter((item) => item.score < 2)
    .sort((a, b) => a.score - b.score || String(a.candidate.name || "").localeCompare(String(b.candidate.name || "")))
    .map((item) => item.candidate)
    .slice(0, 12);
}

export default function ProductoDetallePage({
  product,
  products,
  onAdd,
  onDecrease,
  getQuantity,
  onGoBack,
  isFavorite,
  favoriteBusy = false,
  onToggleFavorite,
  loading
}) {
  React.useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.classList.add("product-detail-lock");
    document.documentElement.classList.add("product-detail-lock");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.classList.remove("product-detail-lock");
      document.documentElement.classList.remove("product-detail-lock");
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, []);

  if (loading && !product) {
    return (
      <section className="premium-detail-page product-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
        <div className="premium-detail-empty" onClick={(event) => event.stopPropagation()}>
          <h1>Cargando producto</h1>
          <p>Estamos preparando el detalle del catálogo.</p>
        </div>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="premium-detail-page product-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
        <div className="premium-detail-empty" onClick={(event) => event.stopPropagation()}>
          <h1>Producto no encontrado</h1>
          <p>Puede que este producto aún esté cargando o ya no esté disponible.</p>
          <button type="button" onClick={onGoBack}>Volver</button>
        </div>
      </section>
    );
  }

  const image = productImage(product);
  const category = product.category || "Producto";
  const stock = Number(product.stock || 0);
  const related = relatedProductsFor(product, products);
  const quantityInCart = getQuantity?.(product) || 0;
  const productSubtotal = Number(product.price || 0) * quantityInCart;
  function handleFavoriteAction(event) {
    event.preventDefault();
    event.stopPropagation();
    if (favoriteBusy) return;
    onToggleFavorite?.(product);
  }

  function addProduct(event, item = product) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onAdd?.(item);
  }

  return (
    <section className="premium-detail-page product-detail-page" role="dialog" aria-modal="true" onClick={onGoBack}>
      <div className="premium-detail-shell product-detail-shell" onClick={(event) => event.stopPropagation()}>
        <div className="product-detail-main">
          <figure className="product-detail-media">
            <DetailProductImage image={image} />
            <div className="product-detail-media-shade" />
            <div className="premium-detail-topbar">
              <button type="button" className="premium-detail-back" onClick={onGoBack} aria-label="Volver">
                <span aria-hidden="true">←</span>
                <span className="product-detail-back-label">Volver</span>
              </button>
              <button
                type="button"
                className={`product-detail-favorite${isFavorite ? " is-active" : ""}`}
                aria-label={isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                aria-pressed={!!isFavorite}
                aria-disabled={favoriteBusy}
                onClick={handleFavoriteAction}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") handleFavoriteAction(event);
                }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill={isFavorite ? "currentColor" : "none"} aria-hidden="true">
                  <path d="M12 21s-7-4.6-9.3-9.1C1.1 8 3.6 4 7.5 4c2 0 3.4 1 4.5 2.3C13.1 5 14.5 4 16.5 4 20.4 4 22.9 8 21.3 11.9 19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </figure>

          <div className="product-detail-info">
            <span className="premium-detail-kicker">{category}</span>
            <h1>{product.name}</h1>
            <div className="product-detail-unit-price">
              <strong className="product-detail-price">{formatMoney(product.price)}</strong>
              <span>Precio por unidad</span>
            </div>
            <div className="product-detail-stock">
              <b>{stock > 0 ? "Disponible" : "Sin stock"}</b>
            </div>

          </div>
        </div>

        <div className="premium-detail-cta product-detail-cta">
          <div>
            <strong>{formatMoney(productSubtotal)}</strong>
            <span>Total seleccionado</span>
          </div>
          {quantityInCart > 0 ? (
            <CardQuantityControl
              quantity={quantityInCart}
              max={stock}
              ariaLabel={`Cantidad de ${product.name}`}
              onIncrement={() => onAdd?.(product)}
              onDecrement={() => onDecrease?.(product)}
              className="is-detail-product"
              expandOnQuantity
            />
          ) : (
            <button type="button" onClick={(event) => addProduct(event)} disabled={stock <= 0}>
              <span aria-hidden="true">+</span>
              Agregar al carrito
            </button>
          )}
        </div>

        {related.length ? (
          <section className="product-detail-related product-detail-related-inline" aria-label="Productos relacionados">
            <div className="product-detail-section-head">
              <h2>Productos relacionados</h2>
            </div>
            <div className="product-detail-related-strip">
              {related.map((item) => {
                const relatedImage = productImage(item);
                return (
                  <article
                    className="product-detail-related-chip"
                    key={item.id}
                  >
                    <button
                      type="button"
                      className="product-detail-related-open"
                      onClick={() => { window.location.href = `/producto/${item.id}`; }}
                      aria-label={`Ver ${item.name}`}
                    >
                      <span className="product-detail-related-thumb">
                        <RelatedProductImage image={relatedImage} name={item.name} />
                      </span>
                      <span className="product-detail-related-copy">
                        <strong>{item.name}</strong>
                        <b>{formatMoney(item.price)}</b>
                      </span>
                    </button>
                    <div className="product-detail-related-qty">
                      <CardQuantityControl
                        quantity={getQuantity?.(item) || 0}
                        max={item.stock}
                        ariaLabel={`Cantidad de ${item.name}`}
                        onIncrement={() => onAdd?.(item)}
                        onDecrement={() => onDecrease?.(item)}
                        className="is-related-product"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
