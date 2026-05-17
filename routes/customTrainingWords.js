const express = require("express");
const router = express.Router();
const controller = require("../controllers/customTrainingWordsController");

router.get("/", controller.getCustomTrainingWords);
router.put("/", controller.saveCustomTrainingWords);

module.exports = router;
