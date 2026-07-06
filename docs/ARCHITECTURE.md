# Architecture — OpenReport

Vue d'ensemble du système, du plus large au plus fin. Doc **courte et volontairement à gros
grain** : pour le détail, elle renvoie aux sources de vérité plutôt que de les recopier.

- Stack, commandes, carte du code, surfaces sensibles, conventions → **`CLAUDE.md`** (racine).
- Spécification du cache de pré-agrégation → **`ROLLUP-CACHE.md`** (racine).
- Contrat HTTP → **[API.md](API.md)** · modèle de permissions → **[AUTHORIZATION.md](AUTHORIZATION.md)**.

Diagrammes en Mermaid (rendus sur GitHub / VS Code).

## En une phrase

OpenReport est un outil BI self-host : on connecte une base (**datasource**), on définit une couche
sémantique (**model** : dimensions, mesures, jointures, RLS), on compose des **reports** à widgets,
et l'application compile puis exécute du SQL multi-dialecte, avec un cache de pré-agrégation.

## Trois plans de données séparés

La donnée est répartie sur trois stockages aux rôles distincts — c'est un choix de design central :

| Plan | Stockage | Contenu |
|---|---|---|
| **Control plane** | SQLite (`server/data/open-report.db`, WAL) | Métadonnées de l'app : `users`, `datasources`, `models`, `reports`, `report_versions`, `workspaces`, `workspace_members`, `custom_visuals`, `cache_schedules`, `rollups` (manifest), `app_settings`, et les sessions. |
| **Cache layer** | DuckDB (`server/data/rollups_*.duckdb`) | Tables de pré-agrégation (rollups), fichiers par génération, bascule blue-green. |
| **Data plane** | Bases externes des clients | Données analytiques brutes (Postgres / MySQL / MSSQL / BigQuery / DuckDB). Interrogées en live ; **la donnée client reste chez le client**. |

Les secrets de connexion (`datasources.db_password`, credentials dans `extra_config`) sont
**chiffrés au repos en AES-256-GCM** (clé `DATASOURCE_ENC_KEY`), déchiffrés uniquement au moment de
créer la connexion.

## 1. Couches & composants

```mermaid
flowchart TB
  subgraph Client["Client — React 19 / Vite"]
    UI["Pages: Dashboard, Editor, Viewer, ModelEditor"]
    WIDG["Widgets ECharts + builders<br/>(widgetQueryPayload, widgetDataBuilder)"]
    AX["axios — baseURL /api"]
    UI --> WIDG --> AX
  end

  subgraph Server["Serveur — Express 4 (Node, port 3001)"]
    RT["Routers /api/*<br/>models, reports, datasources, admin, workspaces, rollups..."]
    AUTH["Auth — passport + session + internalToken (loopback)"]
    ENG["Moteur SQL — compilateur<br/>sqlBuilder, sqlDialect, measureType, rls"]
    ROLL["Cache rollup<br/>rollupBuilder, rollupPlanner, rollupDuckDB"]
    QC["queryCache (LRU + TTL)"]
    CONN["dbConnector (multi-moteurs, creds déchiffrés)"]
  end

  subgraph Data["Stockage — 3 plans séparés"]
    META[("SQLite<br/>métadonnées (control plane)")]
    RUP[("DuckDB<br/>rollups (cache)")]
  end
  EXT[("Bases externes des clients (data plane)<br/>Postgres / MySQL / MSSQL / BigQuery / DuckDB")]

  AX -->|"HTTP /api"| RT
  RT --> AUTH
  RT --> ENG
  ENG --> ROLL
  ROLL --> QC --> CONN
  CONN -->|"requête live"| EXT
  ROLL <-->|"lecture / écriture"| RUP
  RT <--> META
  AUTH <--> META

  classDef strong fill:#eafaf1,stroke:#27ae60,stroke-width:1px,color:#1e8449;
  class META,RUP,EXT strong
```

Le moteur SQL (`ENG`) concentre la complexité du produit ; c'est aussi le plus gros fichier
(`routes/models.js`, cible de découpe future — voir *God-files* dans `CLAUDE.md`).

## 2. Modèle conceptuel

La chaîne métier : **datasource** → **model** (sémantique, colonnes JSON) → **report** (layout +
widgets). Tables de la base de métadonnées.

```mermaid
erDiagram
  USERS ||--o{ DATASOURCES : "crée"
  DATASOURCES ||--o{ MODELS : "alimente"
  MODELS ||--o{ REPORTS : "structure"
  WORKSPACES ||--o{ REPORTS : "contient"
  WORKSPACES ||--o{ WORKSPACE_MEMBERS : "regroupe"
  USERS ||--o{ WORKSPACE_MEMBERS : "appartient"
  REPORTS ||--o{ REPORT_VERSIONS : "historise (20 max)"
  WORKSPACES ||--o{ CUSTOM_VISUALS : "héberge"
  MODELS {
    json dimensions
    json measures
    json joins
    json rls
    json column_types
  }
  DATASOURCES {
    text db_type
    text db_password "chiffré AES-256-GCM (DATASOURCE_ENC_KEY)"
  }
```

## 3. Flux d'une requête de widget

Le chemin le plus important : `POST /api/models/:id/query`. La route est **publique par design**
(pour permettre les rapports publics) ; le contrôle d'accès `canAccessModel` / `canAccessReport`
est l'**unique barrière** avant le SQL. L'assemblage SQL reste la surface d'injection à protéger :
tout identifiant/valeur passe par `quoteIdent` / `quoteLiteral` ou est coercé en nombre, et les
expressions free-SQL *report-scoped* sont retirées pour les non-propriétaires.

```mermaid
flowchart TD
  A["Client — POST /api/models/:id/query<br/>dimensions, mesures, filtres, reportId"] --> B{"canAccessModel /<br/>canAccessReport ?<br/>(seule barrière)"}
  B -->|"refusé"| X["403"]
  B -->|"autorisé (owner, admin,<br/>membre, ou rapport public)"| C["parseModel — charge le modèle JSON"]
  C --> D{"rollupPlanner :<br/>servable depuis un rollup ?"}
  D -->|"oui — grain compatible"| E["Lire le fichier DuckDB de rollup<br/>+ recomposer les mesures (measureType)"]
  D -->|"non"| F["Assembler le SQL<br/>sqlBuilder + sqlDialect + measureType + rls"]
  F --> G{"queryCache<br/>(datasource + sql + rls)"}
  G -->|"hit"| R["Réponse data"]
  G -->|"miss"| H["dbConnector — exécute sur la base externe"]
  H --> R
  E --> R
  R --> Z["Données renvoyées au widget (ECharts)"]

  classDef weak fill:#fef5e7,stroke:#e67e22,stroke-width:1px,color:#9c640c;
  class F weak
```

> Les étapes B→R (parse, plan, build SQL, cache, exec) vivent aujourd'hui dans un seul gros
> handler. Les boîtes sont les coutures naturelles d'une découpe ultérieure sans changement de
> comportement.

## 4. Cache de pré-agrégation (rollup)

Deux temps : **construction** (à froid, planifiée ou manuelle) et **service** (à la requête). Le
builder réutilise **le même compilateur** que les requêtes via un appel `/query` en boucle locale
(cohérence cache/live garantie). Détails complets dans `ROLLUP-CACHE.md`.

```mermaid
flowchart LR
  subgraph Build["Construction (à froid)"]
    direction TB
    CR["cacheScheduler (node-cron)<br/>ou Refresh manuel"] --> PB["rollupBuilder — énumère les grains"]
    PB --> BR["build par grain"]
    BR --> DEC["measureType — décompose les mesures<br/>additif / AVG / ratio / COUNT DISTINCT (HLL)"]
    DEC --> LB["appel loopback /query (jeton interne)<br/>réutilise le compilateur"]
    LB --> WR["écrit rollups_*.duckdb<br/>+ bascule le manifest (build coalescé par modèle)"]
  end

  subgraph Serve["Service (à la requête)"]
    direction TB
    PL["rollupPlanner.tryServeFromRollup"] --> CH{"grain demandé<br/>couvert par un rollup ?"}
    CH -->|"oui"| RC["recompose les mesures<br/>depuis les atomes additifs"]
    CH -->|"non / non décomposable"| LV["fallback live<br/>(base externe)"]
  end

  WR -. "alimente" .-> PL

  classDef strong fill:#eafaf1,stroke:#27ae60,stroke-width:1px,color:#1e8449;
  class DEC,RC strong
```

## 5. Authentification & contrôle d'accès

Deux voies d'entrée : l'utilisateur (session passport, stockée en SQLite) et le **jeton interne**
que l'app se présente à elle-même pour le réchauffage du cache — désormais dérivé d'un secret
dédié obligatoire (`INTERNAL_TOKEN_SECRET`, distinct de `SESSION_SECRET`) et **restreint aux
requêtes loopback**. Le cloisonnement multi-client repose sur `canAccessReport` / `canAccessModel`,
puis la **RLS** injectée dans le `WHERE` (voir [AUTHORIZATION.md](AUTHORIZATION.md)).

```mermaid
flowchart TD
  U["Utilisateur"] -->|"login local"| P["passport-local + express-session<br/>(session en SQLite)"]
  P --> RA["requireAuth sur les routes"]
  SELF["Builder de rollup<br/>(appel interne de l'app)"] -->|"x-or-internal-token (JWT)"| IT["internalToken middleware<br/>loopback-only + secret dédié"]
  RA --> AC{"Contrôle d'accès<br/>canAccessReport / canAccessModel"}
  IT --> AC
  AC -->|"owner / admin / membre / public"| OK["accès accordé"]
  OK --> RLS["RLS injectée dans le WHERE<br/>(rls.js) — free-SQL strippé pour non-owners"]
  AC -->|"sinon"| NO["403"]

  classDef strong fill:#eafaf1,stroke:#27ae60,stroke-width:1px,color:#1e8449;
  class P strong
```

**Limitations connues** (documentées, non des régressions) : la RLS est un filtre SQL appliqué au
`WHERE` du modèle — le durcissement free-SQL ferme le vecteur principal de contournement, mais ce
modèle reste applicatif (pas d'isolation au niveau base). Voir `CLAUDE.md` § « Surfaces sensibles ».

---

> Pour les emplacements précis dans le code et l'état de la dette, voir `CLAUDE.md` (carte du code,
> god-files, surfaces sensibles). Cette doc évite volontairement les numéros de ligne pour rester
> valable après refactor.
