export interface SubTask {
  id: string;
  name: string;
  done: boolean;
}

// Категории задачи — существуют ТОЛЬКО в календарном виде, в списке не показываются.
// 'none' — серый, для задач без времени / нераспределённых.
export type TaskCategory = 'work' | 'personal' | 'event' | 'study' | 'none';

// Кто поставил время задаче. От этого зависит, можно ли двигать её автоматически:
// 'user' — человек поставил руками (свято, агент не двигает),
// 'agent' — агент предложил слот (можно пересчитывать).
export type TimeSource = 'user' | 'agent';

export interface Task {
  id: string;
  name: string;
  /** Время начала ("HH:MM"). Пусто — задача без времени (точка-чип в календаре, обычная строка в списке). */
  time: string;
  date: string;
  done: boolean;
  threadId?: string;
  type?: 'regular' | 'thought';
  subtasks?: SubTask[];
  calendarEventId?: string;
  description?: string;
  location?: string;
  /** Время конца ("HH:MM"). Есть и time, и endTime → диапазон "от и до". Нет → точка с дефолтной длительностью. */
  endTime?: string;
  /** Сфера задачи. Управляет цветом блока в календаре. Дефолт — 'none' (серый). */
  category?: TaskCategory;
  /** Источник времени. Дефолт при ручном создании — 'user'. */
  timeSource?: TimeSource;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: string;
  tool_calls?: any[];
  tool_call_id?: string;
  reasoning_content?: string;
  sources?: { title: string; snippet?: string }[];
  planning_data?: {
    questions: {
      id: string;
      question: string;
      options: string[];
    }[];
    answers?: Record<string, string>;
    plan?: {
      title: string;
      steps: string[];
    };
    status: 'questionnaire' | 'plan_generated' | 'accepted' | 'rejected';
  };
}

export interface Thread {
  id: string;
  title: string;
  preview: string;
  messages: Message[];
  createdAt: number;
  updatedAt?: number;
  source?: 'thread' | 'text' | 'мысль' | 'заметка' | 'skill';
  label?: string;
  summary?: string;
  is_meaningful?: boolean | null;
}

export interface Settings {
  agent: boolean;
  confirm: boolean;
  notifs: boolean;
  name?: string;
  avatar?: string;
  email?: string;
  instructions?: string;
}

export interface LocalUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  provider?: 'local' | 'google' | 'email';
  email?: string;
  avatarUrl?: string;
}

export interface LocalProfile {
  settings: Settings;
  onboarding_complete: boolean;
  updated_at: string;
}

export type Screen = 'ob' | 'dash' | 'ai' | 'threads' | 'settings' | 'cal' | 'today';
