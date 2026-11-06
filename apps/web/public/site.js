// Page behaviour: the live calculator, reveal on scroll, count-ups, the nav edge. Without JavaScript the page and
// the calculator form still work (the form submits to /pedir).
(function () {
  var d = document.documentElement;
  d.classList.remove("no-js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var es = (d.lang || "es") === "es";
  var loc = es ? "es-AR" : "en-US";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var nav = $(".nav");
  if (nav) { var ns = function () { nav.classList.toggle("scrolled", scrollY > 4); }; ns(); addEventListener("scroll", ns, { passive: true }); }

  // ---- calculator: a real quote from /api/quote as you type
  var calc = $("#calc");
  if (calc) {
    var input = $("#c-pesos", calc), out = { coll: $("#c-coll"), rate: $("#c-rate"), cost: $("#c-cost"), bank: $("#c-bank"), save: $("#c-save"), note: $("#c-note"), block: $("#c-block") };
    var fmt = function (n, dec) { return Number(n).toLocaleString(loc, { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); };
    var peso = function (wad) { return "$ " + fmt(Math.round(Number(wad) / 1e18)); };
    var usd = function (u) { return "US$ " + fmt(Number(u) / 1e6, 2); };
    var set = function (el, text) { if (!el || el.textContent === text) return; el.textContent = text; if (!reduce) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } };
    var digits = function () { return (input.value || "").replace(/[^0-9]/g, "").slice(0, 10); };
    var days = function () { var r = $('input[name="dias"]:checked', calc); return r ? r.value : "30"; };
    var blank = function () { ["coll", "cost", "bank", "save"].forEach(function (k) { set(out[k], "—"); }); };
    var seq = 0, timer = null;
    function update() {
      var p = digits(), my = ++seq;
      if (!p || Number(p) < 1000) { blank(); out.note.textContent = es ? "El mínimo es $ 1.000." : "The minimum is ARS 1,000."; return; }
      fetch("/api/quote?pesos=" + p + "&dias=" + days(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (q) {
        if (my !== seq) return;
        if (out.block && q.block) out.block.textContent = q.block;
        if (q.kind === "refused") {
          blank();
          out.note.textContent = q.limit ? (es ? "Tu primer préstamo puede ser de hasta " : "Your first loan can be up to ") + peso(q.limit) + "." : (es ? "Ahora no damos préstamos nuevos; pagar y retirar funcionan igual." : "No new loans right now; repaying and withdrawing still work.");
          return;
        }
        set(out.coll, usd(q.collateral));
        set(out.rate, (Number(q.rateBps) / 100).toLocaleString(loc, { maximumFractionDigits: 2 }) + "%");
        set(out.cost, peso(Number(q.interest) + Number(q.fee)));
        set(out.bank, peso(q.bankInterest));
        set(out.save, peso(q.saving));
        out.note.textContent = q.kind === "estimate"
          ? (es ? "Estimado a la tasa de hoy. El fondo puede prestar hoy hasta " : "Estimate at today's rate. The pool can lend up to ") + peso(q.limit) + (es ? "." : " today.")
          : (es ? "Cotización real del fondo, sin compromiso. Te llegan " : "A real quote from the pool, no commitment. You receive ") + peso(q.received) + ".";
      }).catch(function () {});
    }
    function soon() { clearTimeout(timer); timer = setTimeout(update, 220); }
    input.addEventListener("input", function () {
      var p = digits();
      input.value = p ? Number(p).toLocaleString(loc) : "";
      soon();
    });
    $$('input[name="dias"]', calc).forEach(function (r) { r.addEventListener("change", update); });
    calc.addEventListener("submit", function () { input.value = digits(); });
    update();
    setInterval(update, 30000);
  }

  // ---- count-up
  function countUp(el) {
    var to = parseFloat(el.getAttribute("data-count"));
    if (isNaN(to) || reduce) return;
    var dec = parseInt(el.getAttribute("data-dec") || "0", 10);
    var f = new Intl.NumberFormat(el.getAttribute("data-locale") || loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    var pre = el.getAttribute("data-pre") || "", post = el.getAttribute("data-post") || "", t0 = null;
    requestAnimationFrame(function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / 1300), e = 1 - Math.pow(1 - p, 4);
      el.textContent = pre + f.format(to * e) + post;
      if (p < 1) requestAnimationFrame(step);
    });
  }

  // ---- reveal
  var targets = $$(".reveal, .cmp, .meter, .photo-card");
  function show(el) {
    el.classList.add("in");
    $$("[data-count]", el).forEach(function (c) { if (!c._done) { c._done = true; countUp(c); } });
    if (el.classList.contains("meter")) { var fl = el.querySelector(".fill"); if (fl) fl.style.width = fl.getAttribute("data-w"); }
  }
  if (!("IntersectionObserver" in window) || reduce) { targets.forEach(show); return; }
  var io = new IntersectionObserver(function (list) {
    list.forEach(function (en) { if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } });
  }, { threshold: 0.15, rootMargin: "0px 0px -5% 0px" });
  targets.forEach(function (el) { io.observe(el); });
  setTimeout(function () { targets.forEach(function (el) { if (!el.classList.contains("in") && el.getBoundingClientRect().top < innerHeight) show(el); }); }, 2500);
})();
