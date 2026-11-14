// PENDING_OFF_20261114: this site publishes no pending picks (owner decision, 14 Nov 2026). The page keeps its address and
// sends readers to the graded board and the rankings.
(function () {
  'use strict';
  var root = document.getElementById('picksRoot');
  if (!root) return;
  root.innerHTML = '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Today&rsquo;s graded picks</span></nav>' +
    '<div class="pagehead"><div><div class="eyebrow">Graded picks</div><h1>Today&rsquo;s graded picks</h1>' +
    '<p class="muted">Every pick on this site has a final score. Each one was captured from a public post before its game started and is shown with the account name and record.</p>' +
    '<p style="margin:14px 0 0"><a class="btn pro" href="research/today.html">See today&rsquo;s board</a> <a class="btn ghost" href="cappers.html">Rankings</a></p></div></div>';
})();
