# Spesa, design doc per Claude Code

2026-10-02 · Vittorio · [documento originale](https://claude.ai/artifact/Bos713kpsnZ97WjQc5k4UJ)

## Obiettivo e perimetro

Spesa è una PWA mobile first per una lista della spesa condivisa tra due persone (Vittorio e la sua ragazza), su due telefoni Android. Ogni lista è legata a un giorno, contiene elementi da spuntare e avvisa l'altra persona con una notifica quando qualcuno aggiunge qualcosa.

Obiettivi della v1:

- Login con nome utente e password, sessione che dura mesi.
- Liste per data con titolo facoltativo, divise in In programma e Passate (solo quelle degli ultimi 30 giorni; le più vecchie restano nel database).
- Una lista nuova può prendere le cose non prese dell'ultima lista fino a oggi: nella lista vecchia risultano prese.
- Elementi con quantità facoltativa, spunta, modifica, eliminazione con annulla.
- Aggiornamenti in tempo reale tra i due telefoni ad app aperta.
- Notifiche push di sistema ad app chiusa, solo per le aggiunte fatte dall'altra persona.
- Installabile da Chrome su Android, interfaccia azzurra, solo tema scuro.

Non obiettivi della v1: registrazione pubblica, più nuclei familiari, iOS, modifiche offline con coda di sincronizzazione, categorie o reparti.

Riferimento visivo: la demo HTML si trova in `docs/demo-shopping.html`, scaricata dalla [demo pubblicata](https://claude.ai/artifact/BWm5yGRPudtpV1iUU8spvf). Per aspetto e comportamenti dell'interfaccia vale come fonte di verità.

## Come lavorare

Procedi per milestone, nell'ordine della sezione Milestone e criteri di accettazione, e fermati alla fine di ognuna per una revisione.

- Prima di scrivere codice PocketBase, leggi la documentazione della versione stabile corrente e fissala in `go.mod`. Hook e route sono cambiati dalla v0.23: non fidarti di esempi più vecchi.
- Lo schema delle collezioni vive nelle migrazioni Go, non solo nella dashboard.
- Niente Tailwind né librerie di componenti: CSS semplice con le custom properties della sezione Design system.
- Testi dell'interfaccia in italiano, come nella sezione Testi dell'interfaccia. Codice, nomi di file, commenti e commit in inglese.
- Se un dettaglio non è coperto qui, segui la demo. Se non lo copre neanche la demo, chiedi invece di inventare.
- Alla fine di ogni milestone spunta le sue caselle in `docs/DESIGN-shopping.md` e aggiungi due righe a `CHANGELOG.md`.

## Stack e architettura

Un solo binario Go serve API e frontend statico sullo stesso dominio: niente CORS e un solo deploy.

| Livello | Scelta | Note |
|---|---|---|
| Backend | PocketBase usato come framework Go | Auth, SQLite, realtime, dashboard admin |
| Push | `github.com/SherClockHolmes/webpush-go` | Cifratura del payload e firma VAPID, che gli hook JS non sanno fare |
| Frontend | Astro in output statico | Build in `apps/shopping/dist`, servita da Caddy |
| Interattività | Alpine.js con l'integrazione @astrojs/alpinejs | Caricato su ogni pagina; stato in Alpine.store, logica in Alpine.data |
| Client API | SDK JS `pocketbase` | Sessione nel cookie HttpOnly del server (vedi `docs/DESIGN-cash.md`), realtime via SSE |
| PWA | `@vite-pwa/astro` con strategia `injectManifest` | Service worker scritto a mano per push e click |
| Font | Pacchetti Fontsource, self-hosted | Funzionano offline, niente Google Fonts a runtime |
| Hosting | Server personale `portfolio`, Caddy che serve la build e passa `/api/*` a PocketBase, servizio systemd utente | HTTPS obbligatorio per service worker e push |

Flusso di un'aggiunta: il telefono A crea un record in `items`. PocketBase lo salva, lo manda in realtime ai client connessi e lancia l'hook Go. L'hook invia una Web Push alle subscription del telefono B, Chrome la consegna al service worker di B, che mostra la notifica oppure la salta se l'app è in primo piano.

_Il diagramma dell'architettura e del flusso di un'aggiunta è nel documento originale._

Ad app aperta l'aggiornamento arriva subito via SSE; la push passa dal push service e serve solo ad app chiusa.

### Alpine in pratica

- Integrazione `@astrojs/alpinejs` con `entrypoint` su `src/lib/alpine.ts`, dove si registrano plugin, store e componenti prima dell'avvio.
- Stato condiviso in `Alpine.store`: `session` (utente, permesso notifiche, connessione), `lists` e `items`. Realtime e chiamate API aggiornano solo gli store; le pagine leggono da lì.
- La logica dei componenti sta in `Alpine.data('homePage')`, `Alpine.data('listPage')` e `Alpine.data('composer')`, in file TypeScript. Nelle pagine `.astro` restano solo direttive brevi.
- Liste con `<template x-for>` e `:key` sull'id del record, così gli eventi realtime non ricreano tutte le righe.
- Plugin ufficiali: `@alpinejs/focus` per tenere il focus nei pannelli dal basso (`x-trap`), `@alpinejs/collapse` per il gruppo Passate.
- Parser, date e raggruppamenti restano funzioni pure in `lib/`, testate con Vitest senza Alpine.

## Struttura del repository

Monorepo pnpm condiviso con Conti: backend Go, le due app Astro e un pacchetto comune. La struttura completa è in `docs/DESIGN-cash.md`; qui la parte della Spesa.

```text
backend/
  main.go              avvio PocketBase, route, comando vapid
  auth_cookie.go       cookie HttpOnly della sessione
  push.go              invio Web Push, pulizia subscription
  push_routes.go       /api/push/*
  shopping_hooks.go    push per gli elementi aggiunti
  migrations/          schema delle collezioni
  pb_data/             database e file (non versionato)
apps/shopping/
  astro.config.mjs     build in dist
  src/
    pages/             index.astro, login.astro, lista.astro
    components/        componenti .astro con direttive Alpine
    lib/               alpine.ts, pb.ts, auth.ts, dates.ts, parse.ts, push.ts, realtime.ts
    styles/            tokens.css, base.css
    sw.ts              service worker
  public/icons/        icone app e badge notifiche
packages/shared/       sessione, date, app, componenti e stili comuni con Conti
.github/workflows/     deploy.yml: test, build e deploy di quello che cambia a ogni push su main
docs/                  DESIGN-shopping.md (questo documento), demo-shopping.html
```

Il dettaglio di una lista è `/lista?id=<id>`, non `/lista/<id>`: in output statico Astro non può generare pagine per id che non conosce. Caddy serve `lista/index.html` per `/lista` con `try_files`, tenendo la query.

## Modello dati e regole API

Quattro collezioni. La data delle liste è testo `YYYY-MM-DD`, così un giorno resta quel giorno senza slittamenti di fuso orario. Nelle regole, "bloccata" significa regola null: solo i superuser.

### users (auth, già presente)

| Campo | Tipo | Note |
|---|---|---|
| username | text, obbligatorio, 3-20 caratteri, solo minuscole e cifre, indice unico | Unico campo per entrare insieme alla password |
| email | email, facoltativa | Non usata: gli account non ne hanno |
| name | text, obbligatorio, max 20 | Nome mostrato nell'app |
| color | select: `sky`, `sun` | Colore dell'avatar, uno per persona |
| avatar | file, facoltativo | Non usato nella v1: l'avatar è l'iniziale |

- List e view: `@request.auth.id != ""` (serve per mostrare il nome dell'altra persona).
- Update: `id = @request.auth.id`. Create e delete: bloccate.
- Durata del token auth: 90 giorni.
- Login con password: l'unico identity field è `username`.

### lists

| Campo | Tipo | Note |
|---|---|---|
| date | text, obbligatorio, pattern `^\d{4}-\d{2}-\d{2}$` | Giorno della spesa, data locale; indice |
| title | text, obbligatorio, max 40 | Spesa se lasciato vuoto |
| created_by | relation a users, obbligatorio |  |
| created, updated | autodate |  |

- List, view, update, delete: `@request.auth.id != ""`.
- Create: `@request.auth.id != "" && @request.body.created_by = @request.auth.id`.

### items

| Campo | Tipo | Note |
|---|---|---|
| list | relation a lists, obbligatorio, cascade delete | Indice |
| name | text, obbligatorio, max 60 |  |
| qty | text, max 20 | 2, 500 g oppure vuoto |
| checked | bool |  |
| checked_at | date | Ordina la sezione Nel carrello |
| added_by | relation a users, obbligatorio |  |
| checked_by | relation a users | Vuoto quando non è spuntato |
| added_at | date | Quando è stato aggiunto o rimesso tra le cose da prendere; ordina Da prendere |
| created, updated | autodate |  |

- List, view, delete: `@request.auth.id != ""`.
- Create: `@request.auth.id != "" && @request.body.added_by = @request.auth.id`.
- Update: autenticato, `added_by` modificabile solo verso `@request.auth.id` (un doppione già nel carrello torna tra le cose da prendere a nome di chi l'ha riscritto), `checked_by` vuoto oppure uguale a `@request.auth.id`. Con la sintassi della v0.23 e successive: `@request.auth.id != "" && (@request.body.added_by:isset = false || @request.body.added_by = @request.auth.id) && (@request.body.checked_by:isset = false || @request.body.checked_by = "" || @request.body.checked_by = @request.auth.id)`. Verificala sulla versione in uso.

### push_subscriptions

| Campo | Tipo | Note |
|---|---|---|
| user | relation a users, obbligatorio, cascade delete |  |
| endpoint | text, obbligatorio | Indice unico |
| p256dh | text, obbligatorio |  |
| auth | text, obbligatorio |  |
| user_agent | text | Per riconoscere il dispositivo nei log |
| created, updated | autodate |  |

Tutte le regole bloccate: la collezione la toccano solo le route custom e l'hook.

## Autenticazione e sessione

Due account creati una volta sul server, con nome utente e password generati; l'app ha solo il login.

- Nessuna pagina di registrazione né di reset password nella v1: le password si cambiano dalla dashboard, raggiungibile solo con il tunnel SSH (collezione users, campo password).
- Login con `authWithPassword` e il nome utente in minuscolo, perché la tastiera del telefono può mettere la maiuscola; in caso di errore, messaggio sotto il pulsante: Nome utente o password non corretti.
- La sessione sta nel cookie HttpOnly condiviso con Conti (`docs/DESIGN-cash.md`, Login condiviso): all'avvio e al ritorno in primo piano `authRefresh()`, che rinnova il cookie; un rifiuto porta a `/login`, senza rete vale l'ultimo utente salvato. Chi aveva il token in localStorage lo scambia una volta con il cookie.
- Guardie lato client: `/` e `/lista` senza utente salvato portano a `/login`; `/login` controlla il cookie e, se la sessione c'è già (anche per un accesso fatto in Conti), porta a `/`.
- Esci: prima cancella la subscription push del dispositivo con `POST /api/push/unsubscribe`, poi `POST /api/auth/logout` cancella il cookie (esce anche da Conti) e vai a `/login`. Senza rete non si può uscire: toast Non salvato, riprova.
- Nel profilo ognuno può cambiare solo il proprio nome.

## Realtime

Il realtime allinea i due telefoni ad app aperta; le notifiche push servono solo ad app chiusa.

- Home: sottoscrizione a `lists` e `items` con `subscribe('*')`. A ogni evento ricalcola righe e conteggi, con un debounce di 300 ms.
- Dettaglio: sottoscrizione a `items` filtrata con `list = "<id>"` e al record della lista. Se l'altra persona elimina la lista, torna alla home con il toast Lista eliminata da {nome}.
- Applica gli eventi in modo idempotente, con upsert per id: l'eco delle proprie modifiche non deve creare doppioni.
- Modifiche ottimistiche: la UI cambia subito, poi parte la chiamata. Se fallisce, torna allo stato precedente con il toast Non salvato, riprova.
- Quando l'app torna in primo piano (`visibilitychange`) e quando il realtime si riconnette, ricarica i dati della vista corrente: gli eventi persi durante l'interruzione non arrivano più.
- Gli elementi aggiunti dall'altra persona compaiono con l'evidenziazione gialla della demo, per 1,5 secondi.

## Notifiche push

Web Push con chiavi VAPID, inviate dal backend Go solo all'altra persona e solo quando aggiunge un elemento. Spunte, modifiche, eliminazioni e nuove liste non notificano.

### Route custom

Tutte richiedono un utente autenticato.

| Metodo e percorso | Cosa fa |
|---|---|
| GET /api/push/key | Restituisce la chiave pubblica VAPID |
| POST /api/push/subscribe | Riceve la subscription del browser con `app = shopping`, fa upsert per `endpoint` e la assegna all'utente autenticato |
| POST /api/push/unsubscribe | Riceve `{ endpoint }` ed elimina la subscription se appartiene all'utente |
| POST /api/push/test | Solo con `DEV=1`: manda una push di prova ai dispositivi dell'utente stesso, con `type` test, che il service worker mostra anche con l'app aperta |

### Invio dal backend

- Hook dopo la creazione riuscita di un record `items`. Le cose aggiunte dalla stessa persona alla stessa lista entro 3 secondi dalla prima partono in una push sola, con tutti i nomi: una lista nuova che prende le cose non prese, o una serie di aggiunte di fila, fa suonare il telefono una volta. L'invio parte dopo l'attesa, quindi la risposta al client non aspetta le push.
- Destinatari: tutte le subscription con `user` diverso da `added_by`.
- Opzioni di `webpush-go`: TTL 12 ore, urgenza `high` (i telefoni in risparmio energetico non la ritardano), `Topic` uguale all'id della lista, subscriber da `VAPID_SUBJECT`. Con il `Topic`, il push service sostituisce i messaggi della stessa lista non ancora consegnati.
- Risposta 404 o 410: elimina la subscription. Altri errori: solo log, nessun retry.

Payload, sotto i 4 KB:

```json
{
  "type": "item_added",
  "listId": "abc123def456ghi",
  "listTitle": "Spesa settimanale",
  "listDate": "2026-10-03",
  "item": "Pane",
  "qty": "2",
  "items": ["Latte", "Pane"],
  "by": "Vittorio"
}
```

### Service worker

- Evento `push`: se una finestra dell'app è visibile (`clients.matchAll({ type: 'window', includeUncontrolled: true })` con `visibilityState === 'visible'`), non mostrare nulla, ci pensa il realtime. Chrome lo accetta solo se la pagina è davvero in primo piano.
- Altrimenti cerca con `registration.getNotifications({ tag: listId })` una notifica già aperta per la stessa lista, aggiungi in `data.items` gli elementi di `items` (o `item`, se la push non ha l'elenco) e sostituiscila.
- Un elemento: titolo {by} ha aggiunto {item}, testo {listTitle}, {data}. Più elementi: titolo {by} ha aggiunto {n} cose, testo con gli elementi separati da virgola e poi Lista: {listTitle}. La data è oggi, domani o il giorno esteso, calcolati sulla data del telefono.
- Opzioni: `tag` uguale a listId, `renotify: true`, `icon` `/icons/icon-192.png`, `badge` `/icons/badge-96.png` (bianco su trasparente, Android usa solo il canale alpha), `vibrate: [80, 40, 80]`, azione Apri lista.
- Evento `notificationclick`: chiude la notifica, mette a fuoco una finestra già aperta e la porta su `/lista?id=<listId>`, altrimenti ne apre una nuova.

### Attivazione dal client

- La card Attiva notifiche in home e lo switch nel profilo chiamano `Notification.requestPermission()` solo dopo un tap.
- Con il permesso: `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, poi `POST /api/push/subscribe`.
- A ogni avvio con permesso già concesso, rileggi la subscription e rimandala al server: copre i cambi di endpoint.
- Permesso negato: lo switch resta spento e sotto compare Riattivale da Impostazioni Android, app Spesa, Notifiche.
- In sviluppo, il profilo mostra un pulsante Prova notifica che usa `/api/push/test`.

## PWA e service worker

L'app si installa da Chrome come WebAPK, si apre anche offline in sola lettura e si aggiorna da sola.

- Manifest: name e short_name Spesa, `lang` it, `start_url` e `scope` `/`, `display` standalone, `orientation` portrait, `background_color` #071622, `theme_color` #3AA6E8.
- Icone: 192 e 512 px, più una 512 px maskable con il cestino su fondo azzurro e margine di sicurezza del 20%. Badge per le notifiche: 96 px monocromatico.
- Precache dell'app shell (HTML, CSS, JS, font, icone) con Workbox tramite `injectManifest`. Le chiamate a `/api/*` non passano mai dalla cache.
- Offline: l'app mostra l'ultimo stato letto, salvato in localStorage per ogni vista, con il banner Sei offline, le modifiche sono in pausa. Campo di inserimento e azioni restano disattivati finché torna la rete.
- Nuova versione: il service worker si installa e prende il controllo da solo (`registerType: 'autoUpdate'`, `skipWaiting` e `clients.claim` in `sw.ts`). La pagina aperta non si ricarica, perché `onNeedReload` di `registerSW` non fa niente: la versione nuova arriva al caricamento successivo, riaprendo l'app o aprendo una lista.
- Installazione: intercetta `beforeinstallprompt` e mostra Installa l'app nel profilo finché l'app non risulta installata.
- Head: `viewport-fit=cover`, safe area gestite come nella demo, `theme-color` #3AA6E8 come nella demo.

## Interfaccia: schermate e comportamenti

Tre pagine e tre pannelli dal basso, con l'aspetto e i comportamenti della demo.

| Vista | Contenuto | Azioni |
|---|---|---|
| Login (`/login`) | Logo, titolo Spesa grande, sottotitolo, nome utente, password | Entra |
| Home (`/`) | Saluto, riepilogo, card notifiche se spente, In programma (data da oggi in poi, crescente), Passate degli ultimi 30 giorni, richiudibile (decrescente) | Apri lista, Nuova lista, profilo |
| Lista (`/lista?id=`) | Pannello azzurro con giorno gigante, giorno della settimana, mese, pillola Oggi, Domani o Ieri, titolo e avanzamento; poi Da prendere e Nel carrello | Aggiungi, spunta, modifica, elimina, menu |
| Pannello Nuova lista | Chip Oggi, Domani, Sabato (senza doppioni), selettore data, nome facoltativo; se l'ultima lista fino a oggi ha cose da prendere, la riga del riporto con un interruttore, attivo di default | Crea lista: in un'unica richiesta batch crea la lista e, con il riporto attivo, una copia di ogni cosa non presa (fino a 100), segnando prese quelle vecchie; poi apre la lista con il focus sul campo |
| Pannello Menu lista | Titolo e data della lista | Togli le cose già prese (n); Elimina la lista con secondo tocco di conferma |
| Pannello Modifica | Nome e quantità facoltativa dell'elemento, già compilati | Salva |
| Pannello Profilo | Avatar, nome modificabile, nome utente, switch notifiche, Installa l'app | Esci |

- Riga in home: numero del giorno grande, giorno abbreviato, titolo, data relativa o estesa, barra di avanzamento, stato (N da prendere, Fatto, Vuota) e avatar di chi ha aggiunto elementi.
- Elemento: cerchio di spunta, nome con pillola della quantità, sotto avatar e aggiunto da te o da {nome} (preso da, se spuntato), pulsanti modifica (matita) ed elimina. Il tocco sulla riga spunta; tenerla premuta mezzo secondo apre la modifica: dopo 100 ms la riga si riempie di `--accent-soft` da sinistra, è piena quando si apre il pannello e il telefono vibra 30 ms. Un dito che si sposta di più di 10 px la annulla perché sta scorrendo. Da prendere in ordine di `added_at`, quindi un elemento rimesso dal carrello va in fondo; Nel carrello per `checked_at` decrescente, in un contenitore solo bordato.
- Barra di inserimento fissa in basso: fino a 7 chip di suggerimento, il campo Aggiungi, es. 2 latte e il pulsante +. Dopo l'invio il campo si svuota e tiene il focus, così la tastiera resta aperta.
- Suggerimenti, in quest'ordine, esclusi quelli già da prendere: Latte, Pane, Uova, Acqua, Frutta, Caffè, Pasta, Insalata, Burro, Carta igienica, Pomodori, Yogurt.

### Regole di inserimento

| Scritto | Nome | Quantità |
|---|---|---|
| latte | Latte | nessuna |
| 2 latte | Latte | 2, mostrata come ×2 |
| 2x latte | Latte | 2 |
| latte x2 | Latte | 2 |
| 500 g farina | Farina | 500 g |
| 1,5 kg patate | Patate | 1,5 kg |

Unità riconosciute: g, kg, ml, l, pz. Spazi multipli compressi, prima lettera maiuscola. Il parser vive in `lib/parse.ts` con test su tutti i casi della tabella.

- Doppione già da prendere (confronto senza maiuscole): niente inserimento, l'elemento esistente lampeggia, toast È già in lista.
- Doppione già nel carrello: torna tra le cose da prendere a nome di chi l'ha riscritto, toast Rimesso tra le cose da prendere.
- Spunta: animazione di 260 ms sul cerchio, poi l'elemento cambia sezione.
- Modifica: il nome si ripulisce come in aggiunta e la quantità svuotata si toglie; un nome già tra le cose da prendere non si salva, toast È già in lista. Restano chi l'ha aggiunto, la posizione e la spunta. Modifica ottimistica, come la spunta.
- Eliminazioni (elemento, cose prese, lista): la UI toglie subito e la chiamata API parte quando scade il toast con Annulla, dopo 5 secondi. Annulla ripristina senza chiamate.
- Oggi è il giorno locale del telefono. Le etichette Oggi, Domani e Ieri valgono anche per le righe in home.

## Design system

Azzurro come colore principale, giallo solo per la seconda persona e per evidenziare le novità; il numero gigante del giorno è l'unico elemento audace. I token vanno in `styles/tokens.css` come custom properties su `:root`. L'app ha solo il tema scuro, qualunque sia l'impostazione del telefono.

| Token | Valore | Uso |
|---|---|---|
| --bg | #071622 | Sfondo pagina |
| --paper | #0E2233 | Superfici e pannelli dal basso |
| --ink | #E3F2FC | Testo |
| --ink-2 | #8FB0C6 | Testo secondario |
| --line | #1D3B52 | Divisori e bordi |
| --panel | #2F95D4 | Pannello della lista, icona app |
| --panel-ink | #04192A | Testo sul pannello |
| --accent | #3AA6E8 | Spunte e barre |
| --accent-text | #7FCBF7 | Testo azzurro e focus |
| --accent-soft | #12324A | Fondi tenui |
| --btn | #3AA6E8 | Pulsanti primari, avatar persona sky |
| --btn-ink | #04192A | Testo sui pulsanti |
| --sun | #F7C23A | Avatar persona sun |
| --sun-soft | #3A3010 | Evidenziazione delle novità |
| --sun-ink | #2B1F00 | Testo sull'avatar giallo |
| --danger | #FF8A80 | Eliminazione |

- Tipografia: Bricolage Grotesque 600 e 800 per titoli, numeri dei giorni e avatar; Atkinson Hyperlegible 400 e 700 per tutto il resto. Base 17 px, nomi degli elementi 18 px, numero del pannello `clamp(100px, 32vw, 136px)` con interlinea 0.76.
- Misure: colonna larga al massimo 480 px con margini di 18 px. Raggi: 28 pannelli, 22 gruppi, 18 campo e pulsante +, 15 pulsanti, pillole tonde. Target di tocco minimo 44 px; campo e pulsante + alti 56 px, Nuova lista 58 px.
- Accessibilità: focus visibile da 3 px in `--accent-text`, `aria-pressed` sugli elementi, campi con testo da almeno 16 px, `prefers-reduced-motion` che azzera le animazioni, testo con contrasto almeno 4,5:1.
- Movimento solo in risposta alle azioni: pannelli 320 ms, spunta 260 ms, riempimento della pressione lunga 400 ms, evidenziazione 1,5 s.

## Testi dell'interfaccia

Frasi brevi, iniziale maiuscola e il resto minuscolo, niente punti esclamativi; quando si parla della coppia si usa avete. I segnaposto tra graffe sono valori dinamici.

| Dove | Testo |
|---|---|
| Login, sottotitolo | La lista della spesa di casa, aggiornata su tutti i dispositivi |
| Login, errore | Nome utente o password non corretti. |
| Home, saluto | Ciao {nome} |
| Home, riepilogo | {n} cose da prendere in {m} liste (al singolare: 1 cosa, 1 lista) |
| Home, tutto preso | Avete preso tutto, per ora. |
| Home, nessuna lista | Nessuna spesa in programma. |
| Home, vuota | Crea una lista per la prossima spesa |
| Card notifiche, titolo | Scopri subito cosa manca |
| Card notifiche, testo | Ricevi una notifica quando {nome} aggiunge qualcosa, anche con l'app chiusa. |
| Card notifiche, pulsante | Attiva notifiche |
| Lista vuota | La lista è vuota. Scrivi qui sotto la prima cosa da prendere. |
| Lista completata | Avete preso tutto. |
| Avanzamento | {n} da prendere, {m} nel carrello / Tutto nel carrello / Ancora vuota |
| Campo di inserimento | Aggiungi, es. 2 latte |
| Nuova lista, nome | Es. Esselunga, cena di venerdì |
| Nuova lista, riporto | Porta le {n} cose non prese di {giorno} / Porta la cosa non presa di {giorno}; il giorno è oggi, ieri o il giorno della settimana con il numero |
| Pannello modifica | Modifica / Nome / Quantità facoltativa / Salva |
| Toast | È già in lista / Rimesso tra le cose da prendere / {elemento} eliminato / Lista eliminata / Notifiche attivate / Non salvato, riprova |
| Azione dei toast | Annulla |
| Offline | Sei offline, le modifiche sono in pausa |
| Notifiche negate | Riattivale da Impostazioni Android, app Spesa, Notifiche. |

## Configurazione, sviluppo locale e deploy

In sviluppo bastano un PC e un telefono via USB; in produzione il server `portfolio` con HTTPS su shopping.skybreaker.dev.

| Variabile | Esempio | Note |
|---|---|---|
| VAPID_PUBLIC_KEY | generata | Si crea una volta con `go run . vapid` |
| VAPID_PRIVATE_KEY | generata | Segreta, mai nel repository |
| VAPID_SUBJECT | indirizzo di contatto | Richiesto dai push service; anche un URL https. `mailto:` lo aggiunge `webpush-go` |
| DEV | 1 | Abilita `/api/push/test` e l'automigrate |
| COOKIE_DOMAIN | `.skybreaker.dev` | Dominio del cookie della sessione condivisa con Conti; vuoto in sviluppo |
| APP_TZ | `Europe/Rome` | Fuso di "oggi" e della chiusura dei mesi di Conti; obbligatoria, senza il server non parte |

Il comando `vapid` stampa una coppia di chiavi con `webpush.GenerateVAPIDKeys()`. In locale le variabili stanno in un `.env` ignorato da git.

### Sviluppo

1. `go run . serve` avvia PocketBase su `:8090`; la dashboard è su `/_/` e lì si creano i due utenti.
2. `pnpm --filter shopping dev` avvia Astro su `:4321`, con un proxy Vite da `/api` verso `:8090`: il client usa sempre lo stesso origin.
3. `@vite-pwa/astro` con `devOptions` attivi, per avere il service worker anche in sviluppo.
4. Telefono via USB: `chrome://inspect` sul PC con port forwarding della porta 4321. Sul telefono `localhost` è un contesto sicuro, quindi service worker e push funzionano senza HTTPS.

### Produzione

Il repository contiene solo il workflow; la configurazione del server vive sul server, nei percorsi qui sotto.

1. Build: `pnpm --filter shopping build` scrive la Spesa in `apps/shopping/dist`; il backend è un binario Go a parte (`go build` in `backend/`).
2. Deploy: a ogni push su `main` il workflow `Deploy` guarda cosa è cambiato dall'ultimo deploy riuscito e pubblica solo quello, le build dopo il binario, con una chiave che può lanciare solo `~/bin/deploy-household.sh`: un deploy alla volta (`flock`), caricamenti fino a 64 MB. Il binario: SHA-256, copia del database in `predeploy.db` leggibile solo dal proprio utente, riavvio, binario precedente rimesso se `/api/health` non risponde; `household --version` dice quale commit è in produzione. La build: archivio con SHA-256, scompattato in `releases/` e messo al posto del precedente cambiando un link simbolico, senza riavvii. Segreti del repository: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`.
3. Servizio: in `/var/www/household/` la cartella `backend/` (binario, `.env`, `pb_data`) e i link `shopping` e `cash` alle build; servizio systemd utente `~/.config/systemd/user/household.service` su `127.0.0.1:8090`, con scrittura permessa solo in `pb_data`, home non leggibile e niente socket Unix, quindi niente accesso a docker. Le migrazioni partono da sole all'avvio.
4. Caddy: blocchi `shopping.skybreaker.dev` e `cash.skybreaker.dev` in `/etc/caddy/Caddyfile`. Servono la build con `try_files` (un file che non c'è risponde 404, non con la pagina principale) e le pagine HTML con `Cache-Control: no-cache`. Passano `/household/*` a PocketBase togliendo `/household`, senza compressione (le connessioni SSE del realtime arrivano subito): il cookie della sessione vale solo per `/household/api/`. Rispondono 404 su `/_/` e sulle API dei superuser, per nome e per id, e servono `sw.js` con `Cache-Control: no-cache` e `manifest.webmanifest` con `Content-Type: application/manifest+json`, che Caddy da solo non conosce. PocketBase si fida di `X-Forwarded-For` e limita i tentativi di login (migrazione `proxy_and_rate_limits`).
5. Backup: `~/bin/household-backup.sh`, avviato ogni notte alle 3:45 da `household-backup.timer`, fa uno snapshot di `data.db`, controlla la sua integrità, lo cifra con age (la stessa chiave del backup di Directus, la cui identità privata sta solo sul Mac) e lo carica su Google Drive in `Backups/household`, entro 15 minuti. Se fallisce, `household-backup-alert.service` manda a vittorio.simoni@skybreaker.dev una mail con la fine del log, con il server SMTP di Directus letto dal suo `.env` al momento dell'invio. Le istruzioni di ripristino sono in testa allo script.
6. Dashboard: `ssh -L 8090:127.0.0.1:8090 portfolio`, poi `http://localhost:8090/_/`. PocketBase accetta i superuser solo da `127.0.0.1` e `::1` (migrazione `superuser_ips`): da fuori sono rifiutati qualunque percorso usino.

## Milestone e criteri di accettazione

Cinque milestone in sequenza; ognuna è finita quando tutte le sue caselle sono spuntate e la revisione è passata.

### 1. Backend

- [x] Progetto Go con PocketBase, versione fissata in `go.mod`
- [x] Migrazioni per i campi extra di `users`, per `lists`, `items` e `push_subscriptions`, con regole e indici
- [x] Comando `vapid` e lettura delle variabili d'ambiente
- [x] Test: un utente non autenticato non legge nulla; non si crea un item con `added_by` di un altro utente; eliminare una lista elimina i suoi item

### 2. Frontend base

- [x] Astro statico con build in `pb_public`, token, font self-hosted, integrazione Alpine con gli store
- [x] Login, guardie delle pagine, logout
- [x] Home con i due gruppi, pannello Nuova lista, dettaglio con aggiunta, spunta, eliminazione e annulla
- [x] Parser della quantità con test unitari su tutti i casi della tabella
- [x] Realtime: due browser con utenti diversi si vedono a vicenda entro 1 secondo
- [ ] Confronto visivo con `docs/demo-shopping.html` su un telefono, in tema scuro

### 3. PWA

- [x] Manifest, icone e service worker con precache
- [ ] Installabile da Chrome su Android; offline si apre in sola lettura
- [x] Toast di nuova versione funzionante

### 4. Notifiche push

- [x] Route `/api/push/*` e hook dopo la creazione di `items`
- [ ] Eventi `push` e `notificationclick` nel service worker, raggruppamento per lista, niente notifica con l'app in primo piano
- [x] Pulizia delle subscription su 404 e 410
- [x] Test Go dell'invio con un sender finto: l'autore è escluso, la subscription si elimina su 410
- [ ] Prova reale: app chiusa sul telefono B, aggiunta dal telefono A, notifica entro 5 secondi; tre aggiunte di fila diventano una sola notifica

### 5. Deploy

- [ ] Online su shopping.skybreaker.dev, con deploy automatico da GitHub Actions e backup cifrato giornaliero
- [ ] App installata su entrambi i telefoni dal dominio di produzione, giro completo di prova

## Fuori perimetro e decisioni aperte

Le scelte per la v1 sono chiuse; il resto aspetta la v2.

- [x] Interattività: Alpine.js
- [x] Dominio e server: shopping.skybreaker.dev sul server `portfolio`
- [x] Account: Vittorio (`vittorio`, sky) e Martina (`martina`, sun)

Dopo la v1: modifiche offline con coda di sincronizzazione, notifica alla creazione di una lista, ordinamento per reparto, elementi ricorrenti. Per un eventuale telefono Jolla, dove le Web Push difficilmente funzionano, l'hook potrebbe mandare anche un POST a un topic privato di ntfy, la cui app Android funziona senza servizi Google.
