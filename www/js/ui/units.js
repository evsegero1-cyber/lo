// Единицы измерения. Внутри данные всегда хранятся в метрической системе (кг, мл, см).
import { S } from '../data/store.js';
import { round } from '../core/calc.js';

const U = {
  weight: { kg: { k: 1, label: 'кг', d: 1 }, lb: { k: 2.20462, label: 'фунт', d: 1 } },
  volume: { ml: { k: 1, label: 'мл', d: 0 }, oz: { k: 0.033814, label: 'fl oz', d: 1 } },
  length: { cm: { k: 1, label: 'см', d: 1 }, in: { k: 0.393701, label: 'дюйм', d: 1 } },
  energy: { kcal: { k: 1, label: 'ккал', d: 0 }, kj: { k: 4.184, label: 'кДж', d: 0 } },
};
const cur = (t) => U[t][(S.settings.units || {})[t]] || Object.values(U[t])[0];

export const unitLabel = (t) => cur(t).label;
export const toDisp = (t, v) => (v == null ? null : round(v * cur(t).k, cur(t).d));
export const fromDisp = (t, v) => (v == null || v === '' ? null : Number(v) / cur(t).k);
export const disp = (t, v) => (v == null ? '—' : `${toDisp(t, v).toLocaleString('ru-RU')} ${cur(t).label}`);
export const UNIT_OPTIONS = {
  weight: [{ value: 'kg', label: 'Килограммы' }, { value: 'lb', label: 'Фунты' }],
  volume: [{ value: 'ml', label: 'Миллилитры' }, { value: 'oz', label: 'Жидкие унции' }],
  length: [{ value: 'cm', label: 'Сантиметры' }, { value: 'in', label: 'Дюймы' }],
  energy: [{ value: 'kcal', label: 'Килокалории' }, { value: 'kj', label: 'Килоджоули' }],
};
