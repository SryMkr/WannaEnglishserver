const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/gender', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT gender_code AS code, gender_name AS name FROM gender_code");
        res.json(rows);
    } catch (err) {
        console.error("get gender list error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

router.get('/education', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT education_level_code AS code, education_level_name AS name FROM education_level_code");
        res.json(rows);
    } catch (err) {
        console.error("get education list error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

router.get('/province', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT province_code AS code, province_name AS name FROM province_code");
        res.json(rows);
    } catch (err) {
        console.error("get province list error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;
