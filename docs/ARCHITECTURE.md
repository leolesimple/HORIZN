# HORIZN — Architecture & Flux

## Arborescence

```
HORIZN/
├── js/
│   ├── index.js                  ← Point d'entrée Express, routes
│   ├── constants.js              ← Énumérations (status, etc.)
│   ├── services/
│   │   ├── DeparturesService.js  ← Fusion GTFS + PRIM StopMonitoring
│   │   ├── TrafficService.js     ← disruptions_bulk → filtré par lineRef/stopId
│   │   ├── EquipmentService.js   ← disruptions_bulk → filtres équipements
│   │   ├── SearchService.js      ← Navitia places API
│   │   ├── GTFSService.js        ← SQLite GTFS statique
│   │   └── CacheService.js       ← Cache mémoire générique
│   └── json/                     ← Données statiques (18 Mo .gitignoré)
├── json/
│   └── arrets-stopPoint.json     ← Référentiel des arrêts (hors git)
├── docs/
│   ├── GEO.md                    ← Référence géographique
│   └── ARCHITECTURE.md           ← Ce fichier
├── .env.example
├── .gitignore
├── package.json
└── readme.md
```

## Flux de données

```
Client (Infostation, LLM, curl)
    │
    ▼
┌─────────────────────┐
│  index.js (Express) │
│  - CORS/origin      │
│  - Routes           │
└──┬──────┬──────┬────┘
   │      │      │
   ▼      ▼      ▼
┌──────┐ ┌────┐ ┌───────┐
│Next  │ │Traffic│ │Search │
│Svc   │ │Svc   │ │Svc    │
└──┬───┘ └──┬──┘ └───┬───┘
   │       │        │
   ▼       ▼        ▼
┌─────────────────────────┐
│   PRIM API (IDFM)       │
│ marketplace/            │
│  ├ stop-monitoring      │
│  ├ disruptions_bulk/... │
│  └ v2/navitia/places    │
└─────────────────────────┘
```

## Cache partagé

Le `TrafficService` et `EquipmentService` partagent le **même cache** de disruptions_bulk.
Quand `/next?full=true` appelle les deux, le second reçoit le cache déjà chaud.

## Gestion d'erreurs

- Erreurs PRIM → `502` avec `detail` contenant le message PRIM
- Arrêt inconnu → `404`
- Paramètre manquant → `400`
- Origine non autorisée → `403`
