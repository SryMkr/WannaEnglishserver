const express = require("express");
const router = express.Router();
const controller = require("../controllers/remoteConfigController");

router.post("/resource-badge", controller.resolveResourceBadge);
router.post("/event", controller.recordRemoteConfigEvent);

module.exports = router;
