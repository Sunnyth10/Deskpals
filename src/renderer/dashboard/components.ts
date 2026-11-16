/**
 * Reusable UI Components for the DeskPals Dashboard:
 * - Stepper (- value unit +)
 * - Toggle Switch (iOS / macOS native style)
 * - Card Wrapper
 */

export interface StepperOptions {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}

export function createStepper(opts: StepperOptions): HTMLElement {
  const step = opts.step ?? 1;
  let current = Math.min(opts.max, Math.max(opts.min, opts.value));

  const container = document.createElement('div');
  container.className = 'stepper-group';
  if (opts.id) container.id = opts.id;

  const btnMinus = document.createElement('button');
  btnMinus.type = 'button';
  btnMinus.className = 'stepper-btn';
  btnMinus.innerText = '−';
  btnMinus.title = 'Decrease';

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'stepper-value';
  const renderText = () => {
    valueDisplay.innerText = opts.unit ? `${current} ${opts.unit}` : `${current}`;
  };
  renderText();

  const btnPlus = document.createElement('button');
  btnPlus.type = 'button';
  btnPlus.className = 'stepper-btn';
  btnPlus.innerText = '+';
  btnPlus.title = 'Increase';

  const updateButtons = () => {
    btnMinus.disabled = current <= opts.min;
    btnPlus.disabled = current >= opts.max;
  };
  updateButtons();

  btnMinus.addEventListener('click', (e) => {
    e.preventDefault();
    if (current > opts.min) {
      current = Math.max(opts.min, current - step);
      renderText();
      updateButtons();
      opts.onChange(current);
    }
  });

  btnPlus.addEventListener('click', (e) => {
    e.preventDefault();
    if (current < opts.max) {
      current = Math.min(opts.max, current + step);
      renderText();
      updateButtons();
      opts.onChange(current);
    }
  });

  container.appendChild(btnMinus);
  container.appendChild(valueDisplay);
  container.appendChild(btnPlus);

  return container;
}

export interface SliderOptions {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  presets?: number[];
  onChange: (val: number) => void;
  onInput?: (val: number) => void;
}

export function createSlider(opts: SliderOptions): HTMLElement {
  const container = document.createElement('div');
  container.className = 'slider-group';
  if (opts.id) container.id = opts.id;
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '8px';
  container.style.flexWrap = 'wrap';

  const sliderWrap = document.createElement('div');
  sliderWrap.style.display = 'flex';
  sliderWrap.style.alignItems = 'center';
  sliderWrap.style.gap = '8px';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step ?? 1);
  input.value = String(opts.value);
  input.style.cursor = 'pointer';
  input.style.width = '110px';

  const display = document.createElement('span');
  display.className = 'slider-value';
  display.style.fontSize = '12px';
  display.style.fontWeight = '700';
  display.style.color = 'var(--accent-blue)';
  display.style.minWidth = '42px';
  display.style.textAlign = 'right';

  const updateTrack = (val: number) => {
    const min = opts.min;
    const max = opts.max;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    input.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, rgba(255, 255, 255, 0.12) ${pct}%, rgba(255, 255, 255, 0.12) 100%)`;
  };

  const render = (v: number) => {
    display.innerText = opts.unit ? `${v} ${opts.unit}` : `${v}`;
    updateTrack(v);
  };
  render(opts.value);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const triggerDebouncedChange = (val: number) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      opts.onChange(val);
    }, 200);
  };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    render(v);
    opts.onInput?.(v);
    triggerDebouncedChange(v);
  });

  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (debounceTimer) clearTimeout(debounceTimer);
    opts.onChange(v);
  });

  sliderWrap.appendChild(input);
  sliderWrap.appendChild(display);
  container.appendChild(sliderWrap);

  // Quick preset buttons
  if (opts.presets && opts.presets.length > 0) {
    const presetsWrap = document.createElement('div');
    presetsWrap.style.display = 'inline-flex';
    presetsWrap.style.gap = '4px';

    for (const p of opts.presets) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.style.padding = '2px 7px';
      pill.style.fontSize = '11px';
      pill.style.fontWeight = '600';
      pill.style.borderRadius = '5px';
      pill.style.border = '1px solid var(--border)';
      pill.style.background = 'rgba(255, 255, 255, 0.04)';
      pill.style.color = 'var(--text-muted)';
      pill.style.cursor = 'pointer';
      pill.style.transition = 'all 0.12s ease';
      pill.innerText = `${p}m`;

      pill.addEventListener('mouseenter', () => {
        pill.style.color = '#fff';
        pill.style.borderColor = 'var(--primary)';
        pill.style.background = 'rgba(168, 85, 247, 0.2)';
      });
      pill.addEventListener('mouseleave', () => {
        pill.style.color = 'var(--text-muted)';
        pill.style.borderColor = 'var(--border)';
        pill.style.background = 'rgba(255, 255, 255, 0.04)';
      });

      pill.addEventListener('click', (e) => {
        e.preventDefault();
        input.value = String(p);
        render(p);
        opts.onInput?.(p);
        opts.onChange(p);
      });

      presetsWrap.appendChild(pill);
    }
    container.appendChild(presetsWrap);
  }

  return container;
}

export interface ToggleOptions {
  id?: string;
  checked: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
}

export function createToggle(opts: ToggleOptions): HTMLElement {
  const label = document.createElement('label');
  label.className = 'toggle-switch';
  if (opts.id) label.id = opts.id;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = opts.checked;

  const slider = document.createElement('span');
  slider.className = 'toggle-slider';

  input.addEventListener('change', () => {
    opts.onChange(input.checked);
  });

  label.appendChild(input);
  label.appendChild(slider);

  return label;
}

export function createCard(title: string, subtitle?: string): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement('div');
  card.className = 'dash-card';

  const header = document.createElement('div');
  header.className = 'dash-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'dash-card-title';
  titleEl.innerText = title;
  header.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement('p');
    subEl.className = 'dash-card-subtitle';
    subEl.innerText = subtitle;
    header.appendChild(subEl);
  }

  const body = document.createElement('div');
  body.className = 'dash-card-body';

  card.appendChild(header);
  card.appendChild(body);

  return { card, body };
}
