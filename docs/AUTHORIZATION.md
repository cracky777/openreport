# Modèle d'autorisation — OpenReport

Qui peut faire quoi, et comment c'est vérifié. Ancré sur les **noms de fonctions, tables et
colonnes** — valable indépendamment de l'emplacement du code. Pour la liste des endpoints, voir
[API.md](API.md).

## Rôles

Deux niveaux de rôles, indépendants (pas de matrice croisée en OSS) :

### Rôles globaux — colonne `users.role`
`admin` | `editor` | `viewer`. **Le premier compte inscrit (`POST /api/auth/register`) devient
`admin`** ; tous les suivants sont `viewer`.

| Rôle | Peut |
|---|---|
| `admin` | Tout : gestion des utilisateurs (`/api/admin/*`), paramètres globaux, historique des rapports, **et accès à tout modèle/rapport/datasource** (bypass de propriété **et** de RLS). |
| `editor` | Créer/éditer/supprimer **ses** datasources, modèles et rapports. |
| `viewer` | Consulter ses rapports et les rapports publics ; exécuter des requêtes sur les modèles auxquels il a accès. |

> La création de modèles/datasources n'exige pas explicitement le rôle `editor` dans le code : elle
> est ouverte à tout utilisateur authentifié qui possède la ressource parente. La distinction
> `editor`/`viewer` est surtout documentaire côté OSS ; le cloisonnement réel repose sur la
> **propriété** et la **membership de workspace** (ci-dessous).

### Rôles de workspace — colonne `workspace_members.role`
`admin` | `editor` | `viewer`. Le **propriétaire** du workspace (`workspaces.owner_id`) a un rôle
`admin` **implicite**. Résolus par `getWorkspaceAccess(workspaceId, userId)`.

| Rôle workspace | Peut |
|---|---|
| `admin` (owner ou membre admin) | Éditer/supprimer le workspace, gérer les membres. |
| `editor` | Déplacer un rapport (qu'il possède) dans le workspace. |
| `viewer` | Lecture des rapports du workspace. |

## Middleware d'authentification

Défini dans `middleware/auth.js` (passport-local + express-session, session stockée en SQLite) :

- `requireAuth` → **401** `Authentication required` si non authentifié.
- `authFor('read' | 'write')` → la garde effectivement utilisée par les routers.
- `requireAdmin` → 401 si non authentifié, **403** si `role !== 'admin'`.

`requireRole(...roles)` est défini et exporté mais **n'a aucun appelant** : ne pas s'en servir comme
description du modèle de rôles.

La désérialisation recharge `id, email, display_name, role` depuis `users`. En mode cloud
(`OPENREPORT_CLOUD=1`), `email_verified` est exigé ; en OSS, non.

## Édition cloud : où se prennent réellement les décisions

Chaque fonction ci-dessous commence par déléguer à `cloudHooks.<même nom>` quand le module cloud est
chargé (`OPENREPORT_CLOUD=1`). La logique OSS décrite ici est donc le **repli**, pas la règle
universelle : en cloud, tout est ré-arbitré par le rôle dans l'organisation active. Toutes prennent
`(objet, user, req)` — `req` porte `organizationId`.

## Accès aux rapports et modèles

Quatre fonctions portent le contrôle d'accès aux données (définies dans le router reports) :

**`canAccessReport(report, user, req)`** — lecture d'un rapport :
1. `report.is_public` est vrai ; **ou**
2. `user` existe **et** (`user.role === 'admin'` ; **ou** `user.id === report.user_id` ; **ou**
   le rapport est dans un workspace dont `user` est owner ou membre).

**`canAccessModel(model, user, req)`** — lecture d'un modèle :
1. `user.role === 'admin'` ; **ou**
2. `user.id === model.user_id` (propriétaire) ; **ou**
3. il existe un rapport qui **utilise ce modèle** et pour lequel `canAccessReport` est vrai (un
   modèle est ainsi atteignable via un rapport public ou partagé).

**`canWriteModel(model, user, req)`** — OSS : propriétaire du modèle ou admin global.

**`canWriteReport(report, user, req)`** — OSS : propriétaire du rapport ou admin global.

**Lecture vs écriture** :
- Lecture (`GET /api/reports/:id`, `POST /api/models/:id/query`) : gardée par `canAccessReport` /
  `canAccessModel`, **sans** `requireAuth` → un anonyme peut lire un rapport public.
- Écriture : par ces fonctions, **pas** par une clause SQL `WHERE user_id = ?`. Cette forme ne
  subsiste que pour le cadrage des datasources.

**Créer ou modifier un rapport exige `canWriteModel` sur son modèle**, pas seulement
`canAccessModel`. Lire le modèle d'autrui via un rapport partagé ne suffit donc pas à bâtir dessus :
sinon n'importe quel compte pouvait créer un rapport sur ce modèle puis le publier, ce qui ouvre
`/query` en anonyme sur des données qui ne sont pas les siennes.

**Passer `is_public = 1` exige également `canWriteModel`** sur le modèle sous-jacent : publier
expose la donnée, pas seulement le rapport, et c'est à celui qui détient la donnée d'en décider.

**Le workspace cible est vérifié** à la création comme au déplacement (`canPlaceReportIn`) :
appartenance réelle, avec un rôle autre que `viewer`. Le refus est identique que le titre demandé
existe déjà ou non, pour ne pas transformer le 409 d'unicité en oracle d'énumération.

## Row-Level Security (RLS)

Définie par modèle (`models.rls`, colonne JSON) et appliquée à la compilation SQL (`utils/rls.js`).

**Forme** :
```
rls = {
  enabled: true,
  table: "<table RLS>",          // doit être atteignable via les joins du modèle
  primaryKey: "<colonne clé>",
  rules: { "<valeurKey>": ["<pattern email>", ...] }
}
```

**Patterns** : glob email insensible à la casse — `alice@x.com` (exact), `*@x.com` (domaine),
`*` (tout utilisateur). `getAllowedRlsKeys(rls, email)` renvoie la liste des valeurs de clé
autorisées pour cet email (`[]` = aucune).

**Application** :
- **Bypass** pour le **propriétaire du modèle** et l'**admin global** (RLS non appliquée).
- Sinon, injection dans le `WHERE` : `CAST("<pk>" AS VARCHAR) IN ('key1', 'key2', …)`, ou
  `WHERE 1 = 0` si aucune clé n'est autorisée (deny-all).
- `tablesReachableFrom` vérifie que la table RLS rejoint bien toutes les tables interrogées
  (protège contre une table orpheline qui contournerait le filtre).

## Partage public et accès anonyme

Un rapport devient public quand son propriétaire fait `PUT /api/reports/:id` avec `is_public: true`
(colonne `reports.is_public`). Dès lors :

- `GET /api/reports/:id` renvoie le rapport à un anonyme, **mais** `widget.data` (le snapshot
  pré-calculé du propriétaire) est **retiré** pour les non-propriétaires → le client re-interroge
  chaque widget via `/query`, ce qui **force la ré-évaluation sous RLS**.
- `POST /api/models/:id/query` sert alors les données du modèle sous‑jacent, RLS appliquée avec
  `email = ''` pour un anonyme (n'obtient des lignes que si un pattern `*` l'autorise).

### Garde-fou « extras / free-SQL »
Les mesures/dimensions *report-scoped* peuvent contenir du SQL arbitraire — vecteur de contournement
de RLS. À l'exécution de `/query` :
- les **extras non persistés** (envoyés dans le corps) ne sont acceptés que du **propriétaire du
  modèle ou d'un admin** ;
- pour un non-propriétaire, seuls les **extras persistés** dans le rapport sont chargés, **après**
  vérification `canAccessReport`, et les expressions `custom` / `expression` en sont **retirées**
  (`stripped`). Les mesures custom définies **au niveau du modèle** (contrôlées par le propriétaire)
  restent, elles, en place.

## Matrice d'accès (synthèse)

| Opération | Anonyme | `viewer` | `editor` | `admin` |
|---|:--:|:--:|:--:|:--:|
| Lire un rapport **public** | ✅ | ✅ | ✅ | ✅ |
| Lire un rapport **privé** (non partagé) | ❌ | son propre | son propre | ✅ (tous) |
| Requêter un modèle via rapport public | ✅ (RLS) | ✅ | ✅ | ✅ |
| Créer un rapport | ❌ | ❌¹ | ✅ | ✅ |
| Modifier / supprimer un rapport | ❌ | propriétaire | propriétaire | ✅ (tous) |
| Créer un modèle / une datasource | ❌ | ❌¹ | ✅ | ✅ |
| Gérer les membres d'un workspace | ❌ | admin du workspace | admin du workspace | ✅ |
| Voir/restaurer l'historique d'un rapport | ❌ | ❌ | ❌ | ✅ |
| Paramètres globaux (`/api/admin/*`) | ❌ | ❌ | ❌ | ✅ |

¹ La création n'est pas bloquée par le rôle global mais par la **propriété de la ressource
parente** (posséder une datasource pour créer un modèle, un modèle pour créer un rapport). Un
`viewer` sans ressource parente ne peut rien créer en pratique.

---

Fichiers de référence : `middleware/auth.js` (auth), le router reports (`canAccessReport`,
`canAccessModel`), `routes/workspaces.js` (`getWorkspaceAccess`), `utils/rls.js` (RLS),
`routes/admin.js` (admin), `db/schema.sql` (tables `users`, `workspaces`, `workspace_members`,
`reports`).
