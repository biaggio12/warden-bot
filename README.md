# Tibia Warden Tracker

Gracze zgłaszają pojawienie się Wardena, a system rozsyła alerty na Discordzie tylko do tych,
którym ten potwór jest jeszcze potrzebny. Potwora da się odhaczyć jednym kliknięciem `[Killed]`.

| Komponent | Stack | Katalog |
|---|---|---|
| API | PHP 8.4, **Symfony 8.1**, Doctrine ORM, Messenger, Scheduler | `backend/` |
| Bot Discorda | Node.js 24, TypeScript, discord.js 14, amqplib | `bot/` |
| Aplikacja webowa | React 19, Vite, Tailwind CSS 4 | `frontend/` |
| Infrastruktura | Docker Compose, PostgreSQL 17, RabbitMQ 4, nginx | `docker/`, `docker-compose*.yml` |

## Architektura

```
 React SPA ──HTTP/Bearer──▶ nginx ─▶ PHP-FPM (Symfony API) ──▶ PostgreSQL
                                          │      ▲
                     WardenSpawnedEvent   │      │  HTTP (BOT_API_TOKEN
                     WardenExpiredEvent   ▼      │  + X-Discord-User-Id)
 worker (Scheduler, co 60 s) ──▶ RabbitMQ: exchange "warden_events" ──▶ queue "discord_bot" ──▶ Bot ──▶ Discord
```

- **Zgłoszenie** (`POST /warden-spawns`) zapisuje rekord z `expires_at = created_at + ttl_minutes`
  i publikuje `WardenSpawnedEvent` przez Symfony Messenger (transport AMQP, serializer JSON).
- **Bot** odbiera zdarzenie i publikuje alert na kanale `#wardens-<świat>` (np. `#wardens-monza`)
  w każdej gildii, w której jest. Treść alertu to nazwa Wardena i wzmianki (`@`) graczy, którym go
  brakuje (połączony Discord, postać na tym świecie bez tego potwora, bez zgłaszającego). Po
  `DISCORD_PING_CLEANUP_SECONDS` (domyślnie 1 s) bot edytuje treść tak, że zostaje sama nazwa
  Wardena. Powiadomienia już dotarły, a kanał zostaje czysty. Opcjonalnie (`DISCORD_DM_ENABLED=true`, domyślnie wyłączone)
  wysyła też DM graczom z połączonym Discordem i postacią na tym świecie, która **nie ma** jeszcze
  tego potwora. Zgłaszający nie dostaje DM.
- **Worker** uruchamia Symfony Scheduler: co 60 s jedno `UPDATE … RETURNING` zamyka przeterminowane
  zgłoszenia (`ACTIVE → EXPIRED`) i publikuje `WardenExpiredEvent`. Bot **usuwa** wtedy alert
  (z `DISCORD_DELETE_EXPIRED=false` zostawia go z wyłączonym przyciskiem). Bot ma też własny timer
  na `expires_at`, więc alert znika nawet przy opóźnieniu workera.

Interfejs użytkownika (aplikacja webowa, wiadomości i komendy bota, komunikaty błędów API) jest po angielsku.

## Uruchomienie

Wymagany jest tylko Docker z Compose v2.

```bash
docker compose up -d     # cały stack, wszystkie wartości mają domyślne ustawienia deweloperskie
make fixtures            # lista potworów + konto demo
```

albo w jednym kroku: `make init` (kopiuje `.env.example` → `.env`, buduje, startuje, ładuje dane).

| Usługa | Adres |
|---|---|
| Aplikacja webowa | http://localhost:5173 |
| API | http://localhost:8080/api/v1 |
| RabbitMQ UI | http://localhost:15672 (guest / guest) |
| PostgreSQL | localhost:5432 (app / app, baza `warden`) |

Słownik potworów to pełny bestiariusz Tibii (833 stworzenia w 21 klasach, bez bossów) z pliku
`backend/data/bestiary.json` (źródło: TibiaWiki). `make fixtures` ładuje go do pustej bazy. Istniejącą
bazę aktualizuje `docker compose exec php bin/console app:bestiary:sync` (z `--dry-run` tylko pokazuje
zmiany). Komenda dopisuje brakujące potwory, poprawia klasy i nie rusza zaliczeń ani zgłoszeń.

Każdy potwór ma adres animowanego GIF-a z TibiaWiki (`image_url`). Pokazujemy go w bestiariuszu i jako miniaturę
w alercie na Discordzie. Obrazki są ładowane bezpośrednio z serwerów Fandom, które blokują część adresów IP
serwerowni. Z takiej sieci GIF-y się nie wyświetlą (zostaje puste miejsce), a z domowych sieci i przez Discorda działają.

Konto demo: **demo@warden.local / demo1234** (3 postacie: 2 na Monzie, 1 na Securze).

Porty i hasła zmienisz w `.env` (wzór: `.env.example`). Jeśli zmienisz `API_PORT`, ustaw też
`VITE_API_URL`.

Migracje uruchamiają się automatycznie przy starcie kontenera `php`. Każdy kontener ma healthcheck;
`docker compose ps` pokazuje ich stan.

### Hot reload

- **Symfony**: `backend/` jest podmontowany w `php` i `worker`. Zmiany w kodzie widać od razu
  (opcache sprawdza znaczniki czasu). Worker trzeba zrestartować: `docker compose restart worker`.
- **React**: serwer Vite z HMR. Jeśli zmiany nie są wykrywane (np. Docker Desktop na Windowsie),
  ustaw `CHOKIDAR_USEPOLLING=true` dla usługi `frontend`.
- **Bot**: `tsx watch` restartuje bota po każdej zmianie w `bot/src`.

### Logowanie przez Discord

Aplikacja webowa ma przyciski „Log in with Discord” (ekran logowania) i „Link with Discord”
(zakładka *Characters*, dla kont z hasłem). Używa tej samej aplikacji Discord co bot:

1. W Developer Portal, w zakładce *OAuth2*, dodaj w *Redirects*:
   `http://localhost:5173/auth/discord/callback` (ogólnie: `<FRONTEND_URL>/auth/discord/callback`).
2. Skopiuj stamtąd *Client Secret* do `.env` jako `DISCORD_CLIENT_SECRET`. Client ID to
   `DISCORD_APPLICATION_ID`.
3. Uruchom `docker compose up -d php`.

Bez sekretu przyciski są ukryte. Pierwsze logowanie zakłada konto i od razu łączy Discord
(e-mail z Discorda jest brany tylko, gdy jest zweryfikowany). Jeśli konto z tym adresem już istnieje,
logowanie jest odrzucane, bo konta nie są łączone po adresie e-mail. Trzeba wtedy zalogować się hasłem
i kliknąć „Link with Discord”.

### Bot Discorda

Bez `DISCORD_TOKEN` bot działa w trybie **dry-run**: konsumuje zdarzenia i loguje, co by wysłał
(`docker compose logs -f bot`). Żeby podłączyć prawdziwego bota:

1. Utwórz aplikację na https://discord.com/developers/applications, w zakładce *Bot* wygeneruj token.
2. Zaproś bota przez *OAuth2 → URL Generator* ze scope'ami `bot` i `applications.commands`
   oraz uprawnieniami *Send Messages*, *Embed Links* i *Read Message History*.
3. Na serwerze utwórz kanały tekstowe `#wardens-<świat>`, np. `#wardens-monza`.
4. W `.env` ustaw `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` i (dla natychmiastowej rejestracji
   komend) `DISCORD_GUILD_ID`, potem `docker compose up -d bot`.
5. Gracz łączy konto: w aplikacji *Characters → Discord → Generate a /link code*, a na Discordzie
   `/link code:XXXXXXXX`. Połączenie jest potrzebne do przycisku `[Killed]` i do DM.

Po upływie czasu alert jest usuwany z kanału. Przy starcie bot przegląda ostatnie 100 wiadomości
na kanałach `#wardens-*` i usuwa swoje przeterminowane alerty (np. sprzed restartu), a aktywnym
ustawia timery. Do tego potrzebuje uprawnienia *Read Message History*.

Prywatne wiadomości są domyślnie **wyłączone**, a alerty trafiają tylko na kanał. Włączysz je przez
`DISCORD_DM_ENABLED=true` w `.env` i `docker compose up -d bot`.

Zgłoszenie z Discorda: `/report monster city location [time] [info]` (wymaga połączonego konta).
Potwór i miasto mają podpowiedzi. Świat jest ustalany automatycznie: z nazwy kanału (`#wardens-monza`
oznacza Monzę), a poza takim kanałem ze świata, na którym gracz ma najwięcej postaci (przy remisie
pierwszy alfabetycznie, jak w formularzu web). Zgłoszenie działa jak to z aplikacji: alert z pingami
pojawia się na kanale.

Gdy bot jest na kilku serwerach Discord, zgłoszenie z `/report` trafia tylko na serwer, na którym użyto
komendy. Zgłoszenie z aplikacji trafia na serwery, na których jest zgłaszający. Jeśli zgłaszający nie ma
podpiętego Discorda, alert idzie na wszystkie serwery z kanałem `#wardens-<świat>`.

Alert pokazuje też, kto zgłosił Wardena (pole „Reported by”): wzmiankę Discord i postacie zgłaszającego na
tym świecie, bo zwykle to on daje znać w grze, kiedy atakować. Aplikacja pokazuje to samo przy aktywnym
zgłoszeniu. E-mail konta nigdy nie jest pokazywany.

Pod alertem na kanale są cztery przyciski: `[Killed]`, `[OMW]`, `[On site]` i `[Gone]`. `[OMW]` dopisuje gracza do listy
„On my way”, a `[On site]` do listy „On site” i zdejmuje go z „On my way”. Gracz jest najwyżej na jednej liście,
a ponowne kliknięcie tego samego przycisku go wypisuje. Listy są zapisane w samej wiadomości, więc przetrwają
restart bota. Wzmianki na nich pokazują nicki, ale nikogo nie pingują. Po skutecznym `[Killed]` gracz znika
z obu list.

Przycisk `[Killed]`:
- jedna postać gracza na tym świecie → od razu oznacza potwora i odpowiada efemerycznie
  „Zaliczono [potwór] dla postaci [postać]”;
- kilka postaci → efemeryczne menu „Dla której postaci chcesz zaliczyć potwora?”.

Przycisk `[Gone]` zamyka zgłoszenie przed czasem, gdy Warden już padł. Najpierw pyta efemerycznie o
potwierdzenie, a po nim backend (`POST /api/v1/warden-spawns/{id}/kill`) ustawia status `KILLED` i publikuje
`warden.killed`. Bot nie usuwa wtedy alertu: oznacza go jako martwy (💀, „Killed, reported by …”, przyciski
wyłączone, listy OMW / On site zostają) i odpowiada na niego wiadomością pingującą graczy z tych list.
Alert i ta odpowiedź znikają o pierwotnej porze wygaśnięcia. Zgłaszający jest pokazany jako wzmianka Discord
albo nick Discord; e-mail konta nigdy nie trafia na Discorda. To samo robi przycisk „Gone? Remove report” przy aktywnym zgłoszeniu
w aplikacji. Zamknąć zgłoszenie może każdy zalogowany gracz (na Discordzie: z podpiętym kontem), tak jak je zgłosić.

## API (`/api/v1`)

Wszystkie błędy mają format RFC 7807 (`application/problem+json`). Błędy walidacji zwracają `422`
z listą `violations[]` (`property_path`, `title`).

| Metoda | Ścieżka | Autoryzacja | Opis |
|---|---|---|---|
| GET | `/health` | – | healthcheck (sprawdza też bazę) |
| GET | `/worlds` | – | dozwolone światy (`TIBIA_WORLDS` lub lista wbudowana) |
| GET | `/monsters` | – | słownik potworów |
| POST | `/auth/register`, `/auth/login` | – | `{email, password}` → `{token, expires_at, user}` |
| GET | `/auth/discord` | – | `{enabled, authorize_url}` dla „Log in with Discord” |
| POST | `/auth/discord` | – / gracz | `{code}` z OAuth2: bez tokenu loguje lub zakłada konto, z tokenem łączy Discord z kontem |
| GET | `/me` | gracz | konto i status połączenia z Discordem |
| POST | `/me/discord-link-code` | gracz | jednorazowy kod dla `/link` (ważny 10 min) |
| GET / POST | `/characters` | gracz | lista / dodanie postaci `{name, server_name}` |
| DELETE | `/characters/{id}` | właściciel | usunięcie postaci |
| GET | `/characters/{id}/killed-monsters` | właściciel | `{monster_ids: []}` |
| POST | `/characters/{id}/killed-monsters` | właściciel | `{monster_id}`: **201** przy pierwszym zapisie, **200** gdy już był (idempotentne) |
| PUT | `/characters/{id}/killed-monsters` | właściciel | zbiorczo `{add: [], remove: []}`, jedno żądanie na całą kategorię |
| GET | `/warden-spawns?server_name=` | gracz | aktywne zgłoszenia |
| GET | `/stats?period=7d\|30d\|all` | gracz | statystyki zgłoszeń, ranking zgłaszających i dane zalogowanego gracza |
| POST | `/warden-spawns` | gracz | zgłoszenie, `ttl_minutes` 1–10 (domyślnie 8; Warden znika sam po 10 minutach) |
| GET | `/internal/warden-spawns/{id}/recipients` | bot | odbiorcy DM |
| POST | `/internal/discord-links` | bot | `{code, discord_user_id}` |

Autoryzacja to zawsze `Authorization: Bearer <token>`. Bot używa `BOT_API_TOKEN`. Z nagłówkiem
`X-Discord-User-Id` działa w imieniu połączonego gracza, więc obowiązują go te same reguły dostępu
(Voter `CharacterVoter` zwraca 403 dla cudzej postaci).

### Kontrakt zdarzeń (RabbitMQ)

Exchange `warden_events` (fanout), kolejka `discord_bot`, treść JSON:

```json
{ "event": "warden.spawned", "occurred_at": "2026-10-29T12:00:00Z",
  "data": { "spawn_id": "…", "monster": {"id": 142, "name": "Dragon Warden", "category": "Dragons"},
            "server_name": "Monza", "location_description": "…", "reported_by_discord_user_id": null,
            "reported_by_characters": ["Sir Tester"], "reported_by_name": "lukasz",
            "created_at": "…", "expires_at": "2026-10-29T12:07:00Z" } }

{ "event": "warden.expired", "occurred_at": "…",
  "data": { "spawn_id": "…", "monster_id": 142, "server_name": "Monza", "expires_at": "…" } }

{ "event": "warden.killed", "occurred_at": "…",
  "data": { "spawn_id": "…", "monster_id": 142, "server_name": "Monza",
            "killed_by_discord_user_id": "1234…", "killed_by_name": "lukasz" } }
```

Format definiuje `backend/src/Messenger/JsonEventSerializer.php`, a odczytuje go `bot/src/events.ts`.

## Model danych

`monsters`, `characters`, `character_killed_monsters` (klucz główny `(character_id, monster_id)`),
`warden_spawns` (status `ACTIVE | KILLED | EXPIRED` z ograniczeniem CHECK, indeks `(status, expires_at)`)
oraz `users` i `api_tokens` (przechowywany jest tylko hash SHA-256 tokenu). Migracja:
`backend/src/Migrations/`.

## Statystyki

Zakładka *Stats* pokazuje dla wybranego okresu (7 dni, 30 dni, cały czas):
- liczbę zgłoszeń, aktywnych zgłoszeń i zgłaszających, wykres zgłoszeń dziennie (dla „cały czas” z ostatnich 90 dni);
- ranking zgłaszających (remisy dzielą miejsce). Gracze są pokazani nazwą z Discorda, a jeśli jej nie mają,
  tylko początkiem adresu e-mail (`lu…`), bo pełne adresy nigdy nie są pokazywane innym;
- najczęściej zgłaszane potwory i miasta;
- *Your stats*: Twoje zgłoszenia, miejsce w rankingu i postęp bestiariusza każdej postaci.

Formularz zgłoszenia w aplikacji nie ma wyboru świata. Zgłoszenie trafia na świat, na którym gracz ma najwięcej
postaci (przy remisie pierwszy alfabetycznie). Na inny świat można zgłosić z Discorda: `/report` na kanale tego świata, np. `#wardens-secura`.

## Logi i błędy (Sentry)

Backend (`php` i `worker`) wysyła do Sentry:
- **logi** z `LoggerInterface` od poziomu `info` (z treścią po podstawieniu placeholderów). Widać
  je w zakładce *Explore → Logs*. Wyjątek to kanały `event`, `doctrine` i `deprecation`.
- **nieobsłużone wyjątki** jako *Issues*. Oczekiwane błędy klienta (401/403/404/422) nie są
  zgłaszane, bo API odpowiada na nie zwykłym `problem+json`.

Bot i aplikacja webowa też są podpięte:
- **bot**: wyjątki (nieudane interakcje poza błędami gracza, błędy obsługi zdarzeń z RabbitMQ,
  błędy klienta Discord, fatalne zakończenie) jako *Issues*, a całe wyjście `console.*` jako *Logs*;
- **frontend**: błędy renderowania (z ekranem „Coś poszło nie tak”), nieobsłużone błędy i odpowiedzi
  API 5xx jako *Issues*, a `console.warn`/`console.error` jako *Logs*.

Zdarzenia mają tag `component` (`bot` / `frontend`), więc w jednym projekcie łatwo je odfiltrować.
Domyślnie wszystko idzie na `SENTRY_DSN`. Osobne projekty ustawisz przez `SENTRY_DSN_BOT` i
`SENTRY_DSN_FRONTEND`. DSN frontendu trafia do kodu w przeglądarce, co jest normalne: DSN pozwala
tylko wysyłać zdarzenia.

Test połączenia z backendu: `docker compose exec php bin/console app:sentry-test`.

Włączenie: w `.env` ustaw `SENTRY_DSN` (DSN projektu PHP z sentry.io albo z własnej instancji Sentry)
i opcjonalnie `SENTRY_ENVIRONMENT`, potem `docker compose up -d php worker`. Bez DSN Sentry jest
wyłączone, a logi zostają w `backend/var/log/dev.log`.

Worker wysyła zbuforowane logi po każdej obsłużonej wiadomości (`SentryLogsFlushListener`), a nie
dopiero po godzinie, gdy kończy pracę.

## Testy

```bash
make test            # wszystkie zestawy
make test-backend    # PHPUnit: WebTestCase 201/401/422/403/404/200, testy jednostkowe, scheduler TTL
make test-bot        # Vitest: parsowanie zdarzeń, wiadomości, wygaszanie przycisków, scenariusze A/B
make test-frontend   # Vitest + Testing Library: kolejka synchronizacji bestiariusza, formularz zgłoszenia
```

Testy backendu działają na osobnej bazie `warden_test`. Każdy test jest w transakcji wycofywanej
przez DAMADoctrineTestBundle.

## Produkcja

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build   # albo: make prod-up
```

Obrazy produkcyjne zawierają zbudowany kod: PHP bez zależności dev ze skompilowanym `.env` i
rozgrzanym cache, statyczny bundle Reacta serwowany przez nginx, bot skompilowany do JS. Nie ma
w nich bind mountów, a baza i broker nie wystawiają portów. Przed startem ustaw w `.env` prawdziwe
`APP_SECRET`, `BOT_API_TOKEN`, `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD` i `VITE_API_URL`
(ten ostatni jest wbudowywany w bundle w czasie budowania).

### Publicznie na tym serwerze

`https://warden.23-88-19-218.sslip.io` (sslip.io zamienia nazwę na IP serwera). Porty 80/443 należą do Caddy
z projektu openGym (`~/gym/openGym/Caddyfile`), który ma blok dla tej domeny, sam robi HTTPS (Let's Encrypt)
i kieruje `/api/*` do `warden-api`, a resztę do `warden-web`. `docker-compose.public.yml` dołącza nasze nginx
i frontend do sieci `opengym_default` pod tymi aliasami i nie publikuje żadnych portów:

```bash
make public-up     # build produkcyjny + start; po każdej zmianie w kodzie uruchom ponownie
make public-down
```

W `.env`: `FRONTEND_URL` i `VITE_API_URL` to adres publiczny, `CORS_ALLOW_ORIGIN` go dopuszcza, a
`BOT_API_TOKEN` jest losowy. Logowanie przez Discord wymaga adresu
`https://warden.23-88-19-218.sslip.io/auth/discord/callback` w Developer Portal → OAuth2 → Redirects.

## Założenia poza specyfikacją

- **Autentykacja**: specyfikacja wymaga tokenu Bearer, ale nie mówi, skąd go wziąć. Dodano
  rejestrację i logowanie e-mail + hasło (token ważny 30 dni) oraz łączenie konta Discord
  jednorazowym kodem.
- **Kanały publiczne** są wyszukiwane po nazwie `#wardens-<świat>` (prefiks: `CHANNEL_PREFIX`).
- **Lista światów** jest konfigurowalna przez `TIBIA_WORLDS`.
- **Status `KILLED`** jest w schemacie, ale żaden endpoint go jeszcze nie ustawia (specyfikacja
  nie opisuje, kiedy zgłoszenie uznać za zabite).
- **Bot** trzyma powiązanie zgłoszenie → wiadomości w pamięci. Alerty sprzed restartu odnajduje
  w historii kanału (ostatnie 100 wiadomości na kanał). Prywatnych wiadomości sprzed restartu
  nie odnajduje.
