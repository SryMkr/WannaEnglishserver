const express = require("express");
const router = express.Router();
const controller = require("../controllers/friendRoomController");

router.post("/create", controller.create);
router.post("/join", controller.join);
router.get("/status", controller.status);
router.post("/ready", controller.ready);
router.post("/start", controller.start);
router.post("/leave", controller.leave);

module.exports = router;
