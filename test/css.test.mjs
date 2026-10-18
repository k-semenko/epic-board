import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A stray selector without a body silently swallows the next rule; this caught the lost icon gaps.
test('style.css has balanced braces and no orphan selectors', () => {
  const css = readFileSync('server/page/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let pending = '';
  for (const ch of css) {
    if (ch === '{') {
      depth++;
      pending = '';
    } else if (ch === '}') {
      depth--;
      assert.ok(depth >= 0, 'unbalanced }');
      pending = '';
    } else if (depth === 0) pending += ch;
    else if (ch === ';') pending = '';
  }
  assert.equal(depth, 0);
  assert.match(css, /\.wrap \{[^}]*max-width: 1300px/);
  assert.match(css, /\.topbar-in \{[^}]*max-width: 1300px/);
  assert.match(css, /\.overview \{[^}]*height: 248px/);
  assert.match(css, /#map > \.overview \{[^}]*flex: 0 0 248px/);
  assert.match(css, /#map > \.overview \{[^}]*overflow: hidden/);
  assert.match(css, /#map > \.overview\.has-side \{[^}]*flex: 0 0 400px/);
  assert.match(css, /#map > \.overview\.has-side \{[^}]*height: 400px/);
  assert.match(css, /#map > \.overview\.has-side \{[^}]*min-height: 400px/);
  assert.match(css, /#map > \.overview\.has-side \{[^}]*overflow: hidden/);
  assert.match(css, /#map > \.overview \.ov-scroll \{[^}]*min-height: 0/);
  assert.match(css, /#map > \.overview\.has-side\.map-h-s \{[^}]*height: 248px/);
  assert.match(css, /#map > \.overview\.has-side\.map-h-m \{[^}]*height: 400px/);
  assert.match(css, /#map > \.overview\.has-side\.map-h-l \{[^}]*height: calc\(100dvh - var\(--map-l-cut, 128px\)\)/);
  assert.match(css, /\.tl-svg:has\(\.tl-node\.selected\) \.tl-node:not\(\.selected\)[^{]*\{[^}]*opacity: \.5/);
  assert.match(css, /\.ov-svg:has\(\.ov-card\.selected\) \.tl-edge:not\(\.lit\)[^{]*\{[^}]*opacity: \.16/);
  assert.match(css, /\.ov-svg:has\(\.ov-card\.selected\) \.tl-edge\.lit[^{]*\{[^}]*stroke-width: 2\.1/);
  assert.match(css, /\.ov-info \{[^}]*top: 9px/);
  assert.match(css, /\.ov-info \{[^}]*right: 8px/);
  assert.match(css, /\.ov-info \{[^}]*width: 20px/);
  assert.match(css, /\.ov-card \.chip,\s*\.ov-info \{[^}]*height: 20px/);
  assert.doesNotMatch(css, /\.ov-info \{[^}]*bottom:/);
  assert.doesNotMatch(css, /#map > \.overview\.has-side \{[^}]*max-height: 55%/);
  assert.equal(pending.trim(), '', `text after the last rule: ${pending.trim()}`);
  for (const chunk of css.split('}')) {
    const head = chunk.split('{')[0];
    if (!chunk.includes('{')) continue;
    const lines = head.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, -1)) {
      if (!line.startsWith('@')) assert.ok(line.endsWith(','), `orphan selector line: «${line}» before «${lines.at(-1)}»`);
    }
  }
});
