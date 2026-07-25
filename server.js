require("dotenv").config(); // Load .env variables
const express = require("express");
const fetch = require("node-fetch");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve the site itself (index.html, contact.html, assets/, etc.)
// Your HTML files and assets/ live right next to server.js, so serve from here directly.
app.use(express.static(__dirname));

const WEB3FORMS_KEY = process.env.WEB3FORMS_KEY;

app.post("/submit-form", async (req, res) => {
  try {
    const body = { ...req.body };

    // Honeypot check — if the hidden "honeypot" field was filled in,
    // it was a bot. Pretend success but don't actually send anything.
    if (body.honeypot) {
      return res.status(200).json({ success: true, message: "OK" });
    }
    delete body.honeypot;

    // form_type lets one endpoint serve multiple forms
    // (contact / volunteer / subscribe) with a clear subject line each time.
    const formType = body.form_type || "Contact Form";
    delete body.form_type;

    const subjectMap = {
      contact: "New contact message from youngstarsafrica.org",
      volunteer: "New volunteer application from youngstarsafrica.org",
      subscribe: "New newsletter subscriber from youngstarsafrica.org",
    };

    const formData = {
      ...body,
      access_key: WEB3FORMS_KEY,
      subject: subjectMap[formType] || subjectMap.contact,
      from_name: "YoungStars Hope Foundation-Africa website",
    };

    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));