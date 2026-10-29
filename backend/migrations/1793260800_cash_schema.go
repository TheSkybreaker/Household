package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	monthPattern = `^\d{4}-\d{2}$`
	datePattern  = `^\d{4}-\d{2}-\d{2}$`
)

// The collections of Conti. Amounts are integer cents. Writes that touch several records, such as
// the month close or archiving an envelope, go through the server only: their rules are nil.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		lists, err := app.FindCollectionByNameOrId("lists")
		if err != nil {
			return err
		}
		cents := func(name string, min float64) *core.NumberField {
			return &core.NumberField{Name: name, OnlyInt: true, Min: types.Pointer(min)}
		}
		timestamps := func(collection *core.Collection) {
			collection.Fields.Add(
				&core.AutodateField{Name: "created", OnCreate: true},
				&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
			)
		}
		unchanged := func(fields ...string) string {
			rule := ""
			for _, field := range fields {
				rule += " && @request.body." + field + ":isset = false"
			}
			return rule
		}

		envelopes := core.NewBaseCollection("envelopes")
		envelopes.ListRule = types.Pointer(authenticatedRule)
		envelopes.ViewRule = types.Pointer(authenticatedRule)
		envelopes.UpdateRule = types.Pointer(authenticatedRule + unchanged("kind", "slot", "opening_balance", "archived_from", "created_by"))
		envelopes.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 24},
			&core.TextField{Name: "note", Max: 40},
			&core.SelectField{Name: "kind", Values: []string{"spend", "save"}, MaxSelect: 1, Required: true},
			cents("goal", 0),
			cents("opening_balance", 0),
			// The colour of the envelope in every chart; see the slot table of the design doc.
			&core.NumberField{Name: "slot", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(6.0), Required: true},
			&core.NumberField{Name: "position", OnlyInt: true},
			// The first month the envelope is gone from; empty while it is active.
			&core.TextField{Name: "archived_from", Pattern: monthPattern},
			// What archiving moved, for the undo of the same day.
			&core.JSONField{Name: "archive_undo", Hidden: true},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, Required: true, MaxSelect: 1},
		)
		timestamps(envelopes)
		// Two active envelopes never share a colour.
		envelopes.AddIndex("idx_envelopes_active_slot", true, "slot", "archived_from = ''")
		if err := app.Save(envelopes); err != nil {
			return err
		}

		months := core.NewBaseCollection("months")
		months.ListRule = types.Pointer(authenticatedRule)
		months.ViewRule = types.Pointer(authenticatedRule)
		months.UpdateRule = types.Pointer(authenticatedRule + unchanged("month", "closed_at"))
		months.Fields.Add(
			&core.TextField{Name: "month", Required: true, Pattern: monthPattern},
			&core.RelationField{Name: "sweep_to", CollectionId: envelopes.Id, MaxSelect: 1},
			&core.DateField{Name: "closed_at"},
		)
		timestamps(months)
		months.AddIndex("idx_months_month", true, "month", "")
		if err := app.Save(months); err != nil {
			return err
		}

		quotas := core.NewBaseCollection("month_quotas")
		quotas.ListRule = types.Pointer(authenticatedRule)
		quotas.ViewRule = types.Pointer(authenticatedRule)
		// Each person marks only their own quota as paid.
		quotas.UpdateRule = types.Pointer(authenticatedRule + ` && month.closed_at = ""` + unchanged("month", "user") +
			" && (@request.body.paid_on:isset = false || user = @request.auth.id)")
		quotas.Fields.Add(
			&core.RelationField{Name: "month", CollectionId: months.Id, Required: true, CascadeDelete: true, MaxSelect: 1},
			&core.RelationField{Name: "user", CollectionId: users.Id, Required: true, MaxSelect: 1},
			cents("amount", 0),
			&core.TextField{Name: "paid_on", Pattern: datePattern},
		)
		timestamps(quotas)
		quotas.AddIndex("idx_month_quotas_month_user", true, "month, user", "")
		if err := app.Save(quotas); err != nil {
			return err
		}

		allocations := core.NewBaseCollection("month_allocations")
		allocations.ListRule = types.Pointer(authenticatedRule)
		allocations.ViewRule = types.Pointer(authenticatedRule)
		allocations.UpdateRule = types.Pointer(authenticatedRule + unchanged("month", "envelope"))
		allocations.Fields.Add(
			&core.RelationField{Name: "month", CollectionId: months.Id, Required: true, CascadeDelete: true, MaxSelect: 1},
			&core.RelationField{Name: "envelope", CollectionId: envelopes.Id, Required: true, MaxSelect: 1},
			cents("amount", 0),
		)
		timestamps(allocations)
		allocations.AddIndex("idx_month_allocations_month_envelope", true, "month, envelope", "")
		if err := app.Save(allocations); err != nil {
			return err
		}

		movements := core.NewBaseCollection("movements")
		movements.ListRule = types.Pointer(authenticatedRule)
		movements.ViewRule = types.Pointer(authenticatedRule)
		// Transfers come only from the month close and from archiving an envelope.
		movements.CreateRule = types.Pointer(authenticatedRule + ` && @request.body.created_by = @request.auth.id && @request.body.kind != "transfer"`)
		movements.UpdateRule = types.Pointer(authenticatedRule + ` && kind != "transfer" && (@request.body.kind:isset = false || @request.body.kind != "transfer")` + unchanged("created_by"))
		movements.DeleteRule = types.Pointer(authenticatedRule + ` && kind != "transfer"`)
		movements.Fields.Add(
			&core.SelectField{Name: "kind", Values: []string{"spend", "extra", "transfer"}, MaxSelect: 1, Required: true},
			&core.NumberField{Name: "amount", OnlyInt: true, Min: types.Pointer(1.0), Required: true},
			&core.TextField{Name: "date", Required: true, Pattern: datePattern},
			// Derived from date by the server.
			&core.TextField{Name: "month", Pattern: monthPattern},
			&core.RelationField{Name: "envelope", CollectionId: envelopes.Id, MaxSelect: 1},
			&core.RelationField{Name: "from_envelope", CollectionId: envelopes.Id, MaxSelect: 1},
			&core.RelationField{Name: "to_envelope", CollectionId: envelopes.Id, MaxSelect: 1},
			&core.SelectField{Name: "reason", Values: []string{"sweep", "archive"}, MaxSelect: 1},
			&core.TextField{Name: "description", Max: 40},
			// spend: who wrote it down; extra: whose money it is.
			&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1},
			// The Spesa list the spend comes from; it stays when the list is deleted.
			&core.RelationField{Name: "shopping_list", CollectionId: lists.Id, MaxSelect: 1},
			&core.RelationField{Name: "created_by", CollectionId: users.Id, Required: true, MaxSelect: 1},
		)
		timestamps(movements)
		movements.AddIndex("idx_movements_month", false, "month", "")
		return app.Save(movements)
	}, func(app core.App) error {
		for _, name := range []string{"movements", "month_allocations", "month_quotas", "months", "envelopes"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}
