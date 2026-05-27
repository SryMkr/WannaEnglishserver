// routes/wechatRoutes.js
const express = require('express');
const router = express.Router();
const wechatController = require('../controllers/wechatController');

router.post('/login', wechatController.login);
router.post('/profile', wechatController.saveProfile);
router.get('/customer-service', wechatController.verifyCustomerServiceWebhook);
router.post(
    '/customer-service',
    express.text({ type: ['text/*', 'application/xml', 'text/xml', '*/xml'], limit: '64kb' }),
    wechatController.handleCustomerServiceMessage
);

module.exports = router;
