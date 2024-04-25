document.addEventListener('DOMContentLoaded', function () {
  console.log('Hello, Javascript World!');
});

document.addEventListener('DOMContentLoaded', function () {
  console.log('Loaded the toggler!');
  const expandToggles = document.querySelectorAll('.expand-toggle');

  expandToggles.forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      const expand = this.closest('.expand');
      expand.classList.toggle('active');
    });
  });
});
