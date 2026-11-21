// AI_DAILY_LIMIT: the most AI analyses allowed in any 24 hours across the
// platform. A whole number from 0 to 10000; anything else means 300.
export const DEFAULT_DAILY_LIMIT = 300;

export function parseDailyLimit(value: string | undefined): number {
  const text = value?.trim() ?? "";
  if (!/^\d{1,5}$/.test(text)) return DEFAULT_DAILY_LIMIT;
  const n = Number(text);
  return n <= 10000 ? n : DEFAULT_DAILY_LIMIT;
}
