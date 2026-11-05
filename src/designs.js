const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { escapeXml } = require('./domain');

const assetDir = path.join(__dirname, '..', 'public', 'assets');
const templates = Object.freeze({
  bib: fs.readFileSync(path.join(assetDir, 'shadow-sprint-bib-template.png')),
  certificate: fs.readFileSync(path.join(assetDir, 'shadow-sprint-certificate-template.png'))
});

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function imageData(buffer) {
  return 'data:image/png;base64,' + buffer.toString('base64');
}

async function rasterizePng(svg) {
  return sharp(Buffer.from(svg), { density: 72 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function fittedText(value, maxWidth, normalSize, minSize = 28) {
  const text = escapeXml(value);
  const size = Math.max(minSize, Math.min(normalSize, Math.floor(maxWidth / Math.max(text.length * 0.66, 1))));
  return { text, size };
}

function makeShadowSprintBibSvg({ name, bib, distance, templateBuffer = templates.bib }) {
  const { width, height } = pngDimensions(templateBuffer);
  const participant = fittedText(name, Math.floor(width * 0.72), Math.floor(width * 0.054), 30);
  const bibText = fittedText(bib, Math.floor(width * 0.70), Math.floor(width * 0.07), 38);
  const distanceText = fittedText(distance, Math.floor(width * 0.58), Math.floor(width * 0.05), 34);
  const center = Math.floor(width / 2);
  const categoryY = Math.floor(height * 0.419);
  const bibY = Math.floor(height * 0.53);
  const nameY = Math.floor(height * 0.633);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="title desc">',
    '<title id="title">Personalized RavenX Shadow Sprint BIB</title><desc id="desc">BIB for ' + participant.text + ', ' + bibText.text + ', ' + distanceText.text + '.</desc>',
    '<image x="0" y="0" width="' + width + '" height="' + height + '" preserveAspectRatio="none" href="' + imageData(templateBuffer) + '"/>',
    '<g text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700">',
    '<text x="' + center + '" y="' + categoryY + '" font-size="' + distanceText.size + '" letter-spacing="9" fill="#100b07">' + distanceText.text + '</text>',
    '<text x="' + center + '" y="' + bibY + '" font-size="' + bibText.size + '" letter-spacing="10" fill="#9d130d">' + bibText.text + '</text>',
    '<text x="' + center + '" y="' + nameY + '" font-size="' + participant.size + '" letter-spacing="5" fill="#100b07">' + participant.text + '</text>',
    '</g></svg>'
  ].join('\n');
}

function makeShadowSprintCertificateSvg({ name, templateBuffer = templates.certificate }) {
  const { width, height } = pngDimensions(templateBuffer);
  const participant = fittedText(name, Math.floor(width * 0.5), Math.floor(width * 0.044), 34);
  const x = Math.floor(width * 0.5);
  const y = Math.floor(height * 0.522);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="title desc">',
    '<title id="title">RavenX Shadow Sprint certificate</title><desc id="desc">Certificate issued to ' + participant.text + '.</desc>',
    '<image x="0" y="0" width="' + width + '" height="' + height + '" preserveAspectRatio="none" href="' + imageData(templateBuffer) + '"/>',
    '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="Brush Script MT, Segoe Script, cursive" font-style="italic" font-size="' + participant.size + '" fill="#211128">' + participant.text + '</text>',
    '</svg>'
  ].join('\n');
}

module.exports = { makeShadowSprintBibSvg, makeShadowSprintCertificateSvg, rasterizePng };
