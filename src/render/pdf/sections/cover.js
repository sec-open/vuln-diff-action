// PDF cover page renderer: shows title, repository, timestamps, and base/head commit metadata.

/**
 * Builds HTML for the PDF cover section.
 * @param {{repo:string, base:Object, head:Object, inputs:Object, generatedAt:string, logoDataUri:string}} params
 */
function coverHtml({ repo, base, head, inputs, generatedAt, logoDataUri }) {
  const baseRef = inputs?.baseRef || base.ref;
  const headRef = inputs?.headRef || head.ref;

  return `
    <section class="cover-page">
      <div class="cover-top">
        <div class="cover-brand">
          ${logoDataUri ? `<img src="${logoDataUri}" alt="logo" />` : ''}
        </div>
      </div>

      <div class="cover-title">
        <div class="line1">Vulnerability Diff Report</div>
        <div class="line2">${repo}</div>
        <div class="cover-meta-ts">${generatedAt}</div>
      </div>

      <div class="cover-cards">
        <div class="card-dark">
          <div class="card-title">Base</div>
          <div class="kv">
            <div>Ref</div><div class="wrap">${baseRef || '—'}</div>
            <div>SHA</div><div class="wrap">${base.shaShort}</div>
            <div>Author</div><div class="wrap">${base.author}</div>
            <div>Authored at</div><div class="wrap">${base.authoredAt}</div>
            <div>Commit</div><div class="wrap">${base.commitSubject}</div>
          </div>
        </div>
        <div class="card-dark">
          <div class="card-title">Head</div>
          <div class="kv">
            <div>Ref</div><div class="wrap">${headRef || '—'}</div>
            <div>SHA</div><div class="wrap">${head.shaShort}</div>
            <div>Author</div><div class="wrap">${head.author}</div>
            <div>Authored at</div><div class="wrap">${head.authoredAt}</div>
            <div>Commit</div><div class="wrap">${head.commitSubject}</div>
          </div>
        </div>
      </div>
    </section>
  `.trim();
}

module.exports = { coverHtml };
