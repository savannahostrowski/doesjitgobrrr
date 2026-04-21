import { type Component, For } from 'solid-js';
import { machinesResource as machines } from '../api';
import './About.css';

const About: Component = () => {
  return (
    <div class="about-page">
      <div class="about-layout">
        {/* Intro */}
        <section class="about-card">
          <h2 class="about-card-title">What is this?</h2>
          <p class="about-text">
            <strong>doesjitgobrrr</strong> tracks the performance of CPython's
            experimental JIT compiler vs. the standard interpreter over time
            using the{' '}
            <a
              href="https://github.com/python/pyperformance"
              target="_blank"
              rel="noopener noreferrer"
            >
              pyperformance benchmark suite
            </a>
            . The goal is to benchmark the JIT on consumer hardware — the kind
            of machines real developers actually use — rather than server-class
            infrastructure. It's a more JIT-focused view than the official{' '}
            <a
              href="https://speed.python.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              speed.python.org
            </a>{' '}
            dashboard.
          </p>
          <div class="about-links-row">
            <a
              href="https://github.com/savannahostrowski/doesjitgobrrr"
              target="_blank"
              rel="noopener noreferrer"
              class="about-link-pill"
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Source Code
            </a>
            <a
              href="https://github.com/savannahostrowski/pyperf_bench"
              target="_blank"
              rel="noopener noreferrer"
              class="about-link-pill"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Benchmark Data
            </a>
          </div>
        </section>

        {/* Machines */}
        <section class="about-card">
          <h2 class="about-card-title">Machines</h2>
          <p class="about-text about-text-secondary">
            All benchmarks run on dedicated hardware.
          </p>
          <div class="about-machines-grid">
            <For each={Object.entries(machines() || {})}>
              {([name, info]) => (
                <div class="about-machine-card">
                  <div class="about-machine-header">
                    <span class="about-machine-name">{name}</span>
                    <span class="about-machine-arch">{info.arch}</span>
                  </div>
                  <p class="about-machine-desc">{info.description}</p>
                  <div class="about-machine-details">
                    <div class="about-machine-detail">
                      <span class="about-machine-detail-label">OS</span>
                      <span class="about-machine-detail-value">{info.os}</span>
                    </div>
                    <div class="about-machine-detail">
                      <span class="about-machine-detail-label">Owner</span>
                      <span class="about-machine-detail-value">
                        {info.owner_email ? (
                          <a href={`mailto:${info.owner_email}`}>
                            {info.owner}
                          </a>
                        ) : (
                          info.owner
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>

        {/* Contact */}
        <section class="about-card about-card-compact">
          <h2 class="about-card-title">Contact</h2>
          <p class="about-text">
            Questions or feedback? Reach out at{' '}
            <a href="mailto:savannah@python.org">savannah@python.org</a>
          </p>
        </section>
      </div>
    </div>
  );
};

export default About;
