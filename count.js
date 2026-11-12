// Counts one page view (path + the site you came from). No cookies, nothing stored in your browser.
// Also shows the result of an email-alert sign-up on model pages.
(function () {
  var API = "https://driftline-api.aidriftline.workers.dev";
  try { navigator.sendBeacon(API + "/hit", JSON.stringify({ p: location.pathname, r: document.referrer })); } catch (e) {}
  var state = new URLSearchParams(location.search).get("alert");
  var msg = document.querySelector(".alert-msg");
  var text = {
    sent: "Check your inbox and click the link to confirm.",
    on: "Confirmed. You'll get an email 30 days before, 7 days before and on the day.",
    bad: "That didn't work. Check the address and try again.",
    busy: "Too many sign-ups right now. Please try again later."
  }[state];
  if (msg && text) { msg.textContent = text; msg.hidden = false; }
})();
