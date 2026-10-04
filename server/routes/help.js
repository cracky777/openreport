// The user guide, readable without the AI assistant: the same help.md the
// assistant answers "how do I…?" from, so the page and the assistant never
// disagree. It describes the tool, not anyone's data: any signed-in user.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { helpSections } = require('../utils/ai/help');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ sections: helpSections() });
});

module.exports = router;
