const state = {
  categories: [],
  products: [],
  settings: {},
  highlights: []
};

const els = {
  loginSection: document.getElementById('loginSection'),
  dashboardSection: document.getElementById('dashboardSection'),
  loginForm: document.getElementById('loginForm'),
  logoutBtn: document.getElementById('logoutBtn'),
  categoryForm: document.getElementById('categoryForm'),
  categoryList: document.getElementById('categoryList'),
  productForm: document.getElementById('productForm'),
  resetProductForm: document.getElementById('resetProductForm'),
  productIsPromo: document.getElementById('productIsPromo'),
  productPromoPrice: document.getElementById('productPromoPrice'),
  productCategory: document.getElementById('productCategory'),
  productList: document.getElementById('productList'),
  settingsForm: document.getElementById('settingsForm'),
  highlightForm: document.getElementById('highlightForm'),
  resetHighlightForm: document.getElementById('resetHighlightForm'),
  highlightList: document.getElementById('highlightList'),
  passwordForm: document.getElementById('passwordForm'),
  exportBtn: document.getElementById('exportBtn'),
  reportGrid: document.getElementById('reportGrid')
};

const money = (value) => `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;

const getFinalPrice = (product) => {
  const promo = Number(product.is_promo) === 1 && Number(product.promo_price) > 0;
  return promo ? Number(product.promo_price) : Number(product.price);
};

const checkAuth = async () => {
  const res = await fetch('/api/admin/me');
  if (res.ok) {
    showDashboard();
    await loadAllData();
  } else {
    showLogin();
  }
};

const showDashboard = () => {
  els.loginSection.classList.add('hidden');
  els.dashboardSection.classList.remove('hidden');
};

const showLogin = () => {
  els.dashboardSection.classList.add('hidden');
  els.loginSection.classList.remove('hidden');
};

const authFetch = async (url, options = {}) => {
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLogin();
    throw new Error('Não autenticado');
  }
  return res;
};

const renderCategories = () => {
  els.productCategory.innerHTML = '<option value="">Sem categoria</option>';
  state.categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    els.productCategory.appendChild(opt);
  });

  if (state.categories.length === 0) {
    els.categoryList.innerHTML = '<li class="list-item">Nenhuma categoria cadastrada.</li>';
    return;
  }

  els.categoryList.innerHTML = state.categories.map((cat) => `
    <li class="list-item">
      <span>${cat.name}</span>
      <div>
        <button class="btn btn-outline" data-action="edit" data-id="${cat.id}">Editar</button>
        <button class="btn btn-outline" data-action="delete" data-id="${cat.id}">Excluir</button>
      </div>
    </li>
  `).join('');

  els.categoryList.querySelectorAll('button').forEach((button) => {
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    button.addEventListener('click', async () => {
      if (action === 'delete') {
        if (!confirm('Excluir categoria?')) return;
        await authFetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
        await loadCategories();
        await loadProducts();
        return;
      }

      const item = state.categories.find((cat) => cat.id === id);
      const nextName = prompt('Novo nome da categoria:', item?.name || '');
      if (!nextName) return;

      await authFetch(`/api/admin/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName })
      });
      await loadCategories();
    });
  });
};

const renderProducts = () => {
  if (state.products.length === 0) {
    els.productList.innerHTML = '<div class="list-item">Nenhum produto cadastrado.</div>';
    return;
  }

  els.productList.innerHTML = state.products.map((product) => {
    const gallery = (product.images || []).map((img) => `
      <div>
        <img src="${img.image_path}" alt="${product.name}" />
        <button class="btn btn-outline" data-action="delete-image" data-product="${product.id}" data-image="${img.id}">x</button>
      </div>
    `).join('');

    return `
      <article class="list-item">
        <div>
          <strong>${product.name}</strong>
          <p>${money(getFinalPrice(product))}${Number(product.is_promo) === 1 && Number(product.promo_price) > 0 ? ` <small>(de ${money(product.price)})</small>` : ''} | ${product.category_name || 'Sem categoria'} | ${product.status === 'available' ? 'Disponível' : 'Indisponível'}${Number(product.is_promo) === 1 && Number(product.promo_price) > 0 ? ' | Em promoção' : ''}</p>
          <p>Estoque: ${product.stock} | Adicionado ao carrinho: ${product.sold_count}x</p>
          <div class="gallery">${gallery}</div>
        </div>
        <div>
          <button class="btn btn-outline" data-action="edit-product" data-id="${product.id}">Editar</button>
          <button class="btn btn-outline" data-action="delete-product" data-id="${product.id}">Excluir</button>
        </div>
      </article>
    `;
  }).join('');

  els.productList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const id = Number(button.dataset.id);

      if (action === 'edit-product') {
        fillProductForm(id);
        return;
      }

      if (action === 'delete-product') {
        if (!confirm('Excluir produto?')) return;
        await authFetch(`/api/admin/products/${id}`, { method: 'DELETE' });
        await loadProducts();
        await loadReport();
        return;
      }

      if (action === 'delete-image') {
        const productId = Number(button.dataset.product);
        const imageId = Number(button.dataset.image);
        await authFetch(`/api/admin/products/${productId}/images/${imageId}`, { method: 'DELETE' });
        await loadProducts();
      }
    });
  });
};

const renderSettings = () => {
  const form = els.settingsForm;
  form.whatsapp_number.value = state.settings.whatsapp_number || '556195584009';
  form.instagram_url.value = state.settings.instagram_url || '';
  form.home_hero_text.value = state.settings.home_hero_text || '';
  form.home_subtitle_text.value = state.settings.home_subtitle_text || '';
  form.whatsapp_message_footer.value = state.settings.whatsapp_message_footer || '';
};

const renderReport = (report) => {
  els.reportGrid.innerHTML = `
    <article class="report-card"><small>Total de produtos</small><h3>${report.totalProducts}</h3></article>
    <article class="report-card"><small>Disponíveis</small><h3>${report.availableProducts}</h3></article>
    <article class="report-card"><small>Indisponíveis</small><h3>${report.unavailableProducts}</h3></article>
    <article class="report-card"><small>Valor médio</small><h3>${money(report.averagePrice)}</h3></article>
  `;
};

const renderHighlights = () => {
  if (state.highlights.length === 0) {
    els.highlightList.innerHTML = '<div class="list-item">Nenhum destaque cadastrado.</div>';
    return;
  }

  els.highlightList.innerHTML = state.highlights.map((item) => `
    <article class="list-item">
      <div>
        <strong>${item.title}</strong>
        <p>${item.description}</p>
        <small>Ordem: ${item.sort_order} | ${item.is_active ? 'Ativo' : 'Inativo'}</small>
      </div>
      <div>
        <button class="btn btn-outline" data-action="edit-highlight" data-id="${item.id}">Editar</button>
        <button class="btn btn-outline" data-action="delete-highlight" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `).join('');

  els.highlightList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const id = Number(button.dataset.id);

      if (action === 'edit-highlight') {
        const item = state.highlights.find((h) => h.id === id);
        if (!item) return;
        els.highlightForm.elements.namedItem('id').value = item.id;
        els.highlightForm.elements.namedItem('title').value = item.title;
        els.highlightForm.elements.namedItem('description').value = item.description;
        els.highlightForm.elements.namedItem('sort_order').value = item.sort_order;
        els.highlightForm.elements.namedItem('is_active').value = String(item.is_active);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (action === 'delete-highlight') {
        if (!confirm('Excluir destaque?')) return;
        await authFetch(`/api/admin/highlights/${id}`, { method: 'DELETE' });
        await loadHighlights();
      }
    });
  });
};

const fillProductForm = (id) => {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  const form = els.productForm;
  form.id.value = product.id;
  form.name.value = product.name;
  form.categoryId.value = product.category_id || '';
  form.price.value = product.price;
  form.isPromo.value = String(Number(product.is_promo) === 1 ? 1 : 0);
  form.promoPrice.value = Number(product.is_promo) === 1 && Number(product.promo_price) > 0 ? product.promo_price : '';
  form.stock.value = product.stock;
  form.status.value = product.status;
  form.description.value = product.description || '';
  togglePromoPriceField();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const resetProductForm = () => {
  els.productForm.reset();
  els.productForm.id.value = '';
  els.productForm.isPromo.value = '0';
  els.productForm.promoPrice.value = '';
  togglePromoPriceField();
};

const togglePromoPriceField = () => {
  const isPromo = String(els.productIsPromo.value) === '1';
  els.productPromoPrice.required = isPromo;
  els.productPromoPrice.disabled = !isPromo;
  if (!isPromo) {
    els.productPromoPrice.value = '';
  }
};

const loadCategories = async () => {
  const res = await authFetch('/api/admin/categories');
  state.categories = await res.json();
  renderCategories();
};

const loadProducts = async () => {
  const res = await authFetch('/api/admin/products');
  state.products = await res.json();
  renderProducts();
};

const loadSettings = async () => {
  const res = await authFetch('/api/admin/settings');
  state.settings = await res.json();
  renderSettings();
};

const loadReport = async () => {
  const res = await authFetch('/api/admin/report');
  const report = await res.json();
  renderReport(report);
};

const loadHighlights = async () => {
  const res = await authFetch('/api/admin/highlights');
  state.highlights = await res.json();
  renderHighlights();
};

const loadAllData = async () => {
  await loadCategories();
  await loadProducts();
  await loadSettings();
  await loadReport();
  await loadHighlights();
};

const resetHighlightForm = () => {
  els.highlightForm.reset();
  els.highlightForm.elements.namedItem('id').value = '';
  els.highlightForm.elements.namedItem('sort_order').value = '0';
  els.highlightForm.elements.namedItem('is_active').value = '1';
};

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.loginForm);

  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: formData.get('username'),
      password: formData.get('password')
    })
  });

  const payload = await res.json();
  if (!res.ok) {
    alert(payload.error || 'Erro ao autenticar.');
    return;
  }

  showDashboard();
  await loadAllData();
});

els.logoutBtn.addEventListener('click', async () => {
  await authFetch('/api/admin/logout', { method: 'POST' });
  showLogin();
});

els.categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.categoryForm);

  const res = await authFetch('/api/admin/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: formData.get('name') })
  });

  const payload = await res.json();
  if (!res.ok) {
    alert(payload.error || 'Erro ao salvar categoria.');
    return;
  }

  els.categoryForm.reset();
  await loadCategories();
});

els.productForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(els.productForm);
  const id = formData.get('id');
  const isPromo = String(formData.get('isPromo') || '0') === '1';
  const price = Number(formData.get('price') || 0);
  const promoPrice = Number(formData.get('promoPrice') || 0);

  if (isPromo && (!Number.isFinite(promoPrice) || promoPrice <= 0 || promoPrice >= price)) {
    alert('Preço promocional deve ser maior que zero e menor que o preço normal.');
    return;
  }

  const url = id ? `/api/admin/products/${id}` : '/api/admin/products';
  const method = id ? 'PUT' : 'POST';

  const res = await authFetch(url, {
    method,
    body: formData
  });

  const payload = await res.json();
  if (!res.ok) {
    alert(payload.error || 'Erro ao salvar produto.');
    return;
  }

  resetProductForm();
  await loadProducts();
  await loadReport();
});

els.resetProductForm.addEventListener('click', resetProductForm);
els.productIsPromo.addEventListener('change', togglePromoPriceField);

els.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(els.settingsForm);
  const payload = {
    whatsapp_number: formData.get('whatsapp_number'),
    instagram_url: formData.get('instagram_url'),
    home_hero_text: formData.get('home_hero_text'),
    home_subtitle_text: formData.get('home_subtitle_text'),
    whatsapp_message_footer: formData.get('whatsapp_message_footer')
  };

  const saveRes = await authFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!saveRes.ok) {
    const err = await saveRes.json();
    alert(err.error || 'Erro ao salvar configurações.');
    return;
  }

  const banner = formData.get('banner');
  if (banner && banner.size > 0) {
    const bannerForm = new FormData();
    bannerForm.append('banner', banner);
    const bannerRes = await authFetch('/api/admin/settings/banner', {
      method: 'POST',
      body: bannerForm
    });

    if (!bannerRes.ok) {
      const err = await bannerRes.json();
      alert(err.error || 'Erro ao atualizar banner.');
      return;
    }
  }

  alert('Configurações salvas com sucesso!');
  await loadSettings();
});

els.highlightForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.highlightForm);

  const id = formData.get('id');
  const payload = {
    title: formData.get('title'),
    description: formData.get('description'),
    sort_order: Number(formData.get('sort_order') || 0),
    is_active: Number(formData.get('is_active') || 1)
  };

  const res = await authFetch(id ? `/api/admin/highlights/${id}` : '/api/admin/highlights', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const responsePayload = await res.json();
  if (!res.ok) {
    alert(responsePayload.error || 'Erro ao salvar destaque.');
    return;
  }

  resetHighlightForm();
  await loadHighlights();
});

els.resetHighlightForm.addEventListener('click', resetHighlightForm);

els.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.passwordForm);

  const res = await authFetch('/api/admin/change-password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword')
    })
  });

  const payload = await res.json();
  if (!res.ok) {
    alert(payload.error || 'Erro ao alterar senha.');
    return;
  }

  els.passwordForm.reset();
  alert('Senha alterada com sucesso.');
});

els.exportBtn.addEventListener('click', () => {
  window.open('/api/admin/export/products', '_blank');
});

checkAuth();
togglePromoPriceField();
