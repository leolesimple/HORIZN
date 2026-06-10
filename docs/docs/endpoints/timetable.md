---
sidebar_position: 4
---

# `/timetable` — Horaires GTFS

Retourne tous les horaires GTFS statiques d'une journée entière pour un arrêt donné.

Nécessite d'avoir chargé les données GTFS au préalable :

```bash
npm run setup-gtfs
```

## Paramètres

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | **requis** | ID d'arrêt (zdaid, ex: `DU496`) |
| `date` | `string` | aujourd'hui | Format `YYYY-MM-DD` |

## Exemple

```bash
curl "http://localhost:3000/timetable?stopId=DU496"
curl "http://localhost:3000/timetable?stopId=DU496&date=2026-06-15"
```

## Réponse

```json
{
  "stopId": "DU496",
  "stopName": "La Défense (Grande Arche)",
  "date": "2026-06-10",
  "count": 342,
  "departures": [
    {
      "departure": "14:35:00",
      "arrival": "15:05:00",
      "line": "A",
      "direction": "Cergy le Haut",
      "tripId": "A-12345",
      "routeType": 1,
      "routeColor": "#E2031B"
    }
  ]
}
```

## Notes

- Les données GTFS sont statiques (horaires théoriques). Pour les horaires temps réel,
utilisez [`/next`](next).
- Les données sont chargées en mémoire au démarrage. Sans GTFS, l'endpoint retourne `503`.
