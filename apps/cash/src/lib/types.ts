// The month summary of GET /api/cash/summary (backend/cash_summary.go), amounts in cents.
export interface QuotaSummary {
  id: string;
  user: string;
  amount: number;
  paidOn: string;
}

export interface EnvelopeSummary {
  id: string;
  name: string;
  note: string;
  kind: 'spend' | 'save';
  slot: number;
  position: number;
  goal: number;
  openingBalance: number;
  allocated: number;
  extra: number;
  spent: number;
  moved: number;
  sweptIn: number;
  // Spend envelopes have left, savings envelopes balance.
  left?: number;
  balance?: number;
}

export interface PieSlice {
  envelope: string;
  name: string;
  slot: number;
  amount: number;
}

export interface SavingsSeries {
  envelope: string;
  // One per month of the summary, null before the envelope existed.
  balances: (number | null)[];
}

export interface CashSummary {
  month: string;
  current: string;
  // Today in APP_TZ.
  today: string;
  first: string;
  closed: boolean;
  sweepTo: string;
  sweep: number;
  quotas: QuotaSummary[];
  expected: number;
  entered: number;
  extras: number;
  spent: number;
  left: number;
  incoming: number;
  cash: number;
  envelopes: EnvelopeSummary[];
  pie: { month: PieSlice[]; all: PieSlice[] };
  savings: { months: string[]; series: SavingsSeries[] };
}

export interface Movement {
  id: string;
  kind: 'spend' | 'extra' | 'transfer';
  amount: number;
  date: string;
  month: string;
  envelope: string;
  from_envelope: string;
  to_envelope: string;
  reason: '' | 'sweep' | 'archive';
  description: string;
  user: string;
  shopping_list: string;
  created_by: string;
  created: string;
  updated: string;
}

export interface MovementInput {
  kind: 'spend' | 'extra';
  amount: number;
  date: string;
  envelope: string;
  description: string;
  user: string;
  shopping_list: string;
}

export interface MonthData {
  summary: CashSummary;
  movements: Movement[];
}
