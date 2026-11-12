// 金额计算只走 bigint / 字符串，禁止用 Number 参与账目运算（浮点会丢精度）。
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function big(value: string | bigint | undefined | null): bigint {
  if (value == null || value === '') return 0n;
  if (typeof value === 'bigint') return value;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) throw new Error('金额格式无效：' + text);
  return BigInt(text);
}

/** 最小单位 → 十进制字符串（不做四舍五入，用于原始展示/继续计算）。 */
export function units(value: string | bigint | undefined | null, decimals = 18): string {
  let n = big(value);
  const negative = n < 0n;
  if (negative) n = -n;
  const scale = 10n ** BigInt(decimals);
  const fraction = String(n % scale).padStart(decimals, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + String(n / scale) + (fraction ? '.' + fraction : '');
}

/** 十进制字符串 → 最小单位；超出精度直接报错，避免静默截断。 */
export function toUnits(value: string, decimals = 18): bigint {
  if (!new RegExp('^\\d+(?:\\.\\d{1,' + decimals + '})?$').test(value)) throw new Error('请输入有效数量，最多 ' + decimals + ' 位小数');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** 最小单位 → 展示文本（千分位 + 指定位数，四舍五入，去掉末尾 0）。 */
export function formatUnits(value: string | bigint | undefined | null, decimals = 18, digits = 2): string {
  if (value == null || value === '') return '—';
  let n = big(value);
  const negative = n < 0n;
  if (negative) n = -n;
  const scale = 10n ** BigInt(decimals);
  let whole = n / scale;
  let rest = n % scale;
  if (digits > 0 && decimals > digits) {
    const drop = 10n ** BigInt(decimals - digits);
    let shown = rest / drop;
    if ((rest % drop) * 2n >= drop) shown += 1n;
    const limit = 10n ** BigInt(digits);
    if (shown >= limit) { whole += 1n; shown -= limit; }
    rest = shown;
  } else if (digits > decimals) {
    rest *= 10n ** BigInt(digits - decimals);
  } else if (digits <= 0) {
    if (rest * 2n >= scale) whole += 1n;
    rest = 0n;
  }
  const fraction = digits > 0 ? String(rest).padStart(digits, '0').replace(/0+$/, '') : '';
  return (negative && (whole > 0n || rest > 0n) ? '-' : '') + group(String(whole)) + (fraction ? '.' + fraction : '');
}

/** 十进制字符串（接口里的 '1000.25'）→ 展示文本，全程字符串/大整数。 */
export function formatDecimal(value: string | number | undefined | null, digits = 2): string {
  if (value == null || value === '') return '—';
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value).trim();
  if (!DECIMAL.test(text)) return '—';
  const negative = text.startsWith('-');
  let [wholeText, fractionText = ''] = (negative ? text.slice(1) : text).split('.');
  let whole = BigInt(wholeText || '0');
  let fraction = fractionText;
  if (digits <= 0) {
    if (fraction && fraction[0] >= '5') whole += 1n;
    fraction = '';
  } else if (fraction.length > digits) {
    const limit = 10n ** BigInt(digits);
    let shown = BigInt(fraction.slice(0, digits) || '0');
    if (fraction[digits] >= '5') shown += 1n;
    if (shown >= limit) { whole += 1n; shown -= limit; }
    fraction = String(shown).padStart(digits, '0');
  } else {
    fraction = fraction.padEnd(digits, '0');
  }
  fraction = fraction.replace(/0+$/, '');
  return (negative && (whole > 0n || fraction) ? '-' : '') + group(String(whole)) + (fraction ? '.' + fraction : '');
}

/** 多个十进制字符串求和，返回十进制字符串（最多保留 decimals 位）。 */
export function sumDecimal(values: (string | undefined | null)[], decimals = 18): string {
  const scale = 10n ** BigInt(decimals);
  let total = 0n;
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (!DECIMAL.test(text)) continue;
    const negative = text.startsWith('-');
    const [wholeText, fractionText = ''] = (negative ? text.slice(1) : text).split('.');
    const fraction = (fractionText + '0'.repeat(decimals)).slice(0, decimals);
    total += (negative ? -1n : 1n) * (BigInt(wholeText || '0') * scale + BigInt(fraction || '0'));
  }
  return units(total, decimals);
}

/** 两个十进制字符串相乘（估值 = 数量 × 价格），结果保留 decimals 位有效精度。 */
export function mulDecimal(a: string | number | undefined | null, b: string | number | undefined | null, decimals = 18): string {
  const parse = (value: string | number | undefined | null) => {
    const text = String(value ?? '').trim();
    if (!DECIMAL.test(text)) return null;
    const negative = text.startsWith('-');
    const [wholeText, fractionText = ''] = (negative ? text.slice(1) : text).split('.');
    const fraction = (fractionText + '0'.repeat(decimals)).slice(0, decimals);
    return (negative ? -1n : 1n) * (BigInt(wholeText || '0') * 10n ** BigInt(decimals) + BigInt(fraction || '0'));
  };
  const left = parse(a), right = parse(b);
  if (left == null || right == null) return '—';
  return units(left * right / 10n ** BigInt(decimals), decimals);
}

/** 进度百分比：仅用于宽度展示，不参与金额结算。 */
export function percent(current: string | number | undefined | null, target: string | number | undefined | null): number {
  const a = Number(current), b = Number(target);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Math.min(100, Math.max(0, a / b * 100));
}
