---
sidebar_position: 6
---

# `/search` — Recherche d'arrêts

Recherche des arrêts, gares et stations par nom via l'API Navitia.

Utile pour trouver les IDs d'arrêts à utiliser avec les autres endpoints.

## Paramètres

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `q` | `string` | **requis** | Texte de recherche (min 2 caractères) |
| `count` | `number` | `10` | Nombre maximum de résultats (max 50) |

## Exemple

```bash
curl "http://localhost:3000/search?q=austerlitz"
curl "http://localhost:3000/search?q=la+defense&count=5"
```

## Réponse

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
        "coord": {
          "lat": 48.846,
          "lon": 2.366
        }
      },
      "quality": 100
    }
  ]
}
```

Les IDs retournés dans `results[].id` peuvent être utilisés directement comme
paramètre `stopId` dans [`/traffic`](../endpoints/traffic) et
[`/equipments`](../endpoints/equipments).
