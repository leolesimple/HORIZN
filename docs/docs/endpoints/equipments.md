---
sidebar_position: 7
---

# `/equipments` — Pannes d'équipements

Retourne les pannes d'équipements (ascenseurs, escalators, escaliers mécaniques)
dans les gares et stations du réseau.

Les données sont extraites de l'API disruptions_bulk d'IDFM, filtrées par mots-clés
(ascenseur, escalator, etc.).

## Paramètres

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `stopId` | `string` | - | Filtrer par arrêt (ex: `71135` ou `stop_area:IDFM:71135`) |

## Exemples

```bash
# Toutes les pannes du réseau
curl "http://localhost:3000/equipments"

# Pannes à Gare d'Austerlitz
curl "http://localhost:3000/equipments?stopId=71135"
```

## Réponse

```json
{
  "stopId": "71135",
  "count": 3,
  "equipments": [
    {
      "id": "0b107008-b96b-11f0-aa41-0a58a9feac02",
      "title": "Panne d'un ascenseur GARE DE MANTES LA JOLIE",
      "message": "Panne de l'ascenseur situé Passerelle <> Quais E/F...",
      "cause": "PERTURBATION",
      "severity": "INFORMATION",
      "lastUpdate": "20251104T114256",
      "applicationPeriods": [
        { "begin": "20251104T114256", "end": "20261104T114256" }
      ],
      "impactedSections": []
    }
  ]
}
```

## Cache

Partagé avec l'endpoint [`/traffic`](traffic) — TTL 5 minutes.
