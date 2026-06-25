import { useEffect, useState } from "react";

export default function CardQuantityControl({
  quantity = 0,
  max,
  onIncrement,
  onDecrement,
  ariaLabel = "Cantidad",
  className = "",
  expandOnQuantity = false
}) {
  const [expanded, setExpanded] = useState(false);
  const current = Math.max(0, Number(quantity) || 0);
  const limit = Number(max) || 0;
  const canIncrement = !limit || current < limit;
  const showExpanded = current > 0 && (expanded || expandOnQuantity);

  useEffect(() => {
    if (expandOnQuantity) return undefined;
    if (!expanded || current <= 0) return undefined;
    const timeoutId = window.setTimeout(() => setExpanded(false), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [expanded, current]);

  useEffect(() => {
    if (expandOnQuantity && current > 0) setExpanded(true);
  }, [expandOnQuantity, current]);

  function openEditor() {
    if (current > 0) setExpanded(true);
  }

  function increment(event) {
    event.stopPropagation();
    if (!canIncrement) return;
    onIncrement?.();
    setExpanded(true);
  }

  function decrement(event) {
    event.stopPropagation();
    onDecrement?.();
    if (current > 1) setExpanded(true);
    else setExpanded(false);
  }

  function handleCompactClick(event) {
    event.stopPropagation();
    if (current > 0) {
      setExpanded(true);
      return;
    }
    increment(event);
  }

  return (
    <div
      className={`card-qty-control${showExpanded ? " is-expanded" : ""}${current > 0 ? " has-quantity" : ""}${!canIncrement ? " is-maxed" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={openEditor}
    >
      {showExpanded ? (
        <div className="card-qty-shell" role="group" aria-label={ariaLabel}>
          <button type="button" className="card-qty-action" onClick={decrement} aria-label="Disminuir cantidad">−</button>
          <span className="card-qty-value" aria-live="polite">{current}</span>
          <button type="button" className="card-qty-action" onClick={increment} aria-label="Aumentar cantidad" disabled={!canIncrement}>+</button>
        </div>
      ) : (
        <button
          type="button"
          className="card-qty-shell"
          onClick={handleCompactClick}
          disabled={current <= 0 && !canIncrement}
          aria-label={current > 0 ? `${ariaLabel}: ${current}` : ariaLabel}
          title={!canIncrement ? "Sin stock para agregar mas" : undefined}
        >
          {current > 0 ? <span className="card-qty-value">{current}</span> : <span className="card-qty-plus">+</span>}
        </button>
      )}
    </div>
  );
}
