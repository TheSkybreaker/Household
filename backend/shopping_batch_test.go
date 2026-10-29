package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// A new list that takes over the items still to buy is one batch: the list, its copies of the
// items, and the old items marked as taken, all or nothing.
func TestCarryOverInOneBatch(t *testing.T) {
	f := newFixture(t)
	const newList = "carryoverlist01"
	batch := func(checkedBy string) *strings.Reader {
		return strings.NewReader(`{"requests":[
			{"method":"POST","url":"/api/collections/lists/records","body":{"id":"` + newList + `","date":"2026-10-05","title":"Spesa","created_by":"` + f.userA.Id + `"}},
			{"method":"POST","url":"/api/collections/items/records","body":{"list":"` + newList + `","name":"Pane","added_by":"` + f.userA.Id + `","added_at":"2026-10-04T10:00:00.000Z"}},
			{"method":"PATCH","url":"/api/collections/items/records/` + f.item.Id + `","body":{"checked":true,"checked_by":"` + checkedBy + `","checked_at":"2026-10-04T10:00:00.000Z"}}
		]}`)
	}

	f.run(t, []tests.ApiScenario{
		{
			Name: "the list, its items and the taken ones together", Method: http.MethodPost, URL: "/api/batch", Headers: f.authA(), Body: batch(f.userA.Id),
			ExpectedStatus: 200, ExpectedContent: []string{`"status":200`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				carried, err := app.FindAllRecords("items")
				if err != nil {
					t.Fatal(err)
				}
				inNewList := 0
				for _, item := range carried {
					if item.GetString("list") == newList {
						inNewList++
					}
					if item.Id == f.item.Id && !item.GetBool("checked") {
						t.Error("the old item is still to buy")
					}
				}
				if inNewList != 1 {
					t.Errorf("%d items in the new list, want 1", inNewList)
				}
			},
		},
		{
			Name: "nothing when one write breaks a rule", Method: http.MethodPost, URL: "/api/batch", Headers: f.authA(), Body: batch(f.userB.Id),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if _, err := app.FindRecordById("lists", newList); err == nil {
					t.Error("the new list was saved without its items")
				}
			},
		},
	})
}
