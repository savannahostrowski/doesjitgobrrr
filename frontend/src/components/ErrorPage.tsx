import { type Component } from 'solid-js';
import './ErrorPage.css';

interface ErrorPageProps {
  onRetry?: () => void;
}

const ErrorPage: Component<ErrorPageProps> = (props) => {
  return (
    <div class="error-container">
      <div class="error-wrapper">
        <div class="error-icon-wrapper">
          <svg class="error-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16" r="1" fill="currentColor"/>
          </svg>
        </div>
        <h2 class="error-title">Oops! Something went wrong</h2>
        <p class="error-message">
          Failed to load benchmark data. This could be due to a network issue or the server might be temporarily unavailable.
        </p>
        <div class="error-actions">
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
          <a href="/" class="home-button">
            <svg class="home-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9 22V12H15V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Go Home
          </a>
        </div>
        <p class="error-hint">
          If the problem persists, please try again later or check your internet connection.
        </p>
      </div>
    </div>
  );
};

export default ErrorPage;
