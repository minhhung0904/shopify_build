(function () {
  document.querySelectorAll('[id^="PromoPopup-"]').forEach(function (popup) {
    var storageKey = 'promo-popup-dismissed-' + popup.id;
    var frequency = popup.dataset.frequency;
    var delay = parseInt(popup.dataset.delay, 10) || 0;

    if (frequency === 'session' && sessionStorage.getItem(storageKey)) {
      return;
    }

    var timer = window.setTimeout(function () {
      popup.classList.add('is-open');
    }, delay);

    function close() {
      popup.classList.remove('is-open');
      window.clearTimeout(timer);
      if (frequency === 'session') {
        sessionStorage.setItem(storageKey, 'true');
      }
    }

    popup.querySelectorAll('[data-promo-popup-close]').forEach(function (btn) {
      btn.addEventListener('click', close);
    });

    popup.addEventListener('click', function (event) {
      if (event.target === popup) close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && popup.classList.contains('is-open')) close();
    });
  });
})();
