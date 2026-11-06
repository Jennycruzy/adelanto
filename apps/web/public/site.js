// Page motion, nothing else: reveal on scroll, count-up figures, the comparison bars, the nav edge.
// Everything degrades to the finished state without JavaScript or with reduced motion.
(function () {
  var d = document.documentElement;
  d.classList.remove("no-js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function countUp(el) {
    var to = parseFloat(el.getAttribute("data-count"));
    if (isNaN(to) || reduce) return;
    var dec = parseInt(el.getAttribute("data-dec") || "0", 10);
    var fmt = new Intl.NumberFormat(el.getAttribute("data-locale") || "es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    var pre = el.getAttribute("data-pre") || "", post = el.getAttribute("data-post") || "";
    var t0 = null, dur = 1400;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = pre + fmt.format(to * e) + post;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var targets = document.querySelectorAll(".reveal, .compare, [data-count], .meter");
  if (!("IntersectionObserver" in window) || reduce) {
    targets.forEach(function (el) { el.classList.add("in"); });
    document.querySelectorAll(".meter .fill").forEach(function (f) { f.style.width = f.getAttribute("data-w"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      el.classList.add("in");
      if (el.hasAttribute("data-count")) countUp(el);
      if (el.classList.contains("meter")) { var f = el.querySelector(".fill"); if (f) f.style.width = f.getAttribute("data-w"); }
      io.unobserve(el);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
  targets.forEach(function (el) { io.observe(el); });
})();
