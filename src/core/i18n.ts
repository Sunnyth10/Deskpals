/**
 * Lightweight internationalization (i18n) dictionary.
 * Supports English ('en') and Spanish ('es') proof translation.
 */

export type SupportedLanguage = 'en' | 'es';

export const TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    // Navigation
    nav_stats: 'Stats',
    nav_pet: 'Pet',
    nav_reminders: 'Reminders',
    nav_settings: 'Settings',

    // Stats
    stats_title: 'Wellness & Productivity Stats',
    stats_breaks: 'Breaks',
    stats_waters: 'Hydration',
    stats_focus: 'Focus Minutes',
    stats_distractions: 'Distractions',
    stats_companion_days: 'Companion Days',
    stats_days_active: 'days with your pals',
    stats_focus_heatmap: 'Focus Heatmap (Past 12 Months)',
    stats_less: 'Less',
    stats_more: 'More',
    stats_today: 'Today',
    stats_mon: 'Mon',
    stats_wed: 'Wed',
    stats_fri: 'Fri',

    // Pet Tab
    pet_title: 'Choose Companion',
    pet_size: 'Scale Size',
    pet_cat: 'Cat',
    pet_fox: 'Fox',
    pet_ghost: 'Ghost',
    pet_robot: 'Robot',
    pet_webhero: 'Web Hero',
    pet_selected: 'Active',
    pet_select_btn: 'Select',

    // Reminders Tab
    reminders_title: 'Daily Reminders',
    reminders_task_placeholder: 'Take medication, stretch, stand up...',
    reminders_add_btn: 'Add Reminder',
    reminders_time_label: 'Time',
    reminders_enable: 'Enable reminder',
    reminders_pet_countdown: 'Pet countdown',
    reminders_show_before: 'Show before',
    reminders_enlarge: 'Enlarge on alert',
    reminders_delete: 'Delete',
    reminders_empty: 'No custom reminders set. Add one above!',

    // Settings Tab
    settings_title: 'Preferences',
    settings_language: 'Language',
    settings_appearance: 'Appearance',
    settings_pet_size: 'Global Pet Size',
    settings_lyrics_mode: 'Lyrics Mode (Non-interactive)',
    settings_lyrics_desc: 'Companion & speech bubbles stay visible but ignore all clicks & dragging.',
    settings_bubble_duration: 'Bubble Duration',
    settings_motion: 'Pet Motion',
    settings_auto_run: 'Auto Run',
    settings_run_direction: 'Run Direction',
    settings_run_dir_left: 'Left only',
    settings_run_dir_right: 'Right only',
    settings_run_dir_both: 'Both directions',
    settings_run_freq: 'Run Frequency',
    settings_run_dur: 'Run Duration',
    settings_idle_freq: 'Idle Motion Frequency',
    settings_health: 'Health Nudges',
    settings_break_interval: 'Break Interval',
    settings_break_fullscreen: 'Fullscreen Break Mode',
    settings_water_interval: 'Water Interval',
    settings_water_goal: 'Daily Water Goal',
    settings_focus: 'Focus Mode',
    settings_focus_enable: 'Enable Focus Mode',
    settings_focus_duration: 'Session Duration',
    settings_blocked_apps: 'Blocked Applications (comma separated)',
    settings_blocked_keywords: 'Blocked Window Keywords (comma separated)',
    settings_start_focus: 'Start Focus',
    settings_stop_focus: 'Stop Focus',
    settings_focus_active: 'Focus Session in Progress',

    // Health Nudges & Alerts
    nudge_break_title: 'Time for a break!',
    nudge_break_desc: 'Step away from your screen, rest your eyes, and take a deep breath.',
    nudge_break_dismiss: 'Dismiss',
    nudge_water_title: 'Hydration check!',
    nudge_water_desc: 'Drink a glass of water to stay fresh and energized.',
    nudge_distraction: 'Distraction detected! Stay in the zone.',
  },

  es: {
    // Navigation
    nav_stats: 'Estadísticas',
    nav_pet: 'Mascota',
    nav_reminders: 'Recordatorios',
    nav_settings: 'Ajustes',

    // Stats
    stats_title: 'Estadísticas de Bienestar y Enfoque',
    stats_breaks: 'Pausas',
    stats_waters: 'Hidratación',
    stats_focus: 'Minutos de Enfoque',
    stats_distractions: 'Distracciones',
    stats_companion_days: 'Días Juntos',
    stats_days_active: 'días con tu compañero',
    stats_focus_heatmap: 'Mapa de Calor de Enfoque (Últimos 12 meses)',
    stats_less: 'Menos',
    stats_more: 'Más',
    stats_today: 'Hoy',
    stats_mon: 'Lun',
    stats_wed: 'Mié',
    stats_fri: 'Vie',

    // Pet Tab
    pet_title: 'Elige tu Compañero',
    pet_size: 'Tamaño',
    pet_cat: 'Gato',
    pet_fox: 'Zorro',
    pet_ghost: 'Fantasma',
    pet_robot: 'Robot',
    pet_webhero: 'Héroe',
    pet_selected: 'Activo',
    pet_select_btn: 'Seleccionar',

    // Reminders Tab
    reminders_title: 'Recordatorios Diarios',
    reminders_task_placeholder: 'Tomar medicina, estirarse, caminar...',
    reminders_add_btn: 'Añadir Recordatorio',
    reminders_time_label: 'Hora',
    reminders_enable: 'Activar recordatorio',
    reminders_pet_countdown: 'Cuenta atrás de mascota',
    reminders_show_before: 'Mostrar antes',
    reminders_enlarge: 'Agrandar en alerta',
    reminders_delete: 'Eliminar',
    reminders_empty: '¡No hay recordatorios! Agrega uno arriba.',

    // Settings Tab
    settings_title: 'Preferencias',
    settings_language: 'Idioma',
    settings_appearance: 'Apariencia',
    settings_pet_size: 'Tamaño Global',
    settings_lyrics_mode: 'Modo Letras (Transparente total)',
    settings_lyrics_desc: 'Las mascotas y globos se ven pero ignoran clics y arrastres.',
    settings_bubble_duration: 'Duración del Globo',
    settings_motion: 'Movimiento',
    settings_auto_run: 'Correr Automáticamente',
    settings_run_direction: 'Dirección al Correr',
    settings_run_dir_left: 'Solo izquierda',
    settings_run_dir_right: 'Solo derecha',
    settings_run_dir_both: 'Ambas direcciones',
    settings_run_freq: 'Frecuencia de Carrera',
    settings_run_dur: 'Duración de Carrera',
    settings_idle_freq: 'Frecuencia en Reposo',
    settings_health: 'Alertas de Salud',
    settings_break_interval: 'Intervalo de Pausa',
    settings_break_fullscreen: 'Modo Pantalla Completa',
    settings_water_interval: 'Intervalo de Agua',
    settings_water_goal: 'Meta Diaria de Vasos',
    settings_focus: 'Modo Enfoque',
    settings_focus_enable: 'Activar Modo Enfoque',
    settings_focus_duration: 'Duración de Sesión',
    settings_blocked_apps: 'Aplicaciones bloqueadas (separadas por coma)',
    settings_blocked_keywords: 'Palabras clave bloqueadas (separadas por coma)',
    settings_start_focus: 'Iniciar Enfoque',
    settings_stop_focus: 'Detener Enfoque',
    settings_focus_active: 'Sesión de Enfoque Activa',

    // Health Nudges & Alerts
    nudge_break_title: '¡Hora de una pausa!',
    nudge_break_desc: 'Aléjate de la pantalla, descansa la vista y respira profundo.',
    nudge_break_dismiss: 'Cerrar',
    nudge_water_title: '¡Hora de tomar agua!',
    nudge_water_desc: 'Bebe un vaso de agua para mantenerte fresco y con energía.',
    nudge_distraction: '¡Distracción detectada! Vuelve a concentrarte.',
  },
};

export function t(key: string, lang: SupportedLanguage = 'en'): string {
  const table = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
  return table[key] ?? TRANSLATIONS.en[key] ?? key;
}
