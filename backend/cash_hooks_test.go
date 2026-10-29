package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestMovementValidation(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	movements := "/api/collections/movements/records"
	spend := func(date string, envelope string) *strings.Reader {
		return strings.NewReader(`{"kind":"spend","amount":1200,"date":"` + date + `","envelope":"` + seed.envelopes[envelope].Id +
			`","user":"` + f.userA.Id + `","created_by":"` + f.userA.Id + `"}`)
	}
	archiveSvago := func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		svago, err := app.FindRecordById("envelopes", seed.envelopes["svago"].Id)
		if err != nil {
			t.Fatal(err)
		}
		svago.Set("archived_from", "2026-10")
		if err := app.Save(svago); err != nil {
			t.Fatal(err)
		}
	}

	f.cashScenarios(t, demoClock, []tests.ApiScenario{
		{Name: "spend of yesterday", Method: http.MethodPost, URL: movements, Headers: f.authA(), Body: spend("2026-10-14", "casa"), ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-10"`}},
		{Name: "spend without envelope", Method: http.MethodPost, URL: movements, Headers: f.authA(),
			Body:           strings.NewReader(`{"kind":"spend","amount":1200,"date":"2026-10-14","user":"` + f.userA.Id + `","created_by":"` + f.userA.Id + `"}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"envelope":{`}},
		{Name: "spend of tomorrow", Method: http.MethodPost, URL: movements, Headers: f.authA(), Body: spend("2026-10-16", "casa"), ExpectedStatus: 400, ExpectedContent: []string{`"date":{`}},
		{Name: "spend on a day that does not exist", Method: http.MethodPost, URL: movements, Headers: f.authA(),
			Body: strings.NewReader(`{"kind":"spend","amount":1200,"date":"2026-09-31","month":"2026-10","envelope":"` + seed.envelopes["casa"].Id +
				`","user":"` + f.userA.Id + `","created_by":"` + f.userA.Id + `"}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"date":{`}},
		{Name: "spend before the first month", Method: http.MethodPost, URL: movements, Headers: f.authA(), Body: spend("2026-08-31", "casa"), ExpectedStatus: 400, ExpectedContent: []string{`"date":{`}},
		{Name: "extra without whose money it is", Method: http.MethodPost, URL: movements, Headers: f.authA(),
			Body:           strings.NewReader(`{"kind":"extra","amount":1200,"date":"2026-10-14","envelope":"` + seed.envelopes["fondo"].Id + `","created_by":"` + f.userA.Id + `"}`),
			ExpectedStatus: 400, ExpectedContent: []string{`"user":{`}},
		{Name: "spend on an archived envelope", Method: http.MethodPost, URL: movements, Headers: f.authA(), Body: spend("2026-10-02", "svago"), BeforeTestFunc: archiveSvago, ExpectedStatus: 400, ExpectedContent: []string{`"envelope":{`}},
		{Name: "spend on an archived envelope before it went", Method: http.MethodPost, URL: movements, Headers: f.authA(), Body: spend("2026-09-20", "svago"), BeforeTestFunc: archiveSvago, ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-09"`}},
		{Name: "spend moved to another month", Method: http.MethodPatch, URL: movements + "/" + seed.movements["oct-groceries"].Id, Headers: f.authA(),
			Body: strings.NewReader(`{"date":"2026-09-28"}`), ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-09"`}},
	})
}

func TestTransfersAreCheckedToo(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	app, _ := cashApp(t, f, demoClock)

	collection, err := app.FindCollectionByNameOrId("movements")
	if err != nil {
		t.Fatal(err)
	}
	transfer := core.NewRecord(collection)
	transfer.Load(map[string]any{
		"kind": "transfer", "reason": "sweep", "amount": 100, "date": "2026-10-14", "created_by": f.userA.Id,
		"from_envelope": seed.envelopes["casa"].Id, "to_envelope": seed.envelopes["casa"].Id,
	})
	if err := app.Save(transfer); err == nil || !strings.Contains(err.Error(), "to_envelope") {
		t.Errorf("a transfer from an envelope to itself saved: %v", err)
	}
}

func TestMovementDateUsesRomeTime(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	// 00:30 of November 1st in Rome.
	now := time.Date(2026, 10, 31, 23, 30, 0, 0, time.UTC)

	f.cashScenarios(t, now, []tests.ApiScenario{
		{Name: "spend of the first minutes of November", Method: http.MethodPost, URL: "/api/collections/movements/records", Headers: f.authA(),
			Body: strings.NewReader(`{"kind":"spend","amount":1200,"date":"2026-11-01","envelope":"` + seed.envelopes["casa"].Id +
				`","user":"` + f.userA.Id + `","created_by":"` + f.userA.Id + `"}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"month":"2026-11"`}},
	})
}

func TestCashUpdates(t *testing.T) {
	var seed *cashSeed
	f := newFixtureWith(t, func(t testing.TB, app core.App, f *fixture) { seed = seedCash(t, app, f, octoberCurrent) })
	record := func(collection string, r *core.Record) string {
		return "/api/collections/" + collection + "/records/" + r.Id
	}
	body := func(json string) *strings.Reader { return strings.NewReader(json) }
	sweepTo := func(envelope string) *strings.Reader {
		return body(`{"sweep_to":"` + seed.envelopes[envelope].Id + `"}`)
	}

	f.cashScenarios(t, demoClock, []tests.ApiScenario{
		{Name: "avanzo to a savings envelope", Method: http.MethodPatch, URL: record("months", seed.months["2026-10"]), Headers: f.authA(), Body: sweepTo("vacanze"), ExpectedStatus: 200, ExpectedContent: []string{`"sweep_to":"` + seed.envelopes["vacanze"].Id}},
		{Name: "avanzo to a spend envelope", Method: http.MethodPatch, URL: record("months", seed.months["2026-10"]), Headers: f.authA(), Body: sweepTo("casa"), ExpectedStatus: 400, ExpectedContent: []string{`"sweep_to":{`}},
		{Name: "avanzo to nowhere", Method: http.MethodPatch, URL: record("months", seed.months["2026-10"]), Headers: f.authA(), Body: body(`{"sweep_to":""}`), ExpectedStatus: 400, ExpectedContent: []string{`"sweep_to":{`}},
		{Name: "avanzo of a past month", Method: http.MethodPatch, URL: record("months", seed.months["2026-09"]), Headers: f.authA(), Body: sweepTo("vacanze"), ExpectedStatus: 400, ExpectedContent: []string{`"month":{`}},
		{Name: "allocation of this month", Method: http.MethodPatch, URL: record("month_allocations", seed.allocations["2026-10/casa"]), Headers: f.authA(), Body: body(`{"amount":110000}`), ExpectedStatus: 200, ExpectedContent: []string{`"amount":110000`}},
		{Name: "allocation of a past month", Method: http.MethodPatch, URL: record("month_allocations", seed.allocations["2026-09/casa"]), Headers: f.authA(), Body: body(`{"amount":110000}`), ExpectedStatus: 400, ExpectedContent: []string{`"month":{`}},
		{Name: "quota paid tomorrow", Method: http.MethodPatch, URL: record("month_quotas", seed.quotas["2026-10/usera"]), Headers: f.authA(), Body: body(`{"paid_on":"2026-10-16"}`), ExpectedStatus: 400, ExpectedContent: []string{`"paid_on":{`}},
		{Name: "goal on a spend envelope", Method: http.MethodPatch, URL: record("envelopes", seed.envelopes["casa"]), Headers: f.authA(), Body: body(`{"goal":1000}`), ExpectedStatus: 400, ExpectedContent: []string{`"goal":{`}},
	})
}
