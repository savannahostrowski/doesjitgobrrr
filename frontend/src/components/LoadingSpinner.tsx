import { type Component } from 'solid-js';
import './LoadingSpinner.css';

const LoadingSpinner: Component = () => {
  return (
    <div class="loading-container" role="status" aria-label="Loading benchmark data">
      <div class="spinner-wrapper">
        <p class="loading-text" aria-hidden="true">Loading benchmark data...</p>
        <div class="loading-dots" aria-hidden="true">
          <span/>
          <span/>
          <span/>
        </div>
      </div>
    </div>
  );
};

export default LoadingSpinner;
