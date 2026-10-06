package main

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// pushPayload is what the service worker of the Spesa receives; it stays well under the 4 KB push limit.
type pushPayload struct {
	Type      string `json:"type"`
	ListID    string `json:"listId"`
	ListTitle string `json:"listTitle"`
	ListDate  string `json:"listDate"`
	Item      string `json:"item"`
	Qty       string `json:"qty"`
	By        string `json:"by"`
}

// registerShoppingHooks pushes every new item to the Spesa of the other person.
func registerShoppingHooks(app core.App, p *pusher) {
	app.OnRecordAfterCreateSuccess("items").BindFunc(func(e *core.RecordEvent) error {
		item := e.Record.Clone()
		// The response to the client does not wait for the push services.
		go func() {
			if err := p.notifyItemAdded(item); err != nil {
				app.Logger().Error("Push for a new item failed", "item", item.Id, "error", err)
			}
		}()
		return e.Next()
	})
}

// notifyItemAdded pushes the new item to the Spesa on the devices of everyone except its author.
func (p *pusher) notifyItemAdded(item *core.Record) error {
	list, err := p.app.FindRecordById("lists", item.GetString("list"))
	if err != nil {
		return err
	}
	author, err := p.app.FindRecordById("users", item.GetString("added_by"))
	if err != nil {
		return err
	}

	payload, err := json.Marshal(pushPayload{
		Type:      "item_added",
		ListID:    list.Id,
		ListTitle: list.GetString("title"),
		ListDate:  list.GetString("date"),
		Item:      item.GetString("name"),
		Qty:       item.GetString("qty"),
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
