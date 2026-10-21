import { organizationDbName } from "../config/organization";
export default function initializeFormalReporting(root) {
if (!root) return () => {};

const state = {
  sections: [],
  section: null,
  month: '',
  week: null,
  weekRange: '',
  compiledName: '',
  compiledDesignation: '',
  systems: [],
  responses: {},
  index: 0,
  workflowStep: 1,
  draftId: '',
  finalConfirmed: false
};

const FORMAL_DRAFT_STORE = 'formalReportDrafts';
const FORMAL_DRAFT_SYNC_VERSION = 1;
let draftDb = null;
let stopped = false;
const draftSyncInFlight = new Set();

function openDraftDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(organizationDbName('maintenix_formal_reports'), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FORMAL_DRAFT_STORE)) {
        db.createObjectStore(FORMAL_DRAFT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(value) {
  if (!draftDb) return Promise.reject(new Error('Browser draft storage is not available.'));
  return new Promise((resolve, reject) => {
    const tx = draftDb.transaction(FORMAL_DRAFT_STORE, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(FORMAL_DRAFT_STORE).put(value);
  });
}

function idbGet(id) {
  if (!draftDb) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx = draftDb.transaction(FORMAL_DRAFT_STORE, 'readonly');
    const request = tx.objectStore(FORMAL_DRAFT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function idbGetAll() {
  if (!draftDb) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = draftDb.transaction(FORMAL_DRAFT_STORE, 'readonly');
    const request = tx.objectStore(FORMAL_DRAFT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(id) {
  if (!draftDb) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const tx = draftDb.transaction(FORMAL_DRAFT_STORE, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(FORMAL_DRAFT_STORE).delete(id);
  });
}

function defaultDraftName(value) {
  const parts = [];
  const section = String(value?.section || '').trim();
  const month = String(value?.month || '').trim();
  const week = Number(value?.week || 0);
  if (section) parts.push(section);
  if (month) parts.push(month);
  if (week >= 1 && week <= 53) parts.push(`Week ${week}`);
  return parts.length ? parts.join(' · ') : 'Section Report Draft';
}

function normalizeWorkflowStep(value, fallback = 1) {
  const step = Number(value);
  return [1, 2, 3].includes(step) ? step : fallback;
}

function localDraftSummary(record) {
  const value = record?.value || {};
  return {
    id: record.id,
    name: record.name || defaultDraftName(value),
    section: value.section,
    month: value.month,
    week: value.week,
    workflowStep: normalizeWorkflowStep(value.workflowStep, value.section ? 2 : 1),
    compiledName: value.compiledName,
    savedAt: record.savedAt || '',
    syncStatus: record.syncStatus || 'pending',
    syncError: record.syncError || ''
  };
}

const doc = root.ownerDocument || root.host?.ownerDocument || document;
const $ = (id) => root.querySelector(`#${CSS.escape(id)}`);

async function api(url, options = {}) {
  const response = await fetch(`/api/formal-reports${url}`, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || body.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function showNotice(message, type = 'success') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = `notice ${type}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => { notice.className = 'notice hidden'; }, 4500);
}

function isoWeekRange(year, week) {
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const day = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { monday, sunday };
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function overlapMonth(range, month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return range.sunday >= first && range.monday <= last;
}

function populateWeeks() {
  const select = $('week');
  select.innerHTML = '<option value="">Select week</option>';
  for (let week = 1; week <= 53; week += 1) {
    const option = doc.createElement('option');
    option.value = String(week);
    option.textContent = `Week ${week}`;
    select.append(option);
  }
}

function updateWeekRange() {
  const month = $('month').value;
  const week = Number($('week').value);
  if (!month || !week) return $('week-range').textContent = 'Monday–Sunday date range will appear here.';
  const year = Number(month.slice(0, 4));
  const range = isoWeekRange(year, week);
  const overlaps = overlapMonth(range, month);
  $('week-range').textContent = `${dateLabel(range.monday)} – ${dateLabel(range.sunday)}${overlaps ? '' : ' — does not overlap selected month'}`;
  $('week-range').classList.toggle('warning-text', !overlaps);
}

function syncSetupState() {
  const selectedSection = state.sections.find((item) => item.name === $('section').value) || null;
  const previousSectionName = String(state.section?.name || '');
  const nextSectionName = String(selectedSection?.name || '');
  const month = String($('month').value || '').trim();
  const weekValue = Number($('week').value || 0);
  const week = Number.isInteger(weekValue) && weekValue >= 1 && weekValue <= 53 ? weekValue : null;

  state.section = selectedSection;
  state.month = month;
  state.week = week;
  state.compiledName = $('compiled-name').value.trim();
  state.compiledDesignation = $('compiled-designation').value.trim();

  if (month && week) {
    const range = isoWeekRange(Number(month.slice(0, 4)), week);
    state.weekRange = `${dateLabel(range.monday)} – ${dateLabel(range.sunday)}`;
  } else {
    state.weekRange = '';
  }

  if (previousSectionName !== nextSectionName) {
    state.responses = {};
    state.systems = selectedSection?.systems || [];
    state.finalConfirmed = false;
  } else if (selectedSection && state.systems.length === 0) {
    state.systems = selectedSection.systems || [];
  }

  return {
    section: selectedSection,
    month,
    week,
    compiledName: state.compiledName,
    compiledDesignation: state.compiledDesignation
  };
}

function ensureDraftId() {
  if (state.draftId) return state.draftId;

  const sectionName = String(state.section?.name || '').trim();
  if (sectionName && state.month && state.week) {
    const slug = sectionName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    state.draftId = `${slug}-${state.month}-week-${state.week}`;
    return state.draftId;
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  state.draftId = `section-report-draft-${Date.now()}-${suffix}`;
  return state.draftId;
}

function setStep(step) {
  const nextStep = normalizeWorkflowStep(step, 1);
  state.workflowStep = nextStep;
  root.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  $(`step-${nextStep}`).classList.remove('hidden');
  const progress = Math.round((nextStep / 3) * 100);
  const progressBar = $('workflow-progress-bar');
  progressBar.style.width = `${progress}%`;
  progressBar.textContent = `${progress}%`;
  progressBar.parentElement.setAttribute('aria-valuenow', String(progress));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function currentResponse(systemId) {
  return state.responses[systemId] || { systemId, defectsFound: null, defects: [] };
}

function createSystemCard(system, index) {
  const response = currentResponse(system.id);
  const references = [system.f != null ? `F/FJ: ${system.f}` : null, system.g != null ? `G: ${system.g}` : null, system.group ? `Group: ${system.group}` : null].filter(Boolean);
  const card = doc.createElement('article');
  card.id = `system-${system.id}`;
  card.className = `card border-light shadow-sm system-card ${responseComplete(response) ? 'complete' : ''}`;
  card.innerHTML = `
    <div class="system-position">System ${index + 1} of ${state.systems.length}</div>
    <h3>${escapeHtml(system.name)}</h3>
    <p class="system-reference">Nr ${escapeHtml(system.id)}${references.length ? ` · ${references.map(escapeHtml).join(' · ')}` : ''}</p>
    <fieldset>
      <legend>Were any defects found on this system?</legend>
      <div class="choice-row">
        <label class="choice no-choice"><input type="radio" name="defects-${system.id}" value="no" ${response.defectsFound === 'no' ? 'checked' : ''}><span>No</span></label>
        <label class="choice yes-choice"><input type="radio" name="defects-${system.id}" value="yes" ${response.defectsFound === 'yes' ? 'checked' : ''}><span>Yes</span></label>
      </div>
    </fieldset>
    <div class="defect-fields ${response.defectsFound === 'yes' ? '' : 'hidden'}"></div>`;
  const fields = card.querySelector('.defect-fields');
  renderDefects(fields, response, system, index);
  card.querySelectorAll(`input[name="defects-${system.id}"]`).forEach((radio) => radio.addEventListener('change', (event) => {
    const active = currentResponse(system.id);
    active.defectsFound = event.target.value;
    if (active.defectsFound === 'yes' && active.defects.length === 0) active.defects = [{ finding: '', action: '' }];
    if (active.defectsFound === 'no') active.defects = [];
    state.responses[system.id] = active;
    const replacement = createSystemCard(system, index);
    card.replaceWith(replacement);
    updateProgress();
    if (active.defectsFound === 'no') {
      window.setTimeout(() => {
        const next = state.systems[index + 1];
        const nextCard = next ? root.querySelector(`#${CSS.escape(`system-${next.id}`)}`) : null;
        if (nextCard) nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 220);
    } else {
      window.setTimeout(() => replacement.querySelector('textarea')?.focus(), 0);
    }
  }));
  return card;
}

function renderSystems() {
  $('systems-list').replaceChildren(...state.systems.map((system, index) => createSystemCard(system, index)));
  updateProgress();
}

function renderDefects(container, response, system, systemIndex) {
  if (!container || response.defectsFound !== 'yes') return;
  container.innerHTML = '<div class="defect-title"><h4>Defects and required actions</h4></div>';
  response.defects.forEach((defect, index) => {
    const block = doc.createElement('div');
    block.className = 'defect-block';
    block.innerHTML = `<div class="defect-number">Defect ${index + 1}</div><label class="field"><span>Defect / Finding <em>Required</em></span><textarea rows="3" data-field="finding" data-index="${index}" placeholder="Describe the defect found" required>${escapeHtml(defect.finding)}</textarea></label><label class="field"><span>Required Action <em>Required</em></span><textarea rows="3" data-field="action" data-index="${index}" placeholder="Describe the required corrective action" required>${escapeHtml(defect.action)}</textarea></label>${response.defects.length > 1 ? `<button class="text-button danger" type="button" data-remove="${index}">Remove defect</button>` : ''}`;
    container.append(block);
  });
  const add = doc.createElement('button');
  add.type = 'button'; add.className = 'btn btn-outline-secondary add-defect'; add.textContent = 'Add another defect';
  add.addEventListener('click', () => {
    response.defects.push({ finding: '', action: '' });
    const card = createSystemCard(system, systemIndex);
    root.querySelector(`#${CSS.escape(`system-${system.id}`)}`).replaceWith(card);
    const inputs = card.querySelectorAll('textarea');
    if (inputs[inputs.length - 2]) inputs[inputs.length - 2].focus();
  });
  container.append(add);
  container.querySelectorAll('textarea').forEach((input) => input.addEventListener('input', () => { response.defects[Number(input.dataset.index)][input.dataset.field] = input.value; }));
  container.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
    response.defects.splice(Number(button.dataset.remove), 1);
    const card = createSystemCard(system, systemIndex);
    root.querySelector(`#${CSS.escape(`system-${system.id}`)}`).replaceWith(card);
    updateProgress();
  }));
}

function responseComplete(response) {
  if (response.defectsFound === 'no') return true;
  if (response.defectsFound !== 'yes' || response.defects.length === 0) return false;
  return response.defects.every((defect) => defect.finding.trim() && defect.action.trim());
}

function syncAllInputs() {
  state.systems.forEach((system) => {
    const response = currentResponse(system.id);
    root.querySelectorAll(`#system-${CSS.escape(system.id)} textarea`).forEach((input) => { response.defects[Number(input.dataset.index)][input.dataset.field] = input.value; });
    state.responses[system.id] = response;
  });
}

function updateProgress() {
  const completed = state.systems.filter((system) => responseComplete(currentResponse(system.id))).length;
  $('progress-count').textContent = `${completed} of ${state.systems.length} completed`;
  $('progress-bar').style.width = `${state.systems.length ? completed / state.systems.length * 100 : 0}%`;
}

function renderReview({ preserveConfirmation = false } = {}) {
  syncAllInputs();
  const responses = state.systems.map((system) => ({ system, response: currentResponse(system.id) }));
  const yes = responses.filter(({ response }) => response.defectsFound === 'yes').length;
  const no = responses.filter(({ response }) => response.defectsFound === 'no').length;
  const pending = responses.filter(({ response }) => !responseComplete(response)).length;
  $('yes-count').textContent = String(yes); $('no-count').textContent = String(no); $('pending-count').textContent = String(pending);
  $('review-period').textContent = `${state.section.name} · ${monthLabel(state.month)} · Week ${state.week} (${state.weekRange})`;
  state.finalConfirmed = preserveConfirmation ? Boolean(state.finalConfirmed) : false;
  $('final-confirmation').checked = state.finalConfirmed;
  $('generate-report').disabled = !state.finalConfirmed;
  $('review-list').replaceChildren(...responses.map(({ system, response }, index) => {
    const row = doc.createElement('article');
    const complete = responseComplete(response);
    row.className = `review-item ${complete ? '' : 'pending'}`;
    const status = response.defectsFound === 'yes' ? 'Defects found' : response.defectsFound === 'no' ? 'No defects' : 'Unanswered';
    const details = response.defectsFound === 'yes' ? response.defects.map((defect, defectIndex) => `<div class="review-defect"><strong>${defectIndex + 1}. ${escapeHtml(defect.finding || 'Finding required')}</strong><span>${escapeHtml(defect.action || 'Required action needed')}</span></div>`).join('') : '';
    row.innerHTML = `<div class="review-main"><div><span class="item-number">${index + 1}</span><strong>${escapeHtml(system.name)}</strong></div><span class="status-pill status-${response.defectsFound || 'pending'}">${status}</span></div>${details}<button type="button" class="text-button" data-edit="${index}">Edit</button>`;
    return row;
  }));
  $('review-list').querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => {
    const system = state.systems[Number(button.dataset.edit)];
    renderSystems(); setStep(2);
    window.setTimeout(() => root.querySelector(`#${CSS.escape(`system-${system.id}`)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }));
  setStep(3);
}

function draftPayload() {
  if (state.workflowStep === 1) syncSetupState();
  else syncAllInputs();

  state.finalConfirmed = state.workflowStep === 3 && Boolean($('final-confirmation')?.checked);

  return {
    id: ensureDraftId(),
    workflowStep: state.workflowStep,
    section: String(state.section?.name || ''),
    month: state.month,
    week: state.week,
    weekRange: state.weekRange,
    compiledName: state.compiledName,
    compiledDesignation: state.compiledDesignation,
    finalConfirmed: state.finalConfirmed,
    responses: state.systems.map((system) => currentResponse(system.id))
  };
}

async function saveDraftToServer(record) {
  // Ordinary content sync does not resend the local display name. The server
  // preserves an existing custom name, and explicit local renames are applied
  // with PATCH below. This also keeps legacy overlong names out of POST
  // validation while preserving the local draft for review.
  return api('/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record.value || {})
  });
}

async function syncDraftRecord(record) {
  if (!draftDb || !record?.id || !record?.value || record.deleted) return record || null;
  if (!navigator.onLine || draftSyncInFlight.has(record.id)) return record;

  draftSyncInFlight.add(record.id);
  const syncing = {
    ...record,
    syncStatus: 'syncing',
    syncError: '',
    lastSyncAttemptAt: new Date().toISOString()
  };

  try {
    await idbPut(syncing);
    let result = await saveDraftToServer(syncing);
    if (syncing.nameDirty) {
      result = await api(`/drafts/${encodeURIComponent(syncing.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: syncing.name })
      });
    }
    const latest = await idbGet(record.id);
    if (!latest) return null;

    if (String(latest.savedAt || '') !== String(syncing.savedAt || '') || latest.deleted) {
      const pending = { ...latest, syncStatus: 'pending' };
      await idbPut(pending);
      return pending;
    }

    const synced = {
      ...latest,
      name: syncing.nameDirty
        ? latest.name
        : String(result?.draft?.name || latest.name || ''),
      nameDirty: false,
      syncStatus: 'synced',
      syncError: '',
      syncedAt: new Date().toISOString(),
      serverSavedAt: String(result?.draft?.savedAt || '')
    };
    await idbPut(synced);
    return synced;
  } catch (error) {
    const latest = await idbGet(record.id);
    if (!latest) return null;
    const permanentValidationError = Number(error?.status || 0) === 400;
    const failed = {
      ...latest,
      syncStatus: permanentValidationError ? 'blocked' : 'pending',
      syncError: permanentValidationError
        ? `Server rejected this saved draft: ${String(error?.message || 'validation failed')}. Open and save the draft again to retry.`
        : String(error?.message || 'Draft sync failed.'),
      lastSyncAttemptAt: new Date().toISOString()
    };
    await idbPut(failed);
    return failed;
  } finally {
    draftSyncInFlight.delete(record.id);
  }
}

async function syncDeletedDraft(record) {
  if (!record?.id || !record.deleted || !navigator.onLine) return false;
  try {
    await api(`/drafts/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
  } catch (error) {
    // A missing server draft is already equivalent to the requested state.
    if (!/404|draft not found/i.test(String(error?.message || ''))) throw error;
  }
  await idbDelete(record.id);
  return true;
}

async function syncPendingDrafts() {
  if (!draftDb || !navigator.onLine || stopped) return;
  const all = await idbGetAll();
  const pending = all.filter((record) => (
    record &&
    (
      record.deleted ||
      (
        record.syncVersion === FORMAL_DRAFT_SYNC_VERSION &&
        (
          record.syncStatus === 'pending' ||
          record.syncStatus === 'syncing'
        )
      )
    )
  ));
  if (!pending.length) return;

  for (const record of pending) {
    if (record.deleted) await syncDeletedDraft(record);
    else await syncDraftRecord(record);
  }
  await loadDrafts();
}

async function saveDraft() {
  try {
    if (!draftDb) throw new Error('Browser draft storage is not available.');

    const value = draftPayload();
    const existing = await idbGet(value.id);
    const savedAt = new Date().toISOString();
    const record = {
      id: value.id,
      type: 'formalReportDraft',
      syncVersion: FORMAL_DRAFT_SYNC_VERSION,
      name: existing?.name || defaultDraftName(value),
      nameDirty: Boolean(existing?.nameDirty),
      savedAt,
      value,
      syncStatus: 'pending',
      syncError: ''
    };

    await idbPut(record);
    await loadDrafts({ includeServer: false });

    if (navigator.onLine) {
      syncDraftRecord(record)
        .then(() => loadDrafts())
        .catch(() => {});
      showNotice('Draft saved on this device. Server sync started.');
    } else {
      showNotice('Draft saved on this device. It will sync automatically when online.');
    }
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadDrafts({ includeServer = true } = {}) {
  const list = $('drafts-list');
  list.innerHTML = '<div class="text-muted small">Loading drafts…</div>';

  try {
    const localRecords = draftDb ? await idbGetAll() : [];
    const localDrafts = localRecords
      .filter((record) => record && !record.deleted && record.type === 'formalReportDraft' && record.value)
      .map(localDraftSummary);

    const byId = new Map(localDrafts.map((draft) => [draft.id, draft]));

    if (includeServer && navigator.onLine) {
      try {
        const data = await api('/drafts');
        const serverDrafts = Array.isArray(data.drafts) ? data.drafts : [];
        serverDrafts.forEach((draft) => {
          if (!byId.has(draft.id)) byId.set(draft.id, { ...draft, syncStatus: 'server', syncError: '' });
        });
      } catch {
        // Browser drafts remain usable if the server list is temporarily unavailable.
      }
    }

    const drafts = Array.from(byId.values())
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));

    $('draft-count').textContent = `${drafts.length} draft(s)`;
    list.innerHTML = drafts.length ? drafts.map((draft) => {
      const status = draft.syncStatus === 'synced' || draft.syncStatus === 'server'
        ? '<span class="badge bg-success ms-2">Server synced</span>'
        : draft.syncStatus === 'syncing'
          ? '<span class="badge bg-info ms-2">Syncing</span>'
          : draft.syncStatus === 'blocked'
            ? '<span class="badge bg-danger ms-2">Needs review</span>'
            : draft.syncStatus
              ? '<span class="badge bg-warning text-dark ms-2">Saved locally</span>'
              : '<span class="badge bg-secondary ms-2">Legacy local</span>';
      const syncError = draft.syncError
        ? `<div class="text-danger small">Server sync pending: ${escapeHtml(draft.syncError)}</div>`
        : '';
      return `
        <div class="draft-row">
          <div class="draft-copy">
            <div class="fw-bold draft-name">${escapeHtml(draft.name || `${draft.section} · ${draft.month} · Week ${draft.week}`)}${status}</div>
            <div class="text-muted small">Step ${normalizeWorkflowStep(draft.workflowStep, draft.section ? 2 : 1)} of 3 · Updated: ${draft.savedAt ? new Date(draft.savedAt).toLocaleString('en-ZA') : 'Server draft'}</div>
            ${syncError}
          </div>
          <div class="draft-actions"><button class="btn btn-primary btn-sm" type="button" data-load-draft="${escapeHtml(draft.id)}">Load</button><button class="btn btn-outline-secondary btn-sm" type="button" data-rename-draft="${escapeHtml(draft.id)}">Rename</button><button class="btn btn-outline-danger btn-sm" type="button" data-delete-draft="${escapeHtml(draft.id)}">Delete</button></div>
        </div>`;
    }).join('') : '<div class="text-muted small">No saved drafts.</div>';

    list.querySelectorAll('[data-load-draft]').forEach((button) => button.addEventListener('click', () => loadDraft(button.dataset.loadDraft)));
    list.querySelectorAll('[data-rename-draft]').forEach((button) => button.addEventListener('click', () => renameDraft(button.dataset.renameDraft)));
    list.querySelectorAll('[data-delete-draft]').forEach((button) => button.addEventListener('click', () => deleteDraft(button.dataset.deleteDraft)));
  } catch (error) {
    $('draft-count').textContent = '0 draft(s)';
    list.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadDraft(id) {
  try {
    const local = await idbGet(id);
    if (local?.value && !local.deleted) {
      reopenEntry({ ...local.value, name: local.name }, 'Draft loaded from this device. Continue editing or review it before saving again.');
      return;
    }

    const data = await api(`/drafts/${encodeURIComponent(id)}`);
    if (data?.draft && draftDb) {
      const cached = {
        id: data.draft.id,
        type: 'formalReportDraft',
        syncVersion: FORMAL_DRAFT_SYNC_VERSION,
        name: data.draft.name || defaultDraftName(data.draft),
        savedAt: data.draft.savedAt || new Date().toISOString(),
        value: data.draft,
        nameDirty: false,
        syncStatus: 'synced',
        syncError: '',
        syncedAt: new Date().toISOString()
      };
      await idbPut(cached);
    }
    reopenEntry(data.draft, 'Draft loaded. Continue editing or review it before saving again.');
    await loadDrafts();
  } catch (error) { showNotice(error.message, 'error'); }
}

async function renameDraft(id) {
  const name = window.prompt('New draft name:');
  if (name == null) return;
  const cleanName = name.replace(/\s+/g, ' ').trim();
  if (!cleanName) return showNotice('Draft name cannot be empty.', 'error');
  if (cleanName.length > 120) return showNotice('Draft name must be 120 characters or fewer.', 'error');

  try {
    let record = await idbGet(id);
    if (!record?.value) {
      const data = await api(`/drafts/${encodeURIComponent(id)}`);
      record = {
        id,
        type: 'formalReportDraft',
        syncVersion: FORMAL_DRAFT_SYNC_VERSION,
        name: data.draft?.name || defaultDraftName(data.draft || {}),
        savedAt: data.draft?.savedAt || new Date().toISOString(),
        value: data.draft,
        nameDirty: false,
        syncStatus: 'synced',
        syncError: ''
      };
    }

    const updated = {
      ...record,
      syncVersion: FORMAL_DRAFT_SYNC_VERSION,
      name: cleanName,
      nameDirty: true,
      savedAt: new Date().toISOString(),
      syncStatus: 'pending',
      syncError: ''
    };
    await idbPut(updated);
    await loadDrafts({ includeServer: false });

    if (navigator.onLine) {
      syncDraftRecord(updated)
        .then(() => loadDrafts())
        .catch(() => {});
    }
    showNotice('Draft renamed on this device. Server sync will continue automatically.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function deleteDraft(id) {
  if (!window.confirm('Delete this report draft?')) return;
  try {
    const existing = await idbGet(id);
    if (existing) {
      await idbPut({
        ...existing,
        syncVersion: FORMAL_DRAFT_SYNC_VERSION,
        deleted: true,
        syncStatus: 'pending',
        syncError: '',
        savedAt: new Date().toISOString()
      });
    } else if (draftDb) {
      await idbPut({
        id,
        type: 'formalReportDraft',
        syncVersion: FORMAL_DRAFT_SYNC_VERSION,
        name: id,
        savedAt: new Date().toISOString(),
        value: null,
        deleted: true,
        syncStatus: 'pending',
        syncError: ''
      });
    }

    await loadDrafts({ includeServer: false });

    if (navigator.onLine) {
      const tombstone = await idbGet(id);
      syncDeletedDraft(tombstone)
        .then(() => loadDrafts())
        .catch(async (error) => {
          const latest = await idbGet(id);
          if (latest) await idbPut({ ...latest, syncError: String(error?.message || 'Delete sync failed.') });
          await loadDrafts();
        });
    }
    showNotice(navigator.onLine ? 'Draft deleted locally. Server deletion is syncing.' : 'Draft deleted locally. Server deletion will sync when online.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function generateReport() {
  const button = $('generate-report');
  if (!navigator.onLine) {
    showNotice('Connect to a network before generating the final DOCX/PDF. The draft remains saved on this device.', 'error');
    return;
  }
  button.disabled = true; button.textContent = 'Generating…';
  try {
    const result = await api('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftPayload()) });
    const files = $('generated-files');
    files.innerHTML = result.outputs.map((output) => `<div><strong>${escapeHtml(output.model)} report</strong><span>${output.systems} system(s)</span><a class="btn btn-outline-secondary btn-sm" data-secure-download href="${output.docxUrl}">Download DOCX</a><a class="btn btn-primary btn-sm" data-secure-download href="${output.pdfUrl}">Download PDF</a></div>`).join('');
    files.classList.remove('hidden');
    showNotice(`${result.outputs.length} report set(s) generated successfully.`);
  } catch (error) { showNotice(error.message, 'error'); }
  finally { button.textContent = 'Generate final DOCX & PDF'; button.disabled = !$('final-confirmation').checked; }
}

function reopenEntry(entry, message) {
  if (!entry) return;

  const sectionName = String(entry.section || '').trim();
  const section = sectionName ? state.sections.find((item) => item.name === sectionName) || null : null;
  if (sectionName && !section) return showNotice('The report section is no longer available.', 'error');

  state.draftId = String(entry.id || '').trim();
  state.section = section;
  state.month = String(entry.month || '');
  state.week = Number.isInteger(Number(entry.week)) && Number(entry.week) >= 1 && Number(entry.week) <= 53 ? Number(entry.week) : null;
  state.weekRange = String(entry.weekRange || '');
  state.compiledName = String(entry.compiledName || '');
  state.compiledDesignation = String(entry.compiledDesignation || '');
  state.systems = section?.systems || [];
  state.responses = Object.fromEntries(
    (Array.isArray(entry.responses) ? entry.responses : [])
      .filter((response) => response?.systemId != null)
      .map((response) => [String(response.systemId), response])
  );
  state.finalConfirmed = Boolean(entry.finalConfirmed);

  $('section').value = sectionName;
  $('month').value = state.month;
  $('week').value = state.week ? String(state.week) : '';
  $('compiled-name').value = state.compiledName;
  $('compiled-designation').value = state.compiledDesignation;
  updateWeekRange();
  $('system-count').textContent = section ? `${section.systemCount} systems will be included.` : 'Select an area to view its systems.';

  const savedStep = normalizeWorkflowStep(entry.workflowStep, section ? 2 : 1);
  if (savedStep === 1 || !section) {
    setStep(1);
    showNotice(message);
    return;
  }

  $('questionnaire-title').textContent = section.name;
  $('questionnaire-period').textContent = state.month && state.week
    ? `${monthLabel(state.month)} · Week ${state.week} (${state.weekRange})`
    : '';

  renderSystems();

  if (savedStep === 3 && state.systems.length && state.systems.every((system) => responseComplete(currentResponse(system.id)))) {
    renderReview({ preserveConfirmation: true });
  } else {
    state.finalConfirmed = false;
    setStep(2);
  }

  showNotice(message);
}

function monthLabel(value) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function applySections(sections) {
  state.sections = Array.isArray(sections) ? sections : [];
  const select = $('section');
  select.innerHTML = '<option value="">Select area</option>';
  state.sections.forEach((section) => {
    const option = doc.createElement('option');
    option.value = section.name;
    option.textContent = `${section.name} (${section.systemCount} systems)`;
    select.append(option);
  });
}

async function cacheSections(sections) {
  if (!draftDb) return;
  await idbPut({
    id: '__reference_sections__',
    type: 'formalReference',
    value: Array.isArray(sections) ? sections : [],
    updatedAt: new Date().toISOString()
  });
}

async function loadCachedSections() {
  const cached = await idbGet('__reference_sections__');
  if (!cached || !Array.isArray(cached.value) || !cached.value.length) return null;
  return cached;
}

async function initialize() {
  populateWeeks();
  const today = new Date();
  $('month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  try {
    draftDb = await openDraftDb();
    await loadDrafts();
  } catch (error) {
    showNotice(`Browser draft storage unavailable: ${error.message}`, 'error');
  }

  let loadedSections = false;

  if (navigator.onLine) {
    try {
      const body = await api('/sections');
      applySections(body.sections);
      await cacheSections(body.sections);
      loadedSections = true;
      await loadDrafts();
      syncPendingDrafts().catch(() => {});
    } catch {
      // A connected browser can still have an unavailable API/tunnel.
      // Fall through to the last synchronized local section inventory.
    }
  }

  if (!loadedSections) {
    try {
      const cached = await loadCachedSections();
      if (!cached) {
        showNotice('No synchronized Section Report inventory is available on this device. Connect to a network once before using Section Reports offline.', 'error');
        return;
      }

      applySections(cached.value);
      await loadDrafts({ includeServer: false });
      const label = cached.updatedAt ? new Date(cached.updatedAt).toLocaleString('en-ZA') : '';
      showNotice(`Offline mode: using saved Section Report inventory${label ? ` from ${label}` : ''}.`, 'success');
    } catch (error) {
      showNotice(`Unable to load saved Section Report inventory: ${error.message}`, 'error');
    }
  }
}

$('section').addEventListener('change', () => {
  const section = state.sections.find((item) => item.name === $('section').value);
  $('system-count').textContent = section ? `${section.systemCount} systems will be included.` : 'Select an area to view its systems.';
});
$('month').addEventListener('change', updateWeekRange);
$('week').addEventListener('change', updateWeekRange);
$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const { section, month, week, compiledName, compiledDesignation } = syncSetupState();
  if (!section || !month || !week || !compiledName || !compiledDesignation) return showNotice('Complete the area, service period and Compiled By details.', 'error');
  if (compiledName.length > 120) return showNotice('Compiled By name must be 120 characters or fewer.', 'error');
  if (compiledDesignation.length > 160) return showNotice('Designation / position must be 160 characters or fewer.', 'error');
  const range = isoWeekRange(Number(month.slice(0, 4)), week);
  if (!overlapMonth(range, month)) return showNotice('The selected calendar week does not overlap the selected month.', 'error');
  state.weekRange = `${dateLabel(range.monday)} – ${dateLabel(range.sunday)}`;
  state.index = 0;
  state.finalConfirmed = false;
  $('questionnaire-title').textContent = section.name;
  $('questionnaire-period').textContent = `${monthLabel(month)} · Week ${week} (${state.weekRange})`;
  renderSystems(); setStep(2);
});
$('previous-step').addEventListener('click', () => {
  syncAllInputs();
  state.finalConfirmed = false;
  setStep(1);
});
$('next-review').addEventListener('click', () => {
  syncAllInputs();
  const incompleteSystem = state.systems.find((system) => !responseComplete(currentResponse(system.id)));
  if (incompleteSystem) {
    showNotice('Answer every system and complete all required fields before continuing.', 'error');
    const incompleteCard = root.querySelector(`#${CSS.escape(`system-${incompleteSystem.id}`)}`);
    if (incompleteCard) incompleteCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  renderReview();
});
$('back-to-systems').addEventListener('click', () => {
  state.finalConfirmed = false;
  $('final-confirmation').checked = false;
  renderSystems();
  setStep(2);
});
root.querySelectorAll('[data-save-draft]').forEach((button) => button.addEventListener('click', saveDraft));
$('generate-report').addEventListener('click', generateReport);
$('final-confirmation').addEventListener('change', () => {
  state.finalConfirmed = $('final-confirmation').checked;
  $('generate-report').disabled = !state.finalConfirmed;
});
root.addEventListener('click', async (event) => {
  const link = event.target.closest?.('[data-secure-download]');
  if (!link) return;
  event.preventDefault();
  try {
    const response = await fetch(link.getAttribute('href') || link.href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = decodeURIComponent(link.href.split('/').pop() || 'report');
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) { showNotice(error.message, 'error'); }
});

const onOnline = () => {
  syncPendingDrafts().catch(() => {});
  loadDrafts().catch(() => {});
};
window.addEventListener('online', onOnline);
const syncTimer = window.setInterval(() => {
  if (navigator.onLine) syncPendingDrafts().catch(() => {});
}, 10000);

initialize();

return () => {
  stopped = true;
  window.removeEventListener('online', onOnline);
  window.clearInterval(syncTimer);
  try { if (draftDb) draftDb.close(); } catch {}
  draftDb = null;
};
}
