export interface SubTask {
  id: string;
  name: string;
  done: boolean;
}

export interface Task {
  id: string;
  name: string;
  time: string;
  date: string;
  done: boolean;
  threadId?: string;
  type?: 'regular' | 'thought';
  subtasks?: SubTask[];
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: string;
  tool_calls?: any[];
  tool_call_id?: string;
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
}

export interface Settings {
  agent: boolean;
  confirm: boolean;
  notifs: boolean;
  name?: string;
  avatar?: string;
}

export type Screen = 'ob' | 'dash' | 'ai' | 'threads' | 'settings';
