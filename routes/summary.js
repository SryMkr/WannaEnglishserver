const express = require("express");
const router = express.Router();
const controller = require("../controllers/summaryController");

// 统计每日模式进入次数
router.post("/daily", controller.saveDailySummary);

module.exports = router;
