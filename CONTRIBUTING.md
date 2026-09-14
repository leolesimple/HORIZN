# Contribuer à HORIZN

Merci de contribuer à **HORIZN** — moteur d'API REST Node.js/Express fusionnant le temps réel
PRIM (SIRI + `disruptions_bulk`) et le GTFS statique IDFM (SQLite). Ce document complète
`CLAUDE.md` et `AGENT.md`.

## Stack & prérequis

- **Node.js 20+**, Express 5, `better-sqlite3`, `axios`, `rate-limiter-flexible`, `jsonwebtoken`
- Pas de TypeScript, pas de framework de test (la CI tient lieu de suite)
- Docker + Docker Compose + Cloudflare Tunnel, port **3003**, réseau `heartbeat-net`

## Setup local

```bash
git clone <url> && cd HORIZN
cp .env.example .env          # puis renseigner PRIM_API_KEY, FRONTEND/ADMIN_API_KEY
npm install
npm run setup-gtfs            # import GTFS IDFM (data/infostation.db)
npm run migrate-stops         # recharge stops.txt
npm run dev                   # nodemon, ou `npm start`
```

> ⚠️ Toujours exporter `PORT` en local : le code retombe sur `3000` par défaut, mais le reste
> du projet (compose, Dockerfile, docs, Tunnel) suppose **3003**.

## Avant de pousser (la CI les exécute aussi)

```bash
npm audit --audit-level=moderate
npm ls --all
find js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
PORT=3003 QUIET_MODE=1 node js/index.js &   # puis curl http://127.0.0.1:3003/health
```

## Règles absolues

- **Ne jamais ajouter `express.static()`** ni servir de HTML/JS/CSS — HORIZN est backend-only.
  Toute route est explicite, avec auth si nécessaire.
- **Ne jamais committer de secret** (clés API, tokens, `.env`). Les clés passent uniquement par
  les variables d'environnement. Aucun fallback en dur dans le code.
- Respecter l'ordre du middleware (sécurité → headers → CORS → request ID → logging →
  auth/rate-limit → handler).
- Ne pas remonter le `require('./middleware/rateLimit')` en haut de `KeyUsageService.js`
  (cycle de `require` — voir `CLAUDE.md`).

## Conventions de commit (obligatoire)

Format `type(scope): description` — [Conventional Commits](https://www.conventionalcommits.org/).
Types : `feat`, `fix`, `perf`, `docs`, `chore`, `style`, `refactor`, `test`, `ci`. Scopes vus :
`auth`, `next`, `gtfs`, `deps`, `readme`.

**Depuis `semantic-release`, ces types pilotent directement la version publiée** (preset `angular`) :

| Type / marqueur | Effet |
|---|---|
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `docs(readme: ...)` | patch (scope `readme` uniquement) |
| `BREAKING CHANGE:` en pied de commit, ou `!` après le type (`feat!:`…) | major |
| `docs`, `chore`, `style`, `refactor`, `test`, `build`, `ci` (hors cas ci-dessus) | aucune release |

**Ne jamais** bumper `package.json` / `CHANGELOG.md` à la main, ni créer de tag, de commit
`chore(release): x.y.z`, ou de GitHub Release manuelle — tout est généré automatiquement au push
d'un `feat`/`fix`/`perf` sur `main`.

## Workflow proposé

1. Créer une branche depuis `main` : `git checkout -b feat/ma-fonctionnalite` (ou `fix/…`, `perf/…`, `docs/…`).
2. Un commit par changement cohérent, message conventionnel.
3. `main` est **protégée (PR obligatoire)** : ouvrir une Pull Request avec `gh pr create` ou l'UI GitHub.
4. Les checks CI (`Node.js checks`, `Docker build`) doivent passer ; `Semantic Release` ne
   s'exécute que sur push direct vers `main`.
5. Merger la PR → le push résultant sur `main` déclenche la release automatique.

## Checklist de PR

- [ ] Les commandes « Avant de pousser » passent localement
- [ ] Pas de secret ni de `.env` committé ; aucun fallback en dur
- [ ] Aucun `express.static()` ajouté
- [ ] Message de commit au format conventionnel
- [ ] `CLAUDE.md` / `AGENT.md` mis à jour si l'architecture ou une commande change

## Pièges connus (non corrigés — ne pas aggraver)

- `NextService.js` a été supprimé en tant que code mort — rester uniquement sur `DeparturesService`.
- `setupGTFS.js` n'importe pas `calendar.txt`/`shapes.txt`, or `GTFSService` fait un `INNER JOIN calendar`.
- `SearchService.js` a longtemps lu `PRIM_KEY` (corrigé en `PRIM_API_KEY` en v2.0.2) — rester
  cohérent sur `PRIM_API_KEY`.
- `app.set('trust proxy', …)` non configuré → le fallback IP du rate limit voit l'IP Docker.