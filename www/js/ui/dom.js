// Мини-UI-кит: элементы, листы (bottom sheet), формы, тосты, диалоги.

import { num } from '../core/calc.js';
import { toLocalInput, fromLocalInput } from '../core/time.js';
import { vibrate } from '../native.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, ch) {
  for (const c of ch) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const fmt = (v, d = 0) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');

// ── Тосты ──
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const host = document.getElementById('toasts');
  const t = h('div', { class: 'toast' }, h('span', null, msg));
  if (action) t.appendChild(h('button', { class: 'toast-btn', onclick: () => { onAction && onAction(); t.remove(); } }, action));
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ── Листы ──
const stack = [];
export function sheet({ title, body, actions, full = false, onClose }) {
  const back = h('div', { class: 'sheet-back' });
  const panel = h('div', { class: 'sheet' + (full ? ' full' : '') });
  const close = () => {
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    panel.classList.remove('open'); back.classList.remove('open');
    setTimeout(() => { back.remove(); panel.remove(); }, 260);
    onClose && onClose();
  };
  const api = { close, panel };
  const head = h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-grip' }), h('div', { class: 'sheet-title' }, title || ''), h('button', { class: 'icon-btn sheet-x', 'aria-label': 'Закрыть', onclick: close }, '✕'));
  const content = h('div', { class: 'sheet-body' });
  const b = typeof body === 'function' ? body(api) : body;
  if (b) append(content, [b]);
  panel.append(head, content);
  if (actions && actions.length) {
    panel.appendChild(h('div', { class: 'sheet-actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.cls || ''), onclick: async () => { const r = await a.onClick(api); if (r !== false && a.close !== false) close(); } }, a.label))));
  }
  back.addEventListener('click', close);
  document.body.append(back, panel);
  requestAnimationFrame(() => { back.classList.add('open'); panel.classList.add('open'); });
  stack.push(api);
  api.content = content;
  return api;
}
export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export function confirmDialog(text, { ok = 'Да', cancel = 'Отмена', danger = false, title = 'Подтверждение' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    sheet({ title, body: h('p', { class: 'muted pre' }, text), onClose: () => fin(false),
      actions: [{ label: cancel, cls: 'ghost', onClick: () => fin(false) }, { label: ok, cls: danger ? 'danger' : 'primary', onClick: () => fin(true) }] });
  });
}

export function info(title, text) {
  sheet({ title, body: h('div', { class: 'pre muted' }, text), actions: [{ label: 'Понятно', cls: 'primary', onClick: () => {} }] });
}

// ── Формы ──
/**
 * fields: [{name, label, type, ...}]
 * type: text|textarea|number|select|date|time|datetime|check|scale|chips|seg|color|days|section|hint
 */
export function buildForm(fields, values = {}) {
  const refs = {};
  const node = h('div', { class: 'form' });
  for (const f of fields) {
    if (f.type === 'section') { node.appendChild(h('div', { class: 'form-section' }, f.label)); continue; }
    if (f.type === 'hint') { node.appendChild(h('div', { class: 'hint' }, f.label)); continue; }
    if (f.type === 'custom') { node.appendChild(f.render(values)); continue; }
    const v = values[f.name] !== undefined ? values[f.name] : f.value;
    let input;
    const err = h('div', { class: 'field-err' });
    switch (f.type) {
      case 'textarea': input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' }); input.value = v ?? ''; break;
      case 'select': input = h('select', null, (f.options || []).map((o) => h('option', { value: o.value }, o.label))); input.value = v ?? (f.options[0] && f.options[0].value); break;
      case 'date': input = h('input', { type: 'date' }); input.value = v || ''; break;
      case 'time': input = h('input', { type: 'time' }); input.value = v || ''; break;
      case 'datetime': input = h('input', { type: 'datetime-local' }); input.value = v ? toLocalInput(v) : ''; input._orig = v; input._origStr = input.value; break;
      case 'check': input = h('input', { type: 'checkbox', class: 'switch' }); input.checked = !!v; break;
      case 'number': input = h('input', { type: 'text', inputmode: 'decimal', placeholder: f.placeholder || '', autocomplete: 'off' }); input.value = v ?? ''; break;
      case 'scale': input = scale(f, v); break;
      case 'chips': input = chips(f.options, v || [], f.multi !== false, f.allowAdd); break;
      case 'seg': input = seg(f.options, v ?? (f.options[0] && f.options[0].value)); break;
      case 'days': input = chips([1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][d] })), v || [], true); break;
      case 'color': input = h('input', { type: 'color' }); input.value = v || '#7c6cff'; break;
      default: input = h('input', { type: 'text', placeholder: f.placeholder || '', autocomplete: 'off' }); input.value = v ?? '';
    }
    refs[f.name] = { f, input, err };
    const wrap = f.type === 'check'
      ? h('label', { class: 'field field-check' }, h('span', null, f.label, f.help ? h('small', { class: 'muted block' }, f.help) : null), input)
      : h('label', { class: 'field' + (f.half ? ' half' : '') }, h('span', { class: 'field-label' }, f.label, f.unit ? h('small', { class: 'muted' }, ' · ' + f.unit) : null), input, f.help ? h('small', { class: 'muted' }, f.help) : null, err);
    if (f.onInput) input.addEventListener('input', () => f.onInput(read().values, refs));
    node.appendChild(wrap);
  }
  // группировка половинок в строки
  const children = [...node.children];
  for (let i = 0; i < children.length - 1; i++) {
    if (children[i].classList.contains('half') && children[i + 1].classList.contains('half')) {
      const row = h('div', { class: 'form-row' });
      node.insertBefore(row, children[i]);
      row.append(children[i], children[i + 1]);
      i++;
    }
  }
  function read() {
    const out = {}; let ok = true;
    for (const [name, { f, input, err }] of Object.entries(refs)) {
      err.textContent = '';
      let val;
      switch (f.type) {
        case 'check': val = input.checked; break;
        case 'number': {
          const r = num(input.value, { min: f.min, max: f.max, required: f.required });
          if (!r.ok) { ok = false; err.textContent = r.error; }
          val = r.value; break;
        }
        case 'datetime': val = input.value && input.value === input._origStr ? input._orig : fromLocalInput(input.value); /* без изменений — точное исходное время */ if (f.required && !val) { ok = false; err.textContent = 'Укажите дату и время'; } break;
        case 'scale': case 'chips': case 'seg': case 'days': val = input.getValue(); break;
        default: val = input.value.trim ? input.value.trim() : input.value;
          if (f.required && !val) { ok = false; err.textContent = 'Заполните поле'; }
      }
      if (ok && f.validate) { const e = f.validate(val, out); if (e) { ok = false; err.textContent = e; } }
      out[name] = val;
    }
    return { ok, values: out };
  }
  return { node, read, refs };
}

function scale(f, v) {
  const min = f.min ?? 1, max = f.max ?? 5;
  let cur = v ?? null;
  const box = h('div', { class: 'scale' });
  const btns = [];
  for (let i = min; i <= max; i++) {
    const b = h('button', { type: 'button', class: 'scale-btn', onclick: (e) => { e.preventDefault(); cur = cur === i ? null : i; paint(); vibrate(8); } }, f.labels ? f.labels[i - min] : String(i));
    btns.push(b); box.appendChild(b);
  }
  const paint = () => btns.forEach((b, i) => b.classList.toggle('on', cur === min + i));
  paint();
  box.getValue = () => cur;
  if (f.captions) box.appendChild(h('div', { class: 'scale-cap' }, h('span', null, f.captions[0]), h('span', null, f.captions[1])));
  return box;
}

export function chips(options, values, multi = true, allowAdd = false) {
  let cur = multi ? [...values] : values;
  const box = h('div', { class: 'chips' });
  const render = () => {
    box.innerHTML = '';
    for (const o of options) {
      const val = o.value ?? o, label = o.label ?? o;
      const on = multi ? cur.includes(val) : cur === val;
      box.appendChild(h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), onclick: (e) => {
        e.preventDefault();
        if (multi) cur = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val]; else cur = val;
        render(); vibrate(6);
      } }, label));
    }
    if (allowAdd) {
      box.appendChild(h('button', { type: 'button', class: 'chip add', onclick: (e) => {
        e.preventDefault();
        const t = prompt('Новый вариант');
        if (t && t.trim()) { options.push(t.trim()); if (multi) cur.push(t.trim()); else cur = t.trim(); render(); }
      } }, '＋'));
    }
  };
  render();
  box.getValue = () => cur;
  return box;
}

export function seg(options, value, onChange) {
  let cur = value;
  const box = h('div', { class: 'seg' });
  const render = () => {
    box.innerHTML = '';
    for (const o of options) box.appendChild(h('button', { type: 'button', class: cur === o.value ? 'on' : '', onclick: (e) => { e.preventDefault(); cur = o.value; render(); onChange && onChange(cur); } }, o.label));
  };
  render();
  box.getValue = () => cur;
  return box;
}

/** Лист с формой. onSave(values) может вернуть строку-ошибку или false, чтобы не закрывать. */
export function formSheet({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Сохранить', extra }) {
  const form = buildForm(fields, values);
  const actions = [];
  if (onDelete) actions.push({ label: 'Удалить', cls: 'danger ghost', onClick: async () => { if (await confirmDialog('Удалить запись? Это действие нельзя отменить.', { danger: true, ok: 'Удалить' })) { await onDelete(); return true; } return false; } });
  actions.push({ label: saveLabel, cls: 'primary', onClick: async () => {
    const r = form.read();
    if (!r.ok) { toast('Проверьте поля формы'); return false; }
    const res = await onSave(r.values);
    if (typeof res === 'string') { toast(res); return false; }
    return res !== false;
  } });
  return sheet({ title, body: h('div', null, form.node, extra || null), actions });
}

// ── Визуальные элементы ──
export function ring(value, { size = 64, stroke = 7, color = 'var(--accent)', label = '', sub = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return h('div', { class: 'ring', style: { width: size + 'px', height: size + 'px' } },
    s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': stroke }),
      s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * v} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-arc' })),
    h('div', { class: 'ring-label' }, h('b', null, label), sub ? h('small', null, sub) : null));
}
export function bar(value, color = 'var(--accent)', over = false) {
  const v = Math.max(0, Math.min(1, value || 0));
  return h('div', { class: 'bar' + (over ? ' over' : '') }, h('div', { class: 'bar-fill', style: { width: v * 100 + '%', background: color } }));
}
export function empty(text, btn) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, '∅'), h('p', null, text), btn || null);
}
export function card(title, body, { action, onTitle, cls = '' } = {}) {
  return h('section', { class: 'card ' + cls },
    title ? h('div', { class: 'card-head', onclick: onTitle || null }, h('h3', null, title), action || null) : null,
    body);
}
export function row(left, right, { onclick, sub, icon } = {}) {
  return h('div', { class: 'row' + (onclick ? ' tap' : ''), onclick },
    icon ? h('div', { class: 'row-ico' }, icon) : null,
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, left), sub ? h('div', { class: 'row-sub' }, sub) : null),
    right != null ? h('div', { class: 'row-right' }, right) : null);
}
export function btn(label, onclick, cls = '') { return h('button', { class: 'btn ' + cls, onclick }, label); }
export function pageHeader(title, { back, actions } = {}) {
  return h('header', { class: 'page-head' },
    back ? h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => history.back() }, '‹') : null,
    h('h1', null, title),
    h('div', { class: 'page-head-actions' }, actions || null));
}
export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs' }, items.map((it) => h('button', { class: it.id === active ? 'on' : '', onclick: () => onChange(it.id) }, it.label)));
}

/** Перерисовать текущий экран (смена вкладки и т.п.). */
export function refresh(keepScroll = true) { window.dispatchEvent(new CustomEvent('lifeos-refresh', { detail: { keepScroll } })); }
export function go(hash) { location.hash = hash; }
