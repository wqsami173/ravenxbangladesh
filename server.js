const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
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

// Meta Conversions API Configuration
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

// Hash data for Meta
function hashData(value) {
  if (!value) return null;

  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

// Send conversion event to Meta Conversions API
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
      `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
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
      `Meta CompleteRegistration sent successfully. Event ID: ${eventId}`
    );

  } catch (error) {
    console.error("Meta CAPI Error:", error.message);
  }
}

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
      registration_fee,

      // Meta Pixel / CAPI data
      fbp,
      fbc,
      event_source_url
    } = req.body;

    // Save registration to Neon database
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

    // Registration ID will be used as Meta event_id
    const registrationId = result.rows[0].id;

    // Get visitor IP address
    const clientIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    // Get browser user agent
    const userAgent = req.headers["user-agent"] || null;

    // Send CompleteRegistration to Meta through CAPI
    // This runs without delaying the registration response
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

    // Send successful registration response
    res.json({
      success: true,
      message: "Registration successful!",
      registration_id: registrationId
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
