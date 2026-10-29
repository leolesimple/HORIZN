# Changelog

Toutes les modifications notables de HORIZN sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
