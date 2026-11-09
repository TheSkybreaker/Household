import { capitalize, toIsoDate } from '@household/shared/dates';
import { formatEuro, formatEuroRound } from '@household/shared/money';
import type { User } from '@household/shared/pb';
import { toast } from '@household/shared/toast';
import { undoable } from '@household/shared/undo';
import { createMovement, deleteMovement, loadMonth, loadRecentShopping, loadUsers, payQuota, unpayQuota, updateMovement } from './api';
import { restoreMonthCache, restoreUsers, saveMonthCache, saveUsers } from './cache';
import { homePage } from './home-page';
import { dayKind, monthNav, movementRows, paidOnFor, panelState, sweepBreakdown, type EnvelopeRef, type MovementRow } from './month';
import { editForm, newForm, preview, shoppingShortcut, toRecord, validate, type MovementForm } from './movement-form';
import { pieArcs } from './pie';
import { session } from './stores';
import type { CashSummary, EnvelopeSummary, Movement, MonthData, PieSlice } from './types';

const monthFormat = new Intl.DateTimeFormat('it-IT', { month: 'long' });
const dayFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShortFormat = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const parseDay = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day || 1);
};
const today = () => toIsoDate(new Date());

// "ottobre"
export const monthName = (month: string) => monthFormat.format(parseDay(month));
// "1 ott"
const dayShort = (date: string) => dayShortFormat.format(parseDay(date)).replace('.', '');
// Envelope names are typed by people and go into x-html.
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function monthPage() {
  return {
    ...homePage(),
    sheet: null as 'profile' | 'add' | 'movement' | 'sweep' | null,
    data: null as MonthData | null,
    users: Object.fromEntries(restoreUsers().map((user) => [user.id, user])) as Record<string, User>,
    pieRange: 'month' as 'month' | 'all',
    pieSelected: null as string | null,
    form: null as MovementForm | null,
    formError: null as 'amount' | 'envelope' | null,
    formSummary: null as CashSummary | null,
    editing: null as Movement | null,
    shortcut: null as ReturnType<typeof shoppingShortcut>,
    openRow: null as MovementRow | null,
    armed: false,
    fresh: '',
    saving: false,

    async init() {
      this.data = restoreMonthCache();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.reload();
      });
      await Promise.all([this.reload(), this.refreshUsers()]);
    },

    // The month on screen when month is absent.
    async reload(month?: string) {
      const wanted = month ?? this.data?.summary.month;
      try {
        const data = await loadMonth(wanted);
        this.data = data;
        saveMonthCache(data);
      } catch {
        // Offline or a server error: the saved copy of the month, if there is one, else what is shown.
        this.data = restoreMonthCache(wanted) ?? this.data;
      }
    },

    async refreshUsers() {
      try {
        const users = await loadUsers();
        this.users = Object.fromEntries(users.map((user) => [user.id, user]));
        saveUsers(users);
      } catch {
        // The saved names stay.
      }
    },

    get online(): boolean {
      return session().online;
    },
    get meId(): string {
      return session().me?.id ?? '';
    },
    get summary(): CashSummary | null {
      return this.data?.summary ?? null;
    },
    get nav(): ReturnType<typeof monthNav> | null {
      return this.summary ? monthNav(this.summary) : null;
    },
    get panel(): ReturnType<typeof panelState> | null {
      return this.summary ? panelState(this.summary, this.meId) : null;
    },
    get days(): { day: string; rows: MovementRow[] }[] {
      return this.data ? movementRows(this.data.summary, this.data.movements) : [];
    },
    get pie(): ReturnType<typeof pieArcs> {
      const slices: PieSlice[] = this.summary ? this.summary.pie[this.pieRange] : [];
      return pieArcs(slices, this.pieSelected);
    },
    get todayIso(): string {
      return today();
    },
    // Alpine cannot repeat elements inside an <svg>, so the ring is markup; a tap on a slice
    // reaches pieTap through data-envelope.
    get pieSvg(): string {
      const pie = this.pie;
      const paths = pie.arcs
        .map((arc) => `<path d="${arc.path}" fill="var(--e${arc.slot})" stroke="var(--paper)" stroke-width="2" stroke-linejoin="round" opacity="${arc.dimmed ? 0.28 : 1}" data-envelope="${arc.envelope}"><title>${escape(arc.name)}: ${formatEuro(arc.amount)}</title></path>`)
        .join('');
      const selected = pie.selected;
      const centre = selected
        ? `<text x="104" y="86" text-anchor="middle" class="pc1">${escape(selected.name.length > 16 ? `${selected.name.slice(0, 15)}…` : selected.name)}</text><text x="104" y="113" text-anchor="middle" class="pc2">${formatEuroRound(Math.round(selected.amount / 100) * 100)}</text><text x="104" y="133" text-anchor="middle" class="pc3">${selected.percent}% del totale</text>`
        : `<text x="104" y="92" text-anchor="middle" class="pc1">Spesi</text><text x="104" y="120" text-anchor="middle" class="pc2">${formatEuroRound(Math.round(pie.total / 100) * 100)}</text>`;
      return paths + centre;
    },
    pieTap(event: Event) {
      const envelope = (event.target as Element).closest('[data-envelope]')?.getAttribute('data-envelope');
      if (envelope) this.pieSelected = this.pieSelected === envelope ? null : envelope;
    },
    get envelopes(): EnvelopeSummary[] {
      return this.summary?.envelopes ?? [];
    },
    // The envelopes of the month of the form's date.
    get formEnvelopes(): EnvelopeSummary[] {
      return this.formSummary?.envelopes ?? [];
    },

    go(month: string) {
      this.pieSelected = null;
      void this.reload(month);
    },

    // Text helpers for the markup.
    euro: (cents: number) => formatEuro(cents),
    signed: (cents: number) => formatEuro(cents, { sign: true }),
    euroRound: (cents: number) => formatEuroRound(cents),
    heroUnits(cents: number) {
      return formatEuro(cents).split(',')[0];
    },
    heroRest(cents: number) {
      return `,${formatEuro(cents).split(',')[1]}`;
    },
    monthName,
    monthTitle: (month: string) => capitalize(monthName(month)),
    yearOf: (month: string) => month.slice(0, 4),
    dayShort,
    dayLabel(date: string) {
      const kind = dayKind(date, today());
      return kind === 'today' ? 'Oggi' : kind === 'yesterday' ? 'Ieri' : capitalize(dayFormat.format(parseDay(date)));
    },
    nameOf(userId: string) {
      return this.users[userId]?.name ?? session().me?.name ?? '';
    },
    personLabel(userId: string) {
      return userId === this.meId ? 'Tu' : this.nameOf(userId);
    },
    initialOf(userId: string) {
      return (this.nameOf(userId).trim().charAt(0) || '?').toUpperCase();
    },
    avatarClass(userId: string) {
      return this.users[userId]?.color === 'sun' ? 'av-sun' : 'av-sky';
    },
    partnerId() {
      return Object.keys(this.users).find((id) => id !== this.meId) ?? '';
    },
    color: (envelope: EnvelopeRef | { slot: number } | null) => (envelope ? `var(--e${envelope.slot})` : 'var(--line)'),

    panelNote(): string {
      const note = this.panel?.note;
      if (!note) return '';
      if (note.kind === 'incoming') {
        const whose = note.whose === 'both' ? 'con le vostre quote' : note.whose === 'mine' ? 'con la tua quota' : `con la quota di ${this.nameOf(note.userId)}`;
        return `+${formatEuroRound(note.amount)} in arrivo ${whose}`;
      }
      const notes: Record<typeof note.kind, string> = {
        allPaid: 'Tutte e due le quote sono arrivate',
        unset: 'Quote ancora da decidere nella Divisione',
        leftAtEnd: 'Rimasti a fine mese',
        overspent: 'Spesi più di quanto è entrato',
      };
      return notes[note.kind];
    },

    rowTitle(row: MovementRow) {
      if (row.kind === 'quota') return `Quota di ${monthName(this.summary?.month ?? '')}`;
      if (row.kind === 'sweep') return `${row.amount > 0 ? 'Avanzo' : 'Sforamento'} di ${monthName(this.summary?.month ?? '')}`;
      if (row.description) return row.description;
      if (row.kind === 'extra') return 'Versamento extra';
      if (row.kind === 'transfer') return `Saldo di ${row.from?.name ?? 'una busta'}`;
      return row.envelope?.name ?? 'Spesa';
    },
    rowMeta(row: MovementRow) {
      const sweepTo = this.envelopes.find((envelope) => envelope.id === this.summary?.sweepTo)?.name ?? 'fondo';
      if (row.kind === 'quota') return `${row.userId === this.meId ? 'tuo' : `di ${this.nameOf(row.userId)}`}, mensile`;
      if (row.kind === 'sweep') return `${row.amount > 0 ? 'nel' : 'dal'} ${sweepTo}, dalle buste di spesa`;
      if (row.kind === 'transfer') return `da ${row.from?.name ?? 'busta'} a ${row.to?.name ?? 'busta'}`;
      if (row.kind === 'extra') return `extra in ${row.envelope?.name ?? 'busta eliminata'}`;
      return row.envelope?.name ?? 'busta eliminata';
    },
    rowShowsPerson: (row: MovementRow) => row.kind === 'quota' || row.kind === 'spend' || row.kind === 'extra',
    rowIsIn: (row: MovementRow) => row.kind === 'quota' || row.kind === 'extra' || (row.kind === 'sweep' && row.amount > 0),
    rowAmount(row: MovementRow) {
      return row.kind === 'transfer' ? formatEuro(row.amount) : formatEuro(row.amount, { sign: true });
    },

    // Quotas
    async pay() {
      const mine = this.panel?.people.find((person) => person.userId === this.meId);
      if (!mine || !this.summary || !this.online) return;
      try {
        await payQuota(mine.quotaId, paidOnFor(this.summary.month, today()));
        this.fresh = `quota-${mine.quotaId}`;
        await this.reload();
        toast().show('Quota segnata');
      } catch {
        toast().show('Non salvato, riprova');
      }
    },

    // Aggiungi and Modifica
    async openAdd(kind: 'spend' | 'extra' = 'spend', envelopeId: string | null = null) {
      if (!this.summary) return;
      this.editing = null;
      this.form = newForm(kind, envelopeId, this.summary.month, today(), this.meId, this.envelopes);
      this.formSummary = this.summary;
      this.formError = null;
      this.shortcut = null;
      this.sheet = 'add';
      if (kind === 'spend' && this.summary.month === this.summary.current) void this.findShortcut();
    },
    openEdit() {
      const movement = this.openRow?.movement;
      if (!movement) return;
      this.editing = movement;
      this.form = editForm(movement);
      this.formSummary = this.summary;
      this.formError = null;
      this.shortcut = null;
      this.sheet = 'add';
    },
    async findShortcut() {
      try {
        const yesterday = toIsoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const recent = await loadRecentShopping(yesterday);
        this.shortcut = shoppingShortcut(recent.lists, recent.items, recent.movements, today());
      } catch {
        this.shortcut = null;
      }
    },
    // "Spesa veloce, oggi"
    get shortcutTitle(): string {
      return this.shortcut ? `${this.shortcut.title}, ${dayKind(this.shortcut.date, today()) === 'today' ? 'oggi' : 'ieri'}` : '';
    },
    useShortcut() {
      if (!this.form || !this.shortcut) return;
      this.form.description = this.shortcut.title;
      this.form.shoppingList = this.shortcut.listId;
      this.form.envelope = this.envelopes.find((envelope) => envelope.name === 'Spesa')?.id ?? this.form.envelope;
      // The day of the shopping, which may be yesterday and even last month.
      this.form.date = this.shortcut.date;
      this.shortcut = null;
      void this.dateChanged();
    },
    setKind(kind: 'spend' | 'extra') {
      if (!this.form || this.form.kind === kind) return;
      this.form.kind = kind;
      this.formError = null;
      if (kind === 'extra' && this.envelopes.find((envelope) => envelope.id === this.form?.envelope)?.kind !== 'save') {
        this.form.envelope = this.envelopes.find((envelope) => envelope.kind === 'save')?.id ?? this.form.envelope;
      }
    },
    // The preview reads the summary of the form's month, which may not be the one on screen.
    async dateChanged() {
      const month = this.form?.date.slice(0, 7);
      if (!month || month === this.formSummary?.month) return;
      try {
        this.formSummary = month === this.summary?.month ? this.summary : (await loadMonth(month)).summary;
      } catch {
        this.formSummary = null;
      }
    },
    get previewText(): string {
      if (!this.form) return '';
      const result = preview(this.form, this.formSummary, this.editing ?? undefined);
      const name = escape(this.envelopes.find((envelope) => envelope.id === this.form?.envelope)?.name ?? '');
      switch (result.kind) {
        case 'needEnvelope':
          return this.form.kind === 'spend' ? 'Scegli da quale busta prendere i soldi.' : 'Scegli in quale busta metterli.';
        case 'needAmount':
          return "Scrivi l'importo per vedere come cambia la busta.";
        case 'balance':
          return `${name} arriva a <b>${formatEuro(result.amount)}</b>${result.goal ? ` su ${formatEuroRound(result.goal)}` : ''}.`;
        case 'left':
          return `Nella busta ${name} restano <b>${formatEuro(result.amount)}</b>.`;
        case 'over':
          return `La busta ${name} va oltre di <b>${formatEuro(result.amount)}</b>.`;
      }
    },
    async saveForm() {
      if (!this.form || this.saving || !this.online) return;
      this.formError = validate(this.form, this.formEnvelopes);
      if (this.formError) return;
      this.saving = true;
      const record = toRecord(this.form);
      try {
        const saved = this.editing ? await updateMovement(this.editing.id, record) : await createMovement(record, this.meId);
        this.sheet = null;
        this.fresh = saved.id;
        await this.reload(record.date.slice(0, 7));
        toast().show(this.editing ? 'Movimento salvato' : record.kind === 'spend' ? 'Spesa aggiunta' : 'Versamento aggiunto');
      } catch {
        toast().show('Non salvato, riprova');
      } finally {
        this.saving = false;
      }
    },

    // Movimento and Avanzo
    open(row: MovementRow) {
      this.openRow = row;
      this.armed = false;
      this.sheet = row.kind === 'sweep' ? 'sweep' : 'movement';
    },
    get sweepLines(): ReturnType<typeof sweepBreakdown> {
      return this.data ? sweepBreakdown(this.data.summary, this.data.movements) : [];
    },
    get sweepToName(): string {
      return this.envelopes.find((envelope) => envelope.id === this.summary?.sweepTo)?.name ?? 'fondo';
    },
    canUnpay(row: MovementRow | null) {
      return row?.kind === 'quota' && row.userId === this.meId;
    },
    removeOpenRow() {
      const row = this.openRow;
      if (!row || !this.online) return;
      if (!this.armed) {
        this.armed = true;
        return;
      }
      this.sheet = null;
      if (row.kind === 'quota') {
        void undoable('Quota segnata come non versata', {
          run: async () => {
            await unpayQuota(row.quotaId);
            await this.reload();
          },
          undo: async () => {
            await payQuota(row.quotaId, row.date);
            await this.reload();
          },
        });
        return;
      }
      const movement = row.movement;
      if (!movement) return;
      // Annulla writes the movement again as it was, under a new id.
      const record = toRecord(editForm(movement));
      void undoable(`${this.rowTitle(row)} eliminato`, {
        run: async () => {
          await deleteMovement(movement.id);
          await this.reload();
        },
        undo: async () => {
          await createMovement(record, this.meId);
          await this.reload();
        },
      });
    },
  };
}
