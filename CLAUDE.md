# HORIZN — Claude Code Context

API REST Node.js/Express pour les transports Île-de-France (PRIM temps réel + GTFS).

## Stack
- Node.js 20, Express 5, better-sqlite3
- Docker Compose, Cloudflare Tunnel
- Fichier de clés : `data/api_keys.json`

## Commandes fréquentes
```bash
docker compose up -d --build              # Rebuild + déploiement
docker compose up -d horizn               # Démarrage
docker restart horizn                     # Redémarrage
docker exec horizn node js/scripts/keys.js list  # Gestion clés
npm run keys generate -- --role frontend  # Alternative
docker exec horizn node js/scripts/setupGTFS.js   # Import GTFS
```

## Structure du projet
```
/srv/http/horizn/
├── js/
│   ├── index.js              # Entry point + routes
│   ├── middleware/
│   │   ├── auth.js           # API keys + JWT
│   │   ├── rateLimit.js      # Rate limiting par route
│   │   └── security.js       # Fichiers sensibles + headers
│   ├── services/
│   │   ├── LoggerService.js  # Logs JSON lines
│   │   ├── AdminService.js   # Stats, cache, health
│   │   ├── DeparturesService.js
│   │   ├── GTFSService.js
│   │   ├── TrafficService.js
│   │   ├── SearchService.js
│   │   ├── EquipmentService.js
│   │   └── CacheService.js
│   └── scripts/
│       ├── setupGTFS.js      # Import GTFS depuis IDFM
│       └── keys.js           # Gestionnaire de clés API
├── data/                     # Volume persistant (DB, logs, cache, clés)
├── json/                     # Arrêts stop points (RO)
├── Dockerfile
├── docker-compose.yml
├── .env
├── CHANGELOG.md
├── AGENT.md
└── CLAUDE.md
```

## ⛔ INTERDICTION ABSOLUE
**NE JAMAIS AJOUTER `express.static()`** — HORIZN ne sert aucun fichier statique.
Toute route doit être explicite, avec auth si nécessaire. Pas d'exception.

## Architecture middleware
1. denySensitivePaths (fichiers .env, .git, api_keys.json etc.)
2. securityHeaders (nosniff, X-Frame-Options, Cache-Control)
3. CORS (whitelist infostation.fr)
4. Request ID
5. Logging
6. Rate Limiting
7. Auth (requireAdmin / requireFrontend)
8. Route handlers

## Auth
- Deux niveaux : `frontend` (routes publiques) et `admin` (routes admin)
- Les clés sont dans `data/api_keys.json` OU dans `.env` (fallback)
- Le middleware auth recharge le fichier à chaud (stat check)

## Conventions commit
```
feat(auth): ajout API keys
fix(next): timeout PRIM
perf(gtfs): import 10x plus rapide
docs(readme): endpoints
chore(deps): update express
```

## Déploiement
Les modifications locales sont copiées dans le conteneur via `docker cp` tant que le volume `./js/scripts` n'est pas monté. Privilégier un rebuild de l'image pour la prod.
