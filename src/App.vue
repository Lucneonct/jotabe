<script setup>
import { ref, computed, onMounted } from 'vue'

const catalog = ref({ categories: [], products: [] })
const search = ref('')
const selectedCategory = ref('')
const selectedProduct = ref(null)
const loading = ref(true)
const base = import.meta.env.BASE_URL

// ── Cart ──
const cart = ref({}) // { [code]: { product, units: number, bulks: number } }
const showCart = ref(false)

const cartItemCount = computed(() => {
  return Object.values(cart.value).reduce((sum, item) => sum + item.units + item.bulks, 0)
})

const cartItems = computed(() => Object.values(cart.value))

const cartTotal = computed(() => {
  return cartItems.value.reduce((sum, item) => {
    const unitTotal = (item.product.unit_price || 0) * item.units
    const bulkTotal = (item.product.bulk_price || 0) * item.bulks
    return sum + unitTotal + bulkTotal
  }, 0)
})

function addUnit(product) {
  if (!cart.value[product.code]) {
    cart.value[product.code] = { product, units: 0, bulks: 0 }
  }
  cart.value[product.code].units++
}

function removeUnit(product) {
  const item = cart.value[product.code]
  if (!item) return
  item.units--
  if (item.units <= 0 && item.bulks <= 0) delete cart.value[product.code]
}

function addBulk(product) {
  if (!cart.value[product.code]) {
    cart.value[product.code] = { product, units: 0, bulks: 0 }
  }
  cart.value[product.code].bulks++
}

function removeBulk(product) {
  const item = cart.value[product.code]
  if (!item) return
  item.bulks--
  if (item.units <= 0 && item.bulks <= 0) delete cart.value[product.code]
}

function removeFromCart(code) {
  delete cart.value[code]
}

function clearCart() {
  cart.value = {}
}

function getCartItem(code) {
  return cart.value[code] || null
}

function openCart() {
  showCart.value = true
  document.body.style.overflow = 'hidden'
}

function closeCart() {
  showCart.value = false
  document.body.style.overflow = ''
}

function sendToWhatsApp() {
  const lines = ['*Pedido:*', '']
  for (const item of cartItems.value) {
    const p = item.product
    if (item.units > 0) {
      const subtotal = (p.unit_price || 0) * item.units
      lines.push(`- ${item.units}x unid. #${p.code} ${p.description} (${formatPrice(subtotal)})`)
    }
    if (item.bulks > 0) {
      const subtotal = (p.bulk_price || 0) * item.bulks
      lines.push(`- ${item.bulks}x bulto #${p.code} ${p.description} (${formatPrice(subtotal)})`)
    }
  }
  lines.push('')
  lines.push(`*Total: ${formatPrice(cartTotal.value)}*`)

  const text = encodeURIComponent(lines.join('\n'))
  window.open(
    `https://api.whatsapp.com/send/?phone=5493764909072&text=${text}&type=phone_number&app_absent=0`,
    '_blank'
  )
}

// ── Catalog ──
onMounted(async () => {
  const res = await fetch(`${base}catalog.json`)
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
}

function clearFilters() {
  search.value = ''
  selectedCategory.value = ''
}

onMounted(() => {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (showCart.value) closeCart()
      else closeProduct()
    }
  })
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <h1 class="logo">Catálogo</h1>
        <div class="header-right">
          <span class="product-count" v-if="!loading">
            {{ filteredProducts.length }} productos
          </span>
          <button class="cart-btn" @click="openCart">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            <span class="cart-badge" v-if="cartItemCount > 0">{{ cartItemCount }}</span>
          </button>
        </div>
      </div>

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

      <div class="category-bar">
        <button class="cat-chip" :class="{ active: !selectedCategory }" @click="selectCategory('')">Todos</button>
        <button
          class="cat-chip"
          :class="{ active: selectedCategory === cat }"
          v-for="cat in catalog.categories"
          :key="cat"
          @click="selectCategory(cat)"
        >{{ cat }}</button>
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
                :src="`${base}images/` + product.images[0]"
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
            <!-- Mini cart indicator on card -->
            <div class="card-cart-badge" v-if="getCartItem(product.code)">
              {{ getCartItem(product.code).units + getCartItem(product.code).bulks }}
            </div>
          </div>
        </div>
      </template>

      <!-- Bottom spacer for floating cart button -->
      <div style="height: 80px"></div>
    </main>

    <!-- Floating cart button (mobile) -->
    <button v-if="cartItemCount > 0 && !showCart && !selectedProduct" class="floating-cart" @click="openCart">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
      <span>{{ cartItemCount }} items - {{ formatPrice(cartTotal) }}</span>
    </button>

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
              :src="`${base}images/` + img"
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

            <!-- Add to cart controls -->
            <div class="add-to-cart">
              <!-- Unit row -->
              <div class="cart-row" v-if="selectedProduct.unit_price">
                <span class="cart-row-label">Unidades</span>
                <div class="qty-controls">
                  <button
                    class="qty-btn minus"
                    @click="removeUnit(selectedProduct)"
                    :disabled="!getCartItem(selectedProduct.code) || getCartItem(selectedProduct.code).units <= 0"
                  >-</button>
                  <span class="qty-value">{{ getCartItem(selectedProduct.code)?.units || 0 }}</span>
                  <button class="qty-btn plus" @click="addUnit(selectedProduct)">+</button>
                </div>
              </div>

              <!-- Bulk row -->
              <div class="cart-row" v-if="selectedProduct.bulk_price">
                <div class="cart-row-label">
                  Bultos
                  <span class="cart-row-hint" v-if="selectedProduct.units_per_bulk">
                    ({{ selectedProduct.units_per_bulk }} unid.)
                  </span>
                </div>
                <div class="qty-controls">
                  <button
                    class="qty-btn minus"
                    @click="removeBulk(selectedProduct)"
                    :disabled="!getCartItem(selectedProduct.code) || getCartItem(selectedProduct.code).bulks <= 0"
                  >-</button>
                  <span class="qty-value">{{ getCartItem(selectedProduct.code)?.bulks || 0 }}</span>
                  <button class="qty-btn plus" @click="addBulk(selectedProduct)">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Cart modal -->
    <Teleport to="body">
      <div v-if="showCart" class="modal-overlay" @click.self="closeCart">
        <div class="modal cart-modal">
          <div class="cart-header">
            <h2 class="cart-title">Tu pedido</h2>
            <button class="modal-close" @click="closeCart" style="position:static;box-shadow:none;background:transparent;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div v-if="cartItems.length === 0" class="cart-empty">
            <p>Tu pedido está vacío</p>
            <p class="cart-empty-hint">Tocá un producto y agregá unidades o bultos</p>
          </div>

          <div v-else class="cart-body">
            <div class="cart-item" v-for="item in cartItems" :key="item.product.code">
              <img :src="`${base}images/` + item.product.images[0]" class="cart-item-img" />
              <div class="cart-item-info">
                <span class="cart-item-code">#{{ item.product.code }}</span>
                <p class="cart-item-name">{{ item.product.description }}</p>

                <!-- Unit line -->
                <div class="cart-item-line" v-if="item.units > 0">
                  <div class="qty-controls small">
                    <button class="qty-btn minus" @click="removeUnit(item.product)">-</button>
                    <span class="qty-value">{{ item.units }}</span>
                    <button class="qty-btn plus" @click="addUnit(item.product)">+</button>
                  </div>
                  <span class="cart-item-type">unid.</span>
                  <span class="cart-item-subtotal">{{ formatPrice(item.product.unit_price * item.units) }}</span>
                </div>

                <!-- Bulk line -->
                <div class="cart-item-line" v-if="item.bulks > 0">
                  <div class="qty-controls small">
                    <button class="qty-btn minus" @click="removeBulk(item.product)">-</button>
                    <span class="qty-value">{{ item.bulks }}</span>
                    <button class="qty-btn plus" @click="addBulk(item.product)">+</button>
                  </div>
                  <span class="cart-item-type">bulto{{ item.bulks > 1 ? 's' : '' }}</span>
                  <span class="cart-item-subtotal">{{ formatPrice(item.product.bulk_price * item.bulks) }}</span>
                </div>
              </div>
              <button class="cart-item-remove" @click="removeFromCart(item.product.code)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                </svg>
              </button>
            </div>

            <div class="cart-total">
              <span>Total</span>
              <span class="cart-total-value">{{ formatPrice(cartTotal) }}</span>
            </div>

            <button class="whatsapp-btn" @click="sendToWhatsApp">
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Enviar pedido por WhatsApp
            </button>

            <button class="clear-cart-btn" @click="clearCart">Vaciar pedido</button>
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

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
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

/* ── Cart button in header ── */
.cart-btn {
  position: relative;
  background: none;
  border: none;
  color: #374151;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
}

.cart-badge {
  position: absolute;
  top: -2px;
  right: -6px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
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
  position: relative;
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

.card-cart-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}

.no-price-box {
  border-color: #fbbf24;
  background: #fffbeb;
}

.no-price-box .price-label-big {
  color: #b45309;
  font-weight: 600;
}

/* ── Floating cart button ── */
.floating-cart {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  background: #25d366;
  color: #fff;
  border: none;
  border-radius: 28px;
  padding: 14px 24px;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 20px rgba(37, 211, 102, 0.4);
  animation: floatIn 0.3s ease;
}

.floating-cart:active {
  transform: translateX(-50%) scale(0.96);
}

@keyframes floatIn {
  from { transform: translateX(-50%) translateY(60px); opacity: 0; }
  to { transform: translateX(-50%) translateY(0); opacity: 1; }
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

/* ── Add to cart controls (product modal) ── */
.add-to-cart {
  margin-top: 16px;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.cart-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.cart-row + .cart-row {
  border-top: 1px solid #f3f4f6;
}

.cart-row-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.cart-row-hint {
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}

/* ── Quantity controls ── */
.qty-controls {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.qty-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: #f9fafb;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: background 0.1s;
}

.qty-btn:active {
  background: #e5e7eb;
}

.qty-btn:disabled {
  color: #d1d5db;
  cursor: default;
}

.qty-btn.plus {
  color: #2563eb;
}

.qty-value {
  min-width: 36px;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
}

.qty-controls.small {
  border-radius: 8px;
}

.qty-controls.small .qty-btn {
  width: 28px;
  height: 28px;
  font-size: 15px;
}

.qty-controls.small .qty-value {
  min-width: 28px;
  font-size: 14px;
}

/* ── Cart modal ── */
.cart-modal {
  display: flex;
  flex-direction: column;
}

.cart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}

.cart-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
}

.cart-empty {
  padding: 48px 20px;
  text-align: center;
  color: #6b7280;
}

.cart-empty-hint {
  font-size: 13px;
  margin-top: 6px;
  color: #9ca3af;
}

.cart-body {
  padding: 12px 16px 24px;
  overflow-y: auto;
}

/* ── Cart items ── */
.cart-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
  align-items: flex-start;
}

.cart-item:last-of-type {
  border-bottom: none;
}

.cart-item-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 8px;
  background: #f9fafb;
  flex-shrink: 0;
  padding: 4px;
}

.cart-item-info {
  flex: 1;
  min-width: 0;
}

.cart-item-code {
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.cart-item-name {
  font-size: 12px;
  color: #4b5563;
  line-height: 1.3;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cart-item-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.cart-item-type {
  font-size: 12px;
  color: #6b7280;
}

.cart-item-subtotal {
  font-size: 13px;
  font-weight: 700;
  color: #059669;
  margin-left: auto;
}

.cart-item-remove {
  background: none;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  transition: color 0.15s;
}

.cart-item-remove:hover {
  color: #ef4444;
}

/* ── Cart total ── */
.cart-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  margin-top: 8px;
  border-top: 2px solid #1a1a2e;
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
}

.cart-total-value {
  font-size: 22px;
  color: #059669;
}

/* ── WhatsApp button ── */
.whatsapp-btn {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  border: none;
  border-radius: 12px;
  background: #25d366;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: background 0.15s;
}

.whatsapp-btn:hover {
  background: #20bd5a;
}

.whatsapp-btn:active {
  transform: scale(0.98);
}

.clear-cart-btn {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #9ca3af;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}

.clear-cart-btn:hover {
  color: #ef4444;
}
</style>
