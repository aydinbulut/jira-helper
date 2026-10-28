(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const MENU_ITEM_ID = 'jbsc-menu-item';
  const OVERLAY_ID   = 'jbsc-overlay';
  const DELAY_MS     = 175;

  const ZOOM_LEVELS  = [1, 1.2, 1.4, 1.6];
  const ZOOM_KEY     = 'jbsc-zoom-index';

  let modalKeyHandler = null;

  // ── Page detection ─────────────────────────────────────────────────────────

  function isJiraIssuePage() {
    return /\/browse\/[A-Z][A-Z0-9_]*-\d+/.test(location.pathname)
      || /[?&]selectedIssue=[A-Z][A-Z0-9_]*-\d+/.test(location.search);
  }

  function extractIssueKey() {
    const pathMatch = location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/);
    if (pathMatch) return pathMatch[1];
    const paramMatch = location.search.match(/[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/);
    return paramMatch ? paramMatch[1] : null;
  }

  // ── Menu injection ─────────────────────────────────────────────────────────

  function isInHiddenTemplate(el) {
    return !!(el && el.closest('.hidden, .shortcut-links, [hidden]'));
  }

  function findCreateSubtaskItem() {
    // Strategy 1: known element ID (skip hidden template containers)
    let el = document.getElementById('create-subtask');
    if (el && !isInHiddenTemplate(el)) return el.closest('li') || el;

    // Strategy 2: AUI action class (skip hidden template containers)
    el = document.querySelector('.issueaction-create-subtask');
    if (el && !isInHiddenTemplate(el)) return el.closest('li') || el;

    // Strategy 3: text scan inside the More dropdown container
    const dropdown = document.getElementById('opsbar-operations_more_drop')
      || document.querySelector('[id$="_more_drop"]');
    if (dropdown) {
      for (const li of dropdown.querySelectorAll('li')) {
        if (/create (sub.?task|child issue)/i.test(li.textContent)) return li;
      }
    }

    // Strategy 4: text scan scoped to known Jira action bar containers
    // (avoids matching "Create sub-task" links in the issue list panel on ?jql= pages)
    const containers = document.querySelectorAll(
      '#opsbar-operations, #opsbar_operations, .ops-menus, [id*="opsbar"], .aui-toolbar2'
    );
    for (const container of containers) {
      for (const a of container.querySelectorAll('a')) {
        if (/^create (sub.?task|child issue)$/i.test(a.textContent.trim())) {
          return a.closest('li') || a;
        }
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

  async function fetchProjectComponents(projectKey) {
    const res = await fetch(
      '/rest/api/2/project/' + encodeURIComponent(projectKey) + '/components',
      { credentials: 'include', headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error('Cannot load components (' + res.status + ')');
    const data = await res.json();
    return data.map(function (c) { return c.name; }).sort();
  }

  async function createSubtask(parentKey, projectKey, issueTypeId, subtask) {
    const fields = {
      project:   { key: projectKey },
      parent:    { key: parentKey },
      issuetype: { id: issueTypeId },
      summary:   subtask.summary
    };

    fields.components = subtask.components.map(function (opt) {
      return { name: opt.value };
    });

    const hours = parseFloat(subtask.estimate);
    if (!isNaN(hours) && hours > 0) {
      fields.timetracking = { originalEstimate: hours + 'h' };
    }

    const res = await fetch('/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: JSON.stringify({ fields: fields })
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

  // ── Row helpers ────────────────────────────────────────────────────────────

  function buildComponentMultiSelect() {
    const wrapper = document.createElement('div');
    wrapper.className = 'jbsc-component-select';

    const tagList = document.createElement('div');
    tagList.className = 'jbsc-tag-list';

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'jbsc-chevron';
    chevron.setAttribute('aria-label', 'Toggle component list');
    chevron.textContent = '▾';

    const dropdown = document.createElement('div');
    dropdown.className = 'jbsc-dropdown';
    dropdown.style.display = 'none';

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'jbsc-dropdown-loading';
    loadingMsg.textContent = 'Loading components…';
    dropdown.appendChild(loadingMsg);

    wrapper.append(tagList, chevron, dropdown);

    function getSelectedValues() {
      return Array.from(tagList.querySelectorAll('.jbsc-tag')).map(function (t) {
        return t.dataset.value;
      });
    }

    function addTag(name) {
      const tag = document.createElement('span');
      tag.className = 'jbsc-tag';
      tag.dataset.value = name;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'jbsc-tag-remove';
      removeBtn.setAttribute('aria-label', 'Remove ' + name);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        tag.remove();
        refreshDropdownSelected();
      });

      tag.append(name, removeBtn);
      tagList.appendChild(tag);
    }

    function toggleTag(name) {
      const existing = tagList.querySelector('.jbsc-tag[data-value="' + name + '"]');
      if (existing) {
        existing.remove();
      } else {
        addTag(name);
      }
      refreshDropdownSelected();
    }

    function refreshDropdownSelected() {
      const selected = getSelectedValues();
      dropdown.querySelectorAll('.jbsc-dropdown-option').forEach(function (opt) {
        opt.classList.toggle('jbsc-option-selected', selected.indexOf(opt.dataset.value) !== -1);
      });
    }

    var outsideClickHandler = null;

    function openDropdown() {
      dropdown.style.display = 'block';
      wrapper.classList.add('jbsc-open');
      refreshDropdownSelected();
      outsideClickHandler = function (e) {
        if (!wrapper.contains(e.target)) closeDropdown();
      };
      setTimeout(function () {
        document.addEventListener('click', outsideClickHandler);
      }, 0);
    }

    function closeDropdown() {
      dropdown.style.display = 'none';
      wrapper.classList.remove('jbsc-open');
      if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler);
        outsideClickHandler = null;
      }
    }

    function toggleDropdown() {
      if (chevron.disabled) return;
      if (dropdown.style.display === 'none') openDropdown();
      else closeDropdown();
    }

    chevron.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDropdown();
    });

    wrapper.addEventListener('click', function (e) {
      if (e.target === wrapper || e.target === tagList) toggleDropdown();
    });

    wrapper.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dropdown.style.display !== 'none') {
        e.stopPropagation();
        closeDropdown();
      }
    });

    wrapper._reset = function () {
      tagList.innerHTML = '';
    };

    wrapper.setOptions = function (names) {
      dropdown.innerHTML = '';
      names.forEach(function (name) {
        const opt = document.createElement('div');
        opt.className = 'jbsc-dropdown-option';
        opt.dataset.value = name;
        opt.textContent = name;
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleTag(name);
        });
        dropdown.appendChild(opt);
      });
      refreshDropdownSelected();
    };

    return wrapper;
  }

  function buildRowsHeader() {
    const header = document.createElement('div');
    header.className = 'jbsc-row jbsc-row-header';

    const summaryLabel = document.createElement('span');
    summaryLabel.className = 'jbsc-col-summary';
    summaryLabel.textContent = 'Summary';

    const compLabel = document.createElement('span');
    compLabel.className = 'jbsc-col-component';
    compLabel.textContent = 'Component';

    const estLabel = document.createElement('span');
    estLabel.className = 'jbsc-col-estimate';
    estLabel.textContent = 'h';

    const spacer = document.createElement('span');
    spacer.className = 'jbsc-col-delete';

    header.append(summaryLabel, compLabel, estLabel, spacer);
    return header;
  }

  function buildInputRow(rowsContainer, createBtn) {
    const row = document.createElement('div');
    row.className = 'jbsc-row';

    const summaryInput = document.createElement('input');
    summaryInput.type = 'text';
    summaryInput.className = 'jbsc-summary';
    summaryInput.placeholder = 'Subtask title';

    const compSelect = buildComponentMultiSelect();

    const estInput = document.createElement('input');
    estInput.type = 'number';
    estInput.className = 'jbsc-estimate';
    estInput.placeholder = '0';
    estInput.min = '0';
    estInput.step = '0.5';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'jbsc-delete-row';
    deleteBtn.setAttribute('aria-label', 'Remove row');
    deleteBtn.textContent = '×';

    row.append(summaryInput, compSelect, estInput, deleteBtn);
    rowsContainer.appendChild(row);

    summaryInput.addEventListener('input', function () {
      updateCreateBtn(rowsContainer, createBtn);
    });

    deleteBtn.addEventListener('click', function () {
      if (rowsContainer.querySelectorAll('.jbsc-row').length > 1) {
        row.remove();
      } else {
        // Clear the last row instead of removing it
        summaryInput.value = '';
        estInput.value = '';
        compSelect._reset();
      }
      updateCreateBtn(rowsContainer, createBtn);
    });

    // Enter in estimate → add new row
    estInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addRow(rowsContainer, createBtn);
      }
    });

    return row;
  }

  function addRow(rowsContainer, createBtn) {
    const row = buildInputRow(rowsContainer, createBtn);
    row.querySelector('.jbsc-summary').focus();
  }

  function validRows(rowsContainer) {
    return Array.from(rowsContainer.querySelectorAll('.jbsc-row')).filter(function (row) {
      const input = row.querySelector('.jbsc-summary');
      return input && input.value.trim().length > 0;
    });
  }

  function updateCreateBtn(rowsContainer, createBtn) {
    const n = validRows(rowsContainer).length;
    createBtn.textContent = n > 0
      ? 'Create ' + n + ' Subtask' + (n > 1 ? 's' : '')
      : 'Create Subtasks';
    createBtn.disabled = n === 0;
  }

  // ── Modal ──────────────────────────────────────────────────────────────────

  function loadZoomIndex() {
    const v = parseInt(localStorage.getItem(ZOOM_KEY), 10);
    return (!isNaN(v) && v >= 0 && v < ZOOM_LEVELS.length) ? v : 0;
  }

  function applyZoom(modal, zoomOutBtn, zoomInBtn, index) {
    index = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
    modal.style.zoom = ZOOM_LEVELS[index];
    zoomOutBtn.disabled = (index === 0);
    zoomInBtn.disabled  = (index === ZOOM_LEVELS.length - 1);
    localStorage.setItem(ZOOM_KEY, index);
    return index;
  }

  function openModal(issueKey) {
    if (document.getElementById(OVERLAY_ID)) return;

    let loadedComponents = null;
    let cachedProjectKey = null;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    const modal = document.createElement('div');
    modal.id = 'jbsc-modal';

    // ── Header: title + zoom controls + close ──
    const header = document.createElement('div');
    header.id = 'jbsc-modal-header';

    const heading = document.createElement('h2');
    heading.textContent = 'Create Multiple Sub-Tasks';

    const zoomControls = document.createElement('div');
    zoomControls.className = 'jbsc-zoom-controls';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'jbsc-zoom-btn';
    zoomOutBtn.setAttribute('aria-label', 'Zoom out');
    zoomOutBtn.textContent = 'A−';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'jbsc-zoom-btn';
    zoomInBtn.setAttribute('aria-label', 'Zoom in');
    zoomInBtn.textContent = 'A+';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'jbsc-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    zoomControls.append(zoomOutBtn, zoomInBtn);
    header.append(heading, zoomControls, closeBtn);

    // ── Rest of modal ──
    const context = document.createElement('p');
    context.id = 'jbsc-issue-context';
    context.textContent = 'Parent issue: ' + issueKey;

    const rowsContainer = document.createElement('div');
    rowsContainer.id = 'jbsc-rows-container';

    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.id = 'jbsc-add-row-btn';
    addRowBtn.textContent = '+ Add row';

    const createBtn = document.createElement('button');
    createBtn.id = 'jbsc-create-btn';
    createBtn.textContent = 'Create Subtasks';
    createBtn.disabled = true;

    modal.append(header, context, buildRowsHeader(), rowsContainer, addRowBtn, createBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Apply remembered zoom
    let zoomIndex = loadZoomIndex();
    zoomIndex = applyZoom(modal, zoomOutBtn, zoomInBtn, zoomIndex);

    zoomOutBtn.addEventListener('click', function () {
      zoomIndex = applyZoom(modal, zoomOutBtn, zoomInBtn, zoomIndex - 1);
    });
    zoomInBtn.addEventListener('click', function () {
      zoomIndex = applyZoom(modal, zoomOutBtn, zoomInBtn, zoomIndex + 1);
    });

    // Start with 3 empty rows
    buildInputRow(rowsContainer, createBtn);
    buildInputRow(rowsContainer, createBtn);
    buildInputRow(rowsContainer, createBtn);

    // Fetch components in the background; populate all existing (and future) rows when ready
    fetchProjectKey(issueKey).then(function (pk) {
      cachedProjectKey = pk;
      return fetchProjectComponents(pk);
    }).then(function (names) {
      loadedComponents = names;
      rowsContainer.querySelectorAll('.jbsc-component-select').forEach(function (w) {
        w.setOptions(names);
      });
    }).catch(function () {
      rowsContainer.querySelectorAll('.jbsc-component-select').forEach(function (w) {
        w.setOptions([]);
      });
      showModalError('Could not load project components.');
    });

    addRowBtn.addEventListener('click', function () {
      const row = buildInputRow(rowsContainer, createBtn);
      if (loadedComponents) row.querySelector('.jbsc-component-select').setOptions(loadedComponents);
      row.querySelector('.jbsc-summary').focus();
    });

    createBtn.addEventListener('click', function () {
      handleCreate(issueKey, cachedProjectKey, rowsContainer, createBtn, addRowBtn);
    });

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    modalKeyHandler = function (e) {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      // Only zoom when focus is not inside a text/number input
      const tag = (document.activeElement || {}).tagName || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.jbsc-component-select')) return;

      if (e.key === '-') {
        e.preventDefault();
        zoomIndex = applyZoom(modal, zoomOutBtn, zoomInBtn, zoomIndex - 1);
      } else if (e.key === '+') {
        e.preventDefault();
        zoomIndex = applyZoom(modal, zoomOutBtn, zoomInBtn, zoomIndex + 1);
      }
    };
    document.addEventListener('keydown', modalKeyHandler);

    // Focus first summary input
    rowsContainer.querySelector('.jbsc-summary').focus();
  }

  function closeModal() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    if (modalKeyHandler) {
      document.removeEventListener('keydown', modalKeyHandler);
      modalKeyHandler = null;
    }
  }

  // ── Creation handler ───────────────────────────────────────────────────────

  async function handleCreate(parentKey, cachedProjectKey, rowsContainer, createBtn, addRowBtn) {
    const rows = validRows(rowsContainer);
    if (rows.length === 0) return;

    // Snapshot data before disabling inputs
    const subtasks = rows.map(function (row) {
      return {
        row:       row,
        summary:   row.querySelector('.jbsc-summary').value.trim(),
        components: Array.from(row.querySelectorAll('.jbsc-tag')).map(function (t) { return { value: t.dataset.value }; }),
        estimate:  row.querySelector('.jbsc-estimate').value
      };
    });

    // Disable all inputs
    rowsContainer.querySelectorAll('input, select, button').forEach(function (el) {
      el.disabled = true;
    });
    addRowBtn.disabled = true;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';

    // Remove any previous error
    const prevError = document.getElementById('jbsc-modal-error');
    if (prevError) prevError.remove();

    let projectKey, issueTypeId;
    try {
      projectKey  = cachedProjectKey || await fetchProjectKey(parentKey);
      issueTypeId = await fetchSubtaskIssueTypeId(projectKey);
    } catch (err) {
      // Re-enable on pre-flight failure
      rowsContainer.querySelectorAll('input, select, button').forEach(function (el) {
        el.disabled = false;
      });
      addRowBtn.disabled = false;
      updateCreateBtn(rowsContainer, createBtn);
      showModalError(err.message);
      return;
    }

    let successCount = 0;

    for (let i = 0; i < subtasks.length; i++) {
      const item = subtasks[i];
      try {
        const result = await createSubtask(parentKey, projectKey, issueTypeId, item);
        transformRowToResult(item.row, 'success', item.summary, result.key);
        successCount++;
      } catch (err) {
        transformRowToResult(item.row, 'error', item.summary, null, err.message);
      }
      if (i < subtasks.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    createBtn.textContent = 'Done';

    if (successCount > 0) {
      showReloadNotice(successCount);
    }
  }

  function transformRowToResult(row, status, summary, issueKey, errorMsg) {
    row.innerHTML = '';
    row.className = 'jbsc-row jbsc-row-result';
    row.dataset.status = status;

    if (status === 'success') {
      const icon = document.createTextNode('✅ ');
      const summarySpan = document.createElement('span');
      summarySpan.textContent = summary;
      const sep = document.createTextNode(' — ');
      const link = document.createElement('a');
      link.href = location.origin + '/browse/' + issueKey;
      link.target = '_blank';
      link.textContent = issueKey;
      row.append(icon, summarySpan, sep, link);
    } else {
      const icon = document.createTextNode('❌ ');
      const summarySpan = document.createElement('span');
      summarySpan.textContent = summary;
      const sep = document.createTextNode(' — ');
      const errSpan = document.createElement('span');
      errSpan.className = 'jbsc-error-msg';
      errSpan.textContent = errorMsg;
      row.append(icon, summarySpan, sep, errSpan);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function showModalError(message) {
    const modal = document.getElementById('jbsc-modal');
    const container = document.getElementById('jbsc-rows-container');
    const div = document.createElement('div');
    div.id = 'jbsc-modal-error';
    div.textContent = 'Error: ' + message;
    modal.insertBefore(div, container);
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
