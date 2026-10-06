# Conti, design doc per Claude Code

2026-10-06 · Vittorio · [documento originale](https://claude.ai/artifact/1Er1u4Qmf6d7Dg1hmNabLb)

Allineato il 2026-10-06 alle decisioni prese dopo il documento originale: domini `shopping.skybreaker.dev` e `cash.skybreaker.dev`, identificatori in inglese (`shopping` per la Spesa, `cash` per Conti), un solo repository con pnpm workspaces, cookie HttpOnly già nella v1, due build statiche servite da Caddy, deploy con GitHub Actions e nessuna cartella `deploy/`, login con nome utente.

## Obiettivo e perimetro

Conti è la cassa comune di Vittorio e della sua ragazza: una PWA mobile first, sorella della Spesa, che usa lo stesso backend e gli stessi account. Ogni mese ognuno versa una quota fissa; la cassa si divide in buste di spesa e di risparmio, e a fine mese l'avanzo delle buste di spesa finisce in una busta di risparmio.

Obiettivi della v1:

- Quote mensili per persona, impostabili, segnate a mano come versate.
- Buste di spesa (budget che riparte ogni mese) e di risparmio (saldo che cresce, obiettivo facoltativo), fino a 6 attive.
- Spese prese da una busta e versamenti extra messi in una busta.
- Avanzo di fine mese spostato in automatico nella busta scelta, sforamenti compresi.
- Riepilogo del mese con i rimasti in primo piano, torta delle spese per busta, grafico dei risparmi.
- Divisione del mese modificabile, con salvataggio campo per campo; creazione ed eliminazione delle buste.
- Notifiche push all'altra persona e aggiornamenti in tempo reale.
- Login condiviso con la Spesa sui sottodomini di skybreaker.dev.

Non obiettivi della v1: conti correnti o import da banca, più valute, più di due persone, budget annuali, esportazioni.

Riferimento visivo: la demo si trova in `docs/demo-cash.html`, scaricata dalla [demo pubblicata](https://claude.ai/artifact/TFETGsQZ2VA3Xanvsi2Dzh). Per aspetto e comportamenti vale come fonte di verità; i dati della demo sono finti e vivono in localStorage, l'app vera li prende da PocketBase. Il pulsante Demo, il login rapido come una delle due persone e il campo Email della demo non vanno nell'app vera.

## Come lavorare

Procedi per milestone, nell'ordine della sezione Milestone, e fermati alla fine di ognuna per una revisione.

- Questo documento vale per Conti e per l'infrastruttura condivisa. Dove il design doc della Spesa dice altro (frontend servito da PocketBase, auth in localStorage), vince questo.
- Prima di scrivere codice PocketBase leggi la documentazione della versione fissata in `go.mod` (oggi v0.40.4). Hook, route e cron (`app.Cron()`) sono cambiati dalla v0.23: non fidarti di esempi più vecchi.
- Gli importi sono sempre interi in centesimi, nel database, nelle API e nei calcoli. Niente float; si formattano solo nell'interfaccia.
- Le date sono testo `YYYY-MM-DD` e i mesi `YYYY-MM`. Il giorno di riferimento è quello di Europe/Rome, anche sul server.
- Lo schema vive nelle migrazioni Go. Le operazioni che toccano più record (chiusura del mese, eliminazione di una busta) girano in una transazione.
- Stesso stack della Spesa: Astro statico, Alpine.js, CSS con custom properties, niente Tailwind né librerie di grafici. Package manager pnpm.
- Interfaccia in italiano come nella sezione Testi; codice, commenti e commit in inglese. Negli identificatori la Spesa è `shopping` e Conti è `cash`.
- Se un dettaglio non è coperto qui segui la demo; se non lo copre neanche la demo, chiedi.
- Alla fine di ogni milestone spunta le caselle in `docs/DESIGN-cash.md` e aggiungi due righe a `CHANGELOG.md`.

## Infrastruttura condivisa con la Spesa

Due frontend su due sottodomini, un solo PocketBase e un solo login: questa sezione vale per entrambe le app.

Il telefono parla solo con Caddy; il cookie sul dominio padre fa valere un login per tutte e due le app, e le notifiche partono da PocketBase verso il service worker dell'app giusta.

| Pezzo | Scelta |
| --- | --- |
| Domini | `shopping.skybreaker.dev` (Spesa) e `cash.skybreaker.dev` (Conti), ognuno con la sua build statica |
| Reverse proxy | Caddy: HTTPS automatico, serve i file statici e passa `/api/*` (realtime compreso) a PocketBase su `127.0.0.1:8090`. Ogni app chiama le API sul proprio dominio: niente CORS |
| Backend | Un binario Go con PocketBase e un database SQLite con le collezioni di tutte e due le app; non serve file statici |
| Dashboard admin | `/_/` e le API dei superuser non esposte sui sottodomini delle app; ci si arriva con un tunnel SSH |
| Login | Cookie HttpOnly sul dominio `.skybreaker.dev`, scritto e letto solo dal server (vedi sotto) |
| Notifiche | Un service worker per sottodominio, ognuno con il suo permesso e la sua subscription |
| Collegamenti | Nel profilo di ogni app le icone delle altre app, da una lista condivisa |
| Deploy | GitHub Actions: a ogni push su `main` va in produzione solo quello che è cambiato (binario, build della Spesa, build di Conti) |

### Login condiviso

- PocketBase autentica con un token nell'header `Authorization`. Il token vive solo in un cookie `pb_auth` HttpOnly, Secure, SameSite=Lax, path `/`, con scadenza a 90 giorni, sul dominio `COOKIE_DOMAIN`: il JavaScript delle app non lo vede mai.
- Un middleware Go, che gira prima di quello con cui PocketBase legge il token, copia il cookie nell'header `Authorization` quando la richiesta non ne ha già uno e arriva dalla stessa origine: `Sec-Fetch-Site: same-origin`, oppure, senza quell'header, `Origin` assente su GET e HEAD o uguale all'host. Per il browser tutti i sottodomini di skybreaker.dev sono lo stesso sito, quindi SameSite da solo non ferma una richiesta falsificata da un altro sottodominio.
- Login e rinnovo (`auth-with-password` e `auth-refresh` della collezione `users`): un hook scrive il cookie con il token nuovo e lo toglie dalla risposta JSON, che porta solo il record dell'utente.
- All'avvio ogni app chiama `auth-refresh`: la risposta dà l'utente e rinnova il cookie; un 401 porta al login. Senza rete l'app usa l'ultimo utente salvato in localStorage (solo id, nome, nome utente e colore) e apre in sola lettura.
- Esci toglie prima la subscription push di quel dispositivo, poi chiama `POST /api/auth/logout`, che cancella il cookie: esce da tutte e due le app.
- Al ritorno in primo piano (`visibilitychange`) l'app rifà `auth-refresh`: se l'altra app è uscita, torna al login.
- Passaggio dalla Spesa di oggi, che tiene il token in localStorage: alla prima apertura della nuova versione l'app manda una sola volta il vecchio token ad `auth-refresh`, che scrive il cookie, poi lo cancella dal localStorage. Chi era già dentro resta dentro.
- In sviluppo `COOKIE_DOMAIN` è vuoto: il cookie vale per `localhost` su tutte le porte, quindi il login condiviso funziona anche in locale.

### Notifiche per app

- `push_subscriptions` prende il campo `app` (select `shopping`, `cash`), obbligatorio. L'endpoint resta unico. Le subscription esistenti diventano `shopping`.
- `POST /api/push/subscribe` riceve anche `app`. Gli hook di Conti mandano le push solo alle subscription con `app = cash` dell'altra persona, quelli della Spesa solo a `app = shopping`.
- Le chiavi VAPID sono le stesse per tutte e due le app.

### Collegamenti tra le app

`packages/shared/apps.ts` elenca le app (id, nome, URL, icona, colori). Il profilo di ogni app mostra le icone delle app diverse da quella aperta: in Conti l'icona azzurra della Spesa, nella Spesa l'icona menta di Conti.

## Struttura del repository

Il repository della Spesa diventa un monorepo con pnpm workspaces: il backend Go, le due app Astro e un pacchetto condiviso.

```text
backend/
  main.go              avvio, cron, comando vapid
  auth_cookie.go       cookie HttpOnly: middleware, login, rinnovo, uscita
  push.go              invio Web Push per app, pulizia subscription
  push_routes.go       /api/push/*
  shopping_hooks.go    hook della Spesa
  cash_hooks.go        validazione dei movimenti, notifiche
  cash_routes.go       /api/cash/*
  cash_close.go        apertura e chiusura del mese
  migrations/          schema di tutte le collezioni
apps/
  shopping/            la Spesa, build in apps/shopping/dist
  cash/
    src/pages/         index.astro (schede), login.astro
    src/components/    componenti .astro con direttive Alpine
    src/lib/           alpine.ts, store.ts, summary.ts, charts.ts, parse.ts
    src/sw.ts          service worker
    public/icons/
packages/shared/       pb.ts (client e sessione), push.ts, money.ts, dates.ts, apps.ts, base.css, font
.github/workflows/     deploy.yml
docs/                  DESIGN-shopping.md, DESIGN-cash.md, demo-shopping.html, demo-cash.html
```

Conti è una sola pagina con tre schede gestite da Alpine; non servono altre rotte oltre al login. `money.ts` contiene parsing e formattazione degli importi (centesimi ↔ "1.234,50 €") con i test, ed è usato da tutte e due le app.

## Concetti

I nomi qui sotto sono quelli dell'interfaccia; usali anche nei commenti del codice, con l'equivalente inglese tra parentesi nei nomi delle collezioni.

| Concetto | Significato |
| --- | --- |
| Quota mensile (quota) | Quanto versa ognuno ogni mese. Si segna a mano come versata; il bonifico vero si fa dalla banca |
| Cassa del mese | Quote versate più versamenti extra del mese |
| Rimasti | Entrati meno spesi del mese. È il numero principale della scheda Mese |
| Busta (envelope) | Parte della cassa con un nome. Di spesa: budget mensile che riparte ogni mese. Di risparmio: saldo che si accumula, con obiettivo facoltativo |
| Allocazione (allocation) | Quanto di ogni mese va in una busta. Conta da inizio mese, anche se una quota non è ancora versata |
| Versamento extra (extra) | Soldi in più di una persona (premio, rimborso del 730) messi in una busta a scelta |
| Spesa (spend) | Uscita da una busta. Da una busta di risparmio è un prelievo |
| Trasferimento (transfer) | Soldi spostati tra buste: per l'avanzo di fine mese o per l'eliminazione di una busta |
| Avanzo | A fine mese, per ogni busta di spesa, quello che resta va nella busta dell'avanzo (di default il Fondo emergenza). Se la busta è andata oltre, la differenza esce dalla busta dell'avanzo |
| Fotografia del mese (month) | Quote, allocazioni e busta dell'avanzo di un mese. Ogni mese nuovo copia il precedente; cambiare la divisione tocca solo il mese in corso, i mesi passati restano com'erano |
| Busta archiviata | Una busta eliminata: sparisce dal mese dell'eliminazione in poi ma resta nei mesi passati e nello storico |

## Modello dati e regole API

Cinque collezioni nuove, più il campo `app` su `push_subscriptions`; `users` è quella della Spesa. Gli importi sono `number` interi in centesimi, con `onlyInt`. "Bloccata" significa regola null: solo il server, cioè route custom, hook e cron.

### envelopes

| Campo | Tipo | Note |
| --- | --- | --- |
| name | text, obbligatorio, max 24 |  |
| note | text, max 40 | Sottotitolo, per esempio "Affitto e bollette" |
| kind | select: `spend`, `save` | Non modificabile dopo la creazione |
| goal | number intero, min 0 | Solo `save`; 0 vuol dire nessun obiettivo |
| opening_balance | number intero, min 0 | Solo `save`: saldo già presente all'inizio, impostato dalla dashboard |
| slot | number intero, 1-6 | Colore della busta; unico tra le buste attive |
| position | number intero | Ordine di visualizzazione |
| archived_from | text, pattern `^\d{4}-\d{2}$` | Vuoto se attiva; altrimenti il primo mese in cui non c'è più |
| created_by | relation a users |  |

- List e view: autenticato. Update: autenticato, solo `name`, `note`, `goal`, `position`.
- Create e delete: bloccate. Si crea con `POST /api/cash/envelopes` e si archivia con `POST /api/cash/envelopes/{id}/archive`; non si cancella mai.

### months

| Campo | Tipo | Note |
| --- | --- | --- |
| month | text, pattern `^\d{4}-\d{2}$` | Indice unico |
| sweep_to | relation a envelopes | Busta dell'avanzo di quel mese |
| closed_at | date | Impostato dalla chiusura del mese |

- List e view: autenticato. Update: autenticato, solo `sweep_to` e solo sul mese in corso. Create e delete: bloccate.

### month_quotas

| Campo | Tipo | Note |
| --- | --- | --- |
| month | relation a months, cascade |  |
| user | relation a users | Indice unico con `month` |
| amount | number intero, min 0 |  |
| paid_on | text, pattern data | Vuoto finché non è segnata come versata |

- List e view: autenticato. Update: autenticato, solo sul mese in corso o sui mesi aperti. `paid_on` si cambia solo sulla propria riga (`user = @request.auth.id`). Create e delete: bloccate.

### month_allocations

| Campo | Tipo | Note |
| --- | --- | --- |
| month | relation a months, cascade |  |
| envelope | relation a envelopes | Indice unico con `month` |
| amount | number intero, min 0 |  |

- List e view: autenticato. Update: autenticato, solo sul mese in corso. Create e delete: bloccate.

### movements

| Campo | Tipo | Note |
| --- | --- | --- |
| kind | select: `spend`, `extra`, `transfer` |  |
| amount | number intero, min 1 | Sempre positivo; il verso lo dà il tipo |
| date | text, pattern data | Non nel futuro e non prima del primo mese |
| month | text | Ricavato da `date` nell'hook; indice |
| envelope | relation a envelopes | Obbligatorio per `spend` ed `extra` |
| from_envelope, to_envelope | relation a envelopes | Solo `transfer` |
| reason | select: `sweep`, `archive` | Solo `transfer` |
| description | text, max 40 | Se vuota: nome della busta per `spend`, "Versamento extra" per `extra` |
| user | relation a users | `spend`: chi l'ha registrata; `extra`: di chi sono i soldi |
| shopping_list | relation a lists | Facoltativo: la lista della Spesa da cui nasce |
| created_by | relation a users |  |

- List e view: autenticato.
- Create: autenticato, `@request.body.created_by = @request.auth.id` e `@request.body.kind != "transfer"`.
- Update e delete: autenticato e `kind != "transfer"`.
- Un hook valida i campi per tipo, rifiuta buste archiviate per il mese della data e ricava `month`.

### push_subscriptions

Aggiungi `app`, select `shopping` e `cash`, obbligatorio. Le subscription esistenti della Spesa vanno migrate con `app = shopping`.

## Calcoli, riepilogo e chiusura del mese

Tutti i numeri si calcolano sul server con query aggregate, in un'unica route di riepilogo; il client non somma movimenti.

### Formule, per il mese m

- Entrati = somma di `amount` delle quote con `paid_on` + somma degli `extra` del mese.
- Spesi = somma degli `spend` del mese, prelievi dai risparmi compresi. I trasferimenti non sono né entrate né uscite.
- Rimasti = entrati − spesi. In arrivo = somma delle quote del mese senza `paid_on`.
- Per una busta B: allocato (`month_allocations`), extra, spese, spostati = trasferimenti in entrata − in uscita.
- Busta di spesa, disponibile = allocato + extra + spostati − spese, solo del mese m.
- Busta di risparmio, saldo a fine m = `opening_balance` + la stessa somma su tutti i mesi fino a m compreso.
- Avanzo previsto del mese in corso = somma dei disponibili delle buste di spesa attive.

### Route

| Metodo e percorso | Cosa fa |
| --- | --- |
| GET /api/cash/summary?month= | Riepilogo del mese: quote, entrati, spesi, rimasti, in arrivo, buste con i loro numeri, avanzo previsto o effettivo, torta per busta del mese e dall'inizio, serie dei risparmi dall'inizio al mese in corso |
| POST /api/cash/envelopes | Crea una busta `{ name, kind, amount, goal }` e la sua allocazione nel mese in corso, nello slot libero più basso. Rifiuta oltre 6 buste attive |
| POST /api/cash/envelopes/{id}/archive | Archivia con `{ to }`: sposta allocazione e movimenti del mese in corso nella busta `to`, per le buste di risparmio crea un `transfer` con `reason = archive` del saldo restante, sposta la busta dell'avanzo se era questa, imposta `archived_from` al mese in corso. Tutto in una transazione |
| POST /api/cash/envelopes/{id}/unarchive | Annulla un'archiviazione fatta oggi: serve per l'"Annulla" del toast |

Tutte richiedono un utente autenticato e rispondono con il riepilogo aggiornato del mese in corso, così il client non deve fare una seconda chiamata.

### Apertura e chiusura del mese

Un cron gira ogni giorno alle 00:10 ora di Roma, e la stessa funzione parte anche all'avvio del server. È idempotente:

1. Se manca la fotografia del mese in corso, la crea copiando quella del mese precedente: quote (con `paid_on` vuoto), allocazioni delle buste attive e `sweep_to`.
2. Per ogni mese passato con `closed_at` vuoto, nell'ordine, calcola il disponibile di ogni busta di spesa attiva in quel mese.
3. Per ogni busta con disponibile diverso da zero crea un `transfer` con `reason = sweep`, datato l'ultimo giorno del mese: dalla busta a `sweep_to` se positivo, al contrario se negativo.
4. Imposta `closed_at`. Il tutto in una transazione per mese.

Dopo la chiusura, modificare una spesa di un mese chiuso non ricalcola l'avanzo: l'interfaccia lo dice nel dettaglio della riga "Avanzo di…". La riga "Avanzo di settembre" dei movimenti è la somma dei trasferimenti `sweep` di quel mese; aprendola mostra il dettaglio per busta.

### Test

Test Go su un database in memoria con lo scenario della demo: due quote (1.000 € e 900 €), cinque buste (Casa 1.050 €, Spesa 400 €, Fondo emergenza 200 €, Vacanze 100 €, Svago 150 €), un mese chiuso con avanzi positivi e uno sforamento. Verifica rimasti, saldi, avanzo e archiviazione con spostamento del saldo.

## Realtime e notifiche

Ad app aperta il realtime tiene allineati i due telefoni; ad app chiusa arriva una push all'altra persona per tre eventi.

### Realtime

- Sottoscrizione a `movements`, `month_quotas`, `month_allocations`, `months` ed `envelopes`. A ogni evento, con un debounce di 300 ms, l'app richiede il riepilogo del mese che sta guardando.
- Le modifiche fatte da te si vedono subito: la route o la chiamata risponde con il riepilogo nuovo, l'eco del realtime non deve creare doppioni.
- Se mentre sei nella Divisione l'altra persona cambia un valore, il campo si aggiorna solo se non lo stai modificando tu.
- Al ritorno in primo piano (`visibilitychange`) l'app ricarica il riepilogo e rifà `auth-refresh`.

### Notifiche push

Stesso meccanismo della Spesa (hook Go, `webpush-go`, TTL 12 ore, urgenza `high`), mandate solo alle subscription `app = cash` dell'altra persona.

| Evento | Titolo | Testo | Tag |
| --- | --- | --- | --- |
| Quota segnata come versata | {nome} ha versato la sua quota | {importo} per {mese}. Nella cassa ora ci sono {entrati}. | `quota-{mese}` |
| Versamento extra | {nome} ha aggiunto {importo} a {busta} | Ora ci sono {saldo} su {obiettivo}. Senza obiettivo: Ora ci sono {saldo}. | `extra-{id}` |
| Spesa | {nome} ha speso {importo} da {busta} | {descrizione}. Restano {disponibile}. Se la busta è oltre: La busta è oltre di {importo}. | `busta-{id}` |

- Con il tag per busta, più spese di fila dalla stessa busta si sostituiscono in una notifica sola, con l'ultimo disponibile.
- Il tocco sulla notifica apre la scheda Mese sul mese corrente.
- Le modifiche alla Divisione, le eliminazioni e la chiusura del mese non notificano.
- Nel service worker vale la regola della Spesa: nessuna notifica se Conti è aperta in primo piano.

## Interfaccia

Tre schede con una barra in basso (Mese, Buste, Divisione), il pulsante Aggiungi fisso sopra la barra in Mese e Buste, e i pannelli dal basso della demo. Nella barra in alto: logo, profilo; il pulsante Demo non c'è.

### Scheda Mese

- Navigazione tra i mesi, dal primo mese con una fotografia fino a quello in corso; sotto il nome, "mese in corso" o l'anno.
- Riquadro menta: "Rimasti nella cassa a {mese}" (nei mesi passati "Rimasti a {mese}") con il numero grande, anche negativo col segno meno. Sotto: "+{importo} in arrivo con la quota di {nome}" ("con la tua quota", "con le vostre quote"), oppure "Tutte e due le quote sono arrivate", oppure, nei mesi passati, "Rimasti a fine mese" o "Spesi più di quanto è entrato".
- Barra: quota dello speso su quanto è entrato. Due caselle: Entrati (con "di {previsti} previsti" o "di cui {extra} extra") e Spesi (con "{n}% di quanto è entrato").
- Una riga per persona, tu per primo: avatar, nome, quota mensile e stato. Stato: "Versato il 1 ott", "Segna come versato" (solo sulla tua riga) oppure "Da versare".
- Spese per busta: interruttore "{Mese}" o "Da {primo mese} a oggi", torta e legenda (vedi Grafici).
- Movimenti del mese raggruppati per giorno (Oggi, Ieri, poi il giorno esteso), dal più recente: quote, extra, spese, trasferimenti e la riga "Avanzo di {mese}" o "Sforamento di {mese}" nei mesi chiusi.

### Scheda Buste

- Stessa navigazione tra i mesi. Sottotitolo con l'avanzo: "A fine mese l'avanzo va nel {busta}: se il mese finisse oggi sarebbero {importo}"; nei mesi chiusi quanto ci è finito davvero.
- Busta di spesa: pallino colorato, nome, nota, "{importo} restano" (nei mesi chiusi "avanzati, nel fondo"), barra dello speso nel colore della busta, "Spesi {x} di {y}". Oltre il budget: importo e barra in rosso, "oltre la busta".
- Busta di risparmio: saldo, "di {obiettivo}", barra verso l'obiettivo, "+{allocato} al mese" più extra e avanzo, percentuale dell'obiettivo.
- Grafico dei risparmi sotto le buste.

### Scheda Divisione

- Titolo, spiegazione e la barra "Ogni mese" con legenda (vedi Grafici).
- Modulo, sempre del mese in corso: quote mensili delle due persone, importo mensile di ogni busta, obiettivo delle buste di risparmio, busta dell'avanzo (chip), nuova busta (tipo e nome, poi "Aggiungi"), cestino accanto a ogni busta.
- Ogni campo si salva da solo su `change` (uscita dal campo o Invio), con un toast tipo "Spesa: 300 € al mese" e la barra aggiornata. Niente pulsante Salva. Un valore non valido non si salva e la riga di riepilogo lo dice.
- Riga di riepilogo fissa in basso: "Si salva da solo. Versate X, assegnati Y." e poi "Tutto assegnato", "Da assegnare Z" o, in rosso, "Mancano Z". Si può salvare anche con soldi mancanti.

### Pannelli dal basso

| Pannello | Contenuto |
| --- | --- |
| Aggiungi | Interruttore Spesa o Versamento extra; importo grande con tastiera decimale; scorciatoia dalla Spesa; descrizione; per l'extra "Di chi sono"; busta (chip, solo attive); anteprima dell'effetto ("Nella busta Spesa restano…", "Fondo emergenza arriva a…"); data, non nel futuro |
| Busta | Numeri del mese, movimenti del mese, azioni: Aggiungi una spesa, oppure Aggiungi soldi e Preleva per una spesa; Elimina la busta nel mese in corso |
| Movimento | Importo, dettagli, "Elimina il movimento" con doppio tocco e poi Annulla nel toast. Per una quota: "Segna come non versato". Per un trasferimento o un avanzo: solo lettura |
| Elimina busta | Cosa si sposta (quota mensile, movimenti del mese, saldo), chip della busta di destinazione già proposta, pulsante rosso, poi toast con Annulla |
| Profilo | Avatar, nome utente, interruttore notifiche, icone delle altre app, Esci |

La scorciatoia dalla Spesa compare nel pannello Aggiungi quando esiste una lista della Spesa completata negli ultimi due giorni senza un movimento collegato: precompila descrizione (titolo della lista), busta Spesa e `shopping_list`. Il parser degli importi accetta 12,50, 12.50, 1.234,50 e 1234 e rifiuta il resto.

## Grafici

Tre grafici in SVG o HTML scritti a mano, senza librerie; ogni busta ha un colore fisso dato dal suo `slot`, uguale in tutti i grafici.

| Slot | Chiaro | Scuro | Busta nella demo |
| --- | --- | --- | --- |
| 1 | #14967A | #22A884 | Casa |
| 2 | #EB6834 | #D95926 | Spesa |
| 3 | #4A3AA7 | #9085E9 | Fondo emergenza |
| 4 | #E87BA4 | #D55181 | Vacanze |
| 5 | #2A78D6 | #3987E5 | Svago e uscite |
| 6 | #E34948 | #E66767 | Libera |

L'ordine è validato per il daltonismo sulle coppie vicine, in chiaro e in scuro: non riordinare i colori e non generarne altri. Per questo le buste attive sono al massimo 6.

- **Torta delle spese per busta**: ciambella da 208 px (raggio 96, foro 60) con il totale al centro, fette in ordine decrescente da mezzogiorno, 2 px di stacco nel colore della carta. Toccare una fetta o una riga della legenda la mette in evidenza (le altre al 28%) e al centro mostra nome, importo e percentuale; un secondo tocco toglie la selezione. Legenda sempre visibile con importo e percentuale.
- **Barra "Ogni mese"**: barra orizzontale alta 22 px con un segmento per busta proporzionale all'allocazione e 2 px di stacco; i soldi non assegnati sono un segmento tratteggiato "Da assegnare". Se le allocazioni superano le quote compare l'avviso in rosso. Legenda con importo e percentuale.
- **Risparmi**: una linea da 2 px per busta di risparmio attiva, dal primo mese al mese in corso, griglia leggera e valori a passi tondi. Punto sul mese selezionato. Al passaggio del dito o del mouse, linea verticale e tooltip con i valori di tutte le buste; legenda con il saldo di ognuna. Sotto, "Vedi i numeri" apre la tabella mese per mese.

I testi dei grafici usano sempre i colori del testo, mai quelli delle buste; il colore sta solo nei pallini e nei segni.

## Design system

Stessa famiglia della Spesa (font, misure, raggi, colori delle persone), ma in verde menta, così le due icone si distinguono sul telefono. I token vanno in `apps/cash/src/styles/tokens.css`; misure, font e componenti comuni stanno in `packages/shared/base.css`.

| Token | Chiaro | Scuro | Uso |
| --- | --- | --- | --- |
| --bg | #ECF6F2 | #061815 | Sfondo pagina |
| --paper | #FFFFFF | #0E2723 | Carte, pannelli, barra delle schede |
| --ink | #0E3530 | #E1F4EE | Testo |
| --ink-2 | #4C6E67 | #8CB2A8 | Testo secondario |
| --line | #D2E6DF | #1B3C35 | Divisori e bordi |
| --grid | #E3EEEA | #16332D | Griglia dei grafici, binari delle barre |
| --panel | #36C49D | #23A27F | Riquadro della cassa, icona dell'app |
| --panel-ink | #04281F | #03201A | Testo sul riquadro |
| --accent-text | #0B7A62 | #6FDDBE | Testo verde, focus |
| --accent-soft | #D9F1E9 | #113730 | Fondi tenui, scheda attiva |
| --btn | #0C7F66 | #34C7A0 | Pulsanti primari |
| --btn-ink | #FFFFFF | #03231B | Testo sui pulsanti |
| --in-soft | #E9E6FB | #231F45 | Fondo delle entrate |
| --in-text | #4F42B5 | #B9B1F5 | Importi in entrata |
| --danger | #C23B34 | #FF8A80 | Sforamenti, eliminazione |
| --spesa | #3AA6E8 | #2F95D4 | Icona della Spesa nel profilo |

- Persone come nella Spesa: avatar azzurro `#1677C9` per chi ha `color = sky`, giallo `#F7B500` per `sun`, con le varianti scure della Spesa.
- Font: Bricolage Grotesque 600 e 800 per titoli, numeri grandi e importi delle buste; Atkinson Hyperlegible 400 e 700 per il resto. Cifre tabellari negli importi in colonna.
- Numero dei rimasti `clamp(60px, 19vw, 92px)`, centesimi al 36%. Barra delle schede alta circa 66 px più la safe area; il pulsante Aggiungi le sta sopra.
- Accessibilità come nella Spesa: target da 44 px, focus visibile, `prefers-reduced-motion`, contrasto almeno 4,5:1 per il testo.

## Testi dell'interfaccia

Stesso tono della Spesa: frasi brevi, niente punti esclamativi, "avete" quando si parla della coppia. Gli importi si scrivono come "1.234,50 €", senza centesimi quando sono tondi nelle quote e nelle allocazioni ("1.050 €"). I segnaposto tra graffe sono valori dinamici.

| Dove | Testo |
| --- | --- |
| Login, sottotitolo | La cassa comune di casa, divisa in buste. Se sei già entrato nella Spesa, qui sei già dentro. |
| Login, campi ed errore | Nome utente / Password / Nome utente o password non corretti. |
| Schede | Mese / Buste / Divisione |
| Riquadro, titolo | Rimasti nella cassa a {mese} / Rimasti a {mese} |
| Riquadro, sotto il numero | +{importo} in arrivo con la quota di {nome} / Tutte e due le quote sono arrivate / Rimasti a fine mese / Spesi più di quanto è entrato |
| Riquadro, caselle | Entrati / Spesi |
| Stato quota | Versato il {giorno} / Segna come versato / Da versare |
| Torta | Spese per busta / {totale} spesi a {mese}. Tocca una fetta o una riga per i dettagli. |
| Buste, sottotitolo | A fine mese l'avanzo va nel {busta}: se il mese finisse oggi sarebbero {importo}. |
| Busta di spesa | {importo} restano / avanzati, nel fondo / oltre la busta / Spesi {x} di {y} |
| Busta di risparmio | di {obiettivo} / +{importo} al mese / {n}% dell'obiettivo |
| Divisione, spiegazione | Quanto versa ognuno ogni mese e come lo dividete tra le buste. Le modifiche valgono da {mese} in poi. |
| Divisione, riepilogo | Si salva da solo. Versate {x}, assegnati {y}. Tutto assegnato. / Da assegnare {z}. / Mancano {z}. |
| Divisione, avanzo | Dove va l'avanzo a fine mese |
| Aggiungi | Nuova spesa / Versamento extra / Da quale busta / In quale busta / Di chi sono / Aggiungi spesa / Aggiungi versamento |
| Errori | Scrivi un importo, per esempio 12,50. / Scegli da quale busta. / Non ho salvato: usa solo numeri, per esempio 300 o 12,50. |
| Elimina busta | Elimina {busta} / Sparisce da {mese} in poi; nei mesi passati resta com'era. / Cosa si sposta / In quale busta |
| Toast | Spesa aggiunta / Versamento aggiunto / Quota segnata / {busta}: {importo} al mese / {busta} eliminata / Annulla |
| Vuoti | Ancora nessun movimento a {mese}. / Nessuna spesa in questo periodo. |

## Configurazione, sviluppo locale e deploy

In sviluppo girano un PocketBase e due server Astro su localhost; in produzione il server `portfolio` con Caddy, un servizio systemd utente e il deploy da GitHub Actions.

| Variabile | Dove | Note |
| --- | --- | --- |
| VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT | backend | Le stesse della Spesa |
| APP_TZ | backend | `Europe/Rome`, per "oggi" e per il cron |
| COOKIE_DOMAIN | backend | `.skybreaker.dev` in produzione, vuoto in sviluppo; il cookie lo scrive il server |
| DEV | backend | Abilita le route di prova delle push |

### Sviluppo

1. `go run . serve` in `backend/` avvia PocketBase su `:8090`.
2. `pnpm --filter shopping dev` su `:4321` e `pnpm --filter cash dev` su `:4322`, ognuno con un proxy Vite da `/api` a `:8090`.
3. In locale il cookie senza dominio vale per `localhost` su tutte le porte, quindi il login condiviso funziona anche in sviluppo.
4. Telefono via USB con `chrome://inspect` e port forwarding delle due porte, come per la Spesa.

### Produzione

Il repository contiene solo il workflow; la configurazione del server vive sul server e `docs/DESIGN-shopping.md` dice cosa c'è e dove.

```text
shopping.skybreaker.dev {
  handle /_/* {
    respond 404
  }
  handle /api/collections/_superusers/* {
    respond 404
  }
  handle /api/* {
    reverse_proxy 127.0.0.1:8090
  }
  handle {
    root * /var/www/household/shopping
    encode zstd gzip
    header /sw.js Cache-Control no-cache
    try_files {path} {path}/index.html /index.html
    file_server
  }
}

cash.skybreaker.dev {
  # uguale, con root * /var/www/household/cash
}
```

1. Il workflow Deploy guarda cosa è cambiato su `main`: `backend/` porta a test e binario; `apps/shopping/` o `packages/shared/` alla build della Spesa; `apps/cash/` o `packages/shared/` alla build di Conti.
2. Ogni pezzo va sul server con la chiave di deploy, che può lanciare solo lo script di deploy. Il binario come oggi: SHA-256, copia del database, riavvio, binario precedente rimesso se `/api/health` non risponde. Una build come archivio tar con il suo SHA-256: scompattata in una cartella nuova, messa al posto della vecchia cambiando un link simbolico, senza riavvii.
3. Sul server `/var/www/household/` contiene `backend/` (binario, `.env`, `pb_data`), `shopping/` e `cash/` (link simbolici alle build); il servizio systemd utente `household.service` ascolta su `127.0.0.1:8090`.
4. Backup giornaliero cifrato del database su Google Drive, come oggi per la Spesa.
5. La dashboard si apre con `ssh -L 8090:127.0.0.1:8090 portfolio` e poi `http://localhost:8090/_/`.

## Milestone e criteri di accettazione

Sei milestone in sequenza; la prima tocca anche la Spesa e porta già in produzione la nuova infrastruttura, le altre solo Conti.

### 1. Infrastruttura condivisa

- [ ] Monorepo con pnpm workspaces: la Spesa in `apps/shopping`, `packages/shared` (client PocketBase e sessione, `money.ts` con test, `dates.ts`, `apps.ts`), `apps/cash` con login e profilo
- [ ] Cookie HttpOnly: middleware con il controllo dell'origine, login, rinnovo, uscita e passaggio dalle sessioni in localStorage, con test Go
- [ ] La Spesa passa al login con cookie e al campo `app` delle push e mostra l'icona di Conti nel profilo, senza cambiare altro
- [ ] Deploy: due build servite da Caddy, binario solo backend, workflow che pubblica solo quello che è cambiato, dashboard chiusa
- [ ] Login fatto nella Spesa vale in Conti, Esci da una app esce anche dall'altra, in locale e su shopping e cash.skybreaker.dev

### 2. Backend di Conti

- [ ] Migrazioni delle cinque collezioni con regole e indici
- [ ] Hook dei movimenti: validazione per tipo, `month` ricavato, buste archiviate rifiutate
- [ ] Route di riepilogo, creazione e archiviazione delle buste
- [ ] Cron di apertura e chiusura del mese, idempotente e in transazione
- [ ] Test Go dello scenario della demo: rimasti, saldi, avanzo con uno sforamento, archiviazione con spostamento del saldo

### 3. Scheda Mese

- [ ] Riquadro dei rimasti, quote e "Segna come versato"
- [ ] Torta per busta con i due periodi e la selezione
- [ ] Movimenti per giorno, pannelli Aggiungi e Movimento, scorciatoia dalla Spesa
- [ ] Confronto con `docs/demo-cash.html` su un telefono, in chiaro e in scuro

### 4. Schede Buste e Divisione

- [ ] Buste di spesa e di risparmio, grafico dei risparmi con tooltip e tabella
- [ ] Divisione con salvataggio per campo, riga di riepilogo, busta dell'avanzo
- [ ] Nuova busta ed eliminazione con destinazione e Annulla

### 5. PWA, realtime e notifiche

- [ ] Manifest, icone menta, service worker con precache; si installa accanto alla Spesa come app separata
- [ ] Realtime tra due telefoni entro 1 secondo, anche sulla Divisione
- [ ] Le tre notifiche arrivano solo all'app Conti dell'altra persona; più spese dalla stessa busta diventano una notifica sola

### 6. Prova finale

- [ ] Backup giornaliero verificato con le collezioni di Conti
- [ ] Prova completa su `cash.skybreaker.dev` da entrambi i telefoni, compreso il passaggio di mese con l'avanzo

## Fuori perimetro e decisioni aperte

Quattro punti da chiudere prima della milestone 3; il resto aspetta.

- [ ] Modifica di un movimento: la demo permette solo di eliminarlo e rifarlo. Se serve nella v1, stesso pannello di Aggiungi precompilato.
- [ ] Saldo totale della cassa (tutti i risparmi più i rimasti del mese): oggi non si vede da nessuna parte.
- [ ] Saldi iniziali delle buste di risparmio: per ora si impostano a mano nella dashboard (`opening_balance`).
- [ ] Design doc della Spesa da allineare a questo per sottodominio, login con cookie e push per app.

Dopo la v1: riordinare le buste trascinandole, più di 6 buste, esportazione in CSV, promemoria per la quota non ancora versata a metà mese.
