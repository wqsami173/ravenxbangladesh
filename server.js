const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname)));

// Neon Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Test database connection
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "Neon database connected successfully!",
      time: result.rows[0].now
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Database connection failed."
    });
  }
});

// Registration API
app.post("/api/register", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      distance,
      category,
      gender,
      payment_method,
      payment_number,
      trx_id,
      registration_fee
    } = req.body;

    const result = await pool.query(
      `INSERT INTO registrations
      (
        name,
        email,
        phone,
        distance,
        category,
        gender,
        payment_method,
        payment_number,
        trx_id,
        registration_fee
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        name,
        email,
        phone,
        distance,
        category,
        gender,
        payment_method,
        payment_number,
        trx_id,
        registration_fee
      ]
    );

    res.json({
      success: true,
      message: "Registration successful!",
      registration_id: result.rows[0].id
    });

  } catch (error) {
    console.error("Registration Error:", error);

    res.status(500).json({
      success: false,
      message: "Registration failed.",
      error: error.message
    });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`RavenX server running on port ${PORT}`);
});
