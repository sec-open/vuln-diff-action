function coverHtml({ repo, base, head, inputs, generatedAt, logoDataUri }) {
  const baseShaShort = base?.shaShort || '';
  const headShaShort = head?.shaShort || '';
  const baseShaLong = base?.sha || base?.commit || '';
  const headShaLong = head?.sha || head?.commit || '';
  const gen = new Date(generatedAt).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).replace(',', '');
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" style="height:36px;"/>`
    : '';

  return `
<section class="page cover">
  <div class="cover-wrap">
    <div class="cover-top">
      ${logo}
      <h1>Vulnerability Diff Report</h1>
      <h2>${repo || ''}</h2>
    </div>
    <div class="cover-meta">
      <div class="row">
        <span>Base:</span>
        <strong title="${baseShaLong}">${baseShaShort}</strong>
      </div>
      <div class="row">
        <span>Head:</span>
        <strong title="${headShaLong}">${headShaShort}</strong>
      </div>
      <div class="row">
        <span>Generated:</span>
        <strong>${gen}</strong>
      </div>
    </div>
  </div>
</section>
`.trim();
}

module.exports = { coverHtml };
