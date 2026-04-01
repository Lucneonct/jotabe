# Catalogo App

## Project overview
B2B wholesale product catalog for "Marce Catalogo" (Argentine distributor). Single-page Vue 3 app deployed to GitHub Pages. Customers browse products, add to cart, and submit orders via WhatsApp.

## Tech stack
- **Frontend**: Vue 3 (Composition API, single `App.vue` component), Vite 8
- **Deployment**: Render.com (root path `/`)
- **Data**: Static `catalog.json` + WebP images in `public/`

## Commands
- `npm run dev` — local dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build

## Architecture
- **Single component**: All logic lives in `src/App.vue` (~1900 lines)
- **No router/store**: Uses refs, computeds, and localStorage for state
- **Data flow**: `catalog.json` fetched on mount, products filtered/grouped in computeds

## Data pipeline (parent directory `../`)
- `precios.xlsx` + `frozen.xlsx` — price data source (Excel)
- `catalogo.pptx` — product images source (530MB PowerPoint)
- `extract_catalog.py` — parses Excel + PPTX, outputs `public/catalog.json` + `public/images/*.webp`
- Run `python extract_catalog.py` from parent dir to regenerate catalog data

## Key features
- Product search (multi-term, searches code + description + supplier)
- Category filtering by supplier/brand
- Cart with unit + bulk quantities, persisted to localStorage
- Per-product and per-brand discounts
- **Discount URL system**: `?editor` for editing, shared URLs with `?bd=BRAND:pct&d=CODE:pct` for read-only view
- WhatsApp order submission (phone: +5493764909072)
- Browser back button support via History API

## Important conventions
- Prices in Argentine Pesos (ARS), formatted with `Intl.NumberFormat('es-AR')`
- All UI text in Spanish
- Color scheme: blue (#2563eb) primary, green (#059669) prices, amber (#f59e0b) discounts
- Base path is `/` (configured in `vite.config.js`)
- Product images are lazy-loaded WebP files named `{code}_{index}.webp`
