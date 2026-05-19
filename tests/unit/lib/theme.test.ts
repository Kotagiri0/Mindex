import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, useTheme } from '../../../src/lib/theme';
import { installDomStubs } from '../../helpers/dom';

test('ThemeProvider exposes light theme via context', () => {
  installDomStubs();
  let themeValue: any = null;

  function Consumer() {
    themeValue = useTheme();
    return React.createElement('div');
  }

  renderToStaticMarkup(
    React.createElement(ThemeProvider, null, React.createElement(Consumer))
  );

  assert.equal(themeValue.theme, 'light');
  assert.equal(typeof themeValue.toggleTheme, 'function');
});

test('useTheme throws outside provider', () => {
  installDomStubs();
  function BadConsumer() {
    useTheme();
    return React.createElement('div');
  }

  assert.throws(() => renderToStaticMarkup(React.createElement(BadConsumer)), /useTheme/);
});
