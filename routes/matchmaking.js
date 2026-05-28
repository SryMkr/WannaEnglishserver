const express = require("express");
const router = express.Router();
const controller = require("../controllers/matchmakingController");

router.post("/enqueue", controller.enqueue);
router.get("/status", controller.getStatus);
router.post("/cancel", controller.cancel);
router.post("/rematch", controller.rematch);
router.post("/heartbeat", controller.heartbeat);
router.post("/resume", controller.resume);

module.exports = router;
