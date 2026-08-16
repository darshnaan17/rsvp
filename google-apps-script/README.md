# Private RSVP backend setup

1. Open the private RSVP Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Replace the default code with `Code.gs` and save.
4. Choose **Deploy → New deployment → Web app**.
5. Set **Execute as** to yourself and **Who has access** to anyone.
6. Authorize and deploy, then copy the `/exec` URL.
7. Paste that URL into `config.js` as `apiUrl`.

The public endpoint never returns the full guest list. A private edit token retrieves only its own RSVP.
