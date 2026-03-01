const state = {
  products: [],
  bestsellers: [],
  highlights: [],
  cart: JSON.parse(localStorage.getItem('zoio_cart') || '[]'),
  settings: {},
  carouselIndex: 0,
  carouselTimer: null
};

const currency = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

const isPromoProduct = (product) => Number(product?.is_promo) === 1 && Number(product?.promo_price) > 0;
const getProductFinalPrice = (product) => Number(product?.final_price || (isPromoProduct(product) ? product.promo_price : product.price) || 0);

const saveCart = () => localStorage.setItem('zoio_cart', JSON.stringify(state.cart));

const els = {
  categoryFilter: document.getElementById('categoryFilter'),
  promoFilter: document.getElementById('promoFilter'),
  sortFilter: document.getElementById('sortFilter'),
  productsGrid: document.getElementById('productsGrid'),
  bestsellersGrid: document.getElementById('bestsellersGrid'),
  cartToggle: document.getElementById('cartToggle'),
  cartPanel: document.getElementById('cartPanel'),
  closeCart: document.getElementById('closeCart'),
  cartItems: document.getElementById('cartItems'),
  cartCount: document.getElementById('cartCount'),
  summaryQty: document.getElementById('summaryQty'),
  summarySubtotal: document.getElementById('summarySubtotal'),
  summaryTotal: document.getElementById('summaryTotal'),
  checkoutBtn: document.getElementById('checkoutBtn'),
  checkoutModal: document.getElementById('checkoutModal'),
  checkoutForm: document.getElementById('checkoutForm'),
  cancelCheckout: document.getElementById('cancelCheckout'),
  heroText: document.getElementById('heroText'),
  heroSubtitle: document.getElementById('heroSubtitle'),
  heroImage: document.getElementById('heroImage'),
  floatingWhatsapp: document.getElementById('floatingWhatsapp'),
  instagramLink: document.getElementById('instagramLink'),
  carouselTrack: document.getElementById('carouselTrack'),
  carouselDots: document.getElementById('carouselDots'),
  prevSlide: document.getElementById('prevSlide'),
  nextSlide: document.getElementById('nextSlide')
};

const getCartTotals = () => {
  const totalItems = state.cart.reduce((acc, item) => acc + item.quantity, 0);
  const subtotal = state.cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  return { totalItems, subtotal };
};

const addToCart = async (product) => {
  if (product.status !== 'available') return;

  const unitPrice = getProductFinalPrice(product);

  const index = state.cart.findIndex((item) => item.productId === product.id);
  if (index >= 0) {
    state.cart[index].quantity += 1;
    state.cart[index].price = unitPrice;
  } else {
    state.cart.push({
      productId: product.id,
      name: product.name,
      price: unitPrice,
      quantity: 1
    });
  }

  saveCart();
  renderCart();

  try {
    await fetch(`/api/public/products/${product.id}/cart-hit`, { method: 'POST' });
  } catch {
  }
};

const changeQuantity = (productId, delta) => {
  const index = state.cart.findIndex((item) => item.productId === productId);
  if (index < 0) return;

  state.cart[index].quantity += delta;
  if (state.cart[index].quantity <= 0) {
    state.cart.splice(index, 1);
  }

  saveCart();
  renderCart();
};

const removeItem = (productId) => {
  state.cart = state.cart.filter((item) => item.productId !== productId);
  saveCart();
  renderCart();
};

const renderProducts = () => {
  if (state.products.length === 0) {
    els.productsGrid.innerHTML = '<p>Nenhum produto encontrado.</p>';
    return;
  }

  els.productsGrid.innerHTML = state.products.map((product) => {
    const promo = isPromoProduct(product);
    const finalPrice = getProductFinalPrice(product);
    const stockWarning = Number(product.stock) <= 2 && product.status === 'available'
      ? `<p class="stock-warning">Restam apenas ${product.stock} unidades</p>`
      : '';

    return `
      <article class="product-card">
        <div class="product-image-wrap">
          <img class="product-image" src="${product.image || '/img/banner-default.svg'}" alt="${product.name}" />
        </div>
        <div class="product-content">
          <div class="product-top">
            <small>${product.category || 'Sem categoria'}</small>
            <span class="badge ${product.status === 'available' ? 'available' : 'unavailable'}">
              ${product.status === 'available' ? 'Disponível' : 'Indisponível'}
            </span>
          </div>
          <h4>${product.name}</h4>
          <p class="price-line">${promo ? `<span class="price-old">${currency(product.price)}</span>` : ''}<span class="${promo ? 'price-promo' : ''}">${currency(finalPrice)}</span></p>
          ${promo ? '<small class="promo-chip">Promoção</small>' : ''}
          ${stockWarning}
          <button class="btn ${product.status === 'available' ? 'btn-primary' : 'btn-outline'}" data-action="add" data-id="${product.id}" ${product.status === 'available' ? '' : 'disabled'}>
            Adicionar ao Carrinho
          </button>
        </div>
      </article>
    `;
  }).join('');

  els.productsGrid.querySelectorAll('[data-action="add"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const product = state.products.find((item) => item.id === id);
      if (product) addToCart(product);
    });
  });
};

const renderBestsellers = () => {
  if (state.bestsellers.length === 0) {
    els.bestsellersGrid.innerHTML = '<p>Seus mais vendidos aparecerão aqui automaticamente.</p>';
    return;
  }

  els.bestsellersGrid.innerHTML = state.bestsellers.map((product) => `
    <article class="product-card">
      <div class="product-image-wrap">
        <img class="product-image" src="${product.image || '/img/banner-default.svg'}" alt="${product.name}" />
      </div>
      <div class="product-content">
        <small>${product.category || 'Sem categoria'}</small>
        <h4>${product.name}</h4>
        <p class="price-line">${isPromoProduct(product) ? `<span class="price-old">${currency(product.price)}</span>` : ''}<span class="${isPromoProduct(product) ? 'price-promo' : ''}">${currency(getProductFinalPrice(product))}</span></p>
        ${isPromoProduct(product) ? '<small class="promo-chip">Promoção</small>' : ''}
        <small>Adicionado ${product.sold_count}x ao carrinho</small>
      </div>
    </article>
  `).join('');
};

const renderCart = () => {
  if (state.cart.length === 0) {
    els.cartItems.innerHTML = '<p>Seu carrinho está vazio.</p>';
  } else {
    els.cartItems.innerHTML = state.cart.map((item) => `
      <div class="cart-row">
        <strong>${item.name}</strong>
        <p>${currency(item.price)}</p>
        <div class="qty-actions">
          <button data-action="minus" data-id="${item.productId}">-</button>
          <span>${item.quantity}</span>
          <button data-action="plus" data-id="${item.productId}">+</button>
          <button data-action="remove" data-id="${item.productId}">Remover</button>
        </div>
      </div>
    `).join('');

    els.cartItems.querySelectorAll('button').forEach((button) => {
      const id = Number(button.dataset.id);
      const action = button.dataset.action;
      button.addEventListener('click', () => {
        if (action === 'minus') changeQuantity(id, -1);
        if (action === 'plus') changeQuantity(id, 1);
        if (action === 'remove') removeItem(id);
      });
    });
  }

  const totals = getCartTotals();
  els.cartCount.textContent = String(totals.totalItems);
  els.summaryQty.textContent = String(totals.totalItems);
  els.summarySubtotal.textContent = currency(totals.subtotal);
  els.summaryTotal.textContent = currency(totals.subtotal);
};

const loadCategories = async () => {
  const res = await fetch('/api/public/categories');
  const categories = await res.json();

  categories.forEach((cat) => {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = cat.name;
    els.categoryFilter.appendChild(option);
  });
};

const loadProducts = async () => {
  const category = els.categoryFilter.value;
  const promo = els.promoFilter.value;
  const sort = els.sortFilter.value;

  const params = new URLSearchParams({
    category,
    promo,
    sort
  });

  const res = await fetch(`/api/public/products?${params.toString()}`);
  state.products = await res.json();
  renderProducts();
};

const loadBestsellers = async () => {
  const res = await fetch('/api/public/bestsellers');
  state.bestsellers = await res.json();
  renderBestsellers();
};

const renderHighlights = () => {
  if (state.highlights.length === 0) {
    els.carouselTrack.innerHTML = `
      <article class="slide active">
        <h4>Destaques</h4>
        <p>Adicione destaques reais no painel admin para aparecer aqui.</p>
      </article>
    `;
    return;
  }

  els.carouselTrack.innerHTML = state.highlights.map((item, idx) => `
    <article class="slide ${idx === 0 ? 'active' : ''}">
      <h4>${item.title}</h4>
      <p>${item.description}</p>
    </article>
  `).join('');
};

const loadHighlights = async () => {
  const res = await fetch('/api/public/highlights');
  state.highlights = await res.json();
  renderHighlights();
};

const applySettings = async () => {
  const res = await fetch('/api/public/settings');
  state.settings = await res.json();

  els.heroText.textContent = state.settings.home_hero_text || 'Elegância em cada detalhe.';
  els.heroSubtitle.textContent = state.settings.home_subtitle_text || '';
  els.heroImage.src = state.settings.home_banner_image || '/img/banner-default.svg';

  const number = (state.settings.whatsapp_number || '556195584009').replace(/\D/g, '');
  els.floatingWhatsapp.href = `https://wa.me/${number}`;
  els.instagramLink.href = state.settings.instagram_url || 'https://www.instagram.com/pratas.zoi?igsh=eXl2d3QybXlzcHIx';
};

const toggleCheckoutAddress = () => {
  const deliveryType = new FormData(els.checkoutForm).get('deliveryType');
  const addressField = els.checkoutForm.querySelector('input[name="address"]');
  addressField.required = deliveryType === 'delivery';
  if (deliveryType === 'pickup') {
    addressField.value = '';
  }
};

const submitCheckout = async (event) => {
  event.preventDefault();

  if (state.cart.length === 0) {
    alert('Seu carrinho está vazio.');
    return;
  }

  const formData = new FormData(els.checkoutForm);
  const customer = {
    fullName: String(formData.get('fullName') || '').trim(),
    phone: String(formData.get('phone') || '').trim(),
    address: String(formData.get('address') || '').trim(),
    district: String(formData.get('district') || '').trim(),
    city: String(formData.get('city') || '').trim(),
    deliveryType: String(formData.get('deliveryType') || 'delivery')
  };

  const items = state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity }));

  const response = await fetch('/api/public/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer, items })
  });

  const payload = await response.json();
  if (!response.ok) {
    alert(payload.error || 'Não foi possível finalizar pedido.');
    return;
  }

  window.open(payload.whatsappUrl, '_blank');
  state.cart = [];
  saveCart();
  renderCart();
  els.checkoutModal.classList.remove('show');
};

const openCart = () => els.cartPanel.classList.add('open');
const closeCart = () => els.cartPanel.classList.remove('open');

const setupCarousel = () => {
  if (state.carouselTimer) {
    clearInterval(state.carouselTimer);
    state.carouselTimer = null;
  }

  state.carouselIndex = 0;
  const slides = [...els.carouselTrack.querySelectorAll('.slide')];

  if (slides.length <= 1) {
    els.carouselDots.innerHTML = slides.length === 1 ? '<button class="active"></button>' : '';
    slides.forEach((slide, idx) => slide.classList.toggle('active', idx === 0));
    return;
  }

  const renderDots = () => {
    els.carouselDots.innerHTML = '';
    slides.forEach((_, idx) => {
      const dot = document.createElement('button');
      if (idx === state.carouselIndex) dot.classList.add('active');
      dot.addEventListener('click', () => {
        state.carouselIndex = idx;
        updateSlides();
      });
      els.carouselDots.appendChild(dot);
    });
  };

  const updateSlides = () => {
    slides.forEach((slide, idx) => {
      slide.classList.toggle('active', idx === state.carouselIndex);
    });
    [...els.carouselDots.children].forEach((dot, idx) => {
      dot.classList.toggle('active', idx === state.carouselIndex);
    });
  };

  const next = () => {
    state.carouselIndex = (state.carouselIndex + 1) % slides.length;
    updateSlides();
  };

  const prev = () => {
    state.carouselIndex = (state.carouselIndex - 1 + slides.length) % slides.length;
    updateSlides();
  };

  els.nextSlide.addEventListener('click', next);
  els.prevSlide.addEventListener('click', prev);

  renderDots();
  updateSlides();

  state.carouselTimer = setInterval(next, 4000);
};

const setupEvents = () => {
  els.categoryFilter.addEventListener('change', loadProducts);
  els.promoFilter.addEventListener('change', loadProducts);
  els.sortFilter.addEventListener('change', loadProducts);

  els.cartToggle.addEventListener('click', openCart);
  els.closeCart.addEventListener('click', closeCart);

  els.checkoutBtn.addEventListener('click', () => {
    if (state.cart.length === 0) {
      alert('Adicione ao menos um produto no carrinho.');
      return;
    }
    els.checkoutModal.classList.add('show');
  });

  els.cancelCheckout.addEventListener('click', () => els.checkoutModal.classList.remove('show'));
  els.checkoutForm.addEventListener('submit', submitCheckout);
  els.checkoutForm.addEventListener('change', toggleCheckoutAddress);
};

const init = async () => {
  setupEvents();
  toggleCheckoutAddress();
  renderCart();

  await applySettings();
  await loadHighlights();
  setupCarousel();
  await loadCategories();
  await loadProducts();
  await loadBestsellers();
};

init();
