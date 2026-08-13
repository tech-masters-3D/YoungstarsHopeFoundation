require("dotenv").config(); // Load .env variables
const express = require("express");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const { body, validationResult } = require("express-validator");
const path = require("path");
const fs = require("fs");

// Ensure logs directory exists and prepare validation log path
const logsDir = path.join(__dirname, "logs");
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (e) {
  console.warn("Could not create logs directory:", e && e.message);
}
const validationLogPath = path.join(logsDir, "validation.log");

function redactEmail(email) {
  if (!email || typeof email !== "string") return email;
  const at = email.indexOf("@");
  if (at <= 2) return "***@" + email.slice(at + 1);
  return email.slice(0, 2) + "***@" + email.slice(at + 1);
}

function logValidationFailure(req, errors) {
  try {
    const entry = {
      time: new Date().toISOString(),
      ip: req.ip,
      route: req.originalUrl,
      userAgent: req.headers["user-agent"] || null,
      errors: errors,
      body: {
        form_type: req.body && req.body.form_type,
        name: req.body && req.body.name,
        email: redactEmail(req.body && req.body.email),
        phone: req.body && req.body.phone ? String(req.body.phone) : null,
        // do not log full message content to avoid storing PII; note presence instead
        message_present: !!(req.body && req.body.message),
      },
    };

    fs.appendFile(validationLogPath, JSON.stringify(entry) + "\n", (err) => {
      if (err) console.warn("Failed to write validation log:", err && err.message);
    });
  } catch (e) {
    console.warn("Failed to prepare validation log entry:", e && e.message);
  }
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Security: Helmet will set various HTTP headers (HSTS, X-Frame-Options, etc.)
// Disable Helmet's own Content-Security-Policy header so the per-page
// `<meta http-equiv="Content-Security-Policy">` tags (which allow
// images from images.unsplash.com) are respected by browsers. HTTP
// response headers take precedence over meta tags, so leaving Helmet's
// CSP enabled was blocking Unsplash images.
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Enforce HTTPS and HSTS when running in production or when explicitly enabled.
const enforceHTTPS = process.env.ENFORCE_HTTPS === "1" || process.env.NODE_ENV === "production";
if (enforceHTTPS) {
  // If behind a proxy (Heroku, nginx, etc.), trust the first proxy
  app.set("trust proxy", 1);

  // Use HSTS for one year and include subdomains
  app.use(
    helmet.hsts({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    })
  );

  // Redirect HTTP -> HTTPS for safe methods (GET/HEAD). For non-safe methods, reject.
  app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"] || (req.socket && req.socket.encrypted ? "https" : "http");
    if (proto === "https" || req.secure) return next();

    if (req.method === "GET" || req.method === "HEAD") {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }

    res.set("Connection", "close");
    return res.status(403).send("Please use HTTPS when submitting requests.");
  });
}

// Serve the site itself (index.html, contact.html, assets/, etc.)
app.use(express.static(__dirname));

// Rate limiting and slowdown to protect the /submit-form endpoint from spam
// and brute-force abuse. These settings are conservative for a public site
// and can be tuned for your traffic patterns.
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 3, // allow 3 requests per window, then begin adding delay
  delayMs: 500, // begin with 500ms delay per request above delayAfter
});

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many submissions from this IP, please try again later." },
  onLimitReached: (req, res, options) => {
    console.warn(`Rate limit reached for IP: ${req.ip} on /submit-form`);
  },
});

// Apply only to the submit-form route
app.use("/submit-form", speedLimiter);
app.use("/submit-form", formLimiter);

// Validation + sanitization middleware for /submit-form
const validateSubmitForm = [
  body("form_type")
    .optional()
    .isIn(["contact", "volunteer", "subscribe"])
    .withMessage("Invalid form_type"),

  body("name").optional().trim().isLength({ max: 100 }).escape(),
  body("email").optional().trim().isEmail().normalizeEmail(),
  body("phone").optional().trim().isLength({ max: 30 }).escape(),
  body("message").optional().trim().isLength({ max: 2000 }).escape(),

  // Custom rule: subscription requires email
  body()
    .custom((_, { req }) => {
      if (req.body.form_type === "subscribe") {
        if (!req.body.email) throw new Error("Email is required for subscription");
      }

      // For contact form, require at least an email or phone and a message
      if (req.body.form_type === "contact") {
        if (!req.body.message || (!req.body.email && !req.body.phone)) {
          throw new Error("Contact form requires a message and either an email or phone number");
        }
      }

      return true;
    })
    .withMessage("Validation failed"),

  // Final middleware to report errors
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Log validation failures for monitoring and debugging (redacted PII)
      try {
        logValidationFailure(req, errors.array());
      } catch (e) {
        console.warn("Failed to log validation failure:", e && e.message);
      }

      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Replace req.body with sanitized values where possible
    req.body = {
      form_type: req.body.form_type,
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      message: req.body.message,
      honeypot: req.body.honeypot,
      consent: req.body.consent,
    };

    next();
  },
];

// Environment-configured values
const WEB3FORMS_KEY = process.env.WEB3FORMS_KEY;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || SMTP_USER;

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false, // use STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

function buildHtmlFromBody(formType, body) {
  const rows = Object.keys(body)
    .filter((k) => k !== "email" && k !== "name")
    .map((k) => `<tr><td><strong>${k}</strong></td><td>${String(body[k])}</td></tr>`)
    .join("");

  return `
    <h2>${formType}</h2>
    <table border="0" cellpadding="6" cellspacing="0">
      ${body.name ? `<tr><td><strong>Name</strong></td><td>${body.name}</td></tr>` : ""}
      ${body.email ? `<tr><td><strong>Email</strong></td><td>${body.email}</td></tr>` : ""}
      ${rows}
    </table>
  `;
}

async function sendMail(options) {
  if (!transporter) throw new Error("SMTP transporter is not configured");
  return transporter.sendMail(options);
}

app.post("/submit-form", validateSubmitForm, async (req, res) => {
  try {
    const body = { ...req.body };

    // Honeypot check — if the hidden "honeypot" field was filled in,
    // it was a bot. Pretend success but don't actually send anything.
    if (body.honeypot) {
      return res.status(200).json({ success: true, message: "OK" });
    }
    delete body.honeypot;

    const formType = body.form_type || "contact";
    delete body.form_type;

    const subjectMap = {
      contact: "New contact message from youngstarshopefoundation-africa.org",
      volunteer: "New volunteer application from youngstarshopefoundation-africa.org",
      subscribe: "New newsletter subscriber from youngstarshopefoundation-africa.org",
    };

    const subject = subjectMap[formType] || subjectMap.contact;

    // If SMTP is configured, send via SMTP. Otherwise, fallback to Web3forms if key present.
    if (transporter) {
      // Notification to site owner
      const ownerHtml = buildHtmlFromBody(subject, body);
      await sendMail({
        from: SMTP_USER,
        to: RECIPIENT_EMAIL,
        subject,
        html: ownerHtml,
        text: `${subject}\n\n${JSON.stringify(body, null, 2)}`,
      });

      // If this is a subscription, send a confirmation email to the subscriber
      if (formType === "subscribe" && body.email) {
        const confirmHtml = `
          <p>Hi${body.name ? ` ${body.name}` : ""},</p>
          <p>Thanks for subscribing to YoungStars Hope Foundation-Africa updates. We'll be in touch.</p>
          <p>If you didn't sign up, please ignore this message.</p>
        `;
        await sendMail({
          from: SMTP_USER,
          to: body.email,
          subject: "Subscription confirmed — YoungStars Hope Foundation-Africa",
          html: confirmHtml,
          text: `Thanks for subscribing.`,
        });
      }

      return res.status(200).json({ success: true, message: "Message sent via SMTP" });
    }

    if (WEB3FORMS_KEY) {
      const formData = {
        ...body,
        access_key: WEB3FORMS_KEY,
        subject,
        from_name: "YoungStars Hope Foundation-Africa website",
      };

      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    return res.status(500).json({ message: "No email sender is configured (SMTP or Web3forms)" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));