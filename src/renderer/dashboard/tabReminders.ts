import type { DashboardApi } from '../../preload/dashboardPreload';
import type { ReminderItem } from '../../core/reminders';
import { formatLiveNext } from '../../core/reminders';
import type { Settings } from '../../core/settings';
import { t } from '../../core/i18n';
import { createCard, createSlider, createToggle } from './components';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

export function renderRemindersTab(container: HTMLElement, settings: Settings): () => void {
  container.innerHTML = '';
  const lang = settings.language;

  // Add Reminder Card
  const { card: addCard, body: addBody } = createCard(t('reminders_title', lang), 'Set daily tasks and companions will remind you with countdown bubbles.');

  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.gap = '10px';
  form.style.flexWrap = 'wrap';

  const taskInput = document.createElement('input');
  taskInput.type = 'text';
  taskInput.placeholder = t('reminders_task_placeholder', lang);
  taskInput.required = true;
  taskInput.style.flex = '1';
  taskInput.style.minWidth = '220px';

  // Default to 1 hour from now for convenience
  const defaultTime = new Date();
  defaultTime.setHours(defaultTime.getHours() + 1);
  const defH = String(defaultTime.getHours()).padStart(2, '0');
  const defM = String(defaultTime.getMinutes()).padStart(2, '0');

  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = `${defH}:${defM}`;
  timeInput.required = true;

  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'btn-primary';
  addBtn.innerText = `+ ${t('reminders_add_btn', lang)}`;

  form.appendChild(taskInput);
  form.appendChild(timeInput);
  form.appendChild(addBtn);
  addBody.appendChild(form);
  container.appendChild(addCard);

  // Reminders List Container
  const listContainer = document.createElement('div');
  listContainer.style.display = 'flex';
  listContainer.style.flexDirection = 'column';
  listContainer.style.gap = '12px';
  container.appendChild(listContainer);

  let remindersList = [...settings.reminders];

  const renderList = () => {
    listContainer.innerHTML = '';
    if (remindersList.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'dash-card';
      emptyNotice.style.textAlign = 'center';
      emptyNotice.style.color = 'var(--text-muted)';
      emptyNotice.style.padding = '30px';
      emptyNotice.innerText = t('reminders_empty', lang);
      listContainer.appendChild(emptyNotice);
      return;
    }

    for (const reminder of remindersList) {
      const card = document.createElement('div');
      card.className = 'dash-card';
      card.style.opacity = reminder.enabled ? '1' : '0.65';

      // Header: Task input + time input + delete button
      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.justifyContent = 'space-between';
      topRow.style.gap = '10px';
      topRow.style.flexWrap = 'wrap';

      const taskEdit = document.createElement('input');
      taskEdit.type = 'text';
      taskEdit.value = reminder.task;
      taskEdit.style.fontWeight = '700';
      taskEdit.style.flex = '1';
      taskEdit.style.fontSize = '14px';
      taskEdit.addEventListener('change', async () => {
        reminder.task = taskEdit.value.trim() || 'Reminder';
        remindersList = await window.deskpals.saveReminder(reminder);
        renderList();
      });

      const timeEdit = document.createElement('input');
      timeEdit.type = 'time';
      timeEdit.value = reminder.time;
      timeEdit.addEventListener('change', async () => {
        reminder.time = timeEdit.value;
        remindersList = await window.deskpals.saveReminder(reminder);
        renderList();
      });

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'btn-danger';
      btnDelete.innerText = '✕ ' + t('reminders_delete', lang);
      btnDelete.addEventListener('click', async () => {
        remindersList = await window.deskpals.deleteReminder(reminder.id);
        renderList();
      });

      topRow.appendChild(taskEdit);
      topRow.appendChild(timeEdit);
      topRow.appendChild(btnDelete);
      card.appendChild(topRow);

      // Live next due line
      const liveLine = document.createElement('div');
      liveLine.className = 'live-line';
      liveLine.style.fontSize = '12px';
      liveLine.style.fontWeight = '600';
      liveLine.style.color = reminder.enabled ? 'var(--accent-blue)' : 'var(--text-dim)';
      liveLine.innerText = formatLiveNext(reminder);
      card.appendChild(liveLine);

      // Controls Grid
      const controlsRow = document.createElement('div');
      controlsRow.style.display = 'grid';
      controlsRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
      controlsRow.style.gap = '12px';
      controlsRow.style.paddingTop = '8px';
      controlsRow.style.borderTop = '1px solid var(--border)';

      // 1. Enable Toggle
      const enableCol = document.createElement('div');
      enableCol.style.display = 'flex';
      enableCol.style.alignItems = 'center';
      enableCol.style.gap = '8px';
      const enableLabel = document.createElement('span');
      enableLabel.innerText = t('reminders_enable', lang);
      enableLabel.style.fontSize = '12px';
      const enableToggle = createToggle({
        checked: reminder.enabled,
        onChange: async (checked) => {
          reminder.enabled = checked;
          remindersList = await window.deskpals.saveReminder(reminder);
          renderList();
        },
      });
      enableCol.appendChild(enableToggle);
      enableCol.appendChild(enableLabel);
      controlsRow.appendChild(enableCol);

      // 2. Pet Countdown Toggle
      const countdownCol = document.createElement('div');
      countdownCol.style.display = 'flex';
      countdownCol.style.alignItems = 'center';
      countdownCol.style.gap = '8px';
      const countdownLabel = document.createElement('span');
      countdownLabel.innerText = t('reminders_pet_countdown', lang);
      countdownLabel.style.fontSize = '12px';
      const countdownToggle = createToggle({
        checked: reminder.petCountdown,
        onChange: async (checked) => {
          reminder.petCountdown = checked;
          remindersList = await window.deskpals.saveReminder(reminder);
          renderList();
        },
      });
      countdownCol.appendChild(countdownToggle);
      countdownCol.appendChild(countdownLabel);
      controlsRow.appendChild(countdownCol);

      // 3. Enlarge on Alert Toggle
      const enlargeCol = document.createElement('div');
      enlargeCol.style.display = 'flex';
      enlargeCol.style.alignItems = 'center';
      enlargeCol.style.gap = '8px';
      const enlargeLabel = document.createElement('span');
      enlargeLabel.innerText = t('reminders_enlarge', lang);
      enlargeLabel.style.fontSize = '12px';
      const enlargeToggle = createToggle({
        checked: reminder.enlargeOnAlert,
        onChange: async (checked) => {
          reminder.enlargeOnAlert = checked;
          remindersList = await window.deskpals.saveReminder(reminder);
          renderList();
        },
      });
      enlargeCol.appendChild(enlargeToggle);
      enlargeCol.appendChild(enlargeLabel);
      controlsRow.appendChild(enlargeCol);

      // 4. Show Before Slider
      const sliderCol = document.createElement('div');
      sliderCol.style.display = 'flex';
      sliderCol.style.alignItems = 'center';
      sliderCol.style.gap = '8px';
      const sliderLabel = document.createElement('span');
      sliderLabel.innerText = t('reminders_show_before', lang) + ':';
      sliderLabel.style.fontSize = '12px';
      sliderLabel.style.color = 'var(--text-muted)';
      const slider = createSlider({
        value: reminder.showBeforeMinutes,
        min: 1,
        max: 60,
        step: 1,
        unit: 'min',
        onChange: async (val) => {
          reminder.showBeforeMinutes = val;
          remindersList = await window.deskpals.saveReminder(reminder);
          renderList();
        },
      });
      sliderCol.appendChild(sliderLabel);
      sliderCol.appendChild(slider);
      controlsRow.appendChild(sliderCol);

      card.appendChild(controlsRow);
      listContainer.appendChild(card);
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = taskInput.value.trim();
    const time = timeInput.value;
    if (!task || !time) return;

    const newReminder: ReminderItem = {
      id: `rem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      task,
      time,
      enabled: true,
      petCountdown: true,
      showBeforeMinutes: 10,
      enlargeOnAlert: true,
    };

    taskInput.value = '';
    remindersList = await window.deskpals.saveReminder(newReminder);
    renderList();
  });

  renderList();

  // Periodic ticker to update "Next: HH:MM (Xmin)" live lines
  const intervalId = window.setInterval(() => {
    const liveLines = listContainer.querySelectorAll<HTMLElement>('.live-line');
    liveLines.forEach((el, index) => {
      const rem = remindersList[index];
      if (rem) el.innerText = formatLiveNext(rem);
    });
  }, 5000);

  return () => window.clearInterval(intervalId);
}
