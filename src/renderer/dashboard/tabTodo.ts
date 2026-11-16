import type { DashboardApi } from '../../preload/dashboardPreload';
import type { Settings } from '../../core/settings';
import { t } from '../../core/i18n';
import { formatDateKey } from '../../core/stats';
import type { TodoItem, TodoPriority } from '../../core/todos';
import { createCard } from './components';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

export function renderTodoTab(container: HTMLElement, settings: Settings): () => void {
  const lang = settings.language;
  let isCompletedOpen = true;

  async function loadAndRender(): Promise<void> {
    container.innerHTML = '';

    const todos = await window.deskpals.getTodos();
    const todayKey = formatDateKey(new Date());

    let openCount = 0;
    let doneTodayCount = 0;
    for (const item of todos) {
      if (!item.completed) {
        openCount++;
      } else if (item.completedAt === todayKey) {
        doneTodayCount++;
      }
    }

    // Header & Summary Card
    const { card: topCard, body: topBody } = createCard('📝 ' + t('todo_title', lang));
    topBody.style.display = 'flex';
    topBody.style.flexDirection = 'column';
    topBody.style.gap = '14px';

    // Summary banner
    const summaryBanner = document.createElement('div');
    summaryBanner.style.display = 'flex';
    summaryBanner.style.alignItems = 'center';
    summaryBanner.style.justifyContent = 'space-between';
    summaryBanner.style.padding = '8px 14px';
    summaryBanner.style.borderRadius = '10px';
    summaryBanner.style.background = 'rgba(168, 85, 247, 0.08)';
    summaryBanner.style.border = '1px solid rgba(168, 85, 247, 0.2)';

    const summaryText = document.createElement('div');
    summaryText.style.fontSize = '13px';
    summaryText.style.fontWeight = '700';
    summaryText.style.color = 'var(--text)';
    summaryText.innerText = `${openCount} ${t('todo_open', lang)} · ${doneTodayCount} ${t('todo_done_today', lang)}`;

    summaryBanner.appendChild(summaryText);
    topBody.appendChild(summaryBanner);

    // Add Form
    const addForm = document.createElement('form');
    addForm.style.display = 'flex';
    addForm.style.gap = '8px';
    addForm.style.alignItems = 'center';
    addForm.style.flexWrap = 'wrap';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.maxLength = 80;
    textInput.placeholder = t('todo_placeholder', lang);
    textInput.style.flex = '1';
    textInput.style.minWidth = '220px';
    textInput.style.padding = '9px 14px';
    textInput.style.borderRadius = '8px';
    textInput.style.border = '1px solid var(--border)';
    textInput.style.background = 'rgba(255, 255, 255, 0.04)';
    textInput.style.color = 'var(--text)';
    textInput.style.fontFamily = 'inherit';
    textInput.style.fontSize = '13px';

    const prioritySelect = document.createElement('select');
    prioritySelect.style.padding = '9px 12px';
    prioritySelect.style.borderRadius = '8px';
    prioritySelect.style.border = '1px solid var(--border)';
    prioritySelect.style.background = '#23262f';
    prioritySelect.style.color = 'var(--text)';
    prioritySelect.style.fontSize = '12px';
    prioritySelect.style.fontFamily = 'inherit';
    prioritySelect.style.cursor = 'pointer';

    const optNormal = document.createElement('option');
    optNormal.value = 'normal';
    optNormal.innerText = `● ${t('todo_priority_normal', lang)}`;
    optNormal.selected = true;

    const optLow = document.createElement('option');
    optLow.value = 'low';
    optLow.innerText = `● ${t('todo_priority_low', lang)}`;

    const optHigh = document.createElement('option');
    optHigh.value = 'high';
    optHigh.innerText = `● ${t('todo_priority_high', lang)}`;

    prioritySelect.appendChild(optNormal);
    prioritySelect.appendChild(optLow);
    prioritySelect.appendChild(optHigh);

    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'btn-primary';
    addBtn.innerText = t('todo_add_btn', lang);
    addBtn.style.padding = '9px 16px';

    addForm.appendChild(textInput);
    addForm.appendChild(prioritySelect);
    addForm.appendChild(addBtn);

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = textInput.value.trim();
      if (!val) return;
      textInput.value = '';
      await window.deskpals.addTodo(val, prioritySelect.value as TodoPriority);
    });

    topBody.appendChild(addForm);
    container.appendChild(topCard);

    // Tasks List Card
    const { card: listCard, body: listBody } = createCard('📋 Task List');
    listBody.style.display = 'flex';
    listBody.style.flexDirection = 'column';
    listBody.style.gap = '8px';

    const openTasks = todos.filter((t) => !t.completed);
    const completedTasks = todos.filter((t) => t.completed);

    if (todos.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.style.padding = '24px 0';
      emptyEl.style.textAlign = 'center';
      emptyEl.style.color = 'var(--text-muted)';
      emptyEl.style.fontSize = '13px';
      emptyEl.innerText = t('todo_empty', lang);
      listBody.appendChild(emptyEl);
    } else {
      // 1. Open tasks
      const openContainer = document.createElement('div');
      openContainer.style.display = 'flex';
      openContainer.style.flexDirection = 'column';
      openContainer.style.gap = '6px';

      for (const item of openTasks) {
        openContainer.appendChild(createTaskItemRow(item));
      }
      listBody.appendChild(openContainer);

      // 2. Completed section
      if (completedTasks.length > 0) {
        const completedSection = document.createElement('div');
        completedSection.style.marginTop = '12px';
        completedSection.style.borderTop = '1px solid var(--border)';
        completedSection.style.paddingTop = '12px';

        // Accordion Header
        const compHeader = document.createElement('div');
        compHeader.style.display = 'flex';
        compHeader.style.alignItems = 'center';
        compHeader.style.justifyContent = 'space-between';
        compHeader.style.padding = '4px 0';
        compHeader.style.cursor = 'pointer';
        compHeader.style.userSelect = 'none';

        const compTitleWrap = document.createElement('div');
        compTitleWrap.style.display = 'flex';
        compTitleWrap.style.alignItems = 'center';
        compTitleWrap.style.gap = '6px';

        const chevron = document.createElement('span');
        chevron.innerText = isCompletedOpen ? '▼' : '▶';
        chevron.style.fontSize = '10px';
        chevron.style.color = 'var(--text-muted)';

        const compTitle = document.createElement('span');
        compTitle.style.fontSize = '12px';
        compTitle.style.fontWeight = '700';
        compTitle.style.color = 'var(--text-muted)';
        compTitle.innerText = `${t('todo_completed_header', lang)} (${completedTasks.length})`;

        compTitleWrap.appendChild(chevron);
        compTitleWrap.appendChild(compTitle);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn-secondary';
        clearBtn.style.fontSize = '11px';
        clearBtn.style.padding = '4px 10px';
        clearBtn.innerText = t('todo_clear_completed', lang);
        clearBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await window.deskpals.clearCompletedTodos();
        });

        compHeader.appendChild(compTitleWrap);
        compHeader.appendChild(clearBtn);

        const compContainer = document.createElement('div');
        compContainer.style.display = isCompletedOpen ? 'flex' : 'none';
        compContainer.style.flexDirection = 'column';
        compContainer.style.gap = '6px';
        compContainer.style.marginTop = '8px';

        compHeader.addEventListener('click', () => {
          isCompletedOpen = !isCompletedOpen;
          chevron.innerText = isCompletedOpen ? '▼' : '▶';
          compContainer.style.display = isCompletedOpen ? 'flex' : 'none';
        });

        for (const item of completedTasks) {
          compContainer.appendChild(createTaskItemRow(item));
        }

        completedSection.appendChild(compHeader);
        completedSection.appendChild(compContainer);
        listBody.appendChild(completedSection);
      }
    }

    container.appendChild(listCard);
  }

  function createTaskItemRow(item: TodoItem): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.padding = '8px 12px';
    row.style.borderRadius = '8px';
    row.style.background = item.completed ? 'rgba(255, 255, 255, 0.015)' : 'rgba(255, 255, 255, 0.04)';
    row.style.border = '1px solid var(--border)';
    row.style.gap = '10px';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '10px';
    left.style.flex = '1';
    left.style.minWidth = '0';

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.completed;
    checkbox.style.cursor = 'pointer';
    checkbox.style.width = '16px';
    checkbox.style.height = '16px';
    checkbox.style.accentColor = 'var(--primary)';
    checkbox.addEventListener('change', async () => {
      await window.deskpals.toggleTodo(item.id);
    });

    // Priority dot
    const dot = document.createElement('span');
    dot.innerText = '●';
    dot.style.fontSize = '12px';
    if (item.priority === 'high') {
      dot.style.color = '#f87171'; // coral
      dot.title = 'High priority';
    } else if (item.priority === 'low') {
      dot.style.color = '#38bdf8'; // blue
      dot.title = 'Low priority';
    } else {
      dot.style.color = '#a855f7'; // normal / purple
      dot.title = 'Normal priority';
    }

    // Title (Inline editable, strictly textContent)
    const titleSpan = document.createElement('span');
    titleSpan.textContent = item.text; // Strictly textContent for security
    titleSpan.style.fontSize = '13px';
    titleSpan.style.cursor = 'text';
    titleSpan.style.flex = '1';
    titleSpan.style.overflow = 'hidden';
    titleSpan.style.textOverflow = 'ellipsis';
    titleSpan.style.whiteSpace = 'nowrap';

    if (item.completed) {
      titleSpan.style.textDecoration = 'line-through';
      titleSpan.style.color = 'var(--text-muted)';
    } else {
      titleSpan.style.color = 'var(--text)';
    }

    // Inline edit setup
    titleSpan.addEventListener('dblclick', () => startInlineEdit());
    titleSpan.title = 'Double-click to edit';

    function startInlineEdit(): void {
      if (item.completed) return;

      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.maxLength = 80;
      editInput.value = item.text;
      editInput.style.flex = '1';
      editInput.style.padding = '2px 6px';
      editInput.style.fontSize = '13px';
      editInput.style.borderRadius = '4px';
      editInput.style.border = '1px solid var(--primary)';
      editInput.style.background = '#1a1b1e';
      editInput.style.color = '#fff';
      editInput.style.fontFamily = 'inherit';

      let committed = false;
      const commit = async (): Promise<void> => {
        if (committed) return;
        committed = true;
        const newText = editInput.value.trim();
        if (newText && newText !== item.text) {
          await window.deskpals.updateTodo(item.id, newText);
        } else {
          left.replaceChild(titleSpan, editInput);
        }
      };

      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          committed = true;
          left.replaceChild(titleSpan, editInput);
        }
      });

      editInput.addEventListener('blur', () => {
        void commit();
      });

      left.replaceChild(editInput, titleSpan);
      editInput.focus();
      editInput.select();
    }

    left.appendChild(checkbox);
    left.appendChild(dot);
    left.appendChild(titleSpan);

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.style.background = 'transparent';
    delBtn.style.border = 'none';
    delBtn.style.color = 'var(--text-muted)';
    delBtn.style.cursor = 'pointer';
    delBtn.style.fontSize = '14px';
    delBtn.style.padding = '4px 6px';
    delBtn.style.borderRadius = '4px';
    delBtn.style.lineHeight = '1';
    delBtn.innerText = '✕';
    delBtn.title = 'Delete task';

    delBtn.addEventListener('mouseenter', () => {
      delBtn.style.color = 'var(--accent-red)';
      delBtn.style.background = 'rgba(248, 113, 113, 0.12)';
    });
    delBtn.addEventListener('mouseleave', () => {
      delBtn.style.color = 'var(--text-muted)';
      delBtn.style.background = 'transparent';
    });

    delBtn.addEventListener('click', async () => {
      await window.deskpals.deleteTodo(item.id);
    });

    row.appendChild(left);
    row.appendChild(delBtn);

    return row;
  }

  void loadAndRender();

  const unsubscribe = window.deskpals.onTodosUpdated(() => {
    if (!document.hidden && container.isConnected) {
      void loadAndRender();
    }
  });

  return unsubscribe;
}
