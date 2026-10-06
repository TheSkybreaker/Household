package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Each app has its own service worker, so a subscription belongs to one app; the pushes of an
// app go only to its subscriptions.
func init() {
	m.Register(func(app core.App) error {
		subscriptions, err := app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			return err
		}

		subscriptions.Fields.Add(&core.SelectField{Name: "app", Values: []string{"shopping", "cash"}, MaxSelect: 1, Required: true})
		if err := app.Save(subscriptions); err != nil {
			return err
		}

		// Every subscription so far is of the Spesa.
		_, err = app.DB().NewQuery("UPDATE push_subscriptions SET app = 'shopping'").Execute()
		return err
	}, func(app core.App) error {
		subscriptions, err := app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			return err
		}

		subscriptions.Fields.RemoveByName("app")

		return app.Save(subscriptions)
	})
}
