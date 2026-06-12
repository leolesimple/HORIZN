# HORIZN

**API temps réel Île-de-France Mobilités** — prochains passages, perturbations, équipements, horaires GTFS.

Moteur Node.js/Express qui fusionne **PRIM (SIRI)** et **GTFS statique** en une API unique.

---

## 🔥 Quick Start

```bash
docker compose up -d                # Lancement (port 3003)
npm run keys list                   # Gestion des clés API
npm run setup-gtfs                  # Import GTFS (ou cron auto)
```

Toutes les routes nécessitent une clé API dans le header `X-API-Key`.

---

## 📡 Endpoints

### Routes publiques — `X-API-Key: <clé frontend>`

| Endpoint | Description | Paramètre clé | Rate limit |
|----------|-------------|---------------|------------|
| `GET /next` | Prochains passages temps réel GTFS + PRIM | `stopId=DU496` | 60/min |
| `GET /timetable` | Horaires GTFS journée complète | `stopId=DU496&date=2026-06-11` | 100/min |
| `GET /traffic` | Perturbations par ligne/arrêt | `lineRef=C01739` ou `stopId=71135` | 100/min |
| `GET /search` | Recherche d'arrêts par nom | `q=austerlitz` | 20/min |
| `GET /equipments` | Pannes ascenseurs/escalators | `stopId=71135` | 100/min |
| `GET /status` | État des dépendances (GTFS, PRIM, cache) | — | 100/min |

### Routes admin — `X-API-Key: <clé admin>`

| Endpoint | Description | Rate limit |
|----------|-------------|------------|
| `GET /admin/horizn` | Dashboard complet (stats, cache, health) | 30/min |
| `GET /admin/stats` | Métriques du jour | 30/min |
| `GET /admin/logs` | Logs JSON avec filtres | 30/min |
| `GET /admin/cache` | État des fichiers de cache | 30/min |
| `GET /admin/health` | Santé du service | 30/min |

### Sans auth

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check (Docker HEALTHCHECK) |

---

## `GET /next` (alias `/nextTrains`)

Prochains passages temps réel GTFS + PRIM fusionnés.

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID zdaid de l'arrêt (ex: `DU496` pour La Défense) |
| `stopArea` | `string` | =`stopId` | ID stop_area pour traffic/equipments |
| `full` | `bool` | `false` | Si `true`, inclut aussi `traffic` + `equipments` |
| `horizon` | `number` | `5` | Fenêtre en heures (max 12) |
| `includeGTFS` | `bool` | `true` | Ajouter les horaires GTFS statiques |

```bash
curl -H "X-API-Key: hzn_..." "http://localhost:3003/next?stopId=DU496&full=true"
```

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "accessible": true,
  "geopoint": { "lon": 2.238, "lat": 48.892 },
  "horizon": 5,
  "departures": [
    {
      "line": "STIF:Line::C01742:",
      "destination": "Cergy le Haut",
      "quai": "1",
      "times": {
        "scheduled": { "departure": "2026-06-11T14:32:00Z" },
        "realtime": { "departure": null }
      },
      "status": "onTime"
    }
  ],
  "traffic": { "count": 3, "messages": [...] },
  "equipments": { "count": 0, "equipments": [] }
}
```

Cache : 30s par stopId (PRIM StopMonitoring).

---

## `GET /timetable`

Horaires GTFS statiques complets pour une journée entière. Nécessite une base GTFS chargée (`npm run setup-gtfs` ou cron).

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID zdaid |
| `date` | `string` | aujourd'hui | `YYYY-MM-DD` |

---

## `GET /traffic`

Perturbations trafic RATP, SNCF/Transilien, Bus via l'API `disruptions_bulk` d'IDFM.

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `lineRef` | `string` | — | ID technique IDFM (`C01739` = Transilien J) |
| `stopId` | `string` | — | `stop_area:IDFM:X` ou `X` seul |

Les deux peuvent être combinés (intersection). Cache : 90s (fichier, partagé avec `/equipments`).

---

## `GET /search`

Recherche d'arrêts/gares par nom.

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `q` | `string` | **requis** | Texte (min 2 car.) |
| `count` | `int` | `10` | Max 50 |

Cache : 24h (fichier). Les arrêts changent rarement.

---

## `GET /equipments`

Pannes d'ascenseurs et escalators. Même source que `/traffic` (disruptions_bulk).

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | — | `stop_area:IDFM:X` — si absent, toutes les pannes |

Cache : 90s (fichier, partagé avec `/traffic`).

---

## 🔐 Authentification

Deux niveaux de clés API. Gérées via le fichier `data/api_keys.json`.

### Gestion des clés

```bash
npm run keys list                              # Lister
npm run keys generate -- --role frontend --name "infostation prod"  # Créer
npm run keys revoke -- --name "infostation prod"                     # Révoquer
```

### Niveaux d'accès

| Niveau | Accès |
|--------|-------|
| `frontend` | Routes publiques (`/next`, `/traffic`, …) |
| `admin` | Routes admin + publiques |

Les clés définies dans `.env` (`FRONTEND_API_KEY`, `ADMIN_API_KEY`) servent de fallback si `api_keys.json` est absent.

---

## 🛡️ Rate Limiting

| Route | Limite | Blocage |
|-------|--------|---------|
| `/next` | 60 req/min | 30s |
| `/search` | 20 req/min | 60s |
| `/traffic`, `/equipments`, `/timetable`, `/status` | 100 req/min | 30s |
| `/admin/*` | 30 req/min | 60s |
| `/health` | illimité | — |

---

## 🧱 Architecture

### Middleware stack (ordre)

1. `denySensitivePaths` — bloque fichiers sensibles (`.env`, `api_keys.json`, `package.json`, `.*`, `..`)
2. `securityHeaders` — `X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control`, `Referrer-Policy`
3. CORS — restreint à `infostation.fr`, `beta.infostation.fr`
4. Request ID — `X-Request-ID` (généré ou transmis)
5. Logging — JSON lines dans `data/logs/YYYY-MM-DD.jsonl`
6. Rate Limiting — par route
7. Auth — `requireFrontend` / `requireAdmin`

### Services

| Service | Rôle |
|---------|------|
| `DeparturesService` | Fusion GTFS + PRIM StopMonitoring |
| `TrafficService` | disruptions_bulk filtré par ligne/arrêt |
| `EquipmentService` | Pannes équipements (partage le cache Traffic) |
| `SearchService` | Recherche d'arrêts par nom |
| `GTFSService` | Horaires GTFS depuis SQLite |
| `CacheService` | Cache fichier avec TTL |
| `LoggerService` | Logs JSON lines journaliers |
| `AdminService` | Stats, logs, cache, health |

### Déploiement

- **Docker Compose** — conteneur `horizn`, réseau `heartbeat-net`, port `3003`
- **Cloudflare Tunnel** — ingress vers `horizn:3003`
- **HEALTHCHECK** — `GET /health` toutes les 30s
- **Graceful shutdown** — SIGTERM/SIGINT → fin des requêtes → fermeture DB (timeout 10s)

---

## 📦 Volumes Docker

| Hôte | Conteneur | Mode |
|------|-----------|------|
| `./json` | `/app/json` | `ro` |
| `./data` | `/app/data` | `rw` |
| `./js/cache` | `/app/js/cache` | `rw` |
| `./.env` | `/app/.env` | `ro` |

---

## 🗺️ Référence lignes

### Métro
| Ligne | LineRef | Ligne | LineRef |
|-------|---------|-------|---------|
| M1 | `C01361` | M10 | `C01379` |
| M2 | `C01362` | M11 | `C01380` |
| M3 | `C01363` | M12 | `C01381` |
| M4 | `C01374` | M14 | `C01384` |
| M5 | `C01375` | M15 | `C01385` |
| M6 | `C01376` | M16 | `C01386` |
| M7 | `C01377` | M17 | `C01387` |
| M8 | `C01378` | M18 | `C01388` |
| M9 | `C01373` | | |

### RER
| Ligne | LineRef |
|-------|---------|
| RER A | `C01742` |
| RER B | `C01726` |
| RER C | `C01727` |
| RER D | `C01728` |
| RER E | `C01732` |

### Transilien
| Ligne | LineRef | Ligne | LineRef |
|-------|---------|-------|---------|
| H | `C01737` | N | `C01736` |
| J | `C01739` | P | `C01730` |
| K | `C01738` | R | `C01731` |
| L | `C01740` | U | `C01741` |


---

## 🔗 Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Flux de données, diagrammes, détail des services
- [`AGENT.md`](AGENT.md) — Contexte complet pour agents IA (Cursor, Windsurf)
- [`CLAUDE.md`](CLAUDE.md) — Contexte pour Claude Code
- [`CHANGELOG.md`](CHANGELOG.md) — Historique des versions

---

## ⛔ Règles strictes

- **NE PAS** ajouter `express.static()` — HORIZN ne sert aucun fichier statique
- **NE PAS** servir de code frontend (HTML, JS, CSS)
- **NE PAS** commit les clés, tokens, ou `.env`

---

*HORIZN v2.1 — Léo Lesimple*
