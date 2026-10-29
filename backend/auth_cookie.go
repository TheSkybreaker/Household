package main

import (
	"net/http"
	"net/url"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

const authCookieName = "pb_auth"

// registerCookieAuth keeps the auth token of the users in an HttpOnly cookie on cfg.cookieDomain,
// so a sign-in in one app counts in the others while their JavaScript never sees the token.
func registerCookieAuth(app core.App, cfg config) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id: "householdCookieAuth",
			// Before PocketBase reads the Authorization header.
			Priority: apis.DefaultLoadAuthTokenMiddlewarePriority - 1,
			Func: func(e *core.RequestEvent) error {
				if e.Request.Header.Get("Authorization") == "" && isSameOrigin(e.Request) {
					if cookie, err := e.Request.Cookie(authCookieName); err == nil && cookie.Value != "" {
						e.Request.Header.Set("Authorization", cookie.Value)
					}
				}
				return e.Next()
			},
		})

		se.Router.POST("/api/auth/logout", func(e *core.RequestEvent) error {
			if !isSameOrigin(e.Request) {
				return e.ForbiddenError("Sign out from the apps.", nil)
			}
			e.SetCookie(authCookie(cfg, "", -1))
			e.SetCookie(legacyAuthCookieDeletion(cfg))
			return e.NoContent(http.StatusNoContent)
		})
		return se.Next()
	})

	// Sign-in and refresh write the new token into the cookie and leave it out of the response.
	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		// A superuser impersonating a user, from the dashboard or the API, wants the token itself.
		if e.Auth != nil && e.Auth.IsSuperuser() {
			return e.Next()
		}
		// Posted by another site, a sign-in would put that site's account into the cookie of the apps.
		if !isSameOrigin(e.Request) {
			return e.ForbiddenError("Sign in from the apps.", nil)
		}
		e.SetCookie(authCookie(cfg, e.Token, int(e.Collection.AuthToken.Duration)))
		e.SetCookie(legacyAuthCookieDeletion(cfg))
		e.Token = ""
		return e.Next()
	})
}

// The apps reach the API under /household/api/, which Caddy hands to PocketBase as /api/. A cookie
// on that path goes only to this API: the other sites on the domain have no such path, while many
// have an /api/.
const (
	authCookiePath       = "/household/api/"
	legacyAuthCookiePath = "/api/"
)

// authCookie lasts as long as the token in it; a negative maxAge deletes the cookie.
func authCookie(cfg config, token string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Domain:   cfg.cookieDomain,
		Path:     authCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

// legacyAuthCookieDeletion deletes the cookie the apps used on /api/ before, when they first
// refresh their session on the new path.
func legacyAuthCookieDeletion(cfg config) *http.Cookie {
	cookie := authCookie(cfg, "", -1)
	cookie.Path = legacyAuthCookiePath
	return cookie
}

// isSameOrigin tells a request of the app on this host from one another site makes the browser
// send: every subdomain of skybreaker.dev is the same site, so SameSite=Lax alone lets those through.
// Browsers send Sec-Fetch-Site; Origin is the fallback for those that do not.
func isSameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "same-origin"
	}
	origin, err := url.Parse(r.Header.Get("Origin"))
	return err == nil && origin.Host != "" && origin.Host == r.Host
}
