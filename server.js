const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();

const PORT = 3000;

// ===============================
// FOLDERS
// ===============================

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ===============================
// DATABASE
// ===============================

const db = new Database("ravenx.db");

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

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

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

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
            cb(new Error("Only JPG, PNG and WEBP images are allowed."));
        }
    }
});

// ===============================
// PRICE FUNCTION
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

    const random = Math.floor(10000 + Math.random() * 90000);

    return `RX26-${random}`;
}

// ===============================
// CREATE REGISTRATION
// ===============================

app.post(
    "/api/register",
    upload.single("student_id"),
    (req, res) => {

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

            // ===============================
            // REQUIRED VALIDATION
            // ===============================

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

            // ===============================
            // STUDENT ID
            // ===============================

            if (
                category === "student" &&
                !req.file
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Student ID card is required."
                });
            }

            // ===============================
            // VALID DISTANCE
            // ===============================

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

            // ===============================
            // VALID CATEGORY
            // ===============================

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

            // ===============================
            // VALID PAYMENT METHOD
            // ===============================

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

            // ===============================
            // CHECK DUPLICATE TRANSACTION
            // ===============================

            const existingTrx = db
                .prepare(
                    "SELECT id FROM registrations WHERE trx_id = ?"
                )
                .get(trx_id);

            if (existingTrx) {

                return res.status(409).json({
                    success: false,
                    message: "This Transaction ID has already been used."
                });
            }

            // ===============================
            // CHECK DUPLICATE PHONE
            // ===============================

            const existingPhone = db
                .prepare(
                    `
                    SELECT id
                    FROM registrations
                    WHERE phone = ?
                    `
                )
                .get(phone);

            if (existingPhone) {

                return res.status(409).json({
                    success: false,
                    message: "This phone number is already registered."
                });
            }

            // ===============================
            // EMAIL CHECK
            // ===============================

            const existingEmail = db
                .prepare(
                    `
                    SELECT id
                    FROM registrations
                    WHERE email = ?
                    `
                )
                .get(email);

            if (existingEmail) {

                return res.status(409).json({
                    success: false,
                    message: "This email is already registered."
                });
            }

            // ===============================
            // AMOUNT
            // ===============================

            const amount = getAmount(category);

            // ===============================
            // REGISTRATION ID
            // ===============================

            let registrationId;

            do {

                registrationId = generateRegistrationId();

            } while (
                db
                    .prepare(
                        "SELECT id FROM registrations WHERE registration_id = ?"
                    )
                    .get(registrationId)
            );

            // ===============================
            // STUDENT FILE
            // ===============================

            const studentFile = req.file
                ? req.file.filename
                : null;

            // ===============================
            // INSERT
            // ===============================

            const insert = db.prepare(`
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

                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    'Pending',
                    'Active'

                )
            `);

            insert.run(

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
            );

            // ===============================
            // SUCCESS RESPONSE
            // ===============================

            return res.status(201).json({

                success: true,

                message:
                    "Registration submitted successfully.",

                registration: {

                    registration_id: registrationId,

                    name: name,

                    email: email,

                    phone: phone,

                    distance: distance,

                    category: category,

                    amount: amount,

                    payment_method: payment_method,

                    trx_id: trx_id,

                    payment_status: "Pending"

                }

            });

        } catch (error) {

            console.error(error);

            return res.status(500).json({

                success: false,

                message: "Server error. Please try again."

            });

        }
    }
);

// ===============================
// GET ALL REGISTRATIONS
// ADMIN API
// ===============================

app.get("/api/registrations", (req, res) => {

    try {

        const registrations = db
            .prepare(`
                SELECT *
                FROM registrations
                ORDER BY id DESC
            `)
            .all();

        res.json({

            success: true,

            count: registrations.length,

            registrations

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message: "Could not load registrations."

        });

    }
});

// ===============================
// GET SINGLE REGISTRATION
// ===============================

app.get(
    "/api/registration/:registrationId",
    (req, res) => {

        try {

            const registration = db
                .prepare(`
                    SELECT *
                    FROM registrations
                    WHERE registration_id = ?
                `)
                .get(req.params.registrationId);

            if (!registration) {

                return res.status(404).json({

                    success: false,

                    message: "Registration not found."

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

                message: "Server error."

            });

        }
    }
);

// ===============================
// UPDATE PAYMENT STATUS
// ===============================

app.patch(
    "/api/registration/:registrationId/payment",
    (req, res) => {

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

                    message: "Invalid payment status."

                });

            }

            const result = db
                .prepare(`
                    UPDATE registrations

                    SET payment_status = ?

                    WHERE registration_id = ?
                `)
                .run(
                    payment_status,
                    req.params.registrationId
                );

            if (result.changes === 0) {

                return res.status(404).json({

                    success: false,

                    message: "Registration not found."

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

                message: "Server error."

            });

        }
    }
);

// ===============================
// DELETE REGISTRATION
// ===============================

app.delete(
    "/api/registration/:registrationId",
    (req, res) => {

        try {

            const registration = db
                .prepare(`
                    SELECT *
                    FROM registrations
                    WHERE registration_id = ?
                `)
                .get(req.params.registrationId);

            if (!registration) {

                return res.status(404).json({

                    success: false,

                    message: "Registration not found."

                });

            }

            // Delete student ID file

            if (registration.student_id_file) {

                const filePath = path.join(
                    uploadDir,
                    registration.student_id_file
                );

                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // Delete database record

            db
                .prepare(`
                    DELETE FROM registrations
                    WHERE registration_id = ?
                `)
                .run(req.params.registrationId);

            res.json({

                success: true,

                message:
                    "Registration deleted."

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message: "Server error."

            });

        }
    }
);

// ===============================
// ERROR HANDLER
// ===============================

app.use((error, req, res, next) => {

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

            message: error.message

        });

    }

    next();

});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {

    console.log(
        `RavenX server running at http://localhost:${PORT}`
    );

});