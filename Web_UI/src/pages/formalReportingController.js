export default function initializeFormalReporting(root) {
if (!root) return () => {};

const state = { sections: [], section: null, month: '', week: null, weekRange: '', compiledName: '', compiledDesignation: '', systems: [], responses: {}, index: 0 };

const doc = root.ownerDocument || root.host?.ownerDocument || document;
const $ = (id) => root.querySelector(`#${CSS.escape(id)}`);

async function api(url, options = {}) {
  const token = localStorage.getItem('authToken') || '';
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  const response = await fetch(`/api/formal-reports${url}`, { cache: 'no-store', ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
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

function setStep(step) {
  root.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  $(`step-${step}`).classList.remove('hidden');
  const progress = Math.round((step / 3) * 100);
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

function renderReview() {
  syncAllInputs();
  const responses = state.systems.map((system) => ({ system, response: currentResponse(system.id) }));
  const yes = responses.filter(({ response }) => response.defectsFound === 'yes').length;
  const no = responses.filter(({ response }) => response.defectsFound === 'no').length;
  const pending = responses.filter(({ response }) => !responseComplete(response)).length;
  $('yes-count').textContent = String(yes); $('no-count').textContent = String(no); $('pending-count').textContent = String(pending);
  $('review-period').textContent = `${state.section.name} · ${monthLabel(state.month)} · Week ${state.week} (${state.weekRange})`;
  $('final-confirmation').checked = false;
  $('generate-report').disabled = true;
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
  const slug = state.section.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `${slug}-${state.month}-week-${state.week}`,
    section: state.section.name,
    month: state.month,
    week: state.week,
    weekRange: state.weekRange,
    compiledName: state.compiledName,
    compiledDesignation: state.compiledDesignation,
    finalConfirmed: $('final-confirmation').checked,
    responses: state.systems.map((system) => currentResponse(system.id))
  };
}

async function saveDraft() {
  try {
    await api('/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftPayload()) });
    showNotice('Draft saved on the server.');
    await loadDrafts();
  } catch (error) { showNotice(error.message, 'error'); }
}

async function loadDrafts() {
  const list = $('drafts-list');
  list.innerHTML = '<div class="text-muted small">Loading drafts…</div>';
  try {
    const data = await api('/drafts');
    const drafts = Array.isArray(data.drafts) ? data.drafts : [];
    $('draft-count').textContent = `${drafts.length} draft(s)`;
    list.innerHTML = drafts.length ? drafts.map((draft) => `
      <div class="draft-row">
        <div><div class="fw-bold">${escapeHtml(draft.name || `${draft.section} · ${draft.month} · Week ${draft.week}`)}</div><div class="text-muted small">Updated: ${new Date(draft.savedAt).toLocaleString('en-ZA')}</div></div>
        <div class="draft-actions"><button class="btn btn-primary btn-sm" type="button" data-load-draft="${escapeHtml(draft.id)}">Load</button><button class="btn btn-outline-secondary btn-sm" type="button" data-rename-draft="${escapeHtml(draft.id)}">Rename</button><button class="btn btn-outline-danger btn-sm" type="button" data-delete-draft="${escapeHtml(draft.id)}">Delete</button></div>
      </div>`).join('') : '<div class="text-muted small">No saved drafts.</div>';
    list.querySelectorAll('[data-load-draft]').forEach((button) => button.addEventListener('click', () => loadDraft(button.dataset.loadDraft)));
    list.querySelectorAll('[data-rename-draft]').forEach((button) => button.addEventListener('click', () => renameDraft(button.dataset.renameDraft)));
    list.querySelectorAll('[data-delete-draft]').forEach((button) => button.addEventListener('click', () => deleteDraft(button.dataset.deleteDraft)));
  } catch (error) { $('draft-count').textContent = '0 draft(s)'; list.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`; }
}

async function loadDraft(id) {
  try {
    const data = await api(`/drafts/${encodeURIComponent(id)}`);
    reopenEntry(data.draft, 'Draft loaded. Continue editing or review it before saving again.');
  } catch (error) { showNotice(error.message, 'error'); }
}

async function renameDraft(id) {
  const name = window.prompt('New draft name:');
  if (name == null) return;
  if (!name.trim()) return showNotice('Draft name cannot be empty.', 'error');
  try {
    await api(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    showNotice('Draft renamed.');
    await loadDrafts();
  } catch (error) { showNotice(error.message, 'error'); }
}

async function deleteDraft(id) {
  if (!window.confirm('Delete this report draft?')) return;
  try {
    await api(`/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showNotice('Draft deleted.');
    await loadDrafts();
  } catch (error) { showNotice(error.message, 'error'); }
}

async function generateReport() {
  const button = $('generate-report');
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
  const section = state.sections.find((item) => item.name === entry.section);
  if (!section) return showNotice('The report section is no longer available.', 'error');
  state.section = section; state.month = entry.month; state.week = entry.week; state.weekRange = entry.weekRange;
  state.compiledName = entry.compiledName; state.compiledDesignation = entry.compiledDesignation;
  state.systems = section.systems; state.responses = Object.fromEntries(entry.responses.map((response) => [String(response.systemId), response]));
  $('section').value = entry.section; $('month').value = entry.month; $('week').value = String(entry.week);
  $('compiled-name').value = entry.compiledName; $('compiled-designation').value = entry.compiledDesignation;
  $('questionnaire-title').textContent = entry.section;
  $('questionnaire-period').textContent = `${monthLabel(entry.month)} · Week ${entry.week} (${entry.weekRange})`;
  renderSystems(); setStep(2); showNotice(message);
}

function monthLabel(value) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function initialize() {
  populateWeeks();
  const today = new Date();
  $('month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  try {
    const body = await api('/sections');
    state.sections = body.sections;
    body.sections.forEach((section) => {
      const option = doc.createElement('option'); option.value = section.name; option.textContent = `${section.name} (${section.systemCount} systems)`; $('section').append(option);
    });
    await loadDrafts();
  } catch (error) { showNotice(`Unable to load areas: ${error.message}`, 'error'); }
}

$('section').addEventListener('change', () => {
  const section = state.sections.find((item) => item.name === $('section').value);
  $('system-count').textContent = section ? `${section.systemCount} systems will be included.` : 'Select an area to view its systems.';
});
$('month').addEventListener('change', updateWeekRange);
$('week').addEventListener('change', updateWeekRange);
$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const section = state.sections.find((item) => item.name === $('section').value);
  const month = $('month').value; const week = Number($('week').value);
  const compiledName = $('compiled-name').value.trim(); const compiledDesignation = $('compiled-designation').value.trim();
  if (!section || !month || !week || !compiledName || !compiledDesignation) return showNotice('Complete the area, service period and Compiled By details.', 'error');
  const range = isoWeekRange(Number(month.slice(0, 4)), week);
  if (!overlapMonth(range, month)) return showNotice('The selected calendar week does not overlap the selected month.', 'error');
  state.section = section; state.month = month; state.week = week; state.weekRange = `${dateLabel(range.monday)} – ${dateLabel(range.sunday)}`; state.compiledName = compiledName; state.compiledDesignation = compiledDesignation; state.systems = section.systems; state.responses = {}; state.index = 0;
  $('questionnaire-title').textContent = section.name;
  $('questionnaire-period').textContent = `${monthLabel(month)} · Week ${week} (${state.weekRange})`;
  renderSystems(); setStep(2);
});
$('previous-step').addEventListener('click', () => { syncAllInputs(); setStep(1); });
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
$('back-to-systems').addEventListener('click', () => { renderSystems(); setStep(2); });
$('save-draft').addEventListener('click', saveDraft);
$('generate-report').addEventListener('click', generateReport);
$('final-confirmation').addEventListener('change', () => { $('generate-report').disabled = !$('final-confirmation').checked; });
root.addEventListener('click', async (event) => {
  const link = event.target.closest?.('[data-secure-download]');
  if (!link) return;
  event.preventDefault();
  try {
    const token = localStorage.getItem('authToken') || '';
    const response = await fetch(link.getAttribute('href') || link.href, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
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

initialize();

return () => {};
}
