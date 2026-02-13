import { type Component, createResource, For } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { fetchMachines } from '../api';

const About: Component = () => {
  const navigate = useNavigate();
  const [machines] = createResource(fetchMachines);

  return (
    <div class="about-page-wrapper">
      <div class="back-button-container">
        <button class="back-button" onClick={() => navigate('/')}>
          ← Back to Home
        </button>
      </div>

      <section class="about-section">
        <div class="about-content">
          <h3>What is this website?</h3>
          <p>
            "does JIT go brrr?" is a silly project I built to quickly share perf stats with anyone who
            asks if the JIT is faster than the standard Python interpreter yet. This website tracks the
            performance of Python builds with and without the JIT enabled over time using the 
            <a
              href="https://github.com/python/pyperformance"
              target="_blank"
              rel="noopener noreferrer"
            >
              pyperformance benchmark suite
            </a>. It is intentionally a more JIT-focused view than the official
            Python performance dashboard found at 
            <a
              href="https://speed.python.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              speed.python.org
            </a>. The data that powers this site can be found in <a href="https://github.com/savannahostrowski/pyperf_bench" target="_blank" rel="noopener noreferrer">this repo</a>.
            The code for this website is also open source and can be found <a href="https://github.com/savannahostrowski/doesjitgobrrr" target="_blank" rel="noopener noreferrer">here</a>.
          </p>
          <h3>Machines</h3>
          <p>
            All benchmarks are run on dedicated hardware with the following specifications:
          </p>

          <For each={Object.entries(machines() || {})}>
            {([name, info]) => (
              <>
                <h4>{name} ({info.arch})</h4>
                <ul>
                  <li><strong>Description:</strong> {info.description}</li>
                  <li><strong>OS:</strong> {info.os}</li>
                  <li>
                    <strong>Owner:</strong>{' '}
                    {info.owner_email
                      ? <a href={`mailto:${info.owner_email}`}>{info.owner}</a>
                      : info.owner}
                  </li>
                </ul>
              </>
            )}
          </For>

          <h3>Contact</h3>
          <p>
            Questions or feedback? Feel free to reach out to me via email at 
            <a href="mailto:savannah@python.org">savannah@python.org</a>
          </p>
        </div>
      </section>
    </div>
  );
};

export default About;
