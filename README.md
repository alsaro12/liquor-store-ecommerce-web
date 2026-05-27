# La Licorería AQP

Tienda y panel admin para licorería con catálogo, combos, promos, carrito, pedidos, favoritos, direcciones con mapa, métodos de pago, notificaciones y referidos.

## Stack

- **Frontend**: React 18 + Vite 5 + React Router v6 + Leaflet (mapa OSM)
- **Backend**: Node.js puro (`http` + `mysql2`), sin framework
- **DB**: MySQL (con fallback CSV/JSON local)
- **Auth**: tokens propios (`scrypt` + tabla `sesiones_cliente`)

## Requisitos

- Node.js 22.x
- MySQL accesible (las credenciales van en `.env`)

## Setup local

```bash
# 1. Instalar deps
npm install

# 2. Configurar credenciales DB
cp .env.example .env
# Editar .env con tus datos

# 3. Levantar backend (puerto 8787)
node server.js

# 4. En otra terminal, levantar Vite (puerto 3005)
./node_modules/.bin/vite --host localhost --port 3005
```

Abre `http://localhost:3005/`.

## Estructura

```
src/
├── App.jsx                 # Router (/, /admin/*)
├── main.jsx
├── modules/
│   ├── storefront/         # Tienda pública + cuenta cliente
│   │   ├── Storefront.jsx
│   │   ├── pages/          # MisPedidos, MisFavoritos, MiCuenta, ...
│   │   ├── account/        # Sidebar reutilizable
│   │   ├── common/         # ConfirmDialog, Skeleton
│   │   └── *.jsx           # Modales (Auth, Checkout, AddressPicker, ...)
│   └── admin/              # Panel admin React
└── styles.css

backend/
├── server.js
├── modules/http-server.js  # core
└── objects/                # routers por dominio
    ├── auth/
    ├── productos/
    ├── orders/
    ├── direcciones/
    ├── favoritos/
    ├── combos/
    ├── promos/
    ├── metodos-pago/
    ├── notificaciones/
    ├── referidos/
    └── cuenta/

local-db/                   # stores legacy (fallback CSV/JSON)
docs/                       # PLAN.md y contratos (gitignored)
imagenes/                   # mockups (no versionado por defecto)
```

## Rutas principales

| Frontend | API |
|---|---|
| `/` Catálogo | `/api/productos/storefront` |
| `/combos` | `/api/combos` |
| `/promos` | `/api/promos` |
| `/cuenta` | `/api/cuenta/resumen` |
| `/pedidos` | `/api/orders/mias` |
| `/favoritos` | `/api/favoritos` |
| `/direcciones` | `/api/direcciones` |
| `/pagos` | `/api/metodos-pago` |
| `/notificaciones` | `/api/notificaciones` |
| `/invitar` | `/api/referidos/mi-codigo` |
| `/admin` | (panel admin) |

## Build producción

```bash
npm run build         # genera dist/
node server.js        # backend sirve sólo API
# El front estático sale de dist/ — ponerlo detrás de un Nginx o equivalente
```

## Características destacadas

- 🛒 Carrito drawer con persistencia local
- 📍 Selector de dirección con mapa Leaflet + Nominatim + geohash
- ❤️ Favoritos con toggle optimistic
- 🎁 Sistema de referidos con código + QR + premio automático
- 🏆 Club de puntos con niveles BRONCE/PLATA/ORO
- 🔔 Notificaciones con badge dinámico
- ♿ Skip link, focus-visible, `prefers-reduced-motion`, ARIA

## Pendientes conocidos

- Recuperación de contraseña (requiere SMTP)
- Pasarela de pago real (Culqi/Mercadopago)
- Subir imágenes de productos como archivos en vez de base64
- Panel admin para CRUD de combos y promos
