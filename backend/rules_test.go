package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/security"
)

// fixture is a data dir with the Spesa schema, two users, a superuser and a list with one item
// added by userA.
type fixture struct {
	dataDir  string
	password string // of both users
	userA    *core.Record
	userB    *core.Record
	tokenA   string
	tokenB   string
	// tokenSuperuser is of admin@example.test, whose password is also password.
	tokenSuperuser string
	list           *core.Record
	item           *core.Record
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	// An empty data dir means only the system migrations and ours are applied.
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	save := func(record *core.Record) *core.Record {
		t.Helper()
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
		return record
	}

	password := security.RandomString(20)
	newUser := func(username string, name string, color string) *core.Record {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		user := core.NewRecord(users)
		user.Set("username", username)
		user.SetPassword(password)
		user.Set("name", name)
		user.Set("color", color)
		return save(user)
	}

	newRecord := func(collectionName string, data map[string]any) *core.Record {
		collection, err := app.FindCollectionByNameOrId(collectionName)
		if err != nil {
			t.Fatal(err)
		}
		record := core.NewRecord(collection)
		record.Load(data)
		return save(record)
	}

	f := &fixture{dataDir: app.DataDir(), password: password}
	f.userA = newUser("usera", "User A", "sky")
	f.userB = newUser("userb", "User B", "sun")
	f.list = newRecord("lists", map[string]any{"date": "2026-10-03", "title": "Spesa", "created_by": f.userA.Id})
	f.item = newRecord("items", map[string]any{"list": f.list.Id, "name": "Pane", "added_by": f.userA.Id})

	f.tokenA, err = f.userA.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	f.tokenB, err = f.userB.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(superusers)
	superuser.SetEmail("admin@example.test")
	superuser.SetPassword(password)
	f.tokenSuperuser, err = save(superuser).NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	return f
}

// run executes each scenario on its own copy of the fixture data dir, which keeps the
// collection token secrets, so the tokens stay valid.
func (f *fixture) run(t *testing.T, scenarios []tests.ApiScenario) {
	f.runWith(t, nil, scenarios)
}

// runWith is run with setup applied to each test app first, to register hooks or add records.
func (f *fixture) runWith(t *testing.T, setup func(testing.TB, core.App), scenarios []tests.ApiScenario) {
	for _, scenario := range scenarios {
		scenario.TestAppFactory = func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp(f.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			if setup != nil {
				setup(t, app)
			}
			return app
		}
		scenario.Test(t)
	}
}

func (f *fixture) authA() map[string]string {
	return map[string]string{"Authorization": f.tokenA}
}

func (f *fixture) authB() map[string]string {
	return map[string]string{"Authorization": f.tokenB}
}

func TestGuestReadsNothing(t *testing.T) {
	f := newFixture(t)
	emptyPage := []string{`"totalItems":0`, `"items":[]`}

	f.run(t, []tests.ApiScenario{
		{Name: "guest lists users", Method: http.MethodGet, URL: "/api/collections/users/records", ExpectedStatus: 200, ExpectedContent: emptyPage},
		{Name: "guest lists lists", Method: http.MethodGet, URL: "/api/collections/lists/records", ExpectedStatus: 200, ExpectedContent: emptyPage},
		{Name: "guest lists items", Method: http.MethodGet, URL: "/api/collections/items/records", ExpectedStatus: 200, ExpectedContent: emptyPage},
		{Name: "guest views a list", Method: http.MethodGet, URL: "/api/collections/lists/records/" + f.list.Id, ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "guest views an item", Method: http.MethodGet, URL: "/api/collections/items/records/" + f.item.Id, ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "guest lists push subscriptions", Method: http.MethodGet, URL: "/api/collections/push_subscriptions/records", ExpectedStatus: 403, ExpectedContent: []string{`"data":{}`}},
		{
			Name:            "signed-in user lists lists",
			Method:          http.MethodGet,
			URL:             "/api/collections/lists/records",
			Headers:         f.authA(),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`, `"id":"` + f.list.Id + `"`},
		},
	})
}

func TestSignInWithUsername(t *testing.T) {
	f := newFixture(t)
	credentials := func(identity string, password string) io.Reader {
		return strings.NewReader(`{"identity":"` + identity + `","password":"` + password + `"}`)
	}

	f.run(t, []tests.ApiScenario{
		{
			Name:            "username and password",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-with-password",
			Body:            credentials("usera", f.password),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"token":"`, `"username":"usera"`},
		},
		{
			Name:            "wrong password",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-with-password",
			Body:            credentials("usera", f.password+"x"),
			ExpectedStatus:  400,
			ExpectedContent: []string{`"data":{}`},
		},
	})
}

func TestPushSubscriptionsAreSuperuserOnly(t *testing.T) {
	f := newFixture(t)

	f.run(t, []tests.ApiScenario{
		{
			Name:            "signed-in user lists push subscriptions",
			Method:          http.MethodGet,
			URL:             "/api/collections/push_subscriptions/records",
			Headers:         f.authA(),
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "signed-in user creates a push subscription",
			Method:          http.MethodPost,
			URL:             "/api/collections/push_subscriptions/records",
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"user":"` + f.userA.Id + `","endpoint":"https://push.example.com/1","p256dh":"key","auth":"secret"}`),
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
		},
	})
}

func TestItemCreateRequiresOwnAddedBy(t *testing.T) {
	f := newFixture(t)

	f.run(t, []tests.ApiScenario{
		{
			Name:            "added_by of the other user",
			Method:          http.MethodPost,
			URL:             "/api/collections/items/records",
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"list":"` + f.list.Id + `","name":"Latte","added_by":"` + f.userB.Id + `"}`),
			ExpectedStatus:  400,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "added_by of the requester",
			Method:          http.MethodPost,
			URL:             "/api/collections/items/records",
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"list":"` + f.list.Id + `","name":"Latte","added_by":"` + f.userA.Id + `"}`),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"name":"Latte"`, `"added_by":"` + f.userA.Id + `"`},
		},
	})
}

func TestItemUpdateRule(t *testing.T) {
	f := newFixture(t)
	itemURL := "/api/collections/items/records/" + f.item.Id

	f.run(t, []tests.ApiScenario{
		{
			Name:            "added_by cannot be reassigned",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"added_by":"` + f.userB.Id + `"}`),
			ExpectedStatus:  404,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "added_by becomes the requester when an item goes back to buy",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Headers:         f.authB(),
			Body:            strings.NewReader(`{"checked":false,"checked_by":"","checked_at":"","added_by":"` + f.userB.Id + `"}`),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"checked":false`, `"added_by":"` + f.userB.Id + `"`},
		},
		{
			Name:            "checked_by cannot be the other user",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"checked":true,"checked_by":"` + f.userB.Id + `"}`),
			ExpectedStatus:  404,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "checked_by is the requester",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"checked":true,"checked_by":"` + f.userA.Id + `","checked_at":"2026-10-03 10:00:00.000Z"}`),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"checked":true`, `"checked_by":"` + f.userA.Id + `"`},
		},
		{
			Name:            "checked_by is cleared",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Headers:         f.authA(),
			Body:            strings.NewReader(`{"checked":false,"checked_by":"","checked_at":""}`),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"checked":false`, `"checked_by":""`},
		},
		{
			Name:            "guest cannot update",
			Method:          http.MethodPatch,
			URL:             itemURL,
			Body:            strings.NewReader(`{"name":"Burro"}`),
			ExpectedStatus:  404,
			ExpectedContent: []string{`"data":{}`},
		},
	})
}

func TestDeletingListDeletesItems(t *testing.T) {
	f := newFixture(t)

	f.run(t, []tests.ApiScenario{
		{
			Name:           "delete the list",
			Method:         http.MethodDelete,
			URL:            "/api/collections/lists/records/" + f.list.Id,
			Headers:        f.authA(),
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if _, err := app.FindRecordById("items", f.item.Id); err == nil {
					t.Fatal("the item survived the deletion of its list")
				}
			},
		},
	})
}

// The dashboard is reached through an SSH tunnel to the server itself; through Caddy, superusers
// are refused whatever path or collection id reaches PocketBase.
func TestSuperusersOnlyFromTheServer(t *testing.T) {
	f := newFixture(t)
	signIn := func() *strings.Reader {
		return strings.NewReader(`{"identity":"admin@example.test","password":"` + f.password + `"}`)
	}
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	app.Cleanup()
	if err != nil {
		t.Fatal(err)
	}

	f.run(t, []tests.ApiScenario{
		{
			Name:            "sign-in by collection name from a public address",
			Method:          http.MethodPost,
			URL:             "/api/collections/_superusers/auth-with-password",
			Headers:         map[string]string{"X-Forwarded-For": "203.0.113.7"},
			Body:            signIn(),
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "sign-in by collection id from a public address",
			Method:          http.MethodPost,
			URL:             "/api/collections/" + superusers.Id + "/auth-with-password",
			Headers:         map[string]string{"X-Forwarded-For": "203.0.113.7"},
			Body:            signIn(),
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "a superuser token used from a public address",
			Method:          http.MethodGet,
			URL:             "/api/settings",
			Headers:         map[string]string{"Authorization": f.tokenSuperuser, "X-Forwarded-For": "203.0.113.7"},
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "sign-in from the server itself",
			Method:          http.MethodPost,
			URL:             "/api/collections/_superusers/auth-with-password",
			Headers:         map[string]string{"X-Forwarded-For": "127.0.0.1"},
			Body:            signIn(),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"token":"ey`},
		},
	})
}
