package main

import (
	"time"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

var (
	errRequired      = validation.NewError("validation_required", "Cannot be blank.")
	errOnlyTransfers = validation.NewError("validation_only_transfers", "Only transfers have this field.")
	errNotCurrent    = validation.NewError("validation_not_current_month", "Only the current month can change.")
)

// registerHooks checks every Conti write, from the API and from the server alike, beyond what the
// collection rules can express.
func (c *cashBook) registerHooks() {
	c.app.OnRecordCreate("movements").BindFunc(c.checkMovement)
	c.app.OnRecordUpdate("movements").BindFunc(c.checkMovement)
	c.app.OnRecordValidate("envelopes").BindFunc(checkEnvelope)
	c.app.OnRecordUpdateRequest("months").BindFunc(c.checkMonthUpdate)
	c.app.OnRecordUpdateRequest("month_allocations").BindFunc(c.checkAllocationUpdate)
	c.app.OnRecordUpdateRequest("month_quotas").BindFunc(c.checkQuotaUpdate)
}

// checkMovement derives month from date, never from the request, and validates the fields of each
// kind.
func (c *cashBook) checkMovement(e *core.RecordEvent) error {
	movement := e.Record
	date := movement.GetString("date")
	errs := validation.Errors{}

	movement.Set("month", "")
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		errs["date"] = validation.NewError("validation_invalid_date", "Not a calendar day.")
	} else {
		month := date[:7]
		movement.Set("month", month)
		first, err := c.firstMonth(e.App)
		if err != nil {
			return err
		}
		switch {
		case date > c.today():
			errs["date"] = validation.NewError("validation_date_in_future", "The date is in the future.")
		case first == "" || month < first:
			errs["date"] = validation.NewError("validation_date_before_first_month", "The date is before the first month.")
		}
	}

	switch movement.GetString("kind") {
	case "spend", "extra":
		for _, field := range []string{"from_envelope", "to_envelope", "reason"} {
			if movement.GetString(field) != "" {
				errs[field] = errOnlyTransfers
			}
		}
		if movement.GetString("user") == "" {
			errs["user"] = errRequired
		}
		envelopeID := movement.GetString("envelope")
		if envelopeID == "" {
			errs["envelope"] = errRequired
			break
		}
		envelope, err := e.App.FindRecordById("envelopes", envelopeID)
		if err != nil {
			// An unknown id is reported by the relation field.
			break
		}
		if archived := envelope.GetString("archived_from"); archived != "" && movement.GetString("month") >= archived {
			errs["envelope"] = validation.NewError("validation_envelope_archived", "The envelope is gone in this month.")
		}
	case "transfer":
		if movement.GetString("envelope") != "" {
			errs["envelope"] = validation.NewError("validation_not_for_transfers", "Transfers have from and to envelopes.")
		}
		for _, field := range []string{"from_envelope", "to_envelope", "reason"} {
			if movement.GetString(field) == "" {
				errs[field] = errRequired
			}
		}
		if from := movement.GetString("from_envelope"); from != "" && from == movement.GetString("to_envelope") {
			errs["to_envelope"] = validation.NewError("validation_same_envelope", "A transfer needs two different envelopes.")
		}
	}

	if len(errs) > 0 {
		return errs
	}
	return e.Next()
}

// checkEnvelope keeps goal and the money already set aside to savings envelopes.
func checkEnvelope(e *core.RecordEvent) error {
	if e.Record.GetString("kind") == "spend" {
		errs := validation.Errors{}
		for _, field := range []string{"goal", "opening_balance"} {
			if e.Record.GetInt(field) != 0 {
				errs[field] = validation.NewError("validation_only_savings", "Only savings envelopes have this field.")
			}
		}
		if len(errs) > 0 {
			return errs
		}
	}
	return e.Next()
}

// checkMonthUpdate lets only the current month change, and its avanzo go to an active savings
// envelope; once it has one, it cannot go back to none.
func (c *cashBook) checkMonthUpdate(e *core.RecordRequestEvent) error {
	if e.Record.Original().GetString("month") != c.currentMonth() {
		return e.BadRequestError("Only the current month can change.", validation.Errors{"month": errNotCurrent})
	}
	sweepTo := e.Record.GetString("sweep_to")
	if sweepTo == "" && e.Record.Original().GetString("sweep_to") != "" {
		return e.BadRequestError("The avanzo needs an envelope.", validation.Errors{"sweep_to": errRequired})
	}
	if sweepTo != "" {
		envelope, err := e.App.FindRecordById("envelopes", sweepTo)
		if err == nil && (envelope.GetString("kind") != "save" || envelope.GetString("archived_from") != "") {
			return e.BadRequestError("The avanzo goes to an active savings envelope.", validation.Errors{
				"sweep_to": validation.NewError("validation_sweep_to_savings", "Choose an active savings envelope."),
			})
		}
	}
	return e.Next()
}

// checkAllocationUpdate lets only the allocations of the current month change: past months keep
// the split they had.
func (c *cashBook) checkAllocationUpdate(e *core.RecordRequestEvent) error {
	month, err := e.App.FindRecordById("months", e.Record.GetString("month"))
	if err != nil {
		return err
	}
	if month.GetString("month") != c.currentMonth() {
		return e.BadRequestError("Only the current month can change.", validation.Errors{"month": errNotCurrent})
	}
	return e.Next()
}

// checkQuotaUpdate refuses a quota paid on a day that does not exist or is still to come.
func (c *cashBook) checkQuotaUpdate(e *core.RecordRequestEvent) error {
	paidOn := e.Record.GetString("paid_on")
	if _, err := time.Parse(time.DateOnly, paidOn); paidOn != "" && err != nil {
		return e.BadRequestError("Not a calendar day.", validation.Errors{
			"paid_on": validation.NewError("validation_invalid_date", "Not a calendar day."),
		})
	}
	if paidOn > c.today() {
		return e.BadRequestError("The quota cannot be paid in the future.", validation.Errors{
			"paid_on": validation.NewError("validation_date_in_future", "The date is in the future."),
		})
	}
	return e.Next()
}

// firstMonth is the oldest month with a snapshot, or "" before the first one exists.
func (c *cashBook) firstMonth(app core.App) (string, error) {
	var first string
	err := app.DB().Select("COALESCE(MIN(month), '')").From("months").Row(&first)
	return first, err
}
