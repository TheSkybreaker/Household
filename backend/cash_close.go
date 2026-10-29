package main

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const monthLayout = "2006-01"

// nextMonth is the month after month, both YYYY-MM.
func nextMonth(month string) string {
	t, _ := time.Parse(monthLayout, month)
	return t.AddDate(0, 1, 0).Format(monthLayout)
}

// previousMonth is the month before month, both YYYY-MM.
func previousMonth(month string) string {
	t, _ := time.Parse(monthLayout, month)
	return t.AddDate(0, -1, 0).Format(monthLayout)
}

// lastDay is the last day of month, as YYYY-MM-DD.
func lastDay(month string) string {
	t, _ := time.Parse(monthLayout, month)
	return t.AddDate(0, 1, -1).Format(time.DateOnly)
}

// syncMonths opens every month up to the current one and closes every past month, oldest first. It
// runs every night and at start, and does nothing when everything is already in place.
func (c *cashBook) syncMonths() error {
	current := c.currentMonth()
	if err := c.app.RunInTransaction(func(tx core.App) error { return c.openMonths(tx, current) }); err != nil {
		return err
	}

	l, err := loadLedger(c.app)
	if err != nil {
		return err
	}
	for _, month := range l.months {
		if month.Month >= current || month.ClosedAt != "" {
			continue
		}
		if err := c.app.RunInTransaction(func(tx core.App) error { return c.closeMonth(tx, month.ID) }); err != nil {
			return err
		}
	}
	return nil
}

// openMonths creates each missing month up to current as a copy of the one before: quotas still to
// pay, allocations of the envelopes that exist in it, the same avanzo envelope. The very first
// month starts empty, with a quota of 0 for everyone.
func (c *cashBook) openMonths(tx core.App, current string) error {
	months, err := tx.FindRecordsByFilter("months", "month != ''", "-month", 1, 0)
	if err != nil {
		return err
	}
	users, err := tx.FindAllRecords("users")
	if err != nil {
		return err
	}
	if len(months) == 0 {
		month, err := saveRecord(tx, "months", map[string]any{"month": current})
		if err != nil {
			return err
		}
		for _, user := range users {
			if _, err := saveRecord(tx, "month_quotas", map[string]any{"month": month.Id, "user": user.Id, "amount": 0}); err != nil {
				return err
			}
		}
		return nil
	}

	previous := months[0]
	for name := nextMonth(previous.GetString("month")); name <= current; name = nextMonth(name) {
		month, err := saveRecord(tx, "months", map[string]any{"month": name, "sweep_to": previous.GetString("sweep_to")})
		if err != nil {
			return err
		}

		quotas, err := tx.FindAllRecords("month_quotas", dbx.HashExp{"month": previous.Id})
		if err != nil {
			return err
		}
		amounts := map[string]int{}
		for _, quota := range quotas {
			amounts[quota.GetString("user")] = quota.GetInt("amount")
		}
		for _, user := range users {
			if _, err := saveRecord(tx, "month_quotas", map[string]any{"month": month.Id, "user": user.Id, "amount": amounts[user.Id]}); err != nil {
				return err
			}
		}

		allocations, err := tx.FindAllRecords("month_allocations", dbx.HashExp{"month": previous.Id})
		if err != nil {
			return err
		}
		for _, allocation := range allocations {
			envelope, err := tx.FindRecordById("envelopes", allocation.GetString("envelope"))
			if err != nil {
				return err
			}
			if archived := envelope.GetString("archived_from"); archived != "" && name >= archived {
				continue
			}
			if _, err := saveRecord(tx, "month_allocations", map[string]any{"month": month.Id, "envelope": envelope.Id, "amount": allocation.GetInt("amount")}); err != nil {
				return err
			}
		}
		previous = month
	}
	return nil
}

// closeMonth moves what each spend envelope has left, or is over, to or from the avanzo envelope
// with transfers dated the last day of the month, then marks the month closed.
func (c *cashBook) closeMonth(tx core.App, monthID string) error {
	month, err := tx.FindRecordById("months", monthID)
	if err != nil {
		return err
	}
	if !month.GetDateTime("closed_at").IsZero() {
		return nil
	}

	if sweepTo := month.GetString("sweep_to"); sweepTo != "" {
		l, err := loadLedger(tx)
		if err != nil {
			return err
		}
		author, err := firstUser(tx)
		if err != nil {
			return err
		}
		name := month.GetString("month")
		for _, envelope := range l.activeIn(name) {
			left := l.left(envelope.ID, name)
			if envelope.Kind != "spend" || left == 0 {
				continue
			}
			from, to, amount := envelope.ID, sweepTo, left
			if left < 0 {
				from, to, amount = sweepTo, envelope.ID, -left
			}
			if _, err := saveRecord(tx, "movements", map[string]any{
				"kind": "transfer", "reason": "sweep", "date": lastDay(name), "amount": amount,
				"from_envelope": from, "to_envelope": to, "created_by": author,
			}); err != nil {
				return err
			}
		}
	}

	month.Set("closed_at", c.now())
	return tx.Save(month)
}

// firstUser signs the transfers the server writes: the oldest account.
func firstUser(app core.App) (string, error) {
	users, err := app.FindRecordsByFilter("users", "id != ''", "created", 1, 0)
	if err != nil || len(users) == 0 {
		return "", err
	}
	return users[0].Id, nil
}

func saveRecord(app core.App, collectionName string, data map[string]any) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Load(data)
	return record, app.Save(record)
}
