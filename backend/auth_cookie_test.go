package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// authCookieFrom returns the auth cookie a response sets, or nil.
func authCookieFrom(res *http.Response) *http.Cookie {
	for _, cookie := range res.Cookies() {
		if cookie.Name == authCookieName {
			return cookie
		}
	}
	return nil
}

func TestCookieAuth(t *testing.T) {
	f := newFixture(t)
	setup := func(t testing.TB, app core.App) {
		registerCookieAuth(app, config{})
	}
	credentials := func(identity string) *strings.Reader {
		return strings.NewReader(`{"identity":"` + identity + `","password":"` + f.password + `"}`)
	}
	cookieA := authCookieName + "=" + f.tokenA
	expectSession := func(username string) func(testing.TB, *tests.TestApp, *http.Response) {
		return func(t testing.TB, app *tests.TestApp, res *http.Response) {
			cookie := authCookieFrom(res)
			if cookie == nil {
				t.Fatal("no auth cookie in the response")
			}
			if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/" || cookie.MaxAge != 90*24*60*60 {
				t.Fatalf("cookie attributes %+v", cookie)
			}
			record, err := app.FindAuthRecordByToken(cookie.Value, core.TokenTypeAuth)
			if err != nil || record.GetString("username") != username {
				t.Fatalf("the cookie does not hold a session of %s: %v", username, err)
			}
		}
	}

	f.runWith(t, setup, []tests.ApiScenario{
		{
			Name:            "signing in sets the cookie and leaves the token out of the response",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-with-password",
			Headers:         map[string]string{"Sec-Fetch-Site": "same-origin"},
			Body:            credentials("usera"),
			ExpectedStatus:  200,
			ExpectedContent: []string{`"token":""`, `"username":"usera"`},
			AfterTestFunc:   expectSession("usera"),
		},
		{
			Name:            "the cookie authenticates a request of the app",
			Method:          http.MethodGet,
			URL:             "/api/collections/lists/records",
			Headers:         map[string]string{"Cookie": cookieA, "Sec-Fetch-Site": "same-origin"},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":1`},
		},
		{
			Name:            "the cookie is ignored on a request from another subdomain",
			Method:          http.MethodGet,
			URL:             "/api/collections/lists/records",
			Headers:         map[string]string{"Cookie": cookieA, "Sec-Fetch-Site": "same-site"},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "a request with neither Sec-Fetch-Site nor Origin does not use the cookie",
			Method:          http.MethodGet,
			URL:             "/api/collections/lists/records",
			Headers:         map[string]string{"Cookie": cookieA},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "a sign-in posted by another site is refused, so it cannot swap the account in the cookie",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-with-password",
			Headers:         map[string]string{"Sec-Fetch-Site": "cross-site"},
			Body:            credentials("usera"),
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if authCookieFrom(res) != nil {
					t.Fatal("a cross-site sign-in set the auth cookie")
				}
			},
		},
		{
			Name:            "without Sec-Fetch-Site the Origin must be this host",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-refresh",
			Headers:         map[string]string{"Cookie": cookieA, "Origin": "http://example.com"},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"token":""`, `"username":"usera"`},
			AfterTestFunc:   expectSession("usera"),
		},
		{
			Name:            "a foreign Origin does not get the session",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-refresh",
			Headers:         map[string]string{"Cookie": cookieA, "Origin": "https://ftgdr.skybreaker.dev"},
			ExpectedStatus:  401,
			ExpectedContent: []string{`"data":{}`},
		},
		{
			Name:            "an Authorization header wins over the cookie",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-refresh",
			Headers:         map[string]string{"Cookie": cookieA, "Sec-Fetch-Site": "same-origin", "Authorization": f.tokenB},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"username":"userb"`},
			AfterTestFunc:   expectSession("userb"),
		},
		{
			Name:            "the token of an old localStorage session is exchanged for the cookie",
			Method:          http.MethodPost,
			URL:             "/api/collections/users/auth-refresh",
			Headers:         map[string]string{"Authorization": f.tokenA, "Sec-Fetch-Site": "same-origin"},
			ExpectedStatus:  200,
			ExpectedContent: []string{`"token":""`},
			AfterTestFunc:   expectSession("usera"),
		},
		{
			Name:           "signing out deletes the cookie",
			Method:         http.MethodPost,
			URL:            "/api/auth/logout",
			Headers:        map[string]string{"Sec-Fetch-Site": "same-origin"},
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if cookie := authCookieFrom(res); cookie == nil || cookie.MaxAge >= 0 || cookie.Value != "" {
					t.Fatalf("the cookie was not deleted: %+v", cookie)
				}
			},
		},
		{
			Name:            "signing out from another site is refused",
			Method:          http.MethodPost,
			URL:             "/api/auth/logout",
			Headers:         map[string]string{"Sec-Fetch-Site": "same-site"},
			ExpectedStatus:  403,
			ExpectedContent: []string{`"data":{}`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if authCookieFrom(res) != nil {
					t.Fatal("a cross-site sign-out touched the auth cookie")
				}
			},
		},
		{
			Name:               "a superuser impersonating a user gets the token, not a cookie",
			Method:             http.MethodPost,
			URL:                "/api/collections/users/impersonate/" + f.userA.Id,
			Headers:            map[string]string{"Authorization": f.tokenSuperuser, "X-Forwarded-For": "127.0.0.1"},
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"token":"ey`, `"username":"usera"`},
			NotExpectedContent: []string{`"token":""`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if authCookieFrom(res) != nil {
					t.Fatal("an impersonation set the auth cookie")
				}
			},
		},
		{
			Name:               "superusers keep their token, for the dashboard",
			Method:             http.MethodPost,
			URL:                "/api/collections/_superusers/auth-with-password",
			Headers:            map[string]string{"X-Forwarded-For": "127.0.0.1"},
			Body:               credentials("admin@example.test"),
			ExpectedStatus:     200,
			ExpectedContent:    []string{`"token":"ey`},
			NotExpectedContent: []string{`"token":""`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				if authCookieFrom(res) != nil {
					t.Fatal("a superuser sign-in set the auth cookie")
				}
			},
		},
	})
}
