package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// sondeFinte: un computer con Edge, due scanner, l'audio e il canale degli aggiornamenti che risponde.
func sondeFinte() Sonde {
	return Sonde{
		Browser: func() string { return "Microsoft Edge" },
		Scanner: func(context.Context) (int, error) { return 2, nil },
		Audio:   func() (int, error) { return 1, nil },
		Canale:  func(context.Context) error { return nil },
		Adesso:  time.Now,
	}
}

// esito trova l'esito di una prova per nome.
func esito(t *testing.T, esiti []Esito, cosa string) Esito {
	t.Helper()
	for _, e := range esiti {
		if e.Cosa == cosa {
			return e
		}
	}
	t.Fatalf("manca la prova «%s» tra: %v", cosa, nomiEsiti(esiti))
	return Esito{}
}

func nomiEsiti(esiti []Esito) []string {
	var n []string
	for _, e := range esiti {
		n = append(n, e.Cosa)
	}
	return n
}

func TestClassificaSpazio(t *testing.T) {
	for liberi, voluto := range map[int64]string{0: esitoErrore, 50 << 20: esitoErrore, 100 << 20: esitoAvviso, 500 << 20: esitoAvviso, 1 << 30: esitoOk, 50 << 30: esitoOk} {
		if got := classificaSpazio(liberi); got != voluto {
			t.Errorf("classificaSpazio(%d) = %s, voluto %s", liberi, got, voluto)
		}
	}
}

func TestControlloUnComputerInOrdine(t *testing.T) {
	srv, _ := newTestServer(t)
	srv.sonde = sondeFinte()
	if _, _, err := srv.store.Save(0, json.RawMessage(archivioFinto), nil, true); err != nil {
		t.Fatal(err)
	}
	esiti := srv.controllaComputer(context.Background())
	var nomi []string
	for _, e := range esiti {
		nomi = append(nomi, e.Cosa)
		if e.Testo == "" || (e.Stato != esitoOk && e.Stato != esitoAvviso && e.Stato != esitoErrore && e.Stato != esitoInfo) {
			t.Errorf("esito incompleto: %+v", e)
		}
	}
	// l'ordine è sempre lo stesso (leggere due controlli uno sotto l'altro deve essere facile); «Avvio con Windows» c'è solo su Windows
	vuoto := []string{"Orologio", "Cartella dei dati", "Archivio e copie", "Seconda copia", "Aggiornamenti: cartella del programma", "Aggiornamenti: canale", "Finestra del programma", "Scanner", "Suoni", "Accesso dal telefono"}
	filtrato := []string{}
	for _, n := range nomi {
		if n != "Errori recenti" {
			filtrato = append(filtrato, n)
		}
	}
	if strings.Join(filtrato, "|") != strings.Join(vuoto, "|") {
		t.Errorf("ordine delle prove: %v", nomi)
	}
	if e := esito(t, esiti, "Orologio"); e.Stato != esitoOk || !strings.Contains(e.Testo, "Il computer segna il ") {
		t.Errorf("orologio: %+v", e)
	}
	if e := esito(t, esiti, "Cartella dei dati"); e.Stato != esitoOk || !strings.Contains(e.Testo, "Si può scrivere") {
		t.Errorf("cartella: %+v", e)
	}
	if e := esito(t, esiti, "Archivio e copie"); e.Stato != esitoOk || !strings.Contains(e.Testo, "quella di oggi c'è") {
		t.Errorf("copie: %+v", e)
	}
	if e := esito(t, esiti, "Seconda copia"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "Non è impostata") || e.Consiglio == "" {
		t.Errorf("seconda copia non impostata: %+v", e)
	}
	if e := esito(t, esiti, "Finestra del programma"); e.Stato != esitoOk || !strings.Contains(e.Testo, "Microsoft Edge") {
		t.Errorf("finestra: %+v", e)
	}
	if e := esito(t, esiti, "Scanner"); e.Stato != esitoOk || !strings.Contains(e.Testo, "2 scanner") {
		t.Errorf("scanner: %+v", e)
	}
	if e := esito(t, esiti, "Suoni"); e.Stato != esitoOk {
		t.Errorf("suoni: %+v", e)
	}
	if e := esito(t, esiti, "Aggiornamenti: canale"); e.Stato != esitoOk {
		t.Errorf("canale: %+v", e)
	}
	if e := esito(t, esiti, "Accesso dal telefono"); e.Stato != esitoInfo || e.Testo != "Spento." {
		t.Errorf("telefono: %+v", e)
	}
}

func TestControlloLeProveCheNonVanno(t *testing.T) {
	srv, _ := newTestServer(t)
	if _, _, err := srv.store.Save(0, json.RawMessage(archivioFinto), nil, true); err != nil {
		t.Fatal(err)
	}
	conSonde := func(modifica func(*Sonde)) []Esito {
		p := sondeFinte()
		modifica(&p)
		srv.sonde = p
		return srv.controllaComputer(context.Background())
	}

	// scanner: nessuno, un errore di Windows (con il motivo), non controllabile, sonda assente
	if e := esito(t, conSonde(func(p *Sonde) { p.Scanner = func(context.Context) (int, error) { return 0, nil } }), "Scanner"); e.Stato != esitoInfo || !strings.Contains(e.Consiglio, "Allega un file") {
		t.Errorf("nessuno scanner: %+v", e)
	}
	if e := esito(t, conSonde(func(p *Sonde) {
		p.Scanner = func(context.Context) (int, error) { return 0, errors.New("Classe non registrata [0x80040154]") }
	}), "Scanner"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "Classe non registrata [0x80040154]") {
		t.Errorf("errore dello scanner: %+v", e)
	}
	if e := esito(t, conSonde(func(p *Sonde) { p.Scanner = func(context.Context) (int, error) { return 0, errNonDisponibile } }), "Scanner"); e.Stato != esitoInfo {
		t.Errorf("scanner non disponibile: %+v", e)
	}
	if e := esito(t, conSonde(func(p *Sonde) { p.Scanner = nil }), "Scanner"); e.Stato != esitoInfo || !strings.Contains(e.Testo, "Non controllato") {
		t.Errorf("sonda assente: %+v", e)
	}
	// audio
	if e := esito(t, conSonde(func(p *Sonde) { p.Audio = func() (int, error) { return 0, nil } }), "Suoni"); e.Stato != esitoInfo || !strings.Contains(e.Testo, "non ha un'uscita audio") {
		t.Errorf("senza audio: %+v", e)
	}
	// canale: non risponde, non controllato, controllo automatico spento
	if e := esito(t, conSonde(func(p *Sonde) { p.Canale = func(context.Context) error { return errors.New("internet non c'è") } }), "Aggiornamenti: canale"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "internet non c'è") {
		t.Errorf("canale che non risponde: %+v", e)
	}
	if e := esito(t, conSonde(func(p *Sonde) { p.Canale = func(context.Context) error { return errNonDisponibile } }), "Aggiornamenti: canale"); e.Stato != esitoInfo {
		t.Errorf("canale non controllato: %+v", e)
	}
	spento := false
	if err := srv.agg.Imposta(&spento, nil); err != nil {
		t.Fatal(err)
	}
	if e := esito(t, conSonde(func(*Sonde) {}), "Aggiornamenti: canale"); e.Stato != esitoInfo || !strings.Contains(e.Testo, "spento") {
		t.Errorf("controllo automatico spento: %+v", e)
	}
	// browser: nessuno (fuori da Windows non è un guasto)
	if e := esito(t, conSonde(func(p *Sonde) { p.Browser = func() string { return "" } }), "Finestra del programma"); e.Stato != esitoInfo && e.Stato != esitoAvviso {
		t.Errorf("senza browser: %+v", e)
	}
	// orologio indietro, e un salvataggio che sta nel futuro
	if e := esito(t, conSonde(func(p *Sonde) { p.Adesso = func() time.Time { return time.Date(2019, 5, 1, 9, 0, 0, 0, time.Local) } }), "Orologio"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "indietro") {
		t.Errorf("orologio del 2019: %+v", e)
	}
	if e := esito(t, conSonde(func(p *Sonde) { p.Adesso = func() time.Time { return time.Now().AddDate(0, 0, -3) } }), "Orologio"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "ultimo salvataggio") {
		t.Errorf("salvataggio nel futuro: %+v", e)
	}
	// copie: un errore delle copie giornaliere, e un archivio mai copiato
	srv.store.dailyErr = "non riesco a scrivere la copia in /tmp/x"
	if e := esito(t, conSonde(func(*Sonde) {}), "Archivio e copie"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "non è riuscita") {
		t.Errorf("errore delle copie: %+v", e)
	}
	srv.store.dailyErr = ""
	// cartella dei dati sparita: non si può scrivere
	srv2, _ := newTestServer(t)
	srv2.sonde = sondeFinte()
	if err := os.RemoveAll(srv2.store.Dir()); err != nil {
		t.Fatal(err)
	}
	if e := esito(t, srv2.controllaComputer(context.Background()), "Cartella dei dati"); e.Stato != esitoErrore || !strings.Contains(e.Testo, "Non riesco a scrivere") {
		t.Errorf("cartella dei dati sparita: %+v", e)
	}
}

func TestControlloSecondaCopia(t *testing.T) {
	srv, _ := newTestServer(t)
	srv.sonde = sondeFinte()
	if _, _, err := srv.store.Save(0, json.RawMessage(archivioFinto), nil, true); err != nil {
		t.Fatal(err)
	}
	srv.mirror = OpenMirror(srv.store.Dir(), srv.store)
	cartella := t.TempDir() + "/chiavetta"
	if err := srv.mirror.Set(cartella); err != nil {
		t.Fatal(err)
	}
	// impostata ma ancora senza copie... poi fatta: a posto
	if err := srv.mirror.CopyNow(); err != nil {
		t.Fatal(err)
	}
	if e := esito(t, srv.controllaComputer(context.Background()), "Seconda copia"); e.Stato != esitoOk || !strings.Contains(e.Testo, "aggiornata il") {
		t.Errorf("seconda copia fatta: %+v", e)
	}
	// la chiavetta viene tolta
	if err := os.RemoveAll(cartella); err != nil {
		t.Fatal(err)
	}
	if e := esito(t, srv.controllaComputer(context.Background()), "Seconda copia"); e.Stato != esitoErrore || !strings.Contains(e.Testo, "non risponde") {
		t.Errorf("chiavetta tolta: %+v", e)
	}
}

// Una prova lenta non tiene fermo il controllo: scade, e il resto arriva.
func TestControlloUnaSondaLentaScade(t *testing.T) {
	srv, _ := newTestServer(t)
	vecchioSonda, vecchioTutto := tempoSonda, tempoControllo
	tempoSonda, tempoControllo = 150*time.Millisecond, 2*time.Second
	defer func() { tempoSonda, tempoControllo = vecchioSonda, vecchioTutto }()
	p := sondeFinte()
	p.Scanner = func(ctx context.Context) (int, error) {
		<-ctx.Done()
		return 0, errors.New("la ricerca non ha risposto in tempo")
	}
	srv.sonde = p
	t0 := time.Now()
	esiti := srv.controllaComputer(context.Background())
	if time.Since(t0) > 1500*time.Millisecond {
		t.Errorf("il controllo ha aspettato %v", time.Since(t0))
	}
	if e := esito(t, esiti, "Scanner"); e.Stato != esitoAvviso || !strings.Contains(e.Testo, "non ha risposto in tempo") {
		t.Errorf("scanner lento: %+v", e)
	}
	if len(esiti) < 9 {
		t.Errorf("le altre prove ci sono: %d", len(esiti))
	}
	// un guasto imprevisto in una sonda non ferma il programma
	p.Scanner = func(context.Context) (int, error) { panic("sonda rotta") }
	srv.sonde = p
	d, _ := diarioProva(t)
	if e := esito(t, srv.controllaComputer(context.Background()), "Scanner"); e.Stato != esitoOk && e.Stato != esitoInfo && e.Stato != esitoAvviso {
		t.Errorf("sonda che va in panico: %+v", e)
	}
	if v := d.Voci(1); len(v) != 1 || !strings.Contains(v[0].Testo, "sonda rotta") {
		t.Errorf("il panico va nel diario: %+v", v)
	}
}

func TestControlloLaRotta(t *testing.T) {
	d, _ := diarioProva(t)
	srv, h := newTestServer(t)
	srv.sonde = sondeFinte()
	srv.sonde.Scanner = func(context.Context) (int, error) { return 0, errors.New("Windows ha detto di no") }
	if _, _, err := srv.store.Save(0, json.RawMessage(archivioFinto), nil, true); err != nil {
		t.Fatal(err)
	}
	r := do(h, call{method: "POST", target: "/api/controllo", token: testToken})
	if r.StatusCode != 200 {
		t.Fatalf("POST /api/controllo: %d %s", r.StatusCode, text(r))
	}
	var out struct {
		Esiti  []Esito `json:"esiti"`
		Ok     int     `json:"ok"`
		Avvisi int     `json:"avvisi"`
		Errori int     `json:"errori"`
	}
	if err := json.Unmarshal([]byte(text(r)), &out); err != nil {
		t.Fatal(err)
	}
	ok, av, er := riassuntoEsiti(out.Esiti)
	if len(out.Esiti) < 9 || out.Ok != ok || out.Avvisi != av || out.Errori != er || av < 2 { // la seconda copia non impostata e lo scanner
		t.Errorf("riassunto: %+v (contati %d/%d/%d)", out, ok, av, er)
	}
	// le cose da guardare sono nel diario, ripulite; nessun dato dell'archivio inventato è finito nelle risposte
	var testoVoci string
	for _, v := range d.Voci(30) {
		testoVoci += v.Livello + " " + v.Dove + " " + v.Testo + "\n"
	}
	if !strings.Contains(testoVoci, "controllo del computer: ") || !strings.Contains(testoVoci, "scanner: Windows non riesce a cercare gli scanner: Windows ha detto di no") {
		t.Errorf("diario:\n%s", testoVoci)
	}
	tutto, _ := json.Marshal(out)
	for _, no := range datiPersonali {
		if strings.Contains(string(tutto)+testoVoci, no) {
			t.Errorf("il controllo riporta un dato personale: %q", no)
		}
	}
	// solo dal computer, e con il gettone
	if r := do(h, call{method: "POST", target: "/api/controllo", token: testToken, remote: true}); r.StatusCode == 200 {
		t.Errorf("da un altro dispositivo: %d", r.StatusCode)
	}
	if r := do(h, call{method: "POST", target: "/api/controllo"}); r.StatusCode != 401 {
		t.Errorf("senza gettone: %d", r.StatusCode)
	}
}

func TestAssistenzaHaIlControlloDelComputer(t *testing.T) {
	diarioProva(t)
	srv, _ := newTestServer(t)
	srv.sonde = sondeFinte()
	testo := srv.rapportoAssistenza()
	for _, voglio := range []string{"== CONTROLLO DEL COMPUTER ==", "Riepilogo: ", "[OK] Orologio: ", "[AVVISO] Seconda copia: ", "      che fare: ", "[OK] Scanner: Windows vede 2 scanner"} {
		if !strings.Contains(testo, voglio) {
			t.Errorf("nel file per l'assistenza manca %q", voglio)
		}
	}
}

// Il canale degli aggiornamenti non va su internet nelle prove (noAuto), e un canale che risponde 404 (ancora vuoto) non è un guasto.
func TestRaggiungibile(t *testing.T) {
	srv, _ := newTestServer(t)
	srv.agg.noAuto = true
	if err := srv.agg.Raggiungibile(context.Background()); !errors.Is(err, errNonDisponibile) {
		t.Errorf("con noAuto: %v", err)
	}
}
