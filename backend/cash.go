package main

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// cashBook owns the hooks, routes and cron of Conti. Its days follow loc, so a spend written at
// 00:30 in Rome belongs to the new day whatever the server clock says.
type cashBook struct {
	app core.App
	loc *time.Location
	now func() time.Time
}

// registerCash binds Conti to the app; now is time.Now outside the tests.
func registerCash(app core.App, cfg config, now func() time.Time) *cashBook {
	c := &cashBook{app: app, loc: cfg.location, now: now}
	c.registerHooks()
	return c
}

// today is the calendar day in the app time zone, as YYYY-MM-DD.
func (c *cashBook) today() string {
	return c.now().In(c.loc).Format(time.DateOnly)
}

// currentMonth is the month of today, as YYYY-MM.
func (c *cashBook) currentMonth() string {
	return c.today()[:7]
}
