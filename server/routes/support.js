const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSupportEmail } = require('../utils/settingsHelper');

const router = express.Router();

// Où adresser un signalement de bug. Lisible par tout compte connecté et pas
// seulement par un administrateur : c'est justement le lecteur qui voit le
// visuel casser, et lui refuser l'adresse reviendrait à réserver le droit de
// signaler à ceux qui n'en ont pas besoin.
//
// L'édition cloud n'utilise pas cette route — elle reçoit les rapports sur son
// propre endpoint. Ici la réponse ne sert qu'à composer un lien mailto.
router.get('/', requireAuth, (req, res) => {
  res.json({ email: getSupportEmail() });
});

module.exports = router;
