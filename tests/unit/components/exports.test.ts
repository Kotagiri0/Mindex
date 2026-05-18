import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import App from '../../../src/App';
import AIChat from '../../../src/components/AIChat';
import AddTaskModal from '../../../src/components/AddTaskModal';
import BottomNav from '../../../src/components/BottomNav';
import Calendar from '../../../src/components/Calendar';
import Dashboard from '../../../src/components/Dashboard';
import DesktopApp from '../../../src/components/DesktopApp';
import EditTaskModal from '../../../src/components/EditTaskModal';
import LocalAuth from '../../../src/components/LocalAuth';
import MysliThinking from '../../../src/components/MysliThinking';
import NoteEditor from '../../../src/components/NoteEditor';
import NoteView from '../../../src/components/NoteView';
import Onboarding from '../../../src/components/Onboarding';
import Settings from '../../../src/components/Settings';
import TaskDetailPanel from '../../../src/components/TaskDetailPanel';
import TaskItem from '../../../src/components/TaskItem';
import Threads from '../../../src/components/Threads';
import TodayMobile from '../../../src/components/TodayMobile';

beforeEach(() => {
  (globalThis as any).window = undefined;
  (globalThis as any).document = undefined;
});

const expectComponent = (value: unknown) => {
  assert.equal(typeof value, 'function');
};

test('App exports a component', () => {
  expectComponent(App);
});

test('AIChat exports a component', () => {
  expectComponent(AIChat);
});

test('AddTaskModal exports a component', () => {
  expectComponent(AddTaskModal);
});

test('BottomNav exports a component', () => {
  expectComponent(BottomNav);
});

test('Calendar exports a component', () => {
  expectComponent(Calendar);
});

test('Dashboard exports a component', () => {
  expectComponent(Dashboard);
});

test('DesktopApp exports a component', () => {
  expectComponent(DesktopApp);
});

test('EditTaskModal exports a component', () => {
  expectComponent(EditTaskModal);
});

test('LocalAuth exports a component', () => {
  expectComponent(LocalAuth);
});

test('MysliThinking exports a component', () => {
  expectComponent(MysliThinking);
});

test('NoteEditor exports a component', () => {
  expectComponent(NoteEditor);
});

test('NoteView exports a component', () => {
  expectComponent(NoteView);
});

test('Onboarding exports a component', () => {
  expectComponent(Onboarding);
});

test('Settings exports a component', () => {
  expectComponent(Settings);
});

test('TaskDetailPanel exports a component', () => {
  expectComponent(TaskDetailPanel);
});

test('TaskItem exports a component', () => {
  expectComponent(TaskItem);
});

test('Threads exports a component', () => {
  expectComponent(Threads);
});

test('TodayMobile exports a component', () => {
  expectComponent(TodayMobile);
});
