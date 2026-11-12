// @ts-check
// 日收益使用 UTC 00:00 / 北京时间08:00边界；锁定时长保留滚动24小时计算。
import { SOLVEX_RULES } from '../shared/solvex-rules.js';
export const ROLLING_WINDOW_MS = SOLVEX_RULES.settlement.dayMs;

// 已完成的整窗口数（向下取整，负数与未满一个窗口均为 0）
/**
 * @param {number} anchorAt
 * @param {number} at
 */
export function completedWindows(anchorAt, at, windowMs = ROLLING_WINDOW_MS) {
  const anchor = Number(anchorAt) || 0;
  const now = Number(at) || 0;
  if (now <= anchor) return 0;
  return Math.floor((now - anchor) / windowMs);
}

// 第 index 个窗口的结束时刻（index 从 0 开始）
/**
 * @param {number} anchorAt
 * @param {number} index
 */
export function windowEndAt(anchorAt, index, windowMs = ROLLING_WINDOW_MS) {
  return (Number(anchorAt) || 0) + (Number(index) + 1) * windowMs;
}

// 待领取收益的可领取开始时刻：产出发生即可用
/**
 * @param {number} at
 */
export function availableAtFrom(at) {
  return Number(at) || 0;
}

// 待领取收益的过期时刻：可领取后 24 小时（滚动窗口，不顺延到次日 0 点）
/**
 * @param {number} at
 */
export function expiresAtFrom(at, windowMs = ROLLING_WINDOW_MS) {
  return (Number(at) || 0) + windowMs;
}

/**
 * @param {number} expiresAt
 * @param {number} at
 */
export function isExpired(expiresAt, at) {
  return Number(at) >= (Number(expiresAt) || 0);
}

// 稳定的周期键：同一业务 + 同一窗口只生成一条记录（配合唯一索引防重）
/**
 * @param {number} anchorAt
 * @param {number} at
 */
export function rollingPeriodKey(anchorAt, at, windowMs = ROLLING_WINDOW_MS) {
  return `w${completedWindows(anchorAt, at, windowMs) + 1}`;
}

// 方案 2026-11-10：UTC 00:00（北京时间 08:00）为统一收益日边界。
/**
 * @param {number} at
 */
export function settlementDayStart(at) {
  const offset = (SOLVEX_RULES.settlement.utcOffsetMinutes - SOLVEX_RULES.settlement.hour * 60 - SOLVEX_RULES.settlement.minute) * 60000;
  return Math.floor((Number(at) + offset) / ROLLING_WINDOW_MS) * ROLLING_WINDOW_MS - offset;
}
/**
 * @param {number} at
 */
export function nextSettlementAt(at) { return settlementDayStart(at) + ROLLING_WINDOW_MS; }
/**
 * @param {number} at
 */
export function settlementDayKey(at) { return new Date(settlementDayStart(at)).toISOString().slice(0, 10); }
