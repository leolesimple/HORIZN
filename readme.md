# HORIZN

**API temps réel Île-de-France Mobilités** — prochains passages, perturbations, équipements.

Une API Node.js/Express qui consolide **PRIM (SIRI + Navitia)**, **GTFS statique** et le fichier **référentiel des arrêts** en une interface unique, géo-intelligente.

---

## 📡 Tableau de bord rapide

| Endpoint | Description | Paramètre clé | Cache |
|----------|-------------|--------------|-------|
| `GET /next` | Prochains passages temps réel | `stopId=DU496` | 60s |
| `GET /nextTrains` | Alias de `/next` | `stopId=DU496` | 60s |
| `GET /timetable` | Horaires GTFS complets journée | `stopId=DU496&date=2026-06-10` | fichier |
| `GET /traffic` | Perturbations par ligne/arrêt | `lineRef=C01739` ou `stopId=71135` | 5 min |
| `GET /search` | Recherche d'arrêts par nom | `q=austerlitz` | aucun |
| `GET /equipments` | Pannes d'ascenseurs/escalators | `stopId=71135` | 5 min |

**Modes combinés :** `/next?stopId=DU496&full=true` → départs **+** perturbations **+** équipements en 1 appel.

---

## 🔥 Quick Start

```bash
npm install
cp .env.example .env   # configure PRIM_API_KEY
npm run setup-gtfs      # optionnel: hors-ligne GTFS
node js/index.js
```

```
GET http://localhost:3000/next?stopId=DU496
GET http://localhost:3000/next?stopId=DU496&full=true
GET http://localhost:3000/search?q=austerlitz
GET http://localhost:3000/traffic?lineRef=C01739
GET http://localhost:3000/equipments?stopId=71135
```

---

## 📡 Endpoints

### `GET /next` | `GET /nextTrains`

Prochains passages temps réel (PRIM StopMonitoring) + horaires GTFS fusionnés.

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID zdaid de l'arrêt (ex: `DU496` pour La Défense) |
| `stopArea` | `string` | =`stopId` | ID `stop_area:IDFM:X` pour les sections traffic/equipments |
| `full` | `bool` | `false` | Si `true`, inclut `traffic` + `equipments` |
| `horizon` | `number` | `5` | Fenêtre en heures (max `12`) |
| `includeGTFS` | `bool` | `true` | Ajouter les horaires GTFS statiques |

**Exemple :**

```bash
curl "http://localhost:3000/next?stopId=DU496&full=true&horizon=2"
```

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "geopoint": { "lon": 2.238, "lat": 48.892 },
  "horizon": 2,
  "departures": [
    {
      "line": "STIF:Line::C01739:",
      "destination": "Mantes-la-Jolie",
      "quai": "Voie L",
      "times": {
        "scheduled": { "departure": "2026-06-10T14:12:00+02:00" },
        "realtime":  { "departure": "2026-06-10T14:12:00+02:00" }
      },
      "status": "onTime"
    }
  ],
  "traffic": {
    "count": 2,
    "messages": [...]
  },
  "equipments": {
    "count": 0,
    "equipments": []
  }
}
```

**Champs `departures[].status` :**

| Valeur | Signification |
|--------|---------------|
| `onTime` | À l'heure |
| `delayed` | Retard |
| `cancelled` | Supprimé |
| `departed` | Parti |
| `arrived` | Arrivé |
| `noData` | Statut inconnu |

---

### `GET /timetable`

Horaires GTFS statiques complets pour une journée entière.

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID zdaid de l'arrêt |
| `date` | `string` | aujourd'hui | Format `YYYY-MM-DD` |

```bash
curl "http://localhost:3000/timetable?stopId=DU496&date=2026-06-10"
```

---

### `GET /traffic`

Perturbations trafic par ligne et/ou par arrêt.

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `lineRef` | `string` | — | ID technique IDFM (`C01739`, `C01371`) |
| `stopId` | `string` | — | `stop_area:IDFM:X` ou `X` seul |

**Combinaisons :**

| Requête | Résultat |
|---------|----------|
| `?lineRef=C01739` | Perturbations du Transilien J |
| `?stopId=71135` | Toutes les perturbations à Gare d'Austerlitz |
| `?lineRef=C01739&stopId=71135` | Intersection : J **et** Austerlitz |

```bash
curl "http://localhost:3000/traffic?lineRef=C01739"
```

```json
{
  "lineRef": "C01739",
  "count": 12,
  "messages": [
    {
      "id": "3664a2ce-...",
      "title": "Ligne J : mouvement social national le mercredi 10 juin",
      "cause": "PERTURBATION",
      "severity": "PERTURBEE",
      "applicationPeriods": [
        { "begin": "20260610T030000", "end": "20260611T025000" }
      ],
      "impactedSections": [
        {
          "lineId": "line:IDFM:C01739",
          "fromName": "Gare Saint-Lazare (Paris)",
          "toName": "Poissy (Poissy)"
        }
      ]
    }
  ]
}
```

**Valeurs `severity` :** `BLOQUANTE`, `PERTURBEE`, `INFORMATION`

**Valeurs `cause` :** `TRAVAUX`, `PERTURBATION`, `INFORMATION`

---

### `GET /search`

Recherche d'arrêts/gares par nom (via Navitia places).

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `q` | `string` | **requis** | Texte (min 2 car.) |
| `count` | `int` | `10` | Max résultats (max `50`) |

```bash
curl "http://localhost:3000/search?q=austerlitz&count=3"
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
        "name": "Gare d'Austerlitz",
        "label": "Gare d'Austerlitz (Paris)",
        "city": "Paris",
        "coord": { "lon": 2.365, "lat": 48.843 }
      }
    }
  ]
}
```

**Parcours type IA :** `search → next` ou `search → traffic`

```
/search?q=austerlitz  →  stop_area:IDFM:71135  →  /traffic?stopId=71135
                                                    /next?stopId=DU496&full=true
```

---

### `GET /equipments`

Pannes d'équipements (ascenseurs, escalators) filtrées depuis disruptions_bulk.

**Paramètres :**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `stopId` | `string` | — | Optionnel : `stop_area:IDFM:X` |

```bash
curl "http://localhost:3000/equipments?stopId=71135"
```

---

## 🗺️ Géo-référencement (GEO)

### Identifiants de transport — résumé

Chaque entité du réseau IDFM possède plusieurs IDs selon le contexte :

| Entité | Format | Exemple | Usage API |
|--------|--------|---------|-----------|
| **Ligne** | `C0XXXX` (court) / `line:IDFM:C0XXXX` (Navitia) | `C01739` = Transilien J | `/traffic?lineRef=C01739` |
| **Arrêt (zdaid)** | `DUXXX` (5-6 car. alphanum) | `DU496` = La Défense | `/next?stopId=DU496` |
| **Arrêt (stop_area)** | `stop_area:IDFM:XXXXX` ou `XXXXX` seul | `71135` = Gare d'Austerlitz | `/traffic?stopId=71135` |
| **Coordonnées** | WGS84 (lon, lat) ou EPSG:2154 (X, Y) | `2.238, 48.892` | Retourné dans les réponses |

### Sources des données

| Source | Coverage | Endpoint | Cache | Taille typique |
|--------|----------|----------|-------|----------------|
| **PRIM StopMonitoring** | Temps réel toutes lignes | `/marketplace/stop-monitoring` | 60s | 5-50 Ko |
| **PRIM disruptions_bulk** | Toutes perturbations RATP+SNCF+bus | `/marketplace/disruptions_bulk/disruptions/v2` | 5 min | ~1.5 Mo (919 entrées) |
| **Navitia places** | Recherche d'arrêts | `/marketplace/v2/navitia/places` | — | — |
| **GTFS statique** | Horaires théoriques hors-ligne | Fichier local SQLite | fichier | dépend du dataset |
| **Référentiel arrêts** | Infos géo (nom, ville, coords) | `arrets-stopPoint.json` | fichier | ~18 Mo (30 000 arrêts) |

### Référence complète

Voir [`docs/GEO.md`](docs/GEO.md) pour :
- **Table complète des lignes** (Métro, RER, Tramway, Transilien)
- **Schéma détaillé du fichier arrêts** (30 champs documentés)
- **Systèmes de coordonnées** (WGS84 ↔ Lambert 93 avec code de conversion)
- **Zones tarifaires Navigo** (1-5)
- **Mapping zdaid ↔ stop_area:IDFM**
- **Prompt template prêt à copier pour LLM**

---

## 🤖 Guide Agent IA

HORIZN est conçu **pour les LLM** — réponses auto-suffisantes, identifiants chaînables, cache transparent.

### Principes de design

| Principe | Pourquoi |
|----------|----------|
| **Réponses auto-suffisantes** | Chaque réponse contient les infos nécessaires sans contexte externe |
| **Identifiants croisés** | `stop_area:IDFM:X` est réutilisé entre `/search`, `/traffic` et `/equipments` |
| **Chaînage direct** | Les IDs de `/search` s'injectent directement dans `/traffic` et `/equipments` |
| **Cache documenté** | TTL connu pour décider quand rafraîchir |
| **Dates ISO** | `YYYY-MM-DD` (GTFS) / `YYYYMMDDThhmmss` (SIRI) |
| **403 clair** | Origine non autorisée → message explicite, pas un vague 403 |

### Parcours types

```mermaid
graph TD
    A["🧑 Agent: recherche arrêt"] --> B[/search?q=]
    B --> C{Type d'ID}
    C -->|stop_area| D[/traffic?stopId=]
    C -->|stop_area| E[/equipments?stopId=]
    C -->|zdaid| F[/next?stopId=]
    F -->|full=true| D
    F -->|full=true| E
    
    G["🧑 Agent: infos ligne"] --> H[/traffic?lineRef=]
    I["🧑 Agent: horaires"] --> J[/timetable?stopId=]
    K["🧑 Agent: tout-en-un"] --> L[/next?stopId=&full=true]
```

### Prompt template pour intégration LLM

```markdown
## Instructions agent transport IDF

Tu as accès à l'API HORIZN sur {base_url}.

### Résolution d'arrêt
1. Si l'utilisateur donne un **nom d'arrêt**, appelle `/search?q={nom}`
2. Extrais `stop_area:IDFM:X` de la réponse pour les appels suivants
3. Cherche le `zdaid` via le fichier de référence pour les départs

### Ordre des appels recommandé
Pour une question comme « Y a-t-il des perturbations à Austerlitz ? » :
1. `/search?q=austerlitz` → obtient `stop_area:IDFM:71135`
2. `/traffic?stopId=71135` → perturbations
3. `/equipments?stopId=71135` → pannes équipements

Pour une question comme « Quand part le prochain train à La Défense ? » :
1. `/next?stopId=DU496&full=true&horizon=2`
   → départs + perturbations + équipements en un seul appel

### Anti-patterns à éviter
- ❌ Ne pas appeler `/traffic` sans `lineRef` ni `stopId` (400)
- ❌ Ne pas utiliser `stop_area:IDFM:X` dans `/next` (utilise zdaid)
- ❌ Ne pas appeler `/next` avec `full=false` si tu as aussi besoin de traffic/equipments
- ❌ Ne pas rafraîchir `/traffic` plus d'une fois toutes les 5 minutes (cache)

### Format des dates
- Les dates GTFS sont en `HH:MM:SS` (heure de la journée)
- Les dates PRIM en `YYYYMMDDThhmmss` (ISO sans séparateurs)
- Le paramètre `date` de `/timetable` attend `YYYY-MM-DD`
```

### Exemples de questions utilisateur → appels API

| Question utilisateur | Appel(s) API |
|---------------------|--------------|
| « Y a des problèmes sur le RER A ? » | `/traffic?lineRef=C01742` |
| « Le métro 4 marche bien ? » | `/traffic?lineRef=C01374` |
| « Des perturbations à Austerlitz ? » | `/search?q=austerlitz` → `/traffic?stopId=71135` |
| « Prochain train à Saint-Lazare ? » | `/next?stopId=DU487&full=true&horizon=2` |
| « Les horaires du Transilien J à Poissy demain ? » | `/timetable?stopId=DU870&date=2026-06-11` |
| « Ascenseurs en panne à Montparnasse ? » | `/search?q=montparnasse` → `/equipments?stopId=8733803` |

### Structure complète de l'architecture

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour :
- **Diagrammes de flux** détaillés (séquence, composants)
- **Détail de chaque service** avec son algorithme
- **Référence technique des endpoints** (status codes, headers)
- **Sécurité et CORS**
- **Déploiement et monitoring**

---

## 🚀 Déploiement

```bash
# Variables d'environnement
export PRIM_API_KEY="votre-clé"
export STOPS_MAP_PATH="/srv/http/horizn/json/arrets-stopPoint.json"
export PORT=3000
export QUIET_MODE=true

# Démarrage
node js/index.js
```

**Proxy inverse (Apache / Nginx) :**

```apache
ProxyPass /horizn/ http://127.0.0.1:3000/
ProxyPassReverse /horizn/ http://127.0.0.1:3000/
```

---

## 🔐 Authentification

Tous les endpoints nécessitent une clé API PRIM valide, configurée via :

```env
PRIM_API_KEY="SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ"
```

La clé est injectée côté serveur — les clients n'ont pas besoin de clé.

**Restriction d'origine :** seuls `infostation.fr` et `beta.infostation.fr` sont autorisés (modifiable dans `index.js`).

---

## ⚙️ Build & Release

```bash
git clone https://github.com/leolesimple/HORIZN.git
cd HORIZN
npm install
# GTFS optionnel
npm run setup-gtfs
```

**Dépendances :** `express`, `axios`, `dotenv`, `better-sqlite3` (pour GTFS)

---

## 📦 Cache

| Niveau | Durée | Stockage | Clear |
|--------|-------|----------|-------|
| StopMonitoring | 60s | Mémoire | Automatique |
| disruptions_bulk | 5 min | Mémoire | Automatique |
| GTFS SQLite | fichier | Disque | `npm run setup-gtfs` |

---

## 📄 Licence

Projet privé — Léo Lesimple
