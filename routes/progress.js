// routes/progress.js
const express = require("express");
const router = express.Router();
const controller = require("../controllers/progressController");

router.post("/saveWordProgress", controller.saveWordProgress);

module.exports = router;
