package main

import (
	"encoding/json"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Grandezza e posizione della finestra (1.29.0).
//
// Prima la finestra si apriva sempre a 1280×860: negli schermi piccoli (1366×768, o 1920×1080 con il testo al 125%) era più alta dello
// spazio sopra la barra delle applicazioni, e non ricordava mai come la persona l'aveva lasciata. Edge ricorda le finestre «app» per
// conto suo, sotto il nome «host_percorso» dell'indirizzo con cui si aprono, ma con 127.0.0.1 il nome si spezza ai punti e non lo ritrova
// più (provato con Chromium: con «localhost» la finestra torna dov'era, anche ingrandita; con 127.0.0.1 no); e una misura data all'avvio
// vince sempre sulla sua memoria.
//
// Così ora la finestra si apre da http://localhost:PORTA/__finestra, che rimanda subito alla pagina di sempre su 127.0.0.1 (stesso
// indirizzo di prima: stile, tema, visita guidata e le altre scelte salvate nella pagina restano). Edge ricorda la finestra sotto
// «localhost_/__finestra». Solo quando non ha ancora niente da ricordare (la prima volta, o con un profilo nuovo) il programma gli dà
// una misura in proporzione all'area di lavoro dello schermo, e negli schermi piccoli la ingrandisce appena compare.

// nomeFinestraEdge è il nome con cui Edge (Chromium) ricorda la finestra aperta da urlFinestra: host e percorso, senza porta né domanda.
const nomeFinestraEdge = "localhost_/__finestra"

// Area è un rettangolo dello schermo in pixel della pagina (quelli che Edge usa per --window-size e --window-position).
type Area struct{ X, Y, W, H int }

// Apertura: con che misura aprire la finestra la prima volta.
type Apertura struct {
	Area
	ConPosizione bool // false: lo schermo non si conosce, la posizione la sceglie Edge
	Ingrandisci  bool // ingrandirla appena compare (Edge non lo fa da solo per le finestre «app»)
}

const (
	finestraMaxW, finestraMaxH       = 1600, 1000 // la pagina è larga al massimo 1360 più il menu: oltre resterebbe spazio vuoto
	schermoPiccoloW, schermoPiccoloH = 1600, 860  // sotto una di queste misure la finestra si apre ingrandita: ogni pixel serve
	finestraIgnotaW, finestraIgnotaH = 1280, 800  // se lo schermo non si riesce a leggere
	quotaLarghezza, quotaAltezza     = 0.88, 0.90 // la parte dello schermo che la finestra prende quando non è ingrandita
	areaMinimaW, areaMinimaH         = 640, 480   // un'area di lavoro più piccola di così è una lettura sbagliata
	areaMassima                      = 20000      // idem, più grande
	dpiNormale                       = 96
)

// aperturaFinestra: la misura della prima volta, in proporzione all'area di lavoro, al centro. Negli schermi piccoli anche
// ingrandita; la misura serve lo stesso: è quella che «Ripristina» le ridà.
func aperturaFinestra(schermo Area) Apertura {
	if schermo.W < areaMinimaW || schermo.H < areaMinimaH || schermo.W > areaMassima || schermo.H > areaMassima {
		return Apertura{Area: Area{W: finestraIgnotaW, H: finestraIgnotaH}}
	}
	w := min(int(math.Round(float64(schermo.W)*quotaLarghezza)), finestraMaxW)
	h := min(int(math.Round(float64(schermo.H)*quotaAltezza)), finestraMaxH)
	return Apertura{
		Area:         Area{X: schermo.X + (schermo.W-w)/2, Y: schermo.Y + (schermo.H-h)/2, W: w, H: h},
		ConPosizione: true,
		Ingrandisci:  schermo.W < schermoPiccoloW || schermo.H < schermoPiccoloH,
	}
}

// argomenti: le opzioni di Edge per questa misura.
func (a Apertura) argomenti() []string {
	out := []string{"--window-size=" + strconv.Itoa(a.W) + "," + strconv.Itoa(a.H)}
	if a.ConPosizione {
		out = append(out, "--window-position="+strconv.Itoa(a.X)+","+strconv.Itoa(a.Y))
	}
	return out
}

// inPixelPagina porta un'area da pixel veri a pixel della pagina: con il testo di Windows al 125% (120 dpi) 1920 pixel sono 1536.
func inPixelPagina(a Area, dpi int) Area {
	if dpi <= 0 || dpi == dpiNormale {
		return a
	}
	k := float64(dpiNormale) / float64(dpi)
	r := func(n int) int { return int(math.Round(float64(n) * k)) }
	return Area{X: r(a.X), Y: r(a.Y), W: r(a.W), H: r(a.H)}
}

// urlFinestra: l'indirizzo con cui si apre la finestra (http://localhost:PORTA/__finestra?c=…) a partire da quello d'avvio
// (http://127.0.0.1:PORTA/__avvio?c=…). Un indirizzo diverso resta com'è.
func urlFinestra(avvio string) string {
	u, err := url.Parse(avvio)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Path != "/__avvio" || u.Port() == "" {
		return avvio
	}
	return "http://localhost:" + u.Port() + "/__finestra?" + url.Values{"c": {u.Query().Get("c")}}.Encode()
}

// edgeRicordaFinestra: Edge ha già una misura per la finestra del programma (in Default\Preferences del profilo della finestra).
// Se il file non c'è o non si legge, no: il programma dà la sua misura, come la prima volta.
func edgeRicordaFinestra(profilo string) bool {
	if profilo == "" {
		return false
	}
	b, err := os.ReadFile(filepath.Join(profilo, "Default", "Preferences"))
	if err != nil {
		return false
	}
	var p struct {
		Browser struct {
			Finestre map[string]struct {
				Left, Top, Right, Bottom int
			} `json:"app_window_placement"`
		} `json:"browser"`
	}
	if json.Unmarshal(b, &p) != nil {
		return false
	}
	f, ok := p.Browser.Finestre[nomeFinestraEdge]
	return ok && f.Right-f.Left >= 200 && f.Bottom-f.Top >= 150
}

// hostLocalhost: lo stesso indirizzo del programma con «localhost» al posto di 127.0.0.1 (l'unico altro Host ammesso, e solo per /__finestra).
func hostLocalhost(host string) string {
	if p, ok := strings.CutPrefix(host, "127.0.0.1:"); ok {
		return "localhost:" + p
	}
	return ""
}
