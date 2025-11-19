import { type Component } from 'solid-js';
import './LoadingSpinner.css';

const LoadingSpinner: Component = () => {
  return (
    <div class="loading-container">
      <div class="spinner-wrapper">
        <p class="loading-text">Loading benchmark data...</p>
        <div class="loading-dots">
          <span/>
          <span/>
          <span/>
        </div>
      </div>
    </div>
  );
};

export default LoadingSpinner;
