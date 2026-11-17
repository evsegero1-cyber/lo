import { S, uid } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, fmt, empty, refresh, confirmDialog } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { fmtDateTime, fmtDateShort, dateKey, tsToHm } from '../core/time.js';
import { pickImage } from '../native.js';

let tab = 'records';
const REC_T = { exam: '🩺 Обследование', lab: '🧪 Анализы', conclusion: '📄 Заключение врача', visit: '👨‍⚕️ Визит к врачу', note: '📝 Заметка' };

function recordEdit(l) {
  const isNew = !l;
  l = l ? { ...l, blobs: [...(l.blobs || [])] } : { kind: 'medrecord', type: 'visit', blobs: [] };
  const photos = h('div', { class: 'photo-grid mt' });
  const drawPh = () => {
    photos.replaceChildren(...l.blobs.map((b, i) => { const img = h('img'); S.getBlob(b).then((d) => { if (d) img.src = d; }); return h('div', { onclick: async () => { if (await confirmDialog('Убрать это фото из записи?')) { l.blobs.splice(i, 1); await S.delBlob(b); drawPh(); } } }, img); }));
  };
  drawPh();
  formSheet({ title: isNew ? 'Новая запись' : 'Запись', fields: [
    { name: 'type', label: 'Тип', type: 'select', options: Object.entries(REC_T).map(([v, x]) => ({ value: v, label: x })), value: l.type },
    { name: 'title', label: 'Название', required: true, value: l.title, placeholder: 'например: общий анализ крови, терапевт' },
    { name: 'doctor', label: 'Врач / клиника', value: l.doctor },
    { name: 'text', label: 'Результаты, заключение, рекомендации', type: 'textarea', rows: 6, value: l.text },
    { name: 'ts', label: 'Дата', type: 'datetime', value: l.ts || Date.now() },
  ], extra: h('div', null, btn('📷 Прикрепить фото документа', async () => { const d = await pickImage(1600, 0.85); if (d) { l.blobs.push(await S.putBlob(d)); drawPh(); } }, 'small mt'), photos),
  onSave: (v) => S.putLog({ ...l, ...v }), onDelete: isNew ? null : () => S.delLog(l.id) });
}
function recordView(l) {
  const photos = h('div', { class: 'list-gap mt' });
  for (const b of l.blobs || []) { const img = h('img', { style: { width: '100%', borderRadius: '12px' } }); S.getBlob(b).then((d) => { if (d) img.src = d; }); photos.appendChild(img); }
  sheet({ title: l.title, full: true, body: h('div', null, h('div', { class: 'muted small' }, `${REC_T[l.type] || ''} · ${fmtDateTime(l.ts)}${l.doctor ? ' · ' + l.doctor : ''}`), h('p', { class: 'pre' }, l.text || ''), photos), actions: [{ label: 'Изменить', onClick: () => recordEdit(l) }] });
}

function recordsTab() {
  const logs = S.logs('medrecord').slice().reverse();
  return h('div', null, btn('＋ Новая запись', () => recordEdit(null), 'primary wide mb'),
    logs.length ? card(null, h('div', null, logs.map((l) => row(l.title, fmtDateShort(dateKey(l.ts)), { icon: (REC_T[l.type] || '📝').split(' ')[0], sub: [l.doctor, (l.blobs || []).length ? `📎 ${l.blobs.length}` : null].filter(Boolean).join(' · ') || null, onclick: () => recordView(l) })))) : empty('Здесь можно хранить обследования, анализы, заключения и визиты к врачам.'));
}

// ── Лекарства ──
export function medEdit(m) {
  const isNew = !m;
  m = m || { kind: 'med', times: [], remind: false };
  formSheet({ title: isNew ? 'Препарат' : m.name, fields: [
    { type: 'hint', label: 'Записывайте только назначенные врачом препараты и дозировки. LIFE OS не назначает лекарства.' },
    { name: 'name', label: 'Название', required: true, value: m.name },
    { name: 'dose', label: 'Доза (как назначено)', value: m.dose, placeholder: 'например: 1 таблетка 500 мг' },
    { name: 'times', label: 'Время приёма (через запятую, ЧЧ:ММ)', value: (m.times || []).join(', '), placeholder: '16:00, 02:00' },
    { name: 'remind', label: 'Напоминать о приёме', type: 'check', value: m.remind, help: 'Отмечаются как важные: приходят в режиме «только важные».' },
    { name: 'doctor', label: 'Кто назначил', value: m.doctor, half: true },
    { name: 'until', label: 'До даты', type: 'date', value: m.until, half: true },
    { name: 'note', label: 'Заметка', type: 'textarea', rows: 2, value: m.note },
    ...(isNew ? [] : [{ name: 'archived', label: 'Курс завершён (в архив)', type: 'check', value: m.archived }]),
  ], onSave: async (v) => {
    const times = String(v.times || '').split(/[,;\s]+/).filter(Boolean);
    if (times.some((t) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) return 'Время в формате ЧЧ:ММ, например 16:00';
    if (v.remind && !times.length) return 'Для напоминаний укажите время приёма';
    await S.putDef({ ...m, ...v, times: times.map((t) => t.padStart(5, '0')) });
  }, onDelete: isNew ? null : () => S.delDef(m.id) });
}
export async function takeMed(m) {
  const l = await S.putLog({ kind: 'medintake', ref: m.id, dose: m.dose });
  toast(`Принято: ${m.name}`, { action: 'Отменить', onAction: () => S.delLog(l.id) });
}
export function medsToday() {
  const key = S.cur().key;
  return S.defs('med').filter((m) => !m.archived && (!m.until || m.until >= key)).map((m) => ({ m, taken: S.inDay('medintake', key, m.id), need: (m.times || []).length || 1 }));
}
function medsTab() {
  const list = S.defs('med');
  const today = medsToday();
  const log = S.logs('medintake').slice(-40).reverse();
  return h('div', null, btn('＋ Препарат', () => medEdit(null), 'primary wide mb'),
    today.length ? card('Текущий личный день', h('div', null, today.map(({ m, taken, need }) => row(m.name, h('button', { class: 'btn small ' + (taken.length >= need ? '' : 'primary'), onclick: (e) => { e.stopPropagation(); takeMed(m); } }, taken.length >= need ? `✓ ${taken.length}/${need}` : `Принял ${taken.length}/${need}`), { icon: '💊', sub: [m.dose, (m.times || []).join(', ')].filter(Boolean).join(' · '), onclick: () => medEdit(m) })))) : null,
    list.filter((m) => m.archived).length ? card('Завершённые курсы', h('div', null, list.filter((m) => m.archived).map((m) => row(m.name, '›', { sub: m.dose, onclick: () => medEdit(m) })))) : null,
    card('История приёма', log.length ? h('div', null, log.map((l) => row((S.def(l.ref) || { name: 'удалённый препарат' }).name, fmtDateTime(l.ts), { sub: l.dose, onclick: () => formSheet({ title: 'Приём', fields: [{ name: 'ts', label: 'Когда', type: 'datetime', value: l.ts }, { name: 'dose', label: 'Доза', value: l.dose }], onSave: (v) => S.putLog({ ...l, ...v }), onDelete: () => S.delLog(l.id) }) }))) : empty('Нет записей')),
    list.length ? null : empty('Препараты не добавлены'));
}

// ── Аллергии и противопоказания ──
function allergyEdit(a) {
  const isNew = !a;
  formSheet({ title: isNew ? 'Новая запись' : a.name, fields: [
    { name: 'type', label: 'Тип', type: 'select', options: [{ value: 'allergy', label: 'Аллергия / непереносимость' }, { value: 'contra', label: 'Противопоказание' }], value: a ? a.type : 'allergy' },
    { name: 'name', label: 'На что / что именно', required: true, value: a && a.name },
    { name: 'reaction', label: 'Реакция / пояснение', type: 'textarea', rows: 2, value: a && a.reaction },
    { name: 'source', label: 'Источник (врач, анализ)', value: a && a.source },
  ], onSave: (v) => S.putDef({ ...(a || { kind: 'allergy' }), ...v }), onDelete: isNew ? null : () => S.delDef(a.id) });
}
function allergyTab() {
  const list = S.defs('allergy');
  return h('div', null, btn('＋ Добавить', () => allergyEdit(null), 'primary wide mb'),
    ['allergy', 'contra'].map((t) => { const arr = list.filter((x) => x.type === t); return arr.length ? card(t === 'allergy' ? 'Аллергии и непереносимости' : 'Противопоказания', h('div', null, arr.map((a) => row(a.name, '›', { sub: [a.reaction, a.source].filter(Boolean).join(' · '), onclick: () => allergyEdit(a) })))) : null; }),
    list.length ? null : empty('Записей нет'),
    h('p', { class: 'muted small' }, 'Физические ограничения для тренировок настраиваются в разделе Активность → Спина и мобильность.'));
}

// ── Показатели (необязательные) ──
function vitalEdit(type, l) {
  const t = S.settings.vitals.types.find((x) => x.id === type) || S.settings.vitals.types[0];
  formSheet({ title: t.name, fields: [
    { name: 'value', label: t.two ? 'Верхнее' : 'Значение', unit: t.unit, type: 'number', required: true, value: l && l.value, half: !!t.two },
    t.two ? { name: 'value2', label: 'Нижнее', unit: t.unit, type: 'number', value: l && l.value2, half: true } : null,
    { name: 'ts', label: 'Когда', type: 'datetime', value: l ? l.ts : Date.now() },
    { name: 'note', label: 'Заметка', value: l && l.note },
  ].filter(Boolean), onSave: (v) => S.putLog({ ...(l || { kind: 'vital', type: t.id }), ...v }), onDelete: l ? () => S.delLog(l.id) : null });
}
function vitalsTab() {
  const vs = S.settings.vitals;
  const sw = h('input', { type: 'checkbox', class: 'switch' }); sw.checked = vs.show;
  sw.onchange = () => S.saveSettings({ vitals: { show: sw.checked } });
  const head = card(null, h('label', { class: 'field field-check' }, h('span', null, 'Показывать раздел показателей', h('small', { class: 'muted block' }, 'Пульс, давление и т. п. — полностью необязательны. Предупреждений об отсутствии данных нет.')), sw));
  if (!vs.show) return head;
  return h('div', null, head,
    ...vs.types.filter((t) => t.on).map((t) => {
      const logs = S.logs('vital').filter((l) => l.type === t.id);
      return card(t.name, h('div', null,
        logs.length > 1 ? chart({ labels: logs.map((l) => fmtDateShort(dateKey(l.ts))), series: [{ name: t.two ? 'верхнее' : t.name, values: logs.map((l) => l.value), color: 'var(--health)' }, ...(t.two ? [{ name: 'нижнее', values: logs.map((l) => l.value2), color: '#a597ff' }] : [])], zero: false, height: 120, type: 'line' }) : null,
        ...logs.slice(-5).reverse().map((l) => row(`${fmt(l.value, 1)}${t.two && l.value2 ? '/' + fmt(l.value2) : ''} ${t.unit}`, fmtDateTime(l.ts), { sub: l.note, onclick: () => vitalEdit(t.id, l) })),
        btn('＋ Записать', () => vitalEdit(t.id), 'small mt')), { action: h('button', { class: 'btn small ghost', onclick: async () => { await S.setSetting('vitals.types', vs.types.map((x) => (x.id === t.id ? { ...x, on: false } : x))); } }, 'скрыть') });
    }),
    btn('Настроить список показателей', () => {
      sheet({ title: 'Показатели', body: (sh) => {
        const box = h('div');
        const draw = () => box.replaceChildren(...S.settings.vitals.types.map((t) => {
          const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = t.on;
          c.onchange = () => S.setSetting('vitals.types', S.settings.vitals.types.map((x) => (x.id === t.id ? { ...x, on: c.checked } : x)));
          return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.name), h('div', { class: 'row-sub' }, t.unit)), c);
        }), btn('＋ Свой показатель', () => formSheet({ title: 'Новый показатель', fields: [{ name: 'name', label: 'Название', required: true }, { name: 'unit', label: 'Единица' }, { name: 'two', label: 'Два значения (как давление)', type: 'check' }], onSave: async (v) => { await S.setSetting('vitals.types', [...S.settings.vitals.types, { id: uid('v_'), name: v.name, unit: v.unit, two: v.two, on: true }]); draw(); } }), 'wide mt'));
        draw();
        return box;
      } });
    }, 'wide ghost'));
}

export default {
  medical: { tab: 'health', render: () => h('div', null,
    pageHeader('Здоровье и профилактика', { back: true }),
    tabs([{ id: 'records', label: 'Записи' }, { id: 'meds', label: 'Лекарства' }, { id: 'allergy', label: 'Аллергии' }, { id: 'vitals', label: 'Показатели' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'records' ? recordsTab() : tab === 'meds' ? medsTab() : tab === 'allergy' ? allergyTab() : vitalsTab(),
    h('p', { class: 'muted small mt' }, 'Раздел для хранения ваших данных. Приложение не ставит диагнозы и не назначает лекарства.')) },
};
export { tsToHm };
