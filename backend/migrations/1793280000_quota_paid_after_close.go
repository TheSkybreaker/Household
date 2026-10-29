package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// A quota forgotten until its month closed can still be marked as paid, by its owner: it counts in
// the entered money of that month, while the avanzo already moved stays as it is. The amount of a
// closed month still cannot change.
func init() {
	m.Register(func(app core.App) error {
		quotas, err := app.FindCollectionByNameOrId("month_quotas")
		if err != nil {
			return err
		}
		quotas.UpdateRule = types.Pointer(authenticatedRule + ` && @request.body.month:isset = false && @request.body.user:isset = false` +
			` && (@request.body.paid_on:isset = false || user = @request.auth.id)` +
			` && (month.closed_at = "" || @request.body.amount:isset = false)`)
		return app.Save(quotas)
	}, func(app core.App) error {
		quotas, err := app.FindCollectionByNameOrId("month_quotas")
		if err != nil {
			return err
		}
		quotas.UpdateRule = types.Pointer(authenticatedRule + ` && month.closed_at = "" && @request.body.month:isset = false && @request.body.user:isset = false` +
			" && (@request.body.paid_on:isset = false || user = @request.auth.id)")
		return app.Save(quotas)
	})
}
