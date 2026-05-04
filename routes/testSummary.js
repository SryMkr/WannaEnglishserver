const express = require("express");
const router = express.Router();
const controller = require("../controllers/testSummaryController");

router.post("/save", controller.saveTestSummary);

module.exports = router;
