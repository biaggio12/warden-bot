# Specyfikacja Techniczna i Backlog Projektu: Tibia Warden Tracker

Dokument zawiera podsumowanie ustaleń biznesowo-technicznych, wybrany stos technologiczny oraz gotowy backlog zadań z kryteriami akceptacji (Definition of Done) dla zespołów inżynieryjnych.

## 1. Stos Technologiczny (Tech Stack)

* **Backend & API:** PHP 8.x / **Symfony** (API Platform / Controller-based REST API, Doctrine ORM, Messenger dla zdarzeń).
* **Frontend:** **ReactJS** (SPA / Vite lub Next.js) + **Tailwind CSS** (stylowanie UI, komponenty headless/Radix/shadcn).
* **Bot Discorda:** Node.js / **TypeScript** (biblioteka `discord.js`).
* **Baza danych & Broker:** PostgreSQL / MySQL + RabbitMQ lub Redis (kolejki zdarzeń).
* **Infrastruktura:** **Docker** + **Docker Compose** (konteneryzacja wszystkich serwisów pod kątem środowiska dev i prod).

## 2. Zarys Architektury i Przepływu Danych

System składa się z trzech współpracujących komponentów:

1. **Aplikacja Webowa (ReactJS + Tailwind CSS):**
   * Panel gracza do zarządzania postaciami i Bestiariuszem (z mechanizmem masowego zaznaczania).
   * Szybki formularz do raportowania pojawienia się potwora.
2. **Backend & Baza Danych (Symfony):**
   * Centralna logika biznesowa, autoryzacja i autentykacja.
   * Obsługa cyklu życia zgłoszeń (TTL – Time To Live).
   * Asynchroniczna kolejka zdarzeń domenowych (`Symfony Messenger`) kierowanych do integracji zewnętrznych.
3. **Bot Discorda (TypeScript / discord.js):**
   * Kanał dystrybucji powiadomień celowanych (filtry per serwer oraz status ubicia potwora).
   * Interaktywne interfejsy (przyciski, select menu) umożliwiające natychmiastowe oznaczanie potworów bez opuszczania Discorda.

## 3. Moduł: Backend & API (Symfony)

### Zadanie BE-0: Konteneryzacja środowiska (Docker & Docker Compose)
* **Typ:** DevOps / Infrastructure Task
* **Priorytet:** Blocker / Highest
* **Zakres:**
  * Przygotowanie konfiguracji Docker dla całego stacku aplikacji z plikiem `docker-compose.yml`:
    * Serwis PHP-FPM (Symfony) + Nginx/Caddy.
    * Serwis Frontend (React dev server / preview, Node.js).
    * Serwis Bota Discorda (Node.js / TypeScript runtime z automatyczną rekompilacją `tsx` / `ts-node-dev`).
    * Serwis Relacyjnej Bazy Danych (PostgreSQL/MySQL) z persistent volume.
    * Serwis Redisa/RabbitMQ (do obsługi asynchronicznych kolejek Messenger / events).
  * Przygotowanie plików `.env.example` oraz skryptu startowego (np. `make init` lub `docker compose up --build`).
* **Kryteria Akceptacji (DoD):**
  * [ ] Całe środowisko startuje jednym poleceniem (`docker compose up -d`).
  * [ ] Każdy kontener posiada zdefiniowany healthcheck.
  * [ ] Zapewnione volume-sharing umożliwiające hot-reload w Reactcie, podgląd zmian kodu w Symfony oraz auto-restart bota TS.
  * [ ] Instrukcja uruchomienia projektu opisana w pliku `README.md`.

---

### Zadanie BE-1: Model danych i schemat bazy (Doctrine)
* **Typ:** Technical Task
* **Priorytet:** High
* **Zakres:**
  * Utworzenie encji i migracji Doctrine dla relacyjnej bazy danych:
    * `monsters`: `id` (PK), `name` (varchar), `category` (varchar), `charm_points` (int).
    * `characters`: `id` (UUID, PK), `user_id` (FK), `name` (varchar), `server_name` (varchar).
    * `character_killed_monsters`: `character_id` (FK), `monster_id` (FK), `killed_at` (timestamp). Indeks unikalny: `UNIQUE(character_id, monster_id)`.
    * `warden_spawns`: `id` (UUID, PK), `monster_id` (FK), `server_name` (varchar), `location_description` (varchar), `reported_by_user_id` (FK), `created_at` (timestamp), `expires_at` (timestamp), `status` (ENUM: `ACTIVE`, `KILLED`, `EXPIRED`).
* **Kryteria Akceptacji (DoD):**
  * [ ] Migracje Doctrine wykonują się deterministycznie (`bin/console doctrine:migrations:migrate`).
  * [ ] Przygotowane fixtury/seedy początkowej listy potworów Warden (`DoctrineFixturesBundle`).
  * [ ] Zabezpieczenie integralności referencyjnej kluczami obcymi i indeksami unikalnymi.

---

### Zadanie BE-2: `POST /api/v1/warden-spawns` – Raportowanie Wardena
* **Typ:** User Story
* **Opis:** Umożliwienie zgłoszenia potwora przez gracza (web/bot) wraz z kalkulacją czasu wygaśnięcia (TTL).
* **Kontrakt API:**
  * **Metoda / URL:** `POST /api/v1/warden-spawns`
  * **Autoryzacja:** Wymagany Bearer Token
  * **Przykładowy Payload:**
    ```json
    {
      "monster_id": 142,
      "server_name": "Monza",
      "location_description": "Venore Dragon Lair -2, przy bramce",
      "ttl_minutes": 7
    }
    ```
  * **Walidacja (Symfony Validator):**
    * `monster_id`: wymagane, integer, musi istnieć w tabeli `monsters`.
    * `server_name`: wymagane, string z dozwolonej listy aktywnych światów.
    * `location_description`: wymagane, string (5–255 znaków), sanityzacja XSS.
    * `ttl_minutes`: opcjonalne, integer z zakresu `3` do `30` (domyślnie `7`).
  * **Odpowiedź (`201 Created`):**
    ```json
    {
      "id": "c7a6e1d2-9f3b-4b1a-8e2a-1c2d3e4f5a6b",
      "monster": {
        "id": 142,
        "name": "Dragon Warden"
      },
      "server_name": "Monza",
      "location_description": "Venore Dragon Lair -2, przy bramce",
      "status": "ACTIVE",
      "expires_at": "2026-10-29T12:07:00Z"
    }
    ```
* **Kryteria Akceptacji (DoD):**
  * [ ] Wyliczenie `expires_at` jako `created_at + ttl_minutes`.
  * [ ] Publikacja zdarzenia asynchronicznego `WardenSpawnedEvent` na kolejkę przez Symfony Messenger.
  * [ ] Błędy walidacji zwracają `422 Unprocessable Entity` z czytelnym formatem RFC 7807 (Problem Details).
  * [ ] Testy integracyjne WebTestCase pokrywające ścieżki: 201, 401, 422.

---

### Zadanie BE-3: `POST /api/v1/characters/{character_id}/killed-monsters` – Odznaczenie Wardena
* **Typ:** User Story
* **Opis:** Oznaczenie potwora jako zabitego na konkretnej postaci gracza (zabezpieczenie przed ponownymi alertami).
* **Kontrakt API:**
  * **Metoda / URL:** `POST /api/v1/characters/{character_id}/killed-monsters`
  * **Headers:** `Authorization: Bearer <token>`
  * **Payload:**
    ```json
    {
      "monster_id": 142
    }
    ```
* **Zasady obsługi błędów i stanów:**
  * `401 Unauthorized`: brak ważnego tokena.
  * `403 Forbidden`: postać `{character_id}` nie należy do zalogowanego konta (obsługa przez Symfony Voter).
  * `404 Not Found`: postać lub potwór nie istnieją.
  * `201 Created`: potwór oznaczony po raz pierwszy (zapis nowego rekordu).
  * `200 OK`: potwór był już wcześniej oznaczony (idempotentność operacji – brak duplikatu w bazie).
* **Kryteria Akceptacji (DoD):**
  * [ ] Próba edycji cudzej postaci zwraca kod `403`.
  * [ ] Wielokrotne wysłanie tego samego requestu nie powoduje błędów bazy i zwraca `200 OK`.
  * [ ] Testy jednostkowe weryfikujące poprawność powiązania relacji.

---

### Zadanie BE-4: Mechanizm zamykania przeterminowanych zgłoszeń (TTL Scheduler)
* **Typ:** Technical Task
* **Opis:** Obsługa automatycznego wygaszania rekordów w tle z wykorzystaniem Symfony Scheduler / Messenger.
* **Kryteria Akceptacji (DoD):**
  * [ ] Cykliczny worker (np. co 60 sekund) wyszukujący rekordy o statusie `ACTIVE`, gdzie `expires_at < NOW()`.
  * [ ] Hurtowa aktualizacja statusu na `EXPIRED`.
  * [ ] Publikacja zdarzenia `WardenExpiredEvent` informującego bota o konieczności dezaktywacji przycisków pod powiadomieniem na Discordzie.

## 4. Moduł: Bot Discorda (TypeScript)

### Zadanie DISCORD-1: Publikacja i targetowanie powiadomień
* **Typ:** User Story
* **Opis:** Odbiór zdarzenia `WardenSpawnedEvent` i wysyłka alertu z uwzględnieniem filtrów anty-spamowych.
* **Wymagania:**
  * Aplikacja napisana w TypeScript z wykorzystaniem biblioteki `discord.js`.
  * Publikacja powiadomienia na publicznym kanale serwera (np. `#wardens-monza`).
  * Wysłanie bezpośrednich wiadomości (DM) **wyłącznie** do użytkowników, którzy:
    1. Mają postać zarejestrowaną na danym świecie (np. Monza).
    2. W bazie danych **nie posiadają** rekordu zabicia danego `monster_id` na tej postaci.
  * Wykorzystanie natywnego formatowania czasu Discorda dla dynamicznego odliczania (np. `<t:{unix_timestamp}:R>`).
* **Kryteria Akceptacji (DoD):**
  * [ ] Użytkownicy z już zaliczonym potworem nie dostają prywatnej wiadomości (DM).
  * [ ] Powiadomienie zawiera nazwę potwora, lokalizację, czas do wygaśnięcia oraz interaktywny przycisk akcji `[Zabiłem]`.

---

### Zadanie DISCORD-2: Obsługa interakcji „Zabiłem” z poziomu Discorda
* **Typ:** User Story
* **Opis:** Bezpośrednie odznaczenie ubitego Wardena bez konieczności otwierania przeglądarki.
* **Wymagania:**
  * Gracz klika przycisk `[Zabiłem]` pod wiadomością z powiadomieniem.
  * **Scenariusz A (1 postać na serwerze):** Bot natychmiast wysyła żądanie do backendowego API i zwraca efemeryczne potwierdzenie: *„Zaliczono [Nazwa Potwora] dla postaci [Nazwa Postaci]”*.
  * **Scenariusz B (wiele postaci na danym serwerze):** Bot wyświetla menu wyboru (Select Menu) widoczne tylko dla klikającego z pytaniem: *„Dla której postaci chcesz zaliczyć potwora?”*, a po wyborze wykonuje strzał do API.
* **Kryteria Akceptacji (DoD):**
  * [ ] Interakcja nie blokuje wątku bota i korzysta z odpowiedzi efemerycznych (`ephemeral: true`).
  * [ ] Po upływie czasu TTL lub otrzymaniu `WardenExpiredEvent` przyciski w powiadomieniu stają się nieaktywne (disabled).

## 5. Moduł: Frontend (ReactJS + Tailwind CSS)

### Zadanie FE-1: Widok Bestiariusza postaci z masową edycją
* **Typ:** User Story
* **Opis:** Interfejs do przeglądania i szybkiego odznaczania potworów bez żmudnego klikania setek pojedynczych pól.
* **Wymagania:**
  * Komponenty stylowane przy użyciu **Tailwind CSS**.
  * Wybór aktywnej postaci w nagłówku widoku.
  * Lista potworów pogrupowana według kategorii z polem szybkiego filtrowania/wyszukiwania.
  * Akcje masowe na poziomie kategorii:
    * Przycisk `Zaznacz wszystkie w tej kategorii`.
    * Przycisk `Odznacz wszystkie w tej kategorii`.
  * Wizualny wskaźnik stanu synchronizacji (optymistyczne UI z obsługą ewentualnego błędu sieci).
* **Kryteria Akceptacji (DoD):**
  * [ ] Zmiana wybranej postaci natychmiast odświeża stan checkboxów.
  * [ ] Akcja masowa wysyła jedno zbiorcze żądanie lub kolejkuje zapytania tak, aby nie przeciążyć przeglądarki i API.

---

### Zadanie FE-2: Formularz szybkiego zgłoszenia Wardena
* **Typ:** User Story
* **Opis:** Prosty i intuicyjny formularz dla gracza zgłaszającego pojawienie się potwora.
* **Wymagania:**
  * Pola:
    * Serwer (Select powiązany z serwerami postaci gracza).
    * Potwór (Input z autocomplete z listy słownikowej).
    * Lokalizacja (Text input z walidacją min. 5 znaków).
    * Czas do zniknięcia (Slider / Select: 5, 7, 10, 15 minut; domyślnie 7).
* **Kryteria Akceptacji (DoD):**
  * [ ] Formularz blokuje wysłanie niekompletnych danych przed wykonaniem requestu HTTP.
  * [ ] Po pomyślnym zgłoszeniu wyświetla się powiadomienie typu Toast z informacją: *„Zgłoszono pomyślnie. Czas do zniknięcia: [Godzina]”*.