# ROADMAP

Ce qui est prévu pour HORIZN après la `2.0.1`. Les numéros de version sont
indicatifs (patch = correctif ou perf sans changement d'API ; minor = nouveau
comportement observable ou nouvel endpoint). Un item livré passe dans le
[CHANGELOG](CHANGELOG.md).

| Item | Version |
|------|:-------:|
| Import GTFS complet (`calendar`, `calendar_dates`, `shapes`) | 2.0.2 |
| Import GTFS 3,3× plus rapide + 3 correctifs | 2.0.2 |
| Suppression de `NextService.js` + report du fix `trainNum` | 2.0.2 |
| Clé PRIM uniforme + retrait des fallbacks en dur | 2.0.2 |
| `.env.example` nettoyé | 2.0.2 |
| Port par défaut `3000` → `3003` | 2.0.2 |
| Docs à jour (`ARCHITECTURE.md`, README) | 2.0.2 |
| Bump actions GitHub | 2.0.2 |
| `/next` : `404` → `200` + tableau vide | 2.1.0 |
| `trust proxy` (Cloudflare) | 2.1.0 |
| Verrou fichier `api_keys.json` | 2.1.0 |
| `GET /route/:id/shape` (GeoJSON) | 2.1.0 |
| Première suite de tests `node:test` | 2.1.0 |
| `/search` sur index local (retrait Navitia) | 2.2.0 |
| `GET /stop/:id` | 2.2.0 |
| Exceptions de service (`calendar_dates`) | 2.2.0 |
| Rate limiting multi-instance (Redis) | 2.2.0 |

---

## 2.0.2 — GTFS fonctionnel + nettoyage

Patch : correctifs, performance, cohérence. Aucun changement de contrat d'API.

- [ ] **Import GTFS complet** — `js/scripts/setupGTFS.js` n'importe que
  `stops` / `routes` / `trips` / `stop_times`. Or `GTFSService` fait un
  `INNER JOIN calendar` sur toutes les requêtes de départs → une base construite
  uniquement par le script renvoie **zéro** résultat GTFS. Importer `calendar.txt`,
  `calendar_dates.txt` et `shapes.txt`.
- [ ] **Import GTFS plus rapide** — 3,3× plus rapide, 2,3× moins de RAM, plus
  3 correctifs (import à froid qui crashait, hash écrit avant la fin de l'import,
  erreurs de lecture du ZIP avalées). Travail réalisé sur la branche
  `claude/gtfs-parsing-optimization-1xwbma` — **à ouvrir en PR**
  (⚠️ conflit CHANGELOG à résoudre avec la `2.0.1`).
- [ ] **Supprimer `js/services/NextService.js`** (code mort — `index.js` utilise
  `DeparturesService`). Reporter au passage le seul correctif qu'il porte : le
  parsing `trainNum` (`TrainNumbers.TrainNumberRef[0].value`) dans
  `DeparturesService._normalizePrim` (qui lit encore `TrainNumbers?.[0]?.value`).
- [ ] **Clé PRIM uniforme** — `SearchService.js` lit `process.env.PRIM_KEY`, tous
  les autres lisent `PRIM_API_KEY`. Uniformiser sur `PRIM_API_KEY` et **retirer les
  fallbacks de clé en dur** présents dans `DeparturesService`, `TrafficService`,
  `SearchService`, `NextService`.
- [ ] **`.env.example`** — retirer `API_KEYS=key1,key2` (jamais lu), documenter
  `FRONTEND_API_KEY` / `ADMIN_API_KEY`.
- [ ] **Port par défaut** — `index.js` fait `process.env.PORT || '3000'` alors que
  `docker-compose.yml`, le `Dockerfile`, les docs et le Tunnel supposent `3003`.
- [ ] **Docs** — `docs/ARCHITECTURE.md` : clés de cache réelles
  (`IDFM:{id}`, `disruptions_bulk`, `v2:{q}:{n}`), signature de `CacheService.set`,
  section Tunnel (`isa.infostation.fr` « à venir » alors que c'est en ligne sous
  `horizn.infostation.fr`). README : pied de page `*HORIZN v2.1*` → version réelle.
- [ ] **CI** — `actions/checkout@v4` / `setup-node@v4` sont forcés sur Node 24
  (Node 20 déprécié sur les runners). Monter de version.

## 2.1.0 — Cohérence & robustesse prod

Minor : un changement de comportement observable, du durcissement, un endpoint.

- [ ] **`/next` renvoie `200` + tableau vide** au lieu de `404` quand aucune donnée
  n'est disponible (cohérence avec le README et les autres endpoints).
- [ ] **`app.set('trust proxy', …)`** — non configuré. Sans effet pour les clés
  connues (quota indexé sur `sha256(clé)`), mais le fallback IP du rate limiting
  voit l'IP du réseau Docker : les requêtes non authentifiées partagent un seul
  bucket. Configurer la confiance du proxy Cloudflare.
- [ ] **Verrou fichier `api_keys.json`** — `KeyUsageService.flush()` a une garde
  anti-course sur `mtime` mais il reste une fenêtre résiduelle (stat → rename) où
  un `keys.js revoke` concurrent pourrait être écrasé. Verrou consultatif partagé
  entre le serveur et la CLI.
- [ ] **`GET /route/:id/shape`** — `GTFSService.getRouteShape()` renvoie déjà un
  `Feature` GeoJSON LineString mais aucune route ne l'expose.
- [ ] **Première suite de tests** — `npm test` fait `exit 1`. Introduire `node:test`
  (natif, sans dépendance) sur :
  - `KeyUsageService` — merge du delta, garde `mtime`, préservation du mode, retry
  - `rateLimit` — quota par clé vs fallback IP, `getUsage`
  - `DeparturesService._mergeAndNormalize` — dédup PRIM/GTFS par bucket ±3 min

## 2.2.0 — Recherche locale & scaling

Minor : nouvelles capacités.

- [ ] **`/search` sur index local** — `/search` dépend actuellement de l'API
  Navitia. Basculer sur l'index local (`json/arrets-stopPoint.json`, déjà chargé
  par `SearchService`) : recherche hors-ligne, sans quota. Branche
  `feat/station-search` (vide pour l'instant).
- [ ] **`GET /stop/:id`** — exposer `GTFSService.getStop()` (lignes desservies,
  position).
- [ ] **Exceptions de service** — appliquer `calendar_dates.txt` (jours fériés,
  services ajoutés/retirés) dans `/timetable` et la partie GTFS de `/next`.
- [ ] **Rate limiting multi-instance** — `RateLimiterMemory` est par-process et
  remis à zéro au redémarrage. Backend Redis/Memcached optionnel pour scaler
  horizontalement (déjà noté dans `js/middleware/rateLimit.js`).
