# Changelog

Toutes les modifications notables de HORIZN sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

La [ROADMAP](ROADMAP.md) liste ce qui est prévu.

## [Non publié]

### CI

- Publication de l'image Docker sur `ghcr.io/leolesimple/horizn` à chaque tag `v*`,
  après passage de la CI (`node` + `docker`). Tags générés : `{version}`,
  `{major}.{minor}`, `{major}`, plus `latest` pour les versions stables. Le
  déploiement continue de reconstruire l'image localement pour l'instant.

## [2.0.1] — 2026-09-10

### Ajouté

- **Suivi de la dernière utilisation des clés API** — chaque requête acceptée met à jour `lastUsedAt` et `usageCount` dans `data/api_keys.json`. Écriture différée (`KeyUsageService` : flush toutes les 30 s + à l'arrêt) : lecture atomique `fd`+`fstat`, écriture `tmp`+`rename` avec préservation du mode du fichier et garde anti-course (mtime) contre les écritures concurrentes de `keys.js`. Les clés `.env` sont suivies en mémoire uniquement.
- `GET /admin/keys` — inventaire des clés (aperçu masqué) : rôle, nom, source (`file`/`env`), dernière utilisation, compteur cumulé, et consommation de quota en temps réel par classe de route (`quota.<classe>`, `quota.worstPct`). Également exposé sous `keys` dans `GET /admin/horizn`.
- `npm run keys list` affiche la dernière utilisation et le nombre d'utilisations par clé.
- Support de `API_KEYS_FILE` (chemin du fichier de clés) dans `auth.js`, `keys.js` et `KeyUsageService.js`.

### Modifié

- **Rate limiting par clé API** au lieu de par IP : le quota est indexé sur `sha256(clé)` pour les clés connues, avec repli sur l'IP pour les requêtes sans clé connue (avant auth, anti-brute-force). `js/middleware/rateLimit.js` expose `getUsage(key)` pour l'introspection.

## [2.0.0] — 2026-09-08

Première version **stable** de HORIZN — promotion de `2.0.0-beta.1` (périmètre
fonctionnel identique, voir la section ci-dessous).

### Corrigé

- `fix(deps)` — résolution des vulnérabilités signalées par Dependabot (`npm audit`).

### Ajouté

- Workflow CI GitHub Actions (`.github/workflows/ci.yml`) : `npm audit`, `npm ls --all`,
  `node --check` sur tout `js/`, smoke test `/health`, build de l'image Docker.

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

---

[Non publié]: https://github.com/leolesimple/HORIZN/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/leolesimple/HORIZN/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/leolesimple/HORIZN/compare/v2.0.0-beta.1...v2.0.0
[2.0.0-beta.1]: https://github.com/leolesimple/HORIZN/compare/v1.2.0...v2.0.0-beta.1
