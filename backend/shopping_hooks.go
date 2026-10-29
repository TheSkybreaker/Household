package main

import (
	"encoding/json"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// pushPayload is what the service worker of the Spesa receives; it stays well under the 4 KB push limit.
type pushPayload struct {
	Type      string `json:"type"`
	ListID    string `json:"listId"`
	ListTitle string `json:"listTitle"`
	ListDate  string `json:"listDate"`
	// Item and Qty are of the last item; Items has every item of the push, in order.
	Item  string   `json:"item"`
	Qty   string   `json:"qty"`
	Items []string `json:"items"`
	By    string   `json:"by"`
}

// registerShoppingHooks pushes the new items to the Spesa of the other person. The items one
// person adds to a list within groupDelay of the first go out together, so a list that takes over
// the leftovers of the previous one, or a quick run of additions, rings the phone once.
func registerShoppingHooks(app core.App, p *pusher) {
	app.OnRecordAfterCreateSuccess("items").BindFunc(func(e *core.RecordEvent) error {
		p.queueItem(e.Record.Clone())
		return e.Next()
	})
	// A restart, as every deploy does, would drop the groups still waiting.
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		p.flushAllItems()
		return e.Next()
	})
}

func (p *pusher) queueItem(item *core.Record) {
	key := item.GetString("list") + "/" + item.GetString("added_by")
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, waiting := p.pending[key]; !waiting {
		// The response to the client does not wait for the push services.
		time.AfterFunc(p.groupDelay, func() { p.flushItems(key) })
	}
	p.pending[key] = append(p.pending[key], item)
}

func (p *pusher) flushAllItems() {
	p.mu.Lock()
	keys := make([]string, 0, len(p.pending))
	for key := range p.pending {
		keys = append(keys, key)
	}
	p.mu.Unlock()
	for _, key := range keys {
		p.flushItems(key)
	}
}

// flushItems sends the group of key. Its timer may fire after a flush on stop: then the group is
// gone and nothing is sent.
func (p *pusher) flushItems(key string) {
	p.mu.Lock()
	items := p.pending[key]
	delete(p.pending, key)
	p.mu.Unlock()
	if len(items) == 0 {
		return
	}
	if err := p.notifyItemsAdded(items); err != nil {
		p.app.Logger().Error("Push for new items failed", "group", key, "error", err)
	}
}

// notifyItemsAdded pushes items, all of one list and one author, to the Spesa on the devices of
// everyone except their author.
func (p *pusher) notifyItemsAdded(items []*core.Record) error {
	last := items[len(items)-1]
	list, err := p.app.FindRecordById("lists", last.GetString("list"))
	if err != nil {
		return err
	}
	author, err := p.app.FindRecordById("users", last.GetString("added_by"))
	if err != nil {
		return err
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.GetString("name"))
	}

	payload, err := json.Marshal(pushPayload{
		Type:      "item_added",
		ListID:    list.Id,
		ListTitle: list.GetString("title"),
		ListDate:  list.GetString("date"),
		Item:      last.GetString("name"),
		Qty:       last.GetString("qty"),
		Items:     names,
		By:        author.GetString("name"),
	})
	if err != nil {
		return err
	}

	subscriptions, err := p.app.FindAllRecords("push_subscriptions", dbx.Not(dbx.HashExp{"user": author.Id}), dbx.HashExp{"app": appShopping})
	if err != nil {
		return err
	}
	for _, subscription := range subscriptions {
		p.deliver(subscription, payload, list.Id)
	}
	return nil
}
