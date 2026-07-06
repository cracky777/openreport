# API HTTP — OpenReport

Référence des endpoints REST du serveur (`server/`, Express, port `3001`). Tous les chemins
applicatifs sont préfixés par `/api`. Cette doc décrit le **contrat externe** (chemins, auth,
permissions) et reste valable indépendamment de la structure interne des routers.

Pour le détail du modèle de permissions (rôles, propriété, RLS, partage public), voir
[AUTHORIZATION.md](AUTHORIZATION.md). Pour le flux d'exécution, voir [ARCHITECTURE.md](ARCHITECTURE.md).

## Conventions

- **Authentification** : session par cookie (passport-local + express-session). Le middleware
  `requireAuth` renvoie `401 { error: 'Authentication required' }` si la session est absente ;
  `requireAdmin` renvoie `403` si l'utilisateur n'est pas `admin`. L'auth est appliquée
  **par route** (aucun router n'est protégé globalement au montage).
- **Rôles globaux** : `admin` | `editor` | `viewer` (colonne `users.role`).
- **Format d'erreur** : JSON `{ error: "message" }` avec le code HTTP correspondant.
- **Corps JSON** : limité à **10 Mo** (`express.json`).
- **Colonne « Auth »** ci-dessous : ✅ = `requireAuth`, 🔓 = accessible sans session (voir la
  section dédiée), 👑 = `requireAdmin`.

## Routes sans authentification (à connaître)

Trois routes applicatives ne passent pas par `requireAuth` — elles réalisent leur contrôle
d'accès **dans le handler**, ce qui permet la consultation d'un rapport **public** par un visiteur
anonyme :

| Méthode | Path | Contrôle réel |
|---|---|---|
| `GET` | `/api/reports/:id` | `canAccessReport` : accordé si le rapport est public, ou possédé/partagé/admin. Pour un non-propriétaire, `widget.data` est retiré → le client re-interroge sous RLS. |
| `POST` | `/api/models/:id/query` | `canAccessModel` (accepte `req.user` absent) : accordé si le modèle est atteignable via un rapport public/partagé. RLS appliquée, mesures/dimensions free-SQL *report-scoped* retirées pour les non-propriétaires. |
| `POST` | `/api/models/cancel-query` | Annulation par `queryId` ; les requêtes anonymes (`userId` nul) sont annulables par tous, les requêtes authentifiées exigent le même utilisateur. |

Routes techniques également publiques : `GET /api/health`, les images servies sous
`/uploads/images/*`, et le fallback SPA `GET /*` (tout chemin ne commençant pas par `/api/`).

---

## Auth — `/api/auth`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `POST` | `/api/auth/register` | 🔓 | — | Inscription (email + mot de passe). **Le 1er compte devient `admin`**, les suivants `viewer`. Rate-limit **5 / heure / IP**. |
| `POST` | `/api/auth/login` | 🔓 | — | Connexion. Rate-limit **10 / 15 min / IP**. |
| `POST` | `/api/auth/logout` | 🔓 | — | Détruit la session. |
| `GET` | `/api/auth/me` | ✅ | soi-même | Profil courant (`id, email, display_name, role`). |
| `GET` | `/api/auth/users/search` | ✅ | soi-même | Recherche d'utilisateurs (invitation workspace / RLS). Requête partielle → limitée aux collègues d'un workspace partagé ; email complet exact → autorisé même hors partage. Rate-limit **30 / 15 min / IP**. |

## Reports — `/api/reports`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/reports` | ✅ | soi-même | Liste les rapports possédés par l'utilisateur. |
| `GET` | `/api/reports/:id` | 🔓 | `canAccessReport` | Un rapport. Public/possédé/partagé/admin ; `widget.data` retiré pour les non-propriétaires. |
| `POST` | `/api/reports` | ✅ | `canAccessModel` sur le modèle cible | Crée un rapport. |
| `PUT` | `/api/reports/:id` | ✅ | propriétaire (ou admin) | Met à jour (titre, layout, widgets, settings, `is_public`, `live_mode`, `workspace_id`, pages) ; re-valide l'accès au modèle. |
| `DELETE` | `/api/reports/:id` | ✅ | propriétaire (ou admin) | Supprime le rapport. |
| `POST` | `/api/reports/import` | ✅ | propriétaire/admin du modèle cible | Importe un rapport depuis un bundle JSON. |
| `POST` | `/api/reports/:id/duplicate` | ✅ | propriétaire (ou admin) | Duplique un rapport. |
| `GET` | `/api/reports/:id/history` | 👑 | admin | Liste les versions sauvegardées. |
| `POST` | `/api/reports/:id/history/:versionId/restore` | 👑 | admin | Restaure une version. |

## Models — `/api/models`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/models` | ✅ | soi-même | Liste les modèles possédés. |
| `GET` | `/api/models/:id` | ✅ | propriétaire/admin, ou via rapport (`canAccessModel`) | Détail du modèle ; la carte RLS est retirée pour les non-propriétaires. |
| `POST` | `/api/models` | ✅ | propriétaire de la datasource | Crée un modèle. |
| `PUT` | `/api/models/:id` | ✅ | propriétaire (ou admin) | Met à jour (dimensions, mesures, joins, RLS, column_types…). |
| `DELETE` | `/api/models/:id` | ✅ | propriétaire (ou admin) | Supprime (échoue si des rapports l'utilisent). |
| `GET` | `/api/models/:id/validate` | ✅ | propriétaire (ou admin) | Valide les références du modèle contre le schéma de la datasource. |
| `GET` | `/api/models/:id/rls/rows` | ✅ | propriétaire (ou admin) | Lignes de la table RLS pour l'UI. |
| `POST` | `/api/models/:id/validate-column-type` | ✅ | propriétaire (ou admin) | Vérifie qu'une colonne est coercible vers un type cible. |
| `POST` | `/api/models/:id/detect-cardinality` | ✅ | propriétaire (ou admin) | Compte les valeurs distinctes d'une colonne. |
| `POST` | `/api/models/:id/query` | 🔓 | `canAccessModel` | **Exécute une requête de widget** (cœur du produit). Sert depuis un rollup ou en live. |
| `POST` | `/api/models/cancel-query` | 🔓 | même utilisateur | Annule une requête en vol par `queryId`. |

## Datasources — `/api/datasources`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/datasources` | ✅ | soi-même | Liste les datasources possédées. |
| `GET` | `/api/datasources/:id` | ✅ | propriétaire (ou admin) | Une datasource (sans le mot de passe). |
| `POST` | `/api/datasources/test` | ✅ | soi-même | Teste une connexion sans sauvegarder. |
| `POST` | `/api/datasources` | ✅ | soi-même | Crée une datasource (PG/MySQL/MSSQL/BigQuery/DuckDB…). |
| `PUT` | `/api/datasources/:id` | ✅ | propriétaire (ou admin) | Met à jour ; invalide le queryCache et les rollups liés. |
| `DELETE` | `/api/datasources/:id` | ✅ | propriétaire (ou admin) | Supprime (échoue si des modèles l'utilisent). |
| `GET` | `/api/datasources/:id/tables` | ✅ | propriétaire (ou admin) | Liste les tables. |
| `GET` | `/api/datasources/:id/tables/:table/columns` | ✅ | propriétaire (ou admin) | Liste les colonnes d'une table. |
| `POST` | `/api/datasources/:id/query` | ✅ | propriétaire (ou admin) | SELECT ad-hoc (SELECT-only, mono-instruction). |

## Admin — `/api/admin`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/admin/users` | 👑 | admin | Liste tous les utilisateurs. |
| `POST` | `/api/admin/users` | 👑 | admin | Crée un utilisateur. |
| `PUT` | `/api/admin/users/:id/role` | 👑 | admin | Change le rôle (empêche de retirer le dernier admin). |
| `PUT` | `/api/admin/users/:id/password` | 👑 | admin | Réinitialise un mot de passe. |
| `DELETE` | `/api/admin/users/:id` | 👑 | admin | Supprime un utilisateur (pas soi-même). |
| `GET` | `/api/admin/settings` | 👑 | admin | Paramètres globaux + stats stockage/rollups. |
| `PUT` | `/api/admin/settings/query-timeout` | 👑 | admin | Fixe le timeout de requête (borné). |
| `PUT` | `/api/admin/settings/query-cache` | 👑 | admin | Configure le cache de requêtes (activé, TTL). |
| `POST` | `/api/admin/settings/query-cache/flush` | 👑 | admin | Vide le cache de requêtes en RAM. |

## Workspaces — `/api/workspaces`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/workspaces` | ✅ | soi-même | Workspaces possédés ou partagés (le personnel est séparé). |
| `POST` | `/api/workspaces` | ✅ | soi-même | Crée un workspace (devient owner). |
| `GET` | `/api/workspaces/:id` | ✅ | membre/owner (ou admin global) | Détail (rapports, membres, owner). |
| `PUT` | `/api/workspaces/:id` | ✅ | admin du workspace | Met à jour (nom, description). |
| `DELETE` | `/api/workspaces/:id` | ✅ | admin du workspace | Supprime (workspace personnel interdit ; rapports ré-hébergés). |
| `POST` | `/api/workspaces/:id/members` | ✅ | admin du workspace | Ajoute un membre (rôle admin/editor/viewer). |
| `PUT` | `/api/workspaces/:id/members/:userId` | ✅ | admin du workspace | Change le rôle d'un membre. |
| `DELETE` | `/api/workspaces/:id/members/:userId` | ✅ | admin du workspace | Retire un membre. |
| `PUT` | `/api/workspaces/:id/reports/:reportId` | ✅ | editor/admin du workspace + propriétaire du rapport | Déplace un rapport vers le workspace. |

## Custom Visuals — `/api/workspaces/:wsId/visuals`

Monté sur le préfixe `/api/workspaces` **avant** le router workspaces.

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/workspaces/:wsId/visuals` | ✅ | membre du workspace (ou admin) | Liste les visuels installés. |
| `GET` | `/api/workspaces/:wsId/visuals/:visualId/bundle.js` | ✅ | membre du workspace (ou admin) | Sert le bundle JS (sandbox iframe). |
| `GET` | `/api/workspaces/:wsId/visuals/:visualId/icon` | ✅ | membre du workspace (ou admin) | Sert l'icône (`Content-Disposition: attachment`, `nosniff`). |
| `POST` | `/api/workspaces/:wsId/visuals` | ✅ | admin du workspace | Installe un paquet `.zip` (manifest + visual.js + icône). |
| `DELETE` | `/api/workspaces/:wsId/visuals/:visualId` | ✅ | admin du workspace | Supprime un visuel. |

## Cache Schedules — `/api/cache-schedules`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `GET` | `/api/cache-schedules/by-report/:reportId` | ✅ | propriétaire du rapport (ou admin) | Planifications de réchauffage du cache. |
| `POST` | `/api/cache-schedules/by-report/:reportId` | ✅ | propriétaire du rapport (ou admin) | Crée une planification (cron, timezone). |
| `PUT` | `/api/cache-schedules/:id` | ✅ | propriétaire du rapport (ou admin) | Met à jour une planification. |
| `DELETE` | `/api/cache-schedules/:id` | ✅ | propriétaire du rapport (ou admin) | Supprime une planification. |
| `POST` | `/api/cache-schedules/:id/run` | ✅ | propriétaire du rapport (ou admin) | Lance un réchauffage immédiat. |
| `POST` | `/api/cache-schedules/run-now/:reportId` | ✅ | propriétaire du rapport (ou admin) | Reconstruit les rollups du modèle du rapport à la demande. |
| `POST` | `/api/cache-schedules/clear-workspace/:workspaceId` | ✅ | owner du workspace (ou admin) | Purge rollups + queryCache des modèles du workspace. |
| `GET` | `/api/cache-schedules/warming` | ✅ | soi-même | Rapports avec reconstruction rollup en cours + progression. |
| `GET` | `/api/cache-schedules/inspect/:reportId` | ✅ | propriétaire du rapport (ou admin) | Inspecte les tables rollup (grain, lignes, taille disque). |
| `GET` | `/api/cache-schedules/size/:reportId` | ✅ | propriétaire du rapport (ou admin) | Empreinte compacte du cache. |

## Rollups — `/api/rollups`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `POST` | `/api/rollups/run-now/:modelId` | ✅ | propriétaire du modèle (ou admin) | Reconstruction complète des rollups d'un modèle. |
| `GET` | `/api/rollups/manifest/:modelId` | ✅ | propriétaire du modèle (ou admin) | Manifest des rollups (grain, mesures, filtres, lignes, date de build). |
| `DELETE` | `/api/rollups/:modelId/:grainHash` | ✅ | propriétaire du modèle (ou admin) | Supprime un rollup par hash de grain. |

## Upload de fichiers — `/api/upload`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `POST` | `/api/upload` | ✅ | soi-même | Upload CSV/XLSX/Parquet/JSON/TSV → crée une datasource DuckDB. Taille max **500 Mo**. |
| `GET` | `/api/upload` | ✅ | soi-même | Liste les datasources issues de fichiers. |

## Upload d'images — `/api/images`

| Méthode | Path | Auth | Permission | Description |
|---|---|:--:|---|---|
| `POST` | `/api/images` | ✅ | soi-même | Upload image (PNG/JPG/GIF/WebP/SVG/AVIF) → URL `/uploads/images/{uuid}{ext}`. Taille max **10 Mo**. |

## Routes techniques (`index.js`)

| Méthode | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/api/health` | 🔓 | Health check → `{ status: 'ok', version }`. |
| `GET` | `/api/custom-visual-template.zip` | ✅ | Télécharge le starter de visuel custom (packagé à la volée). |
| `GET` | `/uploads/images/*` | 🔓 | Sert les images uploadées (cache 7 j). |
| `GET` | `/*` | 🔓 | Fallback SPA (sert le client React pour tout chemin hors `/api/`). |
