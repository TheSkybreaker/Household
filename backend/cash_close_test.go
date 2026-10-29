package main

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// sweepLine is a sweep transfer with its envelopes by name.
type sweepLine struct {
	date, from, to string
	amount         int
}

func sweeps(t testing.TB, app core.App) []sweepLine {
	t.Helper()
	records, err := app.FindAllRecords("movements", dbx.HashExp{"kind": "transfer", "reason": "sweep"})
	if err != nil {
		t.Fatal(err)
	}
	name := func(id string) string {
		envelope, err := app.FindRecordById("envelopes", id)
		if err != nil {
			t.Fatal(err)
		}
		return envelope.GetString("name")
	}
	lines := make([]sweepLine, 0, len(records))
	for _, record := range records {
		lines = append(lines, sweepLine{record.GetString("date"), name(record.GetString("from_envelope")), name(record.GetString("to_envelope")), record.GetInt("amount")})
	}
	slices.SortFunc(lines, func(a, b sweepLine) int {
		if a.date != b.date {
			return compareStrings(a.date, b.date)
		}
		return compareStrings(a.from+a.to, b.from+b.to)
	})
	return lines
}

func compareStrings(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func monthRecord(t testing.TB, app core.App, month string) *core.Record {
	t.Helper()
	record, err := app.FindFirstRecordByData("months", "month", month)
	if err != nil {
		t.Fatalf("no month %s: %v", month, err)
	}
	return record
}

func monthNames(t testing.TB, app core.App) []string {
	t.Helper()
	records, err := app.FindRecordsByFilter("months", "month != ''", "month", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(records))
	for _, record := range records {
		names = append(names, record.GetString("month"))
	}
	return names
}

func syncMonths(t testing.TB, book *cashBook) {
	t.Helper()
	if err := book.syncMonths(); err != nil {
		t.Fatal(err)
	}
}

var septemberSweeps = []sweepLine{
	{"2026-09-30", "Casa", "Fondo emergenza", 6210},
	{"2026-09-30", "Fondo emergenza", "Spesa", 2500},
	{"2026-09-30", "Svago e uscite", "Fondo emergenza", 6000},
}

func TestSyncMonthsClosesAndOpens(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, septemberOpen) })
	app, book := cashApp(t, f, demoClock)

	syncMonths(t, book)

	october := monthRecord(t, app, "2026-10")
	if october.GetString("sweep_to") != seed.envelopes["fondo"].Id {
		t.Errorf("October avanzo goes to %q, want the Fondo", october.GetString("sweep_to"))
	}
	quotas, err := app.FindAllRecords("month_quotas", dbx.HashExp{"month": october.Id})
	if err != nil {
		t.Fatal(err)
	}
	amounts := map[string]int{}
	for _, quota := range quotas {
		amounts[quota.GetString("user")] = quota.GetInt("amount")
		if quota.GetString("paid_on") != "" {
			t.Errorf("a copied quota is already paid: %v", quota.GetString("paid_on"))
		}
	}
	if len(quotas) != 2 || amounts[f.userA.Id] != 100000 || amounts[f.userB.Id] != 90000 {
		t.Errorf("October quotas = %v", amounts)
	}
	allocations, err := app.FindAllRecords("month_allocations", dbx.HashExp{"month": october.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(allocations) != 5 {
		t.Errorf("October has %d allocations, want 5", len(allocations))
	}
	for _, allocation := range allocations {
		september := seed.allocations["2026-09/"+keyOf(seed, allocation.GetString("envelope"))]
		if allocation.GetInt("amount") != september.GetInt("amount") {
			t.Errorf("allocation %s = %d, want September's %d", allocation.GetString("envelope"), allocation.GetInt("amount"), september.GetInt("amount"))
		}
	}

	if got := sweeps(t, app); !slices.Equal(got, septemberSweeps) {
		t.Errorf("sweeps = %v, want %v", got, septemberSweeps)
	}
	if monthRecord(t, app, "2026-09").GetString("closed_at") == "" {
		t.Error("September is still open")
	}

	s := summaryOf(t, book, app, "2026-09")
	if s.Sweep != 9710 || value(envelopeNamed(t, s, "Casa").Left) != 6210 || value(envelopeNamed(t, s, "Spesa").Left) != -2500 ||
		value(envelopeNamed(t, s, "Svago e uscite").Left) != 6000 || value(envelopeNamed(t, s, "Fondo emergenza").Balance) != 269710 {
		t.Errorf("September after the close: sweep %d, envelopes %+v", s.Sweep, s.Envelopes)
	}
}

func keyOf(seed *cashSeed, envelopeID string) string {
	for key, envelope := range seed.envelopes {
		if envelope.Id == envelopeID {
			return key
		}
	}
	return ""
}

func TestSyncMonthsIsIdempotent(t *testing.T) {
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seedCash(t, app, f, septemberOpen) })
	app, book := cashApp(t, f, demoClock)

	syncMonths(t, book)
	syncMonths(t, book)

	if got, want := monthNames(t, app), []string{"2026-09", "2026-10"}; !slices.Equal(got, want) {
		t.Errorf("months = %v, want %v", got, want)
	}
	if got := sweeps(t, app); !slices.Equal(got, septemberSweeps) {
		t.Errorf("sweeps = %v, want %v", got, septemberSweeps)
	}
}

func TestSyncMonthsFillsGaps(t *testing.T) {
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seedCash(t, app, f, septemberOpen) })
	app, book := cashApp(t, f, time.Date(2026, 12, 2, 9, 0, 0, 0, rome))

	syncMonths(t, book)

	if got, want := monthNames(t, app), []string{"2026-09", "2026-10", "2026-11", "2026-12"}; !slices.Equal(got, want) {
		t.Errorf("months = %v, want %v", got, want)
	}
	want := slices.Clone(septemberSweeps)
	for _, lastDay := range []string{"2026-10-31", "2026-11-30"} {
		want = append(want,
			sweepLine{lastDay, "Casa", "Fondo emergenza", 105000},
			sweepLine{lastDay, "Spesa", "Fondo emergenza", 40000},
			sweepLine{lastDay, "Svago e uscite", "Fondo emergenza", 15000},
		)
	}
	if got := sweeps(t, app); !slices.Equal(got, want) {
		t.Errorf("sweeps = %v, want %v", got, want)
	}
	for month, closed := range map[string]bool{"2026-09": true, "2026-10": true, "2026-11": true, "2026-12": false} {
		if got := monthRecord(t, app, month).GetString("closed_at") != ""; got != closed {
			t.Errorf("%s closed = %v, want %v", month, got, closed)
		}
	}
}

func TestSyncMonthsFirstRun(t *testing.T) {
	f := newFixture(t)
	app, book := cashApp(t, f, demoClock)

	syncMonths(t, book)

	if got, want := monthNames(t, app), []string{"2026-10"}; !slices.Equal(got, want) {
		t.Fatalf("months = %v, want %v", got, want)
	}
	october := monthRecord(t, app, "2026-10")
	if october.GetString("sweep_to") != "" {
		t.Errorf("sweep_to = %q before any envelope exists", october.GetString("sweep_to"))
	}
	quotas, err := app.FindAllRecords("month_quotas", dbx.HashExp{"month": october.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(quotas) != 2 || quotas[0].GetInt("amount") != 0 || quotas[1].GetInt("amount") != 0 {
		t.Errorf("first quotas = %d records", len(quotas))
	}
	allocations, err := app.FindAllRecords("month_allocations", dbx.HashExp{"month": october.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(allocations) != 0 {
		t.Errorf("%d allocations before any envelope exists", len(allocations))
	}
}

func TestArchivedEnvelopeIsNotCopied(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) {
		seed = seedCash(t, app, f, septemberOpen)
		svago := seed.envelopes["svago"]
		svago.Set("archived_from", "2026-10")
		if err := app.Save(svago); err != nil {
			t.Fatal(err)
		}
	})
	app, book := cashApp(t, f, demoClock)

	syncMonths(t, book)

	allocations, err := app.FindAllRecords("month_allocations", dbx.HashExp{"month": monthRecord(t, app, "2026-10").Id})
	if err != nil {
		t.Fatal(err)
	}
	for _, allocation := range allocations {
		if allocation.GetString("envelope") == seed.envelopes["svago"].Id {
			t.Error("October has an allocation for the archived Svago")
		}
	}
	if len(allocations) != 4 {
		t.Errorf("October has %d allocations, want 4", len(allocations))
	}
	if got := sweeps(t, app); !slices.Equal(got, septemberSweeps) {
		t.Errorf("sweeps = %v, want September's, Svago included: %v", got, septemberSweeps)
	}
}

func TestMonthsSyncAtStartAndEveryNight(t *testing.T) {
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seedCash(t, app, f, septemberOpen) })

	f.cashScenarios(t, demoClock, []tests.ApiScenario{{
		Name: "the summary after a start past midnight", Method: http.MethodGet, URL: "/api/cash/summary", Headers: f.authA(),
		ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-10"`, `"expected":190000`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			if monthRecord(t, app, "2026-09").GetString("closed_at") == "" {
				t.Error("September is still open after the start")
			}
			for _, job := range app.Cron().Jobs() {
				if job.Id() == "cashMonths" && job.Expression() == "10 0 * * *" {
					return
				}
			}
			t.Error("no nightly cashMonths job")
		},
	}})
}
