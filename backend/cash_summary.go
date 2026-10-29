package main

import (
	"errors"
	"net/http"
	"regexp"
	"sort"

	"github.com/pocketbase/pocketbase/core"
)

// cashSummary is everything a Conti screen shows for one month, in cents.
type cashSummary struct {
	Month   string `json:"month"`
	Current string `json:"current"`
	First   string `json:"first"`
	Closed  bool   `json:"closed"`
	SweepTo string `json:"sweepTo"`
	// Sweep is, for a closed month, what the avanzo envelope received; for the open one, what it
	// would receive if the month ended today.
	Sweep     int               `json:"sweep"`
	Quotas    []quotaSummary    `json:"quotas"`
	Expected  int               `json:"expected"`
	Entered   int               `json:"entered"`
	Extras    int               `json:"extras"`
	Spent     int               `json:"spent"`
	Left      int               `json:"left"`
	Incoming  int               `json:"incoming"`
	Cash      int               `json:"cash"`
	Envelopes []envelopeSummary `json:"envelopes"`
	Pie       struct {
		Month []pieSlice `json:"month"`
		All   []pieSlice `json:"all"`
	} `json:"pie"`
	Savings struct {
		Months []string        `json:"months"`
		Series []savingsSeries `json:"series"`
	} `json:"savings"`
}

type quotaSummary struct {
	ID     string `json:"id"`
	User   string `json:"user"`
	Amount int    `json:"amount"`
	PaidOn string `json:"paidOn"`
}

// envelopeSummary has left only for spend envelopes and balance only for savings envelopes.
type envelopeSummary struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Note           string `json:"note"`
	Kind           string `json:"kind"`
	Slot           int    `json:"slot"`
	Position       int    `json:"position"`
	Goal           int    `json:"goal"`
	OpeningBalance int    `json:"openingBalance"`
	Allocated      int    `json:"allocated"`
	Extra          int    `json:"extra"`
	Spent          int    `json:"spent"`
	Moved          int    `json:"moved"`
	SweptIn        int    `json:"sweptIn"`
	Left           *int   `json:"left,omitempty"`
	Balance        *int   `json:"balance,omitempty"`
}

type pieSlice struct {
	Envelope string `json:"envelope"`
	Name     string `json:"name"`
	Slot     int    `json:"slot"`
	Amount   int    `json:"amount"`
}

type savingsSeries struct {
	Envelope string `json:"envelope"`
	Balances []int  `json:"balances"`
}

type envelopeRow struct {
	ID             string `db:"id"`
	Name           string `db:"name"`
	Note           string `db:"note"`
	Kind           string `db:"kind"`
	Slot           int    `db:"slot"`
	Position       int    `db:"position"`
	Goal           int    `db:"goal"`
	OpeningBalance int    `db:"opening_balance"`
	ArchivedFrom   string `db:"archived_from"`
}

type monthRow struct {
	ID       string `db:"id"`
	Month    string `db:"month"`
	SweepTo  string `db:"sweep_to"`
	ClosedAt string `db:"closed_at"`
}

type quotaRow struct {
	ID     string `db:"id"`
	Month  string `db:"month"`
	User   string `db:"user"`
	Amount int    `db:"amount"`
	PaidOn string `db:"paid_on"`
}

// flow is what moved through an envelope in a month. moved leaves out the avanzo transfers, which
// are in sweptIn: positive when the envelope received them.
type flow struct {
	extra, spent, moved, sweptIn int
}

// ledger holds the sums of every month, read with grouped queries: the summary and the month
// close compute from the same numbers.
type ledger struct {
	envelopes   []envelopeRow
	months      []monthRow
	quotas      map[string][]quotaRow
	allocations map[string]map[string]int
	flows       map[string]map[string]*flow
}

func loadLedger(app core.App) (*ledger, error) {
	l := &ledger{quotas: map[string][]quotaRow{}, allocations: map[string]map[string]int{}, flows: map[string]map[string]*flow{}}
	db := app.DB()

	if err := db.NewQuery("SELECT id, name, note, kind, slot, position, goal, opening_balance, archived_from FROM envelopes ORDER BY position, created").All(&l.envelopes); err != nil {
		return nil, err
	}
	if err := db.NewQuery("SELECT id, month, sweep_to, closed_at FROM months ORDER BY month").All(&l.months); err != nil {
		return nil, err
	}

	var quotas []quotaRow
	// By username: rows saved in the same millisecond share created, and the order must not move.
	if err := db.NewQuery("SELECT q.id, m.month, q.user, q.amount, q.paid_on FROM month_quotas q JOIN months m ON m.id = q.month JOIN users u ON u.id = q.user ORDER BY u.username").All(&quotas); err != nil {
		return nil, err
	}
	for _, quota := range quotas {
		l.quotas[quota.Month] = append(l.quotas[quota.Month], quota)
	}

	var allocations []struct {
		Month    string `db:"month"`
		Envelope string `db:"envelope"`
		Amount   int    `db:"amount"`
	}
	if err := db.NewQuery("SELECT m.month, a.envelope, a.amount FROM month_allocations a JOIN months m ON m.id = a.month").All(&allocations); err != nil {
		return nil, err
	}
	for _, allocation := range allocations {
		if l.allocations[allocation.Month] == nil {
			l.allocations[allocation.Month] = map[string]int{}
		}
		l.allocations[allocation.Month][allocation.Envelope] += allocation.Amount
	}

	var sums []struct {
		Month    string `db:"month"`
		Kind     string `db:"kind"`
		Reason   string `db:"reason"`
		Envelope string `db:"envelope"`
		From     string `db:"from_envelope"`
		To       string `db:"to_envelope"`
		Amount   int    `db:"amount"`
	}
	if err := db.NewQuery("SELECT month, kind, reason, envelope, from_envelope, to_envelope, SUM(amount) AS amount FROM movements GROUP BY month, kind, reason, envelope, from_envelope, to_envelope").All(&sums); err != nil {
		return nil, err
	}
	for _, sum := range sums {
		switch sum.Kind {
		case "spend":
			l.flow(sum.Month, sum.Envelope).spent += sum.Amount
		case "extra":
			l.flow(sum.Month, sum.Envelope).extra += sum.Amount
		case "transfer":
			if sum.Reason == "sweep" {
				l.flow(sum.Month, sum.To).sweptIn += sum.Amount
				l.flow(sum.Month, sum.From).sweptIn -= sum.Amount
			} else {
				l.flow(sum.Month, sum.To).moved += sum.Amount
				l.flow(sum.Month, sum.From).moved -= sum.Amount
			}
		}
	}
	return l, nil
}

func (l *ledger) flow(month, envelope string) *flow {
	if l.flows[month] == nil {
		l.flows[month] = map[string]*flow{}
	}
	if l.flows[month][envelope] == nil {
		l.flows[month][envelope] = &flow{}
	}
	return l.flows[month][envelope]
}

// flowOf reads without adding entries.
func (l *ledger) flowOf(month, envelope string) flow {
	if f := l.flows[month][envelope]; f != nil {
		return *f
	}
	return flow{}
}

// activeIn lists, by position, the envelopes that exist in month.
func (l *ledger) activeIn(month string) []envelopeRow {
	var active []envelopeRow
	for _, envelope := range l.envelopes {
		if envelope.ArchivedFrom == "" || month < envelope.ArchivedFrom {
			active = append(active, envelope)
		}
	}
	return active
}

// left is what a spend envelope has left in month before the avanzo goes: allocated, extras and
// transfers in, minus spending.
func (l *ledger) left(envelopeID, month string) int {
	f := l.flowOf(month, envelopeID)
	return l.allocations[month][envelopeID] + f.extra + f.moved - f.spent
}

// balance is what a savings envelope holds at the end of month, from its opening balance on.
func (l *ledger) balance(envelope envelopeRow, month string) int {
	balance := envelope.OpeningBalance
	for m, allocations := range l.allocations {
		if m <= month {
			balance += allocations[envelope.ID]
		}
	}
	for m, flows := range l.flows {
		if f := flows[envelope.ID]; f != nil && m <= month {
			balance += f.extra + f.moved + f.sweptIn - f.spent
		}
	}
	return balance
}

func (l *ledger) month(month string) (monthRow, bool) {
	for _, row := range l.months {
		if row.Month == month {
			return row, true
		}
	}
	return monthRow{}, false
}

// enteredAndSpent is the money in (paid quotas and extras) and out (spending) of month.
func (l *ledger) enteredAndSpent(month string) (paid int, extras int, spent int) {
	for _, quota := range l.quotas[month] {
		if quota.PaidOn != "" {
			paid += quota.Amount
		}
	}
	for _, f := range l.flows[month] {
		extras += f.extra
		spent += f.spent
	}
	return paid, extras, spent
}

func (l *ledger) envelope(id string) (envelopeRow, bool) {
	for _, envelope := range l.envelopes {
		if envelope.ID == id {
			return envelope, true
		}
	}
	return envelopeRow{}, false
}

// pie sums the spending of each envelope over the months in [from, to], largest first.
func (l *ledger) pie(from, to string) []pieSlice {
	spent := map[string]int{}
	for month, flows := range l.flows {
		if month < from || month > to {
			continue
		}
		for envelope, f := range flows {
			spent[envelope] += f.spent
		}
	}
	slices := []pieSlice{}
	for id, amount := range spent {
		if envelope, ok := l.envelope(id); ok && amount > 0 {
			slices = append(slices, pieSlice{Envelope: id, Name: envelope.Name, Slot: envelope.Slot, Amount: amount})
		}
	}
	sort.Slice(slices, func(i, j int) bool {
		if slices[i].Amount != slices[j].Amount {
			return slices[i].Amount > slices[j].Amount
		}
		return slices[i].Name < slices[j].Name
	})
	return slices
}

func (l *ledger) summary(month, current, first string) cashSummary {
	s := cashSummary{Month: month, Current: current, First: first, Quotas: []quotaSummary{}, Envelopes: []envelopeSummary{}}
	row, _ := l.month(month)
	s.Closed = row.ClosedAt != ""
	s.SweepTo = row.SweepTo

	for _, quota := range l.quotas[month] {
		s.Quotas = append(s.Quotas, quotaSummary{ID: quota.ID, User: quota.User, Amount: quota.Amount, PaidOn: quota.PaidOn})
		s.Expected += quota.Amount
	}
	paid, extras, spent := l.enteredAndSpent(month)
	s.Entered, s.Extras, s.Spent = paid+extras, extras, spent
	s.Left = s.Entered - s.Spent
	s.Incoming = s.Expected - paid

	for _, envelope := range l.envelopes {
		s.Cash += envelope.OpeningBalance
	}
	for _, m := range l.months {
		if m.Month <= month {
			paid, extras, spent := l.enteredAndSpent(m.Month)
			s.Cash += paid + extras - spent
		}
	}

	for _, envelope := range l.activeIn(month) {
		f := l.flowOf(month, envelope.ID)
		summary := envelopeSummary{
			ID: envelope.ID, Name: envelope.Name, Note: envelope.Note, Kind: envelope.Kind, Slot: envelope.Slot,
			Position: envelope.Position, Goal: envelope.Goal, OpeningBalance: envelope.OpeningBalance,
			Allocated: l.allocations[month][envelope.ID], Extra: f.extra, Spent: f.spent, Moved: f.moved, SweptIn: f.sweptIn,
		}
		if envelope.Kind == "spend" {
			left := l.left(envelope.ID, month)
			summary.Left = &left
			if !s.Closed {
				s.Sweep += left
			}
		} else {
			balance := l.balance(envelope, month)
			summary.Balance = &balance
		}
		s.Envelopes = append(s.Envelopes, summary)
	}
	if s.Closed {
		s.Sweep = l.flowOf(month, s.SweepTo).sweptIn
	}

	s.Pie.Month = l.pie(month, month)
	s.Pie.All = l.pie(first, current)

	s.Savings.Months = []string{}
	s.Savings.Series = []savingsSeries{}
	for _, m := range l.months {
		if m.Month <= current {
			s.Savings.Months = append(s.Savings.Months, m.Month)
		}
	}
	for _, envelope := range l.activeIn(current) {
		if envelope.Kind != "save" {
			continue
		}
		series := savingsSeries{Envelope: envelope.ID, Balances: []int{}}
		for _, m := range s.Savings.Months {
			series.Balances = append(series.Balances, l.balance(envelope, m))
		}
		s.Savings.Series = append(s.Savings.Series, series)
	}
	return s
}

var (
	monthFormat         = regexp.MustCompile(`^\d{4}-\d{2}$`)
	errMonthOutOfBounds = errors.New("the month is not between the first one and the current one")
)

// summaryOf builds the summary of month, the current one when empty.
func (c *cashBook) summaryOf(app core.App, month string) (cashSummary, error) {
	current := c.currentMonth()
	if month == "" {
		month = current
	}
	first, err := c.firstMonth(app)
	if err != nil {
		return cashSummary{}, err
	}
	if !monthFormat.MatchString(month) || first == "" || month < first || month > current {
		return cashSummary{}, errMonthOutOfBounds
	}
	l, err := loadLedger(app)
	if err != nil {
		return cashSummary{}, err
	}
	return l.summary(month, current, first), nil
}

func (c *cashBook) handleSummary(e *core.RequestEvent) error {
	summary, err := c.summaryOf(e.App, e.Request.URL.Query().Get("month"))
	if errors.Is(err, errMonthOutOfBounds) {
		return e.BadRequestError("Choose a month between the first one and the current one.", nil)
	}
	if err != nil {
		return err
	}
	return e.JSON(http.StatusOK, summary)
}
