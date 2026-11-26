package main

import (
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestAperturaFinestraInProporzioneAlloSchermo(t *testing.T) {
	casi := []struct {
		nome    string
		schermo Area
		vuole   Apertura
	}{
		// a laptop at 1366×768 (taskbar 40): maximized, with a size to go back to
		{"1366x768", Area{0, 0, 1366, 728}, Apertura{Area{X: 82, Y: 36, W: 1202, H: 655}, true, true}},
		// 1920×1080 with the text of Windows at 125%: 1536×832 page pixels, still small
		{"1920x1080 al 125%", inPixelPagina(Area{0, 0, 1920, 1040}, 120), Apertura{Area{X: 92, Y: 41, W: 1352, H: 749}, true, true}},
		// 1920×1080 at 100%: a large window in the middle, not maximized
		{"1920x1080", Area{0, 0, 1920, 1040}, Apertura{Area{X: 160, Y: 52, W: 1600, H: 936}, true, false}},
		// a big screen: never wider than the page needs
		{"2560x1440", Area{0, 0, 2560, 1400}, Apertura{Area{X: 480, Y: 200, W: 1600, H: 1000}, true, false}},
		// taskbar on the left: the window stays inside the work area
		{"barra a sinistra", Area{62, 0, 1858, 1080}, Apertura{Area{X: 191, Y: 54, W: 1600, H: 972}, true, false}},
		// a screen that cannot be read: a plain size and Edge chooses where
		{"sconosciuto", Area{}, Apertura{Area{W: 1280, H: 800}, false, false}},
		{"lettura sbagliata", Area{0, 0, 50000, 900}, Apertura{Area{W: 1280, H: 800}, false, false}},
	}
	for _, c := range casi {
		got := aperturaFinestra(c.schermo)
		if got != c.vuole {
			t.Errorf("%s: %+v, voluto %+v", c.nome, got, c.vuole)
		}
		if got.ConPosizione && (got.X < c.schermo.X || got.Y < c.schermo.Y || got.X+got.W > c.schermo.X+c.schermo.W || got.Y+got.H > c.schermo.Y+c.schermo.H) {
			t.Errorf("%s: la finestra esce dallo schermo: %+v in %+v", c.nome, got, c.schermo)
		}
	}
	// the old fixed size did not fit the small screens: the new one always does
	if a := aperturaFinestra(Area{0, 0, 1366, 728}); a.H > 728 {
		t.Errorf("1366x768: alta %d", a.H)
	}
}

func TestArgomentiDellaMisura(t *testing.T) {
	a := Apertura{Area{X: 160, Y: 52, W: 1600, H: 936}, true, false}
	if got := a.argomenti(); !reflect.DeepEqual(got, []string{"--window-size=1600,936", "--window-position=160,52"}) {
		t.Fatal(got)
	}
	if got := (Apertura{Area: Area{W: 1280, H: 800}}).argomenti(); !reflect.DeepEqual(got, []string{"--window-size=1280,800"}) {
		t.Fatal(got)
	}
}

func TestInPixelPagina(t *testing.T) {
	if got := inPixelPagina(Area{0, 0, 1920, 1040}, 120); got != (Area{0, 0, 1536, 832}) {
		t.Fatal(got)
	}
	if got := inPixelPagina(Area{-1920, 0, 1920, 1040}, 144); got != (Area{-1280, 0, 1280, 693}) {
		t.Fatal(got)
	}
	if got := inPixelPagina(Area{0, 0, 1366, 728}, 96); got != (Area{0, 0, 1366, 728}) {
		t.Fatal(got)
	}
	if got := inPixelPagina(Area{0, 0, 1366, 728}, 0); got != (Area{0, 0, 1366, 728}) {
		t.Fatal("a dpi that cannot be read changes nothing", got)
	}
}

func TestUrlFinestra(t *testing.T) {
	casi := map[string]string{
		"http://127.0.0.1:47815/__avvio?c=abc123":  "http://localhost:47815/__finestra?c=abc123",
		"http://127.0.0.1:51234/__avvio?c=a+b&x=1": "http://localhost:51234/__finestra?c=a+b",
		"http://127.0.0.1:47815/":                  "http://127.0.0.1:47815/",
		"http://192.168.1.5:47815/__avvio?c=abc":   "http://192.168.1.5:47815/__avvio?c=abc",
		"https://127.0.0.1:47815/__avvio?c=abc":    "https://127.0.0.1:47815/__avvio?c=abc",
		"http://127.0.0.1/__avvio?c=abc":           "http://127.0.0.1/__avvio?c=abc",
		"::non un indirizzo":                       "::non un indirizzo",
	}
	for in, vuole := range casi {
		if got := urlFinestra(in); got != vuole {
			t.Errorf("%q: %q, voluto %q", in, got, vuole)
		}
	}
	if hostLocalhost("127.0.0.1:47815") != "localhost:47815" || hostLocalhost("192.168.1.5:47815") != "" {
		t.Fatal("hostLocalhost")
	}
}

func TestEdgeRicordaFinestra(t *testing.T) {
	scrivi := func(t *testing.T, testo string) string {
		dir := t.TempDir()
		if testo != "" {
			if err := os.MkdirAll(filepath.Join(dir, "Default"), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "Default", "Preferences"), []byte(testo), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		return dir
	}
	// what Chromium wrote in the trial: the window of localhost, and the old one of 127.0.0.1 split at the dots (never found again)
	ricordata := `{"browser":{"app_window_placement":{"localhost_/__finestra":{"bottom":980,"left":200,"maximized":true,"right":1500,"top":80,"work_area_bottom":1080,"work_area_left":0,"work_area_right":1920,"work_area_top":0}}},"profile":{"name":"x"}}`
	vecchia := `{"browser":{"app_window_placement":{"127":{"0":{"0":{"1_/__avvio":{"bottom":750,"left":100,"maximized":false,"right":1100,"top":50}}}}}}}`
	casi := []struct {
		nome, testo string
		vuole       bool
	}{
		{"ricordata", ricordata, true},
		{"solo quella vecchia di 127.0.0.1", vecchia, false},
		{"profilo nuovo", "", false},
		{"senza finestre", `{"browser":{}}`, false},
		{"file rovinato", `{"browser":{"app_window_pla`, false},
		{"misura impossibile", `{"browser":{"app_window_placement":{"localhost_/__finestra":{"bottom":10,"left":0,"right":10,"top":0}}}}`, false},
		{"altro tipo", `{"browser":{"app_window_placement":{"localhost_/__finestra":"x"}}}`, false},
	}
	for _, c := range casi {
		if got := edgeRicordaFinestra(scrivi(t, c.testo)); got != c.vuole {
			t.Errorf("%s: %v", c.nome, got)
		}
	}
	if edgeRicordaFinestra("") {
		t.Error("nessun profilo")
	}
}

// The window opens from localhost and goes on to the usual launch address; localhost is not accepted anywhere else.
func TestFinestraDaLocalhost(t *testing.T) {
	srv, h := newTestServer(t)
	u := srv.LaunchURL()
	f := urlFinestra(u)
	if !strings.HasPrefix(f, "http://localhost:47815/__finestra?c=") {
		t.Fatal(f)
	}
	r := do(h, call{method: "GET", target: strings.TrimPrefix(f, "http://localhost:47815"), host: "localhost:47815"})
	if r.StatusCode != http.StatusSeeOther || r.Header.Get("Location") != u {
		t.Fatalf("finestra: %d %q (voluto %q)", r.StatusCode, r.Header.Get("Location"), u)
	}
	if len(r.Cookies()) != 0 {
		t.Fatal("no cookie on localhost: the page lives on 127.0.0.1")
	}
	// then the launch address works as always (the code was not used up by the step through localhost)
	r = do(h, call{method: "GET", target: strings.TrimPrefix(u, "http://"+testHost)})
	if r.StatusCode != http.StatusSeeOther || len(r.Cookies()) == 0 {
		t.Fatalf("avvio dopo la finestra: %d", r.StatusCode)
	}
	// localhost for anything else: refused, as any other name
	for _, p := range []string{"/", "/__avvio?c=x", "/api/stato", "/app.js", "/__versione"} {
		if r := do(h, call{method: "GET", target: p, host: "localhost:47815"}); r.StatusCode != http.StatusForbidden {
			t.Errorf("localhost %s: %d", p, r.StatusCode)
		}
	}
	// another port on localhost, another name, or from another device: refused
	if r := do(h, call{method: "GET", target: "/__finestra?c=x", host: "localhost:9999"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("altra porta: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/__finestra?c=x", host: "evil.example:47815"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("altro nome: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/__finestra?c=x", remote: true, host: "localhost:47815"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("da un altro dispositivo: %d", r.StatusCode)
	}
	// only the code goes on, nothing else
	r = do(h, call{method: "GET", target: "/__finestra?c=abc&dove=https://evil.example", host: "localhost:47815"})
	if loc := r.Header.Get("Location"); loc != "http://"+testHost+"/__avvio?c=abc" {
		t.Errorf("solo il codice: %q", loc)
	}
}
