---
sidebar_position: 2
---

# `/next` — Prochains passages

Retourne les prochains départs en temps réel pour un arrêt, avec option d'inclure les
perturbations trafic et les pannes d'équipements.

Utilise l'API PRIM **StopMonitoring** fusionnée avec les horaires **GTFS** statiques.

## Paramètres

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID d'arrêt (zdaid, ex: `DU496` pour La Défense) |
| `full` | `bool` | `false` | Si `true`, inclut `traffic` + `equipments` dans la réponse |
| `stopArea` | `string` | `stopId` | ID stop_area pour les données trafic/équipements si différent |
| `horizon` | `number` | `5` | Fenêtre de recherche en heures (max 12) |
| `includeGTFS` | `bool` | `true` | Inclure les horaires GTFS statiques |

## Exemples

```bash
# Départs uniquement
curl "http://localhost:3000/next?stopId=DU496"

# Tout-en-un : départs + trafic + équipements
curl "http://localhost:3000/next?stopId=DU496&stopArea=71135&full=true"
```

## Réponse

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "accessible": true,
  "geopoint": {
    "lon": 2.238,
    "lat": 48.891
  },
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
        "scheduled": {
          "arrival": null,
          "departure": "2026-06-10T14:32:00Z"
        },
        "realtime": {
          "arrival": null,
          "departure": null
        }
      },
      "aQuai": false,
      "status": "onTime"
    }
  ]
}
```

Avec `full=true`, la réponse inclut en plus les champs `traffic` et `equipments`
(voir les endpoints dédiés pour leur format).

## Cache

Les données PRIM StopMonitoring sont mises en cache 60 secondes par stopId.
Les données trafic/équipements sont partagées avec les autres endpoints (TTL 5 minutes).

## Erreurs

| Code | Cause |
|------|-------|
| `400` | Paramètre `stopId` manquant |
| `404` | Aucune donnée disponible pour cet arrêt |
| `500` | Erreur interne ou timeout PRIM |
