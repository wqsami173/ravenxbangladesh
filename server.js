const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname)));

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing!");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("❌ Unexpected PostgreSQL pool error:", err);
});

// --------------------------------------------------
// META CONVERSIONS API
// --------------------------------------------------

const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

// --------------------------------------------------
// HASH DATA
// --------------------------------------------------

function hashData(value) {
  if (!value) return null;

  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

// --------------------------------------------------
// META CAPI
// --------------------------------------------------

async function sendMetaConversion({
  email,
  phone,
  registrationFee,
  eventId,
  fbp,
  fbc,
  eventSourceUrl,
  clientIp,
  userAgent
}) {
  try {
    // Don't attempt Meta API if credentials are missing
    if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
      console.warn("⚠️ Meta CAPI credentials are missing.");
      return;
    }

    const userData = {};

    if (email) {
      userData.em = [hashData(email)];
    }

    if (phone) {
      userData.ph = [hashData(phone)];
    }

    if (clientIp) {
      userData.client_ip_address = clientIp;
    }

    if (userAgent) {
      userData.client_user_agent = userAgent;
    }

    if (fbp) {
      userData.fbp = fbp;
    }

    if (fbc) {
      userData.fbc = fbc;
    }

    const payload = {
      data: [
        {
          event_name: "CompleteRegistration",
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(eventId),
          action_source: "website",

          event_source_url:
            eventSourceUrl ||
            "https://ravenxbangladesh.onrender.com/",

          user_data: userData,

          custom_data: {
            currency: "BDT",
            value: Number(registrationFee) || 0
          }
        }
      ]
    };

    const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();

    console.log("Meta CAPI Response:", result);

    if (!response.ok) {
      throw new Error(JSON.stringify(result));
    }

    console.log(
      `✅ Meta CompleteRegistration sent. Event ID: ${eventId}`
    );

  } catch (error) {
    // Meta failure should NEVER break registration
    console.error("⚠️ Meta CAPI Error:", error.message);
  }
}

// --------------------------------------------------
// HOME PAGE
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --------------------------------------------------
// DATABASE TEST
// --------------------------------------------------

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");

    res.json({
      success: true,
      message: "Neon database connected successfully!",
      time: result.rows[0].now
    });

  } catch (error) {
    console.error("❌ Database Test Error:", error);

    res.status(500).json({
      success: false,
      message: "Database connection failed.",
      error: error.message
    });
  }
});

// --------------------------------------------------
// REGISTRATION
// --------------------------------------------------

app.post("/api/register", async (req, res) => {

  console.log("====================================");
  console.log("📥 REGISTRATION REQUEST RECEIVED");
  console.log("====================================");

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
      registration_fee,

      // Meta data
      fbp,
      fbc,
      event_source_url
    } = req.body;

    // --------------------------------------------------
    // BASIC VALIDATION
    // --------------------------------------------------

    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email and phone are required."
      });
    }

    if (!distance) {
      return res.status(400).json({
        success: false,
        message: "Distance is required."
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required."
      });
    }

    if (!gender) {
      return res.status(400).json({
        success: false,
        message: "Gender is required."
      });
    }

    if (!payment_method) {
      return res.status(400).json({
        success: false,
        message: "Payment method is required."
      });
    }

    if (!payment_number || !trx_id) {
      return res.status(400).json({
        success: false,
        message: "Payment number and transaction ID are required."
      });
    }

    // --------------------------------------------------
    // DATABASE INSERT
    // --------------------------------------------------

    console.log("🗄️ Attempting database INSERT...");

    const result = await pool.query(
      `
      INSERT INTO registrations
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
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
      `,
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
        Number(registration_fee) || 0
      ]
    );

    console.log("✅ Database INSERT successful.");

    const registrationId = result.rows[0].id;

    console.log("🆔 Registration ID:", registrationId);

    // --------------------------------------------------
    // GET CLIENT IP
    // --------------------------------------------------

    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    // --------------------------------------------------
    // USER AGENT
    // --------------------------------------------------

    const userAgent =
      req.headers["user-agent"] || null;

    // --------------------------------------------------
    // META CAPI
    // --------------------------------------------------

    // Important:
    // We DON'T await this.
    // Meta failure cannot cause registration failure.

    sendMetaConversion({
      email,
      phone,
      registrationFee: registration_fee,
      eventId: registrationId,
      fbp,
      fbc,
      eventSourceUrl,
      clientIp,
      userAgent
    });

    // --------------------------------------------------
    // SUCCESS RESPONSE
    // --------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Registration successful!",
      registration_id: registrationId
    });

  } catch (error) {

    console.error("====================================");
    console.error("❌ REGISTRATION ERROR");
    console.error("====================================");
    console.error("Message:", error.message);
    console.error("Code:", error.code);
    console.error("Detail:", error.detail);
    console.error("Constraint:", error.constraint);
    console.error("Table:", error.table);
    console.error("Column:", error.column);
    console.error("Full error:", error);
    console.error("====================================");

    return res.status(500).json({
      success: false,
      message: "Registration failed.",
      error: error.message,
      code: error.code || null
    });
  }
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("====================================");
  console.log(`🚀 RavenX server running on port ${PORT}`);
  console.log("====================================");
});
