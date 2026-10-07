package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Superusers work only from the server itself: the dashboard is reached through an SSH tunnel.
// Behind Caddy the client address comes from X-Forwarded-For, so no path or collection id that
// reaches PocketBase through the public domains can sign a superuser in or use a superuser token.
func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()
		settings.SuperuserIPs = []string{"127.0.0.1", "::1"}

		return app.Save(settings)
	}, func(app core.App) error {
		settings := app.Settings()
		settings.SuperuserIPs = nil

		return app.Save(settings)
	})
}
