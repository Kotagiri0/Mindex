import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isMobileDevice, useVoiceInput } from '../../../src/lib/useVoiceInput';
import { installDomStubs } from '../../helpers/dom';

test('detects mobile devices from user agent', () => {
  installDomStubs();
  (globalThis as any).navigator.userAgent = 'iPhone';
  assert.equal(isMobileDevice(), true);
});

test('treats touch-enabled Mac as mobile', () => {
  installDomStubs();
  (globalThis as any).navigator.userAgent = 'Mac';
  (globalThis as any).navigator.maxTouchPoints = 2;
  assert.equal(isMobileDevice(), true);
});

test('useVoiceInput exposes idle state on first render', () => {
  installDomStubs();
  let hookValue: any = null;

  function Consumer() {
    hookValue = useVoiceInput(() => {});
    return React.createElement('div');
  }

  renderToStaticMarkup(React.createElement(Consumer));
  assert.equal(hookValue.state, 'idle');
  assert.equal(typeof hookValue.startRecording, 'function');
});
