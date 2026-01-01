// public/js/contact-modal.js
document.addEventListener("DOMContentLoaded", () => {
    const contactToggle = document.getElementById("contactToggle");
    const contactModal = document.getElementById("contactModal");
    const closeModal = document.getElementById("closeModal");
    const form = contactModal?.querySelector("form");
    const formContainer = contactModal?.querySelector(".modal-liner");

    if (!contactToggle || !contactModal || !closeModal || !form || !formContainer) return;

    contactToggle.addEventListener("click", () => {
        contactModal.classList.add("show");
        console.log("Contact modal opened");
    });
    closeModal.addEventListener("click", () => contactModal.classList.remove("show"));

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        // prevent double-submits
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        // Build x-www-form-urlencoded body
        const fd = new FormData(form);
        // make sure honeypot is empty (just in case browsers autofill it)
        if (!fd.has("website")) fd.set("website", "");
        else if (fd.get("website") == null) fd.set("website", "");

        const body = new URLSearchParams();
        for (const [k, v] of fd.entries()) body.append(k, v);

        try {
            const res = await fetch("/contact", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body,
            });

            // Try JSON first, then fall back to text so we always show something useful
            let data, rawText;
            try {
                data = await res.json();
            } catch {
                try {
                    rawText = await res.text();
                } catch {
                    rawText = "";
                }
            }

            // Minimal console diagnostics
            console.log("Contact response:", { status: res.status, ok: res.ok, data, rawText });

            if (!res.ok) {
                const msg =
                    (data && (data.message || data.error)) ||
                    (rawText && rawText.slice(0, 300)) ||
                    `Request failed with status ${res.status}`;
                formContainer.innerHTML = `<p class="error-message">${msg}</p>`;
                return;
            }

            const okMsg = (data && data.message) || "Thank you for contacting us!";
            formContainer.innerHTML = `<p class="success-message">${okMsg}</p>`;
            setTimeout(() => contactModal.classList.remove("show"), 1500);
            form.reset();
        } catch (err) {
            console.error("Fetch error:", err);
            formContainer.innerHTML = `<p class="error-message">Network error. Please try again.</p>`;
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
});