const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ===============================
// POSTGRESQL
// ===============================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

// ===============================
// DATABASE TABLE
// ===============================

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS registrations (
            id SERIAL PRIMARY KEY,
            registration_id TEXT UNIQUE,

            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,

            distance TEXT NOT NULL,
            category TEXT NOT NULL,

            student_id_file TEXT,

            gender TEXT NOT NULL,

            payment_method TEXT NOT NULL,
            payment_number TEXT NOT NULL,
            trx_id TEXT NOT NULL UNIQUE,

            amount INTEGER NOT NULL,

            payment_status TEXT DEFAULT 'Pending',
            registration_status TEXT DEFAULT 'Active',

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("PostgreSQL database initialized.");
}

// ===============================
// MIDDLEWARE
// ===============================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(uploadDir));

app.use(express.static(path.join(__dirname, "public")));

// ===============================
// MULTER
// ===============================

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {

        const ext = path.extname(file.originalname);

        const uniqueName =
            Date.now() +
            "-" +
            Math.round(Math.random() * 1E9) +
            ext;

        cb(null, uniqueName);
    }
});

const upload = multer({

    storage: storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    "Only JPG, PNG and WEBP images are allowed."
                )
            );
        }
    }
});

// ===============================
// PRICE
// ===============================

function getAmount(category) {

    if (category === "student") {
        return 599;
    }

    return 649;
}

// ===============================
// REGISTRATION ID
// ===============================

function generateRegistrationId() {

    const random =
        Math.floor(10000 + Math.random() * 90000);

    return `RX26-${random}`;
}

// ===============================
// REGISTER
// ===============================

app.post(
    "/api/register",
    upload.single("student_id"),

    async (req, res) => {

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
                trx_id
            } = req.body;

            // REQUIRED FIELDS

            if (
                !name ||
                !email ||
                !phone ||
                !distance ||
                !category ||
                !gender ||
                !payment_method ||
                !payment_number ||
                !trx_id
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Please fill in all required fields."
                });
            }

            // STUDENT ID

            if (
                category === "student" &&
                !req.file
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Student ID card is required."
                });
            }

            // DISTANCE

            const allowedDistances = [
                "3.1km",
                "6.66km",
                "13km"
            ];

            if (!allowedDistances.includes(distance)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid distance selected."
                });
            }

            // CATEGORY

            const allowedCategories = [
                "student",
                "regular"
            ];

            if (!allowedCategories.includes(category)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid category."
                });
            }

            // PAYMENT METHOD

            const allowedPayments = [
                "Bkash",
                "Nagad",
                "Rocket"
            ];

            if (!allowedPayments.includes(payment_method)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid payment method."
                });
            }

            // DUPLICATE TRANSACTION

            const existingTrx = await pool.query(
                `
                SELECT id
                FROM registrations
                WHERE trx_id = $1
                `,
                [trx_id.trim()]
            );

            if (existingTrx.rows.length > 0) {

                return res.status(409).json({
                    success: false,
                    message: "This Transaction ID has already been used."
                });
            }

            // DUPLICATE PHONE

            const existingPhone = await pool.query(
                `
                SELECT id
                FROM registrations
                WHERE phone = $1
                `,
                [phone.trim()]
            );

            if (existingPhone.rows.length > 0) {

                return res.status(409).json({
                    success: false,
                    message: "This phone number is already registered."
                });
            }

            // DUPLICATE EMAIL

            const existingEmail = await pool.query(
                `
                SELECT id
                FROM registrations
                WHERE email = $1
                `,
                [email.trim()]
            );

            if (existingEmail.rows.length > 0) {

                return res.status(409).json({
                    success: false,
                    message: "This email is already registered."
                });
            }

            // AMOUNT

            const amount = getAmount(category);

            // REGISTRATION ID

            let registrationId;
            let exists = true;

            while (exists) {

                registrationId = generateRegistrationId();

                const check = await pool.query(
                    `
                    SELECT id
                    FROM registrations
                    WHERE registration_id = $1
                    `,
                    [registrationId]
                );

                exists = check.rows.length > 0;
            }

            // STUDENT FILE

            const studentFile =
                req.file
                    ? req.file.filename
                    : null;

            // INSERT

            await pool.query(
                `
                INSERT INTO registrations (
                    registration_id,
                    name,
                    email,
                    phone,
                    distance,
                    category,
                    student_id_file,
                    gender,
                    payment_method,
                    payment_number,
                    trx_id,
                    amount,
                    payment_status,
                    registration_status
                )

                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12,
                    'Pending',
                    'Active'
                )
                `,

                [
                    registrationId,
                    name.trim(),
                    email.trim(),
                    phone.trim(),
                    distance,
                    category,
                    studentFile,
                    gender,
                    payment_method,
                    payment_number.trim(),
                    trx_id.trim(),
                    amount
                ]
            );

            // SUCCESS

            return res.status(201).json({

                success: true,

                message:
                    "Registration submitted successfully.",

                registration: {

                    registration_id:
                        registrationId,

                    name,
                    email,
                    phone,
                    distance,
                    category,
                    amount,
                    payment_method,
                    trx_id,

                    payment_status:
                        "Pending"
                }
            });

        } catch (error) {

            console.error(error);

            if (error.code === "23505") {

                return res.status(409).json({
                    success: false,
                    message:
                        "This registration information is already registered."
                });
            }

            return res.status(500).json({
                success: false,
                message:
                    "Server error. Please try again."
            });
        }
    }
);

// ===============================
// GET ALL REGISTRATIONS
// ===============================

app.get(
    "/api/registrations",

    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT *
                FROM registrations
                ORDER BY id DESC
            `);

            res.json({

                success: true,

                count:
                    result.rows.length,

                registrations:
                    result.rows
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Could not load registrations."
            });
        }
    }
);

// ===============================
// GET SINGLE REGISTRATION
// ===============================

app.get(
    "/api/registration/:registrationId",

    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT *
                FROM registrations
                WHERE registration_id = $1
                `,
                [req.params.registrationId]
            );

            const registration =
                result.rows[0];

            if (!registration) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Registration not found."
                });
            }

            res.json({
                success: true,
                registration
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Server error."
            });
        }
    }
);

// ===============================
// UPDATE PAYMENT
// ===============================

app.patch(
    "/api/registration/:registrationId/payment",

    async (req, res) => {

        try {

            const {
                payment_status
            } = req.body;

            const allowed = [
                "Pending",
                "Verified",
                "Rejected"
            ];

            if (!allowed.includes(payment_status)) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment status."
                });
            }

            const result = await pool.query(
                `
                UPDATE registrations
                SET payment_status = $1
                WHERE registration_id = $2
                `,
                [
                    payment_status,
                    req.params.registrationId
                ]
            );

            if (result.rowCount === 0) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Registration not found."
                });
            }

            res.json({
                success: true,
                message:
                    "Payment status updated."
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Server error."
            });
        }
    }
);

// ===============================
// DELETE REGISTRATION
// ===============================

app.delete(
    "/api/registration/:registrationId",

    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT *
                FROM registrations
                WHERE registration_id = $1
                `,
                [req.params.registrationId]
            );

            const registration =
                result.rows[0];

            if (!registration) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Registration not found."
                });
            }

            // DELETE STUDENT FILE

            if (registration.student_id_file) {

                const filePath =
                    path.join(
                        uploadDir,
                        registration.student_id_file
                    );

                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // DELETE DATABASE RECORD

            await pool.query(
                `
                DELETE FROM registrations
                WHERE registration_id = $1
                `,
                [req.params.registrationId]
            );

            res.json({
                success: true,
                message:
                    "Registration deleted."
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Server error."
            });
        }
    }
);

// ===============================
// ERROR HANDLER
// ===============================

app.use(
    (error, req, res, next) => {

        if (error instanceof multer.MulterError) {

            if (error.code === "LIMIT_FILE_SIZE") {

                return res.status(400).json({
                    success: false,
                    message:
                        "Student ID image must be smaller than 5MB."
                });
            }
        }

        if (error) {

            return res.status(400).json({
                success: false,
                message:
                    error.message
            });
        }

        next();
    }
);

// ===============================
// START SERVER
// ===============================

async function startServer() {

    try {

        await initDatabase();

        app.listen(
            PORT,
            "0.0.0.0",

            () => {

                console.log(
                    `RavenX server running on port ${PORT}`
                );
            }
        );

    } catch (error) {

        console.error(
            "Failed to start server:",
            error
        );

        process.exit(1);
    }
}

startServer();