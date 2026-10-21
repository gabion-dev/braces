'use strict';

require('mocha');
const assert = require('assert').strict;
const braces = require('..');
const parse = require('../lib/parse');
const { MAX_DEPTH } = require('../lib/constants');

const nested = (depth, open = '{a,', close = '}') => open.repeat(depth) + 'b' + close.repeat(depth);
const tooDeep = /^Input nesting depth \(\d+\), exceeds max depth \(100\)$/;
const tooDeepAst = /^AST nesting depth exceeds max depth \(100\)$/;

// Calls `fn` with roughly `frames` frames already on the stack, as a deeply
// nested caller (a linter rule inside a plugin inside a runner) would.
const fromDeepStack = (frames, fn) => {
  const descend = n => (n === 0 ? fn() : descend(n - 1));
  return descend(frames);
};

// An AST nested `depth` blocks below the root, built without the parser.
const deepAst = depth => {
  const root = { type: 'root', nodes: [] };
  let block = root;
  const closes = [];
  for (let i = 0; i < depth; i++) {
    const brace = { type: 'brace', commas: 1, ranges: 0, open: true, close: true, parent: block, nodes: [] };
    brace.nodes.push({ type: 'open', value: '{', parent: brace });
    block.nodes.push(brace);
    closes.push(brace);
    block = brace;
  }
  block.nodes.push({ type: 'text', value: 'a', parent: block });
  for (const brace of closes) brace.nodes.push({ type: 'close', value: '}', parent: brace });
  return root;
};

describe('nesting depth limit', () => {
  it('should accept nesting up to the limit in every mode', () => {
    const input = nested(MAX_DEPTH);
    assert.doesNotThrow(() => parse(input));
    assert.equal(braces(input).length, 1);
    assert.equal(braces(input, { expand: true }).length, MAX_DEPTH + 1);
    assert.equal(braces.stringify(input), input);
  });

  it('should refuse braces nested past the limit with a SyntaxError', () => {
    const input = nested(MAX_DEPTH + 1);
    assert.throws(() => parse(input), { name: 'SyntaxError', message: tooDeep });
    assert.throws(() => braces(input), { name: 'SyntaxError', message: tooDeep });
    assert.throws(() => braces(input, { expand: true }), { name: 'SyntaxError', message: tooDeep });
    assert.throws(() => braces.stringify(input), { name: 'SyntaxError', message: tooDeep });
  });

  it('should count parentheses and unbalanced blocks as nesting', () => {
    assert.throws(() => braces(nested(MAX_DEPTH + 1, '(', ')')), { name: 'SyntaxError', message: tooDeep });
    assert.throws(() => braces('{'.repeat(MAX_DEPTH + 1) + 'a'), { name: 'SyntaxError', message: tooDeep });
    assert.throws(() => braces('({'.repeat((MAX_DEPTH + 2) / 2) + 'a'), { name: 'SyntaxError', message: tooDeep });
  });

  it('should not count escaped, quoted or bracketed braces as nesting', () => {
    const escaped = '\\{'.repeat(MAX_DEPTH + 1) + 'a';
    assert.deepEqual(braces(escaped), ['{'.repeat(MAX_DEPTH + 1) + 'a']);
    const quoted = '"' + '{'.repeat(MAX_DEPTH + 1) + '"';
    assert.doesNotThrow(() => braces(quoted));
    const bracketed = '[' + '{'.repeat(MAX_DEPTH + 1) + ']';
    assert.doesNotThrow(() => braces(bracketed));
  });

  it('should refuse the deepest input within maxLength before it reaches the walkers', () => {
    const input = nested(4999, '{', '}');
    for (const run of [() => braces(input), () => braces(input, { expand: true }), () => braces.stringify(input)]) {
      assert.throws(() => fromDeepStack(2000, run), { name: 'SyntaxError', message: tooDeep });
    }
  });

  it('should expand input at the limit from a deep caller stack', () => {
    const input = nested(MAX_DEPTH);
    assert.equal(fromDeepStack(5000, () => braces(input, { expand: true })).length, MAX_DEPTH + 1);
  });

  it('should refuse an AST nested past the limit with a RangeError', () => {
    assert.doesNotThrow(() => braces.compile(deepAst(MAX_DEPTH)));
    assert.doesNotThrow(() => braces.expand(deepAst(MAX_DEPTH)));
    assert.doesNotThrow(() => braces.stringify(deepAst(MAX_DEPTH)));
    assert.throws(() => braces.compile(deepAst(MAX_DEPTH + 1)), { name: 'RangeError', message: tooDeepAst });
    assert.throws(() => braces.expand(deepAst(MAX_DEPTH + 1)), { name: 'RangeError', message: tooDeepAst });
    assert.throws(() => braces.stringify(deepAst(MAX_DEPTH + 1)), { name: 'RangeError', message: tooDeepAst });
  });

  it('should refuse a cyclic AST instead of recursing forever', () => {
    const ast = deepAst(1);
    ast.nodes[0].nodes.push(ast);
    assert.throws(() => braces.compile(ast), { name: 'RangeError', message: tooDeepAst });
    assert.throws(() => braces.stringify(ast), { name: 'RangeError', message: tooDeepAst });
  });
});
