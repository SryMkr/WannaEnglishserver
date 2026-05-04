// routes/device.js

const express = require('express');
const router = express.Router();
const controller = require('../controllers/deviceController');

// 上传设备信息
router.post('/upload', controller.uploadDeviceInfo);

module.exports = router;
