package main

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"strings"
	"time"
	// The binary carries the time zone database, so APP_TZ works on any host.
	_ "time/tzdata"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/joho/godotenv"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/spf13/cobra"

	_ "household/migrations"
)

type config struct {
	vapidPublicKey  string
	vapidPrivateKey string
	vapidSubject    string
	cookieDomain    string
	// location is APP_TZ, the zone of "today" and of the Conti month close.
	location *time.Location
	dev      bool
}

// loadConfig reads the environment, after loading the optional .env file used in development.
func loadConfig() (config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return config{}, err
	}

	var location *time.Location
	if zone := os.Getenv("APP_TZ"); zone != "" {
		var err error
		if location, err = time.LoadLocation(zone); err != nil {
			return config{}, fmt.Errorf("APP_TZ: %w", err)
		}
	}

	return config{
		vapidPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		vapidPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		// webpush-go adds "mailto:" to anything that is not an https URL.
		vapidSubject: strings.TrimPrefix(os.Getenv("VAPID_SUBJECT"), "mailto:"),
		cookieDomain: os.Getenv("COOKIE_DOMAIN"),
		location:     location,
		dev:          os.Getenv("DEV") == "1",
	}, nil
}

func (c config) missingVariables() []string {
	var missing []string
	for _, variable := range []struct{ name, value string }{
		{"VAPID_PUBLIC_KEY", c.vapidPublicKey},
		{"VAPID_PRIVATE_KEY", c.vapidPrivateKey},
		{"VAPID_SUBJECT", c.vapidSubject},
	} {
		if variable.value == "" {
			missing = append(missing, variable.name)
		}
	}
	if c.location == nil {
		missing = append(missing, "APP_TZ")
	}
	return missing
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	app := pocketbase.New()

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: cfg.dev,
	})

	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "vapid",
		Short: "Generates a VAPID key pair for Web Push",
		RunE: func(cmd *cobra.Command, args []string) error {
			privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
			if err != nil {
				return err
			}
			fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", publicKey, privateKey)
			return nil
		},
	})

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if missing := cfg.missingVariables(); len(missing) > 0 {
			return fmt.Errorf("missing environment variables: %s (generate the keys with `go run . vapid`)", strings.Join(missing, ", "))
		}

		return se.Next()
	})

	registerCookieAuth(app, cfg)
	registerPush(app, cfg, webpush.SendNotification)
	registerCash(app, cfg, time.Now)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
