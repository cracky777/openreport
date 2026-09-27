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
| `admin` | **Gérer** tout : utilisateurs (`/api/admin/*`), paramètres globaux, historique des rapports, tout workspace, toute datasource, tout modèle, tout rapport (créer, éditer, déplacer, partager, supprimer, RLS, cache). Mais il ne **lit les données** que là où un workspace lui a donné un rôle : ni `/query`, ni l'aperçu SQL d'une datasource, ni contournement de RLS sans rôle. |
| `editor` | Ce que ses rôles de workspace lui donnent (ci-dessous). |
| `viewer` | Consulter ses rapports et les rapports publics ; exécuter des requêtes sur les modèles auxquels il a accès. |

> Le rôle global ne décide de rien sur les datasources, modèles et rapports hors le cas `admin` :
> le cloisonnement réel repose sur le **workspace d'attache** de chaque ressource et la
> **membership de workspace** (ci-dessous). Source de vérité : `utils/workspaceAccess.js`.

### Rôles de workspace — colonne `workspace_members.role`
`admin` | `editor` | `viewer`. Le **propriétaire** du workspace (`workspaces.owner_id`) a un rôle
`admin` **implicite**. Résolus par `getWorkspaceAccess(workspaceId, userId)`.

| Rôle workspace | Peut |
|---|---|
| `admin` (owner ou membre admin) | Tout ce que peut `editor`, plus : créer des datasources dans le workspace, en tenir les identifiants, les déplacer, les supprimer ; supprimer, déplacer et partager ses modèles, en régler la RLS, piloter leur cache ; éditer/supprimer le workspace et gérer les membres. Lit toutes les lignes des modèles du workspace (bypass RLS). |
| `editor` | Voir les datasources et modèles du workspace, créer des modèles sur ses sources, éditer ses modèles, bâtir des rapports sur ses modèles et sur ceux partagés dans le workspace ; éditer, supprimer, dupliquer et déplacer les rapports du workspace. Ne peut ni publier un rapport, ni régler la RLS. |
| `viewer` | Lecture des rapports du workspace, et donc des données de leurs modèles (sous RLS). |

### Workspace d'attache et partage — `workspace_id`, `workspace_datasources`, `workspace_models`
Chaque datasource et chaque modèle vit dans **un** workspace (le personnel de son créateur par défaut ;
migration au démarrage pour les lignes antérieures). Les deux peuvent en plus être **partagés** dans
d'autres workspaces. Une datasource partagée (`workspace_datasources`, `PUT /datasources/:id/shares`) :
les éditeurs du workspace cible en voient les tables et y créent des modèles (qui vivent chez eux),
sans en tenir les identifiants. Un modèle partagé (`workspace_models`) : leurs éditeurs bâtissent des
rapports dessus, leurs membres en lisent les données, personne n'y édite le modèle. Un rapport partagé
(`workspace_reports`, `PUT /reports/:id/shares`, par qui peut l'éditer, vers un workspace d'équipe où
son modèle est disponible) : leurs membres l'ouvrent et en lisent les données (`canAccessReport`),
leurs admins/éditeurs y font tout sauf le supprimer (`canEditReport`) — la suppression reste à son
workspace (`canWriteReport`) ; publier, poser un embed ou placer le rapport gardent l'exigence du modèle. **Un nouveau workspace ne contient
rien** : une ressource y arrive en y étant créée, déplacée (`PUT /:id/workspace`) ou partagée
(`PUT /models/:id/shares`). Un rapport ne peut être placé dans un workspace que si son modèle y est
disponible (attache ou partage), sauf pour qui gère le modèle et pour le workspace personnel de
l'auteur (`modelPlacementError`). Le créateur d'une ressource (`user_id`) en garde la gestion où qu'elle soit.

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

**Sources et modèles** : la règle est la même dans les deux éditions (`utils/workspaceAccess.js`).
Chaque décision prend un **acteur** (`wsAccess.actorOf(req)`) : en OSS, l'utilisateur ; en cloud,
`cloudHooks.workspaceActor` rend `{ id, role, orgId }` — `role` vaut `admin` pour un admin de
l'organisation active, qui y tient le rôle de l'admin global (gère tout, ne lit les lignes qu'avec un
rôle), et `orgId` borne la portée : une ligne d'une autre organisation n'existe pas (404), un partage
ou un déplacement vers un workspace d'une autre organisation est refusé (403), et une requête sans
organisation active reçoit un `orgId` qui ne correspond à rien. Le workspace personnel est celui de
l'organisation (`resolvePersonalWorkspaceFor`, `personalWorkspaceOfRow`).

**Rapports** : `canAccessReport`, `canWriteReport`, `canManageReportHistory` délèguent encore à
`cloudHooks.<même nom>` quand le module cloud est chargé (`OPENREPORT_CLOUD=1`) : la logique OSS
décrite ici en est le **repli**. Toutes prennent `(objet, user, req)` — `req` porte `organizationId`.

## Accès aux rapports et modèles

Quatre fonctions portent le contrôle d'accès aux données (définies dans le router reports) :

**`canAccessReport(report, user, req)`** — lecture d'un rapport :
1. `report.is_public` est vrai ; **ou**
2. `user` existe **et** (`user.role === 'admin'` ; **ou** `user.id === report.user_id` ; **ou**
   le rapport est dans un workspace dont `user` est owner ou membre).

**`canAccessModel(model, user, req)`** — lecture des données d'un modèle (`/query`) :
1. `user.id === model.user_id` (créateur) ; **ou**
2. un rôle, quel qu'il soit, dans le workspace d'attache du modèle ou dans un workspace où il est
   partagé (`wsAccess.canAccessModelData`) ; **ou**
3. il existe un rapport qui **utilise ce modèle** et dont l'appelant peut lire les données
   (`reportGrantsData` : public, le sien, ou membre du workspace du rapport — **jamais** l'admin
   global par ce chemin).

**`canReadModel`** — métadonnées (`GET /:id`) : `canAccessModel`, ou l'admin global.

**`canWriteModel(model, user, req)`** — OSS : admin/editor du workspace d'attache, créateur, ou admin
global. **`canManageModel`** (suppression, déplacement, partage, RLS, cache) : admin du workspace
d'attache, créateur, ou admin global.

**`canWriteReport(report, user, req)`** — OSS : propriétaire du rapport, admin global, ou membre
`admin`/`editor` du workspace qui contient le rapport (`workspaceRoleOf`). Un membre `viewer` reçoit
**403** (le rapport lui est visible, pas modifiable).

**Lecture vs écriture** :
- Lecture (`GET /api/reports/:id`, `POST /api/models/:id/query`) : gardée par `canAccessReport` /
  `canAccessModel`, **sans** `requireAuth` → un anonyme peut lire un rapport public.
- Écriture : par ces fonctions, **pas** par une clause SQL `WHERE user_id = ?` (il n'en reste
  aucune : les datasources aussi passent par `utils/workspaceAccess.js`).

**`canBuildOnModel(model, user, req)`** — OSS : admin/editor du workspace d'attache du modèle ou
d'un workspace où il est partagé, créateur, ou admin global. Un rapport déjà placé dans un workspace
reste éditable par les éditeurs de ce workspace (`canAuthorReport`) : qui l'y a mis a mis la donnée
devant cette équipe.

**Créer ou modifier un rapport exige `canBuildOnModel`**, pas seulement `canAccessModel`. Lire le
modèle d'autrui via un rapport **public** ne suffit donc pas à bâtir dessus : sinon n'importe quel
compte pouvait créer un rapport sur ce modèle puis le publier, ce qui ouvre `/query` en anonyme sur
des données qui ne sont pas les siennes. La publication reste de toute façon gardée par
`canWriteModel` (ci-dessous), y compris pour un éditeur de workspace.

**`GET /api/models`** liste les modèles des workspaces où le caller est admin/editor et ceux qui y
sont partagés (tout pour l'admin global) ; chaque ligne porte `workspace_id`, `shared_in` et `access`
(`manage` / `edit` / `build`). **`GET /api/datasources`** de même (`access` : `manage` / `read`, ce
dernier pour la source derrière un modèle que l'on édite).

**Datasources** : structure (`GET /:id`, `/tables`, `/columns`) pour qui la lit (`canReadDatasource`) ;
lignes (`/query`) pour un admin/editor de son workspace seulement (`canQueryDatasource`) ; identifiants,
suppression, déplacement pour qui la gère (`canManageDatasource` : admin du workspace, créateur, admin
global) ; création par un admin du workspace cible (`canCreateDatasourceIn`).

> `canBuildOnModel` n'est **pas** `canWriteModel`, même si les deux répondent pareil en OSS. Écrire
> un rapport n'a jamais demandé le droit d'éditer le modèle, et confondre les deux casse le cloud :
> un membre `viewer` de l'organisation qui est `editor` sur un workspace est un auteur de rapports
> légitime (dès que le modèle est disponible dans ce workspace), sans pour autant pouvoir toucher au
> modèle.

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
- **Bypass** pour le **créateur du modèle** et les **admins de son workspace d'attache**
  (`bypassesRls`). L'admin global n'en est pas dispensé : sans rôle il n'atteint pas `/query`,
  avec un rôle d'éditeur ou de lecteur il est filtré comme les autres.
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
| Créer un rapport | ❌ | ❌¹ ² | ✅ ² | ✅ |
| Modifier / supprimer un rapport | ❌ | propriétaire ² | propriétaire ² | ✅ (tous) |
| Créer un modèle / une datasource | ❌ | ❌¹ | ✅ ³ | ✅ |
| Lire les données d'un modèle sans rôle dans son workspace | ❌ | ❌ | ❌ | ❌ |
| Gérer les membres d'un workspace | ❌ | admin du workspace | admin du workspace | ✅ |
| Voir/restaurer l'historique d'un rapport | ❌ | ❌ | ❌ | ✅ |
| Paramètres globaux (`/api/admin/*`) | ❌ | ❌ | ❌ | ✅ |

¹ La création n'est pas bloquée par le rôle global mais par la **propriété de la ressource
parente** (posséder une datasource pour créer un modèle, un modèle pour créer un rapport). Un
`viewer` sans ressource parente ne peut rien créer en pratique.

² Ou membre `admin`/`editor` du workspace concerné (rapports du workspace, modèles qui y vivent ou y
sont partagés), quel que soit le rôle global.

³ Un modèle par un admin/editor du workspace cible, une datasource par un admin de celui-ci.

---

Fichiers de référence : `middleware/auth.js` (auth), le router reports (`canAccessReport`,
`canAccessModel`), `routes/workspaces.js` (`getWorkspaceAccess`), `utils/rls.js` (RLS),
`routes/admin.js` (admin), `db/schema.sql` (tables `users`, `workspaces`, `workspace_members`,
`reports`).
