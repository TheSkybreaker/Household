import { addDays, capitalize, fromIsoDate, toIsoDate } from '@household/shared/dates';
import { formatEuro, formatEuroRound } from '@household/shared/money';
import { newRecordId, type User } from '@household/shared/pb';
import { toast } from '@household/shared/toast';
import { undoable } from '@household/shared/undo';
import { createMovement, deleteMovement, loadMonth, loadRecentShopping, loadUsers, payQuota, unpayQuota, updateMovement } from './api';
import { restoreMonthCache, restoreUsers, saveMonthCache, saveUsers } from './cache';
import { homePage } from './home-page';
import { dayKind, monthNav, movementRows, paidOnFor, panelState, sweepBreakdown, type EnvelopeRef, type MovementRow } from './month';
import { clampDate, editForm, newForm, preview, refusal, shoppingShortcut, toRecord, validate, withKind, type MovementForm } from './movement-form';
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
const deviceToday = () => toIsoDate(new Date());
const statusOf = (error: unknown) => (error as { status?: number }).status;

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
    // The first load found neither the server nor a saved month.
    loadFailed: false,
    // Today in APP_TZ from the last answer of the server, and the phone's day then.
    serverToday: '',
    loadedOn: '',
    // Counters that let only the latest load of the month, or of the form's month, land.
    loads: 0,
    formLoads: 0,
    forms: 0,

    async init() {
      // The saved copy of this month paints at once, else the last month shown; the server then
      // answers with the current month.
      this.data = restoreMonthCache(deviceToday().slice(0, 7)) ?? restoreMonthCache();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        // Back on another day, the current month again; on the same day, the month on screen.
        void this.load(deviceToday() === this.loadedOn ? this.data?.summary.month : undefined);
      });
      await Promise.all([this.load(), this.refreshUsers()]);
    },

    // Shows month, the current one when absent, unless a newer load started meanwhile.
    async load(month?: string) {
      const ticket = ++this.loads;
      try {
        const data = await loadMonth(month);
        if (ticket !== this.loads) return;
        this.data = data;
        this.serverToday = data.summary.today;
        this.loadedOn = deviceToday();
        this.loadFailed = false;
        saveMonthCache(data);
      } catch {
        if (ticket !== this.loads) return;
        // Offline or a server error: what is shown stays when it is that month, else the saved copy.
        if (month && this.data?.summary.month !== month) this.data = restoreMonthCache(month) ?? this.data;
        this.loadFailed = !this.data;
      }
    },
    // The month on screen, again.
    reload() {
      return this.load(this.data?.summary.month);
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
    // The server's day, so a phone ahead of APP_TZ cannot date a movement in the future; the phone's
    // once it is another day there than at the last answer.
    get today(): string {
      return this.serverToday && this.loadedOn === deviceToday() ? this.serverToday : deviceToday();
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
    // The envelopes of the month of the form's date, those on screen while it cannot be read.
    get formEnvelopes(): EnvelopeSummary[] {
      return (this.formSummary ?? this.summary)?.envelopes ?? [];
    },

    go(month: string) {
      this.pieSelected = null;
      void this.load(month);
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
      const kind = dayKind(date, this.today);
      return kind === 'today' ? 'Oggi' : kind === 'yesterday' ? 'Ieri' : capitalize(dayFormat.format(parseDay(date)));
    },
    nameOf(userId: string) {
      return this.users[userId]?.name ?? (userId === this.meId ? session().me?.name : '') ?? '';
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
        await payQuota(mine.quotaId, paidOnFor(this.summary.month, this.today));
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
      this.forms++;
      this.formLoads++;
      this.form = newForm(newRecordId(), kind, envelopeId, this.summary.month, this.today, this.meId, this.envelopes);
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
      this.forms++;
      this.formLoads++;
      this.form = editForm(movement);
      this.formSummary = this.summary;
      this.formError = null;
      this.shortcut = null;
      this.sheet = 'add';
    },
    async findShortcut() {
      const form = this.forms;
      try {
        const recent = await loadRecentShopping(toIsoDate(addDays(fromIsoDate(this.today), -1)));
        // Ignored when the sheet was closed or holds another form by now.
        if (form === this.forms) this.shortcut = shoppingShortcut(recent.lists, recent.items, recent.movements, this.today);
      } catch {
        this.shortcut = null;
      }
    },
    // "Spesa veloce, oggi"
    get shortcutTitle(): string {
      return this.shortcut ? `${this.shortcut.title}, ${dayKind(this.shortcut.date, this.today) === 'today' ? 'oggi' : 'ieri'}` : '';
    },
    async useShortcut() {
      if (!this.form || !this.shortcut) return;
      this.form.description = this.shortcut.title;
      this.form.shoppingList = this.shortcut.listId;
      // The day of the shopping, which may be yesterday and even last month.
      this.form.date = this.shortcut.date;
      this.shortcut = null;
      const form = this.forms;
      await this.dateChanged();
      if (this.form && form === this.forms) this.form.envelope = this.formEnvelopes.find((envelope) => envelope.name === 'Spesa')?.id ?? this.form.envelope;
    },
    setKind(kind: 'spend' | 'extra') {
      if (!this.form || this.form.kind === kind) return;
      this.form = withKind(this.form, kind, this.formEnvelopes, this.meId);
      this.formError = null;
    },
    // The preview reads the summary of the form's month, which may not be the one on screen.
    async dateChanged() {
      const month = this.form?.date.slice(0, 7);
      if (!month || month === this.formSummary?.month) return;
      const ticket = ++this.formLoads;
      try {
        const summary = month === this.summary?.month ? this.summary : (await loadMonth(month)).summary;
        if (ticket === this.formLoads) this.formSummary = summary;
      } catch {
        // Unknown for now: the chips are those on screen and the server checks the save.
        if (ticket === this.formLoads) this.formSummary = null;
      }
    },
    get previewText(): string {
      if (!this.form) return '';
      const result = preview(this.form, this.formSummary, this.editing ?? undefined);
      const name = escape(this.formEnvelopes.find((envelope) => envelope.id === this.form?.envelope)?.name ?? '');
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
      if (!this.form || this.saving || !this.online || !this.summary) return;
      this.saving = true;
      try {
        this.form.date = clampDate(this.form.date, this.today, this.summary.first);
        await this.dateChanged();
        this.formError = validate(this.form, this.formEnvelopes);
        if (this.formError) return;
        const id = this.form.id;
        const record = toRecord(this.form);
        try {
          if (this.editing) await updateMovement(id, record);
          else await createMovement(record, this.meId, id);
        } catch (error) {
          const refused = refusal((error as { response?: { data?: Record<string, { code?: string }> } }).response?.data);
          if (refused !== 'saved') {
            if (refused) this.formError = refused;
            else toast().show('Non salvato, riprova');
            // An envelope gone meanwhile: the month on screen and then the form's month are read again,
            // which drops its chip.
            if (refused === 'envelope') {
              await this.reload();
              this.formSummary = null;
              await this.dateChanged();
            }
            return;
          }
        }
        this.sheet = null;
        this.fresh = id;
        await this.load(record.date.slice(0, 7));
        toast().show(this.editing ? 'Movimento salvato' : record.kind === 'spend' ? 'Spesa aggiunta' : 'Versamento aggiunto');
        // The new row, drawn by the next frame, comes into view as in the demo.
        requestAnimationFrame(() =>
          document.querySelector(`[data-mv="${id}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }),
        );
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
            try {
              await unpayQuota(row.quotaId);
            } finally {
              await this.reload();
            }
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
          try {
            await deleteMovement(movement.id);
          } catch (error) {
            // Already deleted on the other phone: what was asked is done.
            if (statusOf(error) !== 404) throw error;
          } finally {
            await this.reload();
          }
        },
        undo: async () => {
          await createMovement(record, this.meId, newRecordId());
          await this.reload();
        },
      });
    },
  };
}
