const QRCode = require('qrcode');
const path = require('path');

const URL = 'https://pyc-apply.vercel.app/apply';
const OUTPUT = path.join(__dirname, 'qr-code.png');

QRCode.toFile(OUTPUT, URL, {
  width: 1000,
  margin: 2,
  color: {
    dark: '#0d1b2a',
    light: '#ffffff',
  },
}, (err) => {
  if (err) { console.error('Error:', err); process.exit(1); }
  console.log('✓ QR code saved to: qr-code.png (1000×1000px)');
  console.log('  URL encoded:', URL);
});
