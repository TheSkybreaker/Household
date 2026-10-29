package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

const maxActiveEnvelopes = 6

type envelopeInput struct {
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	Amount         int    `json:"amount"`
	Goal           int    `json:"goal"`
	OpeningBalance int    `json:"opening_balance"`
}

// archiveUndo is what archiving moved, kept on the envelope so that the Annulla of the same day
// can put it back.
type archiveUndo struct {
	Date       string   `json:"date"`
	To         string   `json:"to"`
	Allocation int      `json:"allocation"`
	Movements  []string `json:"movements"`
	Transfer   string   `json:"transfer"`
	WasSweepTo bool     `json:"wasSweepTo"`
}

var (
	errUnknownEnvelope = router.NewBadRequestError("Unknown envelope.", nil)
	errNotArchivedNow  = router.NewBadRequestError("Only an envelope archived today can come back.", nil)
)

// createEnvelope adds an envelope in the lowest free colour slot, after the others, with its
// allocation in the current month. The first savings envelope also takes the avanzo.
func (c *cashBook) createEnvelope(app core.App, by string, in envelopeInput) error {
	in.Name = strings.TrimSpace(in.Name)
	errs := validation.Errors{}
	if in.Name == "" {
		errs["name"] = errRequired
	} else if utf8.RuneCountInString(in.Name) > 24 {
		errs["name"] = validation.NewError("validation_max_text_constraint", "At most 24 characters.")
	}
	if in.Kind != "spend" && in.Kind != "save" {
		errs["kind"] = validation.NewError("validation_invalid_kind", "Choose spend or save.")
	}
	if in.Amount < 0 {
		errs["amount"] = validation.NewError("validation_min_number_constraint", "Cannot be negative.")
	}
	if len(errs) > 0 {
		return errs
	}
	if err := c.ensureCurrentMonth(); err != nil {
		return err
	}

	return app.RunInTransaction(func(tx core.App) error {
		active, err := tx.FindAllRecords("envelopes", dbx.HashExp{"archived_from": ""})
		if err != nil {
			return err
		}
		if len(active) >= maxActiveEnvelopes {
			return router.NewBadRequestError("At most 6 envelopes can be active.", nil)
		}
		taken := map[int]bool{}
		for _, envelope := range active {
			taken[envelope.GetInt("slot")] = true
		}
		slot := 1
		for taken[slot] {
			slot++
		}
		var position int
		if err := tx.DB().NewQuery("SELECT COALESCE(MAX(position), 0) + 1 FROM envelopes").Row(&position); err != nil {
			return err
		}

		envelope, err := saveRecord(tx, "envelopes", map[string]any{
			"name": in.Name, "kind": in.Kind, "goal": in.Goal, "opening_balance": in.OpeningBalance,
			"slot": slot, "position": position, "created_by": by,
		})
		if err != nil {
			return err
		}
		month, err := tx.FindFirstRecordByData("months", "month", c.currentMonth())
		if err != nil {
			return err
		}
		if _, err := saveRecord(tx, "month_allocations", map[string]any{"month": month.Id, "envelope": envelope.Id, "amount": in.Amount}); err != nil {
			return err
		}
		if in.Kind == "save" && month.GetString("sweep_to") == "" {
			month.Set("sweep_to", envelope.Id)
			return tx.Save(month)
		}
		return nil
	})
}

// archiveEnvelope removes an envelope from the current month on: its allocation and this month's
// movements go to the envelope to, a savings envelope also hands over its balance, and the avanzo
// moves if it went here. The past months keep it as it was.
func (c *cashBook) archiveEnvelope(app core.App, id string, to string) error {
	if err := c.ensureCurrentMonth(); err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		envelope, err := tx.FindRecordById("envelopes", id)
		if err != nil {
			return errUnknownEnvelope
		}
		target, err := tx.FindRecordById("envelopes", to)
		if err != nil {
			return errUnknownEnvelope
		}
		if envelope.GetString("archived_from") != "" || target.GetString("archived_from") != "" || id == to {
			return router.NewBadRequestError("Move the envelope into another active envelope.", nil)
		}

		current := c.currentMonth()
		month, err := tx.FindFirstRecordByData("months", "month", current)
		if err != nil {
			return err
		}
		undo := archiveUndo{Date: c.today(), To: to, Movements: []string{}}

		// The balance up to last month, before this month's movements leave.
		var balance int
		if envelope.GetString("kind") == "save" {
			l, err := loadLedger(tx)
			if err != nil {
				return err
			}
			row, _ := l.envelope(id)
			balance = l.balance(row, previousMonth(current))
		}

		allocations, err := tx.FindAllRecords("month_allocations", dbx.HashExp{"month": month.Id, "envelope": id})
		if err != nil {
			return err
		}
		for _, allocation := range allocations {
			undo.Allocation += allocation.GetInt("amount")
			if err := tx.Delete(allocation); err != nil {
				return err
			}
		}
		if err := c.addToAllocation(tx, month.Id, to, undo.Allocation); err != nil {
			return err
		}

		movements, err := tx.FindAllRecords("movements", dbx.HashExp{"month": current, "envelope": id})
		if err != nil {
			return err
		}
		for _, movement := range movements {
			movement.Set("envelope", to)
			if err := tx.Save(movement); err != nil {
				return err
			}
			undo.Movements = append(undo.Movements, movement.Id)
		}

		if balance != 0 {
			from, into, amount := id, to, balance
			if balance < 0 {
				from, into, amount = to, id, -balance
			}
			author, err := firstUser(tx)
			if err != nil {
				return err
			}
			transfer, err := saveRecord(tx, "movements", map[string]any{
				"kind": "transfer", "reason": "archive", "date": c.today(), "amount": amount,
				"from_envelope": from, "to_envelope": into, "created_by": author,
			})
			if err != nil {
				return err
			}
			undo.Transfer = transfer.Id
		}

		if month.GetString("sweep_to") == id {
			undo.WasSweepTo = true
			month.Set("sweep_to", c.nextSweepTo(tx, target, id))
			if err := tx.Save(month); err != nil {
				return err
			}
		}

		envelope.Set("archived_from", current)
		envelope.Set("archive_undo", undo)
		return tx.Save(envelope)
	})
}

// nextSweepTo is where the avanzo goes when its envelope is archived into target: target if it is
// a savings envelope, else the first other active savings envelope, else nowhere.
func (c *cashBook) nextSweepTo(tx core.App, target *core.Record, archived string) string {
	if target.GetString("kind") == "save" {
		return target.Id
	}
	savings, err := tx.FindRecordsByFilter("envelopes", "kind = 'save' && archived_from = '' && id != {:archived}", "position", 1, 0, dbx.Params{"archived": archived})
	if err != nil || len(savings) == 0 {
		return ""
	}
	return savings[0].Id
}

// unarchiveEnvelope puts back what archiving moved, on the day it happened, as long as no other
// envelope took its colour.
func (c *cashBook) unarchiveEnvelope(app core.App, id string) error {
	if err := c.ensureCurrentMonth(); err != nil {
		return err
	}
	return app.RunInTransaction(func(tx core.App) error {
		envelope, err := tx.FindRecordById("envelopes", id)
		if err != nil {
			return errUnknownEnvelope
		}
		var undo archiveUndo
		if raw := envelope.GetString("archive_undo"); raw != "" && raw != "null" {
			if err := json.Unmarshal([]byte(raw), &undo); err != nil {
				return err
			}
		}
		if envelope.GetString("archived_from") == "" || undo.Date != c.today() {
			return errNotArchivedNow
		}
		sameSlot, err := tx.FindAllRecords("envelopes", dbx.HashExp{"archived_from": "", "slot": envelope.GetInt("slot")})
		if err != nil {
			return err
		}
		if len(sameSlot) > 0 {
			return router.NewBadRequestError("Another envelope has its colour now.", nil)
		}

		// Active again first: the movements below can only go to an active envelope.
		envelope.Set("archived_from", "")
		envelope.Set("archive_undo", nil)
		if err := tx.Save(envelope); err != nil {
			return err
		}

		current := c.currentMonth()
		month, err := tx.FindFirstRecordByData("months", "month", current)
		if err != nil {
			return err
		}
		if err := c.addToAllocation(tx, month.Id, undo.To, -undo.Allocation); err != nil {
			return err
		}
		if _, err := saveRecord(tx, "month_allocations", map[string]any{"month": month.Id, "envelope": id, "amount": undo.Allocation}); err != nil {
			return err
		}

		for _, movementID := range undo.Movements {
			movement, err := tx.FindRecordById("movements", movementID)
			if err != nil || movement.GetString("envelope") != undo.To || movement.GetString("month") != current {
				continue
			}
			movement.Set("envelope", id)
			if err := tx.Save(movement); err != nil {
				return err
			}
		}
		if undo.Transfer != "" {
			if transfer, err := tx.FindRecordById("movements", undo.Transfer); err == nil {
				if err := tx.Delete(transfer); err != nil {
					return err
				}
			}
		}
		if undo.WasSweepTo {
			month.Set("sweep_to", id)
			return tx.Save(month)
		}
		return nil
	})
}

// addToAllocation changes the allocation of envelope in month by delta, never below 0.
func (c *cashBook) addToAllocation(tx core.App, monthID string, envelopeID string, delta int) error {
	allocations, err := tx.FindAllRecords("month_allocations", dbx.HashExp{"month": monthID, "envelope": envelopeID})
	if err != nil {
		return err
	}
	if len(allocations) == 0 {
		_, err := saveRecord(tx, "month_allocations", map[string]any{"month": monthID, "envelope": envelopeID, "amount": max(delta, 0)})
		return err
	}
	allocation := allocations[0]
	allocation.Set("amount", max(allocation.GetInt("amount")+delta, 0))
	return tx.Save(allocation)
}

// respondWithSummary answers a Conti write with the summary of the current month, or with the
// error of the write: 400 for invalid fields, as is for API errors.
func (c *cashBook) respondWithSummary(e *core.RequestEvent, err error) error {
	var fields validation.Errors
	if errors.As(err, &fields) {
		return e.BadRequestError("Check the highlighted fields.", fields)
	}
	if err != nil {
		return err
	}
	summary, err := c.summaryOf(e.App, "")
	if err != nil {
		return err
	}
	return e.JSON(http.StatusOK, summary)
}

func (c *cashBook) handleCreateEnvelope(e *core.RequestEvent) error {
	var in envelopeInput
	if err := e.BindBody(&in); err != nil {
		return e.BadRequestError("Invalid body.", err)
	}
	return c.respondWithSummary(e, c.createEnvelope(e.App, e.Auth.Id, in))
}

func (c *cashBook) handleArchiveEnvelope(e *core.RequestEvent) error {
	var body struct {
		To string `json:"to"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid body.", err)
	}
	return c.respondWithSummary(e, c.archiveEnvelope(e.App, e.Request.PathValue("id"), body.To))
}

func (c *cashBook) handleUnarchiveEnvelope(e *core.RequestEvent) error {
	return c.respondWithSummary(e, c.unarchiveEnvelope(e.App, e.Request.PathValue("id")))
}
