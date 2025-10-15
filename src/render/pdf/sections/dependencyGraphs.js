// src/render/pdf/sections/dependencyGraphs.js
const fs = require('fs');
const path = require('path');

async function readTextSafe(p) { try { return await fs.promises.readFile(p, 'utf8'); } catch { return ''; } }

async function dependencyGraphsHtml(distDir) {
  const htmlRoot = path.join(distDir || '', 'html');
  const sectionsDir = path.join(htmlRoot, 'sections');

  const depGraphBase = await readTextSafe(path.join(sectionsDir, 'dep-graph-base.html'));
  const depGraphHead = await readTextSafe(path.join(sectionsDir, 'dep-graph-head.html'));

  const sectionBase =
    '<section class="page" id="dep-graph-base">' +
    '<h2>5. Dependency Graph — Base</h2>' +
    (depGraphBase || '') +
    '</section>';

  const sectionHead =
    '<section class="page" id="dep-graph-head">' +
    '<h2>6. Dependency Graph — Head</h2>' +
    (depGraphHead || '') +
    '</section>';

  const script =
`<script>(function(){
  try{
    if (window.__requireReady) window.__requireReady('dep-graphs');

    var blocks = Array.from(document.querySelectorAll('pre code.language-mermaid, .language-mermaid, pre.mermaid, .mermaid'));
    if (blocks.length === 0) { if (window.__markSectionReady) window.__markSectionReady('dep-graphs'); return; }

    function ensureMermaid(cb){
      if (window.mermaid && typeof window.mermaid.render === 'function') return cb();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
      s.onload = cb;
      document.head.appendChild(s);
    }

    function renderBlocks(){
      try{
        if (window.mermaid && window.mermaid.initialize) {
          window.mermaid.initialize({ startOnLoad:false, securityLevel:'loose' });
        }
        var pending = blocks.length;
        if (pending === 0) { if (window.__markSectionReady) window.__markSectionReady('dep-graphs'); return; }

        blocks.forEach(function(b, idx){
          var code = b.textContent || b.innerText || '';
          var container = document.createElement('div');
          container.id = 'mm-' + idx;
          if (b.parentNode) b.parentNode.replaceChild(container, b);

          try {
            var out = window.mermaid.render('mmsvg-' + idx, code, container);
            if (out && typeof out.then === 'function') {
              out.then(function(result){
                try {
                  container.innerHTML = (result && result.svg) ? result.svg : '';
                  if (result && typeof result.bindFunctions === 'function') result.bindFunctions(container);
                } finally {
                  pending -= 1;
                  if (pending === 0 && window.__markSectionReady) window.__markSectionReady('dep-graphs');
                }
              }).catch(function(){
                try { container.textContent = code; } finally {
                  pending -= 1;
                  if (pending === 0 && window.__markSectionReady) window.__markSectionReady('dep-graphs');
                }
              });
            } else if (typeof out === 'undefined') {
              window.mermaid.render('mmsvg-' + idx, code, function(svg, bind){
                try {
                  container.innerHTML = svg || '';
                  if (typeof bind === 'function') bind(container);
                } finally {
                  pending -= 1;
                  if (pending === 0 && window.__markSectionReady) window.__markSectionReady('dep-graphs');
                }
              });
            } else {
              container.innerHTML = (out && out.svg) ? out.svg : '';
              pending -= 1;
              if (pending === 0 && window.__markSectionReady) window.__markSectionReady('dep-graphs');
            }
          } catch(e){
            try { container.textContent = code; } finally {
              pending -= 1;
              if (pending === 0 && window.__markSectionReady) window.__markSectionReady('dep-graphs');
            }
          }
        });
      } catch(e){
        if (window.__markSectionReady) window.__markSectionReady('dep-graphs');
      }
    }

    ensureMermaid(renderBlocks);
  }catch(e){
    if (window.__markSectionReady) window.__markSectionReady('dep-graphs');
  }
})();</script>`;

  return [sectionBase, sectionHead, script].join('\n');
}

module.exports = { dependencyGraphsHtml };
