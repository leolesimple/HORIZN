# HORIZN

API temps réel et trafic pour les transports Île-de-France : prochains passages, perturbations, équipements, et horaires GTFS.

## Stack

- **Node.js 20+** / Express
- **PRIM** (Plateforme Régionale d'Information pour la Mobilité) — données temps réel
- **Navitia** — calculateur d'itinéraires et recherche
- **GTFS** — horaires statiques (optionnel, `npm run setup-gtfs`)

## Prérequis

```bash
npm install
cp .env.example .env   # configurer PRIM_API_KEY, STOPS_MAP_PATH
```

| Variable | Description |
|----------|-------------|
| `PRIM_API_KEY` | Clé API PRIM (https://prim.iledefrance-mobilites.fr) |
| `STOPS_MAP_PATH` | Chemin vers `arrets-stopPoint.json` (18 Mo, pas dans le repo) |
| `PORT` | Port d'écoute (défaut: 3000) |
| `QUIET_MODE` | `true` pour masquer l'ASCII art au démarrage |

```bash
npm start          # ou : node js/index.js
```

---

## Endpoints

### `GET /next` (alias: `/nextTrains`)

Prochains passages temps réel (PRIM StopMonitoring + GTFS) pour un arrêt.

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID d'arrêt (zdaid, ex: `DU496` pour La Défense) |
| `full` | `bool` | `false` | Si `true`, inclut aussi `traffic` + `equipments` |
| `stopArea` | `string` | `stopId` | ID stop_area pour trafic/équipements si différent (ex: `71135`) |
| `horizon` | `number` | `5` | Fenêtre de recherche en heures (max 12) |
| `includeGTFS` | `bool` | `true` | Inclure les horaires GTFS statiques |

```bash
curl "http://localhost:3000/next?stopId=DU496&full=true&stopArea=71135"
```

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "accessible": true,
  "geopoint": { "lon": 2.238, "lat": 48.891 },
  "horizon": 5,
  "departures": [
    {
      "line": "STIF:Line::C01742:",
      "direction": "STIF:Direction::C01742-1:",
      "destination": "Cergy le Haut",
      "mission": "",
      "trainNum": "MAAA",
      "quai": "1",
      "times": {
        "scheduled": { "arrival": null, "departure": "2026-06-10T14:32:00Z" },
        "realtime": { "arrival": null, "departure": null }
      },
      "aQuai": false,
      "status": "onTime"
    }
  ],
  "traffic": {
    "count": 3,
    "messages": [
      { "id": "...", "title": "RER A : travaux", "cause": "TRAVAUX", "severity": "PERTURBEE", ... }
    ]
  },
  "equipments": {
    "count": 0,
    "equipments": []
  }
}
```

Cache : 60 secondes par stopId (PRIM StopMonitoring). Les disruptions sont mises en cache 5 minutes.

---

### `GET /timetable`

Horaires GTFS statiques d'une journée entière pour un arrêt. Nécessite `npm run setup-gtfs` au préalable.

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID d'arrêt (zdaid) |
| `date` | `string` | aujourd'hui | Format `YYYY-MM-DD` |

```bash
curl "http://localhost:3000/timetable?stopId=DU496"
```

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "date": "2026-06-10",
  "count": 342,
  "departures": [
    { "departure": "14:35:00", "line": "A", "direction": "Cergy le Haut", "routeColor": "#E2031B" }
  ]
}
```

Cache : pas de cache (données GTFS locales).

---

### `GET /traffic`

Perturbations trafic pour une ligne et/ou un arrêt. Couvre **RATP + SNCF/Transilien + Bus**.

Utilise l'API `disruptions_bulk` d'IDFM, pas le GeneralMessage SIRI (qui ne couvre que le RATP).

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `lineRef` | `string` | - | ID technique IDFM (ex: `C01739` pour Transilien J) |
| `stopId` | `string` | - | ID stop_area (ex: `71135` ou `stop_area:IDFM:71135`) |

Si les deux sont fournis : intersection (perturbations sur cette ligne ET cet arrêt).

```bash
curl "http://localhost:3000/traffic?lineRef=C01739"
curl "http://localhost:3000/traffic?stopId=71135"
curl "http://localhost:3000/traffic?lineRef=C01739&stopId=71135"
```

```json
{
  "lineRef": "C01739",
  "stopId": null,
  "count": 12,
  "messages": [
    {
      "id": "3664a2ce-...",
      "title": "Ligne J : mouvement social national le mercredi 10 juin",
      "message": "Trafic fortement perturbé le mercredi 10 juin sur la ligne J...",
      "cause": "PERTURBATION",
      "severity": "PERTURBEE",
      "lastUpdate": "20260609T180000",
      "applicationPeriods": [
        { "begin": "20260610T030000", "end": "20260611T025000" }
      ],
      "impactedSections": [
        { "lineId": "line:IDFM:C01739", "fromName": "Gare Saint-Lazare (Paris)", "toName": "Mantes-la-Jolie (Mantes-la-Jolie)" }
      ]
    }
  ]
}
```

Cache : 5 minutes (disruptions_bulk ~1.5 Mo, mis en cache en mémoire).

---

### `GET /search`

Recherche d'arrêts/gares par nom via Navitia.

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `q` | `string` | **requis** | Texte de recherche (min 2 car.) |
| `count` | `number` | `10` | Max résultats (max 50) |

```bash
curl "http://localhost:3000/search?q=austerlitz"
```

```json
{
  "query": "austerlitz",
  "count": 3,
  "results": [
    {
      "id": "stop_area:IDFM:71135",
      "name": "Gare d'Austerlitz (Paris)",
      "stopArea": {
        "id": "stop_area:IDFM:71135",
        "name": "Gare d'Austerlitz",
        "label": "Gare d'Austerlitz (Paris)",
        "city": "Paris",
        "coord": { "lat": 48.846, "lon": 2.366 }
      }
    }
  ]
}
```

Pas de cache (appel Navitia à chaque requête).

---

### `GET /equipments`

Pannes d'équipements (ascenseurs, escalators) dans le réseau.

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | - | Filtrer par arrêt (ex: `71135` ou `stop_area:IDFM:71135`) |

```bash
curl "http://localhost:3000/equipments?stopId=71135"
```

```json
{
  "stopId": "71135",
  "count": 2,
  "equipments": [
    {
      "id": "...",
      "title": "Panne d'un ascenseur GARE DES MUREAUX",
      "cause": "PERTURBATION",
      "severity": "INFORMATION",
      "applicationPeriods": [
        { "begin": "20251104T114256", "end": "20261104T114256" }
      ]
    }
  ]
}
```

Cache : partagé avec `/traffic` (5 minutes).

---

## IDs utiles

### Lignes
| Ligne | Code technique |
|-------|---------------|
| Métro 1 | `C01371` |
| Métro 4 | `C01374` |
| Métro 14 | `C01384` |
| RER A | `C01742` |
| RER C | `C01727` |
| RER D | `C01728` |
| Transilien H | `C01737` |
| Transilien J | `C01739` |
| Transilien K | `C01738` |
| Transilien L | `C01740` |
| Transilien N | `C01736` |
| Transilien P | `C01730` |
| Transilien R | `C01731` |
| Transilien U | `C01741` |

### Arrêts
Utilisez `/search?q=nom` pour trouver le stopArea ID d'un arrêt.

---

## Sources de données

| Source | Endpoint | Usage |
|--------|----------|-------|
| PRIM StopMonitoring | `/marketplace/stop-monitoring` | Temps réel /next |
| PRIM disruptions_bulk | `/marketplace/disruptions_bulk/disruptions/v2` | Trafic + équipements |
| Navitia (via PRIM) | `/marketplace/v2/navitia/places` | Recherche /search |
| IDFM Open Data | `data.iledefrance-mobilites.fr` | Référentiel lignes + arrêts |
| GTFS local | `npm run setup-gtfs` | Horaires statiques /timetable |
