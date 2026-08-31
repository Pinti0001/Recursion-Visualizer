// Node.js test script for the Recursion Visualizer interpreter
// Run: node test_interpreter.js

// ── Load modules into global scope (simulate browser <script> tags) ──
const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

// Concatenate and eval all source files together so globals are shared
const allSrc = [
  fs.readFileSync(path.join(baseDir, 'js/lexer.js'), 'utf8'),
  fs.readFileSync(path.join(baseDir, 'js/parser.js'), 'utf8'),
  fs.readFileSync(path.join(baseDir, 'js/interpreter.js'), 'utf8'),
].join('\n');

// eslint-disable-next-line no-eval
eval(allSrc);

// ── Test helper ───────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message || e}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'Not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function runCode(code) {
  return runPipeline(code, { maxDepth: 200, maxEvents: 5000 });
}

// ── Fibonacci Tests ───────────────────────────────────────────

console.log('\n── Fibonacci ─────────────────────────────────────────');

const fibCode = `
int fib(int n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}
int main() {
    int r0 = fib(0);
    int r1 = fib(1);
    int r2 = fib(2);
    int r3 = fib(3);
    int r4 = fib(4);
    int r5 = fib(5);
    printf("fib(0)=%d fib(1)=%d fib(2)=%d fib(3)=%d fib(4)=%d fib(5)=%d\\n", r0, r1, r2, r3, r4, r5);
    return 0;
}`;

test('Fibonacci pipeline succeeds', () => {
  const res = runCode(fibCode);
  assert(res.success, `Failed: ${res.error?.message}`);
});

test('Fibonacci output correct', () => {
  const res = runCode(fibCode);
  assert(res.success);
  const expected = 'fib(0)=0 fib(1)=1 fib(2)=1 fib(3)=2 fib(4)=3 fib(5)=5\n';
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.output, expected, 'Output mismatch');
});

test('Fibonacci has FUNCTION_CALL events', () => {
  const res = runCode(fibCode);
  assert(res.success);
  const calls = res.events.filter(e => e.type === 'FUNCTION_CALL' && e.fn === 'fib');
  // fib(0..5) - total calls for fib(5) = 15, plus individual calls for r0-r4 in main
  assert(calls.length > 10, `Expected >10 fib calls, got ${calls.length}`);
  console.log(`    fib() was called ${calls.length} times total`);
});

test('Fibonacci PROGRAM_START is first event', () => {
  const res = runCode(fibCode);
  assert(res.success);
  assertEqual(res.events[0].type, 'PROGRAM_START');
});

test('Fibonacci PROGRAM_END is last event', () => {
  const res = runCode(fibCode);
  assert(res.success);
  const last = res.events[res.events.length - 1];
  assertEqual(last.type, 'PROGRAM_END');
});

test('Fibonacci snapshots match events count', () => {
  const res = runCode(fibCode);
  assert(res.success);
  assertEqual(res.events.length, res.snapshots.length, 'Events/snapshots count mismatch');
});

// ── Simple Fibonacci for tree verification ──────────────────

const simpleFib = `
int fib(int n) {
    if (n < 2) { return n; }
    return fib(n - 1) + fib(n - 2);
}
int main() {
    int r = fib(3);
    printf("%d\\n", r);
    return 0;
}`;

test('fib(3) tree has correct structure', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const last = res.snapshots[res.snapshots.length - 1];
  const nodes = Object.values(last.nodes);
  const fibNodes = nodes.filter(n => n.fn === 'fib');
  // fib(3): calls fib(2) and fib(1)
  // fib(2): calls fib(1) and fib(0)
  // Total fib nodes = 5 (3,2,1,1,0)
  assertEqual(fibNodes.length, 5, `Expected 5 fib nodes, got ${fibNodes.length}`);
});

test('fib(3) = 2 final output', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.output, '2\n', 'Wrong output for fib(3)');
});

// ── Call Stack Push/Pop ───────────────────────────────────────

console.log('\n── Call Stack ────────────────────────────────────────');

test('Stack is empty after program ends', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.stack.length, 0, `Expected empty stack, got ${last.stack.length} frames`);
});

test('Stack depth increases on calls', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  // Find deepest stack
  const maxDepth = Math.max(...res.snapshots.map(s => s.stack.length));
  assert(maxDepth >= 4, `Expected stack depth >=4, got ${maxDepth}`);
  console.log(`    Max stack depth: ${maxDepth}`);
});

test('FUNCTION_RETURN events match FUNCTION_CALL events', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const calls   = res.events.filter(e => e.type === 'FUNCTION_CALL').length;
  const returns = res.events.filter(e => e.type === 'FUNCTION_RETURN').length;
  assertEqual(calls, returns, `Calls (${calls}) != Returns (${returns})`);
});

// ── Factorial ─────────────────────────────────────────────────

console.log('\n── Factorial ─────────────────────────────────────────');

const factCode = `
int factorial(int n) {
    if (n <= 1) { return 1; }
    return n * factorial(n - 1);
}
int main() {
    printf("%d\\n", factorial(6));
    return 0;
}`;

test('factorial(6) = 720', () => {
  const res = runCode(factCode);
  assert(res.success, `Failed: ${res.error?.message}`);
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.output, '720\n');
});

test('Factorial makes 6 recursive calls', () => {
  const res = runCode(factCode);
  assert(res.success);
  const calls = res.events.filter(e => e.type === 'FUNCTION_CALL' && e.fn === 'factorial');
  assertEqual(calls.length, 6, `Expected 6 factorial calls, got ${calls.length}`);
});

// ── GCD ───────────────────────────────────────────────────────

console.log('\n── GCD ───────────────────────────────────────────────');

const gcdCode = `
int gcd(int a, int b) {
    if (b == 0) { return a; }
    return gcd(b, a % b);
}
int main() {
    printf("%d\\n", gcd(48, 18));
    return 0;
}`;

test('gcd(48, 18) = 6', () => {
  const res = runCode(gcdCode);
  assert(res.success, `Failed: ${res.error?.message}`);
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.output, '6\n');
});

// ── Tower of Hanoi ────────────────────────────────────────────

console.log('\n── Tower of Hanoi ────────────────────────────────────');

const hanoiCode = `
void hanoi(int n, int from, int to, int via) {
    if (n == 1) {
        printf("Disk 1: %d -> %d\\n", from, to);
        return;
    }
    hanoi(n - 1, from, via, to);
    printf("Disk %d: %d -> %d\\n", n, from, to);
    hanoi(n - 1, via, to, from);
}
int main() {
    hanoi(3, 1, 3, 2);
    return 0;
}`;

test('Hanoi(3) produces 7 moves', () => {
  const res = runCode(hanoiCode);
  assert(res.success, `Failed: ${res.error?.message}`);
  const last = res.snapshots[res.snapshots.length - 1];
  const lines = last.output.trim().split('\n');
  assertEqual(lines.length, 7, `Expected 7 moves, got ${lines.length}\nOutput:\n${last.output}`);
});

// ── Error Handling ─────────────────────────────────────────────

console.log('\n── Error Handling ────────────────────────────────────');

test('Missing main() returns error', () => {
  const res = runCode(`int foo(int n) { return n; }`);
  assert(!res.success);
  assert(res.error.message.includes('main'), `Wrong error: ${res.error.message}`);
});

test('Undefined variable returns error', () => {
  const res = runCode(`int main() { printf("%d\\n", x); return 0; }`);
  assert(!res.success);
  assert(res.error.message.includes("'x'"), `Wrong error: ${res.error.message}`);
});

test('Lexer handles char literal', () => {
  const res = runCode(`int main() { int x = 'A'; printf("%d\\n", x); return 0; }`);
  assert(res.success, `Failed: ${res.error?.message}`);
  const last = res.snapshots[res.snapshots.length - 1];
  assertEqual(last.output, '65\n');
});

// ── Time-travel / Snapshots ───────────────────────────────────

console.log('\n── Time-travel / Snapshots ───────────────────────────');

test('Snapshot at step 0 has PROGRAM_START state', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  assertEqual(res.events[0].type, 'PROGRAM_START');
  assertEqual(res.snapshots[0].output, '');
  assertEqual(res.snapshots[0].stack.length, 0);
});

test('Output grows monotonically across snapshots', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  let prevLen = 0;
  for (const snap of res.snapshots) {
    assert(snap.output.length >= prevLen,
      `Output shrank: ${prevLen} -> ${snap.output.length}`);
    prevLen = snap.output.length;
  }
});

test('All snapshots have valid structure', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  for (let i = 0; i < res.snapshots.length; i++) {
    const s = res.snapshots[i];
    assert(Array.isArray(s.stack), `Snapshot ${i}: stack is not array`);
    assert(typeof s.nodes === 'object', `Snapshot ${i}: nodes is not object`);
    assert(typeof s.output === 'string', `Snapshot ${i}: output is not string`);
  }
});

// ── Condition checks ──────────────────────────────────────────

console.log('\n── Condition Checks ──────────────────────────────────');

test('CONDITION_CHECK events have correct result field', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const conds = res.events.filter(e => e.type === 'CONDITION_CHECK');
  assert(conds.length > 0, 'Expected at least one CONDITION_CHECK');
  // All conditions should have a boolean result
  for (const c of conds) {
    assert(typeof c.result === 'boolean', `Condition result should be boolean, got ${typeof c.result}`);
  }
  console.log(`    ${conds.length} condition checks found`);
});

test('Base cases have n < 2 = true condition', () => {
  const res = runCode(simpleFib);
  assert(res.success);
  const trueConditions = res.events.filter(e => e.type === 'CONDITION_CHECK' && e.result === true);
  const falseConditions = res.events.filter(e => e.type === 'CONDITION_CHECK' && e.result === false);
  assert(trueConditions.length > 0, 'Expected true conditions (base cases)');
  assert(falseConditions.length > 0, 'Expected false conditions (recursive cases)');
  console.log(`    True: ${trueConditions.length}, False: ${falseConditions.length}`);
});

// ── Summary ───────────────────────────────────────────────────

console.log(`\n${'═'.repeat(54)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED!');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED ✓');
}
