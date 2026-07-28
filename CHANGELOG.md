# Changelog

Toutes les modifications notables de HORIZN sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Non publié]

### Performance

- `perf(gtfs)` — Import 3,3× plus rapide et 2,3× moins gourmand en RAM
  (mesuré sur 9M lignes : 134s → 41s, 620 Mo → 264 Mo de pic RSS).
  - Les index sur `stop_times` ne sont plus créés par `schema.sql` **avant** le
    chargement en masse : ils étaient maintenus à chaque insertion, soit 66 % du
    temps d'import. Ils sont construits une fois après, par `createIndexes()`.
  - Suppression de deux index en double sur `stop_times` (`idx_stop_times_trip_id`
    et `idx_stop_times_stop_id` faisaient doublon avec ceux de `schema.sql`) :
    base 31 % plus petite (~2,7 Go → ~1,9 Go).
  - Insertion au fil de l'eau dans une transaction longue au lieu de lots de
    50 000 objets JS : plus d'allocation d'un objet par ligne (10,4M objets).
  - Parsing CSV dédié en remplacement de `csv-parser` sur ce chemin, avec chemin
    rapide sans guillemet et résolution des colonnes une seule fois.
  - `cache_size` ramené de 256 Mo à 64 Mo et `temp_store` passé de `MEMORY` à
    `FILE` : la mémoire ne croît plus avec le volume de données.
  - Hash SHA256 du ZIP en streaming au lieu de `readFileSync` (évitait un Buffer
    de la taille du ZIP, ~1 Go en production).

### Corrigé

- `fix(gtfs)` — `rebuildDB()` n'était pas attendu (`await` manquant) : sur une
  installation vierge, `statSync` sur la base inexistante levait une erreur et
  `process.exit(1)` tuait l'import en cours. L'import à froid fonctionne.
- `fix(gtfs)` — Le hash du ZIP était écrit *avant* la fin de l'import : un run
  interrompu (OOM kill, timeout) était considéré comme réussi et le run suivant
  le skippait. Il n'est désormais écrit qu'après succès.
- `fix(gtfs)` — Les erreurs de lecture du ZIP étaient avalées
  (`.on('error', err => resolve(count))`) : une archive tronquée produisait une
  base partielle, swappée en production et marquée comme valide. L'erreur est
  maintenant propagée, l'ancienne base est conservée.

## [2.0.0-beta.1] — 2026-06-11

Première version beta de HORIZN, remplaçant l'ancien ISA (Infostation API v1.2).
Fusion complète des données PRIM temps réel et GTFS statique.

### Ajouté

#### Endpoints API
- `GET /next` — Prochains passages temps réel (SIRI StopMonitoring)
- `GET /nextTrains` — Version enrichie avec trafic + équipements
- `GET /timetable` — Grille horaire GTFS journalière
- `GET /traffic` — État du trafic par ligne (lineRef) ou arrêt (stopId)
- `GET /search` — Recherche d'arrêts avec retour des zdaids
- `GET /equipments` — Pannes d'ascenseurs/escalators
- `GET /health` — Healthcheck Docker
- `GET /status` — État détaillé (GTFS, cache, PRIM, uptime)
- `GET /admin/*` — Routes admin protégées (stats, logs, cache, health)

#### Authentification & Sécurité
- Middleware `requireFrontend` et `requireAdmin` avec clés API fichier
- Support JWT (`Authorization: Bearer`)
- CLI de gestion des clés : `npm run keys list|generate|revoke`
- Rate limiting différencié : 100/min public, 20/min `/search`, 60/min `/next`, 30/min admin
- Middleware `denySensitivePaths` bloque `.env`, `api_keys.json`, `package.json` etc.
- Headers sécurité : `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- CORS restreint à `infostation.fr`
- Clés rechargées à chaud (fichier `data/api_keys.json`)

#### GTFS & Cache
- Import GTFS avec téléchargement, hash check (skip si ZIP inchangé), atomic swap (downtime <1ms)
- DB SQLite : 10.4M stop_times, 2.7 GB, calendar + shapes chargés
- Cache fichier persistant : TTLs 30s `/next`, 90s `/traffic`/`/equipments`, 24h `/search`
- Volume `./js/cache` et `./data` montés (persistance entre rebuilds)
- Refresh GTFS programmé 08:05/13:05/17:05 via crontab

#### Opérations
- Graceful shutdown (SIGTERM/SIGINT, timeout 10s)
- Logs JSON lines dans `data/logs/YYYY-MM-DD.jsonl`
- Docker HEALTHCHECK (interval 30s, 3 retries, start 10s)
- Request ID (header `X-Request-ID` ou généré)
- Script `refresh-gtfs.sh` avec hash skip

#### Documentation
- `README.md` complet avec endpoints, auth, exemples
- `docs/ARCHITECTURE.md` — middleware stack, flux Mermaid, sécurité, Docker
- `AGENT.md` + `CLAUDE.md` — contexte pour IA (règle ⛔ pas d'express.static())

### Modifié
- **ISA → HORIZN** : renommage complet du projet, nouveau déploiement Docker
- `SearchService.js` v2 : index zdaid depuis `arrets-stopPoint.json` (33k entrées), `zdaids[]` dans les résultats
- `NextService.js` : parsing `trainNum` corrigé (`TrainNumbers.TrainNumberRef[0].value` au lieu de `TrainNumbers[0].value`)
- Middleware stack refactoré avec auth, rate limiting, sécurité en couches
- Endpoints harmonisés : 200 + tableau vide si pas de données (pas de 404/204)
- Ancienne DB GTFS 5.7M → 10.4M stop_times

### Technique
- Version pré-release semver `2.0.0-beta.1` — compatible semver
- Application Node.js/Express derrière Docker
- Base SQLite avec better-sqlite3
- API PRIM IDFM : SIRI StopMonitoring + General Message
- API Navitia pour le Geocoding (places)
- Authentification : fichier `data/api_keys.json` + JWT
- Taux de requêtes : `rate-limiter-flexible` avec stockage fichier
