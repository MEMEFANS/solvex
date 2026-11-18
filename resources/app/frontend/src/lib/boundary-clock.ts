// Wake at a business deadline, or when its displayed remaining minute changes.
// No future deadlines means no timer. All comparisons use wall time after wake.
export function nextBoundaryDelay(boundaries: readonly number[], now: number, cadence = 0): number | null {
  let next = Infinity;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary) || boundary <= now) continue;
    next = Math.min(next, boundary);
    if (cadence > 0) next = Math.min(next, boundary - Math.floor((boundary - now) / cadence) * cadence);
  }
  return Number.isFinite(next) ? Math.min(2_147_483_647, Math.max(1, next - now + 1)) : null;
}
