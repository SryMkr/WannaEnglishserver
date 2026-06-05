const express = require("express");
const router = express.Router();
const controller = require("../controllers/modeEntryController");

router.post("/", controller.recordModeEntry);

module.exports = router;
