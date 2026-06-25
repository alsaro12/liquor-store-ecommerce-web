# Despliegue La Licoreria

## Estado de datos

La base principal es Firestore en el proyecto `la-licoreria`, base `lalicoreria`.
El runtime usa las colecciones v2:

- `products_v2`
- `customers_v2`
- `orders_v2`
- `combos_v2`
- `notifications_v2`
- `sales_v2`
- `kardex_v2`
- `settings_v2`

Las colecciones v1 fueron vaciadas y no deben volver a usarse.

Nota: no desplegar reglas de Firestore con `firebase deploy --only firestore` mientras se use la base nombrada `lalicoreria`, porque Firebase CLI puede intentar usar o crear la base `(default)`. El backend usa Firebase Admin SDK y fuerza `FIRESTORE_DATABASE_ID=lalicoreria`.

## Frontend

El frontend se despliega como sitio estatico desde `dist` usando Firebase Hosting.

Comandos:

```bash
npm run build
firebase deploy --only hosting
```

Variables de build:

```bash
VITE_API_BASE_URL=https://api.tu-dominio.com
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=la-licoreria.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://la-licoreria-default-rtdb.europe-west1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=la-licoreria
VITE_FIREBASE_STORAGE_BUCKET=la-licoreria.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=984564385142
VITE_FIREBASE_APP_ID=1:984564385142:web:5449f746cdc4090456a657
VITE_FIREBASE_MEASUREMENT_ID=G-1BK5CR8H6K
```

## Backend

El backend Node arranca con:

```bash
npm start
```

Debe publicarse en una plataforma que ejecute Node, por ejemplo Cloud Run, Render, Railway o VPS. Firebase Hosting por si solo no ejecuta este backend.

Variables obligatorias del backend:

```bash
NODE_ENV=production
FIREBASE_BACKEND_ENABLED=true
FIREBASE_PROJECT_ID=la-licoreria
FIRESTORE_DATABASE_ID=lalicoreria
FIREBASE_STORAGE_BUCKET=la-licoreria.firebasestorage.app
FIREBASE_DATABASE_URL=https://la-licoreria-default-rtdb.europe-west1.firebasedatabase.app
```

Credenciales:

- En Google Cloud Run, usar una service account con permisos de Firestore/Storage.
- En otros servidores, configurar `GOOGLE_APPLICATION_CREDENTIALS` o un secret equivalente. No subir el JSON al repositorio ni al frontend.

El backend escucha en `0.0.0.0` automaticamente cuando la plataforma define `PORT`.

### Opcion recomendada: Cloud Run

1. Construir el frontend antes del contenedor:

```bash
npm run build
```

2. Construir y subir imagen:

```bash
gcloud builds submit --tag gcr.io/la-licoreria/licoreria-backend
```

3. Desplegar backend:

```bash
gcloud run deploy licoreria-backend \
  --image gcr.io/la-licoreria/licoreria-backend \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,FIREBASE_BACKEND_ENABLED=true,FIREBASE_PROJECT_ID=la-licoreria,FIRESTORE_DATABASE_ID=lalicoreria,FIREBASE_STORAGE_BUCKET=la-licoreria.firebasestorage.app,FIREBASE_DATABASE_URL=https://la-licoreria-default-rtdb.europe-west1.firebasedatabase.app
```

4. Dar permisos a la service account de Cloud Run:

- `Cloud Datastore User` o permisos equivalentes de Firestore.
- `Storage Object Admin` si el backend va a escribir/leer imagenes en Storage.

5. Copiar la URL generada por Cloud Run y usarla como `VITE_API_BASE_URL`.

## Dominio

Recomendado:

- `tudominio.com` -> Firebase Hosting frontend.
- `api.tudominio.com` -> backend Node.

Luego compilar el frontend con:

```bash
VITE_API_BASE_URL=https://api.tudominio.com npm run build
```

## Verificacion minima post deploy

- Abrir `/` y confirmar catalogo.
- Abrir `/combos`.
- Login admin con DNI y clave actual.
- Revisar productos admin.
- Revisar pedidos admin.
- Crear una venta de prueba controlada y confirmar:
  - `sales_v2` crea un documento nuevo.
  - `products_v2` descuenta stock.
  - `kardex_v2` crea movimiento.
