package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

var rome = func() *time.Location {
	location, err := time.LoadLocation("Europe/Rome")
	if err != nil {
		panic(err)
	}
	return location
}()

// demoClock is the now of the demo scenario: October 2026 is the current month.
var demoClock = time.Date(2026, 10, 15, 10, 0, 0, 0, rome)

func fixedClock(now time.Time) func() time.Time {
	return func() time.Time { return now }
}

type cashStage int

const (
	// septemberOpen has September with its movements, not closed yet, and no October.
	septemberOpen cashStage = iota
	// octoberCurrent closes September with its sweeps and adds October with its movements.
	octoberCurrent
)

// cashSeed holds the records of the demo scenario. Quotas are keyed "2026-10/usera", allocations
// "2026-10/casa", movements by the names given in seedCash.
type cashSeed struct {
	envelopes   map[string]*core.Record
	months      map[string]*core.Record
	quotas      map[string]*core.Record
	allocations map[string]*core.Record
	movements   map[string]*core.Record
}

// seedCash writes the demo scenario of the plan, without the Conti hooks.
func seedCash(t testing.TB, app core.App, f *fixture, stage cashStage) *cashSeed {
	t.Helper()
	seed := &cashSeed{
		envelopes:   map[string]*core.Record{},
		months:      map[string]*core.Record{},
		quotas:      map[string]*core.Record{},
		allocations: map[string]*core.Record{},
		movements:   map[string]*core.Record{},
	}
	save := func(collectionName string, data map[string]any) *core.Record {
		t.Helper()
		collection, err := app.FindCollectionByNameOrId(collectionName)
		if err != nil {
			t.Fatal(err)
		}
		record := core.NewRecord(collection)
		record.Load(data)
		if err := app.Save(record); err != nil {
			t.Fatalf("seeding %s %v: %v", collectionName, data, err)
		}
		return record
	}

	envelopes := []struct {
		key, name, kind           string
		allocation, goal, opening int
	}{
		{"casa", "Casa", "spend", 105000, 0, 0},
		{"spesa", "Spesa", "spend", 40000, 0, 0},
		{"fondo", "Fondo emergenza", "save", 20000, 600000, 240000},
		{"vacanze", "Vacanze", "save", 10000, 200000, 30000},
		{"svago", "Svago e uscite", "spend", 15000, 0, 0},
	}
	for i, envelope := range envelopes {
		seed.envelopes[envelope.key] = save("envelopes", map[string]any{
			"name": envelope.name, "kind": envelope.kind, "goal": envelope.goal, "opening_balance": envelope.opening,
			"slot": i + 1, "position": i + 1, "created_by": f.userA.Id,
		})
	}

	addMonth := func(month string, paidA string, paidB string) {
		seed.months[month] = save("months", map[string]any{"month": month, "sweep_to": seed.envelopes["fondo"].Id})
		seed.quotas[month+"/usera"] = save("month_quotas", map[string]any{"month": seed.months[month].Id, "user": f.userA.Id, "amount": 100000, "paid_on": paidA})
		seed.quotas[month+"/userb"] = save("month_quotas", map[string]any{"month": seed.months[month].Id, "user": f.userB.Id, "amount": 90000, "paid_on": paidB})
		for _, envelope := range envelopes {
			seed.allocations[month+"/"+envelope.key] = save("month_allocations", map[string]any{
				"month": seed.months[month].Id, "envelope": seed.envelopes[envelope.key].Id, "amount": envelope.allocation,
			})
		}
	}
	movement := func(name string, data map[string]any) {
		data["month"] = data["date"].(string)[:7]
		data["created_by"] = f.userA.Id
		seed.movements[name] = save("movements", data)
	}
	spend := func(name string, date string, amount int, envelope string, description string, by *core.Record) {
		movement(name, map[string]any{"kind": "spend", "date": date, "amount": amount, "envelope": seed.envelopes[envelope].Id, "description": description, "user": by.Id})
	}
	extra := func(name string, date string, amount int, envelope string, description string, by *core.Record) {
		movement(name, map[string]any{"kind": "extra", "date": date, "amount": amount, "envelope": seed.envelopes[envelope].Id, "description": description, "user": by.Id})
	}
	sweep := func(name string, amount int, from string, to string) {
		movement(name, map[string]any{"kind": "transfer", "reason": "sweep", "date": "2026-09-30", "amount": amount, "from_envelope": seed.envelopes[from].Id, "to_envelope": seed.envelopes[to].Id})
	}

	addMonth("2026-09", "2026-09-01", "2026-09-03")
	spend("sep-rent", "2026-09-01", 85000, "casa", "Affitto", f.userA)
	spend("sep-internet", "2026-09-02", 2790, "casa", "Internet fibra", f.userA)
	spend("sep-power", "2026-09-14", 11000, "casa", "Luce e gas", f.userB)
	spend("sep-groceries", "2026-09-10", 42500, "spesa", "Esselunga", f.userB)
	spend("sep-fun", "2026-09-12", 9000, "svago", "Pizzeria", f.userA)
	extra("sep-refund", "2026-09-22", 32000, "vacanze", "Rimborso 730", f.userB)
	if stage == septemberOpen {
		return seed
	}

	sweep("sweep-casa", 6210, "casa", "fondo")
	sweep("sweep-spesa", 2500, "fondo", "spesa")
	sweep("sweep-svago", 6000, "svago", "fondo")
	seed.months["2026-09"].Set("closed_at", "2026-10-01 00:10:00.000Z")
	if err := app.Save(seed.months["2026-09"]); err != nil {
		t.Fatal(err)
	}

	addMonth("2026-10", "2026-10-01", "")
	spend("oct-rent", "2026-10-01", 85000, "casa", "Affitto", f.userA)
	spend("oct-groceries", "2026-10-06", 5000, "spesa", "Lidl", f.userB)
	spend("oct-hotel", "2026-10-09", 64000, "vacanze", "Hotel in Liguria", f.userB)
	extra("oct-bonus", "2026-10-12", 50000, "fondo", "Premio", f.userA)
	return seed
}

// cashApp registers Conti on a test app opened on the fixture data dir.
func cashApp(t testing.TB, f *fixture, now time.Time) (*tests.TestApp, *cashBook) {
	t.Helper()
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	return app, registerCash(app, testConfig(false), fixedClock(now))
}

// cashScenarios runs scenarios with Conti registered on the given clock.
func (f *fixture) cashScenarios(t *testing.T, now time.Time, scenarios []tests.ApiScenario) {
	f.runWith(t, func(t testing.TB, app core.App) {
		registerCash(app, testConfig(false), fixedClock(now))
	}, scenarios)
}

func TestTodayFollowsRome(t *testing.T) {
	for _, test := range []struct {
		now          time.Time
		today, month string
	}{
		{time.Date(2026, 10, 31, 23, 30, 0, 0, time.UTC), "2026-11-01", "2026-11"},
		{time.Date(2026, 10, 31, 21, 59, 0, 0, time.UTC), "2026-10-31", "2026-10"},
	} {
		book := &cashBook{loc: rome, now: fixedClock(test.now)}
		if book.today() != test.today || book.currentMonth() != test.month {
			t.Errorf("at %s: today %s, month %s; want %s and %s", test.now, book.today(), book.currentMonth(), test.today, test.month)
		}
	}
}

func TestCashRules(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	records := func(collection string) string { return "/api/collections/" + collection + "/records" }
	record := func(collection string, r *core.Record) string { return records(collection) + "/" + r.Id }
	body := func(json string) *strings.Reader { return strings.NewReader(json) }

	scenarios := []tests.ApiScenario{
		{Name: "guest lists movements", Method: http.MethodGet, URL: records("movements"), ExpectedStatus: 200, ExpectedContent: []string{`"totalItems":0`}},
		{Name: "user lists movements", Method: http.MethodGet, URL: records("movements"), Headers: f.authA(), ExpectedStatus: 200, ExpectedContent: []string{`"totalItems":13`}},
		{Name: "user renames an envelope", Method: http.MethodPatch, URL: record("envelopes", seed.envelopes["casa"]), Headers: f.authA(), Body: body(`{"name":"Casa e bollette","note":"Affitto"}`), ExpectedStatus: 200, ExpectedContent: []string{`"name":"Casa e bollette"`}},
		{Name: "user changes an envelope kind", Method: http.MethodPatch, URL: record("envelopes", seed.envelopes["casa"]), Headers: f.authA(), Body: body(`{"kind":"save"}`), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "user changes an envelope slot", Method: http.MethodPatch, URL: record("envelopes", seed.envelopes["casa"]), Headers: f.authA(), Body: body(`{"slot":6}`), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "user writes a transfer", Method: http.MethodPost, URL: records("movements"), Headers: f.authA(),
			Body:           body(`{"kind":"transfer","reason":"sweep","amount":100,"date":"2026-10-14","from_envelope":"` + seed.envelopes["casa"].Id + `","to_envelope":"` + seed.envelopes["fondo"].Id + `","created_by":"` + f.userA.Id + `"}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
		{Name: "user writes a spend in the other person's name", Method: http.MethodPost, URL: records("movements"), Headers: f.authA(),
			Body:           body(`{"kind":"spend","amount":100,"date":"2026-10-14","envelope":"` + seed.envelopes["casa"].Id + `","user":"` + f.userB.Id + `","created_by":"` + f.userB.Id + `"}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`}},
		{Name: "user edits a sweep", Method: http.MethodPatch, URL: record("movements", seed.movements["sweep-casa"]), Headers: f.authA(), Body: body(`{"amount":1}`), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "user deletes a sweep", Method: http.MethodDelete, URL: record("movements", seed.movements["sweep-casa"]), Headers: f.authA(), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "user marks the other quota as paid", Method: http.MethodPatch, URL: record("month_quotas", seed.quotas["2026-10/userb"]), Headers: f.authA(), Body: body(`{"paid_on":"2026-10-14"}`), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "user marks the own quota as paid", Method: http.MethodPatch, URL: record("month_quotas", seed.quotas["2026-10/usera"]), Headers: f.authA(), Body: body(`{"paid_on":"2026-10-14"}`), ExpectedStatus: 200, ExpectedContent: []string{`"paid_on":"2026-10-14"`}},
		{Name: "user changes a quota of a closed month", Method: http.MethodPatch, URL: record("month_quotas", seed.quotas["2026-09/usera"]), Headers: f.authA(), Body: body(`{"amount":1}`), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
	}
	for _, collection := range []string{"envelopes", "months", "month_quotas", "month_allocations"} {
		scenarios = append(scenarios, tests.ApiScenario{
			Name: "user creates in " + collection, Method: http.MethodPost, URL: records(collection), Headers: f.authA(), Body: body(`{}`),
			ExpectedStatus: 403, ExpectedContent: []string{`"data":{}`},
		})
	}
	f.cashScenarios(t, demoClock, scenarios)
}

func TestActiveSlotIsUnique(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	app, _ := cashApp(t, f, demoClock)

	newEnvelope := func() error {
		collection, err := app.FindCollectionByNameOrId("envelopes")
		if err != nil {
			t.Fatal(err)
		}
		envelope := core.NewRecord(collection)
		envelope.Load(map[string]any{"name": "Regali", "kind": "spend", "slot": 3, "position": 6, "created_by": f.userA.Id})
		return app.Save(envelope)
	}
	if err := newEnvelope(); err == nil {
		t.Fatal("a second active envelope took slot 3")
	}

	fondo, err := app.FindRecordById("envelopes", seed.envelopes["fondo"].Id)
	if err != nil {
		t.Fatal(err)
	}
	fondo.Set("archived_from", "2026-10")
	if err := app.Save(fondo); err != nil {
		t.Fatal(err)
	}
	if err := newEnvelope(); err != nil {
		t.Fatalf("slot 3 of an archived envelope is not free: %v", err)
	}
}

func TestDeletingAListKeepsItsMovement(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	app, _ := cashApp(t, f, demoClock)

	groceries, err := app.FindRecordById("movements", seed.movements["oct-groceries"].Id)
	if err != nil {
		t.Fatal(err)
	}
	groceries.Set("shopping_list", f.list.Id)
	if err := app.Save(groceries); err != nil {
		t.Fatal(err)
	}
	list, err := app.FindRecordById("lists", f.list.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(list); err != nil {
		t.Fatal(err)
	}

	groceries, err = app.FindRecordById("movements", groceries.Id)
	if err != nil {
		t.Fatalf("the movement went with its list: %v", err)
	}
	if linked := groceries.GetString("shopping_list"); linked != "" {
		t.Errorf("shopping_list is %q after deleting the list", linked)
	}
}
