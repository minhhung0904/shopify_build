document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-vcn-remove-item]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var line = btn.closest('[data-vcn-cart-line]');
      var input = line && line.querySelector('input[name="updates[]"]');
      if (input) {
        input.value = 0;
        input.closest('form').submit();
      }
    });
  });
});
