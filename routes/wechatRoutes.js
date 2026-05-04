// routes/wechatRoutes.js
const express = require('express');
const router = express.Router();
const wechatController = require('../controllers/wechatController');

router.post('/login', wechatController.login);

module.exports = router;
