package main

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func allocationOf(t testing.TB, app core.App, month string, envelopeID string) (int, bool) {
	t.Helper()
	records, err := app.FindAllRecords("month_allocations", dbx.HashExp{"month": monthRecord(t, app, month).Id, "envelope": envelopeID})
	if err != nil {
		t.Fatal(err)
	}
	if len(records) == 0 {
		return 0, false
	}
	return records[0].GetInt("amount"), true
}

func hasEnvelope(summary cashSummary, name string) bool {
	for _, envelope := range summary.Envelopes {
		if envelope.Name == name {
			return true
		}
	}
	return false
}

func mustArchive(t testing.TB, book *cashBook, app core.App, id string, to string) {
	t.Helper()
	if err := book.archiveEnvelope(app, id, to); err != nil {
		t.Fatal(err)
	}
}

func mustCreate(t testing.TB, book *cashBook, app core.App, by string, in envelopeInput) *core.Record {
	t.Helper()
	if err := book.createEnvelope(app, by, in); err != nil {
		t.Fatal(err)
	}
	envelope, err := app.FindFirstRecordByData("envelopes", "name", in.Name)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestCreateEnvelope(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })

	t.Run("in the lowest free slot, after the others", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		regali := mustCreate(t, book, app, f.userA.Id, envelopeInput{Name: "Regali", Kind: "spend", Amount: 5000})
		if regali.GetInt("slot") != 6 || regali.GetInt("position") != 6 {
			t.Errorf("slot %d, position %d; want 6 and 6", regali.GetInt("slot"), regali.GetInt("position"))
		}
		if allocated := envelopeNamed(t, summaryOf(t, book, app, "2026-10"), "Regali").Allocated; allocated != 5000 {
			t.Errorf("allocated %d, want 5000", allocated)
		}
		if err := book.createEnvelope(app, f.userA.Id, envelopeInput{Name: "Settima", Kind: "spend"}); err == nil {
			t.Error("a seventh active envelope was created")
		}
	})

	t.Run("a savings envelope with money set aside, in the slot of an archived one", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, seed.envelopes["svago"].Id, seed.envelopes["spesa"].Id)
		auto := mustCreate(t, book, app, f.userA.Id, envelopeInput{Name: "Auto", Kind: "save", Amount: 3000, Goal: 500000, OpeningBalance: 120000})
		if auto.GetInt("slot") != 5 {
			t.Errorf("slot %d, want 5", auto.GetInt("slot"))
		}
		if balance := value(envelopeNamed(t, summaryOf(t, book, app, "2026-10"), "Auto").Balance); balance != 123000 {
			t.Errorf("balance %v, want 123000", balance)
		}
	})

	t.Run("invalid input", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		for _, in := range []envelopeInput{
			{Name: "Regali", Kind: "spend", Goal: 100},
			{Name: "", Kind: "spend"},
			{Name: "Regali", Kind: "other"},
			{Name: "Regali", Kind: "spend", Amount: -1},
			{Name: strings.Repeat("a", 25), Kind: "spend"},
		} {
			if err := book.createEnvelope(app, f.userA.Id, in); err == nil {
				t.Errorf("created %+v", in)
			}
		}
	})

	t.Run("the first savings envelope takes the avanzo", func(t *testing.T) {
		empty := newFixture(t)
		app, book := cashApp(t, empty, demoClock)
		syncMonths(t, book)
		fondo := mustCreate(t, book, app, empty.userA.Id, envelopeInput{Name: "Fondo emergenza", Kind: "save", Amount: 20000})
		if sweepTo := monthRecord(t, app, "2026-10").GetString("sweep_to"); sweepTo != fondo.Id {
			t.Errorf("sweep_to = %q, want the new Fondo", sweepTo)
		}
	})
}

func TestArchiveEnvelope(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	id := func(key string) string { return seed.envelopes[key].Id }

	t.Run("a spend envelope", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, id("svago"), id("spesa"))
		if amount, _ := allocationOf(t, app, "2026-10", id("spesa")); amount != 55000 {
			t.Errorf("Spesa allocation %d, want 55000", amount)
		}
		if _, ok := allocationOf(t, app, "2026-10", id("svago")); ok {
			t.Error("Svago keeps an October allocation")
		}
		svago, err := app.FindRecordById("envelopes", id("svago"))
		if err != nil {
			t.Fatal(err)
		}
		if svago.GetString("archived_from") != "2026-10" {
			t.Errorf("archived_from = %q", svago.GetString("archived_from"))
		}
		if hasEnvelope(summaryOf(t, book, app, "2026-10"), "Svago e uscite") {
			t.Error("Svago is still in October")
		}
		if left := value(envelopeNamed(t, summaryOf(t, book, app, "2026-09"), "Svago e uscite").Left); left != 6000 {
			t.Errorf("September Svago left %v, want 6000", left)
		}
	})

	t.Run("a savings envelope moves its balance", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, id("vacanze"), id("fondo"))
		hotel, err := app.FindRecordById("movements", seed.movements["oct-hotel"].Id)
		if err != nil {
			t.Fatal(err)
		}
		if hotel.GetString("envelope") != id("fondo") {
			t.Error("the October hotel spend stayed on Vacanze")
		}
		if amount, _ := allocationOf(t, app, "2026-10", id("fondo")); amount != 30000 {
			t.Errorf("Fondo allocation %d, want 30000", amount)
		}
		transfers, err := app.FindAllRecords("movements", dbx.HashExp{"kind": "transfer", "reason": "archive"})
		if err != nil {
			t.Fatal(err)
		}
		if len(transfers) != 1 || transfers[0].GetString("from_envelope") != id("vacanze") || transfers[0].GetString("to_envelope") != id("fondo") ||
			transfers[0].GetInt("amount") != 72000 || transfers[0].GetString("date") != "2026-10-15" {
			t.Errorf("archive transfers = %v", transfers)
		}
		if balance := value(envelopeNamed(t, summaryOf(t, book, app, "2026-10"), "Fondo emergenza").Balance); balance != 357710 {
			t.Errorf("Fondo balance %v, want 357710", balance)
		}
	})

	t.Run("the avanzo envelope", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, id("fondo"), id("vacanze"))
		if sweepTo := monthRecord(t, app, "2026-10").GetString("sweep_to"); sweepTo != id("vacanze") {
			t.Errorf("sweep_to = %q, want Vacanze", sweepTo)
		}
	})

	t.Run("refused", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		if err := book.archiveEnvelope(app, id("casa"), id("casa")); err == nil {
			t.Error("archived into itself")
		}
		mustArchive(t, book, app, id("svago"), id("spesa"))
		if err := book.archiveEnvelope(app, id("casa"), id("svago")); err == nil {
			t.Error("archived into an archived envelope")
		}
		if err := book.archiveEnvelope(app, id("svago"), id("casa")); err == nil {
			t.Error("archived an archived envelope")
		}
	})
}

func TestUnarchiveEnvelope(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	vacanze, fondo := seed.envelopes["vacanze"].Id, seed.envelopes["fondo"].Id

	t.Run("the same day", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		before := summaryOf(t, book, app, "2026-10")
		mustArchive(t, book, app, vacanze, fondo)
		if err := book.unarchiveEnvelope(app, vacanze); err != nil {
			t.Fatal(err)
		}
		if after := summaryOf(t, book, app, "2026-10"); !reflect.DeepEqual(after, before) {
			t.Errorf("after the undo:\n%+v\nbefore archiving:\n%+v", after, before)
		}
	})

	t.Run("the day after", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, vacanze, fondo)
		tomorrow := &cashBook{app: app, loc: rome, now: fixedClock(demoClock.Add(24 * time.Hour))}
		if err := tomorrow.unarchiveEnvelope(app, vacanze); err == nil {
			t.Error("an archive of yesterday was undone")
		}
	})

	t.Run("its slot taken", func(t *testing.T) {
		app, book := cashApp(t, f, demoClock)
		mustArchive(t, book, app, vacanze, fondo)
		mustCreate(t, book, app, f.userA.Id, envelopeInput{Name: "Regali", Kind: "spend"})
		if err := book.unarchiveEnvelope(app, vacanze); err == nil {
			t.Error("two active envelopes in slot 4")
		}
	})
}

func TestEnvelopeRoutes(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	vacanze, fondo := seed.envelopes["vacanze"].Id, seed.envelopes["fondo"].Id
	archiveVacanze := func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		book := &cashBook{app: app, loc: rome, now: fixedClock(demoClock)}
		if err := book.archiveEnvelope(app, vacanze, fondo); err != nil {
			t.Fatal(err)
		}
	}

	f.cashScenarios(t, demoClock, []tests.ApiScenario{
		{Name: "guest creates", Method: http.MethodPost, URL: "/api/cash/envelopes", Body: strings.NewReader(`{"name":"Regali","kind":"spend"}`), ExpectedStatus: 401, ExpectedContent: []string{`"data":{}`}},
		{Name: "user creates", Method: http.MethodPost, URL: "/api/cash/envelopes", Headers: f.authA(), Body: strings.NewReader(`{"name":"Regali","kind":"spend","amount":5000}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-10"`, `"name":"Regali"`, `"allocated":5000`}},
		{Name: "user creates a spend envelope with a goal", Method: http.MethodPost, URL: "/api/cash/envelopes", Headers: f.authA(), Body: strings.NewReader(`{"name":"Regali","kind":"spend","goal":100}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"goal":{`}},
		{Name: "user archives", Method: http.MethodPost, URL: "/api/cash/envelopes/" + vacanze + "/archive", Headers: f.authA(), Body: strings.NewReader(`{"to":"` + fondo + `"}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-10"`}, NotExpectedContent: []string{`"name":"Vacanze"`}},
		{Name: "user undoes the archive", Method: http.MethodPost, URL: "/api/cash/envelopes/" + vacanze + "/unarchive", Headers: f.authA(), BeforeTestFunc: archiveVacanze,
			ExpectedStatus: 200, ExpectedContent: []string{`"name":"Vacanze"`}},
		{Name: "user undoes what was never archived", Method: http.MethodPost, URL: "/api/cash/envelopes/" + vacanze + "/unarchive", Headers: f.authA(),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
	})
}
