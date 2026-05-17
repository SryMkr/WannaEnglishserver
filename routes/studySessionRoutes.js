const express = require("express");
const router = express.Router();
const controller = require("../controllers/studySessionController");

router.get("/word", controller.getStudyWord);
router.get("/word-search", controller.searchStudyWord);
router.get("/stats-overview", controller.getStudyStatsOverview);

// 创建 session（生成 session_id）
router.post("/create", controller.createStudySession);

// 完成 session（更新最终数据）
router.post("/finish", controller.finishStudySession);

module.exports = router;
