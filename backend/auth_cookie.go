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
			return e.NoContent(http.StatusNoContent)
		})
		return se.Next()
	})

	// Sign-in and refresh write the new token into the cookie and leave it out of the response.
	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		// Posted by another site, a sign-in would put that site's account into the cookie of the apps.
		if !isSameOrigin(e.Request) {
			return e.ForbiddenError("Sign in from the apps.", nil)
		}
		e.SetCookie(authCookie(cfg, e.Token, int(e.Collection.AuthToken.Duration)))
		e.Token = ""
		return e.Next()
	})
}

// authCookie lasts as long as the token in it; a negative maxAge deletes the cookie. Its path keeps
// it to the API: the other sites on the same domain never receive it on their pages.
func authCookie(cfg config, token string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Domain:   cfg.cookieDomain,
		Path:     "/api/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
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
