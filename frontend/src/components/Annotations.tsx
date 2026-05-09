import { type Component, For, Show } from 'solid-js';
import { perfEventsResource as events } from '../api';
import type { PerfEvent, PerfEventKind } from '../types';
import './Annotations.css';

const KIND_LABELS: Record<PerfEventKind, string> = {
  'jit-change': 'JIT change',
  bug: 'Bug',
  infra: 'Infra',
  benchmark: 'Benchmark',
};

function formatDate(iso: string): string {
  // YYYY-MM-DD parsed in UTC to avoid local-tz drift on the displayed day
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const Annotations: Component = () => {
  return (
    <div class="annotations-page">
      <div class="annotations-layout">
        <section class="about-card">
          <h2 class="about-card-title">Annotations</h2>
          <p class="about-text about-text-secondary">
            Notable JIT changes, bugs, and infra events that help explain
            movement in the chart. Edit <code>api/perf_events.yaml</code> to add
            an entry.
          </p>
        </section>

        <Show
          when={!events.loading}
          fallback={
            <section class="about-card">
              <p class="about-text">Loading…</p>
            </section>
          }
        >
          <Show
            when={(events() ?? []).length > 0}
            fallback={
              <section class="about-card">
                <p class="about-text">No annotations recorded yet.</p>
              </section>
            }
          >
            <For each={events()}>
              {(event: PerfEvent) => (
                <section
                  id={event.id || undefined}
                  class="about-card annotations-entry"
                >
                  <div class="annotations-entry-header">
                    <span
                      class={`annotations-kind annotations-kind-${event.kind}`}
                    >
                      {KIND_LABELS[event.kind]}
                    </span>
                    <time class="annotations-date" datetime={event.date}>
                      {formatDate(event.date)}
                    </time>
                  </div>
                  <h3 class="annotations-title">{event.title}</h3>
                  <Show when={event.machines && event.machines.length > 0}>
                    <div class="annotations-machines">
                      <For each={event.machines}>
                        {(m) => (
                          <span class="annotations-machine-chip">{m}</span>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={event.description}>
                    <p class="about-text annotations-description">
                      {event.description}
                    </p>
                  </Show>
                  <Show when={event.link}>
                    <div class="about-links-row">
                      <a
                        href={event.link as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="about-link-pill"
                      >
                        Read more →
                      </a>
                    </div>
                  </Show>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default Annotations;
