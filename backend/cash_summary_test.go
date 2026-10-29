package main

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// slice is a pie slice or an envelope figure reduced to what the tests compare.
type slice struct {
	name   string
	amount int
}

func pieOf(slices []pieSlice) []slice {
	out := make([]slice, 0, len(slices))
	for _, s := range slices {
		out = append(out, slice{s.Name, s.Amount})
	}
	return out
}

func envelopeNamed(t testing.TB, summary cashSummary, name string) envelopeSummary {
	t.Helper()
	for _, envelope := range summary.Envelopes {
		if envelope.Name == name {
			return envelope
		}
	}
	t.Fatalf("no envelope %q in the summary of %s", name, summary.Month)
	return envelopeSummary{}
}

func value(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}

func summaryOf(t testing.TB, book *cashBook, app core.App, month string) cashSummary {
	t.Helper()
	summary, err := book.summaryOf(app, month)
	if err != nil {
		t.Fatal(err)
	}
	return summary
}

func TestCashSummary(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	app, book := cashApp(t, f, demoClock)

	check := func(t *testing.T, what string, got any, want any) {
		t.Helper()
		if got != want {
			t.Errorf("%s = %v, want %v", what, got, want)
		}
	}
	allPie := []slice{{"Casa", 183790}, {"Vacanze", 64000}, {"Spesa", 47500}, {"Svago e uscite", 9000}}

	t.Run("closed September", func(t *testing.T) {
		s := summaryOf(t, book, app, "2026-09")
		check(t, "month", s.Month, "2026-09")
		check(t, "current", s.Current, "2026-10")
		check(t, "first", s.First, "2026-09")
		check(t, "closed", s.Closed, true)
		check(t, "sweepTo", s.SweepTo, seed.envelopes["fondo"].Id)
		check(t, "entered", s.Entered, 222000)
		check(t, "extras", s.Extras, 32000)
		check(t, "spent", s.Spent, 150290)
		check(t, "left", s.Left, 71710)
		check(t, "incoming", s.Incoming, 0)
		check(t, "expected", s.Expected, 190000)
		check(t, "sweep", s.Sweep, 9710)
		check(t, "cash", s.Cash, 341710)
		check(t, "Casa left", value(envelopeNamed(t, s, "Casa").Left), 6210)
		check(t, "Spesa left", value(envelopeNamed(t, s, "Spesa").Left), -2500)
		check(t, "Svago left", value(envelopeNamed(t, s, "Svago e uscite").Left), 6000)
		check(t, "Fondo sweptIn", envelopeNamed(t, s, "Fondo emergenza").SweptIn, 9710)
		check(t, "Fondo balance", value(envelopeNamed(t, s, "Fondo emergenza").Balance), 269710)
		check(t, "Vacanze balance", value(envelopeNamed(t, s, "Vacanze").Balance), 72000)
		if got, want := pieOf(s.Pie.Month), []slice{{"Casa", 98790}, {"Spesa", 42500}, {"Svago e uscite", 9000}}; !slices.Equal(got, want) {
			t.Errorf("pie of the month = %v, want %v", got, want)
		}
		if got := pieOf(s.Pie.All); !slices.Equal(got, allPie) {
			t.Errorf("pie from the start = %v, want %v", got, allPie)
		}
	})

	t.Run("current October", func(t *testing.T) {
		s := summaryOf(t, book, app, "2026-10")
		check(t, "closed", s.Closed, false)
		check(t, "entered", s.Entered, 150000)
		check(t, "extras", s.Extras, 50000)
		check(t, "spent", s.Spent, 154000)
		check(t, "left", s.Left, -4000)
		check(t, "incoming", s.Incoming, 90000)
		check(t, "expected", s.Expected, 190000)
		check(t, "sweep", s.Sweep, 70000)
		check(t, "cash", s.Cash, 337710)
		check(t, "Casa left", value(envelopeNamed(t, s, "Casa").Left), 20000)
		check(t, "Spesa left", value(envelopeNamed(t, s, "Spesa").Left), 35000)
		check(t, "Svago left", value(envelopeNamed(t, s, "Svago e uscite").Left), 15000)
		check(t, "Fondo sweptIn", envelopeNamed(t, s, "Fondo emergenza").SweptIn, 0)
		check(t, "Fondo balance", value(envelopeNamed(t, s, "Fondo emergenza").Balance), 339710)
		check(t, "Vacanze balance", value(envelopeNamed(t, s, "Vacanze").Balance), 18000)
		check(t, "Casa has no balance", envelopeNamed(t, s, "Casa").Balance == nil, true)
		check(t, "Fondo has no left", envelopeNamed(t, s, "Fondo emergenza").Left == nil, true)
		if got, want := pieOf(s.Pie.Month), []slice{{"Casa", 85000}, {"Vacanze", 64000}, {"Spesa", 5000}}; !slices.Equal(got, want) {
			t.Errorf("pie of the month = %v, want %v", got, want)
		}
		if got := pieOf(s.Pie.All); !slices.Equal(got, allPie) {
			t.Errorf("pie from the start = %v, want %v", got, allPie)
		}
		if len(s.Quotas) != 2 || s.Quotas[0].PaidOn != "2026-10-01" || s.Quotas[1].PaidOn != "" || s.Quotas[0].Amount != 100000 {
			t.Errorf("quotas = %+v", s.Quotas)
		}
		if want := []string{"2026-09", "2026-10"}; !slices.Equal(s.Savings.Months, want) {
			t.Errorf("savings months = %v, want %v", s.Savings.Months, want)
		}
		series := map[string][]int{}
		for _, line := range s.Savings.Series {
			series[line.Envelope] = line.Balances
		}
		if got, want := series[seed.envelopes["fondo"].Id], []int{269710, 339710}; !slices.Equal(got, want) {
			t.Errorf("Fondo series = %v, want %v", got, want)
		}
		if got, want := series[seed.envelopes["vacanze"].Id], []int{72000, 18000}; !slices.Equal(got, want) {
			t.Errorf("Vacanze series = %v, want %v", got, want)
		}
		if len(series) != 2 {
			t.Errorf("savings series of %d envelopes, want 2", len(series))
		}
	})
}

func TestSummaryMonthBounds(t *testing.T) {
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seedCash(t, app, f, octoberCurrent) })
	summary := "/api/cash/summary"

	f.cashScenarios(t, demoClock, []tests.ApiScenario{
		{Name: "before the first month", Method: http.MethodGet, URL: summary + "?month=2026-08", Headers: f.authA(), ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
		{Name: "after the current month", Method: http.MethodGet, URL: summary + "?month=2026-11", Headers: f.authA(), ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
		{Name: "malformed month", Method: http.MethodGet, URL: summary + "?month=2026-9", Headers: f.authA(), ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
		{Name: "guest", Method: http.MethodGet, URL: summary, ExpectedStatus: 401, ExpectedContent: []string{`"data":{}`}},
		{Name: "the current month by default", Method: http.MethodGet, URL: summary, Headers: f.authA(), ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-10"`, `"left":-4000`}},
	})
}

func TestClosedMonthEditKeepsTheSweep(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	app, book := cashApp(t, f, demoClock)

	groceries, err := app.FindRecordById("movements", seed.movements["sep-groceries"].Id)
	if err != nil {
		t.Fatal(err)
	}
	groceries.Set("amount", 40000)
	if err := app.Save(groceries); err != nil {
		t.Fatal(err)
	}

	s := summaryOf(t, book, app, "2026-09")
	if left := value(envelopeNamed(t, s, "Spesa").Left); left != 0 {
		t.Errorf("Spesa left = %v, want 0", left)
	}
	if s.Sweep != 9710 {
		t.Errorf("sweep = %d, want the 9710 the fund received", s.Sweep)
	}
	if balance := value(envelopeNamed(t, s, "Fondo emergenza").Balance); balance != 269710 {
		t.Errorf("Fondo balance = %v, want 269710", balance)
	}
}

func TestTheNewMonthOpensOnFirstUse(t *testing.T) {
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seedCash(t, app, f, octoberCurrent) })
	// 00:05 of November 1st in Rome: the nightly job has not run yet.
	app, book := cashApp(t, f, time.Date(2026, 11, 1, 0, 5, 0, 0, rome))

	s := summaryOf(t, book, app, "")
	if s.Month != "2026-11" || len(s.Quotas) != 2 || len(s.Envelopes) != 5 || s.Envelopes[0].Allocated != 105000 {
		t.Errorf("November before the nightly job: month %s, %d quotas, envelopes %+v", s.Month, len(s.Quotas), s.Envelopes)
	}
	if !summaryOf(t, book, app, "2026-10").Closed {
		t.Error("October is still open")
	}
	if err := book.createEnvelope(app, f.userA.Id, envelopeInput{Name: "Regali", Kind: "spend"}); err != nil {
		t.Errorf("creating an envelope: %v", err)
	}
}
