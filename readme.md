# **ISA**

## **Description**
L'ISA (InfoStation API) permet d'obtenir les horaires des prochains trains pour un arrêt donné dans le réseau d'Île-de-France. Les données sont récupérées depuis l'API PRIM et organisées localement pour une consultation rapide.

---

## **Configuration**

### **Prérequis**
- **Node.js** : version 14 ou supérieure
- **Modules nécessaires** : `express`, `axios`, `fs`, `path`
- Un fichier JSON contenant les arrêts : `arrets-stopPoint.json`

### **Installation**
1. Clonez le dépôt du projet.
2. Installez les dépendances avec :
   ```bash
   npm install
   ```
3. Assurez-vous d'avoir les fichiers suivants dans le répertoire du projet :
    - `primData.json` (fichier de données locales, généré automatiquement après la première requête globale)
    - `arrets-stopPoint.json` (données de correspondance pour les arrêts)

4. Remplacez la clé API PRIM par votre clé personnelle dans la constante `GLOBAL_API_KEY`.

5. Lancez le serveur :
   ```bash
   node server.js
   ```

---

## **Endpoints**

### **1. `/nextTrains`**
Récupère les horaires des prochains trains pour un arrêt donné.

#### **Méthode** : `GET`

#### **Paramètres**

| Paramètre   | Type     | Obligatoire | Description                                                                                     |
|-------------|----------|-------------|-------------------------------------------------------------------------------------------------|
| `stopId`    | `string` | Oui         | L'identifiant de l'arrêt pour lequel récupérer les horaires.                                    |
| `lineRef`   | `string` | Non         | Référence de la ligne pour filtrer les résultats (optionnel, retourne toutes les lignes si absent). |

#### **Réponse**

- **200 OK**
  ```json
  {
    "stopId": "STOP_ID",
    "arrname": "Nom de l'arrêt",
    "nextTrains": [
      {
        "line": "Nom de la ligne",
        "direction": "Direction du train",
        "destination": "Destination finale",
        "mission": "Code mission (si disponible)",
        "vehicleFeatures": "Caractéristiques du véhicule (si disponibles)",
        "datedVehicleJourneyRef": "Identifiant du trajet",
        "arrivalPlatformName": "Nom du quai d'arrivée",
        "expectedArrivalTime": "Heure prévue d'arrivée",
        "expectedDepartureTime": "Heure prévue de départ",
        "departureStatus": "Statut du départ (prévu, retardé, etc.)"
      }
    ]
  }
  ```

- **400 Bad Request**
  ```json
  {
    "error": "Le paramètre stopId est requis."
  }
  ```

- **404 Not Found**
  ```json
  {
    "error": "Aucun horaire trouvé pour le stopId STOP_ID."
  }
  ```

- **500 Internal Server Error**
  ```json
  {
    "error": "Erreur lors de la récupération des horaires."
  }
  ```

#### **Exemple de requête**
```bash
curl "http://localhost:3000/nextTrains?stopId=43082&lineRef=C01742"
curl "http://localhost:3000/nextTrains?stopId=43082"
```

---

## **Fonctionnement**

### **Récupération des données globales**
Lors du démarrage du serveur, les données globales des horaires sont récupérées depuis l'API PRIM via l'URL `https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable`. Ces données sont ensuite triées et stockées dans le fichier `primData.json`.

### **Organisation des données**
1. Les données sont classées par lignes (`lineRef`) dans `primData.json`.
2. Lorsqu'une requête est effectuée sur `/nextTrains`, les données correspondantes à `stopId` et `lineRef` sont extraites et filtrées.

### **Filtrage intelligent**
- Exclusion des trajets dont la destination correspond au nom de l'arrêt d'entrée (`arrname`).
- Suppression des doublons basée sur plusieurs critères (ligne, arrêt, heure d'arrivée, etc.).

---

## **Notes Techniques**

- **Gestion des fichiers** :
    - Les données globales sont stockées localement dans `primData.json`.
    - Les informations sur les arrêts (stopId, arrname) doivent être fournies dans `arrets-stopPoint.json`.

- **Clé API** :
  La clé utilisée pour les requêtes PRIM est définie dans `GLOBAL_API_KEY`. Veillez à sécuriser cette clé dans un environnement de production.

- **Problèmes fréquents** :
    - Si `primData.json` ou `arrets-stopPoint.json` est manquant ou mal formaté, le serveur ne fonctionnera pas correctement.
    - Une erreur 503 sera renvoyée si les données globales ne sont pas disponibles.

---

## **Améliorations Futures**
- Ajouter des tests unitaires.
- Supporter plusieurs langues dans les messages d'erreur.
- Implémenter une gestion des erreurs plus robuste pour les appels à l'API PRIM.

Pour toute question ou contribution, merci de contacter l'équipe de développement.