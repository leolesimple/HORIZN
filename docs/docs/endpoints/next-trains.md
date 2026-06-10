---
sidebar_position: 3
---

# `/nextTrains` — Alias

Alias pour [`/next`](next). Accepte les mêmes paramètres et retourne les mêmes données.

## Utilité

Préserve la rétrocompatibilité avec les clients existants qui utilisent l'ancien endpoint du legacy isa-api.

## Exemple

```bash
curl "http://localhost:3000/nextTrains?stopId=DU496"
```

Même format de réponse que `/next`.
