# Tests e2e

Des bugs qui n'existent que dans un navigateur qui tourne : une navigation survenue malgré une
sauvegarde refusée, une rafale de requêtes déclenchée par un geste de souris, deux réponses qui
arrivent dans le désordre, et des mises en page que seul un moteur de rendu sait trancher. Aucun
n'est atteignable par un test unitaire — c'est la raison d'être de ce harnais.

| Spec | Garde |
|---|---|
| `save-conflict.spec.js` | Un `PUT` refusé en 409 laisse l'éditeur ouvert, l'erreur à l'écran et les édits en place. Le second cas vérifie qu'une sauvegarde réussie, elle, quitte bien. |
| `warming-burst.spec.js` | Redimensionner un widget ne déclenche aucun `GET /cache-schedules/warming`. |
| `viewer-race.spec.js` | Deux filtres enchaînés : la réponse lente du premier ne doit pas écraser celle du second. |
| `shell-compact.spec.js` | La coquille et l'éditeur sur petit écran : ruban, en-tête, barre d'outils, feuille de réglages — et le glisser d'un champ vers une zone, au doigt comme à la souris. |
| `viewer-stacked.spec.js` | Sous 640 px le viewer empile les widgets en pleine largeur ; au-dessus, et en mode « scale », le canevas en pixels est intact. |

Chaque scénario a été validé en réinjectant la régression : sans son correctif, le test échoue —
navigation vers `/`, 12 requêtes `/warming` (une par frame), la valeur périmée affichée, ou le champ
qui n'a nulle part où atterrir.

## Lancer

```bash
npx playwright install chromium   # une seule fois
npm run test:e2e                  # depuis la racine
```

`test:e2e` construit le client, puis `start-server.js` démarre le vrai serveur sur un
`OPENREPORT_DATA_DIR` **effacé à chaque démarrage** : la suite s'inscrit comme premier compte (donc
admin) et compte des requêtes, elle ne doit hériter ni d'un rapport ni d'une session.

## Ce que la suite simule, et pourquoi

Le modèle pointe une datasource injoignable et `/api/models/*/query` est intercepté. Ce n'est pas un
raccourci : les trois bugs sont côté client, et le scénario de course **exige** de contrôler la
latence des réponses — c'est le seul moyen de rendre le désordre déterministe. Tout le reste (auth,
sessions, sauvegarde, conflit de titre) passe par le vrai serveur.
