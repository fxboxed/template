// public/js/cookie-consent.js
(() => {
  const CONSENT_COOKIE = "aptati_consent";
  const CONSENT_DAYS = 180;

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  function setCookie(name, value, days) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie =
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }

  function readConsent() {
    const raw = getCookie(CONSENT_COOKIE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function writeConsent(consent) {
    setCookie(CONSENT_COOKIE, JSON.stringify(consent), CONSENT_DAYS);
  }

  function showAllBars() {
    document.querySelectorAll('[data-consent="bar"]').forEach((el) => (el.hidden = false));
  }
  function hideAllBars() {
    document.querySelectorAll('[data-consent="bar"]').forEach((el) => (el.hidden = true));
  }
  function openAllPanels() {
    document.querySelectorAll('[data-consent="panel"]').forEach((el) => (el.hidden = false));
  }
  function closeAllPanels() {
    document.querySelectorAll('[data-consent="panel"]').forEach((el) => (el.hidden = true));
  }

  function setAnalyticsCheckbox(value) {
    document.querySelectorAll('[data-cc-field="analytics"]').forEach((cb) => {
      cb.checked = Boolean(value);
    });
  }

  function loadGoogleAnalytics() {
    const id = window.__GA_MEASUREMENT_ID__;
    if (!id) return;

    if (document.querySelector(`script[data-ga="gtag"][src*="id=${id}"]`)) return;

    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: "granted" });
    }

    const s = document.createElement("script");
    s.async = true;
    s.dataset.ga = "gtag";
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);

    if (typeof window.gtag === "function") {
      window.gtag("js", new Date());
      window.gtag("config", id, { anonymize_ip: true });
    }
  }

  function applyConsent(consent) {
    const analyticsOn = Boolean(consent && consent.analytics);

    // Keep consent mode denied unless user opted in
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: analyticsOn ? "granted" : "denied",
      });
    }

    if (analyticsOn) loadGoogleAnalytics();
  }

  function init() {
    const consent = readConsent();

    if (!consent) {
      // No stored choice yet -> show the banner (even if GA ID isn't set yet)
      showAllBars();
      closeAllPanels();
      return;
    }

    // Stored choice exists -> apply it
    applyConsent(consent);
    hideAllBars();
    closeAllPanels();
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cc]");
    if (!btn) return;

    const action = btn.getAttribute("data-cc");
    const current = readConsent() || { analytics: false };

    if (action === "accept") {
      const consent = { analytics: true };
      writeConsent(consent);
      applyConsent(consent);
      hideAllBars();
      closeAllPanels();
      return;
    }

    if (action === "reject") {
      const consent = { analytics: false };
      writeConsent(consent);
      applyConsent(consent);
      hideAllBars();
      closeAllPanels();
      return;
    }

    if (action === "manage") {
      setAnalyticsCheckbox(current.analytics);
      openAllPanels();
      return;
    }

    if (action === "save") {
      const analyticsChecked = Boolean(
        document.querySelector('[data-cc-field="analytics"]')?.checked
      );
      const consent = { analytics: analyticsChecked };
      writeConsent(consent);
      applyConsent(consent);
      hideAllBars();
      closeAllPanels();
      return;
    }

    if (action === "close") {
      closeAllPanels();
    }
  });

  window.aptatiOpenCookieSettings = () => {
    const current = readConsent() || { analytics: false };
    setAnalyticsCheckbox(current.analytics);
    showAllBars();
    openAllPanels();
  };

  init();
})();
