// The closed-beta waitlist, a Tally form: "Join the beta" buttons open it as
// a popup, passing the visit's UTM params and ref along as hidden fields, and
// count a signup in Plausible. The repository and docs are still private, so
// their links say so instead of landing on a 404.
(() => {
  const FORM_ID = 'xVrPeE';

  const params = new URLSearchParams(location.search);
  const hiddenFields = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ref']) {
    const value = params.get(key);
    if (value) hiddenFields[key] = value;
  }

  const soon = document.querySelector('.soon');

  // Without Tally (blocked or still loading) the buttons stay links to the
  // form's own page.
  for (const button of document.querySelectorAll('[data-beta]')) {
    button.addEventListener('click', (event) => {
      if (!window.Tally) return;
      event.preventDefault();
      soon.close();
      window.Tally.openPopup(FORM_ID, {
        layout: 'modal',
        hiddenFields,
        onSubmit: () => window.plausible?.('Beta Signup'),
      });
    });
  }

  for (const link of document.querySelectorAll('a[href^="https://github.com/TheBrainBro/"]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      soon.showModal();
    });
  }

  soon.querySelector('[data-close]').addEventListener('click', () => soon.close());
  // A click on the backdrop lands on the dialog itself.
  soon.addEventListener('click', (event) => {
    if (event.target === soon) soon.close();
  });
})();
