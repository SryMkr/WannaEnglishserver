const express = require("express");
const router = express.Router();
const controller = require("../controllers/actionLogController");

router.post("/batch", controller.batchInsertActionLogs);
router.get("/room", controller.getRoomActionLogs);

module.exports = router;
