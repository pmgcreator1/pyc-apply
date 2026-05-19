const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');

console.log('[startup] BREVO_API_KEY set:', !!process.env.BREVO_API_KEY);

// Load handout PDF once at startup
const HANDOUT_PATH = path.join(__dirname, 'assets', 'handout.pdf');
let handoutB64 = null;
try {
  handoutB64 = fs.readFileSync(HANDOUT_PATH).toString('base64');
  console.log('[startup] Handout PDF loaded:', Math.round(fs.statSync(HANDOUT_PATH).size / 1024) + 'KB');
} catch {
  console.log('[startup] Handout PDF not found — emails will send without attachment');
}

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { leads: [] }; }
}

function saveDb(data) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8'); } catch {}
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, html, fromName = 'Private Yacht Club', attachment = null }) {
  const body = {
    sender: { name: fromName, email: 'membershippyc@outlook.de' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachment) {
    body.attachment = [{ content: attachment, name: 'PYC_Membership_Handout.pdf' }];
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo API ${res.status}: ${errText}`);
  }
  return res.json();
}

app.get('/apply', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'apply.html'));
});

app.get('/', (req, res) => res.redirect('/apply'));

app.post('/api/apply', async (req, res) => {
  const { firstName, lastName, email, phone, jobTitle, company, industry, linkedin, social, background, interest, investmentPerspective, ndaAccepted } = req.body;

  if (!firstName || !lastName || !email || !phone || !jobTitle || !industry || !background || !interest || !investmentPerspective)
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  if (ndaAccepted !== true)
    return res.status(400).json({ ok: false, error: 'NDA must be accepted' });

  const db = loadDb();
  if (!db.leads) db.leads = [];
  db.leads.push({
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    contact: { firstName, lastName, email, phone },
    profile: { jobTitle, company: company || '', industry, linkedin: linkedin || '', social: social || '', background: background || '', interest: interest || '', investmentPerspective: investmentPerspective || '' },
    ndaAccepted: true,
  });
  saveDb(db);

  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  let applicantOk = false;
  try {
    await sendEmail({
      to: email,
      subject: 'Your Application – Private Yacht Club',
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #f8f6f1; padding: 40px;">
          <div style="border-bottom: 2px solid #c9a84c; padding-bottom: 20px; margin-bottom: 28px;">
            <p style="font-family: Arial, sans-serif; font-size: 10px; letter-spacing: 4px; text-transform: uppercase; color: #c9a84c; margin: 0 0 8px;">Private Membership</p>
            <h1 style="font-size: 28px; font-weight: 400; color: #0d1b2a; margin: 0;">Private Yacht Club</h1>
          </div>
          <p style="font-size: 16px; color: #0d1b2a; margin-bottom: 20px;">Dear ${escHtml(firstName)},</p>
          <p style="font-size: 15px; line-height: 1.7; color: #333; margin-bottom: 16px;">
            Thank you for your enquiry and for signing our Non-Disclosure Agreement.
          </p>
          <p style="font-size: 15px; line-height: 1.7; color: #333; margin-bottom: 32px;">
            We have received your application and will review it carefully. You can expect to hear back from us within the next 48 hours, during which time we will assess whether the Private Yacht Club is the right fit for both parties.
          </p>
          <p style="font-size: 15px; line-height: 1.7; color: #333; margin-bottom: 32px;">
            We look forward to being in touch.
          </p>
          <div style="border-top: 1px solid #ddd; padding-top: 20px;">
            <p style="font-family: Arial, sans-serif; font-size: 12px; color: #888; margin: 0;">
              Private Yacht Club &nbsp;·&nbsp; Strictly Confidential
            </p>
          </div>
        </div>
      `,
    });
    applicantOk = true;
    console.log('[email] Applicant confirmation sent to:', email);
  } catch (err) {
    console.error('[email] Applicant FAILED:', err.message);
  }

  try {
    await sendEmail({
      to: 'membershippyc@outlook.de',
      subject: `New Enquiry: ${escHtml(firstName)} ${escHtml(lastName)}`,
      fromName: 'PYC System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; color: #1a1a2e;">
          <h2 style="color: #c9a84c; border-bottom: 1px solid #eee; padding-bottom: 12px;">New Membership Enquiry</h2>
          <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <tr><td style="padding:10px 8px;font-weight:bold;width:160px;color:#555;">Name</td><td style="padding:10px 8px;">${escHtml(firstName)} ${escHtml(lastName)}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Email</td><td style="padding:10px 8px;"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Phone</td><td style="padding:10px 8px;">${escHtml(phone)}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Job Title</td><td style="padding:10px 8px;">${escHtml(jobTitle)}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Company</td><td style="padding:10px 8px;">${escHtml(company || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Industry</td><td style="padding:10px 8px;">${escHtml(industry)}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">LinkedIn</td><td style="padding:10px 8px;">${escHtml(linkedin || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Social</td><td style="padding:10px 8px;">${escHtml(social || '–')}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Personal Background</td><td style="padding:10px 8px;">${escHtml(background || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Interest in PYC</td><td style="padding:10px 8px;">${escHtml(interest || '–')}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Investment Perspective</td><td style="padding:10px 8px;">${escHtml(investmentPerspective || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">NDA</td><td style="padding:10px 8px;color:green;">✓ Accepted</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Date</td><td style="padding:10px 8px;">${dateStr}</td></tr>
          </table>
        </div>
      `,
    });
    console.log('[email] Admin notification sent');
  } catch (err) {
    console.error('[email] Admin FAILED:', err.message);
  }

  res.json({ ok: true, emailSent: applicantOk });
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
