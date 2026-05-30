const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Upstash for Redis (via Vercel marketplace) may use different env var names
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
console.log('[startup] Redis URL set:', !!redisUrl, '| Token set:', !!redisToken);

const redis = new Redis({ url: redisUrl, token: redisToken });

async function pushLead(lead) {
  await redis.lpush('pyc:leads', JSON.stringify(lead));
}

async function pushVisit(visit) {
  await redis.lpush('pyc:visits', JSON.stringify(visit));
}

async function getLeads() {
  const raw = await redis.lrange('pyc:leads', 0, -1);
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

async function getVisits() {
  const raw = await redis.lrange('pyc:visits', 0, -1);
  return raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
}

async function geoLookup(ip) {
  try {
    const raw = (ip || '').split(',')[0].trim();
    if (!raw || raw === '::1' || raw.startsWith('127.') || raw.startsWith('10.') ||
        raw.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(raw)) {
      return { city: 'Local', region: '', country: '', isp: '' };
    }
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(raw)}?fields=status,city,regionName,country,org,isp`);
    const data = await res.json();
    if (data.status !== 'success') return { city: '', region: '', country: '', isp: '' };
    return { city: data.city || '', region: data.regionName || '', country: data.country || '', isp: data.org || data.isp || '' };
  } catch {
    return { city: '', region: '', country: '', isp: '' };
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

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

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, html, fromName = 'Private Yacht Club', attachment = null }) {
  const body = {
    sender: { name: fromName, email: 'membership@privateyachtclub.com' },
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

app.post('/api/visit', async (req, res) => {
  const ip = clientIp(req);
  const { utmSource, utmMedium, utmCampaign } = req.body || {};
  const geo = await geoLookup(ip);
  await pushVisit({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ip,
    geo,
    userAgent: req.headers['user-agent'] || '',
    referrer: req.headers['referer'] || '',
    utmSource: utmSource || '',
    utmMedium: utmMedium || '',
    utmCampaign: utmCampaign || '',
  });
  res.json({ ok: true });
});

function checkAdminKey(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key) { res.status(503).json({ ok: false, error: 'ADMIN_KEY not configured' }); return false; }
  const provided = req.headers['x-admin-key'] || req.query.key;
  if (provided !== key) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return false; }
  return true;
}

app.get('/api/analytics', async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  let visits, leads;
  try {
    [visits, leads] = await Promise.all([getVisits(), getLeads()]);
  } catch (err) {
    console.error('[analytics] Redis error:', err.message);
    return res.status(500).json({ ok: false, error: 'Database connection failed: ' + err.message });
  }

  const cityMap = {};
  for (const v of visits) {
    const key = [v.geo?.city, v.geo?.country].filter(Boolean).join(', ') || 'Unknown';
    if (!cityMap[key]) cityMap[key] = { city: v.geo?.city || '', country: v.geo?.country || '', visits: 0, lastSeen: '' };
    cityMap[key].visits++;
    if (!cityMap[key].lastSeen || v.timestamp > cityMap[key].lastSeen) cityMap[key].lastSeen = v.timestamp;
  }

  const leadsByCity = {};
  for (const l of leads) {
    const key = [l.meta?.geo?.city, l.meta?.geo?.country].filter(Boolean).join(', ') || 'Unknown';
    leadsByCity[key] = (leadsByCity[key] || 0) + 1;
  }

  res.json({
    ok: true,
    summary: {
      totalVisits: visits.length,
      totalLeads: leads.length,
      uniqueCities: Object.keys(cityMap).length,
    },
    cities: Object.entries(cityMap)
      .map(([k, v]) => ({ label: k, ...v, leads: leadsByCity[k] || 0 }))
      .sort((a, b) => b.visits - a.visits),
    recentVisits: visits.slice(-50).reverse().map(v => ({
      timestamp: v.timestamp,
      city: [v.geo?.city, v.geo?.country].filter(Boolean).join(', ') || 'Unknown',
      referrer: v.referrer || '',
      utmSource: v.utmSource || '',
      utmCampaign: v.utmCampaign || '',
    })),
    recentLeads: leads.slice(-20).reverse().map(l => ({
      submittedAt: l.submittedAt,
      name: `${l.contact?.firstName} ${l.contact?.lastName}`,
      city: [l.meta?.geo?.city, l.meta?.geo?.country].filter(Boolean).join(', ') || 'Unknown',
      industry: l.profile?.industry || '',
    })),
  });
});

app.post('/api/apply', async (req, res) => {
  const { firstName, lastName, email, phone, jobTitle, company, industry, linkedin, social, background, interest, investmentPerspective, ndaAccepted, utmSource, utmMedium, utmCampaign } = req.body;

  if (!firstName || !lastName || !email || !phone || !jobTitle || !industry || !background || !interest || !investmentPerspective)
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  if (ndaAccepted !== true)
    return res.status(400).json({ ok: false, error: 'NDA must be accepted' });

  const ip = clientIp(req);
  const geo = await geoLookup(ip);

  await pushLead({
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    contact: { firstName, lastName, email, phone },
    profile: { jobTitle, company: company || '', industry, linkedin: linkedin || '', social: social || '', background: background || '', interest: interest || '', investmentPerspective: investmentPerspective || '' },
    ndaAccepted: true,
    meta: {
      ip,
      geo,
      userAgent: req.headers['user-agent'] || '',
      referrer: req.headers['referer'] || '',
      utmSource: utmSource || '',
      utmMedium: utmMedium || '',
      utmCampaign: utmCampaign || '',
    },
  });

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
      to: 'membership@privateyachtclub.com',
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
            <tr style="background:#f5f5f5;"><td colspan="2" style="padding:10px 8px;font-weight:bold;color:#999;font-size:12px;letter-spacing:1px;">TRACKING</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Location</td><td style="padding:10px 8px;"><strong>${escHtml([geo.city, geo.region, geo.country].filter(Boolean).join(', ') || '–')}</strong>${geo.isp ? ` &nbsp;·&nbsp; ${escHtml(geo.isp)}` : ''}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">IP Address</td><td style="padding:10px 8px;">${escHtml(ip || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">Browser</td><td style="padding:10px 8px;">${escHtml(req.headers['user-agent'] || '–')}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">Referrer</td><td style="padding:10px 8px;">${escHtml(req.headers['referer'] || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">UTM Source</td><td style="padding:10px 8px;">${escHtml(utmSource || '–')}</td></tr>
            <tr><td style="padding:10px 8px;font-weight:bold;color:#555;">UTM Medium</td><td style="padding:10px 8px;">${escHtml(utmMedium || '–')}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:10px 8px;font-weight:bold;color:#555;">UTM Campaign</td><td style="padding:10px 8px;">${escHtml(utmCampaign || '–')}</td></tr>
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
