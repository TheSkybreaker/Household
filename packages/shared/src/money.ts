// Amounts are integer cents everywhere, in the database, the API and the sums. These helpers are
// the only place where they become text, in the Italian format "1.234,50 €".

const MINUS = '−';

const groupThousands = (units: number) => String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// "1.234,50 €" and "−12,00 €"; with sign, positive amounts also get a "+".
export function formatEuro(cents: number, options: { sign?: boolean } = {}): string {
  const absolute = Math.abs(cents);
  const prefix = cents < 0 ? MINUS : options.sign && cents > 0 ? '+' : '';
  return `${prefix}${groupThousands(Math.floor(absolute / 100))},${String(absolute % 100).padStart(2, '0')} €`;
}

// Quotas and allocations drop the cents when they are round: "1.050 €".
export function formatEuroRound(cents: number): string {
  if (cents % 100 !== 0) return formatEuro(cents);
  return `${cents < 0 ? MINUS : ''}${groupThousands(Math.abs(cents) / 100)} €`;
}

// "12,50", "12.50", "1.234,50" and "1234", with or without "€" and spaces; null for anything else.
export function parseAmount(raw: string): number | null {
  const text = raw.replace(/[€\s]/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text) ?? /^(\d+)\.(\d{1,2})$/.exec(text);
  if (!match) return null;
  const [, units, decimals = ''] = match;
  const cents = Number(units.replaceAll('.', '')) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
