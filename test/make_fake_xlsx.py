#!/usr/bin/env python3
"""Builds test/fixtures/gestionale-finto.xlsx: a workbook shaped like the gym's Google sheet (title row, headers in row 2, computed
columns, real Excel dates, numbers for phones and CAP, empty rows, a few untidy values) but with INVENTED people only.
Run:  python3 test/make_fake_xlsx.py     (needs openpyxl; the result is committed, so the tests do not need Python)"""
import datetime as dt, random, sys, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

rnd = random.Random(20261118)
COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', "De Luca", 'Mancini', 'Costa', 'Fontana', 'Santoro']
NOMI = ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma', 'Giorgia', 'Greta', 'Beatrice', 'Anna', 'Vittoria', 'Matilde', 'Noemi', 'Francesca', 'Sara', 'Chiara', 'Martina', 'Nicole', 'Arianna', 'Rebecca']
S_HEAD = ['Cognome e Nome', 'Telefono', 'Secondo telefono', 'Genitore / Referente', 'CF genitore', 'Email', 'Data di nascita', 'Luogo di nascita', 'Codice fiscale', 'Indirizzo', 'Città', 'CAP',
          'Consenso privacy', 'Liberatoria foto/video', 'Data modulo iscrizione', 'Certificato medico', 'Rilascio certificato', 'Scadenza certificato', 'Note',
          'ID', 'Stato iscrizione', 'Totale dovuto', 'Totale pagato', 'Residuo', 'Stato certificato', 'N° tessera EPS/FGI']
E_HEAD = ['Allieva', 'Corso', 'Fascia oraria', 'Giorni', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Quota concordata (sostituisce il tariffario)', 'Annullata?', 'Note',
          'ID', 'Scadenza', 'Stato abbonamento', 'Totale dovuto', 'Totale pagato', 'Residuo', 'Stato pagamento', 'Chiave elenco']
P_HEAD = ['Data pagamento', "Iscrizione (scegli dall'elenco)", 'Importo', 'Metodo', 'Note', 'N. ricevuta', 'ID iscrizione', 'Allieva', 'Corso']
PACCHETTI = [('Propedeutico', 'Corso Propedeutico · 1 giorno/settimana', ['Sab'], 35, 105, 300), ('Base', 'Corso Base e Avanzato · 2 giorni/settimana', ['Lun', 'Mer'], 60, 170, 500),
             ('Avanzato', 'Corso Base e Avanzato · 3 giorni/settimana', ['Lun', 'Mer', 'Ven'], 70, 200, 580), ('Agonismo', 'Corso Agonistico · 3 giorni/settimana', ['Mar', 'Gio', 'Sab'], 85, 250, 1000),
             ('FitKid', 'FitKid (1 giorno) · 1 giorno/settimana', ['Ven'], 25, 70, None)]
MESI = {'Mensile': 1, 'Trimestrale': 3, 'Semestrale': 6, 'Annuale': 12}

def aggiungi_mesi(d, n):
    m = d.month - 1 + n; y = d.year + m // 12; m = m % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(y, m, day)

wb = Workbook()
ws = wb.active; ws.title = 'DASHBOARD'
ws['A1'] = 'GYM ART · DASHBOARD'; ws['A3'] = 'Allieve'; ws['B3'] = '=COUNTA(ANAGRAFICA!A3:A200)'

def foglio(nome, titolo, head):
    w = wb.create_sheet(nome)
    w['A1'] = titolo; w['A1'].font = Font(bold=True, size=14)
    w.merge_cells(start_row=1, start_column=1, end_row=1, end_column=min(6, len(head)))
    for i, h in enumerate(head, 1):
        c = w.cell(row=2, column=i, value=h); c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1B2F6A'); c.alignment = Alignment(wrap_text=True)
        w.column_dimensions[c.column_letter].width = 18
    w.freeze_panes = 'A3'
    return w

an = foglio('ANAGRAFICA', 'ANAGRAFICA · una riga per allieva (dati inventati)', S_HEAD)
isc = foglio('ISCRIZIONI', 'ISCRIZIONI · una riga per periodo (dati inventati)', E_HEAD)
pag = foglio('PAGAMENTI', 'PAGAMENTI · una riga per versamento (dati inventati)', P_HEAD)
reg = foglio('REGISTRO SCANSIONI', 'REGISTRO', ['Data e ora', 'Allieva', 'Documento', 'Operazione', 'Foglio', 'Riga', 'Campo', 'Valore precedente', 'Valore nuovo', 'Note'])
lis = foglio('LISTE', 'LISTE', ['Corsi', 'Fasce orarie', 'Metodi'])
tar = foglio('TARIFFARIO', 'TARIFFARIO', ['Tariffa / Pacchetto', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale'])
for i, (corso, pk, gg, m, t, a) in enumerate(PACCHETTI, 3):
    tar.cell(row=i, column=1, value=pk); tar.cell(row=i, column=2, value=m); tar.cell(row=i, column=3, value=t); tar.cell(row=i, column=5, value=a)
    lis.cell(row=i, column=1, value=corso)
for i, f in enumerate(['16:00-17:00', '17:00-18:30', '18:30-20:00'], 3): lis.cell(row=i, column=2, value=f)
for i, f in enumerate(['Contanti', 'Bonifico', 'POS'], 3): lis.cell(row=i, column=3, value=f)

oggi = dt.date(2026, 11, 18)
studenti = []
nomi_usati = set()
for i in range(44):
    cog, nom = rnd.choice(COGNOMI), rnd.choice(NOMI)
    if i in (7, 8): cog, nom = 'Bianchi', 'Emma'          # two girls with the same name
    if i in (20, 21): cog = studenti[19]['cog']          # sisters
    nascita = dt.date(rnd.randint(2008, 2019), rnd.randint(1, 12), rnd.randint(1, 28))
    nome_cell = f'{cog} {nom}' if i % 5 else (f'{cog.upper()} {nom}' if i % 2 else f'{cog.lower()} {nom.lower()}')   # untidy capitals
    studenti.append(dict(cog=cog, nom=nom, nascita=nascita, row=i + 3, cell=nome_cell))
    cert = rnd.choice(['Agonistico', 'Non Agonistico', 'Non Agonistico', 'Ludico-motoria', ''])
    ril = oggi - dt.timedelta(days=rnd.randint(10, 500)) if cert else None
    scad = aggiungi_mesi(ril, 12) if ril else None
    r = i + 3
    an.cell(row=r, column=1, value=nome_cell)
    an.cell(row=r, column=2, value=3330000000 + rnd.randint(100000, 999999) if i % 3 else f'333 {rnd.randint(1000000, 9999999)}')   # a number, or text with a space
    if i % 7 == 0: an.cell(row=r, column=3, value='+355 69 ' + str(rnd.randint(1000000, 9999999)))
    an.cell(row=r, column=4, value=f'{cog} {rnd.choice(["Paolo", "Luca", "Marco", "Anna", "Laura"])}')
    an.cell(row=r, column=6, value=f'famiglia.{cog.lower().replace(" ", "")}{i}@example.com')
    an.cell(row=r, column=7, value=nascita).number_format = 'dd/mm/yyyy'
    an.cell(row=r, column=8, value='Avezzano')
    an.cell(row=r, column=9, value=(cog[:3] + nom[:3]).upper() + f'{nascita.year % 100:02d}A{nascita.day:02d}A345X')      # invented, not a real tax code
    an.cell(row=r, column=10, value=f'Via {rnd.choice(["Roma", "Garibaldi", "XX Settembre", "Marsicana"])} {rnd.randint(1, 120)}')
    an.cell(row=r, column=11, value='Avezzano'); an.cell(row=r, column=12, value=67051)
    an.cell(row=r, column=13, value='Sì'); an.cell(row=r, column=14, value='Sì' if i % 4 else None)
    an.cell(row=r, column=15, value=oggi - dt.timedelta(days=rnd.randint(30, 700))).number_format = 'dd/mm/yyyy'
    if cert:
        an.cell(row=r, column=16, value=cert)
        an.cell(row=r, column=17, value=ril).number_format = 'dd/mm/yyyy'
        an.cell(row=r, column=18, value=scad).number_format = 'dd/mm/yyyy'
    if i % 9 == 0: an.cell(row=r, column=19, value='Allergia al nichel: porta il cerotto')
    an.cell(row=r, column=20, value=i + 1)
    if i % 6 == 0: an.cell(row=r, column=26, value=f'TS-{1000 + i}')
an.cell(row=3 + 44 + 1, column=1, value=None)   # an empty row at the end, as in a real sheet

# enrollments: most students have a current one, some an older one too; sisters share a course
n_isc = 0
isc_rows = []
for s in studenti:
    for k in range(2 if s['row'] % 3 == 0 else 1):
        corso, pk, gg, m, t, a = rnd.choice(PACCHETTI)
        tipo = rnd.choice(['Mensile', 'Trimestrale', 'Trimestrale', 'Annuale']) if k == 0 else 'Trimestrale'
        inizio = oggi - dt.timedelta(days=rnd.randint(5, 200)) if k == 0 else oggi - dt.timedelta(days=rnd.randint(260, 400))
        n_isc += 1; r = n_isc + 2
        quota = rnd.choice([None, None, None, 150]) if corso != 'FitKid' else None
        key = f'{n_isc} · {s["cell"]} · {corso}'
        isc_rows.append(dict(n=n_isc, s=s, corso=corso, pk=pk, tipo=tipo, inizio=inizio, quota=quota, row=r, key=key, m=m, t=t, a=a))
        isc.cell(row=r, column=1, value=s['cell']); isc.cell(row=r, column=2, value=corso)
        isc.cell(row=r, column=3, value='16:00-17:00' if n_isc % 2 else '17:00-18:30')
        isc.cell(row=r, column=4, value=', '.join(gg)); isc.cell(row=r, column=5, value=pk); isc.cell(row=r, column=6, value=tipo)
        isc.cell(row=r, column=7, value=inizio).number_format = 'dd/mm/yyyy'
        if quota: isc.cell(row=r, column=8, value=quota)
        isc.cell(row=r, column=9, value='No')
        isc.cell(row=r, column=11, value=n_isc)
        isc.cell(row=r, column=12, value=aggiungi_mesi(inizio, MESI[tipo])).number_format = 'dd/mm/yyyy'
        base = quota if quota else (m if tipo == 'Mensile' else t if tipo == 'Trimestrale' else (a or 0))
        extra = 10 if corso == 'FitKid' else 0
        isc.cell(row=r, column=14, value=base + extra)
        isc.cell(row=r, column=18, value=key)
        isc_rows[-1]['dovuto'] = base + extra

# payments: some paid in full, some in part, some not at all
n_pag = 0
for e in isc_rows:
    if e['n'] % 4 == 0: continue
    importo = e['dovuto'] if e['n'] % 3 else round(e['dovuto'] / 2)
    n_pag += 1; r = n_pag + 2
    pag.cell(row=r, column=1, value=e['inizio'] + dt.timedelta(days=rnd.randint(0, 8))).number_format = 'dd/mm/yyyy'
    pag.cell(row=r, column=2, value=e['key']); pag.cell(row=r, column=3, value=importo)
    pag.cell(row=r, column=4, value=rnd.choice(['Contanti', 'Contanti', 'Bonifico', 'POS']))
    if n_pag % 11 == 0: pag.cell(row=r, column=5, value='Saldo a settembre')
    pag.cell(row=r, column=6, value=f'RIC-{e["n"]:04d}-1'); pag.cell(row=r, column=7, value=e['n']); pag.cell(row=r, column=8, value=e['s']['cell']); pag.cell(row=r, column=9, value=e['corso'])

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'gestionale-finto.xlsx')
wb.save(out)
print('written', out, '| allieve', len(studenti), 'iscrizioni', n_isc, 'pagamenti', n_pag)
