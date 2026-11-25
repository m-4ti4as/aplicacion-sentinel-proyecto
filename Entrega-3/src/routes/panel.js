'use strict';

const express = require('express');
const metricas = require('../services/metricas');
const { requireAuth, esAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/panel', requireAuth, async (req, res, next) => {
  try {
    if (esAdmin(req)) {
      return res.render('panel/admin', { titulo: 'Panel de seguridad', ...(await metricas.admin()) });
    }
    res.render('panel/colaborador', { titulo: 'Mi panel', ...(await metricas.colaborador(req.session.user.id)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
