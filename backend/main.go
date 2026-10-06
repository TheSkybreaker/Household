package main

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"strings"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/joho/godotenv"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
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
	dev             bool
}

// loadConfig reads the environment, after loading the optional .env file used in development.
func loadConfig() (config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return config{}, err
	}

	return config{
		vapidPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		vapidPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		// webpush-go adds "mailto:" to anything that is not an https URL.
		vapidSubject: strings.TrimPrefix(os.Getenv("VAPID_SUBJECT"), "mailto:"),
		cookieDomain: os.Getenv("COOKIE_DOMAIN"),
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
	return missing
}

func main() {
	// Go does not know the web app manifest extension and would serve it as text/plain.
	if err := mime.AddExtensionType(".webmanifest", "application/manifest+json"); err != nil {
		log.Fatal(err)
	}

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

		se.Router.GET("/{path...}", serveStatic(publicFiles()))
		return se.Next()
	})

	registerCookieAuth(app, cfg)
	registerPush(app, cfg, webpush.SendNotification)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// serveStatic serves the Astro build. apis.Static redirects a directory path to its trailing
// slash form but drops the query string, and "/lista?id=<id>" carries the list id there.
func serveStatic(fsys fs.FS) func(*core.RequestEvent) error {
	static := apis.Static(fsys, false)

	return func(e *core.RequestEvent) error {
		url := e.Request.URL
		if !strings.HasSuffix(url.Path, "/") {
			info, err := fs.Stat(fsys, e.Request.PathValue(apis.StaticWildcardParam))
			if err == nil && info.IsDir() {
				target := url.Path + "/"
				if url.RawQuery != "" {
					target += "?" + url.RawQuery
				}
				return e.Redirect(http.StatusMovedPermanently, target)
			}
		}

		return static(e)
	}
}
