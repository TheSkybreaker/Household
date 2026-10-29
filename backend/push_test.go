package main

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/security"
)

type sentPush struct {
	endpoint string
	payload  pushPayload
	options  webpush.Options
}

// fakePushService answers 201 unless a status is set for the endpoint.
type fakePushService struct {
	mu     sync.Mutex
	status map[string]int
	sent   []sentPush
}

func (f *fakePushService) send(message []byte, subscription *webpush.Subscription, options *webpush.Options) (*http.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var payload pushPayload
	if err := json.Unmarshal(message, &payload); err != nil {
		return nil, err
	}
	f.sent = append(f.sent, sentPush{endpoint: subscription.Endpoint, payload: payload, options: *options})

	status := f.status[subscription.Endpoint]
	if status == 0 {
		status = http.StatusCreated
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(""))}, nil
}

func (f *fakePushService) endpoints() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	endpoints := make([]string, 0, len(f.sent))
	for _, push := range f.sent {
		endpoints = append(endpoints, push.endpoint)
	}
	slices.Sort(endpoints)
	return endpoints
}

func testConfig(dev bool) config {
	return config{
		vapidPublicKey:  security.RandomString(20),
		vapidPrivateKey: security.RandomString(20),
		vapidSubject:    "test@example.com",
		location:        rome,
		dev:             dev,
	}
}

func addSubscription(t testing.TB, app core.App, user *core.Record, endpoint string, appID string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("push_subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	subscription := core.NewRecord(collection)
	subscription.Load(map[string]any{"user": user.Id, "endpoint": endpoint, "p256dh": "key", "auth": "secret", "app": appID})
	if err := app.Save(subscription); err != nil {
		t.Fatal(err)
	}
	return subscription
}

func TestNotifyItemAddedSkipsAuthorAndDropsGoneSubscriptions(t *testing.T) {
	f := newFixture(t)
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	ownDevice := addSubscription(t, app, f.userA, "https://push.example.com/a", appShopping)
	partnerPhone := addSubscription(t, app, f.userB, "https://push.example.com/b-phone", appShopping)
	partnerGone := addSubscription(t, app, f.userB, "https://push.example.com/b-gone", appShopping)

	service := &fakePushService{status: map[string]int{"https://push.example.com/b-gone": http.StatusGone}}
	cfg := testConfig(false)
	p := &pusher{app: app, cfg: cfg, send: service.send, client: http.DefaultClient}

	item, err := app.FindRecordById("items", f.item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.notifyItemsAdded([]*core.Record{item}); err != nil {
		t.Fatal(err)
	}

	if got, want := service.endpoints(), []string{"https://push.example.com/b-gone", "https://push.example.com/b-phone"}; !slices.Equal(got, want) {
		t.Fatalf("pushed to %v, want only the partner's devices %v", got, want)
	}

	push := service.sent[0]
	wantPayload := pushPayload{Type: "item_added", ListID: f.list.Id, ListTitle: "Spesa", ListDate: "2026-10-03", Item: "Pane", Items: []string{"Pane"}, By: "User A"}
	if !reflect.DeepEqual(push.payload, wantPayload) {
		t.Fatalf("payload = %+v, want %+v", push.payload, wantPayload)
	}
	if push.options.TTL != 12*60*60 || push.options.Urgency != webpush.UrgencyHigh || push.options.Topic != f.list.Id ||
		push.options.Subscriber != cfg.vapidSubject || push.options.VAPIDPrivateKey != cfg.vapidPrivateKey {
		t.Fatalf("unexpected push options %+v", push.options)
	}

	if _, err := app.FindRecordById("push_subscriptions", partnerGone.Id); err == nil {
		t.Fatal("the subscription answered with 410 was not deleted")
	}
	for _, kept := range []*core.Record{ownDevice, partnerPhone} {
		if _, err := app.FindRecordById("push_subscriptions", kept.Id); err != nil {
			t.Fatalf("subscription %s was deleted", kept.GetString("endpoint"))
		}
	}
}

func TestCreatingAnItemPushesToThePartner(t *testing.T) {
	f := newFixture(t)
	service := &fakePushService{}

	(&tests.ApiScenario{
		Name:    "user A adds an item",
		Method:  http.MethodPost,
		URL:     "/api/collections/items/records",
		Headers: f.authA(),
		Body:    strings.NewReader(`{"list":"` + f.list.Id + `","name":"Latte","added_by":"` + f.userA.Id + `"}`),
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp(f.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			addSubscription(t, app, f.userB, "https://push.example.com/b", appShopping)
			registerPush(app, testConfig(false), service.send).groupDelay = 10 * time.Millisecond
			return app
		},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"name":"Latte"`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			// The push runs in a goroutine after the response.
			deadline := time.Now().Add(2 * time.Second)
			for len(service.endpoints()) == 0 && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}
			if got := service.endpoints(); !slices.Equal(got, []string{"https://push.example.com/b"}) {
				t.Fatalf("pushed to %v", got)
			}
		},
	}).Test(t)
}

func TestPushRoutes(t *testing.T) {
	f := newFixture(t)
	endpoint := "https://fcm.googleapis.com/fcm/send/shared-browser"
	subscribeBody := `{"endpoint":"` + endpoint + `","keys":{"p256dh":"key","auth":"secret"},"app":"shopping"}`

	pushApp := func(dev bool, setup func(testing.TB, *tests.TestApp)) func(testing.TB) *tests.TestApp {
		return func(t testing.TB) *tests.TestApp {
			app, err := tests.NewTestApp(f.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			if setup != nil {
				setup(t, app)
			}
			registerPush(app, testConfig(dev), (&fakePushService{}).send)
			return app
		}
	}
	subscriptionOwner := func(t testing.TB, app *tests.TestApp) string {
		subscription, err := app.FindFirstRecordByData("push_subscriptions", "endpoint", endpoint)
		if err != nil {
			return ""
		}
		return subscription.GetString("user")
	}
	subscribedByB := func(t testing.TB, app *tests.TestApp) { addSubscription(t, app, f.userB, endpoint, appShopping) }

	scenarios := []tests.ApiScenario{
		{Name: "guest reads the key", Method: http.MethodGet, URL: "/api/push/key", TestAppFactory: pushApp(false, nil), ExpectedStatus: 401, ExpectedContent: []string{`"data":{}`}},
		{Name: "user reads the key", Method: http.MethodGet, URL: "/api/push/key", Headers: f.authA(), TestAppFactory: pushApp(false, nil), ExpectedStatus: 200, ExpectedContent: []string{`"publicKey":"`}},
		{
			Name: "user subscribes", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(), Body: strings.NewReader(subscribeBody),
			TestAppFactory: pushApp(false, nil), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if owner := subscriptionOwner(t, app); owner != f.userA.Id {
					t.Fatalf("owner = %q, want user A", owner)
				}
			},
		},
		{
			Name: "a browser subscribed by B is taken over by A", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(), Body: strings.NewReader(subscribeBody),
			TestAppFactory: pushApp(false, subscribedByB), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				count, err := app.CountRecords("push_subscriptions")
				if err != nil || count != 1 || subscriptionOwner(t, app) != f.userA.Id {
					t.Fatalf("count = %d, owner = %q, want 1 subscription of user A", count, subscriptionOwner(t, app))
				}
			},
		},
		{
			Name: "a subscription without app is refused", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(),
			Body: strings.NewReader(`{"endpoint":"` + endpoint + `","keys":{"p256dh":"key","auth":"secret"}}`), TestAppFactory: pushApp(false, nil),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`},
		},
		{
			Name: "a subscription of Conti is stored as such", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(),
			Body: strings.NewReader(`{"endpoint":"` + endpoint + `","keys":{"p256dh":"key","auth":"secret"},"app":"cash"}`), TestAppFactory: pushApp(false, nil),
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				subscription, err := app.FindFirstRecordByData("push_subscriptions", "endpoint", endpoint)
				if err != nil || subscription.GetString("app") != appCash {
					t.Fatalf("subscription app = %q, want cash (%v)", subscription.GetString("app"), err)
				}
			},
		},
		{
			Name: "an endpoint that is not HTTPS is refused", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(),
			Body: strings.NewReader(`{"endpoint":"http://fcm.googleapis.com/fcm/send/x","keys":{"p256dh":"key","auth":"secret"}}`), TestAppFactory: pushApp(false, nil),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`},
		},
		{
			Name: "an endpoint outside the push services is refused", Method: http.MethodPost, URL: "/api/push/subscribe", Headers: f.authA(),
			Body: strings.NewReader(`{"endpoint":"https://internal.example.com/admin","keys":{"p256dh":"key","auth":"secret"}}`), TestAppFactory: pushApp(false, nil),
			ExpectedStatus: 400, ExpectedContent: []string{`"data":{}`},
		},
		{
			Name: "user A cannot unsubscribe B's browser", Method: http.MethodPost, URL: "/api/push/unsubscribe", Headers: f.authA(), Body: strings.NewReader(subscribeBody),
			TestAppFactory: pushApp(false, subscribedByB), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if subscriptionOwner(t, app) != f.userB.Id {
					t.Fatal("B's subscription was deleted by A")
				}
			},
		},
		{
			Name: "user B unsubscribes their browser", Method: http.MethodPost, URL: "/api/push/unsubscribe", Headers: f.authB(), Body: strings.NewReader(subscribeBody),
			TestAppFactory: pushApp(false, subscribedByB), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if subscriptionOwner(t, app) != "" {
					t.Fatal("B's subscription was not deleted")
				}
			},
		},
		{Name: "test push is off without DEV", Method: http.MethodPost, URL: "/api/push/test", Headers: f.authB(), TestAppFactory: pushApp(false, subscribedByB), ExpectedStatus: 404, ExpectedContent: []string{`"data":{}`}},
		{Name: "test push with DEV", Method: http.MethodPost, URL: "/api/push/test", Headers: f.authB(), TestAppFactory: pushApp(true, subscribedByB), ExpectedStatus: 200, ExpectedContent: []string{`"sent":1`}},
	}
	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestItemPushReachesOnlyTheSpesa(t *testing.T) {
	f := newFixture(t)
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	addSubscription(t, app, f.userB, "https://push.example.com/b-shopping", appShopping)
	addSubscription(t, app, f.userB, "https://push.example.com/b-cash", appCash)
	service := &fakePushService{}
	p := &pusher{app: app, cfg: testConfig(false), send: service.send, client: http.DefaultClient}

	item, err := app.FindRecordById("items", f.item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.notifyItemsAdded([]*core.Record{item}); err != nil {
		t.Fatal(err)
	}
	if got := service.endpoints(); !slices.Equal(got, []string{"https://push.example.com/b-shopping"}) {
		t.Fatalf("pushed to %v, want only the Spesa of the partner", got)
	}
}

func TestIsPushServiceEndpoint(t *testing.T) {
	for endpoint, want := range map[string]bool{
		"https://fcm.googleapis.com/fcm/send/abc":                true,
		"https://updates.push.services.mozilla.com/wpush/v2/abc": true,
		"https://wns2-par02p.notify.windows.com/w/?token=abc":    true,
		"https://web.push.apple.com/abc":                         true,
		"https://fcm.googleapis.com:443/fcm/send/abc":            true,
		"http://fcm.googleapis.com/fcm/send/abc":                 false,
		"https://fcm.googleapis.com:8443/fcm/send/abc":           false,
		"https://fcm.googleapis.com.example.com/abc":             false,
		"https://evilfcm.googleapis.com.attacker.example/abc":    false,
		"https://127.0.0.1/abc":                                  false,
		"https://localhost/abc":                                  false,
		"not a url":                                              false,
	} {
		if got := isPushServiceEndpoint(endpoint); got != want {
			t.Errorf("isPushServiceEndpoint(%q) = %v, want %v", endpoint, got, want)
		}
	}
}

func TestItemsAddedTogetherShareOnePush(t *testing.T) {
	f := newFixture(t)
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	addSubscription(t, app, f.userB, "https://push.example.com/b", appShopping)
	service := &fakePushService{}
	registerPush(app, testConfig(false), service.send).groupDelay = 300 * time.Millisecond

	lists, err := app.FindCollectionByNameOrId("lists")
	if err != nil {
		t.Fatal(err)
	}
	other := core.NewRecord(lists)
	other.Load(map[string]any{"date": "2026-10-04", "title": "Cena", "created_by": f.userA.Id})
	if err := app.Save(other); err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("items")
	if err != nil {
		t.Fatal(err)
	}
	for _, added := range []struct{ list, name string }{{f.list.Id, "Latte"}, {f.list.Id, "Uova"}, {other.Id, "Vino"}, {f.list.Id, "Burro"}} {
		item := core.NewRecord(collection)
		item.Load(map[string]any{"list": added.list, "name": added.name, "added_by": f.userA.Id})
		if err := app.Save(item); err != nil {
			t.Fatal(err)
		}
	}

	deadline := time.Now().Add(3 * time.Second)
	for len(service.endpoints()) < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	// Nothing else arrives once the groups went out.
	time.Sleep(400 * time.Millisecond)

	service.mu.Lock()
	defer service.mu.Unlock()
	byList := map[string][]string{}
	for _, push := range service.sent {
		byList[push.payload.ListID] = append(byList[push.payload.ListID], strings.Join(push.payload.Items, ","))
	}
	if got := byList[f.list.Id]; !slices.Equal(got, []string{"Latte,Uova,Burro"}) {
		t.Errorf("pushes for the list = %v, want one with Latte, Uova and Burro", got)
	}
	if got := byList[other.Id]; !slices.Equal(got, []string{"Vino"}) {
		t.Errorf("pushes for the other list = %v, want one with Vino", got)
	}
}

func TestPendingPushesGoOutWhenTheServerStops(t *testing.T) {
	f := newFixture(t)
	app, err := tests.NewTestApp(f.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)

	addSubscription(t, app, f.userB, "https://push.example.com/b", appShopping)
	service := &fakePushService{}
	p := registerPush(app, testConfig(false), service.send)
	p.groupDelay = 50 * time.Millisecond

	collection, err := app.FindCollectionByNameOrId("items")
	if err != nil {
		t.Fatal(err)
	}
	item := core.NewRecord(collection)
	item.Load(map[string]any{"list": f.list.Id, "name": "Latte", "added_by": f.userA.Id})
	if err := app.Save(item); err != nil {
		t.Fatal(err)
	}

	// A deploy restarts the service before the group would go out.
	if err := app.OnTerminate().Trigger(&core.TerminateEvent{App: app}); err != nil {
		t.Fatal(err)
	}
	if got := service.endpoints(); !slices.Equal(got, []string{"https://push.example.com/b"}) {
		t.Fatalf("pushed on stop to %v, want the partner", got)
	}

	// The timer of the group fires later and finds it gone.
	time.Sleep(100 * time.Millisecond)
	if got := len(service.endpoints()); got != 1 {
		t.Fatalf("%d pushes after the timer, want still 1", got)
	}
}
