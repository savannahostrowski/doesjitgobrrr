import { type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';

const About: Component = () => {
  const navigate = useNavigate();

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
            All benchmarks are run on dedicated hardware sitting in my homelab with the following specifications:
          </p>

          <h4>blueberry (aarch64)</h4>
          <ul>
            <li>
              <strong>Device:</strong>{' '}
              <a
                href="https://www.raspberrypi.com/products/raspberry-pi-5/?variant=raspberry-pi-5-8gb"
                target="_blank"
                rel="noopener noreferrer"
              >
                Raspberry Pi 5
              </a>
            </li>
            <li><strong>RAM:</strong> 8GB</li>
            <li>
              <strong>Storage:</strong>{' '}
              <a
                href="https://www.raspberrypi.com/products/ssd/?variant=ssd-256"
                target="_blank"
                rel="noopener noreferrer"
              >
                256GB SSD
              </a>
            </li>
            <li>
              <strong>Cooling:</strong>{' '}
              <a
                href="https://www.raspberrypi.com/products/cooler/"
                target="_blank"
                rel="noopener noreferrer"
              >
                External Cooler
              </a>
            </li>
            <li><strong>OS:</strong> Debian GNU/Linux 12 (bookworm)</li>
            <li><strong>Name:</strong> "blueberry" because it's a Pi!</li>
          </ul>

          <h4>ripley (x86_64)</h4>
          <ul>
            <li><strong>CPU:</strong> Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz (6 cores)</li>
            <li><strong>RAM:</strong> 8GB</li>
            <li><strong>OS:</strong> Ubuntu 24.04</li>
            <li><strong>Name:</strong> "ripley" because Alien is one of my favourite movies of all time!</li>
          </ul>

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
