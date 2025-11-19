import { type Component } from 'solid-js';
import './ErrorState.css';

interface ErrorStateProps {
  onRetry?: () => void;
}

const ErrorState: Component<ErrorStateProps> = (props) => {
  return (
    <div class="error-state">
      <div class="error-content">
        <div class="error-icon-wrapper">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16" r="1" fill="currentColor"/>
          </svg>
        </div>
        <p class="error-text">Failed to load benchmark data</p>
        {props.onRetry && (
          <button class="retry-button" onClick={props.onRetry}>
            <svg class="retry-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 12C4 7.58172 7.58172 4 12 4C14.5264 4 16.7792 5.17107 18.2454 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M20 12C20 16.4183 16.4183 20 12 20C9.47362 20 7.22082 18.8289 5.75463 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M15 7H18.5V3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9 17H5.5V20.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Try Again
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorState;
