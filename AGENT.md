# HORIZN

Moteur d'API REST pour InfoStation — fusion PRIM temps réel + GTFS Île-de-France.

## Stack
- Node.js 20+, Express 5, better-sqlite3
- Docker + Docker Compose + Cloudflare Tunnel
- Port 3003, réseau `heartbeat-net`

## Démarrage
```bash
docker compose up -d        # Prod
npm run dev                  # Dev (nodemon)
```

## Endpoints

### Routes publiques (nécessite `X-API-Key: <frontend_key>`)
| Path | Description |
|------|-------------|
| `GET /next?stopId=DU496` | Prochains départs GTFS + PRIM |
| `GET /timetable?stopId=DU496` | Horaires GTFS journée complète |
| `GET /traffic?lineRef=C01739` | Perturbations trafic |
| `GET /search?q=austerlitz` | Recherche d'arrêts |
| `GET /equipments?stopId=71135` | Pannes ascenseurs/escalators |
| `GET /status` | État des dépendances |

### Routes admin (nécessite `X-API-Key: <admin_key>`)
| Path | Description |
|------|-------------|
| `GET /admin/horizn` | Dashboard complet |
| `GET /admin/stats` | Métriques du jour |
| `GET /admin/logs` | Logs avec filtres |
| `GET /admin/cache` | État des caches |
| `GET /admin/health` | Santé du service |

### Sans auth
| Path | Description |
|------|-------------|
| `GET /health` | Liveness check (Docker HEALTHCHECK) |

## Gestion des clés
```bash
npm run keys list                                           # Lister
npm run keys generate -- --role frontend --name "ma clé"    # Créer
npm run keys revoke -- --name "ma clé"                      # Révoquer
```

Les clés sont stockées dans `data/api_keys.json`.

## GTFS
```bash
npm run setup-gtfs       # Importer les données GTFS depuis IDFM
```
Les run cron : 08:05, 13:05, 17:05. Skip si hash ZIP identique. Swap atomique de la DB (`*.tmp` + `rename`).

## ⛔ RÈGLES STRICTES — À NE JAMAIS FAIRE

- **NE PAS** ajouter `express.static()`. HORIZN ne sert aucun fichier statique. Aucun. Jamais.
  Si un fichier doit être accessible, passe par une route Express explicite avec auth.
- **NE PAS** servir de code frontend (HTML, JS, CSS). Ce projet est backend-only.
- **NE PAS** commit les clés, tokens, ou `.env`.
- **NE PAS** modifier les volumes Docker sans vérifier la sécurité des fichiers exposés.

## Middleware stack (ordre)
1. `denySensitivePaths` — blocage fichiers sensibles
2. `securityHeaders` — headers de sécurité
3. CORS — restriction d'origine
4. Request ID — `X-Request-ID`
5. Logging — logs JSON lines
6. Auth + Rate limiting — par route
7. Route handlers

## Fichiers sensibles protégés
- `api_keys.json`, `.env`, `package.json`, `*.json` à la racine
- Tout fichier commençant par `.`
- Path traversal (`..`)

## Auth levels
- `frontend` → routes publiques
- `admin` → routes admin + publiques

## Volume mounts
| Hôte | Conteneur |
|------|-----------|
| `./json` | `/app/json:ro` |
| `./data` | `/app/data` |
| `./js/cache` | `/app/js/cache` |
| `./.env` | `/app/.env:ro` |

Ces volumes sont les SEULS points d'entrée aux fichiers — ils ne passent pas par Express.

## Variables d'env (`.env`)
- `PRIM_API_KEY` — obligatoire
- `PORT` — défaut 3003
- `FRONTEND_API_KEY` — fallback si `api_keys.json` absent
- `ADMIN_API_KEY` — fallback si `api_keys.json` absent
- `JWT_SECRET` — optionnel
- `QUIET_MODE` — booléen
