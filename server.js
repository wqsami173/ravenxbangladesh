const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

// --------------------------------------------------
// BASIC APP SETUP
// --------------------------------------------------

app.set("trust proxy", true);

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname)));

// --------------------------------------------------
// ENVIRONMENT VARIABLES
// --------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;

const META_PIXEL_ID = process.env.META_PIXEL_ID;

const META_ACCESS_TOKEN =
  process.env.META_ACCESS_TOKEN?.trim();

const META_API_VERSION =
  process.env.META_API_VERSION || "v23.0";

// --------------------------------------------------
// CHECK ENV VARIABLES
// --------------------------------------------------

console.log("=================================");
console.log("RavenX Server Starting...");
console.log("=================================");

console.log(
  "DATABASE_URL:",
  DATABASE_URL ? "Loaded" : "MISSING"
);

console.log(
  "META_PIXEL_ID:",
  META_PIXEL_ID ? "Loaded" : "MISSING"
);

console.log(
  "META_ACCESS_TOKEN:",
  META_ACCESS_TOKEN ? "Loaded" : "MISSING"
);

console.log(
  "META_API_VERSION:",
  META_API_VERSION
);

console.log("=================================");

// --------------------------------------------------
// DATABASE CONNECTION
// --------------------------------------------------

if (!DATABASE_URL) {
  console.error(
    "ERROR: DATABASE_URL is missing from environment variables."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },

  // Prevent hanging requests
  connectionTimeoutMillis: 10000,

  // Keep pool small for free hosting
  max: 5,

  idleTimeoutMillis: 30000
});

// Database error listener
pool.on("error", (err) => {
  console.error(
    "Unexpected PostgreSQL Pool Error:",
    err
  );
});

// --------------------------------------------------
// HASH DATA FOR META
// --------------------------------------------------

function hashData(value) {
  if (!value) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

// --------------------------------------------------
// META CONVERSIONS API
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

    if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {

      console.warn(
        "Meta CAPI skipped: META_PIXEL_ID or META_ACCESS_TOKEN missing."
      );

      return;
    }

    const userData = {};

    // Email
    if (email) {
      userData.em = [
        hashData(email)
      ];
    }

    // Phone
    if (phone) {
      userData.ph = [
        hashData(phone)
      ];
    }

    // IP
    if (clientIp) {
      userData.client_ip_address =
        clientIp;
    }

    // Browser
    if (userAgent) {
      userData.client_user_agent =
        userAgent;
    }

    // Facebook Browser ID
    if (fbp) {
      userData.fbp = fbp;
    }

    // Facebook Click ID
    if (fbc) {
      userData.fbc = fbc;
    }

    const payload = {

      data: [

        {

          event_name:
            "CompleteRegistration",

          event_time:
            Math.floor(Date.now() / 1000),

          event_id:
            String(eventId),

          action_source:
            "website",

          event_source_url:
            eventSourceUrl ||
            "https://ravenxbangladesh.onrender.com/",

          user_data:
            userData,

          custom_data: {

            currency:
              "BDT",

            value:
              Number(registrationFee) || 0

          }

        }

      ]

    };

    const url =
      `https://graph.facebook.com/` +
      `${META_API_VERSION}/` +
      `${META_PIXEL_ID}/events` +
      `?access_token=${META_ACCESS_TOKEN}`;

    console.log(
      "Sending CompleteRegistration to Meta..."
    );

    const response =
      await fetch(url, {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)

      });

    const result =
      await response.json();

    console.log(
      "Meta CAPI Response:",
      result
    );

    if (!response.ok) {

      console.error(
        "Meta CAPI failed:",
        JSON.stringify(result)
      );

      return;
    }

    console.log(
      `Meta CompleteRegistration sent successfully. Event ID: ${eventId}`
    );

  } catch (error) {

    // IMPORTANT:
    // Meta error must NEVER break registration.

    console.error(
      "Meta CAPI Error:",
      error
    );

  }

}

// --------------------------------------------------
// HOMEPAGE
// --------------------------------------------------

app.get("/", (req, res) => {

  res.sendFile(
    path.join(__dirname, "index.html")
  );

});

// --------------------------------------------------
// TEST DATABASE
// --------------------------------------------------

app.get("/api/test-db", async (req, res) => {

  try {

    const result =
      await pool.query(
        "SELECT NOW()"
      );

    res.json({

      success: true,

      message:
        "Neon database connected successfully!",

      time:
        result.rows[0].now

    });

  } catch (error) {

    console.error(
      "DATABASE TEST ERROR:",
      error
    );

    res.status(500).json({

      success: false,

      message:
        "Database connection failed.",

      error:
        error.message

    });

  }

});

// --------------------------------------------------
// REGISTRATION API
// --------------------------------------------------

app.post(
  "/api/register",
  async (req, res) => {

    console.log(
      "================================="
    );

    console.log(
      "NEW REGISTRATION REQUEST"
    );

    console.log(
      "================================="
    );

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
      // VALIDATION
      // --------------------------------------------------

      if (!name) {

        return res.status(400).json({

          success: false,

          message:
            "Name is required."

        });

      }

      if (!email) {

        return res.status(400).json({

          success: false,

          message:
            "Email is required."

        });

      }

      if (!phone) {

        return res.status(400).json({

          success: false,

          message:
            "Phone number is required."

        });

      }

      if (!distance) {

        return res.status(400).json({

          success: false,

          message:
            "Distance is required."

        });

      }

      if (!category) {

        return res.status(400).json({

          success: false,

          message:
            "Category is required."

        });

      }

      if (!gender) {

        return res.status(400).json({

          success: false,

          message:
            "Gender is required."

        });

      }

      if (!payment_method) {

        return res.status(400).json({

          success: false,

          message:
            "Payment method is required."

        });

      }

      if (!payment_number) {

        return res.status(400).json({

          success: false,

          message:
            "Payment number is required."

        });

      }

      if (!trx_id) {

        return res.status(400).json({

          success: false,

          message:
            "Transaction ID is required."

        });

      }

      // --------------------------------------------------
      // NORMALIZE VALUES
      // --------------------------------------------------

      const cleanName =
        String(name).trim();

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const cleanPhone =
        String(phone).trim();

      const cleanDistance =
        String(distance).trim();

      const cleanCategory =
        String(category).trim();

      const cleanGender =
        String(gender).trim();

      const cleanPaymentMethod =
        String(payment_method).trim();

      const cleanPaymentNumber =
        String(payment_number).trim();

      const cleanTrxId =
        String(trx_id).trim();

      const cleanRegistrationFee =
        Number(registration_fee);

      // --------------------------------------------------
      // SAVE REGISTRATION TO NEON
      // --------------------------------------------------

      console.log(
        "Saving registration to Neon..."
      );

      const result =
        await pool.query(

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
          VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`,

          [

            cleanName,

            cleanEmail,

            cleanPhone,

            cleanDistance,

            cleanCategory,

            cleanGender,

            cleanPaymentMethod,

            cleanPaymentNumber,

            cleanTrxId,

            cleanRegistrationFee

          ]

        );

      // --------------------------------------------------
      // REGISTRATION ID
      // --------------------------------------------------

      const registrationId =
        result.rows[0].id;

      console.log(
        "Registration saved successfully."
      );

      console.log(
        "Registration ID:",
        registrationId
      );

      // --------------------------------------------------
      // GET VISITOR IP
      // --------------------------------------------------

      const clientIp =
        req.headers["x-forwarded-for"]
          ?.split(",")[0]
          ?.trim() ||
        req.socket.remoteAddress ||
        null;

      // --------------------------------------------------
      // GET USER AGENT
      // --------------------------------------------------

      const userAgent =
        req.headers["user-agent"] ||
        null;

      // --------------------------------------------------
      // SEND META CAPI
      // --------------------------------------------------
      // Do NOT await this.
      // Meta failure should never break registration.

      sendMetaConversion({

        email:
          cleanEmail,

        phone:
          cleanPhone,

        registrationFee:
          cleanRegistrationFee,

        eventId:
          registrationId,

        fbp,

        fbc,

        eventSourceUrl,

        clientIp,

        userAgent

      });

      // --------------------------------------------------
      // SUCCESS RESPONSE
      // --------------------------------------------------

      return res.json({

        success: true,

        message:
          "Registration successful!",

        registration_id:
          registrationId

      });

    } catch (error) {

      console.error(
        "================================="
      );

      console.error(
        "REGISTRATION ERROR"
      );

      console.error(
        "================================="
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "Code:",
        error.code
      );

      console.error(
        "Detail:",
        error.detail
      );

      console.error(
        "Table:",
        error.table
      );

      console.error(
        "Column:",
        error.column
      );

      console.error(
        "Constraint:",
        error.constraint
      );

      console.error(
        "================================="
      );

      return res.status(500).json({

        success: false,

        message:
          "Registration failed.",

        error:
          error.message

      });

    }

  }
);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(
      `RavenX server running on port ${PORT}`
    );

  }
);
