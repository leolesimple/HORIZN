---
sidebar_position: 1
---

# HORIZN

**API temps réel et trafic pour les transports Île-de-France.**

HORIZN est un proxy Node.js/Express qui agrège plusieurs sources de données
(PRIM, Navitia, GTFS) en une API REST simple pour interroger :
- **Prochains passages** en temps réel dans une gare
- **Perturbations trafic** par ligne ou par arrêt (RATP + SNCF + Bus)
- **Pannes d'équipements** (ascenseurs, escalators)
- **Horaires GTFS** statiques
- **Recherche d'arrêts** par nom

## Démarrage rapide

```bash
npm install
cp .env.example .env
# Éditer .env avec votre clé API PRIM
npm start
```

Le serveur écoute sur `http://localhost:3000`.

## Configuration

| Variable | Description |
|----------|-------------|
| `PRIM_API_KEY` | Clé API PRIM (obtenez-la sur [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr)) |
| `STOPS_MAP_PATH` | Chemin vers `arrets-stopPoint.json` (18 Mo, pas inclus dans le repo) |
| `PORT` | Port d'écoute (défaut: 3000) |
| `QUIET_MODE` | `true` pour masquer l'ASCII art au démarrage |

## Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | [`/next`](endpoints/next) | Prochains passages + trafic + équipements (mode full) |
| `GET` | [`/nextTrains`](endpoints/next-trains) | Alias pour /next |
| `GET` | [`/timetable`](endpoints/timetable) | Horaires GTFS d'une journée |
| `GET` | [`/traffic`](endpoints/traffic) | Perturbations par ligne et/ou arrêt |
| `GET` | [`/search`](endpoints/search) | Recherche d'arrêts par nom |
| `GET` | [`/equipments`](endpoints/equipments) | Pannes d'ascenseurs/escalators |

## Sources

| Source | Rôle |
|--------|------|
| [PRIM](https://prim.iledefrance-mobilites.fr) | Données temps réel Île-de-France Mobilités |
| [Navitia](https://navitia.io) | Calculateur d'itinéraires et recherche |
| [IDFM Open Data](https://data.iledefrance-mobilites.fr) | Référentiels lignes et arrêts |
