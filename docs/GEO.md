# HORIZN — Référence Géo & Données

## Systèmes d'identifiants

Le réseau IDFM utilise **4 systèmes d'IDs** différents selon le contexte. Ils sont interchangeables via les fichiers de référence.

### 1. LineRef — Identifiants de ligne

```
Format PRIM SIRI :   STIF:Line::C0XXXX:
Format Navitia :     line:IDFM:C0XXXX
Format court :       C0XXXX
```

**Exemples par réseau :**

```
RÉSEAU RATP (opérateur 100):
  C01361  Métro 1        C01374  Métro 4        C01384  Métro 14
  C01362  Métro 2        C01375  Métro 5        C01385  Métro 15
  C01363  Métro 3        C01376  Métro 6        C01386  Métro 16
  C01371  Métro 3bis     C01377  Métro 7        C01387  Métro 17
  C01372  Métro 7bis     C01378  Métro 8        C01388  Métro 18
  C01373  Métro 9        C01379  Métro 10
  C01380  Métro 11       C01381  Métro 12
  C01742  RER A
  
  Tramways :
  C01947  T1    C01948  T2    C01949  T3a
  C01950  T3b   C01951  T5    C01952  T6
  C01953  T7    C01954  T8    C01955  T9

RÉSEAU SNCF / TRANSILIEN (opérateur 800):
  C01727  RER C           C01728  RER D
  C01737  Transilien H    C01739  Transilien J
  C01738  Transilien K    C01740  Transilien L
  C01736  Transilien N    C01730  Transilien P
  C01731  Transilien R    C01741  Transilien U
  C01732  Transilien E
```

**Source :** `referentiel-des-lignes` sur data.iledefrance-mobilites.fr

### 2. StopId (zdaid) — Arrêts pour StopMonitoring

```
Format PRIM SIRI :   STIF:StopArea:SP:XXXXX:
Format court :       XXXXX
```

Utilisé par `GET /next` pour les prochains passages.
Exemples : `DU496` (La Défense), `58449` (Mairie)

**Source :** fichier `arrets-stopPoint.json` (18 Mo, ~30 000 arrêts)

### 3. StopArea — Arrêts pour perturbations

```
Format disruptions_bulk :   stop_area:IDFM:XXXXX
Format court accepté :      XXXXX
```

Utilisé par `GET /traffic?stopId=X` et `GET /equipments?stopId=X`.
Exemples : `71135` (Gare d'Austerlitz), `478505` (Juvisy)

Ces IDs sont retournés par `GET /search`.

### 4. Coordonnées géographiques

Les arrêts sont géolocalisés dans deux systèmes :

- **WGS84 (lon/lat)** : utilisé par `arrets-stopPoint.json` → `arrgeopoint.lon, .lat`
- **EPSG:2154 (Lambert 93)** : utilisé par le référentiel → `arrxepsg2154, arryepsg2154`

---

## Mapping zdaid ↔ stop_area:IDFM

Il n'y a pas de correspondance directe garantie entre les deux systèmes.
Stratégie recommandée :

1. Utiliser `GET /search?q=nom` pour trouver le `stop_area:IDFM:X`
2. Pour le zdaid, utiliser le fichier `arrets-stopPoint.json` ou le paramètre `stopArea=` de `/next`

```bash
# Exemple : trouver Austerlitz
curl /search?q=austerlitz → stop_area:IDFM:71135
# Puis pour le trafic à Austerlitz :
curl /traffic?stopId=71135
# Et pour les départs, essayer le même ID ou chercher le zdaid
# (parfois identique pour les grandes gares)
```

---

## Cache réseau

HORIZN met en cache les appels PRIM pour éviter les sur-sollicitations :

| Endpoint | Api PRIM | TTL | Taille typique |
|----------|----------|-----|----------------|
| `/next` | StopMonitoring | 60s | ~5-50 Ko |
| `/traffic` | disruptions_bulk | 5 min | ~1.5 Mo |
| `/equipments` | disruptions_bulk (même cache) | 5 min | — |
| `/search` | Navitia places | aucun | — |
| `/timetable` | GTFS local | fichier | dépend de la BDD |

Le cache est en mémoire (pas de Redis). Redémarrage = cache vidé.

---

## Quotas PRIM

L'API PRIM limite à :
- **Ancien token** (avant mars 2024) : 15 req/s, 20 000 req/jour
- **Nouveau token** : 5 req/s, 1 000 req/jour

Le cache 5 min de disruptions_bulk permet de rester large**  < 5 req/min** pour cet endpoint.
