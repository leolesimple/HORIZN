# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

API REST Node.js/Express pour les transports Île-de-France. Fusionne le temps réel **PRIM**
(SIRI StopMonitoring + `disruptions_bulk`) et le **GTFS statique** IDFM (SQLite) en une API unique.
Backend pur : aucun fichier statique servi. Docker + Cloudflare Tunnel, port 3003.

## Stack
Node.js 20, Express 5, better-sqlite3, axios, rate-limiter-flexible, jsonwebtoken. Pas de TypeScript, pas de framework de test.

## Commandes

```bash
npm run dev                       # nodemon js/index.js (dev local)
npm start                         # node js/index.js
npm run setup-gtfs                # télécharge + importe le GTFS IDFM dans data/infostation.db
npm run migrate-stops             # recharge stops.txt (colonnes parent_station/location_type)
npm run keys list | generate | revoke   # gestion des clés API (data/api_keys.json)

docker compose up -d --build      # build image + déploiement (prod)
docker restart horizn
docker exec horizn node js/scripts/setupGTFS.js   # refresh GTFS dans le conteneur
```

### Tests / CI

`npm test` n'est pas implémenté (exit 1). La CI (`.github/workflows/ci.yml`) tient lieu de suite :
`npm audit --audit-level=moderate`, `npm ls --all`, `node --check` sur chaque `js/**/*.js`, puis un
smoke test qui démarre le serveur et `curl` `/health`. Avant de pousser, reproduire localement :

```bash
find js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
PORT=3003 QUIET_MODE=1 node js/index.js &   # puis curl http://127.0.0.1:3003/health
```

## Architecture

### Pipeline de requête (`js/index.js`, ordre strict)

1. `denySensitivePaths` — 403 sur `..`, tout segment commençant par `.`, et les noms exacts de `SENSITIVE_FILES` (`js/middleware/security.js`)
2. `securityHeaders` — `nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`, `Referrer-Policy`
3. CORS maison — whitelist `infostation.fr` / `beta.infostation.fr`. **Rejette (403) toute requête dont `Origin` OU `Referer` n'est pas whitelisté** ; une requête sans `Origin`/`Referer` (serveur-à-serveur, curl) passe. Le contrôle d'accès réel, c'est la clé API — pas le CORS.
4. Request ID (`X-Request-ID`, transmis ou généré)
5. Logging — `res.on('finish')` → `LoggerService` écrit une ligne JSON dans `data/logs/YYYY-MM-DD.jsonl`
6. Rate limiting **par classe de route** (`rateLimitNext` 60/min, `rateLimitSearch` 20/min, `rateLimitPublic` 100/min, `rateLimitAdmin` 30/min) — `RateLimiterMemory`, remis à zéro au redémarrage. Quota indexé sur `sha256(clé API)` si la clé est connue (`auth.isKnownKey`), sinon sur `req.ip` (fallback pour les requêtes non authentifiées, rejetées à l'étape 7).
7. Auth — `requireFrontend` / `requireAdmin`. Toute clé valide déclenche `KeyUsageService.record()` (suivi `lastUsedAt` / `usageCount`).
8. Handler

`/health` court-circuite tout (ni auth ni rate limit) pour le HEALTHCHECK Docker.

### Couche services (`js/services/`, tous des singletons `module.exports = new X()` ou objet)

- **DeparturesService** — cœur de `/next` et `/nextTrains`. Appelle PRIM StopMonitoring (cache 30 s), complète avec `GTFSService.getScheduledDepartures`, puis `_mergeAndNormalize` : tous les passages PRIM sont gardés, un passage GTFS n'est ajouté que si aucun PRIM ne tombe dans son bucket de ±3 min (`Math.floor(ts/60000)`). Tri chronologique final.
- **GTFSService** — SQLite lazy-open en `readonly` + WAL. Toutes les requêtes de départs font `JOIN calendar` et résolvent le stopId via `_resolveAreaId` (`43082` → `IDFM:monomodalStopPlace:43082`, sinon inchangé si déjà préfixé `IDFM:`). Fenêtre horaire GTFS pouvant dépasser `24:00:00` (services de nuit).
- **TrafficService** — récupère **tout** le dataset `disruptions_bulk/v2` (~900 perturbations), le met en cache fichier sous la clé `disruptions_bulk` (TTL 90 s), puis filtre en mémoire par `impactedSections[].lineId` (`line:IDFM:<lineRef>`) et/ou par arrêt (`stop_area:IDFM:<id>`).
- **EquipmentService** — ne fait aucun appel réseau propre : réutilise `TrafficService.getLineTraffic(null, null)` (même cache) et filtre sur les mots-clés `ascenseur`/`escalator`/…
- **SearchService** — proxy vers Navitia `places` (`type=stop_area`), enrichit chaque résultat avec les `zdaids[]` issus de `json/arrets-stopPoint.json` (index nom normalisé, chargé une fois). Cache fichier 24 h, clé `v2:<q>:<count>`.
- **CacheService** — cache **fichier** dans `js/cache/<clé>.json`. Le TTL est appliqué **à la lecture** (`get(key, maxAge)` compare `mtime`), jamais à l'écriture (`set(key, data)` sans TTL). Volume monté → survit aux rebuilds.
- **KeyUsageService** — suivi d'usage des clés. `record(key)` accumule un delta en mémoire (`_pending`), `flush()` le reverse dans `data/api_keys.json` : lecture atomique (fd + `fstat`) → merge → write `tmp` (mode du fichier préservé) → garde anti-course sur `mtime` → `rename`. Retire du delta uniquement les clés fichier réécrites (`_pending.delete`), garde les clés `.env`. `_dirty` conservé sur toute erreur de lecture/écriture (retry). `_loadKeyFile()` **lève** sur erreur réelle (perms, JSON invalide) et ne renvoie `[]` que si le fichier est absent. `start()`/`stop()` = timer de flush 30 s (`unref`), appelés par `index.js` (boot + shutdown). `report()` = inventaire masqué + `rateLimit.getUsage()` pour `/admin/keys`.
- **LoggerService** / **AdminService** — write-stream par jour ; stats/logs/cache/health servis sous `/admin/*` (lecture des `.jsonl`).

### Deux sources de clés API (cumulatives, `js/middleware/auth.js`)

1. `.env` : `FRONTEND_API_KEY`, `ADMIN_API_KEY` (fallback) — usage suivi en mémoire seulement
2. `data/api_keys.json` (géré par `js/scripts/keys.js`, préfixe `hzn_`) — rechargé à chaud via `fs.statSync` mtime. Champs d'usage ajoutés par `KeyUsageService` : `lastUsedAt`, `usageCount`. Chemin surchargeable par `API_KEYS_FILE` (auth, keys.js, KeyUsageService).

Rôles : `frontend` (routes publiques) et `admin` (admin + publiques). JWT `Bearer` accepté si `JWT_SECRET` est défini (rôle `user`).
`GET /admin/keys` (et `keys` dans `/admin/horizn`) expose rôle/nom/source/`lastUsedAt`/`usageCount` + quota temps réel par classe.

⚠️ Cycle de `require` : `auth` → `KeyUsageService` (top-level) ; `rateLimit` → `auth` (top-level) ; `KeyUsageService` → `rateLimit` **en lazy dans `report()` uniquement**. Ne pas remonter ce dernier `require` en haut du fichier.

### GTFS import (`js/scripts/setupGTFS.js`)

Télécharge le ZIP IDFM si > 24 h, hash SHA256 → skip si inchangé, sinon rebuild complet dans
`data/infostation.db.tmp` (pragmas rapides, batches de 50 000) puis `fs.renameSync` atomique
(downtime < 1 ms). En prod : cron `5 8,13,17 * * *` via `scripts/refresh-gtfs.sh` (`docker exec`).

## Pièges connus (vérifiés dans le code, pas encore corrigés)

- **`js/services/NextService.js` est du code mort** : `index.js` n'importe que `DeparturesService`. NextService a son propre cache mémoire et le parsing `trainNum` « corrigé » (`TrainNumbers.TrainNumberRef[0].value`) — que `DeparturesService` (le service actif) n'a *pas* (il lit encore `TrainNumbers?.[0]?.value`).
- **`setupGTFS.js` n'importe que `stops/routes/trips/stop_times`** — pas `calendar.txt` ni `shapes.txt`. Or `GTFSService` fait un `INNER JOIN calendar`. Une DB construite uniquement par le script actuel renvoie donc **zéro** départ/horaire GTFS. Vérifier comment `calendar` est peuplé dans l'environnement déployé avant de toucher à ce chemin.
- **Noms de variables PRIM incohérents** : `DeparturesService`/`TrafficService`/`index.js` lisent `process.env.PRIM_API_KEY` ; `SearchService.js` lit `process.env.PRIM_KEY` (nom différent). Les quatre ont un **fallback en dur** vers une clé PRIM réelle — à retirer, pas à propager.
- **`.env.example` documente `API_KEYS=key1,key2`** : cette variable n'est lue nulle part. Les vraies sont `FRONTEND_API_KEY` / `ADMIN_API_KEY` (absentes de l'exemple).
- **Port par défaut** : `index.js` fait `process.env.PORT || '3000'` ; tout le reste (compose, Dockerfile, docs, Tunnel) suppose **3003**. Toujours exporter `PORT` en local.
- **Rate limiting derrière le Tunnel** : `app.set('trust proxy', …)` n'est pas configuré. Sans effet pour les clés connues (quota indexé sur `sha256(clé)`), mais le fallback IP voit l'IP réseau Docker → les requêtes non authentifiées partagent un seul bucket.
- **`/next` renvoie 404** quand aucune donnée n'est disponible, alors que le README annonce « 200 + tableau vide ». Les autres endpoints renvoient bien 200 + `count: 0`.
- **`docs/ARCHITECTURE.md` est partiellement périmé** sur les clés de cache (`stop-monitoring:{id}`, `disruptions`, `search:{q}` ≠ code : `IDFM:{id}`, `disruptions_bulk`, `v2:{q}:{n}`) et la signature de `CacheService.set`.

## Déploiement

`docker-compose.yml` ne monte que `./data`, `./json` (ro), `./js/cache`, `./.env` (ro). **Le code
n'est pas monté** → toute modif de `js/` exige un `docker compose up -d --build` (ou un `docker cp`
temporaire). Réseau `heartbeat-net` (externe). Graceful shutdown SIGTERM/SIGINT : arrêt des
nouvelles connexions → fermeture DB GTFS → `exit` (timeout forcé 10 s).

## Règle absolue

**NE JAMAIS AJOUTER `express.static()`** ni servir de HTML/JS/CSS. Toute route est explicite, avec
auth si nécessaire. Le dashboard admin vit ailleurs (Next.js sur `admin.horizn.infostation.fr`).
`robots.txt` / `.htaccess` à la racine sont pour un reverse-proxy externe, pas pour Express.

## Conventions de commit

`type(scope): description` — types : `feat` `fix` `perf` `docs` `chore`. Scopes vus : `auth`, `next`,
`gtfs`, `deps`, `readme`. Voir `.gitmessage`.
