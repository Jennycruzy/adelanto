// Page motion. Everything here shows real state or settles into it; without JavaScript or with reduced motion the
// page shows the finished state.
(function () {
  var d = document.documentElement;
  d.classList.remove("no-js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var es = (d.lang || "es") === "es";
  var loc = es ? "es-AR" : "en-US";
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---- scroll progress and parallax
  var bar = document.querySelector(".progress i");
  var pars = $$(".parallax img");
  function onScroll() {
    var h = d.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty("--p", h > 0 ? Math.min(1, scrollY / h) : 0);
    if (!reduce) pars.forEach(function (img) {
      var r = img.parentNode.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var max = r.height * 0.08, py = (r.top + r.height / 2 - innerHeight / 2) * -0.12;
      img.style.setProperty("--py", Math.max(-max, Math.min(max, py)).toFixed(1) + "px");
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- count-up
  function countUp(el) {
    var to = parseFloat(el.getAttribute("data-count"));
    if (isNaN(to) || reduce) return;
    var dec = parseInt(el.getAttribute("data-dec") || "0", 10);
    var fmt = new Intl.NumberFormat(el.getAttribute("data-locale") || loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    var pre = el.getAttribute("data-pre") || "", post = el.getAttribute("data-post") || "", t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / 1500), e = 1 - Math.pow(1 - p, 4);
      el.textContent = pre + fmt.format(to * e) + post;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- split-flap: a tile shuffles through digits and lands on its value
  function flapTo(tile, ch, delay) {
    if (reduce) { tile.textContent = ch; return; }
    var isDigit = /[0-9]/.test(ch), n = isDigit ? 5 + Math.floor(Math.random() * 6) : 1;
    setTimeout(function () {
      var k = 0;
      (function tick() {
        tile.classList.remove("flipping"); void tile.offsetWidth; tile.classList.add("flipping");
        tile.textContent = k < n - 1 && isDigit ? String(Math.floor(Math.random() * 10)) : ch;
        if (++k < n) setTimeout(tick, 70);
      })();
    }, delay || 0);
  }
  function setDigits(box, text) {
    var tiles = $$("b", box);
    if (tiles.length !== text.length) {
      box.innerHTML = "";
      tiles = text.split("").map(function (c) { var b = document.createElement("b"); b.className = /[0-9]/.test(c) ? "" : "p"; b.textContent = c; box.appendChild(b); return b; });
      tiles.forEach(function (t, i) { flapTo(t, text[i], i * 50); });
      return true;
    }
    var changed = false;
    tiles.forEach(function (t, i) { if (t.textContent !== text[i]) { changed = true; flapTo(t, text[i], i * 50); } });
    return changed;
  }
  $$(".digits").forEach(function (box) {
    $$("b", box).forEach(function (t, i) { flapTo(t, t.textContent, 300 + i * 55 + Math.random() * 120); });
  });

  // ---- the board stays live: re-read the pool every 20 s
  var live = {}; $$("[data-live]").forEach(function (el) { live[el.getAttribute("data-live")] = el; });
  if (live.rate || live.block) {
    var tick = live.tick ? parseInt(live.tick.textContent, 10) : null;
    if (tick !== null) setInterval(function () { tick++; live.tick.textContent = tick; }, 1000);
    var pct = function (bps) { return (Number(bps) / 100).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; };
    var wad = function (x, dec) { return (Number(BigInt(x) / BigInt("100000000000000")) / 10000).toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
    var refresh = function () {
      fetch("/api/public/rates", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
        var ping = function (el) { var row = el.closest(".board-row"); if (!row) return; row.classList.add("pinged"); setTimeout(function () { row.classList.remove("pinged"); }, 1200); };
        if (live.rate && setDigits(live.rate, pct(j.borrowRateBps))) ping(live.rate);
        var p = j.pesosPerDollar && (j.pesosPerDollar.borrow || j.pesosPerDollar.average30m);
        if (live.price && p && setDigits(live.price, wad(p, 2))) ping(live.price);
        if (live.free && setDigits(live.free, Number(BigInt(j.freePesos) / BigInt("1000000000000000000")).toLocaleString(loc))) ping(live.free);
        if (live.block) live.block.textContent = j.block;
      }).catch(function () {});
      fetch("/health", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
        if (live.tick && j.agentLastTickSecondsAgo != null) { tick = j.agentLastTickSecondsAgo; live.tick.textContent = tick; }
      }).catch(function () {});
    };
    if (window.BigInt) setInterval(refresh, 20000);
  }

  // ---- the agent's messages arrive one by one, then the conversation starts over
  $$(".chat").forEach(function (chat) {
    var msgs = $$(".ll", chat), typing = chat.querySelector(".typing");
    if (reduce || !msgs.length) { msgs.forEach(function (m) { m.classList.add("show"); }); return; }
    var started = false;
    function run() {
      msgs.forEach(function (m) { m.classList.remove("show", "fresh"); });
      var i = 0;
      (function next() {
        if (i >= msgs.length) { setTimeout(run, 6000); return; }
        if (typing) { chat.insertBefore(typing, msgs[i]); typing.classList.add("show"); }
        setTimeout(function () {
          if (typing) typing.classList.remove("show");
          msgs.forEach(function (m) { m.classList.remove("fresh"); });
          msgs[i].classList.add("show", "fresh");
          i++; setTimeout(next, 2200);
        }, 1100);
      })();
    }
    chat._start = function () { if (!started) { started = true; run(); } };
  });

  // ---- the ruler: a loan drifts toward risk, the agent pushes it back, then a sale back to 78%
  $$(".ruler").forEach(function (ruler) {
    var m = ruler.querySelector(".marker"), tag = m && m.querySelector(".tag");
    var legend = ruler.parentNode.querySelector(".ruler-legend"), segs = $$(".bar i", ruler), spans = legend ? $$("span", legend) : [];
    var tags = legend ? (legend.getAttribute("data-tags") || "").split("|") : [];
    if (!m || reduce) { if (m) m.style.display = "none"; return; }
    if (legend) legend.classList.add("live");
    // [position %, tag index, segment index, legend index, class]
    var seq = [[45, 0, 0, 0, ""], [71, 1, 1, 1, "act"], [60, 2, 0, 0, ""], [84, 3, 3, 2, "alert"], [78, 4, 2, 3, "act"], [45, 0, 0, 0, ""]];
    var k = 0;
    function step() {
      var s = seq[k % seq.length]; k++;
      m.style.left = s[0] + "%";
      m.className = "marker " + s[4];
      if (tag) tag.textContent = (tags[s[1]] || "") + " · " + s[0] + "%";
      segs.forEach(function (g, i) { g.classList.toggle("hot", i === s[2]); });
      spans.forEach(function (sp, i) { sp.classList.toggle("hot", i === s[3]); });
    }
    ruler._start = function () { if (!ruler._t) { step(); ruler._t = setInterval(step, 2600); } };
  });

  // ---- reveal on scroll
  var targets = $$(".reveal, .printer, .cascade, [data-count], .meter, .chat, .ruler");
  function show(el) {
    el.classList.add("in");
    if (el.hasAttribute("data-count")) countUp(el);
    if (el.classList.contains("meter")) { var f = el.querySelector(".fill"); if (f) f.style.width = f.getAttribute("data-w"); }
    if (el._start) el._start();
  }
  if (!("IntersectionObserver" in window) || reduce) { targets.forEach(show); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } });
  }, { threshold: 0.2, rootMargin: "0px 0px -5% 0px" });
  targets.forEach(function (el) { io.observe(el); });
  // A safety net for webviews that never report intersections: everything shows after 3 s.
  setTimeout(function () { targets.forEach(function (el) { if (!el.classList.contains("in") && el.getBoundingClientRect().top < innerHeight) show(el); }); }, 3000);
})();
