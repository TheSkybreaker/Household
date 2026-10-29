package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A new list of the Spesa that takes over the items still to buy of the previous one is a single
// batch: the list, a copy of each item and each old item marked as taken, in one transaction with
// every collection rule applied. 201 requests are the list and up to 100 items.
func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()
		settings.Batch.Enabled = true
		settings.Batch.MaxRequests = 201
		settings.Batch.Timeout = 10
		settings.Batch.MaxBodySize = 1 << 20
		return app.Save(settings)
	}, func(app core.App) error {
		settings := app.Settings()
		settings.Batch.Enabled = false
		return app.Save(settings)
	})
}
