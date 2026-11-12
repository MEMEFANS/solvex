import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDecimal } from './money';
export { units, toUnits, formatUnits, formatDecimal, sumDecimal, mulDecimal, percent } from './money';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
// 展示统一走字符串/大整数，避免 Number 精度丢失
export const number = (v: string | number | undefined, digits = 2) => formatDecimal(v, digits);
export const short = (s: string | undefined) => s ? s.slice(0, 6) + '…' + s.slice(-4) : '—';
export const date = (v: number | undefined) => v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
