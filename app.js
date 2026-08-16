(() => {
  "use strict";
  const cfg = window.RSVP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const form = $("#rsvp-form");
  const first = $("#first-name");
  const last = $("#last-name");
  const guestSection = $("#guest-section");
  const guestList = $("#guest-list");
  const partyCount = $("#party-count");
  const partyLabel = $("#party-label");
  const tokenInput = $("#edit-token");
  const submitButton = $("#submit-button");
  const submitLabel = $("#submit-label");
  const errorBox = $("#form-error");
  const successView = $("#success-view");
  const loadingView = $("#loading-view");
  const closedView = $("#closed-view");
  const frame = $("#submission-frame");
  let editLink = "";
  let timer;
  let finished = false;

  const status = () => form.querySelector('input[name="status"]:checked')?.value || "";
  const clean = (v) => v.trim().replace(/\s+/g, " ");
  const closed = () => Date.now() >= new Date(cfg.deadline).getTime();

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function showError(message, field) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
  }

  function updateCount() {
    const count = status() === "attending" ? 1 + guestList.children.length : 0;
    partyCount.textContent = String(count);
    partyLabel.textContent = count === 1 ? "guest total" : "guests total";
  }

  function addGuest(guest = {}) {
    const row = document.createElement("div");
    row.className = "guest-row";
    row.innerHTML = `
      <label class="guest-field"><span>First name</span><input class="guest-first" type="text" maxlength="60" required></label>
      <label class="guest-field"><span>Last name</span><input class="guest-last" type="text" maxlength="60" required></label>
      <button class="remove-guest" type="button" aria-label="Remove this guest">×</button>`;
    row.querySelector(".guest-first").value = guest.firstName || "";
    row.querySelector(".guest-last").value = guest.lastName || "";
    row.querySelector("button").addEventListener("click", () => { row.remove(); updateCount(); });
    guestList.append(row);
    updateCount();
    if (!guest.firstName) row.querySelector(".guest-first").focus();
  }

  function guests() {
    return [...guestList.children].map((row) => ({
      firstName: clean(row.querySelector(".guest-first").value),
      lastName: clean(row.querySelector(".guest-last").value),
    }));
  }

  function valid() {
    clearError();
    if (!clean(first.value)) return showError("Please enter your first name.", first), false;
    if (!clean(last.value)) return showError("Please enter your last name.", last), false;
    if (!status()) return showError("Please let us know whether you will attend."), false;
    if (status() === "attending") {
      for (const row of guestList.children) {
        const gf = row.querySelector(".guest-first");
        const gl = row.querySelector(".guest-last");
        if (!clean(gf.value)) return showError("Enter every guest’s first name, or remove the empty guest.", gf), false;
        if (!clean(gl.value)) return showError("Enter every guest’s last name, or remove the empty guest.", gl), false;
      }
    }
    return true;
  }

  function submitting(value) {
    submitButton.disabled = value;
    submitLabel.textContent = value ? "Saving your RSVP…" : tokenInput.value ? "Update RSVP" : "Submit RSVP";
  }

  function post(payload) {
    const postForm = document.createElement("form");
    postForm.method = "POST";
    postForm.action = cfg.apiUrl;
    postForm.target = frame.name;
    postForm.hidden = true;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    postForm.append(input);
    document.body.append(postForm);
    postForm.submit();
    postForm.remove();
    timer = setTimeout(() => {
      submitting(false);
      showError(`We couldn’t confirm your RSVP. Try again or contact ${cfg.hostName} at ${cfg.hostPhone}.`);
    }, 15000);
    confirmSaved(payload.token, payload);
  }

  function confirmSaved(token, expected, attempt = 0) {
    const callback = `rsvpSaveCallback${Date.now()}${attempt}`;
    window[callback] = (result) => {
      delete window[callback];
      const expectedCount = expected.status === "attending" ? 1 + expected.guests.length : 0;
      const matches = result.ok && result.status === expected.status
        && result.firstName === expected.firstName && result.lastName === expected.lastName
        && Number(result.guestCount) === expectedCount;
      if (matches) return finish({ ...result, token });
      if (attempt < 7 && !finished) setTimeout(() => confirmSaved(token, expected, attempt + 1), 900);
    };
    const script = document.createElement("script");
    script.src = `${cfg.apiUrl}?action=get&token=${encodeURIComponent(token)}&callback=${callback}&_=${Date.now()}`;
    script.onerror = () => {
      delete window[callback];
      if (attempt < 7 && !finished) setTimeout(() => confirmSaved(token, expected, attempt + 1), 900);
    };
    script.onload = () => script.remove();
    document.body.append(script);
  }

  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    submitting(false);
    if (!result.ok) return showError(result.message || "We couldn’t save your RSVP. Please try again.");
    const base = `${location.origin}${location.pathname}`;
    editLink = `${base}?edit=${encodeURIComponent(result.token)}`;
    localStorage.setItem("darshanRsvpEditLink", editLink);
    $("#success-title").textContent = result.status === "attending" ? "We can’t wait to celebrate!" : "Thank you for letting us know";
    $("#success-message").textContent = result.status === "attending"
      ? `Your party of ${result.guestCount} has been added to the guest list.`
      : "Your response has been saved. You’ll be missed!";
    form.hidden = true;
    successView.hidden = false;
    successView.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function populate(result) {
    loadingView.hidden = true;
    if (!result.ok) {
      form.hidden = false;
      return showError(result.message || `We couldn’t find that RSVP. Contact ${cfg.hostName} at ${cfg.hostPhone}.`);
    }
    first.value = result.firstName || "";
    last.value = result.lastName || "";
    tokenInput.value = result.token || "";
    const option = form.querySelector(`input[name="status"][value="${result.status}"]`);
    if (option) option.checked = true;
    guestList.replaceChildren();
    (result.guests || []).forEach(addGuest);
    guestSection.hidden = result.status !== "attending";
    submitLabel.textContent = "Update RSVP";
    form.hidden = false;
    updateCount();
  }

  function load(token) {
    if (!cfg.apiUrl) return;
    form.hidden = true;
    loadingView.hidden = false;
    window.rsvpEditCallback = populate;
    const script = document.createElement("script");
    script.src = `${cfg.apiUrl}?action=get&token=${encodeURIComponent(token)}&callback=rsvpEditCallback&_=${Date.now()}`;
    script.onerror = () => populate({ ok: false, message: "We couldn’t load that RSVP." });
    document.body.append(script);
  }

  form.addEventListener("input", clearError);
  form.addEventListener("change", (event) => {
    if (event.target.name === "status") {
      guestSection.hidden = status() !== "attending";
      updateCount();
    }
  });
  $("#add-guest").addEventListener("click", () => addGuest());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (closed()) { form.hidden = true; closedView.hidden = false; return; }
    if (!cfg.apiUrl) return showError("The RSVP form is being connected. Please check back shortly.");
    if (!valid()) return;
    finished = false;
    submitting(true);
    const privateToken = tokenInput.value || `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
    post({
      firstName: clean(first.value), lastName: clean(last.value), status: status(),
      guests: status() === "attending" ? guests() : [], token: privateToken,
      website: $("#website").value,
    });
  });
  window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data?.source === "darshan-rsvp") finish(event.data);
  });
  $("#copy-link").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(editLink); $("#copy-status").textContent = "Private edit link copied!"; }
    catch { window.prompt("Copy your private edit link:", editLink); }
  });

  if (closed()) { form.hidden = true; closedView.hidden = false; return; }
  const token = new URLSearchParams(location.search).get("edit");
  if (token) load(token);
})();
