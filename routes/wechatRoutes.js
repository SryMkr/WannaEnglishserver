// routes/wechatRoutes.js
const express = require('express');
const router = express.Router();
const wechatController = require('../controllers/wechatController');

router.post('/login', wechatController.login);
router.post('/profile', wechatController.saveProfile);

module.exports = router;
