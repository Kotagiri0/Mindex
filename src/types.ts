export interface Task {
  id: string;
  name: string;
  time: string;
  date: string;
  done: boolean;
  threadId?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: string;
  tool_calls?: any[];
  tool_call_id?: string;
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
