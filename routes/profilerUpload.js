const express = require("express");
const router = express.Router();
const controller = require("../controllers/profilerUploadController");

router.post("/", controller.uploadProfilerData);

module.exports = router;
