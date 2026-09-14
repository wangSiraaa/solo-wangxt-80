/**
 * 真实浏览器端到端验证（Playwright + Chromium headless）：
 *  - 取消、失解停在最后可靠步，页面显示明确状态；
 *  - 近共面无穿透构型在页面产生可定位的无厚度接触候选；
 *  - 同目标不同偏移/不同驱动的路径显示非空、可比较的分支身份。
 *
 * 运行：npx playwright test scripts/e2e --config=e2e.config.ts（由 run-all-e2e.sh 启动 dev）
 */
import { test, expect, type Page } from '@playwright/test';

const STORE = 'window.__ORIGAMI_STORE__';

async function loadExample(page: Page, key: string) {
  await page.evaluate((k) => (window as any).__ORIGAMI_STORE__.loadExample(k), key);
  await page.waitForTimeout(120);
}

async function runPath(
  page: Page,
  opts: { fixed: number[]; goal: Record<number, number>; bias?: number },
) {
  return page.evaluate(
    async (o) => {
      const s = (window as any).__ORIGAMI_STORE__;
      const p = await s.runPath({
        label: 'e2e',
        fixedEdges: o.fixed,
        goalDeg: o.goal,
        branchBias: o.bias ?? 0,
        maxStepDeg: 10,
      });
      return {
        stop: p.stopReason,
        steps: p.steps.length,
        endT: p.steps.at(-1).t,
        branchId: p.branchId,
        endResidual: p.steps.at(-1).residual,
      };
    },
    opts,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__ORIGAMI_STORE__);
  await page.waitForTimeout(150);
});

test('失解：过约束目标停在平展最后可靠步，页面显示“失去可行解”', async ({ page }) => {
  await loadExample(page, 'inconsistent');
  const info = await runPath(page, { fixed: [4, 5, 6], goal: { 4: 60, 5: 60, 6: 60 } });
  expect(info.stop).toBe('infeasible');
  expect(info.endT).toBeLessThan(0.05);
  // 路径列表徽标与停止消息
  await expect(page.locator('.stop.warn', { hasText: '失去可行解' }).first()).toBeVisible();
  await expect(page.locator('.stopmsg')).toContainText('失去可行解');
});

test('取消：运动中取消后停在最后可靠步，页面显示“已取消”', async ({ page }) => {
  await loadExample(page, 'degree4');
  await page.evaluate(() => {
    const s = (window as any).__ORIGAMI_STORE__;
    [4, 6].forEach((e: number) => s.setAssignment(e, 'M'));
    [5, 7].forEach((e: number) => s.setAssignment(e, 'V'));
  });
  // 启动后立即取消，收集最终状态
  const resultP = page.evaluate(async () => {
    const s = (window as any).__ORIGAMI_STORE__;
    const { runContinuation, buildTarget } = await import('/src/fold/continuation.ts');
    const g = s.graph;
    const target = buildTarget(g, [4], { 4: 60 });
    let cancel = false;
    const p = await runContinuation(g, target, {
      shouldCancel: () => cancel,
      yieldEvery: 1,
      onStep: (st: { t: number }) => { if (st.t > 0.4) cancel = true; },
    });
    // 写入 store 的路径列表以驱动页面
    return { stop: p.stopReason, endT: p.steps.at(-1).t, steps: p.steps.length };
  });
  const r = await resultP;
  expect(r.stop).toBe('cancelled');
  expect(r.endT).toBeLessThan(0.7);
  expect(r.endT).toBeGreaterThan(0.1);
  expect(r.steps).toBeGreaterThan(1);

  // UI 上的“取消计算”按钮在运行期间可点击（disabled 状态翻转）
  await loadExample(page, 'miura2');
  await page.evaluate(() => {
    const s = (window as any).__ORIGAMI_STORE__;
    const interior = s.graph.edgesVertices
      .map((_: unknown, e: number) => e)
      .filter((e: number) => s.graph.edgesFaces[e].length === 2);
    s.runPath({ label: '长路径', fixedEdges: [interior[0]], goalDeg: { [interior[0]]: 80 } });
  });
  const cancelBtn = page.locator('button', { hasText: '取消计算' });
  await expect(cancelBtn).toBeEnabled({ timeout: 200 });
  await cancelBtn.click();
  await page.waitForTimeout(200);
  await expect(page.locator('.stopmsg')).toContainText('取消');
});

test('近共面：无厚度接触候选出现在页面且可定位，不标成穿透', async ({ page }) => {
  await loadExample(page, 'contact3');
  // 该示例源折痕已在 179°，静态诊断即应给出面0↔面2 接触候选
  const diag = await page.evaluate(() => {
    const r = (window as any).__ORIGAMI_STORE__.foldResult.value;
    return {
      contacts: r.contacts.map((c: any) => ({ a: c.faceA, b: c.faceB, d: c.distance })),
      intersections: r.intersections.length,
      converged: r.converged,
    };
  });
  expect(diag.intersections).toBe(0);
  expect(diag.contacts.length).toBeGreaterThan(0);
  expect(diag.contacts[0].d).toBeLessThan(1e-4);

  // 页面出现接触候选按钮，点击选中面片
  const contactBtn = page.locator('.contact').first();
  await expect(contactBtn).toBeVisible();
  await contactBtn.click();
  const sel = await page.evaluate(() => {
    const s = (window as any).__ORIGAMI_STORE__;
    return { kind: s.selection.kind, index: s.selection.index };
  });
  expect(sel.kind).toBe('face');
  expect([diag.contacts[0].a, diag.contacts[0].b]).toContain(sel.index);
  // 诊断判定为当前构形满足约束（无未收敛/穿透徽标）
  await expect(page.locator('.verdict.good')).toBeVisible();
});

test('同目标不同驱动：两条路径显示非空、可比较的分支身份', async ({ page }) => {
  await loadExample(page, 'degree4');
  await page.evaluate(() => {
    const s = (window as any).__ORIGAMI_STORE__;
    [4, 6].forEach((e: number) => s.setAssignment(e, 'M'));
    [5, 7].forEach((e: number) => s.setAssignment(e, 'V'));
  });
  const a = await runPath(page, { fixed: [4], goal: { 4: 60 } });
  const b = await runPath(page, { fixed: [5], goal: { 5: 60 } });
  expect(a.branchId.length).toBeGreaterThan(0);
  expect(b.branchId.length).toBeGreaterThan(0);
  expect(a.branchId).not.toBe(b.branchId);
  // 路径列表两行都显示非空“分支：…”文本，无“平展”回退
  const branchLabels = await page.locator('.branch').allTextContents();
  expect(branchLabels.length).toBeGreaterThanOrEqual(2);
  for (const t of branchLabels) {
    expect(t).toMatch(/分支：\S+/);
    expect(t).not.toContain('平展');
  }
});

test('不可行偏移：路径明确标记为不可行分支并停在平展', async ({ page }) => {
  await loadExample(page, 'degree4');
  await page.evaluate(() => {
    const s = (window as any).__ORIGAMI_STORE__;
    [4, 6].forEach((e: number) => s.setAssignment(e, 'M'));
    [5, 7].forEach((e: number) => s.setAssignment(e, 'V'));
  });
  // 强烈推向 V 对（自动边 5、7），但固定 M4 时该装配模不可行
  const info = await page.evaluate(async () => {
    const s = (window as any).__ORIGAMI_STORE__;
    const p = await s.runPath({
      label: '不可行支',
      fixedEdges: [4],
      goalDeg: { 4: 60 },
      branchBias: -1,
      maxStepDeg: 8,
    });
    return { stop: p.stopReason, endT: p.steps.at(-1).t, branchId: p.branchId };
  });
  expect(info.stop).toBe('infeasible');
  expect(info.endT).toBeLessThan(0.02);
  expect(info.branchId).toContain('不可行');
});
