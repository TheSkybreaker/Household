package main

import (
	"net/http"
	"sync"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/pocketbase/core"
)

const (
	pushTTL     = 12 * 60 * 60 // seconds
	pushTimeout = 10 * time.Second
	// Items added to a list by one person within this time go out as one push.
	pushGroupDelay = 3 * time.Second
)

// The apps a push subscription can belong to; each has its own service worker.
const (
	appShopping = "shopping"
	appCash     = "cash"
)

// sendFunc matches webpush.SendNotification, so tests can replace the push service.
type sendFunc func(message []byte, subscription *webpush.Subscription, options *webpush.Options) (*http.Response, error)

type pusher struct {
	app        core.App
	cfg        config
	send       sendFunc
	client     *http.Client
	groupDelay time.Duration

	mu      sync.Mutex
	pending map[string][]*core.Record
}

// registerPush binds the /api/push routes and the hooks that send the pushes of each app.
func registerPush(app core.App, cfg config, send sendFunc) *pusher {
	p := &pusher{app: app, cfg: cfg, send: send, client: &http.Client{Timeout: pushTimeout}, groupDelay: pushGroupDelay, pending: map[string][]*core.Record{}}
	registerShoppingHooks(app, p)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		registerPushRoutes(se, p)
		return se.Next()
	})
	return p
}

// deliver sends one push. A subscription the push service no longer knows is deleted; other
// errors are only logged, without retries.
func (p *pusher) deliver(subscription *core.Record, payload []byte, topic string) {
	response, err := p.send(payload, &webpush.Subscription{
		Endpoint: subscription.GetString("endpoint"),
		Keys:     webpush.Keys{P256dh: subscription.GetString("p256dh"), Auth: subscription.GetString("auth")},
	}, &webpush.Options{
		HTTPClient:      p.client,
		Subscriber:      p.cfg.vapidSubject,
		VAPIDPublicKey:  p.cfg.vapidPublicKey,
		VAPIDPrivateKey: p.cfg.vapidPrivateKey,
		TTL:             pushTTL,
		// High urgency: phones saving battery would otherwise hold the message back.
		Urgency: webpush.UrgencyHigh,
		// The push service replaces undelivered messages of the same list.
		Topic: topic,
	})
	if err != nil {
		p.app.Logger().Error("Push failed", "subscription", subscription.Id, "error", err)
		return
	}
	defer response.Body.Close()

	switch {
	case response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone:
		if err := p.app.Delete(subscription); err != nil {
			p.app.Logger().Error("Deleting an expired push subscription failed", "subscription", subscription.Id, "error", err)
		}
	case response.StatusCode >= 400:
		p.app.Logger().Error("Push rejected", "subscription", subscription.Id, "status", response.StatusCode)
	}
}
