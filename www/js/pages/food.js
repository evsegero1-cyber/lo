import { S } from '../data/store.js';
import { h, card, row, btn, toast, formSheet, sheet, pageHeader, tabs, fmt, empty, refresh, ring, bar, buildForm, seg, confirmDialog } from '../ui/dom.js';
import { chart } from '../ui/charts.js';
import { foodDay, foodGoalMet } from '../summary.js';
import { fmtDate, fmtDateShort, tsToHm, addDays, hmToMin, minutesOfDay, daysBetween } from '../core/time.js';
import { portion, recipePer100, NUTRIENTS, nutritionTargets, SCENARIOS, ACTIVITY_LEVELS, bmr, tdee, avg, round } from '../core/calc.js';
import { FOOD_CATS } from '../data/seed.js';

let tab = 'diary';
let dayKey = null;
let prodFilter = '';
let prodCat = 'all';

const NUT_LABEL = { kcal: 'Ккал', protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы', sugar: 'Сахар', fiber: 'Клетчатка', salt: 'Соль' };

export function mealNames(key) {
  const tpl = S.template(key);
  const names = ((tpl && tpl.meals) || []).map((m) => m.name).filter(Boolean);
  if (!names.includes('Перекус')) names.push('Перекус');
  return names;
}
function guessMeal(key) {
  const tpl = S.template(key);
  const now = minutesOfDay(Date.now());
  const wake = hmToMin(tpl && tpl.sleepEnd) ?? 0;
  const rel = (m) => (m - wake + 1440) % 1440;
  let best = null;
  for (const m of (tpl && tpl.meals) || []) {
    const t = hmToMin(m.time);
    if (t == null) continue;
    if (Math.abs(rel(now) - rel(t)) <= 90 && (!best || Math.abs(rel(now) - rel(t)) < best.d)) best = { name: m.name, d: Math.abs(rel(now) - rel(t)) };
  }
  return best ? best.name : 'Перекус';
}

function recentRefs() {
  const seen = new Map();
  for (const l of S.logs('food').slice(-200).reverse()) if (l.ref && !seen.has(l.ref)) seen.set(l.ref, l.grams);
  return seen;
}

/** Лист добавления еды. */
export function addFoodSheet(meal, key) {
  key = key || S.cur().key;
  meal = meal || guessMeal(key);
  sheet({ title: 'Добавить еду', full: true, body: (sh) => {
    const box = h('div');
    const q = h('input', { class: 'inp', placeholder: 'Поиск продукта или рецепта', autocomplete: 'off' });
    const mealSeg = seg(mealNames(key).map((n) => ({ value: n, label: n })), meal, (v) => { meal = v; });
    const list = h('div', { class: 'mt' });
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const recent = recentRefs();
      let items = [...S.defs('recipe'), ...S.defs('product')];
      if (t) items = items.filter((p) => p.name.toLowerCase().includes(t));
      else items = items.filter((p) => recent.has(p.id)).sort((a, b) => [...recent.keys()].indexOf(a.id) - [...recent.keys()].indexOf(b.id));
      list.replaceChildren(
        !t ? h('div', { class: 'form-section' }, recent.size ? 'Недавние' : 'Начните вводить название') : null,
        ...items.slice(0, 60).map((p) => row(p.name, `${fmt(p.kcal)} ккал`, { icon: p.kind === 'recipe' ? '🍲' : catIcon(p.cat), sub: `на 100 г · Б ${fmt(p.protein, 1)} Ж ${fmt(p.fat, 1)} У ${fmt(p.carbs, 1)}`, onclick: () => portionSheet(p, meal, key, recent.get(p.id), sh) })),
        t && !items.length ? empty('Не найдено', btn('＋ Создать продукт «' + q.value.trim() + '»', () => productEdit({ name: q.value.trim() }, (p) => portionSheet(p, meal, key, null, sh)), 'primary')) : null,
      );
    };
    q.addEventListener('input', draw);
    draw();
    box.append(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Приём пищи'), mealSeg), h('div', { class: 'search mt' }, q),
      h('div', { class: 'btns mt' }, btn('⚡ Быстрая запись калорий', () => quickKcal(meal, key, sh), 'small'), btn('＋ Новый продукт', () => productEdit(null, (p) => portionSheet(p, meal, key, null, sh)), 'small ghost')), list);
    setTimeout(() => q.focus(), 300);
    return box;
  } });
}
const catIcon = (c) => ({ veg: '🥦', fruit: '🍎', meat: '🍗', fish: '🐟', dairy: '🥛', egg: '🥚', grain: '🍞', nuts: '🥜', oil: '🫒', sweet: '🍫', drink: '🥤', other: '🍽' })[c] || '🍽';

function portionSheet(p, meal, key, lastGrams, parent) {
  let grams = lastGrams || p.portion || 100;
  const preview = h('div', { class: 'hint mt' });
  const upd = () => {
    const n = portion(p, grams);
    preview.textContent = `${fmt(n.kcal)} ккал · Б ${fmt(n.protein, 1)} · Ж ${fmt(n.fat, 1)} · У ${fmt(n.carbs, 1)} г${n.sugar ? ` · сахар ${fmt(n.sugar, 1)} г` : ''}`;
  };
  const inp = h('input', { class: 'inp', inputmode: 'decimal', value: String(grams) });
  inp.addEventListener('input', () => { grams = Number(inp.value.replace(',', '.')) || 0; upd(); });
  upd();
  const quick = h('div', { class: 'chips mt' }, [50, 100, 150, 200, 250, 300].map((g) => h('button', { class: 'chip', onclick: () => { grams = g; inp.value = g; upd(); } }, g + ' г')),
    p.portion ? h('button', { class: 'chip on', onclick: () => { grams = p.portion; inp.value = p.portion; upd(); } }, `порция ${p.portion} г`) : null);
  sheet({ title: p.name, body: h('div', null, h('div', { class: 'field' }, h('span', { class: 'field-label' }, `Масса, г · ${meal}`), inp), quick, preview), actions: [
    { label: 'Добавить', cls: 'primary', onClick: async () => {
      if (!(grams > 0 && grams <= 5000)) { toast('Укажите массу от 1 до 5000 г'); return false; }
      const n = portion(p, grams);
      const ts = key === S.cur().key ? Date.now() : Math.min(Date.now(), S.range(key).start + 3600e3);
      await S.putLog({ kind: 'food', ts, meal, ref: p.id, name: p.name, grams, cat: p.cat, ...Object.fromEntries(NUTRIENTS.map((x) => [x, round(n[x], 2)])) });
      toast(`${p.name}: ${fmt(n.kcal)} ккал`);
      parent && parent.close();
    } }] });
}

function quickKcal(meal, key, parent) {
  formSheet({ title: 'Быстрая запись', fields: [
    { name: 'name', label: 'Что ели', required: true, placeholder: 'Например: обед в столовой' },
    { name: 'kcal', label: 'Калории', type: 'number', min: 0, max: 10000, required: true, half: true },
    { name: 'protein', label: 'Белки, г', type: 'number', min: 0, max: 1000, half: true },
    { name: 'fat', label: 'Жиры, г', type: 'number', min: 0, max: 1000, half: true },
    { name: 'carbs', label: 'Углеводы, г', type: 'number', min: 0, max: 2000, half: true },
    { name: 'cat', label: 'Категория (для учёта овощей и фруктов)', type: 'select', options: Object.entries(FOOD_CATS).map(([v, l]) => ({ value: v, label: l })), value: 'other' },
  ], onSave: async (v) => {
    const ts = key === S.cur().key ? Date.now() : Math.min(Date.now(), S.range(key).start + 3600e3);
    await S.putLog({ kind: 'food', ts, meal, name: v.name, grams: v.cat === 'veg' || v.cat === 'fruit' ? 80 : null, cat: v.cat, kcal: v.kcal, protein: v.protein || 0, fat: v.fat || 0, carbs: v.carbs || 0, sugar: 0, fiber: 0, salt: 0 });
    parent && parent.close();
  } });
}

function editFood(l) {
  formSheet({ title: l.name, fields: [
    { name: 'grams', label: 'Масса, г', type: 'number', min: 1, max: 5000, value: l.grams, help: l.ref ? 'Пищевая ценность пересчитается' : null },
    { name: 'meal', label: 'Приём пищи', type: 'select', options: mealNames(S.pdayOf(l.ts).key).map((n) => ({ value: n, label: n })), value: l.meal },
    { name: 'ts', label: 'Время', type: 'datetime', value: l.ts },
  ], onSave: async (v) => {
    const p = l.ref && S.def(l.ref);
    let upd = { ...l, meal: v.meal, ts: v.ts };
    if (p && v.grams) { const n = portion(p, v.grams); upd = { ...upd, grams: v.grams, ...Object.fromEntries(NUTRIENTS.map((x) => [x, round(n[x], 2)])) }; }
    else if (v.grams && l.grams) { const k = v.grams / l.grams; upd = { ...upd, grams: v.grams, ...Object.fromEntries(NUTRIENTS.map((x) => [x, round((l[x] || 0) * k, 2)])) }; }
    await S.putLog(upd);
  }, onDelete: () => S.delLog(l.id) });
}

// ── Дневник ──
function diary() {
  const cur = S.cur().key;
  const key = dayKey || cur;
  const f = foodDay(key);
  const t = S.settings.food.targets;
  const meals = mealNames(key);
  const extra = [...new Set(f.logs.map((l) => l.meal))].filter((m) => !meals.includes(m));
  const met = foodGoalMet(f);
  const macro = (n, color) => h('div', { class: 'macro' }, h('span', null, NUT_LABEL[n]), bar(t[n] ? f[n] / t[n] : 0, color, ['sugar', 'salt'].includes(n) && t[n] && f[n] > t[n]), h('span', null, `${fmt(f[n], n === 'salt' ? 1 : 0)}${t[n] ? ' / ' + t[n] : ''} г`));
  return h('div', null,
    h('div', { class: 'split mb' }, btn('‹', () => { dayKey = addDays(key, -1); refresh(); }, 'small'), h('b', null, key === cur ? 'Текущий личный день' : fmtDate(key, true)), btn('›', () => { dayKey = key >= cur ? cur : addDays(key, 1); refresh(); }, 'small' + (key >= cur ? ' ghost' : ''))),
    card(null, h('div', null,
      h('div', { class: 'dash-mini' }, ring(t.kcal ? f.kcal / t.kcal : 0, { size: 96, stroke: 9, color: 'var(--food)', label: fmt(f.kcal), sub: t.kcal ? `из ${t.kcal}` : 'ккал' }),
        h('div', { class: 'info' }, macro('protein', '#ff8f5a'), macro('fat', '#ffd166'), macro('carbs', '#4cc3ff'))),
      h('div', { class: 'sep' }),
      S.settings.food.showSugar ? macro('sugar', '#ff6b8a') : null, S.settings.food.showFiber ? macro('fiber', '#5be07a') : null, S.settings.food.showSalt ? macro('salt', '#a597ff') : null,
      h('div', { class: 'macro' }, h('span', null, 'Овощи/фр.'), bar(f.vegServings / (S.settings.food.vegGoal || 5), 'var(--habit)'), h('span', null, `${fmt(f.vegServings, 1)} / ${S.settings.food.vegGoal || 5} порц.`)),
      met != null ? h('p', { class: 'small ' + (met ? 'ok' : 'muted') }, met ? 'Калорийность соответствует выбранному сценарию' : `Сценарий «${(SCENARIOS[S.settings.food.scenario] || { label: 'свой' }).label}»: цель ${t.kcal} ккал`) : null), { cls: 'hero' }),
    ...[...meals, ...extra].map((m) => {
      const items = f.logs.filter((l) => l.meal === m);
      const kc = items.reduce((a, l) => a + (l.kcal || 0), 0);
      return card(`${m}${kc ? ' · ' + fmt(kc) + ' ккал' : ''}`, h('div', null,
        items.map((l) => row(l.name, `${fmt(l.kcal)} ккал`, { sub: `${l.grams ? fmt(l.grams) + ' г · ' : ''}${tsToHm(l.ts)}`, onclick: () => editFood(l) })),
        btn('＋ Добавить', () => addFoodSheet(m, key), 'small ghost' + (items.length ? ' mt' : ''))), { });
    }),
  );
}

// ── Продукты ──
export function productEdit(p, after) {
  const isNew = !p || !p.id;
  p = p || {};
  formSheet({ title: isNew ? 'Новый продукт' : 'Продукт', fields: [
    { name: 'name', label: 'Название', required: true, value: p.name },
    { name: 'cat', label: 'Категория', type: 'select', options: Object.entries(FOOD_CATS).map(([v, l]) => ({ value: v, label: l })), value: p.cat || 'other' },
    { type: 'section', label: 'Пищевая ценность на 100 г' },
    { name: 'kcal', label: 'Ккал', type: 'number', min: 0, max: 950, required: true, value: p.kcal, half: true },
    { name: 'protein', label: 'Белки, г', type: 'number', min: 0, max: 100, value: p.protein, half: true },
    { name: 'fat', label: 'Жиры, г', type: 'number', min: 0, max: 100, value: p.fat, half: true },
    { name: 'carbs', label: 'Углеводы, г', type: 'number', min: 0, max: 100, value: p.carbs, half: true },
    { name: 'sugar', label: 'Сахар, г', type: 'number', min: 0, max: 100, value: p.sugar, half: true },
    { name: 'fiber', label: 'Клетчатка, г', type: 'number', min: 0, max: 100, value: p.fiber, half: true },
    { name: 'salt', label: 'Соль, г', type: 'number', min: 0, max: 100, value: p.salt, half: true },
    { name: 'portion', label: 'Обычная порция, г', type: 'number', min: 1, max: 3000, value: p.portion, half: true },
  ], onSave: async (v) => {
    if ((v.protein || 0) + (v.fat || 0) + (v.carbs || 0) > 100.5) return 'Сумма БЖУ на 100 г не может превышать 100 г';
    const d = await S.putDef({ ...p, kind: 'product', ...v, protein: v.protein || 0, fat: v.fat || 0, carbs: v.carbs || 0, sugar: v.sugar || 0, fiber: v.fiber || 0, salt: v.salt || 0, custom: true });
    after && after(d);
  }, onDelete: isNew ? null : async () => { await S.delDef(p.id); } });
}

function products() {
  const q = h('input', { class: 'inp', placeholder: 'Поиск', value: prodFilter });
  const list = h('div');
  const draw = () => {
    const t = prodFilter.toLowerCase();
    const items = S.defs('product').filter((p) => (!t || p.name.toLowerCase().includes(t)) && (prodCat === 'all' || p.cat === prodCat || (prodCat === 'mine' && p.custom)));
    list.replaceChildren(...items.map((p) => row(p.name, `${fmt(p.kcal)} ккал`, { icon: catIcon(p.cat), sub: `Б ${fmt(p.protein, 1)} · Ж ${fmt(p.fat, 1)} · У ${fmt(p.carbs, 1)}${p.custom ? ' · свой' : ''}`, onclick: () => productEdit(p) })), items.length ? null : empty('Ничего не найдено'));
  };
  q.addEventListener('input', () => { prodFilter = q.value; draw(); });
  draw();
  const cats = h('div', { class: 'chips mb' }, [['all', 'Все'], ['mine', 'Мои'], ...Object.entries(FOOD_CATS)].map(([v, l]) => h('button', { class: 'chip' + (prodCat === v ? ' on' : ''), onclick: () => { prodCat = v; refresh(); } }, l)));
  return h('div', null, h('div', { class: 'search' }, q), cats, btn('＋ Новый продукт', () => productEdit(null), 'primary wide mb'), card(null, list), h('p', { class: 'muted small' }, 'Значения встроенных продуктов ориентировочные. Их можно исправить под упаковку, которую вы покупаете.'));
}

// ── Рецепты ──
function recipeEdit(r) {
  const isNew = !r;
  r = r ? JSON.parse(JSON.stringify(r)) : { kind: 'recipe', name: '', ingredients: [], cooked: null, servings: 1 };
  sheet({ title: isNew ? 'Новый рецепт' : 'Рецепт', full: true, body: (sh) => {
    const box = h('div');
    const name = h('input', { class: 'inp', placeholder: 'Название блюда', value: r.name });
    const cooked = h('input', { class: 'inp', inputmode: 'decimal', placeholder: 'По сумме ингредиентов', value: r.cooked || '' });
    const ing = h('div');
    const res = h('div', { class: 'hint mt' });
    const calc = () => recipePer100(r.ingredients.map((i) => ({ product: S.def(i.ref), grams: i.grams })), Number(cooked.value.replace(',', '.')) || null);
    const draw = () => {
      ing.replaceChildren(...r.ingredients.map((i, idx) => {
        const p = S.def(i.ref);
        const g = h('input', { class: 'inp', inputmode: 'decimal', value: i.grams, style: { width: '90px' } });
        g.addEventListener('input', () => { i.grams = Number(g.value.replace(',', '.')) || 0; upd(); });
        return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p ? p.name : 'удалённый продукт')), g, h('span', { class: 'muted' }, 'г'), h('button', { class: 'icon-btn', onclick: () => { r.ingredients.splice(idx, 1); draw(); } }, '✕'));
      }), r.ingredients.length ? null : h('p', { class: 'muted small' }, 'Добавьте ингредиенты'));
      upd();
    };
    const upd = () => {
      const c = calc();
      res.textContent = `Масса блюда ${fmt(c.weight)} г · всего ${fmt(c.total.kcal)} ккал\nНа 100 г: ${fmt(c.per100.kcal)} ккал · Б ${fmt(c.per100.protein, 1)} · Ж ${fmt(c.per100.fat, 1)} · У ${fmt(c.per100.carbs, 1)}`;
      res.classList.add('pre');
    };
    cooked.addEventListener('input', upd);
    const addIng = () => {
      sheet({ title: 'Ингредиент', full: true, body: (s2) => {
        const q = h('input', { class: 'inp', placeholder: 'Поиск продукта' });
        const l = h('div', { class: 'mt' });
        const d2 = () => { const t = q.value.toLowerCase(); l.replaceChildren(...S.defs('product').filter((p) => !t || p.name.toLowerCase().includes(t)).slice(0, 60).map((p) => row(p.name, `${fmt(p.kcal)} ккал`, { onclick: () => { r.ingredients.push({ ref: p.id, grams: 100 }); s2.close(); draw(); } }))); };
        q.addEventListener('input', d2); d2();
        return h('div', null, h('div', { class: 'search' }, q), l);
      } });
    };
    draw();
    box.append(h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Название'), name),
      h('div', { class: 'form-section' }, 'Ингредиенты (сырой вес)'), ing, btn('＋ Ингредиент', addIng, 'small'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Масса готового блюда, г (необязательно)'), cooked, h('small', { class: 'muted' }, 'Взвесьте готовое блюдо — так учитывается выкипание воды или впитывание при варке.'))), res);
    box.save = async () => {
      if (!name.value.trim()) { toast('Введите название'); return false; }
      if (!r.ingredients.length) { toast('Добавьте хотя бы один ингредиент'); return false; }
      const c = calc();
      await S.putDef({ ...r, name: name.value.trim(), cooked: Number(cooked.value.replace(',', '.')) || null, ...Object.fromEntries(NUTRIENTS.map((x) => [x, round(c.per100[x], 2)])), portion: null, cat: 'other' });
      toast('Рецепт сохранён');
      return true;
    };
    sh.box = box;
    return box;
  }, actions: [
    ...(isNew ? [] : [{ label: 'Удалить', cls: 'danger ghost', onClick: async () => { if (await confirmDialog('Удалить рецепт?', { danger: true })) { await S.delDef(r.id); return true; } return false; } }]),
    { label: 'Сохранить', cls: 'primary', onClick: (sh) => sh.box.save() }] });
}

function recipes() {
  const list = S.defs('recipe');
  return h('div', null, btn('＋ Новый рецепт', () => recipeEdit(null), 'primary wide mb'),
    card(null, list.length ? h('div', null, list.map((r) => row(r.name, `${fmt(r.kcal)} ккал/100 г`, { icon: '🍲', sub: `${r.ingredients.length} ингредиентов${r.cooked ? ' · готовое блюдо ' + r.cooked + ' г' : ''}`, onclick: () => recipeEdit(r) }))) : empty('Рецептов пока нет. Калорийность блюда считается по ингредиентам автоматически.')));
}

// ── Цели ──
function latestWeight() { const w = S.logs('weight').at(-1); return w ? w.value : null; }
function age() { const y = S.settings.profile.birthYear; return y ? new Date().getFullYear() - y : null; }

function goals() {
  const fs = S.settings.food;
  const prof = { ...S.settings.profile, weight: latestWeight(), age: age() };
  const can = prof.weight && prof.height && prof.age;
  let sc = fs.scenario;
  const scSeg = seg([...Object.entries(SCENARIOS).map(([v, x]) => ({ value: v, label: x.label })), { value: 'manual', label: 'Вручную' }], sc, (v) => { sc = v; });
  const form = buildForm([
    { name: 'kcal', label: 'Калории', type: 'number', min: 0, max: 8000, value: fs.targets.kcal, half: true },
    { name: 'protein', label: 'Белки, г', type: 'number', min: 0, max: 500, value: fs.targets.protein, half: true },
    { name: 'fat', label: 'Жиры, г', type: 'number', min: 0, max: 400, value: fs.targets.fat, half: true },
    { name: 'carbs', label: 'Углеводы, г', type: 'number', min: 0, max: 1000, value: fs.targets.carbs, half: true },
    { name: 'sugar', label: 'Сахар — максимум, г', type: 'number', min: 0, max: 500, value: fs.targets.sugar, half: true },
    { name: 'salt', label: 'Соль — максимум, г', type: 'number', min: 0, max: 50, value: fs.targets.salt, half: true },
    { name: 'fiber', label: 'Клетчатка — цель, г', type: 'number', min: 0, max: 100, value: fs.targets.fiber, half: true },
    { name: 'vegGoal', label: 'Овощи и фрукты, порций', type: 'number', min: 0, max: 20, value: fs.vegGoal, half: true },
    { name: 'showSugar', label: 'Показывать сахар', type: 'check', value: fs.showSugar },
    { name: 'showSalt', label: 'Показывать соль', type: 'check', value: fs.showSalt },
    { name: 'showFiber', label: 'Показывать клетчатку', type: 'check', value: fs.showFiber },
  ], {});
  const calcBtn = btn('Рассчитать по профилю и сценарию', () => {
    if (!can) { toast('Нужны рост, год рождения (Настройки → Профиль) и хотя бы одно взвешивание'); return; }
    const t = nutritionTargets(prof, sc === 'manual' ? 'maintain' : sc);
    for (const k of ['kcal', 'protein', 'fat', 'carbs', 'sugar', 'salt', 'fiber']) form.refs[k].input.value = t[k];
    toast('Значения подставлены — проверьте и сохраните');
  }, 'wide');
  const b = can ? bmr(prof) : null, td = can ? tdee(prof) : null;
  return h('div', null,
    card('Сценарий', h('div', null, scSeg, h('div', { class: 'mt' }, calcBtn),
      h('p', { class: 'muted small mt' }, can ? `Базовый обмен ≈ ${fmt(b)} ккал (Миффлин — Сан Жеор), с учётом активности «${(ACTIVITY_LEVELS.find((a) => a.id === prof.activity) || ACTIVITY_LEVELS[1]).label}» ≈ ${fmt(td)} ккал. Похудение: −15% (не ниже базового обмена), набор: +10%. Это оценка, а не медицинская норма.` : 'Для расчёта укажите рост и год рождения в профиле и добавьте взвешивание. Или задайте цели вручную.'))),
    card('Суточные цели', form.node),
    btn('Сохранить цели', async () => {
      const r = form.read();
      if (!r.ok) { toast('Проверьте поля'); return; }
      const v = r.values;
      await S.saveSettings({ food: { scenario: sc, targets: { kcal: v.kcal || 0, protein: v.protein || 0, fat: v.fat || 0, carbs: v.carbs || 0, sugar: v.sugar || 0, salt: v.salt || 0, fiber: v.fiber || 0 }, vegGoal: v.vegGoal || 0, showSugar: v.showSugar, showSalt: v.showSalt, showFiber: v.showFiber } });
      toast('Цели сохранены');
    }, 'primary wide'),
    h('p', { class: 'muted small mt' }, 'Время приёмов пищи и их названия настраиваются в шаблонах режима (Настройки → Мой режим). Завтрак может быть в 15:00 — так и задумано.'));
}

// ── Статистика ──
function stats() {
  const k7 = S.lastDays(7), k30 = S.lastDays(30);
  const d30 = k30.map((k) => foodDay(k));
  const t = S.settings.food.targets;
  const logged = d30.filter((d) => d.count);
  const a = (n) => avg(logged.map((d) => d[n])) || 0;
  const recent = S.logs('food').filter((l) => daysBetween(S.pdayOf(l.ts).key, S.cur().key) < 7);
  const uniq = new Set(recent.map((l) => l.ref || l.name)).size;
  const cats = new Set(recent.map((l) => l.cat).filter(Boolean));
  const top = {};
  for (const l of S.logs('food').filter((x) => daysBetween(S.pdayOf(x.ts).key, S.cur().key) < 30)) top[l.name] = (top[l.name] || 0) + 1;
  return h('div', null,
    h('div', { class: 'grid3 mb' },
      h('div', { class: 'stat' }, h('b', null, fmt(a('kcal'))), h('small', null, 'ккал в среднем')),
      h('div', { class: 'stat' }, h('b', null, fmt(a('protein'))), h('small', null, 'белка, г')),
      h('div', { class: 'stat' }, h('b', null, `${logged.length}/30`), h('small', null, 'дней с дневником'))),
    card('Калории за 7 дней', chart({ labels: k7.map(fmtDateShort), series: [{ name: 'Ккал', values: k7.map((k) => foodDay(k).kcal || null), color: 'var(--food)' }], type: 'bar', goal: t.kcal || null, unit: 'ккал' })),
    card('БЖУ за 30 дней, г', chart({ labels: k30.map(fmtDateShort), series: [{ name: 'Белки', values: d30.map((d) => d.count ? d.protein : null), color: '#ff8f5a' }, { name: 'Жиры', values: d30.map((d) => d.count ? d.fat : null), color: '#ffd166' }, { name: 'Углеводы', values: d30.map((d) => d.count ? d.carbs : null), color: '#4cc3ff' }], type: 'line', unit: 'г' })),
    card('Сахар, соль, клетчатка (среднее)', h('div', null,
      row('Сахар', `${fmt(a('sugar'))} г${t.sugar ? ' (макс. ' + t.sugar + ')' : ''}`), row('Соль', `${fmt(a('salt'), 1)} г${t.salt ? ' (макс. ' + t.salt + ')' : ''}`), row('Клетчатка', `${fmt(a('fiber'))} г${t.fiber ? ' (цель ' + t.fiber + ')' : ''}`),
      row('Овощи и фрукты', `${fmt(avg(logged.map((d) => d.vegServings)) || 0, 1)} порц./день`),
      h('p', { class: 'muted small' }, 'Учитываются только продукты, у которых известны эти значения.'))),
    card('Разнообразие рациона (7 дней)', h('div', null,
      row('Разных продуктов и блюд', String(uniq)), row('Групп продуктов', `${cats.size} из ${Object.keys(FOOD_CATS).length}`),
      h('div', { class: 'chips mt' }, Object.entries(FOOD_CATS).map(([v, l]) => h('span', { class: 'chip' + (cats.has(v) ? ' on' : '') }, l))))),
    card('Чаще всего (30 дней)', Object.keys(top).length ? h('div', null, Object.entries(top).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, c]) => row(n, `${c}×`))) : empty('Нет данных')),
  );
}

export default {
  food: { tab: 'health', render: () => h('div', null,
    pageHeader('Питание', { back: true }),
    tabs([{ id: 'diary', label: 'Дневник' }, { id: 'stats', label: 'Статистика' }, { id: 'products', label: 'Продукты' }, { id: 'recipes', label: 'Рецепты' }, { id: 'goals', label: 'Цели' }], tab, (t) => { tab = t; refresh(false); }),
    tab === 'diary' ? diary() : tab === 'stats' ? stats() : tab === 'products' ? products() : tab === 'recipes' ? recipes() : goals(),
    tab === 'diary' ? h('button', { class: 'fab', onclick: () => addFoodSheet(null, dayKey || S.cur().key), 'aria-label': 'Добавить еду' }, '＋') : null) },
};
