(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const MENU_ITEM_ID = 'jbsc-menu-item';
  const OVERLAY_ID   = 'jbsc-overlay';
  const DELAY_MS     = 175;

  // ── Page detection ─────────────────────────────────────────────────────────

  function isJiraIssuePage() {
    if (!/\/browse\/[A-Z][A-Z0-9_]*-\d+/.test(location.pathname)) return false;
    const meta = document.querySelector('meta[name="application-name"]');
    return !!(meta && /jira/i.test(meta.getAttribute('content') || ''));
  }

  function extractIssueKey() {
    const m = location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/);
    return m ? m[1] : null;
  }

  // ── Menu injection ─────────────────────────────────────────────────────────

  function findCreateSubtaskItem() {
    // Strategy 1: known element ID
    let el = document.getElementById('create-subtask');
    if (el) return el.closest('li') || el;

    // Strategy 2: AUI action class
    el = document.querySelector('.issueaction-create-subtask');
    if (el) return el.closest('li') || el;

    // Strategy 3: text scan inside the More dropdown container
    const dropdown = document.getElementById('opsbar-operations_more_drop')
      || document.querySelector('[id$="_more_drop"]');
    if (dropdown) {
      for (const li of dropdown.querySelectorAll('li')) {
        if (/create sub.?task/i.test(li.textContent)) return li;
      }
    }

    // Strategy 4: text scan across all anchors (last resort)
    for (const a of document.querySelectorAll('a')) {
      if (/^create sub.?task$/i.test(a.textContent.trim())) {
        return a.closest('li') || a;
      }
    }

    return null;
  }

  function injectMenuItem() {
    if (document.getElementById(MENU_ITEM_ID)) return; // already injected

    const target = findCreateSubtaskItem();
    if (!target) return;

    const issueKey = extractIssueKey();
    if (!issueKey) return;

    const li = document.createElement('li');
    li.id = MENU_ITEM_ID;
    li.className = target.className || '';
    li.setAttribute('role', 'presentation');

    const a = document.createElement('a');
    a.setAttribute('role', 'menuitem');
    a.href = '#';
    const sourceAnchor = target.querySelector('a');
    if (sourceAnchor) a.className = sourceAnchor.className;
    a.textContent = 'Create multi-sub-task';

    a.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeAjsDropdown();
      openModal(issueKey);
    });

    li.appendChild(a);

    if (target.nextSibling) {
      target.parentNode.insertBefore(li, target.nextSibling);
    } else {
      target.parentNode.appendChild(li);
    }
  }

  function closeAjsDropdown() {
    if (window.AJS && typeof window.AJS.hideDropDown === 'function') {
      window.AJS.hideDropDown();
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // ── SPA navigation ─────────────────────────────────────────────────────────

  function onNavigate() {
    const existing = document.getElementById(MENU_ITEM_ID);
    if (existing) existing.remove();
    closeModal();
    setTimeout(function () {
      if (isJiraIssuePage()) injectMenuItem();
    }, 300);
  }

  function patchHistoryMethod(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      onNavigate();
      return result;
    };
  }

  function startObserver() {
    const observer = new MutationObserver(function () {
      if (isJiraIssuePage() && !document.getElementById(MENU_ITEM_ID)) {
        injectMenuItem();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── REST API ───────────────────────────────────────────────────────────────

  async function fetchProjectKey(issueKey) {
    const res = await fetch('/rest/api/2/issue/' + encodeURIComponent(issueKey) + '?fields=project', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Cannot load issue (' + res.status + ')');
    const data = await res.json();
    return data.fields.project.key;
  }

  async function fetchSubtaskIssueTypeId(projectKey) {
    // Primary: Jira DC 9+ endpoint
    const newRes = await fetch(
      '/rest/api/2/issue/createmeta/' + encodeURIComponent(projectKey) + '/issuetypes',
      { credentials: 'include', headers: { 'Accept': 'application/json' } }
    );
    if (newRes.ok) {
      const data = await newRes.json();
      const types = data.issueTypes || data.values || [];
      const st = types.find(function (t) { return t.subtask === true; });
      if (st) return st.id;
    }

    // Fallback: classic createmeta (Jira DC 8.x and older)
    const oldRes = await fetch(
      '/rest/api/2/issue/createmeta?projectKeys=' + encodeURIComponent(projectKey) + '&expand=projects.issuetypes',
      { credentials: 'include', headers: { 'Accept': 'application/json' } }
    );
    if (!oldRes.ok) throw new Error('Cannot load issue types (' + oldRes.status + ')');
    const data = await oldRes.json();
    const project = (data.projects || []).find(function (p) { return p.key === projectKey; });
    if (!project) throw new Error('Project ' + projectKey + ' not found');
    const st = (project.issuetypes || []).find(function (t) { return t.subtask === true; });
    if (!st) throw new Error('No subtask issue type found for project ' + projectKey + '. Ask your Jira admin to enable subtasks.');
    return st.id;
  }

  async function createSubtask(parentKey, projectKey, issueTypeId, summary) {
    const res = await fetch('/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentKey },
          issuetype: { id: issueTypeId },
          summary: summary
        }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(function () { return {}; });
      const msg = (err.errors && Object.values(err.errors)[0])
        || (err.errorMessages && err.errorMessages[0])
        || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return res.json();
  }

  // ── Modal ──────────────────────────────────────────────────────────────────

  function openModal(issueKey) {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    const modal = document.createElement('div');
    modal.id = 'jbsc-modal';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'jbsc-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    const heading = document.createElement('h2');
    heading.textContent = 'Create Multiple Sub-Tasks';

    const context = document.createElement('p');
    context.id = 'jbsc-issue-context';
    context.textContent = 'Parent issue: ' + issueKey;

    const textarea = document.createElement('textarea');
    textarea.id = 'jbsc-textarea';
    textarea.placeholder = 'One subtask title per line\nFix login bug\nWrite unit tests\nUpdate documentation';

    const countLabel = document.createElement('span');
    countLabel.id = 'jbsc-count-label';
    countLabel.textContent = '0 subtasks will be created';

    const createBtn = document.createElement('button');
    createBtn.id = 'jbsc-create-btn';
    createBtn.textContent = 'Create Subtasks';
    createBtn.disabled = true;

    const progressList = document.createElement('ul');
    progressList.id = 'jbsc-progress-list';

    modal.append(closeBtn, heading, context, textarea, countLabel, createBtn, progressList);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    textarea.addEventListener('input', function () { updateCount(textarea, countLabel, createBtn); });
    createBtn.addEventListener('click', function () { handleCreate(issueKey, textarea, createBtn, progressList); });
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', handleEscapeKey);

    setTimeout(function () { textarea.focus(); }, 50);
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', handleEscapeKey);
  }

  function handleEscapeKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  // ── Live count ─────────────────────────────────────────────────────────────

  function getLines(textarea) {
    return textarea.value
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
  }

  function updateCount(textarea, countLabel, createBtn) {
    const n = getLines(textarea).length;
    countLabel.textContent = n + ' subtask' + (n !== 1 ? 's' : '') + ' will be created';
    createBtn.textContent = 'Create ' + n + ' Subtask' + (n !== 1 ? 's' : '');
    createBtn.disabled = n === 0;
  }

  // ── Progress rows ──────────────────────────────────────────────────────────

  function addProgressRow(list, summary) {
    const li = document.createElement('li');
    li.dataset.status = 'pending';
    li.dataset.summary = summary;

    const span = document.createElement('span');
    span.textContent = summary;
    li.appendChild(span);

    list.appendChild(li);
    return li;
  }

  function markRowSuccess(li, issueKey) {
    li.dataset.status = 'success';
    const summary = li.dataset.summary;
    const a = document.createElement('a');
    a.href = location.origin + '/browse/' + issueKey;
    a.target = '_blank';
    a.textContent = issueKey;

    li.innerHTML = '';
    const summarySpan = document.createElement('span');
    summarySpan.textContent = summary;
    const sep = document.createTextNode(' — ');
    li.append(summarySpan, sep, a);
  }

  function markRowError(li, errorMsg) {
    li.dataset.status = 'error';
    const summary = li.dataset.summary;
    li.innerHTML = '';
    const summarySpan = document.createElement('span');
    summarySpan.textContent = summary;
    const sep = document.createTextNode(' — ');
    const errSpan = document.createElement('span');
    errSpan.className = 'jbsc-error-msg';
    errSpan.textContent = errorMsg;
    li.append(summarySpan, sep, errSpan);
  }

  // ── Creation handler ───────────────────────────────────────────────────────

  async function handleCreate(parentKey, textarea, createBtn, progressList) {
    const lines = getLines(textarea);
    if (lines.length === 0) return;

    textarea.disabled = true;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';

    // Remove any previous error message
    const prevError = document.getElementById('jbsc-modal-error');
    if (prevError) prevError.remove();

    let projectKey, issueTypeId;
    try {
      projectKey   = await fetchProjectKey(parentKey);
      issueTypeId  = await fetchSubtaskIssueTypeId(projectKey);
    } catch (err) {
      textarea.disabled = false;
      createBtn.disabled = false;
      updateCount(textarea, document.getElementById('jbsc-count-label'), createBtn);
      showModalError(err.message);
      return;
    }

    const rows = lines.map(function (summary) {
      return addProgressRow(progressList, summary);
    });

    let successCount = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const result = await createSubtask(parentKey, projectKey, issueTypeId, lines[i]);
        markRowSuccess(rows[i], result.key);
        successCount++;
      } catch (err) {
        markRowError(rows[i], err.message);
      }
      if (i < lines.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    createBtn.textContent = 'Done';

    if (successCount > 0) {
      showReloadNotice(successCount);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function showModalError(message) {
    const modal = document.getElementById('jbsc-modal');
    const textarea = document.getElementById('jbsc-textarea');
    const div = document.createElement('div');
    div.id = 'jbsc-modal-error';
    div.textContent = 'Error: ' + message;
    modal.insertBefore(div, textarea);
  }

  function showReloadNotice(count) {
    const existing = document.getElementById('jbsc-reload-notice');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'jbsc-reload-notice';

    const msg = document.createElement('strong');
    msg.textContent = count + ' subtask' + (count !== 1 ? 's' : '') + ' created.';

    const btn = document.createElement('button');
    btn.id = 'jbsc-reload-btn';
    btn.textContent = 'Reload to see subtasks';
    btn.addEventListener('click', function () { location.reload(); });

    div.append(msg, btn);
    document.getElementById('jbsc-modal').appendChild(div);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', onNavigate);
  startObserver();

  if (isJiraIssuePage()) injectMenuItem();

}());
