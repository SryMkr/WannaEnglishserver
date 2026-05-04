const express = require("express");
const router = express.Router();
const controller = require("../controllers/aiController");

router.post("/question", controller.generateQuestion);

module.exports = router;
