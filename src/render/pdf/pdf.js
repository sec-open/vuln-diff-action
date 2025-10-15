async function buildPrintHtml({ distDir, view, inputs, logoDataUri }) {
  const htmlRoot = path.join(distDir, 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  let bodyInner = '';

  // Semáforo global: define __requireReady / __markSectionReady y cierre automático
  const readyBoot = `
<script>
(function(){
  var need = new Set();
  var done = new Set();
  window.__requireReady = function(id){ try{ need.add(id); window.__ALL_SECTIONS_READY = (need.size===0); }catch(e){} };
  window.__markSectionReady = function(id){ try{ done.add(id); if ([...need].every(function(x){return done.has(x);})){ window.__ALL_SECTIONS_READY = true; } }catch(e){} };
  window.__ALL_SECTIONS_READY = (need.size===0);
})();
</script>`.trim();

  bodyInner += readyBoot + '\n';
  bodyInner += coverHtml({ repo: view?.repo, base: view?.base, head: view?.head, inputs: inputs || {}, generatedAt: view?.generatedAt, logoDataUri });
  bodyInner += '\n' + tocHtml();
  bodyInner += '\n' + introHtml(view);
  bodyInner += '\n' + summaryHtml(view);
  bodyInner += '\n' + (await resultsHtml(distDir, view));

  // Dashboard HTML (incluye __requireReady('dashboard') y __markSectionReady('dashboard') en su script interno)
  bodyInner += '\n' + dashboardHtml(view);

  // Dependency Graphs (Mermaid): render y señal de ready
  const depGraphBase = await readTextSafe(path.join(sectionsDir, 'dep-graph-base.html'));
  const depGraphHead = await readTextSafe(path.join(sectionsDir, 'dep-graph-head.html'));
  const mermaidScript = `
<section class="page" id="dep-graph-base"><h2>5. Dependency Graph — Base</h2>${depGraphBase || ''}</section>
<section class="page" id="dep-graph-head"><h2>6. Dependency Graph — Head</h2>${depGraphHead || ''}</section>
<script>
(function(){
  try{
    if (window.__requireReady) window.__requireReady('dep-graphs');
    var blocks = Array.from(document.querySelectorAll('pre code.language-mermaid, .language-mermaid, pre.mermaid, .mermaid'));
    if (blocks.length===0) { if (window.__markSectionReady) window.__markSectionReady('dep-graphs'); return; }
    function ensureMermaid(cb){
      if (window.mermaid && window.mermaid.render) return cb();
      var s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js'; s.onload=cb; document.head.appendChild(s);
    }
    ensureMermaid(function(){
      try{
        window.mermaid.initialize({ startOnLoad:false, securityLevel:'loose' });
        blocks.forEach(function(b,idx){
          var code = b.textContent || b.innerText || '';
          var container = document.createElement('div');
          container.id = 'mm-' + idx;
          b.parentNode.replaceChild(container, b);
          window.mermaid.render('mmsvg-' + idx, code, function(svg){ container.innerHTML = svg; });
        });
      } finally {
        if (window.__markSectionReady) window.__markSectionReady('dep-graphs');
      }
    });
  }catch(e){ if (window.__markSectionReady) window.__markSectionReady('dep-graphs'); }
})();
</script>
`.trim();
  bodyInner += '\n' + mermaidScript;

  // Dependency Paths y Fix Insights: si están prerender, marcamos ready inmediato
  const depPathsBase = sectionWrapper({ id: 'dep-paths-base', title: '7. Dependency Paths — Base', num: 7, innerHtml: buildDependencyPathsSection((await loadDiff(distDir))?.items || [], 'base') });
  const depPathsHead = sectionWrapper({ id: 'dep-paths-head', title: '8. Dependency Paths — Head', num: 8, innerHtml: buildDependencyPathsSection((await loadDiff(distDir))?.items || [], 'head') });
  bodyInner += '\n' + depPathsBase + '\n' + depPathsHead + `
<script>(function(){ if (window.__requireReady) window.__requireReady('dep-paths'); if (window.__markSectionReady) window.__markSectionReady('dep-paths'); })();</script>
`.trim();

  if (exists(path.join(sectionsDir, 'fix-insights.html'))) {
    const fixHtml = await readTextSafe(path.join(sectionsDir, 'fix-insights.html'));
    bodyInner += '\n' + sectionWrapper({ id: 'fix-insights', title: '9. Fix Insights', num: 9, innerHtml: fixHtml }) + `
<script>(function(){ if (window.__requireReady) window.__requireReady('fix-insights'); if (window.__markSectionReady) window.__markSectionReady('fix-insights'); })();</script>
`.trim();
  }

  const css = makePrintCss();
  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Vulnerability Diff Report — ${view?.repo || ''}</title>
<style>${css}</style>
</head>
<body>
${bodyInner}
<script>document.documentElement.lang='en';</script>
</body>
</html>`.trim();

  return html;
}
