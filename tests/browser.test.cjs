const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve('.test-artifacts');
fs.mkdirSync(output, {recursive: true});
const base = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const passed = [];
const errors = [];
let browser;

function watch(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
}
function pass(name) { passed.push(name); console.log(`PASS ${name}`); }
async function text(page, id) { return page.locator(`#${id}`).textContent(); }
async function data(page, key) { return page.locator('body').getAttribute(`data-${key}`); }
async function complete(page) {
  return await data(page, 'playback') === 'complete';
}
async function advanceUntil(page, predicate, message, count = 180) {
  for (let i = 0; i < count; i++) {
    if (await predicate()) return;
    await page.clock.runFor(250);
  }
  throw Error(`Timed out advancing application clock: ${message}; playback=${await data(page, 'playback')}, stage=${await data(page, 'stage')}`);
}
async function finish(page, count = 180) {
  await advanceUntil(page, () => complete(page), 'automatic demonstration completes', count);
}
async function clickMode(page, mode) { await page.locator(`[data-mode="${mode}"]`).click(); }
async function waitManual(page, stage) {
  await advanceUntil(page, async () => {
    const idle = await page.locator('#datapath').getAttribute('data-animating') === 'false';
    return idle && await data(page, 'stage') === String(stage) && await data(page, 'playback') !== 'playing';
  }, `manual stage ${stage} commits`);
}
async function reg(page, index) {
  const locator = page.locator(`#registers [data-register="${index}"]`);
  if (await locator.count()) {
    const value = await locator.getAttribute('data-value');
    if (value !== null) return Number(value);
    const valueNode = locator.locator('.value');
    return Number(await valueNode.textContent());
  }
  // Both register lists are populated from the same architectural snapshot.
  const row = page.locator('#all-registers > div').nth(index);
  return Number(await row.locator('.value').textContent());
}
async function snapshot(page) {
  return page.evaluate(() => Object.fromEntries([
    'step-count', 'pc-value', 'ir-value', 'registers', 'memory', 'log', 'clock-label', 'lock-signal'
  ].map(id => [id, document.getElementById(id)?.textContent])));
}
async function openDetails(page, locator) {
  if (!(await locator.evaluate(node => node.open))) await locator.locator(':scope > summary').click();
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, scroll: document.documentElement.scrollWidth
  }));
  assert(dimensions.scroll <= dimensions.width, `${label}: horizontal overflow ${dimensions.scroll} > ${dimensions.width}`);
}
async function fontSizes(page, projector = false, phone = false) {
  const sizes = await page.evaluate(async () => {
    await document.fonts.ready;
    const style = id => {
      const el = document.getElementById(id);
      const css = getComputedStyle(el);
      return {size: parseFloat(css.fontSize), family: css.fontFamily};
    };
    return {
      explanation: style('explanation'), button: style('next'), code: style('ir-value'),
      value: style('alu-value'), helper: style('section-kicker'),
      stage: parseFloat(getComputedStyle(document.querySelector('[data-stage="0"]')).fontSize),
      fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
      kazakh: document.fonts.check('18px Lab', 'Ә Ғ Қ Ң Ө Ұ Ү І Һ')
    };
  });
  assert(sizes.kazakh, 'loaded font supports the Kazakh text selection');
  assert(sizes.fonts.some(name => /Lab|Sans/i.test(name)), `sans font loaded: ${JSON.stringify(sizes)}`);
  assert(sizes.fonts.some(name => /Code|Mono/i.test(name)), 'local monospace font loaded');
  assert(sizes.explanation.size >= (projector ? 22 : phone ? 16 : 18), `explanation size ${sizes.explanation.size}`);
  assert(sizes.button.size >= (phone ? 16 : 16), `button size ${sizes.button.size}`);
  assert(sizes.code.size >= (phone ? 16 : 18), `code size ${sizes.code.size}`);
  assert(sizes.value.size >= (projector ? 28 : 24), `important value size ${sizes.value.size}`);
  assert(sizes.helper.size >= 14, `helper size ${sizes.helper.size}`);
  assert(sizes.stage >= 16, `stage label size ${sizes.stage}`);
  return sizes;
}

(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  // Keep this first test on the real browser clock: IR cannot update before the signal arrives.
  const motion = await browser.newPage({viewport: {width: 1440, height: 1000}});
  watch(motion);
  await motion.goto(base);
  await motion.locator('#open').click();
  await motion.waitForSelector('#workspace:not([hidden])');
  await motion.waitForSelector('#datapath[data-animating="true"]');
  assert.equal(await text(motion, 'ir-value'), '—', 'Fetch keeps the old IR until arrival');
  await motion.locator('#auto').click();
  assert.equal(await data(motion, 'playback'), 'paused');
  const paused = await snapshot(motion);
  await motion.waitForTimeout(950);
  assert.deepEqual(await snapshot(motion), paused, 'pause freezes both state and running signal');
  await motion.locator('#auto').click();
  await motion.waitForFunction(() => document.body.dataset.playback === 'complete', {timeout: 15000});
  assert.equal(await reg(motion, 10), 12);
  assert.equal(await text(motion, 'next-pc'), '0x00400004');
  await fontSizes(motion);
  await noOverflow(motion, 'normal motion desktop');
  const controlsY = [];
  const position = () => motion.locator('#next').evaluate(node => node.getBoundingClientRect().top + scrollY);
  for (const stage of [0, 1]) {
    await motion.locator(`[data-stage="${stage}"]`).click();
    await motion.waitForSelector('#datapath[data-animating="false"]');
    assert.equal(await data(motion, 'stage'), String(stage));
    controlsY.push(await position());
  }
  await motion.locator('[data-stage="2"]').click();
  assert.equal(await text(motion, 'alu-value'), 'ALU', 'Execute first delivers operands to the ALU');
  assert.equal(await reg(motion, 10), 0);
  await motion.waitForFunction(() => document.getElementById('alu-value').textContent === '12');
  assert.equal(await reg(motion, 10), 0, 'the ALU result appears before register write-back');
  await motion.waitForSelector('#datapath[data-animating="false"]');
  assert.equal(await reg(motion, 10), 12);
  controlsY.push(await position());
  assert(Math.max(...controlsY) - Math.min(...controlsY) <= 2, `controls do not jump between stages: ${controlsY}`);
  await motion.screenshot({path: path.join(output, 'revision-lab-motion-1440.png'), fullPage: true});
  pass('real Fetch/ALU/write-back arrival order, pause/resume, automatic ADD, stable controls and loaded desktop fonts');
  await motion.close();

  // The same application timers execute under Playwright's controlled clock; only visual motion is reduced.
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  watch(page);
  await page.clock.install();
  await page.goto(base);
  await page.focus('#open');
  await page.keyboard.press('Enter');
  await advanceUntil(page, async () => page.locator('#workspace').isVisible(), 'keyboard opens chip');
  await page.selectOption('#speed', '1000');
  await finish(page);
  assert.equal(await reg(page, 10), 12);
  pass('keyboard opens chip and automatic ADD completes with reduced motion');

  for (const stage of [0, 1, 2]) {
    await page.locator(`[data-stage="${stage}"]`).click();
    await waitManual(page, stage);
    assert.equal(await data(page, 'stage'), String(stage));
    assert.equal(await text(page, 'ir-value'), '0x01095020');
    assert.equal(await reg(page, 10), stage === 2 ? 12 : 0);
    if (stage === 1) {
      await page.locator('#active-detail [data-field="1"]').click();
      assert.match(await text(page, 'field-info'), /01000₂ = 8 → \$t0 → 7/);
      assert.match(await text(page, 'explanation'), /01000₂ = 8 → \$t0 → 7/);
    }
  }
  await page.locator('#back').click();
  assert.equal(await data(page, 'stage'), '1');
  assert.equal(await reg(page, 10), 0);
  await page.locator('#restart').click();
  await finish(page);
  assert.equal(await reg(page, 10), 12);
  pass('all three stage buttons restore valid prerequisites, field meanings, Back and replay');

  const examples = [
    ['negative', 10, 4], ['memory', 9, 12], ['branch', 11, 2], ['jump', 11, 2]
  ];
  for (const [name, dest, value] of examples) {
    await page.selectOption('#example', name);
    await finish(page);
    assert.equal(await reg(page, dest), value, name);
    assert(await page.locator('#machine-error').isHidden(), `${name} has no error`);
  }
  assert.match(await text(page, 'trace-addresses'), /0x00400000.*0x00400004.*0x0040000C/s);
  pass('all successful prepared experiments autoplay, including memory and branch/jump delay slots');

  await page.selectOption('#example', 'overflow');
  await finish(page);
  assert.equal(await data(page, 'stage'), '2');
  assert(await page.locator('[data-node="alu"]').evaluate(node => node.classList.contains('lit') || node.classList.contains('active')));
  assert.match((await text(page, 'alu-detail')) + (await text(page, 'alu-value')), /2147483648/);
  assert.match(await text(page, 'operands'), /2147483647/);
  assert.match((await text(page, 'operand-names')) + (await text(page, 'operands')), /(?:immediate|imm|Immediate).*1|1.*(?:immediate|imm|Immediate)/);
  assert.equal(await reg(page, 10), 0);
  assert.match(await text(page, 'machine-error'), /Нәтиже 32 биттік таңбалы санға сыймайды.*Регистрге жазу бұғатталды/s);
  assert.match(await text(page, 'log'), /EXECUTE.*ҚАТЕ/s);
  assert(await page.locator('#next').isDisabled());
  await page.screenshot({path: path.join(output, 'revision-overflow-1440.png'), fullPage: true});
  await page.locator('#back').click();
  assert.equal(await data(page, 'stage'), '1');
  assert(await page.locator('#machine-error').isHidden());
  await page.locator('#restart').click();
  await finish(page);
  assert.equal(await reg(page, 10), 0);
  pass('overflow is an Execute/ALU event with raw calculation, one warning, no write and working Back/restart');

  await page.selectOption('#example', 'add');
  await finish(page);
  await openDetails(page, page.locator('#builder'));
  await page.fill('#hex-input', '0xFFFFFFFF');
  await page.locator('#hex-form button').click();
  assert.match(await text(page, 'input-error'), /Қолдау/);
  await page.fill('#hex-input', '0x01095020');
  await page.locator('#hex-form button').click();
  await finish(page);
  assert.equal(await reg(page, 10), 12);
  await page.selectOption('#operation', 'addi');
  await page.selectOption('#rs', '8');
  await page.selectOption('#rt', '10');
  await page.fill('#a-value', '7');
  await page.fill('#b-value', '0');
  await page.fill('#immediate', '-3');
  await page.locator('#build-form button').click();
  await finish(page);
  assert.equal(await reg(page, 10), 4);
  await page.selectOption('#operation', 'lw');
  await page.selectOption('#rs', '16');
  await page.selectOption('#rt', '8');
  await page.fill('#a-value', '4096');
  await page.fill('#b-value', '7');
  await page.fill('#immediate', '2');
  await page.locator('#build-form button').click();
  await finish(page);
  assert.match(await text(page, 'machine-error'), /тураланбаған/);
  assert.equal(await reg(page, 8), 7);
  pass('constructor, signed immediate, hex validation and unaligned memory remain functional');

  await clickMode(page, 'lock');
  await page.fill('#lock-code', '42');
  await page.locator('#lock-form button[type="submit"]').click();
  await finish(page);
  assert.equal(await text(page, 'lock-state'), 'Құлып ашық');
  assert.match(await text(page, 'lock-signal'), /OUT = 1/);
  await page.locator('#back').click();
  assert.equal(await text(page, 'lock-state'), 'Құлып жабық');
  await page.locator('#next').click();
  await waitManual(page, 2);
  assert.equal(await text(page, 'lock-state'), 'Құлып ашық');
  await page.locator('#code17').click();
  await finish(page);
  assert.equal(await text(page, 'lock-state'), 'Құлып жабық');
  assert.match(await text(page, 'lock-signal'), /OUT = 0/);
  await page.locator('#compare').click();
  assert.match(await text(page, 'comparison'), /OUT = 1/);
  assert.match(await text(page, 'comparison'), /OUT = 0/);
  pass('42 and 17 keypad demos autoplay through the shared CPU, comparison and output rollback work');

  await clickMode(page, 'core');
  await page.selectOption('#core-speed', '1000');
  const collectRoute = async () => {
    const states = [];
    for (let i = 0; i < 180; i++) {
      states.push(await page.locator('#core-path').evaluate(node => ({
        active: [...node.querySelectorAll('.active')].map(n => n.dataset.coreNode),
        explanation: document.getElementById('core-explanation').textContent
      })));
      if (await complete(page)) return states;
      await page.clock.runFor(250);
    }
    throw Error('core route did not complete');
  };
  const hit = await collectRoute();
  assert(hit.some(state => state.active.includes('l1')));
  assert(hit.some(state => state.active.includes('decoder')));
  assert(!hit.some(state => state.active.includes('lower')));
  await page.selectOption('#cache', 'miss');
  const miss = await collectRoute();
  assert(miss.some(state => state.active.includes('lower')));
  assert(miss.some(state => /жауап|қайта|қайту/.test(state.explanation)), 'miss includes returning memory response');
  assert(miss.some(state => state.active.includes('decoder')));
  await page.locator('#core-replay').click();
  await page.locator('#core-auto').click();
  const corePause = await text(page, 'core-explanation');
  await page.clock.runFor(2500);
  assert.equal(await text(page, 'core-explanation'), corePause);
  await page.locator('#core-auto').click();
  await finish(page);
  await page.locator('#core-back').click();
  assert.equal(await data(page, 'playback'), 'paused');
  await page.locator('#core-next').click();
  await finish(page);
  assert(await page.locator('[data-core-node="wb"]').evaluate(node => node.classList.contains('active')));
  pass('cache hit/miss take distinct animated routes including lower-memory return; replay and pause work');

  await clickMode(page, 'pipeline');
  await page.selectOption('#pipeline-speed', '1000');
  const clocks = new Set();
  for (let i = 0; i < 100; i++) {
    clocks.add(await text(page, 'clock-label'));
    if (await complete(page)) break;
    await page.clock.runFor(250);
  }
  assert.equal(await text(page, 'clock-label'), 'ТАКТ 6 / 6');
  for (let i = 1; i <= 6; i++) assert(clocks.has(`ТАКТ ${i} / 6`), `pipeline visits clock ${i}`);
  assert.match(await text(page, 'pipeline-explanation'), /6/);
  assert(await page.locator('#pipeline-next').isDisabled());
  await page.locator('#pipeline-reset').click();
  await page.locator('#pipeline-auto').click();
  const clockPause = await text(page, 'clock-label');
  await page.clock.runFor(2000);
  assert.equal(await text(page, 'clock-label'), clockPause);
  await page.locator('#pipeline-next').click();
  assert.match(await text(page, 'clock-label'), /ТАКТ 2/);
  await page.locator('#pipeline-back').click();
  assert.equal(await text(page, 'clock-label'), 'ТАКТ 1 / 6');
  await page.locator('#pipeline-next').click();
  assert.equal(await text(page, 'clock-label'), 'ТАКТ 2 / 6');
  pass('independent pipeline lanes autoplay through six clocks, hold final state and support replay/manual controls');

  await clickMode(page, 'defense');
  await finish(page);
  await page.locator('#defense-next').click();
  assert(await page.locator('#core-view').isVisible());
  await finish(page);
  await page.locator('#defense-next').click();
  await advanceUntil(page, () => page.locator('#prediction').isVisible(), 'code42 defense prediction');
  assert.equal(await data(page, 'stage'), '1');
  assert.equal(await reg(page, 8), 42);
  await page.locator('#reveal').click();
  await finish(page);
  assert.match(await text(page, 'lock-signal'), /OUT = 1/);
  await page.locator('#defense-next').click();
  await advanceUntil(page, () => page.locator('#prediction').isVisible(), 'code17 defense prediction');
  await page.locator('#reveal').click();
  await finish(page);
  assert.match(await text(page, 'lock-signal'), /OUT = 0/);
  assert.match(await text(page, 'trace-addresses'), /0x00400000.*0x00400004.*0x00400008.*0x00400010/s);
  assert(!/0x0040000C/.test(await text(page, 'trace-addresses')));
  pass('four defense sections autoplay and pause before bne for both predictions');

  await clickMode(page, 'lab');
  await page.selectOption('#example', 'add');
  await page.evaluate(() => {
    for (const stage of [0, 1, 2, 2, 2]) document.querySelector(`[data-stage="${stage}"]`).click();
  });
  await advanceUntil(page, async () => await page.locator('#datapath').getAttribute('data-animating') === 'false', 'rapid manual actions settle');
  assert.equal(await reg(page, 10), 12);
  await clickMode(page, 'core');
  await clickMode(page, 'pipeline');
  await clickMode(page, 'lab');
  await page.selectOption('#example', 'negative');
  await finish(page);
  assert.equal(await reg(page, 10), 4);
  const afterSwitch = await snapshot(page);
  await page.clock.runFor(8000);
  assert.deepEqual(await snapshot(page), afterSwitch);
  pass('rapid repeat presses and switching running demos leave one consistent state with no old timers');

  // Open every auxiliary panel rather than only testing the main diagram.
  for (const detail of await page.locator('#workspace details').all()) {
    if (await detail.isVisible()) await openDetails(page, detail);
  }
  await page.locator('#trace-toggle').click();
  assert(await page.locator('#all-registers').isVisible());
  assert(await page.locator('#signals').isVisible());
  assert(await page.locator('#instruction-memory').isVisible());
  assert(await page.locator('.sources a').first().isVisible());
  await noOverflow(page, 'all auxiliary panels desktop');
  pass('builder, all registers, instruction memory, controls/signals, trace and sources panels open readably');

  const measurements = {};
  for (const viewport of [
    {width: 1440, height: 1000}, {width: 1280, height: 720, projector: true},
    {width: 390, height: 844}, {width: 320, height: 800}
  ]) {
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.goto(`${base}/#home`);
    await advanceUntil(page, () => page.locator('#home').isVisible(), 'home route visible');
    await noOverflow(page, `hero ${viewport.width}`);
    await page.screenshot({path: path.join(output, `revision-home-${viewport.width}.png`), fullPage: true});
    await page.locator('#open').click();
    await advanceUntil(page, () => page.locator('#workspace').isVisible(), 'open at target viewport');
    await finish(page);
    if (viewport.projector) await page.locator('#presentation').click();
    measurements[viewport.width] = await fontSizes(page, !!viewport.projector, viewport.width < 500);
    await noOverflow(page, `lab ${viewport.width}`);
    for (const detail of await page.locator('#machine-view details, .sources').all()) {
      if (await detail.isVisible()) await openDetails(page, detail);
    }
    await noOverflow(page, `lab panels ${viewport.width}`);
    assert(await page.locator('#all-registers').isVisible());
    assert(await page.locator('#signals').isVisible());
    assert(await page.locator('#instruction-memory').isVisible());
    assert(await page.locator('.sources a').first().isVisible());
    await page.screenshot({path: path.join(output, `revision-lab-${viewport.width}.png`), fullPage: true});
    for (const mode of ['lock', 'core', 'pipeline', 'defense']) {
      await clickMode(page, mode);
      if (mode === 'lock') await page.locator('#compare').click();
      if (viewport.projector && !(await page.locator('body').evaluate(node => node.classList.contains('projector')))) {
        await page.locator('#presentation').click();
      }
      for (const detail of await page.locator(`#${mode === 'pipeline' ? 'pipeline-view' : mode === 'core' ? 'core-view' : 'machine-view'} details`).all()) {
        if (await detail.isVisible()) await openDetails(page, detail);
      }
      await noOverflow(page, `${mode} ${viewport.width}`);
      if (viewport.width === 390 || (viewport.projector && ['core', 'pipeline'].includes(mode))) {
        await page.screenshot({path: path.join(output, `revision-${mode}-${viewport.width}.png`), fullPage: true});
      }
    }
  }
  fs.writeFileSync(path.join(output, 'revision-fonts.json'), JSON.stringify(measurements, null, 2));
  pass('1440 desktop, 1280×720 projector, 390 and 320 mobile: fonts, every mode, no horizontal scroll');

  assert.deepEqual(errors, [], 'no browser console, request or script errors');
  fs.writeFileSync(path.join(output, 'revision-browser-results.json'), JSON.stringify({passed, errors}, null, 2));
  console.log(`\n${passed.length} browser scenarios passed. No console errors. Screenshots: ${output}`);
  await browser.close();
})().catch(async error => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});
