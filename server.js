const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');

const mailer = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS,
  },
});

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { leads: [] };
  }
}

function saveDb(data) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8'); } catch {}
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/apply', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'apply.html'));
});

// Redirect root to /apply
app.get('/', (req, res) => {
  res.redirect('/apply');
});

app.post('/api/apply', async (req, res) => {
  const { firstName, lastName, email, phone, jobTitle, company, industry, linkedin, social, ndaAccepted } = req.body;

  if (!firstName || !lastName || !email || !phone || !jobTitle || !industry) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }
  if (ndaAccepted !== true) {
    return res.status(400).json({ ok: false, error: 'NDA must be accepted' });
  }

  const db = loadDb();
  if (!db.leads) db.leads = [];

  const lead = {
    id: require('crypto').randomUUID(),
    submittedAt: new Date().toISOString(),
    contact: { firstName, lastName, email, phone },
    profile: {
      jobTitle,
      company: company || '',
      industry,
      linkedin: linkedin || '',
      social: social || '',
    },
    ndaAccepted: true,
  };
  db.leads.push(lead);
  saveDb(db);

  const handoutPath = path.join(__dirname, 'private', 'handout.pdf');
  const handoutExists = fs.existsSync(handoutPath);

  try {
    await mailer.sendMail({
      from: '"Private Yacht Club" <membershippyc@outlook.de>',
      to: email,
      subject: 'Your NDA Confirmation & Exclusive Handout – Private Yacht Club',
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <h2 style="color: #c9a84c;">Private Yacht Club</h2>
          <p>Dear ${escHtml(firstName)},</p>
          <p>Thank you for your interest in the Private Yacht Club. We confirm that you have accepted our Non-Disclosure Agreement on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
          ${handoutExists
            ? '<p>Please find attached our exclusive membership handout. The contents are strictly confidential.</p>'
            : '<p>Our membership team will be in touch shortly with further information.</p>'
          }
          <p style="margin-top: 32px; color: #888; font-size: 13px;">Private Yacht Club · membershippyc@outlook.de</p>
        </div>
      `,
      attachments: handoutExists
        ? [{ filename: 'PYC_Membership_Handout.pdf', path: handoutPath }]
        : [],
    });
  } catch (err) {
    console.error('Applicant confirmation email failed:', err);
  }

  try {
    await mailer.sendMail({
      from: '"PYC System" <membershippyc@outlook.de>',
      to: 'membershippyc@outlook.de',
      subject: `New Membership Enquiry: ${escHtml(firstName)} ${escHtml(lastName)}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2>New Membership Enquiry</h2>
          <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; font-weight: bold;">Name</td><td style="padding: 8px;">${escHtml(firstName)} ${escHtml(lastName)}</td></tr>
            <tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Email</td><td style="padding: 8px;">${escHtml(email)}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Phone</td><td style="padding: 8px;">${escHtml(phone)}</td></tr>
            <tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Job Title</td><td style="padding: 8px;">${escHtml(jobTitle)}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Company</td><td style="padding: 8px;">${escHtml(company || '–')}</td></tr>
            <tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Industry</td><td style="padding: 8px;">${escHtml(industry)}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">LinkedIn</td><td style="padding: 8px;">${escHtml(linkedin || '–')}</td></tr>
            <tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Social Media</td><td style="padding: 8px;">${escHtml(social || '–')}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">NDA Accepted</td><td style="padding: 8px;">✓ Yes</td></tr>
            <tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Submitted</td><td style="padding: 8px;">${new Date().toISOString()}</td></tr>
          </table>
        </div>
      `,
    });
  } catch (err) {
    console.error('Admin notification email failed:', err);
  }

  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`PYC Apply running on http://localhost:${PORT}`));
}
module.exports = app;
