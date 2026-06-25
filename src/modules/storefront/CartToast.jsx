import React, { useEffect, useState } from "react";
import { resolveProductImage } from "./storefrontApi.js";

export default function CartToast({ toast, onAction, onDismiss }) {
  const [render, setRender] = useState(false);

  useEffect(() => {
    if (!toast) {
      setRender(false);
      return undefined;
    }
    // mount frame, then animate in
    setRender(true);
    const timer = window.setTimeout(() => {
      onDismiss?.();
    }, 2800);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const imageUrl = resolveProductImage({ imageHash: toast.imageHash, images: [] });

  return (
    <div className={`cart-toast${render ? " is-visible" : ""}`} role="status" aria-live="polite">
      <div className="cart-toast-icon" aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" />
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path d="M5 7l1.5 11a2 2 0 0 0 2 1.7h7a2 2 0 0 0 2-1.7L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div className="cart-toast-text">
        <p className="cart-toast-title">
          <span className="cart-toast-check" aria-hidden="true">✓</span> AGREGADO AL CARRITO
        </p>
        <p className="cart-toast-name">{toast.name}</p>
      </div>
      <button type="button" className="cart-toast-action" onClick={onAction}>
        <span className="cart-toast-action-full">VER CARRITO DE COMPRAS</span>
        <span className="cart-toast-action-short" aria-hidden="true">Ver</span>
      </button>
      <button type="button" className="cart-toast-close" onClick={onDismiss} aria-label="Cerrar">×</button>
    </div>
  );
}
