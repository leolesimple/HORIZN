# Changelog

Toutes les modifications notables de HORIZN sont documentées ici.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-beta.1] — 2026-06-11

### Ajouté
- Retour des `zdaids` dans `/search` pour requêter directement `/next` sans saut de mapping
- Champ `trainNum` désormais parsé correctement dans `/next` (TrainNumbers.TrainNumberRef)
- Nouveau skill `horizn-api` pour assister les requêtes API sur l'infrastructure Heartbeat

### Modifié
- `SearchService.js` v2 : index chargé depuis `arrets-stopPoint.json` (33k entrées), enrichit chaque résultat avec `zdaids[]`
- `NextService.js` : parsing `trainNum` fixé (`mvj.TrainNumbers?.TrainNumberRef?.[0]?.value` au lieu de `mvj.TrainNumbers?.[0]?.value`)

### Technique
- Version pré-release `2.0.0-beta.1` — cycle de beta ouvert, compatible semver
- Docker image et conteneur restent stables, pas de rebuild nécessaire

## [2.1.0] — 2026-06-11

### Ajouté
- Authentification via API keys (header `X-API-Key`) et JWT (`Authorization: Bearer`)
- Rate limiting différencié par route (100 req/min public, 20/min search, 30/min admin)
- Endpoint `GET /health` pour les healthchecks Docker
- Endpoint `GET /status` avec état de toutes les dépendances (GTFS, cache, PRIM)
- Graceful shutdown (SIGTERM/SIGINT avec timeout 10s)
- Request ID (header `X-Request-ID` ou généré automatiquement)
- Volume `./js/cache` monté dans le conteneur (cache persistant)

### Modifié
- Routes admin (`/admin/*`) protégées par auth + rate limiting séparé
- `js/index.js` refactoré avec middleware stack propre
- `.env.example` documente toutes les variables disponibles

### Technique
- HEALTHCHECK Docker (interval 30s, 3 retries, start period 10s)
- `version: '3.8'` retiré du docker-compose (obsolète)

## [2.0.0] — 2026-06-10

### Ajouté
- Fusion données PRIM temps réel + GTFS statique
- Endpoint `/next` avec paramètres stopId, stopArea, horizon, full, includeGTFS
- Endpoint `/timetable` pour horaires GTFS journaliers
- Endpoint `/traffic` avec filtres lineRef et stopId
- Endpoint `/search` par nom d'arrêt
- Endpoint `/equipments` pour pannes d'ascenseurs/escalators
- Cache fichier avec TTLs configurés (30s next, 90s traffic, 90s equipments, 24h search)
- Logs JSON lines dans `data/logs/YYYY-MM-DD.jsonl`
- Endpoints admin : `/admin/stats`, `/admin/logs`, `/admin/cache`, `/admin/health`, `/admin/horizn`
- Script setup GTFS avec téléchargement et import
- Refresh GTFS programmé (08:05, 13:05, 17:05)

### Technique
- Application Node.js/Express derrière Docker
- Base SQLite avec better-sqlite3 (5.7M stop_times)
- CacheService fichier persistant
- LoggerService avec rotation journalière
