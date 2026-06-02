const nbhdConfig = require('../config/nbhd.json');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const QRCode = require('qrcode');
const fs = require('fs');

(async () => {
  const pdfDoc = await PDFDocument.create();
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const abbr of Object.keys(nbhdConfig)) {
    const url = `https://www.vacansee.org/?nbhd=${abbr}`;
    const qrPng = await QRCode.toBuffer(url, { type: 'png' });
    const qrImage = await pdfDoc.embedPng(qrPng);

    // Landscape US Letter dimensions: width = 792, height = 612
    const page = pdfDoc.addPage([792, 612]);
    const { width, height } = page.getSize();

    // Draw white background for the whole page
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(1, 1, 1),
    });

    // Each poster width (half page)
    const halfWidth = width / 2;
    const margin = 20;

    // Common headline text parts
    const headlineWithQ = "When stores sit vacant, who ends up paying?";
    const headlineSB = "Your future storefront might already be vacant."

    // Helper function to draw one poster block
    function drawPosterBlock(xOffset, headlineText) {
      const headlineSize = 28;
      const maxTextWidth = halfWidth - 2 * margin;
      const lineHeight = headlineSize * 1.2;

      // Draw headline (wrap and center within half page)
      page.drawText(headlineText, {
        x: xOffset + margin,
        y: height - 120,
        size: headlineSize,
        font: fontHelvetica,
        maxWidth: maxTextWidth,
        lineHeight: lineHeight,
        color: rgb(0, 0, 0),
        textAlign: 'center',
        wordBreaks: [' '],
      });

      // Supporting text: VacanSee.org
      const supportText = "VacanSee.org";
      const supportSize = 42;
      const supportWidth = fontHelvetica.widthOfTextAtSize(supportText, supportSize);
      page.drawText(supportText, {
        x: xOffset + (halfWidth - supportWidth) / 2,
        y: height - 280,
        size: supportSize,
        font: fontHelvetica,
        color: rgb(0, 0, 0),
      });
      function drawCenteredWrappedText(page, text, xOffset, y, maxWidth, font, fontSize, lineHeight) {
        const words = text.split(' ');
        let lines = [];
        let line = "";

        for (const word of words) {
          let testLine = line.length ? line + " " + word : word;
          let testWidth = font.widthOfTextAtSize(testLine, fontSize);

          if (testWidth > maxWidth) {
            lines.push(line);
            line = word;
          } else {
            line = testLine;
          }
        }
        lines.push(line);

        for (let i = 0; i < lines.length; i++) {
          const lineWidth = font.widthOfTextAtSize(lines[i], fontSize);
          const x = xOffset + (maxWidth - lineWidth) / 2;
          page.drawText(lines[i], {
            x,
            y: y - i * lineHeight,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
        }
      }

      // Usage inside your drawPosterBlock:
      const subtext = "a map of SF's vacant commercial properties, built with public tax data";
      const subtextSize = 14;
      const maxWidth = halfWidth - 40;  // some margin within halfWidth
      const lineHeightNew = subtextSize * 1.3;
      drawCenteredWrappedText(page, subtext, xOffset + 20, height - 310, maxWidth, fontRegular, subtextSize, lineHeightNew);

      // Draw QR code centered in half page near bottom
      const qrSize = 140;
      page.drawImage(qrImage, {
        x: xOffset + (halfWidth - qrSize) / 2,
        y: 100,
        width: qrSize,
        height: qrSize,
      });

      // Neighborhood abbreviation in bottom corner
      page.drawText(abbr, {
        x: xOffset + halfWidth - 40,
        y: 20,
        size: 10,
        font: fontRegular,
        color: rgb(0, 0, 0),
      });
    }

    // Draw posters side-by-side
    drawPosterBlock(0, headlineWithQ);
    drawPosterBlock(halfWidth, headlineSB);
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('posters.pdf', pdfBytes);
})();
