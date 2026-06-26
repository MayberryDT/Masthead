import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Toolbar } from "../Toolbar";
import type { CollapsibleSearchHandle } from "../primitives/CollapsibleSearch";

describe("Observability toolbar", () => {
  test("renders the compact reference toolbar without prototype controls", () => {
    const html = renderToStaticMarkup(
      <Toolbar
        query=""
        filter="all"
        resultCount={8}
        totalCount={12}
        harnessFilter="all"
        lifecycleFilter="all"
        sortMode="recent_activity"
        activityWindow="24h"
        refreshRateMs={10_000}
        density="comfortable"
        onQueryChange={() => undefined}
        onFilterChange={() => undefined}
        onHarnessFilterChange={() => undefined}
        onLifecycleFilterChange={() => undefined}
        onSortModeChange={() => undefined}
        onActivityWindowChange={() => undefined}
        onRefreshRateChange={() => undefined}
        onDensityToggle={() => undefined}
        searchInputRef={createRef<CollapsibleSearchHandle>()}
      />
    );

    expect(html).toContain("Search sessions");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("All sessions");
    expect(html).not.toContain("Needs attention");
    expect(html).not.toContain("Conflicts");
    expect(html).not.toContain("All Agents");
    expect(html).toContain("All Lifecycles");
    expect(html).not.toContain("All Environments");
    expect(html).toContain("All Harnesses");
    expect(html).not.toContain("All Hosts");
    expect(html).toContain("Recent Activity");
    expect(html).not.toContain("Demo data");
    expect(html).toContain('aria-label="Compact grid"');
  });

  test("renders the compact grid control beside the refresh selector", () => {
    const html = renderToStaticMarkup(
      <Toolbar
        query=""
        filter="all"
        resultCount={8}
        totalCount={12}
        harnessFilter="all"
        lifecycleFilter="all"
        sortMode="recent_activity"
        activityWindow="24h"
        refreshRateMs={10_000}
        density="comfortable"
        onQueryChange={() => undefined}
        onFilterChange={() => undefined}
        onHarnessFilterChange={() => undefined}
        onLifecycleFilterChange={() => undefined}
        onSortModeChange={() => undefined}
        onActivityWindowChange={() => undefined}
        onRefreshRateChange={() => undefined}
        onDensityToggle={() => undefined}
        searchInputRef={createRef<CollapsibleSearchHandle>()}
      />
    );

    expect(html.indexOf('class="toolbar-select metal-control  refresh"')).toBeLessThan(
      html.indexOf('aria-label="Compact grid"')
    );
    expect(html).not.toContain("Reconnect");
    expect(html).not.toContain("layout-toggle-text");
    expect(html).not.toContain("Live projection");
    expect(html).not.toContain("git snapshots");
  });

  test("renders all completed toolbar controls from shared options", () => {
    const html = renderToStaticMarkup(
      <Toolbar
        query=""
        filter="all"
        resultCount={8}
        totalCount={12}
        harnessFilter="all"
        lifecycleFilter="all"
        sortMode="recent_activity"
        activityWindow="24h"
        refreshRateMs={10_000}
        density="comfortable"
        onQueryChange={() => undefined}
        onFilterChange={() => undefined}
        onHarnessFilterChange={() => undefined}
        onLifecycleFilterChange={() => undefined}
        onSortModeChange={() => undefined}
        onActivityWindowChange={() => undefined}
        onRefreshRateChange={() => undefined}
        onDensityToggle={() => undefined}
        searchInputRef={createRef<CollapsibleSearchHandle>()}
      />
    );

    expect(html).toContain("All Harnesses");
    expect(html).toContain("All Lifecycles");
    expect(html).toContain("Recent Activity");
    expect(html).toContain("Last 24 hours");
    expect(html).toContain("10s");
    expect(html).toContain('aria-label="Compact grid"');
  });
});
