package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// The push services of Chrome and Android, Firefox, Edge and Safari. The server posts to the
// subscription endpoint, so any other host would let a signed-in user make it call arbitrary URLs.
var pushServiceHosts = []string{"fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"}

func isPushServiceEndpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	host := parsed.Hostname()
	for _, allowed := range pushServiceHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

// subscriptionBody is PushSubscription.toJSON() from the browser.
type subscriptionBody struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	// App is the one whose service worker made the subscription.
	App string `json:"app"`
}

func registerPushRoutes(se *core.ServeEvent, p *pusher) {
	group := se.Router.Group("/api/push")
	group.Bind(apis.RequireAuth("users"))

	group.GET("/key", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]string{"publicKey": p.cfg.vapidPublicKey})
	})
	group.POST("/subscribe", p.subscribe)
	group.POST("/unsubscribe", p.unsubscribe)
	if p.cfg.dev {
		group.POST("/test", p.sendTest)
	}
}

// subscribe stores the browser subscription for the signed-in user, taking it over when the
// same browser was subscribed by the other account.
func (p *pusher) subscribe(e *core.RequestEvent) error {
	var body subscriptionBody
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid subscription.", err)
	}
	if !isPushServiceEndpoint(body.Endpoint) || body.Keys.P256dh == "" || body.Keys.Auth == "" || (body.App != appShopping && body.App != appCash) {
		return e.BadRequestError("Invalid subscription.", nil)
	}

	subscription, err := p.app.FindFirstRecordByData("push_subscriptions", "endpoint", body.Endpoint)
	if err != nil {
		collection, err := p.app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			return err
		}
		subscription = core.NewRecord(collection)
		subscription.Set("endpoint", body.Endpoint)
	}
	subscription.Set("user", e.Auth.Id)
	subscription.Set("app", body.App)
	subscription.Set("p256dh", body.Keys.P256dh)
	subscription.Set("auth", body.Keys.Auth)
	subscription.Set("user_agent", e.Request.UserAgent())

	if err := p.app.Save(subscription); err != nil {
		return e.BadRequestError("Invalid subscription.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

// unsubscribe deletes the subscription of this browser, when it belongs to the signed-in user.
func (p *pusher) unsubscribe(e *core.RequestEvent) error {
	var body subscriptionBody
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid body.", err)
	}

	subscription, err := p.app.FindFirstRecordByData("push_subscriptions", "endpoint", body.Endpoint)
	if err == nil && subscription.GetString("user") == e.Auth.Id {
		if err := p.app.Delete(subscription); err != nil {
			return err
		}
	}
	return e.NoContent(http.StatusNoContent)
}

// sendTest pushes a sample notification to the devices of the signed-in user. Only with DEV=1.
func (p *pusher) sendTest(e *core.RequestEvent) error {
	subscriptions, err := p.app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": e.Auth.Id, "app": appShopping})
	if err != nil {
		return err
	}

	// The test payload is the Spesa's; "test" is shown even with the app on screen, where the button is.
	payload, err := json.Marshal(pushPayload{
		Type:      "test",
		ListID:    "test",
		ListTitle: "Prova",
		ListDate:  time.Now().Format(time.DateOnly),
		Item:      "Notifica di prova",
		By:        e.Auth.GetString("name"),
	})
	if err != nil {
		return err
	}
	for _, subscription := range subscriptions {
		p.deliver(subscription, payload, "test")
	}
	return e.JSON(http.StatusOK, map[string]int{"sent": len(subscriptions)})
}
