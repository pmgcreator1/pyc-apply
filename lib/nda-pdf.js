// Server-side generation of the signed PYC Non-Disclosure Agreement PDF.
// This is a faithful Node port of the client-side downloadNDA() in public/apply.html
// so that the archived PDF is byte-for-byte the same document the applicant receives.
// Keep the NDA text here in sync with public/apply.html.

const { jsPDF } = require('jspdf');

// Bump this whenever the NDA wording/layout below changes.
const NDA_VERSION = 'v2-short-2026-04-23';

/**
 * Build the signed NDA as a PDF Buffer.
 * @param {{ firstName: string, lastName: string, signedAt: string }} data
 *   signedAt is a pre-formatted date string, e.g. "23 April 2026".
 * @returns {Buffer}
 */
function buildNdaPdf(data = {}) {
  const firstName = data.firstName || '';
  const lastName = data.lastName || '';
  const signedAt = data.signedAt || '';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 20;
  const pageW = 210;
  const usable = pageW - margin * 2;
  let y = margin;

  function addText(text, opts = {}) {
    const { size = 11, bold = false, color = [30, 30, 30], lineH = 7, indent = 0 } = opts;
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, usable - indent);
    lines.forEach((line) => {
      if (y > 275) { doc.addPage(); y = margin; }
      doc.text(line, margin + indent, y);
      y += lineH;
    });
    y += 2;
  }

  // Header
  doc.setFillColor(13, 27, 42);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setFontSize(9);
  doc.setTextColor(201, 168, 76);
  doc.setFont('helvetica', 'normal');
  doc.text('PRIVATE MEMBERSHIP · BY INVITATION', margin, 12);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(248, 246, 241);
  doc.text('Private Yacht Club', margin, 22);
  y = 38;

  addText('NON-DISCLOSURE AGREEMENT', { size: 14, bold: true, color: [13, 27, 42], lineH: 8 });
  y += 2;

  // Signatory block
  doc.setFillColor(245, 243, 238);
  doc.rect(margin, y, usable, 26, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 80, 20);
  doc.text('Accepted by:', margin + 4, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text(`${firstName} ${lastName}`, margin + 4, y + 15);
  doc.text(`Date: ${signedAt}`, margin + 4, y + 22);
  doc.text('Accepted electronically via privateyachtclub.com', pageW - margin - 4, y + 22, { align: 'right' });
  y += 32;

  addText('This Non-Disclosure Agreement (the "Agreement") is entered into between ICEINVEST PARTNERSHIP EN COMMANDITE, 36 Archbishop Street, MT1447 Valletta, Malta (hereinafter referred to as "Party 1" or "Organizer") and the individual accepting this Agreement (hereinafter referred to as "Party 2"), jointly referred to as the "Parties".', { size: 10, lineH: 6 });

  addText('The Parties intend, as part of a confidential project, to exchange Confidential Information as information provider and/or information receiver, as the case may be.', { size: 10, lineH: 6 });

  addText('1. Purpose of this Agreement and the Project.', { size: 10, bold: true, lineH: 6 });
  addText('The Parties are discussing a confidential project regarding the establishment of a private yacht club ("Club"). The purpose of this Agreement is to protect Confidential Information that are exchanged in connection with this Project.', { size: 10, lineH: 6, indent: 4 });

  addText('2. Confidential Information.', { size: 10, bold: true, lineH: 6 });
  addText('Confidential Information includes all information that is disclosed in connection with the Project, in particular: information about current or potential Club members; personal, economic or financial information; documents, concepts or plans; information about the yacht, its use or travel periods.', { size: 10, lineH: 6, indent: 4 });
  addText('Confidential Information also includes the fact that the Parties are in discussions, the content of these discussions and the existence of this Agreement.', { size: 10, lineH: 6, indent: 4 });
  addText('Information is not confidential if it: is publicly available without breaching this Agreement; was already lawfully known to the receiving Party before disclosure; is disclosed by a third party lawfully and without confidentiality obligation; must be disclosed due to mandatory law or a binding court or authority decision; is approved for disclosure in writing by the disclosing Party.', { size: 10, lineH: 6, indent: 4 });

  addText('3. Confidentiality Obligations.', { size: 10, bold: true, lineH: 6 });
  addText('Each Party agrees to: use Confidential Information only for the project; keep Confidential Information strictly confidential; not disclose Confidential Information to third parties without prior consent; protect Confidential Information with reasonable care.', { size: 10, lineH: 6, indent: 4 });
  addText('Confidential Information may only be shared internally or with third parties if this is necessary for the project and if an appropriate confidentiality obligation exists. Confidential Information must not be used for personal, commercial or other purposes outside the project.', { size: 10, lineH: 6, indent: 4 });

  addText('4. Duration of Confidentiality.', { size: 10, bold: true, lineH: 6 });
  addText('This Agreement enters into force on the date of signature, but is also valid for information exchanged before. The confidentiality obligations apply during the term of this Agreement and continue for three (3) years after its termination.', { size: 10, lineH: 6, indent: 4 });

  addText('5. Final Provisions.', { size: 10, bold: true, lineH: 6 });
  addText('The applicable law is the substantive law of Malta, to the exclusion of the provisions of the Private International Law. Electronic signatures and scanned signatures are sufficient. If any provision of this Agreement is invalid, the remaining provisions remain unaffected.', { size: 10, lineH: 6, indent: 4 });

  // Footer line
  y += 4;
  if (y > 265) { doc.addPage(); y = margin; }
  doc.setDrawColor(201, 168, 76);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;
  addText('Private Yacht Club · Strictly Confidential · © ' + new Date().getFullYear(), { size: 9, color: [120, 120, 120], lineH: 5 });

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { buildNdaPdf, NDA_VERSION };
