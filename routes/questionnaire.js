const express = require('express');
const router = express.Router();
const controller = require('../controllers/questionnaireController');

router.post('/submit', controller.submitSurvey);

module.exports = router;
