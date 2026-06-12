// ── TOAST ──────────────────────────────────────────────────
function toast(msg, dur=2500) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity = '0', dur);
}

// ── MODAL ──────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-close,[data-close]').forEach(b => {
    b.addEventListener('click', () => closeModal(b.dataset.close || b.closest('.moverlay')?.id));
  });
  document.querySelectorAll('.moverlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
  });
});

// ── API HELPERS ────────────────────────────────────────────
async function api(path, method='GET', body=null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

// ── COPY TO CLIPBOARD ──────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast('✅ Copié !');
}

// ── ACTIVE NAV ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-item[data-href]').forEach(el => {
    if (el.dataset.href === path || (path.startsWith(el.dataset.href) && el.dataset.href !== '/')) {
      el.classList.add('active');
    }
    el.addEventListener('click', () => window.location.href = el.dataset.href);
  });
});
