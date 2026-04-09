/* ═══════════════════════════════════════════════════════════════
   PÜR Nootropics — CRM Frontend
═══════════════════════════════════════════════════════════════ */

// Estado del modal: alerta activa
let alertaActiva = null;

document.addEventListener('DOMContentLoaded', () => {
  loadAlertas();
  document.getElementById('crmRefreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('crmRefreshBtn');
    btn.classList.add('spinning');
    loadAlertas().finally(() => btn.classList.remove('spinning'));
  });
  setupModal();
});

// ─── Cargar alertas ────────────────────────────────────────────
async function loadAlertas() {
  show('crmLoading');
  hide('crmError');
  hide('crmContent');

  try {
    const res = await fetch('/api/crm/alertas');
    const json = await res.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    renderAlertas(json);
    show('crmContent');
    const ts = new Date(json.fetched_at);
    document.getElementById('crmUpdated').textContent =
      `Actualizado ${ts.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    console.error('CRM error:', err);
    document.getElementById('crmErrorMsg').textContent = err.message;
    show('crmError');
  } finally {
    hide('crmLoading');
  }
}

// ─── Render ────────────────────────────────────────────────────
function renderAlertas(data) {
  const { resumen, carritos_abandonados, pagos_pendientes, cancelaciones } = data;

  // Header badges
  document.getElementById('crmBadges').innerHTML = `
    <span class="crm-badge crm-badge--yellow" title="Carritos abandonados">${resumen.carritos}</span>
    <span class="crm-badge crm-badge--orange" title="Pagos pendientes">${resumen.pagos}</span>
    <span class="crm-badge crm-badge--red"    title="Cancelaciones">${resumen.cancelaciones}</span>
  `;

  // Section badges
  document.getElementById('badgeCarritos').textContent      = resumen.carritos;
  document.getElementById('badgePagos').textContent         = resumen.pagos;
  document.getElementById('badgeCancelaciones').textContent = resumen.cancelaciones;

  renderCards('cardsCarritos',      carritos_abandonados, 'carrito',     'Sin carritos abandonados en las últimas 72hs.');
  renderCards('cardsPagos',         pagos_pendientes,     'pago',        'Sin pagos pendientes de más de 24hs.');
  renderCards('cardsCancelaciones', cancelaciones,        'cancelacion', 'Sin cancelaciones recientes.');
}

function renderCards(containerId, alertas, tipo, emptyMsg) {
  const container = document.getElementById(containerId);
  if (!alertas || !alertas.length) {
    container.innerHTML = `<div class="crm-empty">${emptyMsg}</div>`;
    return;
  }

  container.innerHTML = alertas.map((a, idx) => buildCard(a, tipo, idx)).join('');

  // Attach listeners
  alertas.forEach((a, idx) => {
    const btnId = `btn-gen-${tipo}-${idx}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => openModal(a));
    }
  });
}

function buildCard(a, tipo, idx) {
  const productosStr = (a.productos || [])
    .map((p) => `${p.nombre} ×${p.cantidad}`)
    .join(' · ');

  const totalFmt = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: a.moneda || 'ARS',
    minimumFractionDigits: 0,
  }).format(a.total);

  const emailHtml = a.email
    ? `<span class="crm-contact-item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        ${escHtml(a.email)}
      </span>`
    : '';

  const phoneHtml = a.telefono
    ? `<span class="crm-contact-item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6 6l1.06-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        ${escHtml(a.telefono)}
      </span>`
    : '';

  return `
    <div class="crm-card">
      <div class="crm-card-left">
        <div class="crm-card-row1">
          <span class="crm-client-name">${escHtml(a.cliente)}</span>
          <span class="crm-time-badge">${escHtml(a.hace)}</span>
          <span class="crm-order-num">#${a.numero}</span>
        </div>
        <div class="crm-card-row2">
          <span class="crm-total">${totalFmt}</span>
          <div class="crm-contact">
            ${emailHtml}
            ${phoneHtml}
          </div>
        </div>
        <div class="crm-productos" title="${escHtml(productosStr)}">${escHtml(productosStr) || '—'}</div>
      </div>
      <div class="crm-card-actions">
        <button class="crm-btn crm-btn--generate" id="btn-gen-${tipo}-${idx}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
          Generar mensaje
        </button>
      </div>
    </div>
  `;
}

// ─── Modal ─────────────────────────────────────────────────────
function setupModal() {
  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
  document.getElementById('crmModalOverlay') && document.getElementById('crmModalOverlay').addEventListener('click', closeModal);

  // Close on overlay click
  document.getElementById('msgModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('msgModal')) closeModal();
  });

  document.getElementById('btnCopyMsg').addEventListener('click', () => {
    const txt = document.getElementById('msgTexto').value;
    navigator.clipboard.writeText(txt).then(() => {
      const btn = document.getElementById('btnCopyMsg');
      const orig = btn.innerHTML;
      btn.textContent = '¡Copiado!';
      setTimeout(() => (btn.innerHTML = orig), 1800);
    });
  });

  document.getElementById('btnRegenerar').addEventListener('click', () => {
    if (alertaActiva) generarMensaje(alertaActiva);
  });

  document.getElementById('btnWhatsapp').addEventListener('click', () => {
    const msg = document.getElementById('msgTexto').value;
    if (!msg || !alertaActiva?.telefono) return;
    const tel = alertaActiva.telefono.replace(/\D/g, '');
    const url = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  });
}

function openModal(alerta) {
  alertaActiva = alerta;
  document.getElementById('msgModal').style.display = 'flex';
  generarMensaje(alerta);
}

function closeModal() {
  document.getElementById('msgModal').style.display = 'none';
  alertaActiva = null;
}

async function generarMensaje(alerta) {
  // Reset modal state
  show('msgLoading');
  hide('msgTexto');
  hide('msgError');
  hide('msgFooter');
  document.getElementById('msgTexto').value = '';

  // Show/hide WhatsApp button based on phone availability
  const btnWa = document.getElementById('btnWhatsapp');
  btnWa.style.display = alerta.telefono ? 'inline-flex' : 'none';

  try {
    const res = await fetch('/api/crm/mensaje', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerta }),
    });
    const json = await res.json();

    if (json.error) throw new Error(json.error);

    document.getElementById('msgTexto').value = json.mensaje;
    hide('msgLoading');
    show('msgTexto');
    show('msgFooter');
  } catch (err) {
    hide('msgLoading');
    document.getElementById('msgError').textContent = 'Error: ' + err.message;
    show('msgError');
    show('msgFooter');
  }
}

// ─── Utils ─────────────────────────────────────────────────────
function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
