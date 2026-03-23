<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const catalog = ref({ categories: [], products: [] })
const search = ref('')
const selectedCategory = ref('')
const selectedProduct = ref(null)
const showCategoryMenu = ref(false)
const loading = ref(true)

onMounted(async () => {
  const res = await fetch('/catalog.json')
  catalog.value = await res.json()
  loading.value = false
})

const productsWithImages = computed(() =>
  catalog.value.products.filter(p => p.images && p.images.length > 0)
)

const filteredProducts = computed(() => {
  let list = productsWithImages.value
  if (selectedCategory.value) {
    list = list.filter(p => p.supplier === selectedCategory.value)
  }
  if (search.value.trim()) {
    const terms = search.value.toLowerCase().trim().split(/\s+/)
    list = list.filter(p => {
      const text = `${p.code} ${p.description} ${p.supplier}`.toLowerCase()
      return terms.every(t => text.includes(t))
    })
  }
  return list
})

const groupedBySupplier = computed(() => {
  const groups = {}
  for (const p of filteredProducts.value) {
    const key = p.supplier || 'Sin categoría'
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
})

function formatPrice(n) {
  if (n == null) return '-'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function openProduct(product) {
  selectedProduct.value = product
  document.body.style.overflow = 'hidden'
}

function closeProduct() {
  selectedProduct.value = null
  document.body.style.overflow = ''
}

function selectCategory(cat) {
  selectedCategory.value = cat
  showCategoryMenu.value = false
}

function clearFilters() {
  search.value = ''
  selectedCategory.value = ''
}

// Close modal on escape
function onKeydown(e) {
  if (e.key === 'Escape') closeProduct()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <h1 class="logo">Catálogo</h1>
        <span class="product-count" v-if="!loading">
          {{ filteredProducts.length }} productos
        </span>
      </div>

      <!-- Search bar -->
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="search"
          type="text"
          placeholder="Buscar por código o nombre..."
          class="search-input"
        />
        <button v-if="search" class="clear-btn" @click="search = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Category filter -->
      <div class="category-bar">
        <button
          class="cat-chip"
          :class="{ active: !selectedCategory }"
          @click="selectCategory('')"
        >
          Todos
        </button>
        <button
          class="cat-chip"
          :class="{ active: selectedCategory === cat }"
          v-for="cat in catalog.categories"
          :key="cat"
          @click="selectCategory(cat)"
        >
          {{ cat }}
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>Cargando catálogo...</p>
    </div>

    <!-- Product grid -->
    <main v-else class="main">
      <div v-if="filteredProducts.length === 0" class="empty">
        <p>No se encontraron productos</p>
        <button class="clear-filters-btn" @click="clearFilters">Limpiar filtros</button>
      </div>

      <template v-for="[supplier, products] in groupedBySupplier" :key="supplier">
        <h2 class="supplier-title">{{ supplier }}</h2>
        <div class="product-grid">
          <div
            class="product-card"
            v-for="product in products"
            :key="product.code"
            @click="openProduct(product)"
          >
            <div class="card-image">
              <img
                :src="'/images/' + product.images[0]"
                :alt="product.description"
                loading="lazy"
              />
            </div>
            <div class="card-info">
              <span class="card-code">#{{ product.code }}</span>
              <p class="card-name">{{ product.description }}</p>
              <p class="card-price" v-if="product.unit_price">
                {{ formatPrice(product.unit_price) }}
                <span class="price-label">/ unidad</span>
              </p>
              <p class="card-price no-price" v-else>Consultar precio</p>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- Product detail modal -->
    <Teleport to="body">
      <div v-if="selectedProduct" class="modal-overlay" @click.self="closeProduct">
        <div class="modal">
          <button class="modal-close" @click="closeProduct">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>

          <div class="modal-image-container">
            <img
              v-for="(img, idx) in selectedProduct.images"
              :key="idx"
              :src="'/images/' + img"
              :alt="selectedProduct.description"
              class="modal-image"
            />
          </div>

          <div class="modal-info">
            <span class="modal-code">Código #{{ selectedProduct.code }}</span>
            <h2 class="modal-name">{{ selectedProduct.description }}</h2>
            <p class="modal-supplier" v-if="selectedProduct.supplier">
              {{ selectedProduct.supplier }}
            </p>

            <div class="price-table" v-if="selectedProduct.unit_price || selectedProduct.bulk_price">
              <div class="price-row" v-if="selectedProduct.unit_price">
                <span class="price-label-big">Precio por unidad</span>
                <span class="price-value-big">{{ formatPrice(selectedProduct.unit_price) }}</span>
              </div>
              <div class="price-row" v-if="selectedProduct.bulk_price">
                <span class="price-label-big">Precio por bulto</span>
                <span class="price-value-big bulk">{{ formatPrice(selectedProduct.bulk_price) }}</span>
              </div>
              <div class="price-row units" v-if="selectedProduct.units_per_bulk">
                <span class="price-label-big">Unidades por bulto</span>
                <span class="price-value-big">{{ selectedProduct.units_per_bulk }}</span>
              </div>
            </div>
            <div class="price-table no-price-box" v-else>
              <div class="price-row">
                <span class="price-label-big">Consultar precio</span>
              </div>
            </div>

            <p class="iva-note" v-if="selectedProduct.unit_price">* Precios con IVA incluido</p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* ── Reset & Base ── */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f0f2f5;
  color: #1a1a2e;
  -webkit-font-smoothing: antialiased;
}

/* ── App Layout ── */
.app {
  min-height: 100vh;
  max-width: 1400px;
  margin: 0 auto;
}

/* ── Header ── */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #ffffff;
  padding: 12px 16px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.08);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.logo {
  font-size: 22px;
  font-weight: 700;
  color: #2563eb;
}

.product-count {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

/* ── Search ── */
.search-bar {
  position: relative;
  margin-bottom: 10px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: #9ca3af;
}

.search-input {
  width: 100%;
  padding: 10px 40px 10px 38px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  font-size: 15px;
  font-family: inherit;
  background: #f9fafb;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.search-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  background: #fff;
}

.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

/* ── Category chips ── */
.category-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.category-bar::-webkit-scrollbar {
  display: none;
}

.cat-chip {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 20px;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.cat-chip:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.cat-chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

/* ── Loading ── */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  color: #6b7280;
  gap: 12px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Main content ── */
.main {
  padding: 16px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.clear-filters-btn {
  margin-top: 12px;
  padding: 8px 20px;
  border: 1.5px solid #2563eb;
  border-radius: 8px;
  background: transparent;
  color: #2563eb;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}

.supplier-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  margin: 20px 0 12px;
  padding-bottom: 6px;
  border-bottom: 2px solid #e5e7eb;
}

.supplier-title:first-child {
  margin-top: 0;
}

/* ── Product Grid ── */
.product-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (min-width: 600px) {
  .product-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
}

@media (min-width: 900px) {
  .product-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
}

@media (min-width: 1200px) {
  .product-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

/* ── Product Card ── */
.product-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.product-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.product-card:active {
  transform: scale(0.98);
}

.card-image {
  width: 100%;
  aspect-ratio: 1;
  background: #f9fafb;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.card-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.card-info {
  padding: 8px 10px 10px;
}

.card-code {
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.card-name {
  font-size: 11px;
  color: #4b5563;
  margin-top: 2px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-price {
  font-size: 14px;
  font-weight: 700;
  color: #059669;
  margin-top: 4px;
}

.price-label {
  font-size: 10px;
  font-weight: 400;
  color: #6b7280;
}

.card-price.no-price {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 500;
  font-style: italic;
}

.no-price-box {
  border-color: #fbbf24;
  background: #fffbeb;
}

.no-price-box .price-label-big {
  color: #b45309;
  font-weight: 600;
}

/* ── Modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@media (min-width: 600px) {
  .modal-overlay {
    align-items: center;
    padding: 20px;
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: #fff;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  border-radius: 20px 20px 0 0;
  overflow-y: auto;
  animation: slideUp 0.25s ease;
  position: relative;
}

@media (min-width: 600px) {
  .modal {
    border-radius: 16px;
    max-height: 85vh;
  }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (min-width: 600px) {
  @keyframes slideUp {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #374151;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.modal-image-container {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  background: #f9fafb;
}

.modal-image {
  min-width: 100%;
  max-height: 300px;
  object-fit: contain;
  scroll-snap-align: start;
  padding: 16px;
}

.modal-info {
  padding: 16px 20px 24px;
}

.modal-code {
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}

.modal-name {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
  margin-top: 4px;
  line-height: 1.3;
}

.modal-supplier {
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
}

.price-table {
  margin-top: 16px;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.price-row + .price-row {
  border-top: 1px solid #f3f4f6;
}

.price-row.units {
  background: #f9fafb;
}

.price-label-big {
  font-size: 14px;
  color: #4b5563;
}

.price-value-big {
  font-size: 18px;
  font-weight: 700;
  color: #059669;
}

.price-value-big.bulk {
  color: #2563eb;
}

.iva-note {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 8px;
  text-align: right;
}
</style>
