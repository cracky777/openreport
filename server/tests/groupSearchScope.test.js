// La table des groupes est globale à l'instance. Sans borne, la recherche
// suggérait noms et effectifs de TOUS les groupes à tout compte connecté — en
// cloud multi-locataires, l'org A lisait les groupes de l'org B, et un nom de
// groupe est parfois parlant (« Direction-ClientX »). Même règle que pour les
// utilisateurs, désormais : un non-admin ne voit que ce qui touche son cercle
// de collaboration ; l'admin d'instance garde tout, il gère déjà les groupes.
const request = require('supertest');
const { buildApp, seedUser, seedGroup, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const search = (user, q) => request(app)
  .get('/api/auth/users/search').query({ q }).set('x-test-user', user);

// Le nom de groupe est UNIQUE au niveau de l'instance et la base survit d'un
// test à l'autre : chaque test travaille donc sous son propre préfixe.
let alice; let bob; let carol; let admin; let nonce;
beforeEach(() => {
  nonce = 'g' + Math.random().toString(36).slice(2, 8);
  alice = seedUser({ role: 'editor' });
  bob = seedUser({ role: 'editor' });
  carol = seedUser({ role: 'editor' });
  admin = seedUser({ role: 'admin' });
  seedGroup({ name: nonce + '-ventes', memberIds: [alice] });
  seedGroup({ name: nonce + '-secrete', memberIds: [bob] });
});

test('chacun voit son propre groupe, pas celui du voisin', async () => {
  const res = await search(alice, nonce);
  expect(res.status).toBe(200);
  expect(res.body.groups.map((g) => g.name)).toEqual([nonce + '-ventes']);
});

test('sans groupe ni espace partagé, aucune suggestion', async () => {
  const res = await search(carol, nonce);
  expect(res.body.groups).toEqual([]);
});

// Le pont est l'espace de travail : partager un workspace avec un membre du
// groupe suffit à voir ce groupe — c'est la règle déjà appliquée aux
// suggestions d'utilisateurs, juste au-dessus dans le même fichier.
test('partager un espace avec un membre du groupe ouvre la suggestion', async () => {
  const ws = seedWorkspace({ ownerId: alice, name: 'WS partagé' });
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'viewer')")
    .run(ws, carol);
  const res = await search(carol, nonce);
  expect(res.body.groups.map((g) => g.name)).toEqual([nonce + '-ventes']);
});

test('l’admin d’instance voit tout — il gère les groupes eux-mêmes', async () => {
  const res = await search(admin, nonce);
  expect(res.body.groups.map((g) => g.name).sort()).toEqual([nonce + '-secrete', nonce + '-ventes']);
});
