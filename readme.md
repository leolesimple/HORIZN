# HORIZN

## Description

HORIZN est une API Node.js/Express qui sert de proxy entre les clients InfoStation et l'API PRIM d'Ile-de-France Mobilites.

Le service expose un endpoint simple (`/nextTrains`) pour recuperer les prochains passages d'un arret, avec :
- transformation des donnees PRIM (format SIRI) vers un JSON plus exploitable,
- enrichissement des informations d'arret via un fichier local,
- cache disque par `stopId` pour limiter les appels externes.


---

## Prerequis

- Node.js 14+
- Dependances npm installees (`npm install`)
- Fichier des arrets disponible (voir section Configuration)

---

## Installation

```bash
npm install
```

---

## Configuration

### Cle API PRIM

Le code actuel lit la cle API PRIM depuis la constante `API_KEY` dans `js/index2.js`.

### Fichier des arrets

Le code actuel charge les arrets depuis un chemin absolu :

`/var/www/html/horizn-api/json/arrets-stopPoint.json`

Le fichier doit contenir les correspondances `zdaid`, `arrname`, `arraccessibility` et `arrgeopoint`.

---

## Lancement

Le point d'entree fonctionnel present dans ce depot est `js/index2.js`.

```bash
node js/index2.js
```

Le serveur ecoute sur `http://localhost:3000`.

> Note: `package.json` pointe actuellement vers `js/index.js` pour `npm start`, mais ce fichier n'est pas present dans l'arborescence visible.

---

## Endpoint

### `GET /nextTrains`

Recupere les prochains passages pour un arret donne.

#### Parametres

| Parametre | Type     | Obligatoire | Description |
|-----------|----------|-------------|-------------|
| `stopId`  | `string` | Oui         | Identifiant de l'arret (ex: `43082`) |

#### Exemples

```bash
curl "http://localhost:3000/nextTrains?stopId=43082"
```

#### Reponse 200 (exemple)

```json
{
  "stopId": "43082",
  "arrname": "Nom de l'arret",
  "accessible": "...",
  "geopoint": "...",
  "nextTrains": [
    {
      "line": "...",
      "direction": "...",
      "destination": "...",
      "mission": "...",
      "trainNum": "...",
      "vehicleFeatures": "...",
      "journeyRed": "...",
      "quai": "...",
      "times": {
        "st": {
          "arrival": "...",
          "departure": "..."
        },
        "rt": {
          "arrival": "...",
          "departure": "..."
        }
      },
      "aQuai": false,
      "status": "..."
    }
  ]
}
```

#### Erreurs

- `400`: `{"error":"Parametre stopId requis."}`
- `500`: `{"error":"Erreur lors de la recuperation des donnees."}`

---

## Fonctionnement

1. Validation de `stopId`.
2. Lecture du cache `js/cache/IDFM:<stopId>.json`.
3. Si le cache a moins de 60 secondes, reponse depuis cache.
4. Sinon, appel a PRIM (`/marketplace/stop-monitoring`) avec `MonitoringRef=STIF:StopArea:SP:<stopId>:`.
5. Mapping des `MonitoredStopVisit` vers le format HORIZN.
6. Enrichissement avec les metadonnees d'arret (`arrname`, `accessible`, `geopoint`).
7. Ecriture de la reponse brute PRIM en cache.

---

## Cache

- Dossier: `js/cache`
- Strategie: un fichier par arret (`IDFM:<stopId>.json`)
- TTL: 60 secondes

Objectif: reduire la latence et le volume d'appels vers PRIM.

---

## Monitoring

Le dossier `js/monitoring` contient :
- `monitor.js`: verifie l'endpoint `/nextTrains` et envoie des alertes Discord en cas d'erreur,
- `testWebhook.js`: teste l'envoi vers le webhook Discord.

---

## Notes de securite

La cle API PRIM et l'URL webhook Discord sont actuellement en dur dans le code. Pour un usage production, il est recommande de les externaliser via variables d'environnement.

---

## Limitations connues

- Incoherence entre `npm start` (qui vise `js/index.js`) et le fichier disponible (`js/index2.js`).
- Le chemin du fichier d'arrets est absolu et specifique a un environnement serveur.
- Le champ `geopoint` est present en mode live mais pas dans la reponse issue du cache.

