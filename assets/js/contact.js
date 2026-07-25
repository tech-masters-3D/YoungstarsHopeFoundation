/**
 * Handles submission for any form that follows this pattern:
 *   - has a hidden input name="form_type" (contact / volunteer / subscribe)
 *   - has a hidden honeypot input name="honeypot"
 *   - has a status element right after it with id="<formId>Status"
 *   - has a submit button right after it with id="<formId>SubmitBtn"
 *
 * Reuse this same script on volunteer/subscribe forms by giving those
 * forms an id and adding that id to FORM_IDS below.
 */
(function () {
  const FORM_IDS = ["contactForm", "volunteerForm", "subscribeForm"];

  FORM_IDS.forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) return;

    const statusEl = document.getElementById(formId.replace("Form", "Status")) ||
                      form.querySelector(".form-status");
    const submitBtn = document.getElementById(formId.replace("Form", "SubmitBtn")) ||
                       form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const originalBtnHTML = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Sending&hellip;';
      }
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "form-status";
      }

      const payload = Object.fromEntries(new FormData(form).entries());

      try {
        const response = await fetch("/submit-form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          if (statusEl) {
            statusEl.textContent = "Thanks — your message has been sent. We'll be in touch soon.";
            statusEl.className = "form-status form-status-success";
          }
          form.reset();
        } else {
          if (statusEl) {
            statusEl.textContent =
              (data && data.message) ||
              "Something went wrong sending your message. Please try again or email us directly.";
            statusEl.className = "form-status form-status-error";
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent =
            "Network error — please check your connection and try again.";
          statusEl.className = "form-status form-status-error";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHTML;
        }
      }
    });
  });
})();