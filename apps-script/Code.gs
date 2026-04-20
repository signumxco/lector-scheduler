/**
 * Lector Scheduling System — Google Apps Script Backend
 *
 * Handles all six system flows:
 *   Flow 1 — Availability request emails (16th of month)
 *   Flow 2 — Availability calendar web endpoints
 *   Flow 3 — Auto-schedule generation (23rd of month)
 *   Flow 4 — Coordinator approval via custom menu
 *   Flow 5 — Lector notification emails with scraped readings
 *   Flow 6 — Swap request handling
 *
 * IMPORTANT: Readings and prep notes are ALWAYS scraped verbatim.
 * They are NEVER generated or paraphrased by AI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — edit these via Script Properties (File > Project properties)
// Keys: SPREADSHEET_ID, COORDINATOR_EMAIL, GITHUB_USERNAME, ANTHROPIC_API_KEY (optional)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the script's property store. All sensitive config lives here,
 * never hard-coded.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    coordinatorEmail: props.getProperty('COORDINATOR_EMAIL') || '',
    githubUsername: props.getProperty('GITHUB_USERNAME') || '',
    anthropicKey: props.getProperty('ANTHROPIC_API_KEY') || '',   // optional
    parishName: props.getProperty('PARISH_NAME') || 'Our Parish',
    scriptUrl: props.getProperty('SCRIPT_URL') || '',             // deployed web app URL
  };
}

/**
 * Returns the active spreadsheet (must have SPREADSHEET_ID set).
 */
function getSpreadsheet() {
  const id = getConfig().spreadsheetId;
  if (!id) throw new Error('SPREADSHEET_ID not set in Script Properties.');
  return SpreadsheetApp.openById(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM MENU — appears in the spreadsheet toolbar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs automatically when the spreadsheet is opened.
 * Adds the "Lector System" menu for coordinator actions.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Lector System')
    .addItem('Send Availability Requests (Flow 1)', 'sendAvailabilityRequests')
    .addSeparator()
    .addItem('Generate Schedule Now (Flow 3)', 'generateSchedule')
    .addSeparator()
    .addItem('Publish Approved Schedule (Flow 5)', 'publishSchedule')
    .addSeparator()
    .addItem('Send Reminder Emails', 'sendReminderEmails')
    .addSeparator()
    .addItem('Set Up Monthly Triggers', 'createTriggers')
    .addItem('Initialize Sheet Tabs', 'initializeSheetTabs')
    .addToUi();
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB APP ENDPOINTS — doGet / doPost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point for all GET requests from the web app.
 * Routes by the `action` query parameter.
 *
 * Supported actions:
 *   getAvailabilityData — returns lector name + mass schedule for token
 *   getSwapData         — returns lector's assigned masses for swap form
 */
function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || '';

  try {
    let result;
    switch (action) {
      case 'getAvailabilityData':
        result = getAvailabilityData(params.token);
        break;
      case 'getSwapData':
        result = getSwapData(params.token, params.mass);
        break;
      default:
        result = { error: 'Unknown action.' };
    }
    return jsonResponse(result);
  } catch (err) {
    Logger.log('doGet error: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}

/**
 * Entry point for all POST requests from the web app.
 * Routes by the `action` body parameter.
 *
 * Supported actions:
 *   submitAvailability — writes lector availability to Sheet
 *   requestSwap        — triggers swap notification email to all lectors
 */
function doPost(e) {
  let params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (_) {
    params = e.parameter || {};
  }

  const action = params.action || '';

  try {
    let result;
    switch (action) {
      case 'submitAvailability':
        result = submitAvailability(params);
        break;
      case 'requestSwap':
        result = requestSwap(params);
        break;
      default:
        result = { error: 'Unknown action.' };
    }
    return jsonResponse(result);
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return jsonResponse({ error: err.message });
  }
}

/**
 * Wraps a JS object in a JSON ContentService response with CORS headers.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1 — AVAILABILITY REQUEST EMAILS (runs 16th of month)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique token per active lector for next month,
 * saves them to the Tokens tab, then emails each lector their link.
 *
 * Triggered automatically on the 16th; can also be run manually.
 */
function sendAvailabilityRequests() {
  const config = getConfig();
  const ss = getSpreadsheet();
  const lectorsSheet = ss.getSheetByName('Lectors');
  const tokensSheet  = ss.getSheetByName('Tokens');

  if (!lectorsSheet || !tokensSheet) {
    throw new Error('Required sheet tabs not found. Run "Initialize Sheet Tabs" first.');
  }

  // Determine next month's year/month
  const now = new Date();
  let targetMonth = now.getMonth() + 2; // JS months are 0-indexed; +1 for next month, +1 more to get 1-based
  let targetYear  = now.getFullYear();
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear++;
  }

  // Read active lectors
  const lectorData = lectorsSheet.getDataRange().getValues();
  const headers = lectorData[0];
  const nameCol   = headers.indexOf('Name');
  const emailCol  = headers.indexOf('Email');
  const activeCol = headers.indexOf('Active');

  const activeLectors = lectorData.slice(1).filter(row => {
    const active = row[activeCol];
    return active === true || active === 'TRUE' || active === 'Yes' || active === 'yes';
  });

  if (activeLectors.length === 0) {
    SpreadsheetApp.getUi().alert('No active lectors found in the Lectors tab.');
    return;
  }

  const githubBase = `https://${config.githubUsername}.github.io/lector-scheduler/web`;
  const now_ = new Date();

  let emailsSent = 0;
  const errors   = [];

  activeLectors.forEach(row => {
    const name  = row[nameCol];
    const email = row[emailCol];
    if (!name || !email) return;

    // Check if a token already exists for this lector + month/year
    const existing = findExistingToken(tokensSheet, email, targetMonth, targetYear);
    const token = existing || generateToken();

    if (!existing) {
      tokensSheet.appendRow([token, email, targetMonth, targetYear, false]);
    }

    const availUrl = `${githubBase}/availability.html?token=${token}`;

    const monthName = new Date(targetYear, targetMonth - 1, 1)
      .toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const subject = `Lector Availability Request — ${monthName}`;
    const body = buildAvailabilityRequestEmail(name, monthName, availUrl, config.parishName);

    try {
      GmailApp.sendEmail(email, subject, '', { htmlBody: body, name: config.parishName + ' Lector Schedule' });
      emailsSent++;
      Logger.log(`Sent availability request to ${name} (${email})`);
    } catch (err) {
      errors.push(`${name} <${email}>: ${err.message}`);
      Logger.log(`Failed to email ${name}: ${err.message}`);
    }
  });

  const summary = `Sent ${emailsSent} availability request emails for ${new Date(targetYear, targetMonth - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}.`;
  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert(summary + '\n\nErrors:\n' + errors.join('\n'));
  } else {
    SpreadsheetApp.getUi().alert(summary);
  }
}

/**
 * Checks if a token already exists for the given email/month/year.
 * Returns the token string if found, null otherwise.
 */
function findExistingToken(tokensSheet, email, month, year) {
  const data = tokensSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === email && Number(data[i][2]) === month && Number(data[i][3]) === year) {
      return data[i][0];
    }
  }
  return null;
}

/**
 * Generates a UUID v4 token string using Apps Script's built-in utility.
 */
function generateToken() {
  return Utilities.getUuid();
}

/**
 * Builds the HTML body for the availability request email.
 */
function buildAvailabilityRequestEmail(name, monthName, availUrl, parishName) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
  <div style="background: #1a3a5c; color: white; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; font-size: 22px;">${parishName}</h2>
    <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.85;">Lector Schedule</p>
  </div>
  <div style="padding: 32px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Dear ${name},</p>
    <p>Please submit your availability for <strong>${monthName}</strong> by clicking the button below.</p>
    <p>This link is personal to you — please do not share it.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${availUrl}"
         style="background: #1a3a5c; color: white; text-decoration: none;
                padding: 14px 32px; border-radius: 6px; font-size: 16px;
                display: inline-block;">
        Submit My Availability
      </a>
    </div>

    <p style="font-size: 14px; color: #555;">
      <strong>Deadline:</strong> 7 days from today.<br>
      If you have any issues, please contact the coordinator directly.
    </p>

    <p>Thank you for your ministry!</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="font-size: 12px; color: #888;">
      This link is unique to you. If you need to re-submit, use the same link —
      your previous response will be replaced.
    </p>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2 — AVAILABILITY CALENDAR WEB ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET endpoint: returns lector name + all Mass date/times for next month.
 *
 * Called by the web app after the lector opens their unique link.
 * Validates the token before returning any data.
 *
 * @param {string} token — UUID from the lector's email link
 * @returns {object} { lectorName, month, year, masses: [...] }
 */
function getAvailabilityData(token) {
  if (!token) return { error: 'Missing token.' };

  const ss = getSpreadsheet();
  const tokensSheet   = ss.getSheetByName('Tokens');
  const massTimesSheet = ss.getSheetByName('MassTimes');

  const tokenRow = findToken(tokensSheet, token);
  if (!tokenRow) return { error: 'Invalid or expired token.' };

  const lectorEmail = tokenRow[1];
  const month       = Number(tokenRow[2]);
  const year        = Number(tokenRow[3]);
  // Note: we do NOT block used tokens on GET — lectors should be able to re-view

  // Look up lector name from Lectors tab
  const lectorName = getLectorName(ss, lectorEmail);

  // Get all Mass date/times for the target month
  const masses = getMassesForMonth(massTimesSheet, month, year);

  // Attach any existing availability for this lector
  const availability = getExistingAvailability(ss, token, masses);

  return {
    lectorName,
    lectorEmail,
    month,
    year,
    monthName: new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' }),
    masses: masses.map(m => ({
      ...m,
      available: availability[m.massDateTime] !== undefined ? availability[m.massDateTime] : null,
    })),
  };
}

/**
 * POST endpoint: writes the lector's availability selections to the Availability tab.
 *
 * @param {object} params — { token, selections: [{massDateTime, available}] }
 * @returns {object} { success: true, message }
 */
function submitAvailability(params) {
  const { token, selections } = params;
  if (!token) return { error: 'Missing token.' };
  if (!Array.isArray(selections)) return { error: 'Missing selections.' };

  const ss = getSpreadsheet();
  const tokensSheet      = ss.getSheetByName('Tokens');
  const availabilitySheet = ss.getSheetByName('Availability');

  const tokenRow = findToken(tokensSheet, token);
  if (!tokenRow) return { error: 'Invalid or expired token.' };

  const lectorEmail = tokenRow[1];
  const lectorName  = getLectorName(ss, lectorEmail);
  const now = new Date().toISOString();

  // Remove existing entries for this token so re-submission is clean
  clearAvailabilityForToken(availabilitySheet, token);

  // Write new selections
  selections.forEach(sel => {
    availabilitySheet.appendRow([
      token,
      lectorName,
      sel.massDateTime,
      sel.available === true || sel.available === 'true',
      now,
    ]);
  });

  // Mark token as used
  markTokenUsed(tokensSheet, token);

  Logger.log(`Availability submitted for ${lectorName} (token: ${token}), ${selections.length} entries.`);

  return {
    success: true,
    message: `Thank you, ${lectorName}! Your availability has been saved.`,
    lectorName,
  };
}

/**
 * Looks up a token row in the Tokens tab.
 * Returns the row array if found, null if not.
 */
function findToken(tokensSheet, token) {
  const data = tokensSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) return data[i];
  }
  return null;
}

/**
 * Returns lector name for a given email from the Lectors tab.
 */
function getLectorName(ss, email) {
  const sheet = ss.getSheetByName('Lectors');
  const data  = sheet.getDataRange().getValues();
  const emailCol = data[0].indexOf('Email');
  const nameCol  = data[0].indexOf('Name');
  for (let i = 1; i < data.length; i++) {
    if (data[i][emailCol] === email) return data[i][nameCol];
  }
  return email; // fallback to email if name not found
}

/**
 * Returns all Mass date/time objects for a given month/year,
 * derived from the MassTimes tab (recurring weekly schedule).
 *
 * MassTimes columns: DayOfWeek | Time | Label | IsTriduum
 * DayOfWeek values: Sunday, Monday, ..., Saturday
 *
 * @returns {Array<{massDateTime, label, isTriduum, dayOfWeek, time}>}
 */
function getMassesForMonth(massTimesSheet, month, year) {
  const data = massTimesSheet.getDataRange().getValues();
  const headers     = data[0];
  const dowCol      = headers.indexOf('DayOfWeek');
  const timeCol     = headers.indexOf('Time');
  const labelCol    = headers.indexOf('Label');
  const triduumCol  = headers.indexOf('IsTriduum');

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const masses = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const date   = new Date(year, month - 1, day);
    const dowName = dayNames[date.getDay()];

    data.slice(1).forEach(row => {
      if (row[dowCol] === dowName) {
        // Combine date + time into a sortable ISO-like string
        const timeStr  = row[timeCol] || '00:00';
        const label    = row[labelCol] || '';
        const isTriduum = row[triduumCol] === true || row[triduumCol] === 'TRUE' || row[triduumCol] === 'Yes';

        // Format: "YYYY-MM-DD HH:MM" (24h, used as unique key)
        const datePart = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const massDateTime = `${datePart} ${timeStr}`;

        masses.push({ massDateTime, label, isTriduum, dayOfWeek: dowName, time: timeStr, date: datePart });
      }
    });
  }

  // Sort chronologically
  masses.sort((a, b) => a.massDateTime.localeCompare(b.massDateTime));
  return masses;
}

/**
 * Returns a map of massDateTime → available (bool) for this token's existing submissions.
 */
function getExistingAvailability(ss, token, masses) {
  const sheet = ss.getSheetByName('Availability');
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('Token');
  const mdtCol   = headers.indexOf('MassDateTime');
  const availCol = headers.indexOf('Available');

  const result = {};
  data.slice(1).forEach(row => {
    if (row[tokenCol] === token) {
      result[row[mdtCol]] = row[availCol];
    }
  });
  return result;
}

/**
 * Deletes all rows in the Availability tab matching the given token.
 * Used to allow clean re-submission.
 */
function clearAvailabilityForToken(sheet, token) {
  const data = sheet.getDataRange().getValues();
  // Iterate bottom-up so row deletion doesn't shift indices
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === token) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * Sets the Used column to TRUE for the given token.
 */
function markTokenUsed(tokensSheet, token) {
  const data = tokensSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      tokensSheet.getRange(i + 1, 5).setValue(true); // column 5 = Used
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3 — AUTO-SCHEDULE GENERATION (runs 23rd of month)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads all availability submissions, runs the scheduling algorithm,
 * scrapes USCCB + lectorprep for URLs, writes results to the Schedule tab,
 * and emails the coordinator a review link.
 *
 * Triggered automatically on the 23rd; can also be run manually.
 */
function generateSchedule() {
  const config = getConfig();
  const ss = getSpreadsheet();
  const massTimesSheet    = ss.getSheetByName('MassTimes');
  const availabilitySheet = ss.getSheetByName('Availability');
  const scheduleSheet     = ss.getSheetByName('Schedule');

  // Target: next month
  const now = new Date();
  let targetMonth = now.getMonth() + 2;
  let targetYear  = now.getFullYear();
  if (targetMonth > 12) { targetMonth = 1; targetYear++; }

  const monthName = new Date(targetYear, targetMonth - 1, 1)
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });

  Logger.log(`Generating schedule for ${monthName}...`);

  // ── 1. Collect all masses for the month ──────────────────────────────────
  const masses = getMassesForMonth(massTimesSheet, targetMonth, targetYear);
  if (masses.length === 0) {
    SpreadsheetApp.getUi().alert('No Mass times found. Please populate the MassTimes tab.');
    return;
  }

  // ── 2. Collect availability responses ────────────────────────────────────
  const availData = availabilitySheet.getDataRange().getValues();
  const aHeaders  = availData[0];
  const aTokenCol = aHeaders.indexOf('Token');
  const aNameCol  = aHeaders.indexOf('LectorName');
  const aMdtCol   = aHeaders.indexOf('MassDateTime');
  const aAvailCol = aHeaders.indexOf('Available');

  // Build map: massDateTime → [lectorName, ...]
  const availabilityMap = {};
  masses.forEach(m => { availabilityMap[m.massDateTime] = []; });

  availData.slice(1).forEach(row => {
    const mdt   = row[aMdtCol];
    const name  = row[aNameCol];
    const avail = row[aAvailCol] === true || row[aAvailCol] === 'TRUE';
    if (avail && availabilityMap[mdt] !== undefined) {
      if (!availabilityMap[mdt].includes(name)) {
        availabilityMap[mdt].push(name);
      }
    }
  });

  // ── 3. Run scheduling algorithm ──────────────────────────────────────────
  const assignments = scheduleAlgorithm(masses, availabilityMap);

  // ── 4. Scrape readings + prep URLs ───────────────────────────────────────
  Logger.log('Scraping readings and prep URLs...');
  assignments.forEach(a => {
    const dateObj = parseMassDate(a.massDateTime);
    a.readingsUrl = scrapeUSCCBUrl(dateObj);
    a.prepUrl     = scrapeLectorPrepUrl(dateObj);
    Utilities.sleep(500); // be polite to external servers
  });

  // ── 5. Write to Schedule tab ─────────────────────────────────────────────
  // Clear existing entries for this month
  clearScheduleForMonth(scheduleSheet, targetMonth, targetYear);

  assignments.forEach(a => {
    scheduleSheet.appendRow([
      a.massDateTime,
      a.label,
      a.lector1 || '',
      a.lector2 || '',
      a.readingsUrl || '',
      a.prepUrl || '',
      a.status,
    ]);
  });

  // ── 6. Email coordinator ─────────────────────────────────────────────────
  const needsAttention = assignments.filter(a => a.status === 'NEEDS ATTENTION').length;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${getConfig().spreadsheetId}/edit`;

  const subject = `Lector Schedule Ready for Review — ${monthName}`;
  const body = buildCoordinatorReviewEmail(monthName, assignments.length, needsAttention, spreadsheetUrl, config.parishName);

  GmailApp.sendEmail(config.coordinatorEmail, subject, '', { htmlBody: body });

  const msg = `Schedule generated for ${monthName}.\n${assignments.length} Masses assigned.\n${needsAttention} need attention.\nCoordinator notified at ${config.coordinatorEmail}.`;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { /* running from trigger, no UI */ }
}

/**
 * Greedy scheduling algorithm.
 * Rules:
 *   - Each Mass needs 2 lectors (Lector1, Lector2)
 *   - No lector may serve two Masses on the same calendar day
 *   - Distribute load as evenly as possible across the month
 *   - If < 2 available lectors for a Mass → status: NEEDS ATTENTION
 *
 * @param {Array} masses — sorted list of mass objects
 * @param {Object} availabilityMap — massDateTime → [lectorName, ...]
 * @returns {Array} assignments with lector1, lector2, status
 */
function scheduleAlgorithm(masses, availabilityMap) {
  // Track how many Masses each lector has been assigned
  const assignmentCount = {};
  // Track which dates each lector has been assigned (to prevent same-day double-booking)
  const assignedDates = {};

  const assignments = [];

  masses.forEach(mass => {
    const mdt       = mass.massDateTime;
    const massDate  = mdt.split(' ')[0]; // "YYYY-MM-DD"
    const available = [...(availabilityMap[mdt] || [])];

    // Filter out lectors already assigned that day
    const eligible = available.filter(name => {
      return !(assignedDates[name] && assignedDates[name].has(massDate));
    });

    // Sort eligible lectors by fewest assignments (load balancing)
    eligible.sort((a, b) => (assignmentCount[a] || 0) - (assignmentCount[b] || 0));

    const lector1 = eligible[0] || null;
    const lector2 = eligible[1] || null;

    // Update tracking
    [lector1, lector2].forEach(name => {
      if (!name) return;
      assignmentCount[name] = (assignmentCount[name] || 0) + 1;
      if (!assignedDates[name]) assignedDates[name] = new Set();
      assignedDates[name].add(massDate);
    });

    const assigned = [lector1, lector2].filter(Boolean).length;
    const status   = assigned < 2 ? 'NEEDS ATTENTION' : 'PENDING APPROVAL';

    assignments.push({ ...mass, lector1, lector2, status });
  });

  return assignments;
}

/**
 * Removes all rows from the Schedule tab that fall in the target month/year.
 * Column 1 (index 0) is MassDateTime in "YYYY-MM-DD HH:MM" format.
 */
function clearScheduleForMonth(scheduleSheet, month, year) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`;
  const data = scheduleSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).startsWith(prefix)) {
      scheduleSheet.deleteRow(i + 1);
    }
  }
}

/**
 * Builds coordinator review email HTML.
 */
function buildCoordinatorReviewEmail(monthName, totalMasses, needsAttention, sheetUrl, parishName) {
  const attentionNote = needsAttention > 0
    ? `<p style="color:#c0392b;"><strong>⚠ ${needsAttention} Mass(es) are flagged NEEDS ATTENTION</strong> — insufficient lector availability. Please assign manually.</p>`
    : `<p style="color:#27ae60;"><strong>✓ All Masses have been assigned.</strong></p>`;

  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
  <div style="background: #1a3a5c; color: white; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">Lector Schedule Ready</h2>
    <p style="margin: 4px 0 0; opacity: 0.85;">${parishName} — ${monthName}</p>
  </div>
  <div style="padding: 32px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
    <p>The lector schedule for <strong>${monthName}</strong> has been generated and is ready for your review.</p>

    <ul>
      <li><strong>${totalMasses} Masses</strong> scheduled</li>
      <li>Status: <strong>PENDING APPROVAL</strong></li>
    </ul>

    ${attentionNote}

    <p>Please review the Schedule tab, make any manual adjustments, then change Status to <strong>APPROVED</strong> for each row you accept.</p>
    <p>Once you are satisfied, click <strong>"Lector System → Publish Approved Schedule"</strong> from the spreadsheet menu to send lector notification emails.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${sheetUrl}"
         style="background: #1a3a5c; color: white; text-decoration: none;
                padding: 14px 32px; border-radius: 6px; font-size: 16px;
                display: inline-block;">
        Open Schedule in Google Sheets
      </a>
    </div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 5 — LECTOR NOTIFICATION EMAILS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends notification emails to all lectors with APPROVED assignments.
 * Each email includes:
 *   - Their assigned Mass dates/times/roles
 *   - Role reminder for Lector 1 and Lector 2
 *   - Full reading text scraped verbatim from USCCB.org
 *   - Prep notes scraped verbatim from lectorprep.org
 *
 * IMPORTANT: Reading text is ALWAYS scraped — never generated.
 * Run from the custom menu after coordinator approval.
 */
function publishSchedule() {
  const config = getConfig();
  const ss = getSpreadsheet();
  const scheduleSheet = ss.getSheetByName('Schedule');
  const lectorsSheet  = ss.getSheetByName('Lectors');

  const schedData = scheduleSheet.getDataRange().getValues();
  const sHeaders  = schedData[0];
  const sMdtCol     = sHeaders.indexOf('MassDateTime');
  const sLabelCol   = sHeaders.indexOf('Label');
  const sL1Col      = sHeaders.indexOf('Lector1');
  const sL2Col      = sHeaders.indexOf('Lector2');
  const sReadCol    = sHeaders.indexOf('ReadingsURL');
  const sPrepCol    = sHeaders.indexOf('PrepURL');
  const sStatusCol  = sHeaders.indexOf('Status');

  // Collect all APPROVED rows
  const approvedRows = schedData.slice(1).filter(row => row[sStatusCol] === 'APPROVED');
  if (approvedRows.length === 0) {
    SpreadsheetApp.getUi().alert('No rows with Status = APPROVED found in the Schedule tab.');
    return;
  }

  // Build per-lector assignment map
  const lectorAssignments = {}; // name → [{mdt, label, role, readingsUrl, prepUrl}]

  approvedRows.forEach(row => {
    const mdt       = row[sMdtCol];
    const label     = row[sLabelCol];
    const lector1   = row[sL1Col];
    const lector2   = row[sL2Col];
    const readingsUrl = row[sReadCol];
    const prepUrl     = row[sPrepCol];

    [[lector1, 'Lector 1'], [lector2, 'Lector 2']].forEach(([name, role]) => {
      if (!name) return;
      if (!lectorAssignments[name]) lectorAssignments[name] = [];
      lectorAssignments[name].push({ mdt, label, role, readingsUrl, prepUrl });
    });
  });

  // Get lector email map
  const emailMap = getLectorEmailMap(lectorsSheet);
  const githubBase = `https://${config.githubUsername}.github.io/lector-scheduler/web`;

  // Determine month/year from first assignment
  const firstMdt = approvedRows[0][sMdtCol] || '';
  const [monthYear] = (() => {
    const d = parseMassDate(firstMdt);
    return [d ? d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : ''];
  })();

  let emailsSent = 0;
  const errors   = [];

  Object.entries(lectorAssignments).forEach(([name, assignments]) => {
    const email = emailMap[name];
    if (!email) {
      errors.push(`No email found for lector: ${name}`);
      return;
    }

    // Scrape reading text for each assignment (verbatim — no generation)
    const enriched = assignments.map(a => {
      Logger.log(`Scraping readings for ${name} — ${a.mdt}...`);
      const dateObj = parseMassDate(a.mdt);
      const readingText = dateObj ? scrapeReadingText(dateObj) : '';
      const prepText    = dateObj ? scrapeLectorPrepText(dateObj) : '';
      return { ...a, readingText, prepText };
    });

    // Build swap token (reuse availability token if exists, else generate)
    const swapToken = getOrCreateSwapToken(ss, email, firstMdt);
    const swapUrl   = `${githubBase}/swap.html?token=${swapToken}`;

    const subject = `Your Lector Assignment — ${monthYear}`;
    const body    = buildLectorNotificationEmail(name, monthYear, enriched, swapUrl, config.parishName);

    try {
      GmailApp.sendEmail(email, subject, '', {
        htmlBody: body,
        name: config.parishName + ' Lector Schedule',
      });
      emailsSent++;
      Logger.log(`Sent assignment email to ${name} (${email})`);
    } catch (err) {
      errors.push(`${name} <${email}>: ${err.message}`);
    }

    Utilities.sleep(300); // avoid Gmail rate limits
  });

  const msg = `Sent ${emailsSent} lector notification emails.`;
  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert(msg + '\n\nErrors:\n' + errors.join('\n'));
  } else {
    SpreadsheetApp.getUi().alert(msg);
  }
}

/**
 * Returns a map of lector name → email from the Lectors tab.
 */
function getLectorEmailMap(lectorsSheet) {
  const data     = lectorsSheet.getDataRange().getValues();
  const nameCol  = data[0].indexOf('Name');
  const emailCol = data[0].indexOf('Email');
  const map = {};
  data.slice(1).forEach(row => {
    if (row[nameCol]) map[row[nameCol]] = row[emailCol];
  });
  return map;
}

/**
 * Returns an existing token for this lector, or creates and stores a new swap token.
 * Swap tokens are stored in the Tokens tab with month=0 to distinguish them.
 */
function getOrCreateSwapToken(ss, email, referenceMdt) {
  const tokensSheet = ss.getSheetByName('Tokens');
  const data = tokensSheet.getDataRange().getValues();
  // Look for a SWAP token (month=0) for this email
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === email && data[i][2] === 0) return data[i][0];
  }
  // Create new swap token
  const token = generateToken();
  tokensSheet.appendRow([token, email, 0, 0, false]); // month=0 = swap token
  return token;
}

/**
 * Builds the HTML lector notification email.
 * Includes role descriptions, all assignments, scraped reading text, and swap link.
 */
function buildLectorNotificationEmail(name, monthYear, assignments, swapUrl, parishName) {
  const roleDescriptions = `
    <div style="background: #f8f4ee; border-left: 4px solid #1a3a5c; padding: 16px; margin: 20px 0; border-radius: 0 6px 6px 0;">
      <p style="margin: 0 0 8px; font-weight: bold;">Role Reminders</p>
      <p style="margin: 0 0 6px;"><strong>Lector 1:</strong> First Reading + Announcements before Mass</p>
      <p style="margin: 0;"><strong>Lector 2:</strong> Second Reading + Prayers of the Faithful<br>
        <em style="font-size: 13px;">(Prayers of the Faithful are led by Deacon Kevin or Deacon Matt when present — confirm with the celebrant)</em>
      </p>
    </div>`;

  const massBlocks = assignments.map(a => {
    const dateDisplay = formatMassDateTime(a.mdt);
    const triduumBadge = a.label && a.label.toLowerCase().includes('triduum')
      ? `<span style="background:#8b0000;color:white;padding:2px 8px;border-radius:12px;font-size:12px;margin-left:8px;">Triduum</span>`
      : '';

    const readingsSection = a.readingText
      ? `<div style="margin-top:16px;">
           <p style="font-weight:bold;margin:0 0 8px;color:#1a3a5c;">Your Readings (from USCCB.org)</p>
           <div style="background:#fff;border:1px solid #ddd;padding:16px;border-radius:6px;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(a.readingText)}</div>
         </div>`
      : (a.readingsUrl
          ? `<p style="margin-top:12px;"><a href="${a.readingsUrl}" style="color:#1a3a5c;">View readings on USCCB.org →</a></p>`
          : '');

    const prepSection = a.prepText
      ? `<div style="margin-top:16px;">
           <p style="font-weight:bold;margin:0 0 8px;color:#1a3a5c;">Preparation Notes (from lectorprep.org)</p>
           <div style="background:#fffdf7;border:1px solid #e8d97a;padding:16px;border-radius:6px;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(a.prepText)}</div>
         </div>`
      : (a.prepUrl
          ? `<p style="margin-top:8px;"><a href="${a.prepUrl}" style="color:#1a3a5c;">View prep notes on lectorprep.org →</a></p>`
          : '');

    return `
      <div style="border:1px solid #ddd;border-radius:8px;padding:20px;margin-bottom:20px;">
        <h3 style="margin:0 0 4px;color:#1a3a5c;">${dateDisplay}${triduumBadge}</h3>
        <p style="margin:0 0 4px;font-size:14px;color:#555;">${a.label || ''}</p>
        <p style="margin:0;"><strong>Your role:</strong> ${a.role}</p>
        ${readingsSection}
        ${prepSection}
      </div>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: #222; line-height: 1.6;">
  <div style="background: #1a3a5c; color: white; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">Your Lector Assignment</h2>
    <p style="margin: 4px 0 0; opacity: 0.85;">${parishName} — ${monthYear}</p>
  </div>
  <div style="padding: 32px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Dear ${name},</p>
    <p>Thank you for your service as a lector. Below are your assignments for <strong>${monthYear}</strong>.</p>

    ${roleDescriptions}

    <h3 style="color:#1a3a5c;border-bottom:2px solid #eee;padding-bottom:8px;">Your Assignments</h3>
    ${massBlocks}

    <div style="background:#f0f4f8;border-radius:8px;padding:20px;margin-top:24px;text-align:center;">
      <p style="margin:0 0 12px;"><strong>Need to swap a Mass?</strong></p>
      <a href="${swapUrl}"
         style="background:#c0392b;color:white;text-decoration:none;
                padding:12px 28px;border-radius:6px;font-size:15px;display:inline-block;">
        Request a Swap
      </a>
    </div>

    <p style="margin-top:24px;font-size:13px;color:#777;">
      You will receive a reminder email one week before each Mass.<br>
      Questions? Contact the coordinator directly.
    </p>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 6 — SWAP REQUEST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET endpoint: returns the lector's assigned Masses for the swap form.
 *
 * @param {string} token — lector's swap token
 * @param {string} mass  — optional, pre-selected massDateTime
 * @returns {object} { lectorName, assignments: [...] }
 */
function getSwapData(token, mass) {
  if (!token) return { error: 'Missing token.' };

  const ss = getSpreadsheet();
  const tokensSheet   = ss.getSheetByName('Tokens');
  const scheduleSheet = ss.getSheetByName('Schedule');

  const tokenRow = findToken(tokensSheet, token);
  if (!tokenRow) return { error: 'Invalid token.' };

  const lectorEmail = tokenRow[1];
  const lectorName  = getLectorName(ss, lectorEmail);

  // Find this lector's assignments in the Schedule tab
  const schedData = scheduleSheet.getDataRange().getValues();
  const sHeaders  = schedData[0];
  const sMdtCol   = sHeaders.indexOf('MassDateTime');
  const sLabelCol = sHeaders.indexOf('Label');
  const sL1Col    = sHeaders.indexOf('Lector1');
  const sL2Col    = sHeaders.indexOf('Lector2');
  const sStatusCol = sHeaders.indexOf('Status');

  const assignments = [];
  schedData.slice(1).forEach(row => {
    if (row[sStatusCol] !== 'APPROVED') return;
    const role = row[sL1Col] === lectorName ? 'Lector 1'
               : row[sL2Col] === lectorName ? 'Lector 2'
               : null;
    if (!role) return;
    assignments.push({
      massDateTime: row[sMdtCol],
      label: row[sLabelCol],
      role,
      selected: mass === row[sMdtCol],
    });
  });

  return { lectorName, lectorEmail, assignments };
}

/**
 * POST endpoint: handles a swap request.
 * Emails all lectors asking who can cover the Mass.
 *
 * @param {object} params — { token, massDateTime }
 * @returns {object} { success: true }
 */
function requestSwap(params) {
  const { token, massDateTime } = params;
  if (!token || !massDateTime) return { error: 'Missing required fields.' };

  const config = getConfig();
  const ss = getSpreadsheet();
  const tokensSheet   = ss.getSheetByName('Tokens');
  const lectorsSheet  = ss.getSheetByName('Lectors');
  const scheduleSheet = ss.getSheetByName('Schedule');

  const tokenRow = findToken(tokensSheet, token);
  if (!tokenRow) return { error: 'Invalid token.' };

  const lectorEmail = tokenRow[1];
  const lectorName  = getLectorName(ss, lectorEmail);

  // Get the Mass label from schedule
  const schedData = scheduleSheet.getDataRange().getValues();
  const sHeaders  = schedData[0];
  let massLabel   = '';
  schedData.slice(1).forEach(row => {
    if (row[sHeaders.indexOf('MassDateTime')] === massDateTime) {
      massLabel = row[sHeaders.indexOf('Label')] || '';
    }
  });

  const dateDisplay = formatMassDateTime(massDateTime);
  const subject     = `Lector Coverage Needed — ${dateDisplay}`;

  // Email ALL active lectors (except the requester)
  const lectorData  = lectorsSheet.getDataRange().getValues();
  const lHeaders    = lectorData[0];
  const lNameCol    = lHeaders.indexOf('Name');
  const lEmailCol   = lHeaders.indexOf('Email');
  const lActiveCol  = lHeaders.indexOf('Active');

  let emailsSent = 0;
  lectorData.slice(1).forEach(row => {
    const active = row[lActiveCol] === true || row[lActiveCol] === 'TRUE' || row[lActiveCol] === 'Yes';
    if (!active) return;
    if (row[lEmailCol] === lectorEmail) return; // skip the requester

    const body = buildSwapRequestEmail(lectorName, dateDisplay, massLabel, config.parishName, config.coordinatorEmail);
    try {
      GmailApp.sendEmail(row[lEmailCol], subject, '', {
        htmlBody: body,
        name: config.parishName + ' Lector Schedule',
        replyTo: config.coordinatorEmail,
      });
      emailsSent++;
    } catch (err) {
      Logger.log(`Swap email failed for ${row[lEmailCol]}: ${err.message}`);
    }
  });

  // Notify coordinator too
  GmailApp.sendEmail(
    config.coordinatorEmail,
    `[SWAP REQUEST] ${lectorName} needs coverage for ${dateDisplay}`,
    `${lectorName} has requested a swap for: ${dateDisplay} ${massLabel}.\n\nEmailed ${emailsSent} lectors.`
  );

  Logger.log(`Swap request from ${lectorName} for ${massDateTime}. Emailed ${emailsSent} lectors.`);

  return {
    success: true,
    message: `Your swap request has been sent to all lectors. The first person to reply will be confirmed.`,
    lectorName,
    massDateTime,
  };
}

/**
 * Builds the swap request email sent to all other lectors.
 */
function buildSwapRequestEmail(requesterName, dateDisplay, massLabel, parishName, coordinatorEmail) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
  <div style="background: #c0392b; color: white; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">Lector Coverage Needed</h2>
    <p style="margin: 4px 0 0; opacity: 0.9;">${parishName}</p>
  </div>
  <div style="padding: 32px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
    <p><strong>${requesterName}</strong> needs a substitute lector for:</p>

    <div style="background:#f8f4ee;border-left:4px solid #c0392b;padding:16px;margin:20px 0;border-radius:0 6px 6px 0;">
      <p style="margin:0;font-size:18px;"><strong>${dateDisplay}</strong></p>
      ${massLabel ? `<p style="margin:8px 0 0;color:#555;">${massLabel}</p>` : ''}
    </div>

    <p>If you are able to cover this Mass, please <strong>reply to this email</strong> to let the coordinator know. The first person to respond will be confirmed.</p>

    <p>Thank you for your service!</p>

    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#888;">
      Reply to this email to claim the assignment. The coordinator will confirm and update the schedule.
    </p>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER EMAILS — sent 1 week before Mass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends reminder emails to lectors for Masses occurring within the next 7 days.
 * Triggered weekly; safe to run manually.
 */
function sendReminderEmails() {
  const config = getConfig();
  const ss = getSpreadsheet();
  const scheduleSheet = ss.getSheetByName('Schedule');
  const lectorsSheet  = ss.getSheetByName('Lectors');

  const schedData = scheduleSheet.getDataRange().getValues();
  const sHeaders  = schedData[0];
  const sMdtCol   = sHeaders.indexOf('MassDateTime');
  const sLabelCol = sHeaders.indexOf('Label');
  const sL1Col    = sHeaders.indexOf('Lector1');
  const sL2Col    = sHeaders.indexOf('Lector2');
  const sStatusCol = sHeaders.indexOf('Status');

  const now    = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const emailMap = getLectorEmailMap(lectorsSheet);
  let emailsSent = 0;

  schedData.slice(1).forEach(row => {
    if (row[sStatusCol] !== 'APPROVED') return;

    const massDate = parseMassDate(row[sMdtCol]);
    if (!massDate) return;

    // Only send if Mass is within 7 days
    if (massDate < now || massDate > in7Days) return;

    const dateDisplay = formatMassDateTime(row[sMdtCol]);

    [[row[sL1Col], 'Lector 1'], [row[sL2Col], 'Lector 2']].forEach(([name, role]) => {
      if (!name || !emailMap[name]) return;

      const subject = `Reminder: You're a lector this week — ${dateDisplay}`;
      const body    = buildReminderEmail(name, dateDisplay, row[sLabelCol], role, config.parishName);

      try {
        GmailApp.sendEmail(emailMap[name], subject, '', { htmlBody: body });
        emailsSent++;
      } catch (err) {
        Logger.log(`Reminder email failed for ${name}: ${err.message}`);
      }
    });
  });

  Logger.log(`Sent ${emailsSent} reminder emails.`);
  try { SpreadsheetApp.getUi().alert(`Sent ${emailsSent} reminder email(s).`); } catch(e) {}
}

/**
 * Builds the reminder email HTML.
 */
function buildReminderEmail(name, dateDisplay, massLabel, role, parishName) {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6;">
  <div style="background: #1a3a5c; color: white; padding: 24px 32px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">Lector Reminder</h2>
    <p style="margin: 4px 0 0; opacity: 0.85;">${parishName}</p>
  </div>
  <div style="padding: 32px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Dear ${name},</p>
    <p>This is a friendly reminder that you are scheduled to serve as a lector this week.</p>

    <div style="background:#f8f4ee;border-left:4px solid #1a3a5c;padding:16px;margin:20px 0;border-radius:0 6px 6px 0;">
      <p style="margin:0;font-size:18px;"><strong>${dateDisplay}</strong></p>
      ${massLabel ? `<p style="margin:8px 0 0;color:#555;">${massLabel}</p>` : ''}
      <p style="margin:8px 0 0;"><strong>Your role:</strong> ${role}</p>
    </div>

    <p>Please review your readings and arrive at least 15 minutes before Mass. Thank you!</p>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPERS — USCCB.org and lectorprep.org
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the USCCB daily readings URL for a given date.
 * URL format: https://bible.usccb.org/bible/readings/MMDDYY.cfm
 *
 * @param {Date} date
 * @returns {string} URL or empty string if construction fails
 */
function scrapeUSCCBUrl(date) {
  if (!date) return '';
  try {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);
    return `https://bible.usccb.org/bible/readings/${mm}${dd}${yy}.cfm`;
  } catch (err) {
    Logger.log('scrapeUSCCBUrl error: ' + err.message);
    return '';
  }
}

/**
 * Scrapes the full reading text verbatim from USCCB.org for a given date.
 *
 * IMPORTANT: This function returns scraped text only. It NEVER generates
 * or paraphrases content.
 *
 * @param {Date} date
 * @returns {string} Raw reading text, or empty string if unavailable
 */
function scrapeReadingText(date) {
  const url = scrapeUSCCBUrl(date);
  if (!url) return '';

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log(`USCCB fetch failed for ${url}: HTTP ${response.getResponseCode()}`);
      return '';
    }

    const html = response.getContentText();

    // Extract text from the main reading content area.
    // USCCB uses <div class="content-body"> for reading content.
    const contentMatch = html.match(/<div[^>]+class="[^"]*content-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (contentMatch) {
      return stripHtmlTags(contentMatch[1]).trim();
    }

    // Fallback: look for <article> content
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      return stripHtmlTags(articleMatch[1]).trim();
    }

    Logger.log(`USCCB: Could not find reading content at ${url}`);
    return '';
  } catch (err) {
    Logger.log('scrapeReadingText error: ' + err.message);
    return '';
  }
}

/**
 * Returns the lectorprep.org URL for a given date.
 * Attempts to find the correct page by fetching the site's recent posts or sitemap.
 *
 * @param {Date} date
 * @returns {string} URL or empty string if not found
 */
function scrapeLectorPrepUrl(date) {
  if (!date) return '';

  try {
    // lectorprep.org structures URLs by liturgical Sunday/feast name.
    // We look in their archives for the closest date.
    const year  = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const archiveUrl = `https://www.lectorprep.org/${year}/${month}/`;

    const response = UrlFetchApp.fetch(archiveUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return '';

    const html = response.getContentText();

    // Find post links that are closest to the target date.
    // lectorprep posts typically have dates in the URL slug or meta.
    const linkMatches = [...html.matchAll(/<a[^>]+href="(https:\/\/www\.lectorprep\.org\/[^"]+)"[^>]*>/g)];
    const postLinks   = [...new Set(linkMatches.map(m => m[1]))].filter(l => !l.includes('#'));

    if (postLinks.length === 0) return '';

    // Return the first article link (most recently published in that month)
    return postLinks[0];
  } catch (err) {
    Logger.log('scrapeLectorPrepUrl error: ' + err.message);
    return '';
  }
}

/**
 * Scrapes prep notes verbatim from lectorprep.org for a given date.
 *
 * IMPORTANT: This function returns scraped text only. It NEVER generates
 * or paraphrases content.
 *
 * @param {Date} date
 * @returns {string} Prep text, or empty string if unavailable
 */
function scrapeLectorPrepText(date) {
  const url = scrapeLectorPrepUrl(date);
  if (!url) return '';

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return '';

    const html = response.getContentText();

    // lectorprep.org uses standard WordPress post content
    const contentMatch = html.match(/<div[^>]+class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (contentMatch) {
      return stripHtmlTags(contentMatch[1]).trim().slice(0, 4000); // cap for email size
    }

    const postMatch = html.match(/<div[^>]+class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (postMatch) {
      return stripHtmlTags(postMatch[1]).trim().slice(0, 4000);
    }

    return '';
  } catch (err) {
    Logger.log('scrapeLectorPrepText error: ' + err.message);
    return '';
  }
}

/**
 * Strips HTML tags from a string and decodes common HTML entities.
 */
function stripHtmlTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Escapes HTML special characters for safe insertion into email HTML.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a "YYYY-MM-DD HH:MM" string into a Date object.
 * Returns null if parsing fails.
 */
function parseMassDate(massDateTime) {
  if (!massDateTime) return null;
  try {
    const [datePart, timePart] = String(massDateTime).split(' ');
    const [year, month, day]  = datePart.split('-').map(Number);
    const [hour, minute]      = (timePart || '00:00').split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
  } catch (_) {
    return null;
  }
}

/**
 * Formats a "YYYY-MM-DD HH:MM" massDateTime string for human-readable display.
 * Example: "Sunday, April 20, 2025 at 9:00 AM"
 */
function formatMassDateTime(massDateTime) {
  const date = parseMassDate(massDateTime);
  if (!date) return massDateTime;

  const dayName   = date.toLocaleString('en-US', { weekday: 'long' });
  const datePart  = date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const hours     = date.getHours();
  const minutes   = String(date.getMinutes()).padStart(2, '0');
  const ampm      = hours >= 12 ? 'PM' : 'AM';
  const hour12    = hours % 12 || 12;
  return `${dayName}, ${datePart} at ${hour12}:${minutes} ${ampm}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGERS SETUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates time-based triggers for the monthly automation flow.
 * Safe to run multiple times — deletes existing system triggers first.
 *
 * Triggers created:
 *   - 16th of each month at 8:00 AM: sendAvailabilityRequests
 *   - 23rd of each month at 8:00 AM: generateSchedule
 *   - Weekly on Monday at 8:00 AM:   sendReminderEmails
 */
function createTriggers() {
  // Remove any existing triggers for these functions to avoid duplicates
  const functionNames = ['sendAvailabilityRequests', 'generateSchedule', 'sendReminderEmails'];
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (functionNames.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Availability requests: 16th of each month
  ScriptApp.newTrigger('sendAvailabilityRequests')
    .timeBased()
    .onMonthDay(16)
    .atHour(8)
    .create();

  // Schedule generation: 23rd of each month
  ScriptApp.newTrigger('generateSchedule')
    .timeBased()
    .onMonthDay(23)
    .atHour(8)
    .create();

  // Weekly reminders: every Monday
  ScriptApp.newTrigger('sendReminderEmails')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  try {
    SpreadsheetApp.getUi().alert('Triggers created successfully:\n• 16th of month — Availability requests\n• 23rd of month — Schedule generation\n• Every Monday — Reminder emails');
  } catch(e) {}
  Logger.log('Triggers created.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates all required sheet tabs with correct headers if they don't already exist.
 * Safe to run on an existing spreadsheet — skips tabs that are already present.
 */
function initializeSheetTabs() {
  const ss = getSpreadsheet();
  const tabDefs = [
    { name: 'Lectors',      headers: ['Name', 'Email', 'Active'] },
    { name: 'MassTimes',    headers: ['DayOfWeek', 'Time', 'Label', 'IsTriduum'] },
    { name: 'Availability', headers: ['Token', 'LectorName', 'MassDateTime', 'Available', 'SubmittedAt'] },
    { name: 'Schedule',     headers: ['MassDateTime', 'Label', 'Lector1', 'Lector2', 'ReadingsURL', 'PrepURL', 'Status'] },
    { name: 'Tokens',       headers: ['Token', 'LectorEmail', 'Month', 'Year', 'Used'] },
  ];

  tabDefs.forEach(def => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      Logger.log(`Created tab: ${def.name}`);
    } else {
      Logger.log(`Tab already exists: ${def.name}`);
    }
  });

  try { SpreadsheetApp.getUi().alert('Sheet tabs initialized. All 5 tabs are ready.'); } catch(e) {}
}
