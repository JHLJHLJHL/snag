// The snag theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in snag.settings.json and the generated snag.settings.ts;
// change them with `astryx experimental theme editor set snag ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {snagSettings} from './snag.settings';

const fontSizeTokens = Object.fromEntries([
    ...['4xs', '3xs', '2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl']
      .map(size => `--font-size-${size}`),
    ...['heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
      'body', 'large', 'label', 'code', 'supporting', 'display-1', 'display-2', 'display-3']
      .map(type => `--text-${type}-size`),
  ].map(token => [token, '0.8125rem']));

const dropdownTypography = {
  fontSize: 'var(--snag-font-size-dropdown)',
  '--text-label-size': 'var(--snag-font-size-dropdown)',
  '--text-body-size': 'var(--snag-font-size-dropdown)',
  '--text-supporting-size': 'var(--snag-font-size-dropdown)',
};

export const snagTheme = defineTheme({
  extends: snagSettings,
  name: 'snag',
  tokens: fontSizeTokens,
  localTokens: {
    '--snag-sidebar-width': '13rem',
    '--snag-settings-width': '15.2rem',
    '--snag-font-size-brand': '1rem',
    '--snag-font-size-section': '0.875rem',
    '--snag-font-size-media': '0.6875rem',
    '--snag-font-size-completed': '0.625rem',
    '--snag-font-size-waiting-status': '0.6875rem',
    '--snag-font-size-dropdown': '0.75rem',
    '--snag-font-size-signature': '0.75rem',
    '--snag-icon-size-status': '0.625rem',
    '--snag-icon-size-reorder': 'calc(var(--spacing-4) * 0.7)',
    '--snag-checkbox-size': 'calc(var(--spacing-6) * 0.7)',
    '--snag-checkbox-glyph-size': 'calc(var(--spacing-4) * 0.7)',
  },
  adaptations: {
    rules: [{
      when: {pointer: 'coarse', width: {below: 'lg'}},
      value: {tokens: fontSizeTokens},
    }],
  },
  components: {
    'side-nav': {base: {width: 'var(--snag-sidebar-width)'}},
    text: {
      'type:brand': {fontSize: 'var(--snag-font-size-brand)', fontStyle: 'italic'},
      'type:section-title': {fontSize: 'var(--snag-font-size-section)'},
      'type:completed-status': {fontSize: 'var(--snag-font-size-completed)', lineHeight: '1.2'},
      'type:waiting-status': {fontSize: 'var(--snag-font-size-waiting-status)'},
      'type:signature': {fontSize: 'var(--snag-font-size-signature)', lineHeight: '1.5'},
    },
    heading: {
      'type:compact': {fontSize: 'var(--text-body-size)'},
      'type:section-title': {fontSize: 'var(--snag-font-size-section)'},
    },
    'side-nav-section': {base: {'--text-supporting-size': 'var(--snag-font-size-section)'}},
    badge: {base: {'--text-supporting-size': 'var(--text-body-size)'}},
    'checkbox-indicator': {base: {width: 'var(--snag-checkbox-size)', height: 'var(--snag-checkbox-size)'}},
    'checkbox-indicator-check': {base: {width: 'var(--snag-checkbox-glyph-size)', height: 'var(--snag-checkbox-glyph-size)'}},
    'checkbox-indicator-dash': {base: {width: 'var(--snag-checkbox-glyph-size)', height: 'var(--snag-checkbox-glyph-size)'}},
    selector: {base: dropdownTypography},
    'selector-popup': {base: dropdownTypography},
    'selector-option-row': {base: dropdownTypography},
    'segmented-control-item': {
      base: {paddingInline: 'var(--spacing-0-5)'},
      'size:sm': {fontSize: 'var(--snag-font-size-media)'},
    },
  },
});
