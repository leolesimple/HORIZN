---
sidebar_position: 5
---

# `/traffic` — Perturbations

Retourne les informations trafic (travaux, incidents, grèves) pour une ligne et/ou un arrêt.

Couvre **tous les opérateurs** : RATP, SNCF/Transilien, Bus — contrairement à l'API
SIRI GeneralMessage qui ne couvre que le RATP.

## Source

Utilise l'API **disruptions_bulk** d'Île-de-France Mobilités
(`/marketplace/disruptions_bulk/disruptions/v2`),
qui agrège l'intégralité des données de toutes les sources.

## Paramètres

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `lineRef` | `string` | - | ID technique IDFM (ex: `C01739` pour Transilien J) |
| `stopId` | `string` | - | ID stop_area (ex: `71135` ou `stop_area:IDFM:71135`) |

Si **les deux** sont fournis, l'intersection est calculée : uniquement les perturbations
de cette ligne **et** concernant cet arrêt.

## Exemples

```bash
# Par ligne
curl "http://localhost:3000/traffic?lineRef=C01739"

# Par arrêt (toutes lignes confondues)
curl "http://localhost:3000/traffic?stopId=71135"

# Intersection ligne + arrêt
curl "http://localhost:3000/traffic?lineRef=C01739&stopId=71135"
```

## Réponse

```json
{
  "lineRef": "C01739",
  "stopId": null,
  "count": 12,
  "messages": [
    {
      "id": "8e0cbe0d-a646-4aff-bc24-0ff11ab1deea",
      "title": "Ligne J : Paris St-Lazare <> Mantes via Poissy du 08/06 au 10/07",
      "message": "Une limitation de vitesse dans la zone de Maisons-Laffitte...",
      "shortMessage": null,
      "cause": "TRAVAUX",
      "severity": "PERTURBEE",
      "lastUpdate": "20260609T093811",
      "tags": [],
      "applicationPeriods": [
        { "begin": "20260608T030000", "end": "20260609T030000" },
        { "begin": "20260609T030000", "end": "20260610T030000" }
      ],
      "impactedSections": [
        {
          "lineId": "line:IDFM:C01739",
          "fromId": "stop_area:IDFM:71135",
          "fromName": "Gare Saint-Lazare (Paris)",
          "toId": "stop_area:IDFM:472048",
          "toName": "Mantes-la-Jolie (Mantes-la-Jolie)"
        }
      ]
    }
  ]
}
```

## Sévérités

| Valeur | Signification |
|--------|---------------|
| `BLOQUANTE` | Trafic interrompu, bus de remplacement |
| `PERTURBEE` | Ralentissements, trains supprimés partiellement |
| `INFORMATION` | Info générale (travaux prévus, changements d'arrêts) |

## Cache

Les données sont mises en cache en mémoire pendant 5 minutes (le fichier JSON fait
~1.5 Mo). Les disruptions étant des événements longs (travaux, grèves), ce TTL est
suffisant.

## IDs de lignes

| Ligne | Code |
|-------|------|
| Transilien J | `C01739` |
| RER A | `C01742` |
| RER C | `C01727` |

Voir la [référence complète](../reference/lines) pour plus de codes.
