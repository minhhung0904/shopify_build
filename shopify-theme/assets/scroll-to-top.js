(function () {
  document.querySelectorAll('[id^="ScrollToTop-"]').forEach(function (btn) {
    var threshold = parseInt(btn.dataset.threshold, 10) || 600;

    function toggle() {
      if (window.scrollY > threshold) {
        btn.classList.add('is-visible');
      } else {
        btn.classList.remove('is-visible');
      }
    }

    window.addEventListener('scroll', toggle, { passive: true });
    toggle();

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
